//! What Veryl to IRIS converts, and what it refuses.

use veryl2iris::convert::convert;

fn ok(source: &str) -> String {
    let converted = convert("t.veryl", source).expect("source should parse");
    assert!(
        !converted.report.failed(),
        "expected a conversion, got:\n{}",
        converted.report
    );
    converted.source
}

fn refused(source: &str) -> String {
    let converted = convert("t.veryl", source).expect("source should parse");
    assert!(
        converted.report.failed(),
        "expected a refusal, got:\n{}",
        converted.source
    );
    assert!(converted.source.is_empty(), "{}", converted.source);
    converted.report.to_string()
}

const COUNTER: &str = "
module Counter (
    clk   : input  clock   ,
    rst   : input  reset   ,
    enable: input  logic   ,
    count : output logic<8>,
) {
    var counter: logic<8>;
    always_ff (clk) {
        if enable {
            counter = counter + 1;
        }
    }
    always_comb {
        count = counter;
    }
}
";

#[test]
fn a_module_its_ports_and_its_blocks_convert() {
    let iris = ok(COUNTER);
    assert!(iris.contains("mod Counter("), "{}", iris);
    assert!(iris.contains("in clk: clock"), "{}", iris);
    assert!(iris.contains("out count: bit[8]"), "{}", iris);
    assert!(iris.contains("sync(clk.posedge)"), "{}", iris);
    assert!(iris.contains("comb {"), "{}", iris);
}

#[test]
fn a_signed_vector_becomes_int() {
    let iris = ok(
        "module M (a: input signed logic<32>, y: output logic<32>,) {
            always_comb { y = a; }
        }",
    );
    assert!(iris.contains("in a: int[32]"), "{}", iris);
}

#[test]
fn the_ordering_comparison_loses_its_colon() {
    // Veryl writes `<:` so that `<` stays free for generics. Carrying it
    // across unchanged would not parse as IRIS.
    let iris = ok(
        "module M (a: input logic<8>, b: input logic<8>, y: output logic,) {
            always_comb { y = a <: b; }
        }",
    );
    assert!(iris.contains(" < "), "{}", iris);
    assert!(!iris.contains("<:"), "{}", iris);
}

// ---------------------------------------------------------------------------
// Refusals: the language cannot express it
// ---------------------------------------------------------------------------

#[test]
fn a_float_type_is_refused() {
    let text = refused("module M (y: output f32,) { always_comb { y = 0; } }");
    assert!(text.contains("no counterpart in the target language"), "{}", text);
}

#[test]
fn tri_state_is_refused() {
    let text = refused("module M (p: inout tri logic,) { always_comb { } }");
    assert!(text.contains("no counterpart in the target language"), "{}", text);
}

// ---------------------------------------------------------------------------
// Refusals: the shape differs, so tokens cannot simply be carried
//
// Found by converting alu.veryl: its `case` expression came out verbatim and
// the IRIS parser rejected it, while the converter reported success. Emitting
// something that is not the target language at all is the failure this tool
// exists to avoid.
// ---------------------------------------------------------------------------

#[test]
fn a_case_expression_is_rebuilt_as_a_match() {
    let iris = ok(
        "module M (op: input logic<2>, y: output logic<8>,) {
            always_comb {
                y = case op {
                    2'd0   : 8'd1,
                    default: 8'd0,
                };
            }
        }",
    );
    assert!(iris.contains("match op {"), "{}", iris);
    assert!(iris.contains("2'd0 => 8'd1"), "{}", iris);
    // Veryl's `default` is IRIS' `_`.
    assert!(iris.contains("_ => 8'd0"), "{}", iris);
    assert!(!iris.contains("case op"), "{}", iris);
}

#[test]
fn a_conditional_expression_is_rebuilt_with_braces() {
    let iris = ok(
        "module M (c: input logic, y: output logic<8>,) {
            always_comb { y = if c ? 8'd1 : 8'd0; }
        }",
    );
    assert!(iris.contains("if c { 8'd1 } else { 8'd0 }"), "{}", iris);
    assert!(!iris.contains(" ? "), "{}", iris);
}

#[test]
fn a_case_arm_listing_several_values_is_refused() {
    // An IRIS match arm carries one pattern. Splitting the arm would be
    // correct but is not written, and quietly dropping the extra values
    // would change which inputs the arm answers to.
    let text = refused(
        "module M (op: input logic<2>, y: output logic<8>,) {
            always_comb {
                y = case op {
                    2'd0, 2'd1: 8'd1,
                    default   : 8'd0,
                };
            }
        }",
    );
    assert!(text.contains("several values"), "{}", text);
}

