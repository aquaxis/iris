//! What IRIS to Veryl converts, and what it refuses.
//!
//! The refusals matter as much as the conversions. A converter that quietly
//! dropped what it could not express would produce a design that builds,
//! simulates, and is wrong; `veryl translate` does exactly that with
//! SystemVerilog, losing 26 of 27 assignments in one design.

use iris2veryl::convert::convert;

fn ok(source: &str) -> String {
    let converted = convert("t.iris", source).expect("source should parse");
    assert!(
        !converted.report.failed(),
        "expected a conversion, got:\n{}",
        converted.report
    );
    converted.source
}

fn refused(source: &str) -> String {
    let converted = convert("t.iris", source).expect("source should parse");
    assert!(
        converted.report.failed(),
        "expected a refusal, got:\n{}",
        converted.source
    );
    assert!(
        converted.source.is_empty(),
        "a refused conversion must emit nothing, got:\n{}",
        converted.source
    );
    converted.report.to_string()
}

// ---------------------------------------------------------------------------
// The common subset
// ---------------------------------------------------------------------------

#[test]
fn a_module_and_its_ports_convert() {
    let veryl = ok("mod M(in a: bit[8], out y: bit[8],) { comb { y = a; } }");
    assert!(veryl.contains("module M ("), "{}", veryl);
    assert!(veryl.contains("a: input logic<8>"), "{}", veryl);
    assert!(veryl.contains("y: output logic<8>"), "{}", veryl);
}

#[test]
fn a_signed_type_keeps_its_sign() {
    // The whole point of int[N] is that it is signed. Writing it as a plain
    // vector would change what comparisons and shifts mean.
    let veryl = ok("mod M(in a: int[32], out y: int[32],) { comb { y = a; } }");
    // Veryl has a fixed type at this width, and it is the one that survives a
    // round trip: `signed logic<32>` would come back as `int[32]` and then be
    // written `i32`, so `i32` is written in the first place.
    assert!(veryl.contains("i32"), "{}", veryl);
}

#[test]
fn comb_and_sync_become_always_comb_and_always_ff() {
    let veryl = ok(
        "mod M(in clk: clock, in rst: reset, in a: bit, out y: bit,) {
            var held: bit = 0;
            comb { y = held; }
            sync(clk.posedge, rst.async) { held = a; }
        }",
    );
    assert!(veryl.contains("always_comb {"), "{}", veryl);
    assert!(veryl.contains("always_ff (clk, rst) {"), "{}", veryl);
}

#[test]
fn the_ordering_comparisons_take_verylers_spelling() {
    // Veryl writes `<:` so that `<` stays free for generic arguments. Emitting
    // `<` would produce something that does not parse.
    let veryl = ok("mod M(in a: bit[8], in b: bit[8], out y: bit,) { comb { y = a < b; } }");
    assert!(veryl.contains("<:"), "{}", veryl);
}

#[test]
fn a_match_becomes_a_case() {
    let veryl = ok(
        "mod M(in s: bit[2], out y: bit[8],) {
            comb {
                match s {
                    2'd0 => { y = 8'd1; }
                    _ => { y = 8'd0; }
                }
            }
        }",
    );
    assert!(veryl.contains("case s {"), "{}", veryl);
    assert!(veryl.contains("default:"), "{}", veryl);
}

// ---------------------------------------------------------------------------
// Refusals: the language cannot express it
// ---------------------------------------------------------------------------

#[test]
fn an_fsm_is_refused_because_veryl_has_none() {
    let text = refused(
        "mod M(in clk: clock, in rst: reset, in go: bit, out y: bit,) {
            fsm main(clk.posedge, rst.async) {
                state enum { Idle, Run }
                initial: Idle
                transitions {
                    Idle => { when go { goto Run; } }
                    Run  => { when go { goto Idle; } }
                }
            }
            comb { y = 0; }
        }",
    );
    assert!(text.contains("no counterpart in the target language"), "{}", text);
    assert!(text.contains("state machine"), "{}", text);
}

