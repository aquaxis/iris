# Formal Equivalence Verification for IRIS

## What this covers

The machinery that proves an IRIS design and the SystemVerilog `iris2sv`
produces from it are the same circuit.

```bash
tools/formal/run.sh
```

It returns three verdicts and nothing else.

| Verdict | Meaning |
|---|---|
| proven | They agree for every input, in every reachable state |
| disproven | They differ, and a counterexample is printed |
| skipped | No attempt was made, and the reason is printed |

**A missing error is never read as success.** `sat` without `-prove-asserts`
exits 0 on a proof that never finished. `equiv_status` without `-assert` exits 0
with unproven cells left in the design. Both produce output that reads like
success.

## Why vectors are not enough

`example/comparison/equiv/` already compares the two circuits.

| Bench | What it drives | Checks |
|---|---|---|
| `alu_equiv.sv` | 16 operations × 64 edge pairs, then 16 × 2000 random | 33,024 |
| `ctr_equiv.sv` | 500 clocked steps, then a reset pulse | 501 |

The ALU's input space is 4 + 32 + 32 bits, so 2^68 combinations. 33,024 vectors
is under 10^-15 of it.

The edge values are well chosen: `0x8000_0000` and `0x7FFF_FFFF` are there
because SLT/SLTU and SRA/SRL agree everywhere except at the sign boundary. A
well-chosen sample is still a sample.

**Vectors can only find a difference. They cannot establish there is none.**

## What is being proven

"Equivalent" is not one statement, so the word is pinned down before any tool is
chosen.

| Class | Statement | Method |
|---|---|---|
| Combinational | Every output agrees for every input assignment | SAT over the miter |
| Sequential, bounded | Outputs agree for `k` cycles from a common reset state | BMC |
| Sequential, unbounded | Outputs agree in every reachable state, for every input, forever | Temporal induction |

**The `proven` this flow returns is the third.** A `proven` with no bound stated
has no bound.

If induction does not close, the result is not reported as `proven`. Reporting a
bounded result as unbounded is the worst outcome this work could produce.

### What the statement is silent about

Five things are excluded by construction. Each is a deliberate limit.

**X and Z.** After `prep`, yosys reasons over two values. IRIS has no X in its
type system, so nothing is lost on the reference side; a difference in X
propagation on the implementation side is invisible here. Verilator's four-state
simulation remains the check for that.

**Timing.** Both models are cycle-level. Equal outputs every cycle says nothing
about whether the netlist meets timing.

**That a clock crossing is correct.** `example/async_fifo` crosses two clocks.
`equiv_make` treats both clocks as free inputs, so proving the two models behave
identically for any waveform on either is well-defined, and it was proven. What
cannot be said is whether the synchroniser is deep enough for the metastability
it faces. That is a question about the design, not about whether the transpiler
preserved it.

**Anything outside the port list.** Internal signals are free to differ, and
should be. That is what makes the proof about behaviour rather than about text.

**Floating point (`f32`/`f64`).** After `prep`, yosys reasons over two values;
`miter`/`equiv`/`sat` work on bit vectors, and IEEE-754 reals (SV `real`/
`shortreal`) are not bit-blastable there. So the reference emitter **refuses**
float types outright rather than dropping them silently. The interpreter and
compiled backends evaluate floats, but formal equivalence over them is outside
this flow — a deliberate limit that follows from the tool (yosys), not an
unimplemented gap.

## The two lowerings must be independent

Comparing requires a formal model of each side.

**The reference must not be built from `iris2sv`'s lowered IR.** A lowering bug
would appear identically on both sides, the miter would be satisfied, and the
proof would be a tautology with a long runtime.

**What is independent is the lowering.** `iris2sv` was ported to Rust (stage A4)
and now reuses `iris-sim`'s parser, so the reference (`iris-formal`) and the
design under test (`iris2sv`) **share the front end** (lexer, parser, AST,
`Project`). What they do not share is the lowering to SystemVerilog: the
reference is deliberately blunt (`if`/`else`, width-carrying literals, no casts),
while `iris2sv` is idiomatic (nested ternaries, `N'(...)` casts, inlining).
These are separate code paths.

| | Parser | Lowering to SystemVerilog |
|---|---|---|
| `iris-formal` (reference) | `iris-sim`'s `iris.pest` (shared) | blunt, structural (`sim/iris-sim/src/formal/`) |
| `iris2sv` (under test) | `iris-sim`'s `iris.pest` (shared) | idiomatic (`tools/iris2sv-rs`) |

