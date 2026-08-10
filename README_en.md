# IRIS

**(Immutable RTL, Intentional Semantics)**

IRIS is a hardware description language for writing combinational and sequential
circuits. It aims to be a low-level language that looks high-level, readable and
writable by people and by AI alike.

It sets out to remove SystemVerilog's complexity and borrow Rust's design ideas:
where SystemVerilog has about 220 reserved words, IRIS covers what RTL design
needs with 58.

## Design principles

| Principle | What it means |
|---|---|
| **Safety first** | No implicit conversion; a bit-width mismatch is a compile error |
| **Explicit over implicit** | Intent is written down, not inferred |
| **Concision** | Brace notation, one set of data types, one assignment operator |
| **Composability** | Modules coupled loosely |
| **Synthesis apart from verification** | Synthesisable code and verification code are clearly separated |

## Main features

- **One assignment operator**: the confusion between blocking (`=`) and
  non-blocking (`<=`) is gone; `=` is used throughout, and a `sync` block gives
  it sequential semantics
- **Immutable signals**: `let` declares an unchanging signal; a mutable one is
  declared explicitly with `var`
- **Rust-like syntax**: `match` expressions, generics and pattern matching
- **Type safety**: no implicit conversion, bit widths checked at compile time,
  conversions written out
- **No multiple drivers**: two places driving one signal is caught at compile
  time
- **Synthesis by context**: `comb` blocks are combinational, `sync` blocks are
  sequential, and the two do not mix
- **A syntax for state machines**: `fsm` blocks describe them directly
- **Verification in the language**: test syntax, assertions and coverage,
  without UVM

## Compared with SystemVerilog

| Feature | SystemVerilog | IRIS |
|---|---|---|
| Blocks | `begin ... end` | `{ ... }` |
| Declaration (combinational) | `wire [7:0] data` | `let data: bit[8];` |
| Declaration (sequential) | `reg [7:0] data` | `var data: bit[8];` |
| Branching | `case ... endcase` | `match { ... }` |
| Combinational logic | `assign` / `always_comb` | `let` / `comb { }` |
| Sequential logic | `always_ff @(posedge clk)` | `sync(clk.posedge) { }` |
| Modules | `module ... endmodule` | `mod ... { }` |
| Assignment | `=` (blocking) / `<=` (non-blocking) | `=` (one form) |
| Reserved words | about 220 | 58 |

IRIS's count comes from specification §2.4. SystemVerilog's figure of about 220
is carried from the specification and was not recounted.

### Simulation speed

A counter over 20 million cycles, run three times, median reported.

| | Time | Cycles/s |
|---|---|---|
| IRIS compiled (`iris-compile`) | 0.47 s | 42.6M |
| Verilator (C++ harness calling `eval()`) | 0.56 s | 35.7M |

Both are driven by a native loop and built with `-O3` and link-time
optimisation. Without matching those settings the comparison measures build
flags rather than simulators.

The margin depends on the design. On one with 32-bit arithmetic it narrows to a
factor of 1.06. The counter is a design that suits IRIS.

Four-state modelling (0, 1, X, Z) has not been given up. Verilator by default
models two.

Comparisons with other languages, and the advantages and disadvantages of each,
are collected in [Language comparison](./doc/language_comparison_en.md).

## Examples

### A counter module

```rust
/// An eight-bit counter
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    // A mutable signal, that is, a register
    var counter: bit[8] = 0;

    // Sequential logic
    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    // Combinational logic driving the output
    comb {
        count = counter;
    }
}
```

### A state machine, traffic lights

```rust
fsm TrafficLight(clk.posedge, rst.async) {
    // Each light is decided by the state alone, so it goes on the state
    state enum {
        Red    [red_light = 1, yellow_light = 0, green_light = 0],
        Green  [red_light = 0, yellow_light = 0, green_light = 1],
        Yellow [red_light = 0, yellow_light = 1, green_light = 0],
    }
    initial: Red

    var timer: bit[8] = 0;

    transitions {
        Red => {
            when timer >= 8'd100 { timer = 0; goto Green; }
            when 1 { timer = timer + 1; }
        }
        Green => {
            when timer >= 8'd80 { timer = 0; goto Yellow; }
            when 1 { timer = timer + 1; }
        }
        Yellow => {
            when timer >= 8'd20 { timer = 0; goto Red; }
            when 1 { timer = timer + 1; }
        }
    }

    output encoding: onehot
}
```

## Project layout

```
iris/
├── spec/                  # Language specification, 21 chapters
├── sim/
│   ├── iris-sim/          # Simulator: interpreter and compiler
│   └── iris-runtime/      # Values, operations, waveforms, shared by both
├── tools/
│   ├── irisfmt/           # Formatter and linter
│   ├── iris2sv/           # IRIS to SystemVerilog
│   ├── sv2iris/           # SystemVerilog to IRIS
│   └── conformance/       # The three tools checked against each other
├── example/
│   ├── async_fifo/        # Asynchronous FIFO, two clock domains, with SystemVerilog
│   ├── riscv/             # RV32I processor, single cycle, 40 instructions
│   ├── counter/           # Single-clock counter, used for speed comparisons
│   └── comparison/        # Regenerates the comparison against SystemVerilog and Veryl
├── doc/                   # Investigations, such as the language comparison
└── LICENSE                # MIT License
```

## Tools

### Simulation, written in Rust

**iris-sim**: the IRIS simulator

It offers two ways of running a design, an interpreter and a compiler.

```bash
# Interpreter, running the design directly
cargo run --bin iris-sim -- -i input.iris -o output.vcd -c 100

# Compiler, producing a Rust executable
cargo run --bin iris-compile -- -i input.iris -o input_sim --release
./input_sim -c 100 -o output.vcd
```

