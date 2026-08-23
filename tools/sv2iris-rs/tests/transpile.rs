//! What the Rust sv2iris converts, and what it refuses.

use sv2iris::transpile;

#[test]
fn a_combinational_adder_converts() {
    let iris = transpile(
        "module add(input logic [7:0] a, input logic [7:0] b, output logic [7:0] y);\n\
         assign y = a + b;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("mod add("), "{}", iris);
    assert!(iris.contains("in a: bit[8],"), "{}", iris);
    assert!(iris.contains("out y: bit[8]"), "{}", iris);
    assert!(iris.contains("comb {"), "{}", iris);
    assert!(iris.contains("y = a + b;"), "{}", iris);
}

#[test]
fn a_one_bit_port_has_no_width() {
    let iris = transpile(
        "module m(input logic op, output logic y);\nassign y = op;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("in op: bit,"), "{}", iris);
    assert!(iris.contains("out y: bit"), "{}", iris);
}

#[test]
fn a_ternary_becomes_an_if_expression() {
    let iris = transpile(
        "module mux(input logic s, input logic [3:0] a, input logic [3:0] b, output logic [3:0] y);\n\
         assign y = s ? a : b;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = if s { a } else { b };"), "{}", iris);
}

#[test]
fn parentheses_are_preserved() {
    let iris = transpile(
        "module m(input logic [7:0] a, input logic [7:0] b, input logic [7:0] c, output logic [7:0] y);\n\
         assign y = (a + b) * c;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = (a + b) * c;"), "{}", iris);
}

#[test]
fn a_hex_literal_is_lowercased() {
    let iris = transpile(
        "module m(output logic [7:0] y);\nassign y = 8'hFF;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = 8'hff;"), "{}", iris);
}

#[test]
fn a_comparison_yields_the_same_operator() {
    let iris = transpile(
        "module m(input logic [7:0] a, input logic [7:0] b, output logic y);\n\
         assign y = a < b;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = a < b;"), "{}", iris);
}

#[test]
fn an_unsupported_construct_is_refused_not_dropped() {
    // An `initial` block is not in the subset yet; it must be reported, never
    // skipped, so a design cannot look whole while missing part of itself.
    let err = transpile(
        "module m(input logic [7:0] a, output logic [7:0] y);\n\
         initial y = a;\nassign y = a;\nendmodule\n",
    )
    .expect_err("should refuse");
    assert!(err.contains("unsupported"), "{}", err);
}