So a **lowering** disagreement is exactly what this flow surfaces — its purpose.
A bug in the shared front end is *not* caught here (both sides break the same
way); that class is covered by the interpreter, the round-trip conformance
checks, and Verilator's own SystemVerilog front end, which reads `iris2sv`'s
output independently.

**Note:** before the port, `iris2sv` had its own TypeScript parser, so the front
ends were independent too. The move to Rust (per the directive to implement
`iris` in Rust) made the front end shared; independence now lives at the
lowering layer. The round-trip and Verilator independence remain.

## Where the tools live

| Part | Form | Location |
|---|---|---|
| Reference model emitter | Added to an existing tool | `iris-formal`, the third binary in `sim/iris-sim` |
| Proof driver | New tool | `tools/formal/` |

The reference model is written on the Rust parser and AST because it can reuse
`iris-sim`'s AST and `Project` directly; moving it out would mean reimplementing
them. (`iris2sv` uses the same parser, so what is independent is the lowering,
not the parse.)

The driver has to stand at equal distance from both sides. Placing it inside
either tool would make that condition impossible to check by reading.

## The pipeline

```
design.iris
   ├── iris-formal (Rust, pest)     → reference.sv  structural, one construct per line
   └── iris2sv     (Rust, pest)     → impl.sv       idiomatic (separate lowering)

         both → yosys: read_verilog -sv
                       hierarchy -check -top
                       proc; opt; memory_map; opt
                       flatten; opt        (each side separately, via design -stash)
                     ├── combinational: miter -equiv -flatten -make_assert
                     │                  sat -verify -prove-asserts
                     └── sequential:    prep; async2sync
                                        equiv_make; equiv_simple; equiv_induct
                                        equiv_status -assert
```

The reference model is deliberately blunt:

- one `always_ff` per register, with the reset branch written out
- `always_comb` with plain `if`/`else` and `case`, never a chain of `?:`
- every literal carries its width
- an instance output read as `alu.y` becomes a wire and a port connection
- declaration initialisers are reproduced
- IRIS width semantics are modelled: adding two `bit[5]` values truncates, `5'(...)`

**The two sides are never written out with `write_verilog` and read back.**
`write_verilog` cannot spell yosys's internal `$auto$...` names, so it renames
them `_000_`, `_001_`, per file. Two unrelated wires then share a name, and
`equiv_make`, which pairs wires by name, pairs them. On the RV32I core `_016_`
was `~halt_reg` in one netlist and `~dec.is_system` in the other. A false pairing
cannot turn a difference into a proof, but it quietly shrinks what the proof
covers.

`iris2sv` produces the opposite: nested ternaries, `32'(...)` casts, inlined
logic. For a yosys front-end bug to hide a real difference, it would have to
corrupt both of those in the same direction.

## State, reset, and initial values

This is where a cycle-accurate equivalence proof is usually wrong without anyone
noticing.

### Reset

`iris2sv` emits asynchronous resets in the sensitivity list, which yosys models
as `$adff`. `equiv_induct` reasons about synchronous state, so `async2sync` runs
before matching.

**`async2sync` changes what is being proven.** It replaces "clears whenever
`rst` is high" with "clears at the next clock edge while `rst` is high".

For two models of the same IRIS source this is acceptable, because both go
through the same transformation. It is recorded so that a reader comparing this
against a vector bench that pulses reset between edges does not conclude the two
disagree.

### Initial values

Specification 6.3.1 states that the reset value is the declaration's initial
value. Both sides follow that rule.

A signal with no initial value gets no reset assignment; there is nothing to
reset it to. A block that resets nothing does not carry the reset edge in its
sensitivity list: an edge that changes something without saying what it changes
to is not a circuit.

### Memories

`memory_map` runs explicitly, so both sides are expanded the same way rather
than depending on whether each happened to trigger inference.

Assignments inside `sync` are emitted as `<=`. IRIS unifies the assignment
operator and gives it sequential meaning inside `sync`; SystemVerilog does not.
Writing `dmem[addr] = word` stops yosys inferring a memory, and a 1024-word
array becomes 32,768 registers behind a 32-bit decoder.

## Verifying the verifier

A flow that reports success is indistinguishable from a flow that reports
success unconditionally.

**Every proof ships with a mutation that must fail.**

| Design | Mutation |
|---|---|
| `alu` | signed compare in the SLT arm made unsigned |
| `alu` | SRL and SRA swapped |
| `counter` | increments by two |
| `decoder` | the I-type immediate loses its sign extension |
| `regfile` | writes to `x0` are no longer discarded |

A mutation the flow *proves equivalent* is a defect in the flow, and is treated
with the same seriousness as a design bug.

## When no verdict arrives

A proof that does not finish is not a proof, and a driver that waits forever on
one reports nothing at all.

