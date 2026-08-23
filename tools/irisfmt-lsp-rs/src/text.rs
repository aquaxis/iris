//! Text utilities: LSP position <-> byte offset, and word scanning.
//!
//! LSP positions are zero-based, with `character` counted in UTF-16 code units.
//! IRIS identifiers are ASCII, but comments and strings may hold multi-byte
//! text, so the conversion counts UTF-16 units rather than bytes.

use lsp_types::Position;

/// Byte offset for an LSP position.
pub fn offset_at(text: &str, pos: Position) -> usize {
    let bytes = text.as_bytes();
    let mut line = 0u32;
    let mut idx = 0usize;
    while line < pos.line && idx < bytes.len() {
        if bytes[idx] == b'\n' {
            line += 1;
        }
        idx += 1;
    }
    let mut u16 = 0u32;
    for ch in text[idx..].chars() {
        if u16 >= pos.character || ch == '\n' {
            break;
        }
        u16 += ch.len_utf16() as u32;
        idx += ch.len_utf8();
    }
    idx
}

/// LSP position for a byte offset.
pub fn position_at(text: &str, offset: usize) -> Position {
    let offset = offset.min(text.len());
    let mut line = 0u32;
    let mut line_start = 0usize;
    for (i, b) in text.as_bytes()[..offset].iter().enumerate() {
        if *b == b'\n' {
            line += 1;
            line_start = i + 1;
        }
    }
    let character = text[line_start..offset]
        .chars()
        .map(|c| c.len_utf16() as u32)
        .sum();
    Position { line, character }
}

fn is_word_byte(b: u8) -> bool {
    b == b'_' || b.is_ascii_alphanumeric()
}

/// The identifier-like word covering a byte offset, as `(word, start, end)`.
pub fn word_at(text: &str, offset: usize) -> Option<(String, usize, usize)> {
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut start = offset.min(n);
    let mut end = offset.min(n);
    while start > 0 && is_word_byte(bytes[start - 1]) {
        start -= 1;
    }
    while end < n && is_word_byte(bytes[end]) {
        end += 1;
    }
    if start == end {
        return None;
    }
    Some((text[start..end].to_string(), start, end))
}

/// The dotted name covering a byte offset: `rf.rdata1` is one name.
pub fn dotted_name_at(text: &str, offset: usize) -> Option<String> {
    let (_, mut start, mut end) = word_at(text, offset)?;
    let bytes = text.as_bytes();
    while start > 0 && bytes[start - 1] == b'.' {
        match word_at(text, start - 2) {
            Some((_, s, _)) => start = s,
            None => break,
        }
    }
    while end < bytes.len() && bytes[end] == b'.' {
        match word_at(text, end + 1) {
            Some((_, _, e)) => end = e,
            None => break,
        }
    }
    Some(text[start..end].to_string())
}

/// Byte ranges of every whole-word occurrence of `word`.
pub fn whole_word_spans(text: &str, word: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < n {
        if is_word_byte(bytes[i]) {
            let start = i;
            while i < n && is_word_byte(bytes[i]) {
                i += 1;
            }
            if &text[start..i] == word {
                out.push((start, i));
            }
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use lsp_types::Position;

    #[test]
    fn offset_position_round_trip() {
        let text = "mod A {\n    let x = 1;\n}\n";
        for off in [0usize, 5, 12, 20, text.len()] {
            let pos = position_at(text, off);
            assert_eq!(offset_at(text, pos), off, "off={off}");
        }
    }

    #[test]
    fn word_at_finds_identifier() {
        let text = "let counter = 1;";
        let (w, s, e) = word_at(text, 6).unwrap();
        assert_eq!(w, "counter");
        assert_eq!(&text[s..e], "counter");
    }

    #[test]
    fn dotted_name_spans_dots() {
        let text = "y = rf.rdata1;";
        assert_eq!(dotted_name_at(text, 8).as_deref(), Some("rf.rdata1"));
    }

    #[test]
    fn whole_word_is_not_substring() {
        let text = "count count_r count";
        // "count" occurs twice as a whole word, not inside "count_r".
        assert_eq!(whole_word_spans(text, "count").len(), 2);
        assert_eq!(whole_word_spans(text, "count_r").len(), 1);
    }

    #[test]
    fn utf16_columns_for_multibyte_lines() {
        // A comment with a multi-byte character before an identifier.
        let text = "// あ x\nlet y = 1;";
        let pos = position_at(text, text.find('y').unwrap());
        assert_eq!(offset_at(text, pos), text.find('y').unwrap());
    }
}
