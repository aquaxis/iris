# RV32I Processor — IRIS Language Example

## Overview

**RV32I** is the RISC-V base integer instruction set: thirty-two 32-bit registers and
only forty instructions.
This example implements it as a single-cycle processor written in IRIS, and shows with
iris-sim that all forty instructions behave as the specification requires.

The nature of the verification differs from earlier examples.
The asynchronous FIFO was checked against itself — forty words written, forty words read
back. A processor has an external standard.
`ADDI x1, x0, 5` leaves 5 in `x1` because the RISC-V specification says so, not because
our testbench agrees with our design.

It exercises the following IRIS features.

- **`match` for multi-way selection**: instruction decoding and ALU operation select
- **`mem` declarations**: the 32-entry register file and data memory
- **Bit slices and concatenation**: extracting instruction fields, building immediates
- **`.sign_extend[N]()` / `.extend[N]()`**: sign and zero extension
- **`int[N]` types**: signed comparison for `SLT` and `BLT`
- **Arithmetic right shift `>>>`**: `SRA`
- **Generic parameters**: the data memory word count
- **Instance hierarchy**: core, decoder, ALU, register file

## Directory Layout

```
example/riscv/
├── src/
│   ├── riscv_core.iris        # Core datapath and control
│   ├── decoder.iris           # Decoder
│   ├── alu.iris               # ALU
│   ├── regfile.iris           # Register file
│   ├── test_alu.iris          # Arithmetic and logic instructions
│   ├── test_mem.iris          # Memory, branches and jumps
│   └── test_sys.iris          # System instructions
├── sim/
│   ├── run.sh                 # Run under the interpreter
│   ├── run_compiled.sh        # Run under the compiled backend
│   └── output_*.vcd           # Waveform output
├── sv/
│   ├── *.sv                   # Core and ROMs converted by iris2sv
│   ├── riscv_tb.sv            # SystemVerilog testbench (hand-written)
│   └── run.sh                 # Run under Verilator
└── doc/
    ├── riscv.md               # Japanese documentation
    └── riscv_en.md            # This document
```

## Design

### Microarchitecture

Single-cycle. Fetch, decode, execute, memory access and write-back all happen in one
clock.

Not pipelining is deliberate. The subject is the instruction set, not the
microarchitecture. A pipeline brings hazards and forwarding, whose bugs have nothing to
do with whether `SRAI` sign-extends correctly.

```
        ┌──────────────┐
   PC ──┤ Instruction  ├── instr ──┬── Decoder ── control, immediate
        │     ROM      │           │
        └──────────────┘           ├── RegFile ── rdata1, rdata2
                                   │      ▲
                                   │      └── write-back
                                   └── ALU ── result ── data memory
```

Instruction memory sits outside the core. It drives `imem_addr` and receives
`imem_rdata`, so a different ROM can be connected for each test program.

### Register file

Thirty-two 32-bit registers held in a `mem`, with two read ports — RV32I's
register-register operations need `rs1` and `rs2` at once.

`x0` reads as zero by definition, which takes two separate measures.

```rust
sync(clk.posedge, rst_n.async) {
    if we {
        if waddr != 5'd0 {      // discard writes to x0
            regs[waddr] = wdata;
        }
    }
}

comb {
    // x0 returns zero without reading storage
    rdata1 = if raddr1 == 5'd0 { 32'd0 } else { regs[raddr1] };
}
```

Discarding the write is not enough on its own. Without forcing zero on the read side,
the storage's pre-reset contents would be visible.

### Building immediates

RV32I has five instruction formats and each places its immediate bits differently.
`B` and `J` are the awkward ones: branch targets are two-byte aligned, so the low bit is
omitted and the remaining bits are scattered.

| Format | Assembled from |
|--------|----------------|
| I | `instr[31:20]` |
| S | `instr[31:25]`, `instr[11:7]` |
| B | `instr[31]`, `instr[7]`, `instr[30:25]`, `instr[11:8]`, `0` |
| U | `instr[31:12]` in the high bits, low twelve zero |
| J | `instr[31]`, `instr[19:12]`, `instr[20]`, `instr[30:21]`, `0` |

In IRIS, concatenate and then sign-extend.

```rust
imm_b = {instr[31], instr[7], instr[30:25], instr[11:8], 1'b0}.sign_extend[32]();
imm_j = {instr[31], instr[19:12], instr[20], instr[30:21], 1'b0}.sign_extend[32]();
```

Specification §9.7.2 shows the replication idiom `{{20{instr[31]}}, instr[31:20]}`, but
replication is not accepted by iris-sim. Use `.sign_extend[N]()`.

### Signedness

There are two pairs where a mistake still produces working-looking hardware.

| Pair | Difference |
|------|------------|
| `SLT` vs `SLTU` | signed vs unsigned comparison |
| `SRA` vs `SRL` | arithmetic vs logical right shift |

IRIS distinguishes them through an `int[32]` intermediate.

