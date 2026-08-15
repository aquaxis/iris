//! Diagnostics carrying a source position.
//!
//! The point of this tool is not the conversion; it is refusing to convert
//! quietly. Two precedents sit behind that:
//!
//! `veryl translate` drops assignments from SystemVerilog even with
//! `--strict` (27 became 1 in one design). And `iris-sim` used to accept a
//! type name that did not exist, silently making it one bit.
//!
//! A converter that inherits either habit produces a design that builds,
//! simulates, reports success, and is wrong.

use std::fmt;

use crate::{Mapping, Verdict};

/// Where in the source a diagnostic points.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
}

impl fmt::Display for Position {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.line, self.column)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// The construct was converted, but something changed.
    Warning,
    /// The construct was not converted. The run fails.
    Error,
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Level::Warning => write!(f, "warning"),
            Level::Error => write!(f, "error"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub level: Level,
    pub file: String,
    pub position: Position,
    pub message: String,
    /// What was lost, or why there is no counterpart.
    pub note: Option<String>,
}

impl Diagnostic {
    /// A construct with no counterpart. The conversion fails.
    pub fn unsupported(file: &str, position: Position, entry: &Mapping, wrote: &str) -> Self {
        Diagnostic {
            level: Level::Error,
            file: file.to_string(),
            position,
            message: format!("{} has no counterpart in the target language", wrote),
            note: Some(entry.note.to_string()),
        }
    }

    /// A construct that converts with a difference. The conversion continues.
    pub fn lossy(file: &str, position: Position, entry: &Mapping, wrote: &str) -> Self {
        Diagnostic {
            level: Level::Warning,
            file: file.to_string(),
            position,
            message: format!("{} does not convert exactly", wrote),
            note: Some(entry.note.to_string()),
        }
    }

    /// A construct this converter has not implemented.
    ///
    /// **This is not the same as [`Self::unsupported`].** That one says the
    /// target language cannot express the construct; this one says the tool
    /// cannot yet write it. Both refuse, because emitting something wrong is
    /// worse than emitting nothing, but they are different facts and a reader
    /// deciding whether to wait or to rewrite needs to know which applies.
    pub fn unimplemented(file: &str, position: Position, what: &str, note: &str) -> Self {
        Diagnostic {
            level: Level::Error,
            file: file.to_string(),
            position,
            message: format!("{} is not implemented by this converter yet", what),
            note: Some(note.to_string()),
        }
    }

    /// Build the diagnostic a mapping calls for, if it calls for one.
    pub fn for_mapping(file: &str, position: Position, entry: &Mapping, wrote: &str) -> Option<Self> {
        match entry.verdict {
            Verdict::Exact => None,
            Verdict::Lossy => Some(Self::lossy(file, position, entry, wrote)),
            Verdict::Unsupported => Some(Self::unsupported(file, position, entry, wrote)),
        }
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}: {}: {}",
            self.file, self.position, self.level, self.message
        )?;
        if let Some(note) = &self.note {
            write!(f, "\n  note: {}", note)?;
        }
        Ok(())
    }
}

/// Everything one conversion had to say.
#[derive(Clone, Debug, Default)]
pub struct Report {
    pub diagnostics: Vec<Diagnostic>,
}

impl Report {
    pub fn push(&mut self, diagnostic: Diagnostic) {
        self.diagnostics.push(diagnostic);
    }

    pub fn extend(&mut self, other: Report) {
        self.diagnostics.extend(other.diagnostics);
    }

    /// Whether anything was refused. A conversion with errors produces no
    /// output: half a design is worse than none, because it looks whole.
    pub fn failed(&self) -> bool {
        self.diagnostics.iter().any(|d| d.level == Level::Error)
    }

    pub fn is_empty(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, d) in self.diagnostics.iter().enumerate() {
            if i > 0 {
                writeln!(f)?;
            }
            write!(f, "{}", d)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate as mapping;

    #[test]
    fn an_unsupported_construct_fails_the_run() {
        let entry = mapping::unsupported().next().expect("table has one");
        let mut report = Report::default();
        report.push(Diagnostic::unsupported(
            "a.veryl",
            Position { line: 3, column: 7 },
            entry,
            "f32",
        ));
        assert!(report.failed());
    }

    #[test]
    fn a_lossy_construct_does_not_fail_the_run() {
        let entry = mapping::lossy().next().expect("table has one");
        let mut report = Report::default();
        report.push(Diagnostic::lossy(
            "a.veryl",
            Position { line: 1, column: 1 },
            entry,
            "switch",
        ));
        assert!(!report.failed());
        assert!(!report.is_empty());
    }

    #[test]
    fn a_diagnostic_names_the_place() {
        let entry = mapping::unsupported().next().expect("table has one");
        let text = Diagnostic::unsupported(
            "alu.veryl",
            Position { line: 21, column: 18 },
            entry,
            "f32",
        )
        .to_string();
        assert!(text.contains("alu.veryl:21:18"), "{}", text);
        assert!(text.contains("error"), "{}", text);
    }

    #[test]
    fn a_tool_limit_reads_differently_from_a_language_limit() {
        // Conflating the two would tell a reader to rewrite their design when
        // the tool merely has not caught up, or the reverse.
        let entry = mapping::unsupported().next().expect("table has one");
        let language = Diagnostic::unsupported("a.iris", Position::default(), entry, "fsm")
            .to_string();
        let tool = Diagnostic::unimplemented("a.iris", Position::default(), "mem", "arrays exist")
            .to_string();
        assert!(language.contains("no counterpart in the target language"), "{}", language);
        assert!(tool.contains("not implemented by this converter"), "{}", tool);
    }

    #[test]
    fn an_exact_mapping_produces_no_diagnostic() {
        let entry = mapping::exact().next().expect("table has one");
        assert!(Diagnostic::for_mapping("a.veryl", Position::default(), entry, "module").is_none());
    }
}