#[test]
fn an_always_ff_without_reset_becomes_a_sync_with_a_let() {
    let iris = transpile(
        "module ff(input logic clk, input logic [7:0] d, output logic [7:0] q);\n\
         logic [7:0] r;\n\
         always_ff @(posedge clk) r <= d;\n\
         always_comb q = r;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("in clk: clock,"), "{}", iris);
    assert!(iris.contains("let r: bit[8];"), "{}", iris);
    assert!(iris.contains("sync(clk.posedge) {"), "{}", iris);
    assert!(iris.contains("r = d;"), "{}", iris);
    assert!(iris.contains("comb {"), "{}", iris);
}

#[test]
fn an_active_low_reset_folds_into_the_register_init() {
    let iris = transpile(
        "module counter(input logic clk, input logic rst_n, input logic enable, output logic [7:0] count);\n\
         logic [7:0] cnt;\n\
         always_ff @(posedge clk or negedge rst_n) begin\n\
           if (!rst_n) cnt <= 8'd0;\n\
           else if (enable) cnt <= cnt + 1;\n\
         end\n\
         always_comb count = cnt;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("in rst_n: reset(active_low: true),"), "{}", iris);
    // The reset value moves onto the declaration.
    assert!(iris.contains("var cnt: bit[8] = 8'd0;"), "{}", iris);
    assert!(iris.contains("sync(clk.posedge, rst_n.async) {"), "{}", iris);
    // The reset branch is gone from the sync body; the else logic remains.
    assert!(!iris.contains("if !rst_n"), "reset branch should be folded away:\n{}", iris);
    assert!(iris.contains("if enable {"), "{}", iris);
    assert!(iris.contains("cnt = cnt + 1;"), "{}", iris);
}

#[test]
fn signed_becomes_int_and_a_decl_initialiser_is_kept() {
    let iris = transpile(
        "module m(input logic [31:0] a, output logic [31:0] y);\n\
         logic signed [31:0] sa = 0;\n\
         always_comb begin sa = a; y = sa; end\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("let sa: int[32] = 0;"), "{}", iris);
}

#[test]
fn a_part_select_and_arithmetic_shift_carry_across() {
    let iris = transpile(
        "module m(input logic [31:0] a, input logic [31:0] b, output logic [31:0] y);\n\
         logic signed [31:0] sa = 0;\n\
         logic [4:0] shamt = 0;\n\
         always_comb begin sa = a; shamt = b[4:0]; y = sa >>> shamt; end\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("shamt = b[4:0];"), "{}", iris);
    assert!(iris.contains("y = sa >>> shamt;"), "{}", iris);
}

#[test]
fn a_bit_select_carries_across() {
    let iris = transpile(
        "module m(input logic [7:0] a, output logic y);\n\
         assign y = a[3];\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = a[3];"), "{}", iris);
}

#[test]
fn a_size_cast_becomes_truncate() {
    let iris = transpile(
        "module m(input logic [7:0] a, input logic [7:0] b, output logic [7:0] y);\n\
         assign y = 8'(a + b);\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = (a + b).truncate[8]();"), "{}", iris);
}

#[test]
fn a_based_literal_still_lexes_after_the_cast_change() {
    // The lexer change for casts must not break a normal based literal.
    let iris = transpile(
        "module m(output logic [7:0] y);\nassign y = 8'hAB;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = 8'hab;"), "{}", iris);
}

#[test]
fn an_unpacked_array_becomes_a_memory() {
    let iris = transpile(
        "module m(input logic [4:0] a, output logic [31:0] y);\n\
         logic [31:0] regs [32];\n\
         always_comb y = regs[a];\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("mem regs: bit[32][32];"), "{}", iris);
    assert!(iris.contains("y = regs[a];"), "{}", iris);
}

#[test]
fn a_memory_write_targets_an_index() {
    let iris = transpile(
        "module m(input logic clk, input logic [4:0] a, input logic [31:0] d);\n\
         logic [31:0] regs [32];\n\
         always_ff @(posedge clk) regs[a] <= d;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("regs[a] = d;"), "{}", iris);
}

#[test]
fn a_signed_cast_becomes_sign_extend() {
    let iris = transpile(
        "module m(input logic [15:0] a, output logic [31:0] y);\n\
         assign y = 32'($signed(a));\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = a.sign_extend[32]();"), "{}", iris);
}

#[test]
fn a_concatenation_carries_across() {
    let iris = transpile(
        "module m(input logic [3:0] a, input logic [3:0] b, output logic [7:0] y);\n\
         assign y = {a, b};\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = {a, b};"), "{}", iris);
}

#[test]
fn a_parameter_becomes_a_generic_with_a_constraint() {
    let iris = transpile(
        "module m #(parameter logic [31:0] N = 8) (input logic [4:0] a, output logic [31:0] y);\n\
         logic [31:0] buf [N];\n\
         always_comb y = buf[a];\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("mod m[N: uint = 8]"), "{}", iris);
    assert!(iris.contains("where"), "{}", iris);
    assert!(iris.contains("N >= 1"), "{}", iris);
    assert!(iris.contains("mem buf: bit[32][N];"), "{}", iris);
}

#[test]
fn a_module_instance_becomes_inst() {
    let iris = transpile(
        "module top(input logic [7:0] a, input logic [7:0] b, output logic [7:0] y);\n\
         Adder u_add ( .x(a), .z(b), .out(y) );\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("inst u_add = Adder {"), "{}", iris);
    assert!(iris.contains("x: a,"), "{}", iris);
    assert!(iris.contains("out: y,"), "{}", iris);
    assert!(iris.contains("};"), "instance closes with a semicolon:\n{}", iris);
}

#[test]
fn a_case_statement_becomes_a_match() {
    let iris = transpile(
        "module m(input logic [1:0] s, output logic [7:0] y);\n\
         always_comb begin\n\
           case (s)\n\
             2'd0: y = 8'd1;\n\
             default: y = 8'd0;\n\
           endcase\n\
         end\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("match s {"), "{}", iris);
    assert!(iris.contains("2'd0 => {"), "{}", iris);
    assert!(iris.contains("_ => {"), "{}", iris);
}

#[test]
fn multiple_modules_all_convert() {
    let iris = transpile(
        "module sub(input logic a, output logic y);\nassign y = a;\nendmodule\n\
         module top(input logic a, output logic y);\nsub u0(.a(a), .y(y));\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("mod sub("), "{}", iris);
    assert!(iris.contains("mod top("), "{}", iris);
    assert!(iris.contains("inst u0 = sub {"), "{}", iris);
}

#[test]
fn an_int_parameter_has_no_constraint() {
    let iris = transpile(
        "module m #(parameter int W = 8) (input logic [W-1:0] a, output logic [W-1:0] y);\n\
         assign y = a;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("mod m[W: uint = 8]("), "{}", iris);
    assert!(!iris.contains("where"), "an int parameter needs no constraint:\n{}", iris);
    assert!(iris.contains("in a: bit[W - 1 + 1],"), "{}", iris);
}

#[test]
fn a_missing_endmodule_is_an_error() {
    let err = transpile("module m(output logic y);\nassign y = 1'b0;\n")
        .expect_err("should error");
    assert!(err.contains("endmodule") || err.contains("end of input"), "{}", err);
}

#[test]
fn a_typedef_enum_becomes_an_iris_enum() {
    let iris = transpile(
        "typedef enum logic [1:0] { Add = 0, Sub = 1 } Op;\n\
         module m(input logic [1:0] s, output logic [7:0] y);\n\
         Op op = Add;\n\
         always_comb y = op == Sub ? 8'd2 : 8'd1;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("enum Op {"), "{}", iris);
    assert!(iris.contains("Add = 0,"), "{}", iris);
    assert!(iris.contains("let op: Op = Op::Add;"), "{}", iris);
    assert!(iris.contains("op == Op::Sub"), "{}", iris);
}

#[test]
fn a_struct_and_union_convert() {
    let iris = transpile(
        "typedef struct packed { logic valid; logic [7:0] data; } Packet;\n\
         typedef union packed { logic [31:0] raw; logic [15:0] half; } Word;\n\
         module m(output logic y); assign y = 0; endmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("struct Packet {"), "{}", iris);
    assert!(iris.contains("valid: bit,"), "{}", iris);
    assert!(iris.contains("data: bit[8],"), "{}", iris);
    assert!(iris.contains("union Word {"), "{}", iris);
}

#[test]
fn a_function_and_call_convert() {
    let iris = transpile(
        "function automatic logic [7:0] add(input logic [7:0] a, input logic [7:0] b);\n\
         return 8'(a + b);\nendfunction\n\
         module m(output logic [7:0] y); always_comb y = add(8'd1, 8'd2); endmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("fn add(a: bit[8], b: bit[8]) -> bit[8] {"), "{}", iris);
    assert!(iris.contains("return (a + b).truncate[8]();"), "{}", iris);
    assert!(iris.contains("y = add(8'd1, 8'd2);"), "{}", iris);
}

#[test]
fn an_interface_becomes_views() {
    let iris = transpile(
        "interface Bus;\n  logic valid;\n  logic ready;\n\
         modport initiator (output valid, input ready);\n\
         modport target (input valid, output ready);\nendinterface\n\
         module m(output logic y); assign y = 0; endmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("interface Bus {"), "{}", iris);
    assert!(iris.contains("view initiator {"), "{}", iris);
    assert!(iris.contains("out: valid,"), "{}", iris);
    // The target view lists inputs first, matching its modport order.
    assert!(iris.contains("view target {\n        in: valid,"), "{}", iris);
}

#[test]
fn a_member_access_carries_across() {
    let iris = transpile(
        "module top(output logic [7:0] y);\n\
         Sub u (.o(y));\n\
         always_comb y = u.o;\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = u.o;"), "{}", iris);
}

#[test]
fn an_indexed_part_select_carries_across() {
    let iris = transpile(
        "module m(input logic [31:0] a, input logic [4:0] i, output logic [7:0] y, output logic [7:0] z);\n\
         always_comb begin y = a[i +: 8]; z = a[i -: 8]; end\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("y = a[i +: 8];"), "{}", iris);
    assert!(iris.contains("z = a[i -: 8];"), "{}", iris);
}

#[test]
fn a_case_without_default_gets_an_empty_catch_all() {
    let iris = transpile(
        "module m(input logic [1:0] s, output logic [7:0] y);\n\
         always_comb case (s) 2'd0: y = 8'd1; 2'd1: y = 8'd2; endcase\nendmodule\n",
    )
    .expect("should convert");
    assert!(iris.contains("_ => {"), "an exhaustive match needs a catch-all:\n{}", iris);
}

#[test]
fn a_reset_value_on_a_port_is_refused() {
    // The reset value has no internal declaration to live on.
    let err = transpile(
        "module m(input logic clk, input logic rst_n, output logic [7:0] count);\n\
         always_ff @(posedge clk or negedge rst_n)\n\
           if (!rst_n) count <= 8'd0; else count <= count + 1;\nendmodule\n",
    )
    .expect_err("should refuse");
    assert!(err.contains("no declaration to hold it"), "{}", err);
}

#[test]
fn an_active_high_reset_stays_in_the_body() {
    let iris = transpile(
        "module m(input logic clk, input logic rst, output logic [7:0] q);\n\
         logic [7:0] r;\n\
         always_ff @(posedge clk or posedge rst)\n\
           if (rst) r <= 8'd0; else r <= r + 1;\n\
         always_comb q = r;\nendmodule\n",
    )
    .expect("should convert");
    // Active-high reset: port stays bit, register is a let, branch kept.
    assert!(iris.contains("in rst: bit,"), "{}", iris);
    assert!(iris.contains("let r: bit[8];"), "{}", iris);
    assert!(iris.contains("if rst {"), "{}", iris);
    assert!(iris.contains("sync(clk.posedge, rst.async) {"), "{}", iris);
}