```rust
var sa: int[32] = 0;
var sb: int[32] = 0;
comb {
    sa = a;
    sb = b;
    y = match op {
        4'd3 => if sa < sb { 32'd1 } else { 32'd0 },   // SLT,  signed
        4'd4 => if a < b { 32'd1 } else { 32'd0 },     // SLTU, unsigned
        ...
    };
}
```

### Data memory

Held word-wise (`mem dmem: bit[32][DataWords]`). Byte and halfword accesses select a
position within the word using `addr[1:0]`. A write reads the word, replaces the
relevant part, and writes it back.

Alignment is not checked; `addr[1:0]` is used directly as the position within the word.

### Halting

`ECALL` and `EBREAK` both halt. They raise `halted` so the testbench can observe it.
No trap is implemented — that is outside RV32I.

`FENCE` retires as a no-op: there is no memory ordering to enforce.

## Verification

### Where the expected values come from

Expected values are derived by hand from the RISC-V specification. **Never from what the
core produced.** Working backwards from the core's output verifies nothing.

Instruction encodings come from `riscv64-unknown-elf-as`. Hand-encoding invites
mistakes, and the assembler is the more authoritative source.

### How it runs

Once the core halts, registers `x0` through `x31` are read one per cycle and compared
against an expected table.

```
=== TestAlu ===
  instructions verified: 21
  registers checked:     32
  mismatches:            0
  RESULT: PASS
```

Register contents are observed through a debug port (`dbg_addr` / `dbg_data`).
Reading them hierarchically as `core.rf.regs[1]` also works, but the port puts what
the testbench observes into the module's declaration.

### Choosing values that catch a mix-up

Where a plausible mistake yields a plausible answer, the test uses values that
distinguish the two behaviours.

| Instruction | The mistake that still looks reasonable | Distinguishing value |
|---|---|---|
| `SRA` / `SRL` | arithmetic vs logical | `-16 >> 5` is `0xFFFFFFFF` or `0x07FFFFFF` |
| `SLT` / `SLTU` | signedness | `-1 < 1` is true, `0xFFFFFFFF < 1` is false |
| `LB` / `LBU` | sign vs zero extension | `0xEF` becomes `0xFFFFFFEF` or `0x000000EF` |
| `LH` / `LHU` | as above | `0xCDEF` becomes `0xFFFFCDEF` or `0x0000CDEF` |
| `BLT` / `BLTU` | signedness | compare a negative against a small positive |
| `JALR` | forgetting to clear the low bit | make the target odd, check the landing PC is even |
| `AUIPC` | adding to the next PC | compare against `jal`'s link value |
| `x0` | allowing a write to land | after `addi x0, x0, 7`, check `x0` is zero |

The `AUIPC` check is written to be independent of instruction placement.

```
    jal x27, next       # x27 = address of the next instruction
next:
    auipc x28, 0        # x28 = address of this instruction
    sub  x29, x28, x27  # anything but zero means one of them is wrong
```

### The timeout

If the core never halts, the verification never runs. Rather than finish quietly and
look like success, the testbench gives up after 400 cycles.

```
=== TestSys ===
  RESULT: FAIL - core did not halt within 400 cycles
```

This is not a theoretical worry. Deliberately breaking `AUIPC` also changed `JAL`'s
target, the core ran away, and before the timeout existed the run printed nothing and
reported success.

### Breaking it on purpose

A test that cannot fail is worth nothing. Before trusting a PASS, each was confirmed to
turn into a FAIL.

| Break | Result |
|-------|--------|
| `SRA` as a logical shift | 2 failures |
| `SLT` as unsigned | 1 failure |
| `LB` zero-extending | 2 failures |
| `BLTU` as signed | 1 failure |
| `JALR` not clearing the low bit | 3 failures |
| `AUIPC` using the next PC | FAIL by timeout |
| `ECALL` not halting | FAIL by timeout |

## Running the Simulation

### Prerequisites

- Rust 1.70 or later with cargo installed

### Execution

```bash
cd example/riscv/sim
./run.sh
```

For the compiled backend:

```bash
./run_compiled.sh
```

### Expected result

```
=== Summary ===
  instructions verified: 40 / 40
  RESULT: PASS - all 40 RV32I instructions behave as the specification requires
```

Broken down as follows.

| Test | Instructions | Count |
|------|--------------|-------|
| `test_alu` | 10 R-type, 9 I-type, `LUI`, `EBREAK` | 21 |
| `test_mem` | 5 loads, 3 stores, 6 branches, `JAL`/`JALR`, `AUIPC` | 17 |
| `test_sys` | `FENCE`, `ECALL` | 2 |

`EBREAK` is verified by `test_alu` and `test_mem` halting on it. If it did not halt, the
timeout would turn the run into a FAIL.

## Converting to SystemVerilog

The core can be converted to SystemVerilog and run under a SystemVerilog
simulator. The result lives in `example/riscv/sv/`.

