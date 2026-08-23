# IRIS standard library

Reusable RTL logic modules written in IRIS. Take a FIFO, a counter or an
arbiter as a part instead of writing it again each time.

## Layout

One directory per category.

| Directory | Category |
|---|---|
| `arith/` | arithmetic |
| `mem/` | storage and buffers |
| `stream/` | stream and flow control |
| `arbiter/` | arbitration |
| `cdc/` | CDC, reset, clock |
| `timing/` | counters and timing |
| `util/` | utilities (functions) |

A part is three pieces.

| Piece | Location | Role |
|---|---|---|
| Implementation | `<category>/<name>.iris` | the part, parameterised with generics |
| Test | `<category>/<name>_tb.iris` | a `test` module checked under `iris-sim` |
| Documentation | this `README.md` | purpose, parameters, notes |

## Conventions

| Convention | Rule |
|---|---|
| Naming | modules PascalCase, ports and signals snake_case, parameters PascalCase (`Width`/`Depth`) |
| Reset | async assert, sync deassert, active-high by default; `sync(clk.posedge, rst.async)`, reset value is the declaration initialiser |
| ready/valid | valid does not drop independently of ready (kept by stream parts) |
| Parameters | `Width`/`Depth`/`Stages`, each with a default |
| Verification | `assert`/`cover` and `iris-sim`/`iris sv`; where external SDC/lint cannot apply, it is stated |

## Use

Instantiate a part, and override generics for width and so on when needed.

```
// default (Width=8)
inst c8 = Counter { clk: clk, rst: rst, en: en };

// override generics
inst c4 = Counter[Width: 4, Saturate: 1] { clk: clk, rst: rst, en: en };
```

## Verification

Per part, run:

```
iris sim  -i <category>/<name>.iris <category>/<name>_tb.iris -c <cycles>
iris sv      <category>/<name>.iris -o out/          # converts to SystemVerilog
iris lint    <category>/<name>.iris                  # follows the naming rules
```

## Parts

### timing

| Part | Function | Parameters |
|---|---|---|
| `Counter` | general counter | `Width` (default 8), `Down` (0=up / 1=down, default 0), `Saturate` (0=wrap / 1=saturate, default 0) |

`Counter` leaves wrap to natural width overflow, and saturation holds the value
at the maximum (all ones) and the minimum (0). The maximum is detected with
`count + 1 == 0` (all ones plus one wraps to 0 in `Width` bits).

## What is not expressed in IRIS

Technology-dependent cells (`clk_gate`, `tc_sram`, level shifters, ...) bind to a
PDK implementation and are not expressed as synthesisable IRIS logic.
SystemVerilog register macros (`FF` and the like) get no counterpart; `sync` and
`var` are enough. When these are needed, use a PDK implementation or a real
library (section B of `instructions.md`).
