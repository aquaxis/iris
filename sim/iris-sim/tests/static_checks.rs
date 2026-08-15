//! Tests for the static checks defined by the specification
//!
//! Generic parameter constraints (spec 3.3.3, reported as O1005), `match`
//! exhaustiveness (spec 5.6.2), and the restriction of verification-only system
//! functions to verification contexts (spec 3.3.4).

use iris_sim::check::{check_project, has_errors, Diagnostic, Severity};
use iris_sim::parser::Parser;
use iris_sim::project::Project;

/// Parse, elaborate, and run the static checks
fn check(source: &str, top: &str) -> Vec<Diagnostic> {
    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");

    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.enums {
        project.enums.insert(decl.name.clone(), decl);
    }
    for interface in result.interfaces {
        project.interfaces.insert(interface.name.clone(), interface);
    }
    for decl in result.structs {
        project.structs.insert(decl.name.clone(), decl);
    }
    project.set_top(top).expect("top module should exist");
    project.elaborate();

    check_project(&project)
}

fn codes(diagnostics: &[Diagnostic]) -> Vec<&'static str> {
    diagnostics.iter().map(|d| d.code).collect()
}

const COUNTER_WITH_BOUNDS: &str = "
    mod Counter[Width: uint = 8]
    where
        Width >= 1,
        Width <= 32,
    (
        in  clk: clock,
        in  rst_n: reset(active_low: true),
        out q: bit[Width],
    ) {
        var c: bit[Width] = 0;
        sync(clk.posedge, rst_n.async) { c = c + 1; }
        comb { q = c; }
    }

    test CtrTB {
        let clk: clock(period: 10ns);
        let rst_n: reset(active_low: true);
        inst cnt = Counter[Width: WIDTH] { clk: clk, rst_n: rst_n };
    }";

#[test]
fn a_violated_generic_constraint_is_reported() {
    let source = COUNTER_WITH_BOUNDS.replace("WIDTH", "64");
    let diagnostics = check(&source, "CtrTB");

    assert_eq!(codes(&diagnostics), vec!["O1005"]);
    assert!(has_errors(&diagnostics), "a violated constraint is an error");
    assert!(
        diagnostics[0].message.contains("Width=64"),
        "the reported value should be the one actually passed: {}",
        diagnostics[0].message
    );
    assert!(
        diagnostics[0].notes.iter().any(|n| n.contains("Width <= 32")),
        "the note should list the declared constraints"
    );
}

#[test]
fn a_satisfied_generic_constraint_is_silent() {
    let source = COUNTER_WITH_BOUNDS.replace("WIDTH", "16");
    let diagnostics = check(&source, "CtrTB");
    assert!(
        diagnostics.is_empty(),
        "a legal width should produce nothing: {:?}",
        codes(&diagnostics)
    );
}

#[test]
fn constraints_are_checked_per_instance() {
    // The same module instantiated legally and illegally
    let source = "
        mod Sized[W: uint = 8]
        where
            W <= 16,
        (
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out q: bit[W],
        ) {
            var c: bit[W] = 0;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb { q = c; }
        }

        test TwoTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            inst ok = Sized[W: 8] { clk: clk, rst_n: rst_n };
            inst bad = Sized[W: 32] { clk: clk, rst_n: rst_n };
        }";

    let diagnostics = check(source, "TwoTB");
    assert_eq!(codes(&diagnostics), vec!["O1005"], "only the illegal one");
    assert!(diagnostics[0].message.contains("W=32"));
}

#[test]
fn a_non_exhaustive_match_is_an_error() {
    let source = "
        mod M(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var sel: bit[2] = 0;
            var v: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { sel = sel + 1; }
            comb {
                match sel {
                    0 => { v = 1; },
                    1 => { v = 2; },
                }
                y = v;
            }
        }";

    let diagnostics = check(source, "M");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(
        diagnostics[0].notes.iter().any(|n| n.contains("2, 3")),
        "the uncovered values should be listed: {:?}",
        diagnostics[0].notes
    );
}

#[test]
fn a_wildcard_arm_makes_a_match_exhaustive() {
    let source = "
        mod M(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var sel: bit[2] = 0;
            var v: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { sel = sel + 1; }
            comb {
                match sel {
                    0 => { v = 1; },
                    _ => { v = 9; },
                }
                y = v;
            }
        }";

    assert!(check(source, "M").is_empty());
}

#[test]
fn listing_every_value_is_also_exhaustive() {
    let source = "
        mod M(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var sel: bit[2] = 0;
            var v: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { sel = sel + 1; }
            comb {
                match sel {
                    0 => { v = 1; },
                    1 => { v = 2; },
                    2 => { v = 3; },
                    3 => { v = 4; },
                }
                y = v;
            }
        }";

    assert!(check(source, "M").is_empty());
}