| File | Contents |
|------|----------|
| `regfile.sv`, `alu.sv`, `decoder.sv`, `riscv_core.sv` | The core, converted by iris2sv |
| `rom_alu.sv`, `rom_mem.sv`, `rom_sys.sv` | The instruction ROMs, converted by iris2sv |
| `riscv_tb.sv` | SystemVerilog testbench (hand-written) |
| `run.sh` | Builds and runs it under Verilator |

### Running

```bash
cd example/riscv/sv
./run.sh
```

Pass `--regenerate` to convert from the IRIS source again. The result matches
the IRIS run.

```
=== Summary ===
  instructions verified: 40 / 40
  RESULT: PASS - the converted core behaves as the specification requires
```

### The instruction ROMs are not hand-written

Only the testbench is. iris2sv can convert a `test` module; not using it here
is deliberate, so that the converted core is checked by a path that did not go
through the transpiler.

A ROM is a `mod`, so it converts. It lives in the same file as the `test`
module, so it is extracted first. Copying forty instruction encodings by hand
would only invite transcription errors; they stay in one place, in the IRIS
source.

The expected values come from the same source that generated the IRIS tests, so
the two versions cannot drift apart.

### What had to be fixed to convert it

Three defects in iris2sv stood in the way. All three are constructs the
specification defines and `iris-sim` executes; only iris2sv disagreed.

| Defect | Detail |
|---|---|
| `match` expressions | Defined by specification chapter 5, yet refused. Now a chain of conditional operators |
| `.sign_extend[N]()` | The shape of a width-carrying method call could not be parsed |
| `{` after `=>` | Concatenation and block were not told apart; everything was read as a block |

A `match` expression becomes a conditional chain. Lifting it into an
`always_comb` `case` with a temporary was the alternative, but a temporary is a
signal and signals settle: in a single-cycle core, a badly placed one reads a
stale value. The long line was preferred over changing evaluation order.

### Breaking it on purpose

That the conversion succeeds says nothing on its own. **The converted `.sv` was
broken directly** to confirm the check can fail.

| Break | Result |
|-------|--------|
| None (control) | PASS |
| I-type immediate not sign-extended | FAIL |
| `LB` zero-extending | FAIL |
| `SRA` as a logical shift | FAIL |
| Never halting | FAIL by timeout |

### Choice of simulator

Verilator. Icarus Verilog cannot handle part selects inside `always_*` blocks,
and this core is full of them.

## Simulator limitations met along the way

Four defects surfaced while writing this example. None produced a diagnostic;
only the value was quietly wrong. **All four are now fixed.** The history is
kept here.

A processor is dense with intermediate signals, hierarchical access and bit
slicing — far denser than a FIFO, which is why they surfaced.

### The four that were fixed

| Defect | Symptom | Behaviour now |
|---|---|---|
| Module-level `let` | Initialised from a non-constant, evaluated once at time zero and never again | A continuously driven wire (specification §4.3.2) |
| Slicing an instance output | `u.y[1:0]` returned zero | Reads correctly |
| Reading an instance's `mem` | `u.m[1]` returned zero | Works at any depth |
| Unknown method | `.sext[32]()` returned zero | Reported as `O1006` |

The second did the real damage. With `alu.y[1:0]` always zero, every offset load
and store addressed the base word; reads 18 to 24 returned 34 to 40 because the
FIFO-like overwrite had already happened.

All of them compile and lint cleanly. They surfaced only by checking that forty
instructions produce the values the specification requires.

### What remains

Every defect found in this example is now fixed.

Hierarchical `mem` reads work at any depth.

```rust
comb { x = u.m[1]; }              // one level
comb { x = core.rf.regs[1]; }     // two levels
```

The example keeps its debug port (`dbg_addr` / `dbg_data`) anyway. It is no
longer required, but it puts what the testbench observes into the module's
declaration, which reads better.

### About how this example is written

Before those four were fixed, the workarounds were:

- every intermediate signal a `var`, assigned in a `comb` block
- instance outputs copied into a `var` before slicing
- a debug read port (`dbg_addr` / `dbg_data`) on the register file

None is required now. The example keeps them: `var` plus `comb` reads naturally
for a single-cycle design, and the debug port puts the testbench's intent into
the declaration. The example keeps them anyway: `var` plus `comb` reads
naturally for a single-cycle design, and the debug port makes plain what the
testbench is looking at.

## Limitations

- Single-cycle; not pipelined
- No privileged architecture, CSRs, interrupts or traps. `ECALL` and `EBREAK` merely halt
- Compressed (`C`) and multiply/divide (`M`) extensions are out of scope
- Alignment is not checked; unaligned accesses treat `addr[1:0]` as a position within the word
- Instruction memory is a `match` on the address, because `mem` initialisers are not
  available in iris-sim. Changing the program means editing the ROM module

## References

- [RISC-V Instruction Set Manual, Volume I: Unprivileged ISA](https://riscv.org/technical/specifications/)
- [IRIS Language Specification](../../../spec/iris_spec.md)
- [iris-sim reference](../../../sim/iris-sim/docs/reference.md)
- [Asynchronous FIFO example](../../async_fifo/doc/async_fifo_en.md)