#[test]
fn a_width_conversion_other_than_sign_extend_is_refused() {
    // Veryl can express these; this converter has only written sign_extend.
    // That is a fact about the tool, so it must not be reported as a fact
    // about the language.
    let text = refused(
        "mod M(in a: bit[8], out y: bit[4],) { comb { y = a.truncate[4](); } }",
    );
    assert!(text.contains("not implemented by this converter"), "{}", text);
    assert!(!text.contains("no counterpart in the target language"), "{}", text);
}

#[test]
fn a_sign_extension_becomes_a_repeated_sign_bit() {
    // Veryl's cast is not the counterpart: `x as i32` emits `int'(x)`, which
    // zero-extends an unsigned operand, while IRIS emits `32'($signed(x))`.
    // Repeating the sign bit says the same thing in both languages.
    let out = ok("mod M(in a: bit[8], out y: bit[32],) { comb { y = a.sign_extend[32](); } }");
    assert!(out.contains("{a[7] repeat 24, a}"), "{}", out);
}

#[test]
fn a_sign_extension_of_a_slice_indexes_the_slice_top() {
    let out = ok(
        "mod M(in a: bit[32], out y: bit[32],) { comb { y = a[31:20].sign_extend[32](); } }",
    );
    assert!(out.contains("{a[31] repeat 20, a[31:20]}"), "{}", out);
}

#[test]
fn a_sign_extension_of_a_concatenation_takes_its_leading_part() {
    // The sign of `{a[31:25], a[11:7]}` is the top bit of the leading part.
    let out = ok(
        "mod M(in a: bit[32], out y: bit[32],) { comb { y = {a[31:25], a[11:7]}.sign_extend[32](); } }",
    );
    assert!(out.contains("{a[31] repeat 20,"), "{}", out);
}

#[test]
fn a_sign_extension_to_its_own_width_repeats_nothing() {
    let out = ok("mod M(in a: bit[8], out y: bit[8],) { comb { y = a.sign_extend[8](); } }");
    assert!(!out.contains("repeat"), "{}", out);
}

#[test]
fn a_sign_extension_that_narrows_is_refused() {
    // Narrowing is not what sign_extend means, and quietly widening or
    // truncating here would hide that the source says something impossible.
    let text = refused(
        "mod M(in a: bit[32], out y: bit[8],) { comb { y = a.sign_extend[8](); } }",
    );
    assert!(text.contains("narrows"), "{}", text);
}

#[test]
fn a_file_level_enum_is_written_into_the_module() {
    // IRIS declares it once for the file; Veryl has no top-level form.
    let out = ok(
        "enum Op: bit[2] { Add, Sub }
         mod M(in sel: bit[2], out y: bit[8],) {
             comb { y = match sel { Op::Add => 8'd1, _ => 8'd0, }; }
         }",
    );
    assert!(out.contains("enum Op: logic<2> {"), "{}", out);
    assert!(out.contains("Op::Add:"), "{}", out);
}

