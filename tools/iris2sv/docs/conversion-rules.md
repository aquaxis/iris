# IRIS to SystemVerilog Conversion Rules

This document describes how IRIS constructs are converted to SystemVerilog.

## Type System

### Primitive Types

| IRIS Type | SystemVerilog Type | Notes |
|-----------|-------------------|-------|
| `bool` | `logic` | 1-bit logic |
| `bit` | `logic` | 1-bit logic |
| `int<N>` | `logic signed [N-1:0]` | Signed N-bit |
| `uint<N>` | `logic [N-1:0]` | Unsigned N-bit |
| `clock` | `logic` | Clock signal |
| `reset` | `logic` | Reset signal |

### Examples

```iris
// IRIS
in a: bool
in b: uint<8>
in c: int<16>
out d: uint<32>
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
let data: [uint<8>; 16];
let matrix: [[uint<8>; 4]; 4];
```

```systemverilog
// SystemVerilog
logic [7:0] data [0:15];
logic [7:0] matrix [0:3][0:3];
```

### Enum Types

```iris
// IRIS
type State = enum {
    Idle,
    Running,
    Done
}
```

```systemverilog
// SystemVerilog
typedef enum logic [1:0] {
  Idle    = 2'd0,
  Running = 2'd1,
  Done    = 2'd2
} State;
```

### Struct Types

```iris
// IRIS
type Packet = struct {
    valid: bool,
    data: uint<32>,
    tag: uint<4>
}
```

```systemverilog
// SystemVerilog
typedef struct packed {
  logic        valid;
  logic [31:0] data;
  logic [3:0]  tag;
} Packet;
```

## Module Structure

### Basic Module

```iris
// IRIS
mod counter {
    in  clk: clock,
    in  rst: reset,
    in  enable: bool,
    out count: uint<8>
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
mod fifo<WIDTH: uint, DEPTH: uint> {
    in  clk: clock,
    in  data_in: uint<WIDTH>,
    out data_out: uint<WIDTH>
}
```

```systemverilog
// SystemVerilog
module fifo #(
  parameter int WIDTH = 8,
  parameter int DEPTH = 16
) (
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

## Instance Declarations

### Basic Instantiation

```iris
// IRIS
mod top {
    in clk: clock,
    out data: uint<8>,

    inst counter_inst: counter
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
inst alu_inst: alu {
    a: input_a,
    b: input_b,
    op: operation,
    result: output_result
}
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
let temp: uint<8>;        // Wire
var counter: uint<8>;     // Register
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
