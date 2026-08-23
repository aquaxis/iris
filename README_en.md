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
- **Formal equivalence**: that a design and its generated SystemVerilog agree is
  proven, not sampled
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
│   ├── iris/              # Unified command (Rust; bundles the tools as subcommands)
│   ├── irisfmt/           # Formatter, linter, language server, VSCode extension
│   ├── iris2sv/           # IRIS to SystemVerilog
│   ├── sv2iris/           # SystemVerilog to IRIS
│   ├── conformance/       # The three tools checked against each other
│   ├── formal/            # Formal equivalence: IRIS against its SystemVerilog
│   ├── schematic/         # block diagram viewer (frontend only)
│   ├── surfer-plugin/     # translator plugin for Surfer
│   └── veryl2iris/        # conversion between Veryl and IRIS
├── example/
│   ├── async_fifo/        # Asynchronous FIFO, two clock domains, with SystemVerilog
│   ├── riscv/             # RV32I processor, single cycle, 40 instructions
│   ├── counter/           # Single-clock counter, used for speed comparisons
│   └── comparison/        # Regenerates the comparison against SystemVerilog and Veryl
├── doc/                   # Investigations, such as the language comparison
└── LICENSE                # MIT License
```

## Tools

### Unified command, written in Rust

**iris**: one entry point that bundles the tools

The scattered entry points are gathered under `iris` as subcommands. `iris`
itself is Rust, has no dependencies, and hands work to each tool.

```bash
iris sim -i design.iris -o out.vcd -c 100    # iris-sim
iris compile -i design.iris -o sim --release # iris-compile
iris formal -i design.iris -o out/           # iris-formal
iris veryl import design.veryl               # veryl2iris (Veryl -> IRIS)
iris veryl export design.iris                # iris2veryl (IRIS -> Veryl)
iris fmt design.iris                         # irisfmt (format)
iris lint design.iris                        # irisfmt-lint (style check)
iris lsp                                     # irisfmt-lsp (language server)
iris sv design.iris                          # iris2sv (IRIS -> SystemVerilog)
iris from-sv design.sv                       # sv2iris (SystemVerilog -> IRIS)
```

Arguments after the command are passed through unchanged.

**Every subcommand runs a Rust tool directly; none shell out to node any
more.** The entry point is one command: `sv` = `iris2sv`, `from-sv` = `sv2iris`,
and `fmt`/`lint`/`lsp` = `irisfmt`. `fmt` passes the conformance suite, and
`lint`/`lsp` carry the same rule set and features as the former TypeScript
tools. Only `iris schematic` — the browser viewer's dev server (`npm run dev`)
— still needs npm.

A Rust tool's location can be overridden with `IRIS_<TOOL>_BIN`.

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

**iris-formal**: the reference model for formal equivalence checking

It emits a structural SystemVerilog model of an IRIS design. That model is what
`iris2sv`'s output is proven against, and `tools/formal` drives it.

```bash
cargo run --release --bin iris-formal -- -i input.iris -o out/
```

**iris-runtime**: the runtime library

It provides IRIS values and the operations on them, waveform recording, and VCD
output. The interpreter and the executables the compiler produces both use it,
so a design gives the same result whichever way it is run.

### Utilities, written in Rust

**irisfmt**: formatter, linter, language server

Formats IRIS source (`iris fmt`) and checks it against coding conventions
(`iris lint`). It also ships a language server (`iris lsp`). All are ported to
Rust (`tools/irisfmt-rs`, `tools/irisfmt-lsp-rs`) and never invoke node.
The VSCode extension (`tools/irisfmt/packages/vscode-iris`) connects to that
language server.

The extension supports the editor in two layers.

| Layer | What it does | When it works |
|---|---|---|
| Syntax highlight | Colors keywords, types, numbers and operators | The grammar file alone is enough |
| Language server | Diagnostics, formatting, completion, hover, go to definition, find references, rename | The server must be built and running |

Syntax highlighting works even where the language server does not.
See [`doc/editor_en.md`](./doc/editor_en.md) for usage and the range of
syntax it covers.

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

**tools/formal**: formal equivalence checking

It proves that an IRIS design and the SystemVerilog `iris2sv` produces from it
are the same circuit, for every input and in every reachable state.

```bash
tools/formal/run.sh
```

All six designs in `example/` are proven, with no bound.

| Design | Against its IRIS | Round trip |
|---|---|---|
| `alu`, `decoder` | proven | proven |
| `counter`, `regfile` | proven | proven |
| `async_fifo` | proven | proven |
| `riscv_core` | proven | proven |

The round trip is `iris2sv` to `sv2iris` and back to `iris2sv`.

**Vectors can only find a difference; they cannot establish there is none.** The
benches in `example/comparison/equiv/` drive 33,024 inputs, which is under
10^-15 of the ALU's 2^68 input space.

There are three verdicts and no others: proven, disproven with a counterexample,
or not attempted with the reason. **A skip is not a pass.**

The mechanism is in [`doc/formal_verification_en.md`](./doc/formal_verification_en.md),
the usage in [`tools/formal/README.md`](./tools/formal/README.md).

**tools/schematic**: block diagram viewer

Draws how the modules of an IRIS design are wired together, in a browser.
**Frontend only; no server is required.** The parser `@iris2sv/core` is already
TypeScript, so the `.iris` files you pick never leave the browser.

```bash
cd tools/schematic && npm install && npm run dev
```

![Block diagram of RiscvCore](./doc/images/schematic_riscv_core.png)

There are three kinds of box: instances (blue), boundary ports (amber) and
registers (grey). Registers are boxes so that a traced edge cannot cross one
and claim a value arrives in the same cycle when it arrives in the next.

**Half of an IRIS design's wiring is not written down.**

| Subject | Nodes | Stated edges | Traced edges |
|---|---|---|---|
| `RiscvCore` | 16 | 4 | **20** |
| All of `example/` and `fixtures/` | 32 | 12 | **27** |

20 of `RiscvCore`'s 24 edges appear only after walking `comb` and `sync`.

Details are in [`doc/schematic_en.md`](./doc/schematic_en.md) and
[`tools/schematic/README.md`](./tools/schematic/README.md).

**tools/surfer-plugin**: a translator plugin for Surfer

An extension for reading waveforms in [Surfer](https://surfer-project.org/).
**Surfer itself is not bundled.**

```bash
iris-sim -i design.iris -o out.vcd --dump-arrays
surfer out.vcd
```

![A memory array expanded in Surfer](./doc/images/surfer_memory_array.png)

With `--dump-arrays`, a `mem` reaches the waveform as a scope with one variable
per element. `64` to `67` above are words 64 to 67 of `mem dmem`.

| | `$var` count |
|---|---|
| Default | 91 |
| `--dump-arrays` | 1147 (1024 words of `dmem`, 32 of `regs`) |

A signed `int[N]` is written as `$var integer`, so negative values display as
negative.

Details are in [`doc/surfer_plugin_en.md`](./doc/surfer_plugin_en.md) and
[`tools/surfer-plugin/README.md`](./tools/surfer-plugin/README.md).

**tools/veryl2iris**: conversion between Veryl and IRIS

Converts source between IRIS and [Veryl](https://veryl-lang.org/).

```bash
veryl2iris design.veryl    # Veryl -> IRIS
iris2veryl design.iris     # IRIS  -> Veryl
```

**Neither language's specification changes, so it is complete only over the
subset they share.** Anything outside it is refused with a source position,
never dropped.

| Kind of refusal | Example |
|---|---|
| The language has no counterpart | `tri`, `bind` (Veryl side); `fsm`, `rand` (IRIS side) |
| This converter has not caught up | `interface`, `function`, multi-value case arms |

`tools/conformance/run.sh` checks that a round trip still simulates the same.
All six designs in `example/` round-trip. 29 of the 30 rows marked `Exact`
in the correspondence table have a round trip of their own; the table records
why the other 1 does not. Pass
files that belong together as one project.

```bash
iris2veryl decoder.iris regfile.iris alu.iris riscv_core.iris
```

Details are in [`doc/veryl_en.md`](./doc/veryl_en.md) and
[`tools/veryl2iris/README.md`](./tools/veryl2iris/README.md).

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

- **Rust** (rustc, cargo): to build the simulator and every tool
- **Node.js** and **npm**: only for `iris schematic` (the browser block-diagram
  viewer) and the VSCode extension. The CLI tools do not need it.

### Building and running the simulator and tools

```bash
# Build iris-sim
cd sim/iris-sim
cargo build --release

