# Asynchronous FIFO — IRIS Language Example

## Overview

An **asynchronous FIFO** is a buffer that passes data between two circuits running on unrelated clocks.
The write side runs on `wr_clk`, the read side runs on `rd_clk`, and there is no phase relationship between them.
The FIFO converts its pointers to Gray code before handing them to the opposite domain, which avoids the metastability that a multi-bit signal would otherwise suffer when it crosses a clock domain.

This example describes that circuit in IRIS and verifies, with iris-sim, that the data read out matches the data written in.

It exercises the following IRIS language features.

- **`sync` blocks on different clocks**: two clock domains inside one module
- **`reset(active_low: true)`**: active-low reset declaration
- **Generic parameters**: data width and depth given as `DataWidth` and `Depth`
- **`where` clause**: states what the parameters must satisfy
- **`$clog2`**: derives the address and pointer widths from the depth
- **`mem` declaration**: FIFO storage as a two-dimensional array
- **Indexed memory access**: reads and writes through `storage[addr]`
- **Bit slices**: `wr_ptr[AddrWidth - 1 : 0]` to extract the address field
- **Concatenation**: `{a, b}` to build the full-detection bit pattern
- **`comb` blocks**: combinational read data and status flags
- **Bitwise operators**: XOR and right shift for the Gray-code conversion
- **`assert ... else error(...)`**: checking the read data in the testbench
- **`$display` and `$finish`**: reporting the result and ending the run

## Directory Layout

```
example/async_fifo/
├── src/
│   ├── async_fifo.iris       # The asynchronous FIFO
│   └── async_fifo_tb.iris    # Testbench
├── sim/
│   ├── run.sh                # Simulation runner (interpreted)
│   ├── run_compiled.sh       # Simulation runner (compiled)
│   ├── output.vcd            # Waveform output
│   └── output.log            # Simulator stdout
├── sv/
│   ├── async_fifo.sv         # DUT converted by iris2sv
│   ├── async_fifo_tb.sv      # SystemVerilog testbench (hand-written)
│   └── run.sh                # SystemVerilog simulation runner
└── doc/
    ├── async_fifo.md         # Japanese documentation
    └── async_fifo_en.md      # This document
```

## Design

### Parameters

Data width and depth are generic parameters. The address and pointer widths are derived from the
depth, so a caller never has to supply them.

```rust
mod AsyncFifo[
    DataWidth: uint = 8,
    Depth: uint = 16,
    AddrWidth: uint = $clog2(Depth),
    PtrWidth: uint = $clog2(Depth) + 1,
]
where
    DataWidth >= 1,
    Depth >= 4,
(
    // Port declarations follow in the next section
) {
    // Body
}
```

Defaults are evaluated in declaration order, so overriding `Depth` at the instantiation site also
recomputes `AddrWidth` and `PtrWidth`.

The **`where` clause** states what the parameters must satisfy. Below a depth of four, `PtrWidth`
is less than three and the `[PtrWidth - 3 : 0]` slice used for full detection does not exist.
Instantiating with a value that breaks a constraint fails before the simulation starts.

```
error[O1005]: generic parameter constraint violation: Depth=2 violates constraint: Depth >= 4
  --> AsyncFifo:24:5
   = note: AsyncFifo requires: DataWidth >= 1, Depth >= 4
```

That the depth is a power of two cannot be stated in a `where` clause, which only takes
comparisons, so it remains the caller's responsibility.

### Pointers and the wrap bit

A FIFO of depth `Depth` needs a `$clog2(Depth)`-bit address.
The pointers are one bit wider, and the most significant bit serves as a **wrap bit**.
The wrap bit is what distinguishes "full" (the pointers differ by one lap) from "empty" (the pointers are identical).
Only the lower `AddrWidth` bits address the storage.

```rust
var wr_ptr: bit[PtrWidth] = 0;

storage[wr_ptr[AddrWidth - 1 : 0]] = wr_data;
```

### Gray-code synchronization

If a binary counter crosses a clock domain directly, the receiving side can capture an intermediate value at the instant several bits change together.
**Gray code** changes only one bit between adjacent values, so a failed capture still yields either the old or the new value.

The conversion is `gray = binary ^ (binary >> 1)`.
The Gray pointer is updated on the same edge as the binary pointer, so the expression uses the post-increment value.

```rust
wr_ptr = wr_ptr + 1;
wr_ptr_gray = (wr_ptr + 1) ^ ((wr_ptr + 1) >> 1);
```

The receiving domain passes the incoming Gray pointer through two flip-flops before using it.

```rust
rd_ptr_gray_sync1 = rd_ptr_gray;
rd_ptr_gray_sync2 = rd_ptr_gray_sync1;
```

### Full and empty detection

Empty holds when the read-side Gray pointer equals the synchronized write-side Gray pointer.

Full is different.
In binary terms the condition is "the top bit differs and the lower four bits match", which in Gray code becomes "the top two bits are inverted and the remaining three match".

