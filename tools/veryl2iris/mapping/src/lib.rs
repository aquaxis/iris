//! What corresponds between Veryl and IRIS, and what does not.
//!
//! Both converters depend on this crate and nothing else in common. It has no
//! dependencies of its own so that neither direction drags the other's parser
//! along.
//!
//! ## What corresponds to what, and what does not
//!
//! **Both directions read this table and nothing else.**
//!
//! Two converters holding two tables drift. One would map
//! `always_ff (clk)` onto `sync(clk.posedge)` while the other mapped
//! `sync(clk.posedge)` back onto `always_ff (clk, rst)`, and the round trip
//! would not close. Keeping a single table makes that impossible rather than
//! merely unlikely.
//!
//! The verdicts come from comparing `tools/veryl.ebnf` against
//! `tools/iris.ebnf` and from rewriting real designs by hand; the record is in
//! `report_veryl.md`.

pub mod diag;

use std::fmt;

/// What can be done with one construct.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Meaning is preserved in both directions.
    Exact,
    /// A counterpart exists but something is lost or restructured. The
    /// difference is stated before converting, never after.
    Lossy,
    /// No counterpart. Refused with a source position, never dropped.
    Unsupported,
}

impl fmt::Display for Verdict {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Verdict::Exact => write!(f, "exact"),
            Verdict::Lossy => write!(f, "lossy"),
            Verdict::Unsupported => write!(f, "unsupported"),
        }
    }
}

/// Which language a construct is being read from. A few entries only arise in
/// one direction: IRIS has `fsm`, Veryl has `bind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Veryl,
    Iris,
    Both,
}

/// One construct and what becomes of it.
#[derive(Clone, Copy, Debug)]
pub struct Mapping {
    /// How the construct is written in Veryl, or a description if it has none.
    pub veryl: &'static str,
    /// How it is written in IRIS, or a description if it has none.
    pub iris: &'static str,
    pub verdict: Verdict,
    /// The direction this entry can arise in.
    pub side: Side,
    /// For `Lossy`, what is lost. For `Unsupported`, why there is no
    /// counterpart. Empty for `Exact`.
    pub note: &'static str,
}

