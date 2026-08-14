# Block Diagrams for IRIS

## What this covers

A browser tool that draws how the modules of an IRIS design are wired
together.

```bash
cd tools/schematic
npm install
npm run dev
```

**There is no server.** The build produces two static files, and the `.iris`
files you pick never leave the browser.

![Block diagram of RiscvCore: boundary inputs on the left, three instances in
the middle, boundary outputs on the right](images/schematic_riscv_core.png)

## Why no server is needed

ModView, the tool this one is modelled on, has a Python backend. Verible, which
parses its SystemVerilog, is a C++ binary and cannot run in a browser.

**IRIS has no such reason.** Its parser, `@iris2sv/core`, is already
TypeScript.

```
$ grep -rn "from 'node:\|require('fs'" packages/core/src/
(no matches)

$ npm run build
dist/index.html                    3.28 kB
dist/assets/index-*.js         1,948.24 kB │ gzip: 587.72 kB
```

The bundle contains no Node builtins and references no external URL.

**This does not make the work smaller.** Measured against the original, 777
lines disappear and 732 lines merely move into TypeScript. "The backend
disappears" is a statement about deployment, not about effort.

## What is drawn

There are three kinds of box.

| Box | What it is | Appearance |
|---|---|---|
| Instance | A submodule | Blue rectangle, instance name over module name |
| Boundary port | A port of the module being drawn | Rounded amber box |
| Register | A signal assigned in `sync`, i.e. state | Grey rectangle |

The text on a line names the ports it carries. Lines between the same pair of
boxes are merged into one.

```
imem_rdata ──instr──→ dec ──op, a, b──→ alu ──a, b──→ rf ──dbg_data──→ dbg_data
                       │                              ↑
                       └──we, waddr, wdata +2─────────┘
```

### Why registers are boxes

Following a chain of `comb` assignments straight through draws an edge that
crosses a register. Such an edge says the value arrives in the same cycle when
it arrives in the next one.

**Stopping at state keeps that lie out of the diagram.**

## Half the wiring is not written down

**This is the fact the tool is built around.**

An IRIS connection may name an instance output directly:

```rust
inst rf = RegFile { waddr: dec.rd, };     // dec -> rf, stated
```

but more often it names an intermediate signal built in `comb`:

```rust
comb { alu_a = if dec.alu_a_pc { pc } else { rf.rdata1 }; }
inst alu = Alu { a: alu_a, };             // rf -> alu, not stated
```

Drawing only the stated edges leaves the diagram nearly empty.

| Subject | Nodes | Stated edges | Traced edges |
|---|---|---|---|
| `RiscvCore` | 16 | 4 | **20** |
| All of `example/` and `fixtures/` | 32 | 12 | **27** |

**20 of `RiscvCore`'s 24 edges appear only after walking `comb` and `sync`.**

Both counts are shown in the status bar, so a reader can check what the diagram
is based on.

### How the tracing works

```
1. Collect the sources of each signal from comb assignments
2. Record sync assignment targets as registers, and stop there
3. A FieldExpr source is an instance output
   An input port is a boundary terminal
   Anything else recurses
4. Never follow the same name twice
```

## Three traps the implementation avoids

**A naive prototype produced a wrong diagram three times.**

| | Trap | What happens | Fix |
|---|---|---|---|
| 1 | `load_byte.sign_extend[32]()` looks like `alu.y`: both are a `FieldExpr` | A box appears for an instance that does not exist | Separate them by the set of instance names |
| 2 | Tracing `comb` crosses a register | The meaning of a cycle is lost | Stop at `sync` assignment targets |
| 3 | Self-loops appear | An edge that says nothing about structure | Same as above |

All three are covered by tests in `src/model/build.test.ts`.

## Three more found only by rendering

**Not one of them showed up in the model tests or a successful build.**

They were found by rendering the diagram in headless Chrome.

| | Symptom | Fix |
|---|---|---|
| 1 | A label naming five ports overlapped the box | Name the first three and count the rest (`we, waddr, wdata +2`) |
| 2 | Registers with no edges floated on their own | Do not draw them |
| 3 | The diagram sat in the top left with the lower half empty | Wait for rendering to finish before fitting |

The third was an implementation error: the paper renders asynchronously, and
the fit measured the canvas before anything was on it.

![Block diagram of a testbench: idx feeds core, and core and rom are joined by
edges in both directions](images/schematic_testbench.png)

The second is visible above. `done`, `cycles` and `fails` in `TestMem` are
state, but they reach neither an instance nor the boundary, so they are not
drawn.

**Instances and boundary ports are kept even when unconnected.** An
unconnected submodule or a dangling port is itself worth seeing.

## Files that fail to parse

**They are reported, not dropped.**

When a module is missing from a diagram, the diagram cannot tell you whether it
was never there or could not be read. Files that failed to parse are listed
with their reason.

## Controls

| Action | Effect |
|---|---|
| Drag a box | Every connection is re-routed on drop |
| Drag the background | Pan |
| `Fit` | Frame the whole design |
| `+` / `−`, Ctrl+wheel | Zoom |
| `Save layout` | Download the arrangement as JSON |
| `Load layout` | Restore a saved arrangement |

## Layout

The same ELK the original uses.

```
elk.algorithm          layered
elk.direction          RIGHT
elk.edgeRouting        ORTHOGONAL
elk.hierarchyHandling  INCLUDE_CHILDREN
```

Boundary ports are pinned to the first and last layer. Without that constraint
ELK puts `clk` in the middle of the design it clocks.

Sixteen nodes and seventeen edges took 54.9 ms. **Speed is not a concern at
this size.**

## Layout of the source

```
src/
├── main.ts             startup and controls
├── model/
│   ├── types.ts        the diagram model
│   ├── build.ts        IRIS AST -> diagram model
│   └── build.test.ts   tests, including the traps
└── diagram/
    ├── layout.ts       ELK placement and routing, label formatting
    ├── layout.test.ts  label tests
    └── render.ts       JointJS drawing
```

`model/` does not depend on the browser, so the edge inference can be tested
without a screen.

```
$ npm test
Test Files  2 passed (2)
      Tests  13 passed (13)
```

## Dependencies

| Component | License | Role |
|---|---|---|
| `@iris2sv/core` | MIT | IRIS parsing, from this repository |
| `@joint/core` | MPL-2.0 | Shapes and links |
| `elkjs` | EPL-2.0 | Layered layout and orthogonal routing |

MPL-2.0 and EPL-2.0 are file-level copyleft. Consumed unmodified as npm
dependencies they do not affect this tool's own MIT licence. ModView makes the
same judgement.

## What has not been checked

**Nested hierarchy has not been checked.**

Where an instance itself contains instances, the original draws it as a
container with its children inside. No design in this repository does that, so
there is nothing to try it on.

**A counterpart existing is not a reason to write that it works.**