#[test]
fn a_reshaping_construct_inside_a_larger_expression_is_refused() {
    // Only a whole expression is rebuilt. Anything else is refused rather
    // than half-converted.
    let text = refused(
        "module M (op: input logic<2>, y: output logic<8>,) {
            always_comb {
                y = 8'd1 + case op {
                    2'd0   : 8'd1,
                    default: 8'd0,
                };
            }
        }",
    );
    assert!(text.contains("nested inside a larger expression"), "{}", text);
}

#[test]
fn a_parameter_block_becomes_generic_parameters() {
    // This block used to be read by nothing at all: a parameterised module
    // came out with its parameters gone, and the converter called it a
    // success.
    let iris = ok(
        "module M #(
            param Width: u32 = 8,
        ) (
            a: input logic<Width>,
            y: output logic<Width>,
        ) {
            always_comb { y = a; }
        }",
    );
    assert!(iris.contains("[Width: uint[32] = 8,]"), "{}", iris);
}

#[test]
fn a_width_written_over_a_parameter_is_not_dropped() {
    // `logic<Width>` used to become plain `bit`, because "no width written"
    // and "a width I could not read as a number" were the same answer. The
    // result parsed, simulated, and was one bit wide.
    let iris = ok(
        "module M #(
            param Width: u32 = 8,
        ) (
            a: input logic<Width>,
            y: output logic<Width>,
        ) {
            always_comb { y = a; }
        }",
    );
    assert!(iris.contains("in a: bit[Width]"), "{}", iris);
    assert!(!iris.contains("in a: bit,"), "the width was dropped:\n{}", iris);
}

#[test]
fn an_enum_is_lifted_out_of_the_module() {
    // Veryl declares an enumeration inside a module; IRIS declares it at the
    // top of the file. Same thing said in a different place.
    let iris = ok(
        "module M (
            sel: input logic<2>,
            y: output logic<8>,
        ) {
            enum Op: logic<2> {
                Add,
                Sub,
            }
            always_comb { y = case sel { Op::Add: 8'd1, default: 8'd0, }; }
        }",
    );
    assert!(iris.contains("enum Op: bit[2] { Add, Sub }"), "{}", iris);
    assert!(iris.find("enum Op").unwrap() < iris.find("mod M").unwrap(), "{}", iris);
}

#[test]
fn a_struct_is_lifted_out_of_the_module() {
    let iris = ok(
        "module M (
            a: input logic<4>,
            y: output logic<8>,
        ) {
            struct Pair {
                lo: logic<4>,
                hi: logic<4>,
            }
            var p: Pair;
            always_comb { p.lo = a; p.hi = 4'd2; y = {p.hi, p.lo}; }
        }",
    );
    assert!(iris.contains("struct Pair { lo: bit[4], hi: bit[4] }"), "{}", iris);
}

#[test]
fn a_var_with_no_starting_value_gets_none_invented() {
    // Writing `= 0` here was harmless while the other direction dropped
    // initialisers. Now that it carries them, an invented zero comes back as
    // an `initial` block the source never had.
    let iris = ok(
        "module M (
            a: input logic<8>,
            y: output logic<8>,
        ) {
            var w: logic<8>;
            always_comb { w = a; y = w; }
        }",
    );
    assert!(iris.contains("var w: bit[8];"), "{}", iris);
    assert!(!iris.contains("var w: bit[8] = 0;"), "a zero was invented:\n{}", iris);
}

#[test]
fn let_const_and_assign_declarations_convert() {
    let iris = ok(
        "module M (
            a: input logic<8>,
            y: output logic<8>,
            z: output logic<8>,
        ) {
            const K: logic<8> = 8'd3;
            let w: logic<8> = a;
            assign z = a;
            always_comb { y = w + K; }
        }",
    );
    assert!(iris.contains("const K: bit[8] = 8'd3;"), "{}", iris);
    assert!(iris.contains("let w: bit[8] = a;"), "{}", iris);
    // IRIS has no standalone continuous assignment; it lives in a comb block.
    assert!(iris.contains("comb {"), "{}", iris);
    assert!(iris.contains("z = a;"), "{}", iris);
}

#[test]
fn an_initial_block_folds_onto_the_declarations() {
    // IRIS writes a starting value on the declaration and has no initial
    // block outside a test. Folding is the exact inverse of what iris2veryl
    // does, so the round trip closes.
    let iris = ok(
        "module M (
            c: input clock,
            y: output logic<8>,
        ) {
            var acc: logic<8>;
            initial {
                acc = 8'd7;
            }
            always_comb { y = acc; }
        }",
    );
    assert!(iris.contains("var acc: bit[8] = 8'd7;"), "{}", iris);
    assert!(!iris.contains("initial"), "the block was carried too:\n{}", iris);
}