#[test]
fn a_wide_match_without_a_wildcard_only_warns() {
    // Spec 5.6.2 asks for a `_` arm rather than sixteen or more arms
    let source = "
        mod W(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var sel: bit[4] = 0;
            var v: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { sel = sel + 1; }
            comb {
                match sel {
                    0 => { v = 1; },
                    1 => { v = 2; },
                }
                y = v;
            }
        }";

    let diagnostics = check(source, "W");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert!(
        !has_errors(&diagnostics),
        "a warning must not stop the simulation"
    );
}

#[test]
fn match_expressions_are_checked_too() {
    let source = "
        mod E(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var op: bit[2] = 0;
            var a: bit[8] = 3;
            sync(clk.posedge, rst_n.async) { op = op + 1; }
            comb {
                y = match op {
                    2'b00 => a,
                    2'b01 => a + 1,
                };
            }
        }";

    let diagnostics = check(source, "E");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
}

#[test]
fn verification_functions_are_rejected_in_synthesizable_logic() {
    let source = "
        mod D(in clk: clock, in rst_n: reset(active_low: true), out y: bit[8]) {
            var c: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {
                c = c + 1;
                $display(\"c = %d\", c);
            }
            comb { y = c; }
        }";

    let diagnostics = check(source, "D");
    assert_eq!(codes(&diagnostics), vec!["O7009"]);
    assert!(diagnostics[0].message.contains("$display"));
}

#[test]
fn verification_functions_are_allowed_in_a_test_module() {
    let source = "
        test T {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var c: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {
                c = c + 1;
                $display(\"c = %d\", c);
                if c == 3 { $finish; }
            }
        }";

    assert!(
        check(source, "T").is_empty(),
        "a test module is a verification context"
    );
}

#[test]
fn synthesizable_system_functions_are_allowed_anywhere() {
    // $clog2 and $bits are synthesizable, so they carry no context restriction
    let source = "
        mod S[Depth: uint = 16](
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out n: bit[8],
        ) {
            comb { n = $clog2(Depth); }
        }";

    assert!(check(source, "S").is_empty());
}

#[test]
fn the_shipped_example_is_clean() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../example/async_fifo/src");
    let design = std::fs::read_to_string(format!("{}/async_fifo.iris", dir)).unwrap();
    let testbench = std::fs::read_to_string(format!("{}/async_fifo_tb.iris", dir)).unwrap();

    let diagnostics = check(&format!("{}\n{}", design, testbench), "AsyncFifoTB");
    assert!(
        diagnostics.is_empty(),
        "the example should pass every static check: {:?}",
        diagnostics
            .iter()
            .map(|d| (d.code, &d.message))
            .collect::<Vec<_>>()
    );
}

#[test]
fn a_slice_bound_that_varies_at_run_time_is_rejected() {
    // Two varying bounds would give the slice no fixed width
    let source = "
        mod S(in clk: clock, in rst_n: reset(active_low: true), out y: bit[4]) {
            var c: bit[8] = 0;
            var i: bit[3] = 0;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb { y = c[i + 3 : i]; }
        }";

    let diagnostics = check(source, "S");
    assert!(
        diagnostics.iter().all(|d| d.code == "O2007"),
        "expected only slice-bound diagnostics: {:?}",
        codes(&diagnostics)
    );
    assert_eq!(diagnostics.len(), 2, "one for each bound");
    assert!(diagnostics[0]
        .help
        .as_deref()
        .unwrap_or_default()
        .contains("part select"));
}

#[test]
fn a_part_select_accepts_a_varying_index() {
    let source = "
        mod P(in clk: clock, in rst_n: reset(active_low: true), out y: bit[4]) {
            var c: bit[8] = 0;
            var i: bit[3] = 0;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb { y = c[i +: 4]; }
        }";

    assert!(check(source, "P").is_empty());
}

#[test]
fn a_generic_module_is_checked_after_elaboration() {
    // The unspecialized template still mentions Depth in its slice bounds;
    // only the elaborated copy should be checked
    let source = "
        mod Sys[Depth: uint = 64](
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out addr: bit[$clog2(Depth)],
        ) {
            var c: bit[$clog2(Depth) + 1] = 0;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb { addr = c[$clog2(Depth) - 1 : 0]; }
        }";

    let diagnostics = check(source, "Sys");
    assert!(
        diagnostics.is_empty(),
        "a generic design should not trip on its own unresolved template: {:?}",
        codes(&diagnostics)
    );
}

#[test]
fn a_bit_field_target_must_have_a_constant_width() {
    let source = "
        mod B(in clk: clock, in rst_n: reset(active_low: true), out o: bit[16]) {
            var r: bit[16] = 0;
            var w: bit[4] = 4;
            sync(clk.posedge, rst_n.async) { r[w +: w] = 3; }
            comb { o = r; }
        }";

    let diagnostics = check(source, "B");
    assert_eq!(codes(&diagnostics), vec!["O2007"]);
    assert!(diagnostics[0].message.contains("width"));
}

#[test]
fn a_bit_field_target_may_have_a_varying_position() {
    let source = "
        mod P(in clk: clock, in rst_n: reset(active_low: true), out o: bit[16]) {
            var r: bit[16] = 0;
            var pos: bit[4] = 4;
            sync(clk.posedge, rst_n.async) { r[pos +: 4] = 3; }
            comb { o = r; }
        }";

    assert!(check(source, "P").is_empty());
}

/// The three constraint forms of `tools/iris.ebnf`, in one module
const ALL_CONSTRAINT_FORMS: &str = "
    mod Buf[DataWidth: uint = 8, Depth: uint = 16]
    where Depth.is_power_of_two(), Depth >= 4, DataWidth: uint (
        in  clk: clock,
        in  rst_n: reset(active_low: true),
        in  d: bit[DataWidth],
        out q: bit[DataWidth],
    ) {
        var v: bit[DataWidth] = 0;
        sync(clk.posedge, rst_n.async) { v = d; }
        comb { q = v; }
    }

    test BufTB {
        let clk: clock(period: 10ns);
        let rst_n: reset(active_low: true);
        var d: bit[8] = 8'h5a;
        inst b = Buf[Depth: DEPTH] { clk: clk, rst_n: rst_n, d: d };
    }";

#[test]
fn every_constraint_form_is_accepted_when_satisfied() {
    let diagnostics = check(&ALL_CONSTRAINT_FORMS.replace("DEPTH", "8"), "BufTB");
    assert!(
        diagnostics.is_empty(),
        "a depth of 8 satisfies all three forms, got {:?}",
        codes(&diagnostics)
    );
}

#[test]
fn a_predicate_constraint_is_checked() {
    // 12 is at least 4, but it is not a power of two
    let diagnostics = check(&ALL_CONSTRAINT_FORMS.replace("DEPTH", "12"), "BufTB");
    assert_eq!(codes(&diagnostics), vec!["O1005"]);
    assert!(
        diagnostics[0].message.contains("is_power_of_two"),
        "the message should name the predicate, got {:?}",
        diagnostics[0].message
    );
}

#[test]
fn an_unknown_predicate_is_reported() {
    let source = "
        mod M[Depth: uint = 8] where Depth.is_prime() (
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out q: bit,
        ) {
            comb { q = 1; }
        }

        test MTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            inst m = M { clk: clk, rst_n: rst_n };
        }";
    let diagnostics = check(source, "MTB");
    assert_eq!(codes(&diagnostics), vec!["O1005"]);
    assert!(
        diagnostics[0].message.contains("unknown constraint predicate"),
        "got {:?}",
        diagnostics[0].message
    );
}

