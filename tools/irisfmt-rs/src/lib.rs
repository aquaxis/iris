//! Rust port of the TypeScript `irisfmt` formatter.
//!
//! The formatter lexes IRIS (keeping comments), checks that the source parses
//! with the shared `iris-sim` parser, and re-emits the token stream with
//! canonical whitespace. Because IRIS is not layout-sensitive, re-spacing the
//! same tokens yields the same program.

mod format;
mod lexer;
pub mod lint;

pub use format::format_tokens;
pub use lexer::{lex, Tok};
pub use lint::{lint_src, Diagnostic, Severity};

/// Format IRIS source. Returns an error if the source does not lex or parse,
/// so a caller can leave an unparseable file untouched.
pub fn format_src(source: &str) -> Result<String, String> {
    let tokens = lex(source)?;

    // Validate against the real parser: never rewrite something we can't parse.
    let parser = iris_sim::parser::Parser::new();
    parser
        .parse_all(source)
        .map_err(|e| format!("parse error: {e}"))?;

    Ok(format_tokens(&tokens))
}