#[test]
fn an_initial_block_that_is_not_just_starting_values_is_refused() {
    // Folding only makes sense for plain assignments. Anything else stays an
    // initial block, which IRIS allows only inside a test module.
    let text = refused(
        "module M (
            c: input clock,
            y: output logic<8>,
        ) {
            var acc: logic<8>;
            initial {
                if 1 {
                    acc = 8'd7;
                }
            }
            always_comb { y = acc; }
        }",
    );
    assert!(text.contains("initial"), "{}", text);
}

#[test]
fn a_chain_of_conditionals_nests_rather_than_flattens() {
    // IRIS' if expression takes a braced expression after `else` and has no
    // `else if` form, so a flat chain does not parse. Found on riscv_core,
    // whose write-back picks one of five values.
    let iris = ok(
        "module Chain (
            a: input logic,
            b: input logic,
            y: output logic<8>,
        ) {
            always_comb {
                y = if a ? 8'd1 : if b ? 8'd2 : 8'd3;
            }
        }",
    );
    assert!(iris.contains("else { if b"), "{}", iris);
    assert!(!iris.contains("else if"), "flat chain does not parse:\n{}", iris);
}

#[test]
fn a_cast_is_refused_rather_than_carried() {
    // `a as 32` used to come out unchanged and be reported as a success; the
    // IRIS parser then rejected it. IRIS casts to a type, not to a width.
    let text = refused(
        "module Cast (
            a: input logic<8>,
            y: output logic<32>,
        ) {
            always_comb { y = a as 32; }
        }",
    );
    assert!(text.contains("a cast written with `as`"), "{}", text);
}

#[test]
fn a_module_implementing_a_proto_is_refused() {
    // `module M for P` states that M implements a prototype. Saying nothing
    // would drop the claim.
    let text = refused(
        "proto module P (
            a: input logic,
        );
        module M for P (
            a: input logic,
        ) {
        }",
    );
    assert!(text.contains("no counterpart in the target language"), "{}", text);
}

#[test]
fn a_repeat_becomes_a_replication() {
    // Found by feeding this to the converter: it emitted the Veryl text
    // unchanged and reported success, and the IRIS parser then rejected it.
    // `repeat` had been left out of the list of shapes that differ.
    let iris = ok(
        "module Rep (
            i_v: input logic<12>,
            o_y: output logic<32>,
        ) {
            always_comb {
                o_y = {i_v[11] repeat 20, i_v};
            }
        }",
    );
    assert!(iris.contains("{20{i_v [11]}}"), "{}", iris);
    assert!(!iris.contains("repeat"), "carried through verbatim:\n{}", iris);
}

#[test]
fn a_repeat_on_its_own_becomes_a_replication() {
    let iris = ok(
        "module Rep (
            i_v: input logic,
            o_y: output logic<4>,
        ) {
            always_comb {
                o_y = {i_v repeat 4};
            }
        }",
    );
    assert!(iris.contains("{4{i_v}}"), "{}", iris);
}

#[test]
fn an_if_statement_still_converts() {
    // The guard must not catch the condition of an if *statement*, which is an
    // ordinary expression. Without this, the counter above would stop working.
    let iris = ok(COUNTER);
    assert!(iris.contains("if enable {"), "{}", iris);
}

#[test]
fn an_array_becomes_a_mem() {
    let iris = ok(
        "module M (clk: input clock, a: input logic<5>, y: output logic<32>,) {
            var store: logic<32> [32];
            always_comb { y = store[a]; }
        }",
    );
    assert!(iris.contains("mem store: bit[32][32];"), "{}", iris);
}

#[test]
fn a_multi_dimensional_array_is_refused() {
    // An IRIS mem has one dimension. Folding two into one would change what
    // an index means.
    let text = refused(
        "module M (y: output logic<32>,) {
            var store: logic<32> [4, 8];
            always_comb { y = 0; }
        }",
    );
    assert!(text.contains("multi-dimensional"), "{}", text);
}

#[test]
fn an_instance_and_its_connections_convert() {
    let iris = ok(
        "module Top (a: input logic<8>, y: output logic<8>,) {
            var mid: logic<8>;
            inst u: Sub (a: a, y: mid);
            always_comb { y = mid; }
        }",
    );
    assert!(iris.contains("inst u = Sub {"), "{}", iris);
    assert!(iris.contains("a: a"), "{}", iris);
}

#[test]
fn nothing_is_written_when_anything_is_refused() {
    let converted = convert(
        "t.veryl",
        "module Good (a: input logic, y: output logic,) { always_comb { y = a; } }
         module Bad (y: output f64,) { always_comb { y = 0; } }",
    )
    .expect("source should parse");
    assert!(converted.report.failed());
    assert!(converted.source.is_empty(), "{}", converted.source);
}