#[test]
fn a_type_bound_constraint_is_checked() {
    // The parameter is declared `uint`, so a bound of `bool` cannot hold
    let source = "
        mod M[Depth: uint = 8] where Depth: bool (
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out q: bit,
        ) {
            comb { q = 1; }
        }

        test MTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            inst m = M { clk: clk, rst_n: rst_n };
        }";
    let diagnostics = check(source, "MTB");
    assert_eq!(codes(&diagnostics), vec!["O1005"]);
    assert!(
        diagnostics[0].message.contains("declared"),
        "got {:?}",
        diagnostics[0].message
    );
}

#[test]
fn exhaustiveness_is_checked_on_an_expression_too() {
    // The scrutinee is not a bare signal, so the width has to be inferred
    let source = "
        mod M(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  a: bit[2],
            in  b: bit[2],
            out y: bit[8],
        ) {
            var out_v: bit[8] = 0;
            comb {
                match a & b {
                    2'b00 => { out_v = 1; },
                    2'b01 => { out_v = 2; },
                }
                y = out_v;
            }
        }";
    let diagnostics = check(source, "M");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
    assert!(
        diagnostics[0].message.contains("bit[2]"),
        "the inferred width should be reported, got {:?}",
        diagnostics[0].message
    );
}

#[test]
fn a_width_reached_through_an_instance_is_judged() {
    // `dut.count` reaches into another module; its width is still knowable
    let source = "
        mod Sub(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out count: bit[2],
        ) {
            var c: bit[2] = 0;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb { count = c; }
        }

        test T {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var out_v: bit[8] = 0;
            inst dut = Sub { clk: clk, rst_n: rst_n };
            comb {
                match dut.count {
                    2'b00 => { out_v = 1; },
                    2'b01 => { out_v = 2; },
                }
            }
        }";
    let diagnostics = check(source, "T");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
    assert!(
        diagnostics[0].message.contains("bit[2]"),
        "got {:?}",
        diagnostics[0].message
    );

    let complete = source.replace(
        "2'b01 => { out_v = 2; },",
        "2'b01 => { out_v = 2; }, _ => { out_v = 3; },",
    );
    assert!(check(&complete, "T").is_empty(), "a wildcard covers the rest");
}