```rust
empty = (rd_ptr_gray == wr_ptr_gray_sync2);
full  = (wr_ptr_gray == {
    ~rd_ptr_gray_sync2[PtrWidth - 1 : PtrWidth - 2],
    rd_ptr_gray_sync2[PtrWidth - 3 : 0]
});
```

Both flags are derived combinationally from the registered Gray pointers in a `comb` block.
The same block reads the word addressed by the read pointer asynchronously.

```rust
rd_data = storage[rd_ptr[AddrWidth - 1 : 0]];
```

## Testbench and Verification

`async_fifo_tb.iris` drives the write clock with a 10 ns period and the read clock with a 25 ns period.
Because the reader is 2.5 times slower, the FIFO fills up and the writer is stalled part-way through the run.
Reaching that state is what demonstrates that the Gray-code full detection works.

The write side holds `wr_en` asserted and advances to the next word only on an edge the DUT accepted, that is, an edge where `wr_en` was high and `full` was low.
Holding the data while full means none of the 40 words is lost.

```rust
if wr_en {
    if ~dut.full {
        wr_data = wr_data + 1;
        wr_count = wr_count + 1;
        ...
    } else {
        wr_en = 1;
    }
}
```

The read side captures `dut.rd_data` on every edge where the FIFO is not empty and compares it
against `expected`, a sequence starting at 0x01 and incrementing by one, so reordering or a dropped
word is detected.

The comparison happens twice over. Latching `mismatch` makes the failure visible in the waveform;
the `assert` fails the simulation and shows up in the exit status.

```rust
if ~dut.empty {
    rd_data_obs = dut.rd_data;

    if dut.rd_data != expected {
        mismatch = 1;
    }
    assert dut.rd_data == expected
        else error("read data does not match the expected value");

    expected = expected + 1;
    rd_count = rd_count + 1;

    if (rd_count + 1) == 40 {
        $display("all %0d words verified at %0d", rd_count + 1, rd_count + 1);
        $finish;
    }
}
```

`$finish` ends the run once all 40 words have been checked, so it does not wait out the requested
cycle count.

Three signals carry the verdict.

- **`wr_count`**: number of words the DUT accepted
- **`rd_count`**: number of words read and checked
- **`mismatch`**: set to 1 if any word differed from the expected value

## Running the Simulation

### Prerequisites

- Rust 1.70 or later with cargo installed

### Execution

```bash
cd example/async_fifo/sim
./run.sh
```

The cycle count can be given as an argument.
Cycles are counted in write-clock periods (10 ns), and the default is 200.

```bash
./run.sh 400
```

To run the simulator directly:

```bash
cargo run --bin iris-sim --manifest-path sim/iris-sim/Cargo.toml -- \
    -i example/async_fifo/src/async_fifo.iris \
    -i example/async_fifo/src/async_fifo_tb.iris \
    -o example/async_fifo/sim/output.vcd \
    -c 200 -v
```

### Expected result

`run.sh` prints the verdict at the end of the run.

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order
```

All 40 words were written, read back in the same order, and matched the expected values.

If the read data differs from the expected value, the `assert` reports the failure with its source
location and both operand values, and the simulator exits with status 1. The script reports FAIL in
turn.

### Running the compiled simulation

The same design can be turned into a Rust program and run from that.

```bash
cd example/async_fifo/sim
./run_compiled.sh
```

`iris-compile` turns the design into a single Rust program, builds it and runs it. The verdict is
decided exactly as in `run.sh`. At the end the script compares the result against `output.vcd` to
confirm that the compiled run produces the same waveform as the interpreter.

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order

  waveform matches the interpreter's output.vcd
```

Without the script:

```bash
cargo run --bin iris-compile --manifest-path sim/iris-sim/Cargo.toml -- \
    -i example/async_fifo/src/async_fifo.iris \
    -i example/async_fifo/src/async_fifo_tb.iris \
    -o example/async_fifo/sim/compiled/async_fifo_sim \
    --release --runtime-path sim/iris-runtime

example/async_fifo/sim/compiled/async_fifo_sim -c 200 -o output_compiled.vcd -v
```

### Viewing the waveform

```bash
gtkwave output.vcd
```

The waveform shows the following.

- `wr_clk` toggles with a 10 ns period and `rd_clk` with a 25 ns period, independently of each other
- `dut.full` first asserts around 265 ns, after which writes and reads alternate
- `dut.wr_ptr` and `dut.rd_ptr` wrap from 31 back to 0
- `mismatch` stays 0 for the whole run

## Multi-Clock Support in the Simulator

When a test module declares more than one clock, iris-sim advances time by events.
Each clock derives its next edge time from the period given in `clock(period: ...)`, and the simulator jumps to the earliest pending edge and executes only the `sync` blocks driven by that clock.
Clocks with different periods therefore toggle at their own rates, which is what lets this example run its two domains independently.

A `sync` block inside an instance fires only for the parent clock actually wired to its clock port.
Reset behaves the same way: only the signals a `sync` block drives are restored to their initial values, so a reset in one domain never disturbs the registers of the other.

