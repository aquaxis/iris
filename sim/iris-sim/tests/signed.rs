//! Tests for signed values (spec 3.1.2, 9.1.3, 9.3.2)
//!
//! `int[N]` and `iN` are read as two's complement; `bit[N]` is unsigned by
//! default and `.signed()` reinterprets it.

use iris_sim::parser::Parser;
use iris_sim::project::Project;
use iris_sim::sim::HierarchicalSimulator;

fn run(source: &str, top: &str, cycles: u64) -> HierarchicalSimulator {
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

    let mut sim = HierarchicalSimulator::new(project);
    sim.assert_reset();
    sim.run_cycles(2);
    sim.deassert_reset();
    sim.run_cycles(cycles);
    sim
}

fn value_of(sim: &HierarchicalSimulator, name: &str) -> u64 {
    sim.get_signal(name)
        .unwrap_or_else(|| panic!("signal '{}' should exist", name))
        .to_u64()
        .unwrap_or_else(|| panic!("signal '{}' should be fully defined", name))
}

/// Read a signal as two's complement
fn signed_of(sim: &HierarchicalSimulator, name: &str) -> i64 {
    sim.get_signal(name)
        .unwrap_or_else(|| panic!("signal '{}' should exist", name))
        .to_i64()
        .unwrap_or_else(|| panic!("signal '{}' should be fully defined", name))
}

const HEAD: &str = "
    in  clk: clock,
    in  rst_n: reset(active_low: true),
";

#[test]
fn a_negative_initial_value_is_stored_in_twos_complement() {
    let source = format!(
        "mod N({head} out o: bit[8]) {{
            var a: i8 = -50;
            comb {{ o = a; }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "N", 2);
    assert_eq!(value_of(&sim, "a"), 0xce, "-50 in eight bits");
    assert_eq!(signed_of(&sim, "a"), -50, "and it reads back as -50");
}

#[test]
fn signed_addition_wraps_the_same_as_unsigned() {
    let source = format!(
        "mod A({head} out o: bit[8]) {{
            var a: i8 = -50;
            var b: i8 = 30;
            var sum: i8 = 0;
            comb {{ sum = a + b; o = sum; }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "A", 2);
    assert_eq!(signed_of(&sim, "sum"), -20);
}

#[test]
fn comparison_follows_the_operands_signedness() {
    let source = format!(
        "mod C({head} out o: bit[8]) {{
            var sa: i8 = -50;
            var sb: i8 = 30;
            var ua: bit[8] = 255;
            var ub: bit[8] = 1;
            var signed_lt: bit = 0;
            var unsigned_gt: bit = 0;
            var reinterpreted: bit = 0;
            comb {{
                signed_lt = sa < sb;
                unsigned_gt = ua > ub;
                reinterpreted = ua.signed() > ub.signed();
                o = 0;
            }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "C", 2);
    assert_eq!(value_of(&sim, "signed_lt"), 1, "-50 < 30");
    assert_eq!(
        value_of(&sim, "unsigned_gt"),
        1,
        "bit[8] compares unsigned by default, so 255 > 1"
    );
    assert_eq!(
        value_of(&sim, "reinterpreted"),
        0,
        ".signed() makes it -1 > 1, which is false"
    );
}

#[test]
fn division_and_modulo_respect_the_sign() {
    let source = format!(
        "mod D({head} out o: bit[8]) {{
            var a: i8 = -50;
            var b: i8 = 30;
            var q: i8 = 0;
            var r: i8 = 0;
            comb {{ q = a / b; r = a % b; o = 0; }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "D", 2);
    assert_eq!(signed_of(&sim, "q"), -1);
    assert_eq!(signed_of(&sim, "r"), -20);
}

#[test]
fn arithmetic_shift_replicates_the_sign_bit() {
    let source = format!(
        "mod S({head} out o: bit[8]) {{
            var a: i8 = -50;
            var u: bit[8] = 255;
            var arith: i8 = 0;
            var logical: bit[8] = 0;
            comb {{
                arith = a >>> 2;
                logical = u >> 2;
                o = 0;
            }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "S", 2);
    assert_eq!(signed_of(&sim, "arith"), -13, "-50 >>> 2");
    assert_eq!(
        value_of(&sim, "logical"),
        63,
        "an unsigned value shifts in zeros"
    );
}

#[test]
fn sign_extend_widens_without_changing_the_value() {
    let source = format!(
        "mod E({head} out o: bit[8]) {{
            var a: i8 = -50;
            var wide: i16 = 0;
            comb {{ wide = a.sign_extend[16](); o = 0; }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "E", 2);
    assert_eq!(value_of(&sim, "wide"), 0xffce);
    assert_eq!(signed_of(&sim, "wide"), -50);
}

#[test]
fn an_unsigned_signal_is_unaffected() {
    // Guard against signedness leaking into ordinary bit vectors
    let source = format!(
        "mod U({head} out o: bit[8]) {{
            var a: bit[8] = 200;
            var b: bit[8] = 100;
            var gt: bit = 0;
            var diff: bit[8] = 0;
            comb {{ gt = a > b; diff = b - a; o = diff; }}
        }}",
        head = HEAD
    );

    let sim = run(&source, "U", 2);
    assert_eq!(value_of(&sim, "gt"), 1, "200 > 100 unsigned");
    assert_eq!(value_of(&sim, "diff"), 156, "100 - 200 wraps to 156");
}
