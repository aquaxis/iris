//! IRIS language server (Rust port of the TypeScript `irisfmt-ls`).
//!
//! A synchronous JSON-RPC server over stdio. It reuses the `irisfmt` crate for
//! formatting and linting and the `iris-sim` AST for symbols. Text sync is Full
//! (the whole document arrives on each change), which keeps the transport
//! simple and is ample for source files.

mod docs;
mod symbols;
mod text;

use std::collections::HashMap;
use std::io::{self, Read, Write};

use lsp_types::{
    CompletionOptions, CompletionParams, CompletionResponse, Diagnostic, DiagnosticSeverity,
    DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    DocumentFormattingParams, DocumentRangeFormattingParams, DocumentSymbol,
    DocumentSymbolParams, DocumentSymbolResponse, GotoDefinitionParams, GotoDefinitionResponse,
    Hover, HoverContents, HoverParams, InitializeResult, Location, MarkupContent, MarkupKind, OneOf,
    Position, PublishDiagnosticsParams, Range, ReferenceParams, RenameParams, ServerCapabilities,
    ServerInfo, TextDocumentSyncCapability, TextDocumentSyncKind, TextEdit, Url, WorkspaceEdit,
};
use serde_json::{json, Value};

fn main() {
    let mut server = Server::default();
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    while let Some(msg) = read_message(&mut reader) {
        server.handle(msg);
        if server.shutdown_requested && server.exit {
            break;
        }
    }
}

#[derive(Default)]
struct Server {
    docs: HashMap<Url, String>,
    shutdown_requested: bool,
    exit: bool,
}

impl Server {
    fn handle(&mut self, msg: Value) {
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let id = msg.get("id").cloned();
        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        match (id.clone(), method) {
            // Requests (have an id).
            (Some(id), "initialize") => send_response(id, self.initialize()),
            (Some(id), "shutdown") => {
                self.shutdown_requested = true;
                send_response(id, Value::Null);
            }
            (Some(id), "textDocument/hover") => send_response(id, self.hover(params)),
            (Some(id), "textDocument/completion") => send_response(id, self.completion(params)),
            (Some(id), "textDocument/definition") => send_response(id, self.definition(params)),
            (Some(id), "textDocument/references") => send_response(id, self.references(params)),
            (Some(id), "textDocument/documentSymbol") => {
                send_response(id, self.document_symbols(params))
            }
            (Some(id), "textDocument/rename") => self.rename(id, params),
            (Some(id), "textDocument/formatting") => send_response(id, self.formatting(params)),
            (Some(id), "textDocument/rangeFormatting") => {
                send_response(id, self.range_formatting(params))
            }
            (Some(id), _) => send_response(id, Value::Null), // unknown request

            // Notifications (no id).
            (None, "initialized") => {}
            (None, "exit") => {
                self.exit = true;
            }
            (None, "textDocument/didOpen") => self.did_open(params),
            (None, "textDocument/didChange") => self.did_change(params),
            (None, "textDocument/didClose") => self.did_close(params),
            (None, _) => {}
        }
    }