There is a time budget; exceeding it is reported as `skipped` with the budget
stated.

```bash
FORMAL_TIMEOUT=3000 tools/formal/run.sh riscv_core
```

**A skip is not a pass.** It is a design this flow could not speak about, and it
is reported as loudly as a failure so that a green line never stands in for an
absent one.

## What can be claimed today

Measured 2026-08-12.

| Design | Readable | Against its IRIS | Round trip |
|---|---|---|---|
| `alu` | yes | proven, unbounded | proven |
| `decoder` | yes | proven, unbounded | proven |
| `counter` | yes | proven, unbounded | proven |
| `regfile` | yes | proven, unbounded | proven |
| `async_fifo` | yes | proven, unbounded, 178 cells | proven |
| `riscv_core` | yes | proven, unbounded | proven |

`riscv_core` has a 1024×32-bit data memory, which becomes 65,536 flops across
both sides after `memory_map`.

It was the last design to close, and **it was only a question of time.**

| Depth | Result | Time |
|---|---|---|
| 4 words | proven | 9s |
| 16 words | proven | 14s |
| 64 words | proven | 46s |
| 256 words | proven | 372s |
| 1024 words (the real one) | proven | ~80 min; the round trip ~73 min |

The default 240-second budget does not reach it.

```bash
FORMAL_TIMEOUT=9000 tools/formal/run.sh riscv_core
```

`equiv_make` will not take a memory:

```
ERROR: Gold module contains memories or processes. Run 'memory' or 'proc' respectively.
```

so the proof runs with the memory mapped out to flops. **No abstraction removes
the memory from the comparison, so no assumption that the arrays are equal
appears in the residual-trust list.**

**The reference model is independently correct.** Wired into
`example/riscv/sv/riscv_tb.sv` and run under Verilator, `iris-formal`'s output
passes all 40 RV32I instructions with no mismatch. That is evidence of a
different kind from the proof, and it is what decides which model is wrong when
a proof fails.

## Residual trust

What the flow does not prove, and therefore assumes:

- **Yosys's SystemVerilog front end**, used on both sides
- **The `async2sync` transformation**, applied to both sides equally
- **The IRIS language definition and the shared front end.** The reference and
  the design under test use the same parser and AST, so a bug there does not
  appear in this flow (both sides break the same way); whether the spec is read
  as intended is covered instead by the round-trip checks and Verilator
- **The reference emitter itself.** It is small and blunt so that it can be
  read, but it is code, and it is not itself proven

**This list is a deliverable.** A formal result whose assumptions are unlisted
invites more confidence than it earns.

## Defects this work found

Building the flow surfaced nine defects in the existing tools. The full record
is in `.aiprj/AI_PRJ_TASKS.md`.

| ID | Symptom | Component |
|---|---|---|
| D-1 | `always_ff` lists a reset edge with no reset branch | `iris2sv` |
| D-2 | Instance outputs read hierarchically and left unconnected | `iris2sv` |
| D-3 | `truncate` rejected | `iris2sv` |
| D-4 | A two-level hierarchical port read returns 0 | `iris-sim` |
| D-5 | An evaluation failure does not reach the exit status | `iris-sim` |
| D-6 | Width methods emitted as `.sign_extend(32)` | `sv2iris` |
| D-7 | The grammar's own `where` clause form does not parse | `iris2sv` |
| D-8 | A width expression emitted as `/* expr */`, reported as success | `iris2sv` |
| D-9 | A cast width emitted as `/* width */`, reported as success | `iris2sv` |

D-1 produced a circuit that incremented a counter on a rising reset. Verilator
accepted it and 871 tests passed. Yosys refusing it is what brought it out.

D-2 turned 21 hierarchical references into undriven wires, so a proof against
that model would have been a proof about a core whose ALU inputs float.
**A silently wrong model is worse than a refusal.**

D-8 and D-9 came out of the `async_fifo` round trip being *disproven*. The
disproof was real: `iris2sv` was emitting the comments `/* expr */` and
`/* width */` where a width belonged, and reporting the file as converted.

The flow also surfaced five defects in its own parts: missing declaration
initialisers, IRIS width semantics not modelled, and the `write_verilog` round
trip creating false pairings among them. They are recorded alongside the rest.

## Prerequisites

- `yosys` 0.52 or later (needs `miter`, `sat`, `equiv_*`, `async2sync`)
- `node`
- `iris2sv` built: `make -C tools iris2sv`
- `iris-formal` built: `cargo build --release --manifest-path sim/iris-sim/Cargo.toml`

SymbiYosys is not used. It is not installed on this machine, so the flow is
written against yosys directly.
