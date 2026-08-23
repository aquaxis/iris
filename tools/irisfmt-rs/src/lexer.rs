//! A lexer for IRIS that keeps comments, so the formatter can preserve them.
//!
//! It does not build an AST — the formatter re-emits the token stream with
//! canonical whitespace. IRIS is not whitespace-sensitive, so any spacing of
//! the same tokens is the same program.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tok {
    /// `/// ...` documentation comment (kept verbatim, without the newline)
    DocComment(String),
    /// `// ...` line comment
    LineComment(String),
    /// `/* ... */` block comment
    BlockComment(String),
    /// An identifier or keyword
    Ident(String),
    /// A numeric literal, e.g. `8'd5`, `42`, `1.5`
    Number(String),
    /// A string literal including the quotes
    Str(String),
    /// A punctuation token or operator, e.g. `{`, `<=`, `::`, `=>`
    Sym(String),
}

pub fn lex(source: &str) -> Result<Vec<Tok>, String> {
    let bytes = source.as_bytes();
    let mut i = 0;
    let mut line = 1;
    let mut out = Vec::new();

    // Multi-character operators, longest first.
    const MULTI: &[&str] = &[
        ">>>", "<<<", "+:", "-:", "::", "=>", "->", "<<", ">>", "<=", ">=", "==", "!=", "&&",
        "||", "**",
    ];

    while i < bytes.len() {
        let c = bytes[i] as char;

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
            let start = i;
            // `///` is a doc comment.
            let is_doc = i + 2 < bytes.len() && bytes[i + 2] == b'/';
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            let text = source[start..i].to_string();
            out.push(if is_doc { Tok::DocComment(text) } else { Tok::LineComment(text) });
            continue;
        }
        if c == '/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            let start = i;
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                if bytes[i] == b'\n' {
                    line += 1;
                }
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            out.push(Tok::BlockComment(source[start..i].to_string()));
            continue;
        }

        // String literal
        if c == '"' {
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i] != b'"' {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i = (i + 1).min(bytes.len());
            out.push(Tok::Str(source[start..i].to_string()));
            continue;
        }

        // Number: a digit, a based literal, or a real literal.
        if c.is_ascii_digit() || (c == '\'' && i + 1 < bytes.len() && is_base(bytes[i + 1])) {
            let start = i;
            while i < bytes.len()
                && ((bytes[i] as char).is_ascii_alphanumeric()
                    || bytes[i] == b'\''
                    || bytes[i] == b'_'
                    || bytes[i] == b'.')
            {
                i += 1;
            }
            out.push(Tok::Number(source[start..i].to_string()));
            continue;
        }

        // Identifier or keyword (including `$display`)
        if c == '_' || c == '$' || c.is_ascii_alphabetic() {
            let start = i;
            i += 1;
            while i < bytes.len()
                && (bytes[i] == b'_' || (bytes[i] as char).is_ascii_alphanumeric())
            {
                i += 1;
            }
            out.push(Tok::Ident(source[start..i].to_string()));
            continue;
        }

        let rest = &source[i..];
        if let Some(op) = MULTI.iter().find(|op| rest.starts_with(**op)) {
            out.push(Tok::Sym((*op).to_string()));
            i += op.len();
            continue;
        }

        if "()[]{}:;,=?+-*/%~^&|!<>.@#'".contains(c) {
            out.push(Tok::Sym(c.to_string()));
            i += 1;
            continue;
        }

        return Err(format!("line {}: unexpected character '{}'", line, c));
    }

    Ok(out)
}

fn is_base(b: u8) -> bool {
    matches!(b, b'b' | b'B' | b'o' | b'O' | b'd' | b'D' | b'h' | b'H')
}
