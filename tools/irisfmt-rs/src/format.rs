//! Re-emit an IRIS token stream with canonical whitespace.
//!
//! IRIS is delimited by braces, semicolons and commas, not by layout, so
//! re-spacing the tokens keeps the same program. Comments are carried through;
//! a line comment always ends its line so nothing is swallowed by it.

use crate::lexer::Tok;

pub fn format_tokens(tokens: &[Tok]) -> String {
    let mut out = String::new();
    let mut indent: usize = 0;
    let mut line_start = true; // nothing on the current line yet

    for (i, tok) in tokens.iter().enumerate() {
        let prev = if i == 0 { None } else { Some(&tokens[i - 1]) };

        // A closing brace dedents before it is placed.
        if is_sym(tok, "}") {
            indent = indent.saturating_sub(1);
        }

        if break_before(prev, tok) {
            out.push('\n');
            out.push_str(&"    ".repeat(indent));
        } else if !line_start && space_before(prev, tok) {
            out.push(' ');
        }

        out.push_str(&text(tok));
        line_start = false;

        // Structural updates after the token. `{` increments the indent; the
        // newline itself is emitted by the following token's break_before.
        match tok {
            Tok::Sym(s) if s == "{" => indent += 1,
            _ => {}
        }
    }

    // End with exactly one newline.
    while out.ends_with('\n') {
        out.pop();
    }
    out.push('\n');
    out
}

/// Whether a newline (and indentation) precedes this token.
fn break_before(prev: Option<&Tok>, cur: &Tok) -> bool {
    let Some(prev) = prev else {
        return false;
    };
    // A closing brace goes on its own line.
    if is_sym(cur, "}") {
        return true;
    }
    match prev {
        // A comment always ends its line.
        Tok::LineComment(_) | Tok::DocComment(_) => true,
        // A multi-line block comment ends its line too.
        Tok::BlockComment(s) if s.contains('\n') => true,
        Tok::Sym(s) if s == ";" || s == "{" => true,
        // After `}`, start a new line unless a small follower hugs it.
        Tok::Sym(s) if s == "}" => {
            !matches!(cur, Tok::Sym(t) if t == ";" || t == "," || t == ")")
                && !is_ident(cur, "else")
        }
        _ => false,
    }
}

/// Whether a single space precedes this token (when not breaking).
fn space_before(prev: Option<&Tok>, cur: &Tok) -> bool {
    let Some(prev) = prev else {
        return false;
    };
    // Tight closers and separators (`name: type` keeps the colon tight-left).
    if is_any_sym(cur, &[";", ",", ")", "]", ".", ":"]) || is_sym(cur, "::") {
        return false;
    }
    // Tight openers.
    if is_any_sym(prev, &["(", "["]) || is_sym(prev, ".") || is_sym(prev, "::") {
        return false;
    }
    // A postfix `[` hugs what it indexes: `a[i]`, `bit[8]`, `x()[0]`.
    if is_sym(cur, "[") && (is_ident_any(prev) || is_number(prev) || is_any_sym(prev, &[")", "]"]))
    {
        return false;
    }
    // A call hugs its `(`: `f(...)`, `x()(y)` — but a keyword takes a space.
    if is_sym(cur, "(")
        && (is_number(prev) || is_any_sym(prev, &[")", "]"]))
    {
        return false;
    }
    if is_sym(cur, "(") && is_ident_any(prev) {
        return is_keyword_before_paren(prev);
    }
    true
}

fn is_keyword_before_paren(t: &Tok) -> bool {
    matches!(t, Tok::Ident(s) if matches!(s.as_str(),
        "if" | "match" | "sync" | "for" | "while" | "return" | "assert" | "when"))
}

fn text(t: &Tok) -> String {
    match t {
        Tok::DocComment(s)
        | Tok::LineComment(s)
        | Tok::BlockComment(s)
        | Tok::Ident(s)
        | Tok::Number(s)
        | Tok::Str(s)
        | Tok::Sym(s) => s.clone(),
    }
}

fn is_sym(t: &Tok, s: &str) -> bool {
    matches!(t, Tok::Sym(x) if x == s)
}

fn is_any_sym(t: &Tok, syms: &[&str]) -> bool {
    matches!(t, Tok::Sym(x) if syms.contains(&x.as_str()))
}

fn is_ident(t: &Tok, name: &str) -> bool {
    matches!(t, Tok::Ident(x) if x == name)
}

fn is_ident_any(t: &Tok) -> bool {
    matches!(t, Tok::Ident(_))
}

fn is_number(t: &Tok) -> bool {
    matches!(t, Tok::Number(_))
}