The compiled backend (`iris-compile`) follows the same rules. Which clock drives which `sync` block
is decided at generation time by following the instance connections, and comes out as one function
per clock. The arithmetic and the waveform recording call the same implementation the interpreter
calls, so the two agree.

## Converting to SystemVerilog

This example can also be converted to SystemVerilog and run under a standard
simulator. The converted result lives in `example/async_fifo/sv/`.

| File | Contents |
|------|----------|
| `async_fifo.sv` | The DUT, converted from `async_fifo.iris` by iris2sv |
| `async_fifo_tb.sv` | SystemVerilog testbench (hand-written) |
| `run.sh` | Builds and runs it under Verilator |

### Running

```bash
cd example/async_fifo/sv
./run.sh
```

Pass `--regenerate` to convert from the IRIS source again.

```bash
./run.sh --regenerate
```

The result matches the IRIS run.

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order
```

### Why the testbench is hand-written

iris2sv does convert a `test` module. Clock generation from
`clock(period: 10ns)`, `$display` and `$finish`, and hierarchical access such
as `dut.full` all carry across.

Writing this one by hand is deliberate: the converted DUT is then checked by a
path that did not go through the transpiler. A transpiler defect cannot appear identically on both
sides and cancel itself out, so the check is stronger for it.

### Choice of simulator

Verilator. Icarus Verilog 12.0 cannot handle part selects inside `always_*`
blocks and reports:

```
sorry: constant selects in always_* processes are not currently supported
(all bits will be included)
```

"All bits will be included" means the full comparison becomes a different
expression from the one the design specifies. It still compiles, so skipping
past that line yields a quietly wrong answer.

### What went wrong in the conversion

IRIS evaluates arithmetic in the width of its operands; SystemVerilog widens to
at least 32 bits. The Gray-code pointer update
`(wr_ptr + 1) ^ ((wr_ptr + 1) >> 1)` has exactly that shape, and converted
naively the full comparison breaks the moment the pointer wraps, letting the
FIFO overwrite unread data.

iris2sv casts arithmetic back to the operand width to avoid this:

```systemverilog
wr_ptr_gray <= PtrWidth'(wr_ptr + 1) ^ PtrWidth'(wr_ptr + 1) >> 1;
```

Neither compilation nor linting finds this defect. It surfaced only by checking
that all forty words come back in order.

## Proving the conversion preserved the design

A testbench passing means the conversion was right for the inputs it was given.
For this design it is proven right for **every** input.

```bash
tools/formal/run.sh async_fifo
```

178 cells of 178 proven.

**Two clocks do not prevent it.** The plan was to cut the design at the
synchroniser and prove each clock domain separately, on the argument that
cycle-accurate equivalence is not defined across an asynchronous boundary. That
was not needed. `equiv_make` treats both clocks as free inputs like any other,
so the statement proven is "for any waveform on either clock, the two netlists
behave identically", and that is well-defined.

**It is not a claim that the crossing is correct.** Whether the synchroniser is
deep enough for the metastability it faces is a question about the design, not
about whether the conversion preserved it. That stays with the testbench.

Proving this design surfaced two defects in `iris2sv`. Both replaced a width
expression with a comment and then reported the conversion as successful,
producing output like `input logic [/* expr */-1:0] wr_data`. Neither occurs on
the original source; they are reached only when a round trip turns a width into
an expression.

The mechanism is in
[`doc/formal_verification_en.md`](../../../doc/formal_verification_en.md).

## Using Another Size

Passing generic arguments at instantiation produces a FIFO of that size.

```rust
inst small = AsyncFifo[DataWidth: 4, Depth: 4] {
    wr_clk: wr_clk,
    wr_rst_n: wr_rst_n,
    wr_en: wr_en,
    wr_data: wr_data,
    rd_clk: rd_clk,
    rd_rst_n: rd_rst_n,
    rd_en: rd_en,
};
```

The simulator emits one module per combination of parameters. Instantiated with the defaults, the
module listing shows `AsyncFifo__DataWidth8_Depth16_AddrWidth4_PtrWidth5`.

The depth is assumed to be a power of two no smaller than four, because the Gray-code full test
represents one lap of the pointer as an inversion of the top two bits. The lower bound is enforced
by the `where` clause.

## Limitations

- Slice bounds must be constant expressions. To select a position that varies at run time, use the
  part-select form `data[idx +: width]`.
- A `where` clause takes only comparisons (`>=`, `<=`, `==`, `!=`, `>`, `<`), so a condition such
  as "a power of two" cannot be stated.
- `match` exhaustiveness can only be checked when the scrutinee names a port or a signal; the width
  of an arbitrary expression is unknown, so the check is skipped there.

## References

- IRIS language specification: `spec/iris_spec.md`
- Chapter 3, Type System: `spec/03_type_system.md`
- Chapter 5, Combinational Logic: `spec/05_combinational_logic.md`
- Chapter 6, Sequential Logic: `spec/06_sequential_logic.md`
- Chapter 9, Operators: `spec/09_operators.md`
- Chapter 10, Memory: `spec/10_memory.md`
- Chapter 11, Verification: `spec/11_verification.md`