#[test]
fn a_file_with_a_named_type_and_several_modules_is_refused() {
    // Writing the type into each module would make several types that only
    // look alike, and each would elaborate.
    let text = refused(
        "enum Op: bit[2] { Add, Sub }
         mod A(in s: bit[2], out y: bit,) { comb { y = 1'b0; } }
         mod B(in s: bit[2], out y: bit,) { comb { y = 1'b0; } }",
    );
    assert!(text.contains("more than one module"), "{}", text);
}

#[test]
fn a_struct_field_read_is_not_taken_for_a_method() {
    let out = ok(
        "struct Pair { lo: bit[4], hi: bit[4] }
         mod M(in a: bit[4], out y: bit[8],) {
             var p: Pair;
             comb { p.lo = a; p.hi = 4'd2; y = {p.hi, p.lo}; }
         }",
    );
    assert!(out.contains("p.hi"), "{}", out);
}

#[test]
fn a_definition_on_a_declaration_is_not_dropped() {
    // `const K: bit[8] = 8'd3;` became `var K: logic<8>;` and the 3 was gone.
    // The result elaborated, simulated, and computed something else.
    let out = ok(
        "mod M(in a: bit[8], out y: bit[8],) {
            const K: bit[8] = 8'd3;
            comb { y = a + K; }
        }",
    );
    assert!(out.contains("let K: logic<8> = 8'd3;"), "{}", out);
}

#[test]
fn a_let_keeps_what_drives_it() {
    let out = ok(
        "mod M(in a: bit[8], out y: bit[8],) {
            let w: bit[8] = a;
            comb { y = w; }
        }",
    );
    assert!(out.contains("let w: logic<8> = a;"), "{}", out);
}

#[test]
fn a_starting_value_on_a_var_becomes_an_initial_block() {
    // Veryl has no initialiser on a declaration, and a design need not reset
    // its registers in the always_ff. Dropping this changed what the design
    // computed from the first cycle.
    let out = ok(
        "mod M(in clk: clock, out y: bit[8],) {
            var acc: bit[8] = 8'd7;
            comb { y = acc; }
        }",
    );
    assert!(out.contains("initial {"), "{}", out);
    assert!(out.contains("acc = 8'd7;"), "{}", out);
}

#[test]
fn a_generic_parameter_becomes_a_veryl_parameter() {
    let out = ok(
        "mod M[Width: uint = 8,](in a: bit[Width], out y: bit[Width],) { comb { y = a; } }",
    );
    assert!(out.contains("#("), "{}", out);
    assert!(out.contains("param Width: u32 = 8,"), "{}", out);
}

#[test]
fn a_width_written_over_a_parameter_is_carried() {
    // Dropping the width here would leave a module that still parses and
    // still simulates, one bit wide. That is the failure this tool exists
    // to avoid, so it has a test on both sides.
    let out = ok(
        "mod M[Width: uint = 8,](in a: bit[Width], out y: bit[Width],) { comb { y = a; } }",
    );
    assert!(out.contains("a: input logic<Width>"), "{}", out);
}

#[test]
fn a_memory_depth_written_over_a_parameter_is_not_resolved() {
    // The parser settles `Depth` to its default, and emitting that number
    // would turn a generic memory into a fixed one that still looks generic.
    let out = ok(
        "mod M[Depth: uint = 16,](in a: bit[4], out y: bit[8],) {
            mem store: bit[8][Depth];
            comb { y = store[a]; }
        }",
    );
    assert!(out.contains("[Depth]"), "{}", out);
    assert!(!out.contains("[16]"), "the parameter was resolved away:\n{}", out);
}

#[test]
fn a_system_function_keeps_its_dollar() {
    let out = ok(
        "mod M[Depth: uint = 16, W: uint = $clog2(Depth),](in a: bit, out y: bit,) { comb { y = a; } }",
    );
    assert!(out.contains("$clog2(Depth)"), "{}", out);
}

#[test]
fn a_where_clause_is_reported_as_lost() {
    // Veryl bounds a parameter by its shape, not its value. A module that
    // quietly lost its own bounds would accept an argument its author ruled
    // out, and fail somewhere else entirely.
    let converted = convert(
        "t.iris",
        "mod M[Width: uint = 8,] where Width >= 1, (in a: bit[Width], out y: bit[Width],) { comb { y = a; } }",
    )
    .expect("source should parse");
    assert!(!converted.report.failed(), "{}", converted.report);
    let text = converted.report.to_string();
    assert!(text.contains("where clause"), "{}", text);
}

#[test]
fn a_replication_becomes_a_repeat() {
    let out = ok("mod M(in a: bit, out y: bit[4],) { comb { y = {4{a}}; } }");
    assert!(out.contains("{a repeat 4}"), "{}", out);
}

#[test]
fn reading_an_instance_port_becomes_a_wired_variable() {
    // IRIS reads `u.q` straight out of the instance. Veryl has no such
    // expression: the output is wired to a variable at the instantiation and
    // the variable is read.
    let out = ok(
        "mod Sub(in a: bit, out q: bit,) { comb { q = a; } }
         mod M(in a: bit, out y: bit,) { inst u = Sub { a: a, }; comb { y = u.q; } }",
    );
    assert!(out.contains("var u_q: logic;"), "{}", out);
    assert!(out.contains("q: u_q"), "{}", out);
    assert!(out.contains("y = u_q;"), "{}", out);
}

#[test]
fn a_wire_name_that_is_taken_is_not_reused() {
    // Reusing a declared name would connect the instance to whatever that
    // name already meant, which simulates and is wrong.
    let out = ok(
        "mod Sub(in a: bit, out q: bit,) { comb { q = a; } }
         mod M(in a: bit, out y: bit,) {
             var u_q: bit = 0;
             inst u = Sub { a: a, };
             comb { y = u.q & u_q; }
         }",
    );
    assert!(out.contains("var u_q_: logic;"), "{}", out);
    assert!(out.contains("q: u_q_"), "{}", out);
}

#[test]
fn reading_a_port_of_a_module_that_was_not_supplied_is_refused() {
    // Without the other module there is no way to know what `q` is, and
    // guessing a width would be worse than saying so.
    let text = refused(
        "mod M(in a: bit, out y: bit,) { inst u = Elsewhere { a: a, }; comb { y = u.q; } }",
    );
    assert!(text.contains("reading an instance's port"), "{}", text);
}

// ---------------------------------------------------------------------------
// Refusals: the converter has not caught up
//
// This is a different fact from the one above, and a reader deciding whether
// to wait or to rewrite needs to know which applies.
// ---------------------------------------------------------------------------

#[test]
fn a_memory_becomes_an_array() {
    let veryl = ok(
        "mod M(in clk: clock, in a: bit[5], out y: bit[32],) {
            mem store: bit[32][32];
            comb { y = store[a]; }
        }",
    );
    assert!(veryl.contains("var store: logic<32> [32];"), "{}", veryl);
}