    fn initialize(&self) -> Value {
        let capabilities = ServerCapabilities {
            text_document_sync: Some(TextDocumentSyncCapability::Kind(TextDocumentSyncKind::FULL)),
            document_formatting_provider: Some(OneOf::Left(true)),
            document_range_formatting_provider: Some(OneOf::Left(true)),
            hover_provider: Some(lsp_types::HoverProviderCapability::Simple(true)),
            definition_provider: Some(OneOf::Left(true)),
            references_provider: Some(OneOf::Left(true)),
            document_symbol_provider: Some(OneOf::Left(true)),
            rename_provider: Some(OneOf::Left(true)),
            completion_provider: Some(CompletionOptions {
                trigger_characters: Some(vec![".".into(), ":".into(), "<".into()]),
                resolve_provider: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        };
        let result = InitializeResult {
            capabilities,
            server_info: Some(ServerInfo {
                name: "irisfmt-lsp".into(),
                version: Some(env!("CARGO_PKG_VERSION").into()),
            }),
        };
        serde_json::to_value(result).unwrap()
    }

    // --- Document lifecycle -------------------------------------------------

    fn did_open(&mut self, params: Value) {
        let Ok(p) = serde_json::from_value::<DidOpenTextDocumentParams>(params) else {
            return;
        };
        let uri = p.text_document.uri.clone();
        self.docs.insert(uri.clone(), p.text_document.text);
        self.publish_diagnostics(&uri);
    }

    fn did_change(&mut self, params: Value) {
        let Ok(p) = serde_json::from_value::<DidChangeTextDocumentParams>(params) else {
            return;
        };
        // Full sync: the last change carries the whole document.
        if let Some(change) = p.content_changes.into_iter().last() {
            let uri = p.text_document.uri.clone();
            self.docs.insert(uri.clone(), change.text);
            self.publish_diagnostics(&uri);
        }
    }

    fn did_close(&mut self, params: Value) {
        let Ok(p) = serde_json::from_value::<DidCloseTextDocumentParams>(params) else {
            return;
        };
        self.docs.remove(&p.text_document.uri);
        // Clear diagnostics for the closed document.
        send_notification(
            "textDocument/publishDiagnostics",
            serde_json::to_value(PublishDiagnosticsParams {
                uri: p.text_document.uri,
                diagnostics: Vec::new(),
                version: None,
            })
            .unwrap(),
        );
    }

    fn publish_diagnostics(&self, uri: &Url) {
        let Some(text) = self.docs.get(uri) else {
            return;
        };
        let diagnostics = match irisfmt::lint_src(text) {
            Ok(diags) => diags.into_iter().map(|d| to_lsp_diagnostic(text, d)).collect(),
            // A document mid-edit often does not parse; report nothing until it does.
            Err(_) => Vec::new(),
        };
        send_notification(
            "textDocument/publishDiagnostics",
            serde_json::to_value(PublishDiagnosticsParams {
                uri: uri.clone(),
                diagnostics,
                version: None,
            })
            .unwrap(),
        );
    }

    // --- Language features --------------------------------------------------

    fn hover(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<HoverParams>(params) else {
            return Value::Null;
        };
        let uri = &p.text_document_position_params.text_document.uri;
        let Some(text) = self.docs.get(uri) else {
            return Value::Null;
        };
        let offset = text::offset_at(text, p.text_document_position_params.position);
        let Some((word, start, end)) = text::word_at(text, offset) else {
            return Value::Null;
        };
        let Some(doc) = docs::keyword_doc(&word) else {
            return Value::Null;
        };
        let hover = Hover {
            contents: HoverContents::Markup(MarkupContent {
                kind: MarkupKind::Markdown,
                value: doc.to_string(),
            }),
            range: Some(Range {
                start: text::position_at(text, start),
                end: text::position_at(text, end),
            }),
        };
        serde_json::to_value(hover).unwrap()
    }

    fn completion(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<CompletionParams>(params) else {
            return Value::Null;
        };
        let uri = &p.text_document_position.text_document.uri;
        let Some(text) = self.docs.get(uri) else {
            return Value::Null;
        };
        let offset = text::offset_at(text, p.text_document_position.position);
        let ctx = docs::completion_context(text, offset);
        let items = docs::completion_items(ctx);
        serde_json::to_value(CompletionResponse::Array(items)).unwrap()
    }

    fn definition(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<GotoDefinitionParams>(params) else {
            return Value::Null;
        };
        let uri = &p.text_document_position_params.text_document.uri;
        let Some(text) = self.docs.get(uri) else {
            return Value::Null;
        };
        let offset = text::offset_at(text, p.text_document_position_params.position);
        let Some((word, _, _)) = text::word_at(text, offset) else {
            return Value::Null;
        };
        // Resolve to a top-level definition (module/function/enum/struct).
        for def in symbols::definitions(text) {
            if def.name == word {
                let loc = Location {
                    uri: uri.clone(),
                    range: def.range,
                };
                return serde_json::to_value(GotoDefinitionResponse::Scalar(loc)).unwrap();
            }
        }
        Value::Null
    }

    fn references(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<ReferenceParams>(params) else {
            return Value::Null;
        };
        let uri = &p.text_document_position.text_document.uri;
        let Some(text) = self.docs.get(uri) else {
            return Value::Null;
        };
        let offset = text::offset_at(text, p.text_document_position.position);
        let Some((word, _, _)) = text::word_at(text, offset) else {
            return Value::Null;
        };
        let locations: Vec<Location> = text::whole_word_spans(text, &word)
            .into_iter()
            .map(|(s, e)| Location {
                uri: uri.clone(),
                range: Range {
                    start: text::position_at(text, s),
                    end: text::position_at(text, e),
                },
            })
            .collect();
        serde_json::to_value(locations).unwrap()
    }

    fn document_symbols(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<DocumentSymbolParams>(params) else {
            return Value::Null;
        };
        let Some(text) = self.docs.get(&p.text_document.uri) else {
            return Value::Null;
        };
        #[allow(deprecated)]
        let syms: Vec<DocumentSymbol> = symbols::definitions(text)
            .into_iter()
            .map(|d| DocumentSymbol {
                name: d.name,
                detail: None,
                kind: d.kind,
                tags: None,
                deprecated: None,
                range: d.range,
                selection_range: d.range,
                children: None,
            })
            .collect();
        serde_json::to_value(DocumentSymbolResponse::Nested(syms)).unwrap()
    }

    fn rename(&self, id: Value, params: Value) {
        let Ok(p) = serde_json::from_value::<RenameParams>(params) else {
            send_response(id, Value::Null);
            return;
        };
        let uri = &p.text_document_position.text_document.uri;
        let Some(text) = self.docs.get(uri) else {
            send_response(id, Value::Null);
            return;
        };
        // Renaming to a reserved word would break parsing; refuse it.
        if docs::is_reserved_word(&p.new_name) {
            send_error(id, -32602, &format!("'{}' is a reserved word", p.new_name));
            return;
        }
        let offset = text::offset_at(text, p.text_document_position.position);
        let Some((word, _, _)) = text::word_at(text, offset) else {
            send_response(id, Value::Null);
            return;
        };
        let edits: Vec<TextEdit> = text::whole_word_spans(text, &word)
            .into_iter()
            .map(|(s, e)| TextEdit {
                range: Range {
                    start: text::position_at(text, s),
                    end: text::position_at(text, e),
                },
                new_text: p.new_name.clone(),
            })
            .collect();
        if edits.is_empty() {
            send_response(id, Value::Null);
            return;
        }
        let mut changes = HashMap::new();
        changes.insert(uri.clone(), edits);
        let edit = WorkspaceEdit {
            changes: Some(changes),
            ..Default::default()
        };
        send_response(id, serde_json::to_value(edit).unwrap());
    }

    fn formatting(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<DocumentFormattingParams>(params) else {
            return Value::Null;
        };
        self.format_whole(&p.text_document.uri)
    }

    fn range_formatting(&self, params: Value) -> Value {
        let Ok(p) = serde_json::from_value::<DocumentRangeFormattingParams>(params) else {
            return Value::Null;
        };
        // Formatting a fragment in isolation is unreliable; format the whole
        // document and return one edit, as the TypeScript server does.
        self.format_whole(&p.text_document.uri)
    }

    fn format_whole(&self, uri: &Url) -> Value {
        let Some(text) = self.docs.get(uri) else {
            return Value::Null;
        };
        match irisfmt::format_src(text) {
            Ok(formatted) if formatted != *text => {
                let edit = TextEdit {
                    range: Range {
                        start: Position { line: 0, character: 0 },
                        end: text::position_at(text, text.len()),
                    },
                    new_text: formatted,
                };
                serde_json::to_value(vec![edit]).unwrap()
            }
            // No change, or the document does not parse: no edits.
            _ => serde_json::to_value(Vec::<TextEdit>::new()).unwrap(),
        }
    }
}

/// Convert an `irisfmt` lint diagnostic to an LSP diagnostic, widening the
/// range to the word under the reported position for a readable squiggle.
fn to_lsp_diagnostic(text: &str, d: irisfmt::Diagnostic) -> Diagnostic {
    let start = Position {
        line: d.line.saturating_sub(1) as u32,
        character: d.col.saturating_sub(1) as u32,
    };
    let offset = text::offset_at(text, start);
    let end = match text::word_at(text, offset) {
        Some((_, _, e)) => text::position_at(text, e),
        None => start,
    };
    let severity = match d.severity {
        irisfmt::Severity::Error => DiagnosticSeverity::ERROR,
        irisfmt::Severity::Warning => DiagnosticSeverity::WARNING,
        irisfmt::Severity::Info => DiagnosticSeverity::INFORMATION,
    };
    Diagnostic {
        range: Range { start, end },
        severity: Some(severity),
        source: Some(format!("irisfmt-lint:{}", d.rule)),
        message: d.message,
        ..Default::default()
    }
}

// --- JSON-RPC transport -----------------------------------------------------

/// Read one `Content-Length`-framed JSON message from the reader.
fn read_message(reader: &mut impl Read) -> Option<Value> {
    let mut content_length: Option<usize> = None;
    // Read headers, one line at a time, until a blank line.
    loop {
        let line = read_header_line(reader)?;
        if line.is_empty() {
            break;
        }
        if let Some(rest) = line.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }
    let len = content_length?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

/// Read a single header line terminated by CRLF (the CRLF is stripped).
fn read_header_line(reader: &mut impl Read) -> Option<String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        reader.read_exact(&mut byte).ok()?;
        if byte[0] == b'\n' {
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
            break;
        }
        buf.push(byte[0]);
    }
    String::from_utf8(buf).ok()
}

fn send_response(id: Value, result: Value) {
    send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

fn send_error(id: Value, code: i64, message: &str) {
    send(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    }));
}

fn send_notification(method: &str, params: Value) {
    send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
}

fn send(msg: Value) {
    let body = serde_json::to_vec(&msg).unwrap();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let _ = write!(out, "Content-Length: {}\r\n\r\n", body.len());
    let _ = out.write_all(&body);
    let _ = out.flush();
}