# Run a simulation
cargo run --bin iris-sim -- path/to/your_design.iris

# The transpilers, formatter, linter and LSP each build with cargo
cargo build --release --manifest-path tools/iris2sv-rs/Cargo.toml
cargo build --release --manifest-path tools/sv2iris-rs/Cargo.toml
cargo build --release --manifest-path tools/irisfmt-rs/Cargo.toml
cargo build --release --manifest-path tools/irisfmt-lsp-rs/Cargo.toml
cargo build --release --manifest-path tools/iris/Cargo.toml   # the iris dispatcher
```

Every CLI subcommand (`sim`/`compile`/`formal`/`veryl`/`sv`/`from-sv`/`fmt`/
`lint`/`lsp`) is Rust and never invokes node; only `iris schematic`'s browser
dev server uses npm.

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

## Documentation

The `doc/` directory holds the reference material. Japanese is the default;
files ending in `_en` are the English editions.

| Document | Contents |
|---|---|
| [Language comparison](./doc/language_comparison_en.md) | IRIS, SystemVerilog and Veryl: syntax, size, speed |
| [Interworking with Veryl](./doc/veryl_en.md) | What converts between the two languages, and what does not |
| [Formal equivalence](./doc/formal_verification_en.md) | Proving an IRIS design and its generated SystemVerilog are the same circuit |
| [Specification gaps](./doc/grammar_gaps_en.md) | Examples in the specification that do not parse |
| [Block diagram viewer](./doc/schematic_en.md) | Drawing module interconnection in a browser |
| [Waveforms in Surfer](./doc/surfer_plugin_en.md) | Reading waveforms, with `mem` expanded element by element |
| [Editor support](./doc/editor_en.md) | Syntax highlighting and the language server in VSCode |
| [The iris command](./doc/iris_en.md) | The unified command that bundles the tools |

The `report_*.md` files at the repository root are **working records**, not
reference material. They keep the reasoning, the measurements, and the
mistakes made along the way.

| | What it is | Who reads it |
|---|---|---|
| `doc/*.md` | What the result does and how to use it | Someone using the tools |
| `report_*.md` | The record of a piece of work | Someone following the work |

## Current status

- **Version**: 0.8.0, in development
- **Specification dated**: 2026-08-09
- **SystemVerilog target**: conformance with IEEE 1800-2017
- **Formal equivalence**: all six designs in `example/` proven equivalent to their generated SystemVerilog, with no bound (`tools/formal/run.sh`)
- **Visualisation**: block diagrams in the browser (`tools/schematic`), and waveforms in Surfer with `mem` expanded element by element (`iris-sim --dump-arrays`)

## Licence

[MIT License](./LICENSE)