#[test]
fn memory_configuration_is_reported_because_veryl_has_none() {
    // A rom quietly becoming writable memory survives simulation and fails in
    // synthesis, so the loss is stated rather than passed over.
    let converted = convert(
        "t.iris",
        "mod M(in clk: clock, in a: bit[5], out y: bit[32],) {
            mem store: bit[32][32] { type: rom };
            comb { y = store[a]; }
        }",
    )
    .expect("source should parse");
    assert!(!converted.report.failed(), "{}", converted.report);
    assert!(
        converted.report.to_string().contains("does not convert exactly"),
        "{}",
        converted.report
    );
}

#[test]
fn an_instance_and_its_connections_convert() {
    let veryl = ok(
        "mod Sub(in a: bit[8], out y: bit[8],) { comb { y = a; } }
         mod Top(in a: bit[8], out y: bit[8],) {
             var mid: bit[8] = 0;
             inst u = Sub { a: a, y: mid, };
             comb { y = mid; }
         }",
    );
    assert!(veryl.contains("inst u: Sub (a: a, y: mid);"), "{}", veryl);
}

#[test]
fn an_undeclared_type_is_refused_rather_than_carried() {
    // IRIS itself reports this as O1008. Passing it through would carry the
    // fault into the other language.
    let text = refused("mod M(in a: bit[8], out y: NoSuchType,) { comb { y = a; } }");
    assert!(text.contains("not declared anywhere"), "{}", text);
}

// ---------------------------------------------------------------------------
// A refused conversion emits nothing
// ---------------------------------------------------------------------------

#[test]
fn nothing_is_written_when_anything_is_refused() {
    // Half a design is worse than none, because it looks whole.
    let converted = convert(
        "t.iris",
        "mod Good(in a: bit, out y: bit,) { comb { y = a; } }
         mod Bad(in a: bit[8], out y: bit[4],) { comb { y = a.truncate[4](); } }",
    )
    .expect("source should parse");
    assert!(converted.report.failed());
    assert!(converted.source.is_empty(), "{}", converted.source);
}
