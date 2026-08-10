# IRIS to SystemVerilog Conversion Rules

This document describes how IRIS constructs are converted to SystemVerilog.

## Conversion status

Nothing is dropped in silence: a construct the transpiler cannot handle fails
the conversion rather than emitting a module that does less than the source
said.

| Construct | Status |
|---|---|
| Modules, ports, generic parameters | Supported |
| Signal declarations (`let`, `var`) | Supported |
| `mem` declarations | Supported |
| `comb`, `sync` blocks | Supported |
| Instances | Supported |
| `if` statement, `if` expression, `match` statement, `for` loop | Supported |
| `match` expression (the value-returning form) | Supported, as a chain of conditionals |
| Concatenation, replication, bit and range selection | Supported |
| Part select (`a[i +: 8]`) | Supported |
| System functions (`$clog2`, `$display`) | Supported |
| `where` clause | Accepted; no SystemVerilog equivalent, so it does not appear in the output |
| `fsm` blocks | Supported, as a state register and a `case` |
| `enum`, `struct`, `union` definitions | Supported, as `typedef` |
| `interface` definitions and views | Supported, as `interface` and `modport` |
| Function definitions (`fn`) | Supported, as `function` |
| `extern mod` | Nothing is emitted; SystemVerilog resolves a module by name |
| `package` declaration | Its items convert at file level; the name has no equivalent and is reported |
| `test` modules | Supported, as a module with no ports |

Every design in the repository and every construct of the grammar is run
through `tools/conformance/run.sh`. A converted testbench is then run under
Verilator and its report compared against `iris-sim`.

## Type System

### Primitive Types

| IRIS Type | SystemVerilog Type | Notes |
|-----------|-------------------|-------|
| `bool` | `logic` | 1-bit logic |
| `bit` | `logic` | 1-bit logic |
| `int<N>` | `logic signed [N-1:0]` | Signed N-bit |
| `bit[N]` | `logic [N-1:0]` | Unsigned N-bit |
| `clock` | `logic` | Clock signal |
| `reset` | `logic` | Reset signal |

### Examples

```iris
// IRIS
in a: bool
in b: u8
in c: i16
out d: u32
```

```systemverilog
// SystemVerilog
input  logic        a,
input  logic [7:0]  b,
input  logic signed [15:0] c,
output logic [31:0] d
```

### Array Types

| IRIS Type | SystemVerilog Type |
|-----------|-------------------|
| `[T; N]` | `T [0:N-1]` |
| `[[T; M]; N]` | `T [0:N-1][0:M-1]` |

```iris
// IRIS
let data: [u8; 16];
let matrix: [[u8; 4]; 4];
```

```systemverilog
// SystemVerilog
logic [7:0] data [0:15];
logic [7:0] matrix [0:3][0:3];
```

### Enum Types

An enum becomes a `typedef enum`, wide enough to hold its variants. The base
type is the storage the enum sits in; naming the enum itself there makes it
self-referential, which Verilator rejects.

Members of a `typedef enum` sit in the enclosing scope in SystemVerilog, so
`State::Idle` is written `Idle` in the output.

```iris
// IRIS
enum State {
    Idle,
    Running,
    Done
}
```

```systemverilog
// SystemVerilog
typedef enum logic [1:0] {
  Idle = 0,
  Running = 1,
  Done = 2
} State;
```

### Struct Types

A struct becomes a packed `typedef struct`. A `union` becomes a packed
`typedef union`: its members overlay each other where a struct's sit end to
end, so the two cannot share a node.

```iris
// IRIS
struct Packet {
    valid: bit,
    data: bit[32],
    tag: bit[4],
}
```

```systemverilog
// SystemVerilog
typedef struct packed {
  logic valid;
  logic [31:0] data;
  logic [3:0] tag;
} Packet;
```

## Module Structure

### Basic Module

```iris
// IRIS
mod counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bool,
    out count: u8,
) {
}
```

```systemverilog
// SystemVerilog
module counter (
  input  logic       clk,
  input  logic       rst,
  input  logic       enable,
  output logic [7:0] count
);
endmodule
```

### Module with Parameters

```iris
// IRIS
mod fifo[WIDTH: uint = 8, DEPTH: uint = 16](
    in  clk: clock,
    in  data_in: bit[WIDTH],
    out data_out: bit[WIDTH],
) {
}
```

```systemverilog
// SystemVerilog
module fifo #(
  parameter int WIDTH = 8,
  parameter int DEPTH = 16
) (
  input  logic             clk,
  input  logic [WIDTH-1:0] data_in,
  output logic [WIDTH-1:0] data_out
);
endmodule
```

### Port Directions

| IRIS | SystemVerilog |
|------|---------------|
| `in` | `input` |
| `out` | `output` |
| `inout` | `inout` |

## Behavioral Blocks

### Combinational Logic (comb)

```iris
// IRIS
comb {
    y = a & b;
    z = a | b;
}
```