/// The table. Every entry is covered by a test in `tests/mapping.rs`, and a
/// test there fails if this table grows an entry that no test names.
pub const MAPPINGS: &[Mapping] = &[
    // ---- structure ----
    m("module", "mod", Verdict::Exact, Side::Both, ""),
    m("input / output / inout port", "in / out / inout port", Verdict::Exact, Side::Both, ""),
    m("inst", "inst", Verdict::Exact, Side::Both, ""),
    m("always_comb", "comb", Verdict::Exact, Side::Both, ""),
    m("always_ff", "sync", Verdict::Exact, Side::Both, ""),
    m("assign", "assignment inside comb", Verdict::Exact, Side::Both, ""),
    m("function", "fn", Verdict::Exact, Side::Both, ""),
    m("import", "import", Verdict::Exact, Side::Both, ""),
    // ---- declarations ----
    m("let", "let", Verdict::Exact, Side::Both, ""),
    m("var", "var", Verdict::Exact, Side::Both, ""),
    m("const", "const", Verdict::Exact, Side::Both, ""),
    m("type", "type", Verdict::Exact, Side::Both, ""),
    m("enum", "enum", Verdict::Exact, Side::Both, ""),
    m("struct / union", "struct / union", Verdict::Exact, Side::Both, ""),
    // ---- types ----
    m("logic", "bit", Verdict::Exact, Side::Both, ""),
    m("logic<N>", "bit[N]", Verdict::Exact, Side::Both, ""),
    m("u8 .. u64", "uint[N]", Verdict::Exact, Side::Both, ""),
    m("i8 .. i64", "int[N]", Verdict::Exact, Side::Both, ""),
    m("signed logic<N>", "int[N]", Verdict::Exact, Side::Both, ""),
    m("string", "string", Verdict::Exact, Side::Both, ""),
    m("clock", "clock", Verdict::Exact, Side::Both, ""),
    m("reset", "reset", Verdict::Exact, Side::Both, ""),
    // ---- expressions ----
    m("case expression", "match expression", Verdict::Exact, Side::Both, ""),
    m("if c ? x : y", "if c { x } else { y }", Verdict::Exact, Side::Both, ""),
    m("<:", "<", Verdict::Exact, Side::Both, ""),
    m("{a repeat n}", "{n{a}}", Verdict::Exact, Side::Both, ""),
    m("{a[w-1] repeat n, a}", "a.sign_extend[N]()", Verdict::Exact, Side::Both,
      "the cast is not the counterpart: `a as i32` emits `int'(a)`, which \
       zero-extends an unsigned operand, while IRIS emits `32'($signed(a))`; \
       repeating the sign bit says the same thing in both languages"),
    m(">>> << >>", ">>> << >>", Verdict::Exact, Side::Both, ""),
    // ---- interfaces ----
    m("interface", "interface", Verdict::Exact, Side::Both, ""),
    m(
        "modport with a direction per signal",
        "view with a direction per signal",
        Verdict::Exact,
        Side::Both,
        "",
    ),
    // ---- lossy ----
    m(
        "switch expression",
        "chain of if",
        Verdict::Lossy,
        Side::Veryl,
        "a subject-less multiway choice becomes nested conditionals; the shape changes",
    ),
    m(
        "+= -= *= and the other compound assignments",
        "a = a + b",
        Verdict::Lossy,
        Side::Veryl,
        "expanded to an ordinary assignment; the shape changes",
    ),
    m(
        "msb / lsb",
        "width-1 / 0",
        Verdict::Lossy,
        Side::Veryl,
        "expanded to an expression; a later width change no longer follows automatically",
    ),
    m(
        "initial inside a module",
        "initial, but only inside test",
        Verdict::Lossy,
        Side::Veryl,
        "IRIS allows initial only in a test module, so the block changes scope",
    ),
    m(
        "bbool / lbool",
        "bool",
        Verdict::Lossy,
        Side::Veryl,
        "IRIS has one boolean type, so the distinction between the two is lost",
    ),
    m(
        "array declaration",
        "mem with ram/rom/read_mode/init_file",
        Verdict::Lossy,
        Side::Iris,
        "Veryl has arrays but no memory configuration, so the settings are lost",
    ),
    // ---- unsupported, Veryl side ----
    m("f32 / f64", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no floating point type and no real literal"),
    m("p8 .. p64", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no corresponding fixed-point type"),
    m("real literal such as 1.5", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "an IRIS literal is integer, boolean or string only"),
    m("tri", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no tri-state; inout is a different thing"),
    m("bind", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no construct that binds to an existing instance from outside"),
    m("connect", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no construct that joins two interfaces"),
    m("generate if", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no conditional structural generation"),
    m("generate block", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no named generate block"),
    m("alias", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no module aliasing"),
    m("final", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no end-of-simulation block"),
    m("unsafe", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS has no counterpart"),
    m("modport .. / same / converse", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "an IRIS view has neither a default direction nor reversal"),
    m("range pattern", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "an IRIS match pattern has no range form"),
    m("step in a part select", "no counterpart", Verdict::Unsupported, Side::Veryl,
      "IRIS part selects are +: and -: only"),
    // ---- unsupported, IRIS side ----
    m("no counterpart", "fsm", Verdict::Unsupported, Side::Iris,
      "Veryl has no state machine construct"),
    m("no counterpart", "constraint", Verdict::Unsupported, Side::Iris,
      "Veryl has no constraint blocks"),
    m("no counterpart", "rand", Verdict::Unsupported, Side::Iris,
      "Veryl has no randomised declarations"),
    m("no counterpart", "assert / cover", Verdict::Unsupported, Side::Iris,
      "Veryl has no verification statements"),
];

// The entry that used to sit here read:
//
//     cast `as` <-> sign_extend / extend / truncate   Unsupported
//     "Veryl widens with a cast rather than a method; whether the two agree
//      on sign and width has not been checked"
//
// It was then checked, and the two do not agree: `x as i32` emits
// `int'(x)`, which zero-extends an unsigned operand, while IRIS emits
// `32'($signed(x))`, which replicates the sign bit. The cast is the wrong
// counterpart. But `{x[w-1] repeat n, x}` is available in Veryl and
// `{n{x[w-1]}}` in IRIS, so a sign extension crosses exactly, and the entry
// moved up to the concatenation row. An unchecked note had stood in for a
// measurement, and it was wrong.

const fn m(
    veryl: &'static str,
    iris: &'static str,
    verdict: Verdict,
    side: Side,
    note: &'static str,
) -> Mapping {
    Mapping { veryl, iris, verdict, side, note }
}

/// The common subset: what round-trips with its meaning intact.
pub fn exact() -> impl Iterator<Item = &'static Mapping> {
    MAPPINGS.iter().filter(|m| m.verdict == Verdict::Exact)
}

/// Entries that convert but lose something.
pub fn lossy() -> impl Iterator<Item = &'static Mapping> {
    MAPPINGS.iter().filter(|m| m.verdict == Verdict::Lossy)
}

/// Entries with no counterpart, which are refused.
pub fn unsupported() -> impl Iterator<Item = &'static Mapping> {
    MAPPINGS.iter().filter(|m| m.verdict == Verdict::Unsupported)
}

/// Look up a Veryl construct by the name this table uses.
pub fn by_veryl(name: &str) -> Option<&'static Mapping> {
    MAPPINGS.iter().find(|m| m.veryl == name)
}

/// Look up an IRIS construct by the name this table uses.
pub fn by_iris(name: &str) -> Option<&'static Mapping> {
    MAPPINGS.iter().find(|m| m.iris == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_states_a_reason_unless_it_is_exact() {
        // A Lossy or Unsupported entry with no note cannot produce a useful
        // diagnostic, which is the whole job of those two verdicts.
        for entry in MAPPINGS {
            match entry.verdict {
                Verdict::Exact => {}
                _ => assert!(
                    !entry.note.is_empty(),
                    "{} -> {} is {} with no reason given",
                    entry.veryl,
                    entry.iris,
                    entry.verdict
                ),
            }
        }
    }

    #[test]
    fn the_table_has_all_three_verdicts() {
        // A table that had drifted to all-Exact would pass every conversion
        // test while being wrong about the languages.
        assert!(exact().count() > 0);
        assert!(lossy().count() > 0);
        assert!(unsupported().count() > 0);
    }

    #[test]
    fn unsupported_entries_name_the_side_they_come_from() {
        for entry in unsupported() {
            assert_ne!(
                entry.side,
                Side::Both,
                "{} -> {}: an unsupported construct exists in one language only",
                entry.veryl,
                entry.iris
            );
        }
    }
}
