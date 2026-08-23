//! A lexer for the subset of SystemVerilog that sv2iris reads.
//!
//! It produces a flat token stream. Comments (`//` and `/* */`) and whitespace
//! are dropped. Numbers are kept as their source text; the emitter normalises
//! them to IRIS form.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tok {
    /// An identifier or keyword
    Ident(String),
    /// A numeric literal, source text kept verbatim (e.g. `8'hFF`, `42`)
    Number(String),
    /// Punctuation or an operator (e.g. `(`, `<=`, `&&`)
    Sym(String),
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    /// 1-based line, for diagnostics
    pub line: usize,
}

/// Turn source into tokens. Returns an error message with a line number if a
/// character cannot be lexed.
pub fn lex(source: &str) -> Result<Vec<Token>, String> {
    let bytes = source.as_bytes();
    let mut i = 0;
    let mut line = 1;
    let mut out = Vec::new();

    // The multi-character operators, longest first so `>>>` is not read as `>>`
    // and `<=` is not read as `<`.
    const MULTI: &[&str] = &[
        ">>>", "<<<", "+:", "-:", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "**",
    ];

    while i < bytes.len() {
        let c = bytes[i] as char;

        // Whitespace
        if c == '\n' {
            line += 1;
            i += 1;
            continue;
        }
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        // Comments
        if c == '/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                if bytes[i] == b'\n' {
                    line += 1;
                }
                i += 1;
            }
            i += 2; // consume the closing */
            continue;
        }

        // A number: a digit, or a based literal starting with a size or a quote.
        if c.is_ascii_digit() || (c == '\'' && i + 1 < bytes.len() && is_base(bytes[i + 1])) {
            let start = i;
            // Optional size digits
            while i < bytes.len() && (bytes[i] as char).is_ascii_digit() {
                i += 1;
            }
            // Optional based part: 'h 'd 'b 'o with optional signed 's'. Only
            // when a base letter actually follows the quote; otherwise the quote
            // belongs to a size cast (`32'(...)`) and is left as its own token.
            if i < bytes.len() && bytes[i] == b'\'' {
                let mut j = i + 1;
                if j < bytes.len() && (bytes[j] == b's' || bytes[j] == b'S') {
                    j += 1;
                }
                if j < bytes.len() && is_base(bytes[j]) {
                    i = j + 1;
                    while i < bytes.len() && is_value_char(bytes[i]) {
                        i += 1;
                    }
                }
            } else {
                // A real literal: `1.5`, `3.14`, `2.5e-3`. The `.` must be
                // followed by a digit so it is not member access on a number.
                if i + 1 < bytes.len() && bytes[i] == b'.' && bytes[i + 1].is_ascii_digit() {
                    i += 1;
                    while i < bytes.len() && (bytes[i] as char).is_ascii_digit() {
                        i += 1;
                    }
                }
                // An optional exponent: `e`/`E`, an optional sign, then digits.
                if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
                    let mut j = i + 1;
                    if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {
                        j += 1;
                    }
                    if j < bytes.len() && bytes[j].is_ascii_digit() {
                        i = j;
                        while i < bytes.len() && (bytes[i] as char).is_ascii_digit() {
                            i += 1;
                        }
                    }
                }
            }
            let text: String = source[start..i].to_string();
            out.push(Token { tok: Tok::Number(text), line });
            continue;
        }

        // Identifier or keyword. A leading `$` marks a system function
        // (`$signed`), kept as part of the identifier.
        if c == '_' || c == '$' || c.is_ascii_alphabetic() {
            let start = i;
            i += 1; // the first character (letter, '_' or '$')
            while i < bytes.len()
                && (bytes[i] == b'_' || (bytes[i] as char).is_ascii_alphanumeric())
            {
                i += 1;
            }
            out.push(Token { tok: Tok::Ident(source[start..i].to_string()), line });
            continue;
        }

        // A multi-character operator
        let rest = &source[i..];
        if let Some(op) = MULTI.iter().find(|op| rest.starts_with(**op)) {
            out.push(Token { tok: Tok::Sym((*op).to_string()), line });
            i += op.len();
            continue;
        }

        // A single-character symbol
        if "()[]{}:;,=?+-*/%~^&|!<>.@'#".contains(c) {
            out.push(Token { tok: Tok::Sym(c.to_string()), line });
            i += 1;
            continue;
        }

        // A string literal or a compiler directive is a testbench/header
        // construct. Report it as "not converted" rather than as a hard lexing
        // error, so callers can treat it as an unsupported testbench.
        if c == '"' {
            return Err(format!(
                "line {}: a string literal was not converted (testbench construct)",
                line
            ));
        }
        if c == '`' {
            return Err(format!(
                "line {}: a compiler directive (`...) was not converted",
                line
            ));
        }

        return Err(format!("line {}: unexpected character '{}'", line, c));
    }

    Ok(out)
}

/// A base letter of a based literal: b, o, d, h.
fn is_base(b: u8) -> bool {
    matches!(b, b'b' | b'B' | b'o' | b'O' | b'd' | b'D' | b'h' | b'H')
}

/// A value character inside a based literal.
fn is_value_char(b: u8) -> bool {
    (b as char).is_ascii_hexdigit() || matches!(b, b'_' | b'x' | b'X' | b'z' | b'Z')
}