Both accept the same designs and produce the same waveforms. In a release build
the compiler is about 93 times faster than the interpreter.

**iris-runtime**: the runtime library

It provides IRIS values and the operations on them, waveform recording, and VCD
output. The interpreter and the executables the compiler produces both use it,
so a design gives the same result whichever way it is run.

### Utilities, written in TypeScript

**irisfmt**: formatter and linter

Formats IRIS source and checks it against coding conventions.

**iris2sv**: IRIS to SystemVerilog

Converts IRIS source into SystemVerilog so that existing EDA tools can use it.
Modules, generic parameters, `comb` and `sync` blocks, `mem`, instances, `fsm`,
`enum`, `struct`, `union`, `interface`, `fn`, `extern mod`, `package` and
testbenches all convert. A construct it cannot handle fails with a diagnostic
rather than being silently ignored. See the
[iris2sv README](./tools/iris2sv/README.md) for what is covered.

**sv2iris**: SystemVerilog to IRIS

Converts existing SystemVerilog into IRIS, to help move a legacy codebase over.
It reads a testbench's timing (`#5ns`, `initial`), but IRIS drives both clock
and reset from their declarations, so there is nowhere for those to go and it
says so.

**tools/conformance**: the three tools checked against each other

Runs every design through all three and enforces these invariants:

- Whatever a printer writes, `iris-sim` reads and evaluates
- Whatever `iris-sim` reads, `iris2sv` and `irisfmt` read
- Formatting, and converting and converting back, leave the simulation result
  unchanged
- A converted testbench under Verilator agrees with `iris-sim`
- Input a tool cannot handle produces a diagnostic, never silence

```bash
tools/conformance/run.sh
```

## Sample designs

**example/async_fifo**: an asynchronous FIFO, two clock domains, Gray-coded
pointer synchronisation

Its behaviour is checked three ways, and all three agree.

```bash
cd example/async_fifo/sim && ./run.sh              # interpreter
cd example/async_fifo/sim && ./run_compiled.sh     # compiled
cd example/async_fifo/sv  && ./run.sh              # SystemVerilog, via Verilator
```

**example/riscv**: an RV32I processor, single cycle

It implements the 40 instructions of the RISC-V base integer set. The expected
values are derived from the RISC-V specification, and the instruction encodings
are assembled with `riscv64-unknown-elf-as`.

```bash
cd example/riscv/sim && ./run.sh              # interpreter
cd example/riscv/sim && ./run_compiled.sh     # compiled
cd example/riscv/sv  && ./run.sh              # SystemVerilog, via Verilator
```

The same core gives the same answers on all three.

```
  instructions verified: 40 / 40
  RESULT: PASS - all 40 RV32I instructions behave as the specification requires
```

**example/counter**: a single-clock counter.
Used for comparing the speed of the two execution modes.

## Getting started

### Prerequisites

- **Rust** (rustc, cargo): to build the simulator
- **Node.js** (18.0.0 or later) and **pnpm**: to build the TypeScript tools

### Building and running the simulator

```bash
# Build iris-sim
cd sim/iris-sim
cargo build --release

# Run a simulation
cargo run --bin iris-sim -- path/to/your_design.iris
```

### Building the TypeScript tools

```bash
# iris2sv, for example
cd tools/iris2sv
pnpm install
pnpm build
```

`package.json` names `pnpm@9.0.0` as its `packageManager`, so running under
pnpm 10 may fail while it tries to switch versions. Disable the switch:

```bash
pnpm install --config.manage-package-manager-versions=false
pnpm -r --config.manage-package-manager-versions=false build
```

## Language specification

The full specification is in [spec/iris_spec.md](./spec/iris_spec.md), in 21
chapters covering the topics below.

| Chapter | Title | Contents |
|---|---|---|
| 1 | Overview | Design principles, comparison with SystemVerilog |
| 2 | Lexical structure | Reserved words, literals, operators |
| 3 | Type system | Primitive types, composite types, generics |
| 4 | Module definition | Ports, signals, instantiation |
| 5 | Combinational logic | `let` declarations, `comb` blocks |
| 6 | Sequential logic | `sync` blocks, clocks and resets |
| 7 | State machines | Describing an FSM |
| 8 | Interfaces | Views and connection rules |
| 9 | Operators | Arithmetic, bitwise, comparison, logical |
| 10 | Memory | RAM and ROM declarations |
| 11 | Verification | Tests, assertions, coverage |
| 12 | Package system | Imports and visibility |
| 13 | Attributes | Synthesis directives, hierarchy control |
| 14 | Error messages | The error code scheme |
| 15 | Migration guide | Converting SystemVerilog to IRIS |
| 16 | Grammar | The complete grammar in EBNF |
| 17 | Sample code | Counters, FIFOs, AXI, SPI and others |
| 18 | Glossary | Definitions of the terms used |
| 19 | FAQ | Common questions |
| 20 | Tutorial | A guide for newcomers |
| 21 | IDE guide | Setting up VS Code, Neovim and others |

## File extensions

| Extension | Meaning |
|---|---|
| `.iris` | **Preferred.** The formal extension, recommended for projects |
| `.irs` | A short form, treated identically |

Every IRIS tool (`iris-sim`, `irisfmt`, `iris2sv` and the rest) accepts both.

## Current status

- **Version**: 0.4.0, in development
- **Specification dated**: 2026-08-09
- **SystemVerilog target**: conformance with IEEE 1800-2017

## Licence

[MIT License](./LICENSE)
