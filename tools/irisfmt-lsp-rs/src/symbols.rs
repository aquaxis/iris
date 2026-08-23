//! A small symbol table over the shared `iris-sim` AST.
//!
//! Only top-level definitions carry a span in that AST (modules, functions,
//! enums, structs), so the table resolves those. Signals and ports have no
//! span, so go-to-definition covers types/modules/functions — the names a
//! reader most often jumps to — while references and rename work on any
//! identifier through a whole-word text search.

use iris_sim::parser::ast::Span;
use iris_sim::parser::Parser;
use lsp_types::{Position, Range, SymbolKind};

pub struct Definition {
    pub name: String,
    pub kind: SymbolKind,
    pub range: Range,
}

/// The definitions with spans in the source, or empty if it does not parse.
pub fn definitions(source: &str) -> Vec<Definition> {
    let parser = Parser::new();
    let Ok(parsed) = parser.parse_all(source) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for m in &parsed.modules {
        push(&mut out, &m.name, SymbolKind::CLASS, &m.span);
    }
    for f in &parsed.functions {
        push(&mut out, &f.name, SymbolKind::FUNCTION, &f.span);
    }
    for e in &parsed.enums {
        push(&mut out, &e.name, SymbolKind::ENUM, &e.span);
    }
    for s in &parsed.structs {
        // LSP has no distinct union kind; a struct and a union both map to STRUCT.
        push(&mut out, &s.name, SymbolKind::STRUCT, &s.span);
    }
    out
}

fn push(out: &mut Vec<Definition>, name: &str, kind: SymbolKind, span: &Option<Span>) {
    if let Some(range) = span_to_range(span) {
        out.push(Definition {
            name: name.to_string(),
            kind,
            range,
        });
    }
}

/// Convert an iris-sim span (1-based line/col) to an LSP range (0-based).
pub fn span_to_range(span: &Option<Span>) -> Option<Range> {
    let s = span.as_ref()?;
    Some(Range {
        start: Position {
            line: s.start_line.saturating_sub(1) as u32,
            character: s.start_col.saturating_sub(1) as u32,
        },
        end: Position {
            line: s.end_line.saturating_sub(1) as u32,
            character: s.end_col.saturating_sub(1) as u32,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_module_and_function() {
        let src = "mod Counter(in clk: clock, out y: bit[8]) {\n    comb { y = 0; }\n}\nfn add(a: bit[8]) -> bit[8] { return a; }\n";
        let defs = definitions(src);
        assert!(defs.iter().any(|d| d.name == "Counter" && d.kind == SymbolKind::CLASS));
        assert!(defs.iter().any(|d| d.name == "add" && d.kind == SymbolKind::FUNCTION));
    }

    #[test]
    fn unparseable_returns_empty() {
        assert!(definitions("mod Broken( @@@ {{{").is_empty());
    }
}