```systemverilog
// SystemVerilog
always_comb begin
  y = a & b;
  z = a | b;
end
```

### Sequential Logic (sync)

```iris
// IRIS
sync(clk.posedge, rst.high) {
    if rst {
        count = 0;
    } else if enable {
        count = count + 1;
    }
}
```

```systemverilog
// SystemVerilog
always_ff @(posedge clk or posedge rst) begin
  if (rst) begin
    count <= 8'd0;
  end else if (enable) begin
    count <= count + 8'd1;
  end
end
```

### Clock/Reset Specifications

| IRIS | SystemVerilog |
|------|---------------|
| `clk.posedge` | `posedge clk` |
| `clk.negedge` | `negedge clk` |
| `rst.high` | Async active-high reset |
| `rst.low` | Async active-low reset |
| `rst.sync` | Sync reset (inside always_ff) |

## Operators

### Arithmetic Operators

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `+` | `+` | Addition |
| `-` | `-` | Subtraction |
| `*` | `*` | Multiplication |
| `/` | `/` | Division |
| `%` | `%` | Modulo |

### Bitwise Operators

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `&` | `&` | Bitwise AND |
| `\|` | `\|` | Bitwise OR |
| `^` | `^` | Bitwise XOR |
| `~` | `~` | Bitwise NOT |
| `<<` | `<<` | Left shift |
| `>>` | `>>` | Right shift (logical) |
| `>>>` | `>>>` | Right shift (arithmetic) |

### Comparison Operators

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `==` | `==` | Equal |
| `!=` | `!=` | Not equal |
| `<` | `<` | Less than |
| `<=` | `<=` | Less or equal |
| `>` | `>` | Greater than |
| `>=` | `>=` | Greater or equal |

### Logical Operators

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `&&` | `&&` | Logical AND |
| `\|\|` | `\|\|` | Logical OR |
| `!` | `!` | Logical NOT |

### Reduction Operators

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `&x` | `&x` | Reduction AND |
| `\|x` | `\|x` | Reduction OR |
| `^x` | `^x` | Reduction XOR |

## Control Flow

### If Statement

```iris
// IRIS
if condition {
    a = 1;
} else if other {
    a = 2;
} else {
    a = 3;
}
```

```systemverilog
// SystemVerilog
if (condition) begin
  a = 1;
end else if (other) begin
  a = 2;
end else begin
  a = 3;
end
```

### Match Statement (Case)

Both forms convert. The statement form becomes a `case`; the expression form —
`y = match s { ... };` — becomes a chain of conditionals:

```systemverilog
y = s == 2'd0 ? 8'(a + b) : s == 2'd1 ? 8'(a - b) : 8'd0;
```

A match expression must cover every value, either with a `_` arm or by naming
every variant of an enum. Anything short of that is reported.

```iris
// IRIS
match state {
    State::Idle => {
        next_state = State::Running;
    },
    State::Running => {
        next_state = State::Done;
    },
    _ => {
        next_state = State::Idle;
    }
}
```

```systemverilog
// SystemVerilog
case (state)
  Idle: begin
    next_state = Running;
  end
  Running: begin
    next_state = Done;
  end
  default: begin
    next_state = Idle;
  end
endcase
```

### For Loop

```iris
// IRIS
for i in 0..8 {
    data[i] = 0;
}
```

```systemverilog
// SystemVerilog
for (int i = 0; i < 8; i++) begin
  data[i] = 0;
end
```

## Memory Declarations

A `mem` declaration becomes an unpacked array. The dimension follows the signal
name, as SystemVerilog requires.

```iris
// IRIS
mod Ram[Width: uint = 8, Depth: uint = 16](
    in  clk: clock,
    in  we: bit,
    in  addr: bit[4],
    in  wdata: bit[Width],
    out rdata: bit[Width],
) {
    mem storage: bit[Width][Depth];

    sync(clk.posedge) {
        if we { storage[addr] = wdata; }
    }
    comb { rdata = storage[addr]; }
}
```

```systemverilog
// SystemVerilog
logic [Width-1:0] storage [Depth];
```

Memory attributes (`{ ports: 2, ... }`) and initialisers are not converted; each
is reported as a warning.

## System Functions

A name beginning with `$` is carried through unchanged, which is what
SystemVerilog expects.

```iris
// IRIS
mod Fifo[Depth: uint = 16, AddrWidth: uint = $clog2(Depth)](...)
```

```systemverilog
// SystemVerilog
parameter logic [31:0] AddrWidth = $clog2(Depth)
```

## Generic Parameters

Generic parameters become module parameters. Defaults are carried over,
including defaults derived from earlier parameters.

```iris
// IRIS
mod Fifo[
    DataWidth: uint = 8,
    Depth: uint = 16,
    AddrWidth: uint = $clog2(Depth),
](
    in  wr_data: bit[DataWidth],
    out addr: bit[AddrWidth],
) {
    comb { addr = 0; }
}
```