#[test]
fn a_match_on_an_enum_is_judged_by_its_variants() {
    // Three variants in a two-bit encoding: covering all three is exhaustive,
    // even though a bit[2] would need four values
    let source = "
        enum Colour { Red, Green, Blue }

        mod M(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out y: bit[8],
        ) {
            var c: Colour = Colour::Red;
            var out_v: bit[8] = 0;
            comb {
                match c {
                    Colour::Red => { out_v = 10; },
                    Colour::Green => { out_v = 20; },
                    Colour::Blue => { out_v = 30; },
                }
                y = out_v;
            }
        }";
    assert!(
        check(source, "M").is_empty(),
        "covering every variant is exhaustive"
    );

    let missing = source.replace("Colour::Blue => { out_v = 30; },", "");
    let diagnostics = check(&missing, "M");
    assert_eq!(codes(&diagnostics), vec!["O2006"]);
    assert!(
        diagnostics[0].message.contains("enum Colour"),
        "got {:?}",
        diagnostics[0].message
    );
}


#[test]
fn an_extern_instance_is_reported_but_does_not_stop_the_run() {
    let source = "
        extern mod legacy_uart(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  tx_data: bit[8],
            out tx: bit,
        );

        test UartTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var d: bit[8] = 8'h41;
            inst u = legacy_uart { clk: clk, rst_n: rst_n, tx_data: d };
        }";
    let diagnostics = check(source, "UartTB");
    assert_eq!(codes(&diagnostics), vec!["O1007"]);
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert!(!has_errors(&diagnostics), "a black box does not stop the run");
}

/// A slice bound written `32'(W - 1)` is still fixed at elaboration, so the
/// width methods of spec 3.4.2 have to fold like any other constant. The folder
/// stopped at a method call, so the bound was left unfolded and the slice was
/// rejected as varying at run time.
#[test]
fn a_width_method_keeps_a_slice_bound_constant() {
    let diagnostics = check(
        "mod SliceTest[W: uint = 8](
            in  clk: clock,
            in  a: bit[16],
            out y: bit[8],
        ) {
            comb { y = a[(W - 1).truncate(32):0]; }
        }",
        "SliceTest",
    );

    assert!(
        !codes(&diagnostics).contains(&"O2007"),
        "a constant slice bound should not be reported as varying: {:?}",
        diagnostics
    );
}

// ---------------------------------------------------------------------------
// O1008: a type name that nothing declares
//
// An unresolved name reaches the simulator as an unknown width, and every
// caller falls back to one bit. A signal declared with a foreign type name
// silently becomes one bit and carries the wrong value.
//
// This matters for interworking: Veryl has ten type names IRIS does not
// (`f32`, `f64`, `p8`..`p64`, `bbool`, `lbool`). A converter that passed one
// through unchanged would produce a design that simulates, reports success,
// and is wrong.
// ---------------------------------------------------------------------------

#[test]
fn an_undeclared_type_on_a_port_is_reported() {
    let diagnostics = check(
        "
        mod M(in a: bit[8], out y: f32,) {
            comb { y = a; }
        }
        ",
        "M",
    );
    assert!(codes(&diagnostics).contains(&"O1008"));
}

#[test]
fn an_undeclared_type_on_a_signal_is_reported() {
    let diagnostics = check(
        "
        mod M(in a: bit[8], out y: bit,) {
            var held: NoSuchTypeAtAll;
            comb { held = a; y = 0; }
        }
        ",
        "M",
    );
    assert!(codes(&diagnostics).contains(&"O1008"));
}

#[test]
fn it_is_a_warning_and_not_an_error() {
    // The design still runs; the point is that it no longer runs silently.
    let diagnostics = check(
        "
        mod M(in a: bit[8], out y: f64,) {
            comb { y = a; }
        }
        ",
        "M",
    );
    assert!(!has_errors(&diagnostics));
    assert!(diagnostics
        .iter()
        .any(|d| d.code == "O1008" && d.severity == Severity::Warning));
}

#[test]
fn a_declared_enum_or_struct_is_not_reported() {
    // The control: without this, a check that flagged every named type would
    // pass the tests above while being useless.
    let diagnostics = check(
        "
        enum State { Idle, Run, Done }
        struct Packet { valid: bit, data: bit[8] }
        mod M(in a: bit[8], out s: State, out p: Packet,) {
            comb { s = State::Idle; p.valid = 1; p.data = a; }
        }
        ",
        "M",
    );
    assert!(!codes(&diagnostics).contains(&"O1008"));
}