```systemverilog
// SystemVerilog
module Fifo #(
  parameter logic [31:0] DataWidth = 8,
  parameter logic [31:0] Depth = 16,
  parameter logic [31:0] AddrWidth = $clog2(Depth)
) (
  input  logic [DataWidth-1:0] wr_data,
  output logic [AddrWidth-1:0] addr
);
```

A width written in terms of a parameter stays a parameter in the output. It is
never folded to a number: doing so would turn `bit[DataWidth]` into a one-bit
port, which compiles cleanly and is wrong.

## Expression Width

**This is the rule most likely to surprise.**

IRIS evaluates arithmetic in the width of its operands. SystemVerilog widens
operands to at least 32 bits. The two disagree whenever a result is truncated in
IRIS and would not be in SystemVerilog.

```iris
// IRIS: p is bit[5] and holds 31
(p + 1) ^ ((p + 1) >> 1)
// p + 1 is 0 in five bits, so the result is 0
```

Converted naively, SystemVerilog computes `31 + 1` as 32, shifts to 16, and the
result is 16 rather than 0. To preserve the IRIS meaning, arithmetic whose width
is known is wrapped in a size cast:

```systemverilog
PtrWidth'(p + 1) ^ PtrWidth'(p + 1) >> 1
```

This matters in practice. The Gray-code pointer update of an asynchronous FIFO
has exactly this shape, and without the cast the full/empty comparison breaks the
moment the pointer wraps — the design compiles, lints cleanly, and loses data.

The cast is applied to `+`, `-`, `*` and `<<` when the operand width is known
from a declaration. Comparisons and reductions produce one bit and are left
alone.

## Instance Declarations

### Basic Instantiation

```iris
// IRIS
mod counter(
    in  clk: clock,
    out count: u8,
) {
}

mod top(
    in  clk: clock,
    out data: u8,
) {
    inst counter_inst = counter {
        clk: clk,
        count: data,
    };
}
```

```systemverilog
// SystemVerilog
module top (
  input  logic       clk,
  output logic [7:0] data
);

counter counter_inst (
  // ports connected here
);

endmodule
```

### Instantiation with Connections

```iris
// IRIS
inst alu_inst = alu {
    a: input_a,
    b: input_b,
    op: operation,
    result: output_result,
};
```

```systemverilog
// SystemVerilog
alu alu_inst (
  .a(input_a),
  .b(input_b),
  .op(operation),
  .result(output_result)
);
```

## Signal Declarations

### Local Signals

```iris
// IRIS
let temp: u8;        // Wire
var counter: u8;     // Register
```

```systemverilog
// SystemVerilog
logic [7:0] temp;         // Wire (driven in comb)
logic [7:0] counter;      // Register (driven in sync)
```

### Assignment Types

| Context | IRIS | SystemVerilog |
|---------|------|---------------|
| Combinational | `=` | `=` (blocking) |
| Sequential | `=` | `<=` (non-blocking) |
| Continuous | `assign x =` | `assign x =` |

## Literals

| IRIS | SystemVerilog | Description |
|------|---------------|-------------|
| `42` | `32'd42` | Decimal integer |
| `0xFF` | `8'hFF` | Hexadecimal |
| `0b1010` | `4'b1010` | Binary |
| `true` | `1'b1` | Boolean true |
| `false` | `1'b0` | Boolean false |

## Concatenation and Replication

### Concatenation

```iris
// IRIS
let result = {a, b, c};
```

```systemverilog
// SystemVerilog
logic [...] result = {a, b, c};
```

### Replication

```iris
// IRIS
let zeros = {8{1'b0}};
```

```systemverilog
// SystemVerilog
logic [7:0] zeros = {8{1'b0}};
```

## Bit Selection

### Single Bit

```iris
// IRIS
let bit = data[3];
```

```systemverilog
// SystemVerilog
logic bit = data[3];
```

### Range Selection

```iris
// IRIS
let nibble = data[7:4];
```

```systemverilog
// SystemVerilog
logic [3:0] nibble = data[7:4];
```

## Notes

1. **Assignment semantics**: In `comb` blocks, `=` becomes blocking assignment. In `sync` blocks, `=` becomes non-blocking assignment (`<=`).

2. **Reset handling**: Asynchronous resets are added to the sensitivity list. Synchronous resets are checked inside the always_ff block.

3. **Type inference**: IRIS performs type inference where possible, but explicit types are recommended for clarity.

4. **Width matching**: The compiler warns about width mismatches in assignments but may still generate valid SystemVerilog with implicit truncation/extension.

5. **Expression width**: IRIS evaluates arithmetic in the width of its operands; SystemVerilog widens to at least 32 bits. Arithmetic is wrapped in a size cast to keep the IRIS meaning. See [Expression Width](#expression-width) — this is the difference most likely to change behaviour silently.

6. **Parameterised widths**: A width written in terms of a generic parameter stays a parameter in the output. It is never folded to a number.

7. **Unsupported constructs**: A construct the transpiler cannot convert fails the conversion with a diagnostic. It is never skipped silently.
