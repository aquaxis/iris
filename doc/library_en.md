# IRIS standard library

## What this document covers

Reusable RTL logic modules written in IRIS.
Take a FIFO, a counter or an arbiter as a part instead of writing it again each time.
Each part's implementation, testbench, and detailed notes live under `lib/`.
This document gives the overview and the line between what is and is not expressible.

The full list and each part's parameters are in [`lib/README_en.md`](../lib/README_en.md).

## Layout

One directory per category.
32 parts in 9 categories.

| Category | Count | Main parts |
|---|---|---|
| `timing/` | 7 | Counter, EdgeDetect, GrayCounter, Lfsr, ClkDivider, Pwm, Debounce |
| `arith/` | 7 | PriorityEncoder, Lzc, Bin2Gray, Decoder, Rotator, Gray2Bin, MinMax |
| `mem/` | 4 | FifoSync, FifoAsync, RamSp, RamDp |
| `arbiter/` | 2 | ArbiterFixed, ArbiterRr |
| `stream/` | 1 | SpillRegister |
| `cdc/` | 3 | Sync2ff, RstSync, PulseSync |
| `coding/` | 2 | Crc, Parity |
| `periph/` | 4 | UartTx, UartRx, SpiMaster, I2cMaster |
| `dsp/` | 2 | FirSerial, MacSerial |

A part is three pieces.
The implementation (`<category>/<name>.iris`), the test (`<category>/<name>_tb.iris`), and the documentation (`lib/README_en.md`).

## Conventions

Module names are PascalCase, ports and signals snake_case, parameters PascalCase (`Width`/`Depth`).
Reset is async assert, sync deassert, active-high by default, and the reset value is the declaration initialiser.
Stream parts do not drop valid independently of ready.
Parameters are unified as `Width`/`Depth`/`Taps` and so on, each with a default.

## Verification

Per part, three checks run.

```bash
iris sim  -i <category>/<name>.iris <category>/<name>_tb.iris -c <cycles>
iris sv      <category>/<name>.iris -o out/
iris lint    <category>/<name>.iris
```

All 32 testbenches pass under `iris-sim`.
`tools/conformance/run.sh` stays at 158/0.
Parts converted to SystemVerilog are accepted by Verilator with exit 0.
(Width warnings appear because untyped literals and parameters become 32-bit in SV, but the values are correct.)

## What is and is not expressible

**This line is the point of this document.**

Three kinds of parts are written directly in IRIS.

| Kind | Examples | Why it works |
|---|---|---|
| Single-clock logic | Counter, FifoSync, ArbiterRr | expressible directly with comb/sync and mem |
| FSM + shift register | UartTx/Rx, SpiMaster, I2cMaster | a state machine and a shift register build a peripheral interface |
| Accumulation unrolled over time | Crc, Lfsr, FirSerial, MacSerial | sync accumulation unrolls a convolution over time |
| Signed arithmetic | MacSerial[Signed: 1] | `.signed()` + `.sign_extend[N]()` accumulate in two's complement; read with `acc.signed()` |
| An XOR fold | Parity, Gray2Bin | `.xor_reduce()` plus per-bit assignment (`out[i]=...` accumulates bit by bit) |

What could not be done is recorded, with the reason.

| Not expressible | Reason |
|---|---|
| A combinational sum-fold (popcount, a parallel-CRC XOR tree) | `var` is not allowed in comb, and a whole-signal reassignment is last-write-wins, not a running sum (an XOR fold is fine via `.xor_reduce()`) |
| Generic array ports and var arrays (multi-stream mux/demux) | array bounds need a constant (only `mem` allows a generic bound) |
| Generic functions (a general math library) | `fn f[Width](...)` does not parse; a fixed-width `fn` works |
| A generic width on `int[N]`/`uint[N]` (`int[Width]`) | a type's width takes only a literal (`bit[Width]` works); write signed parts over `bit[N]` with `.signed()` |
| A parameterizable synchronizer depth | a var array needs a constant bound, so the depth is fixed at two |

Signed `==`/`!=` were fixed in iris-sim to compare by value (so a signed value compares against a negative literal; spec 9.3.1).

What can be serialized or written as an FSM is written in IRIS.
What hits the fold or array-port limits, or is heavy and needs proven silicon, reuses OSS.
The reuse targets for heavy IP (AXI, crypto, floating-point units, large DSP) are recorded in [`lib/README_en.md`](../lib/README_en.md).

## Technology cells are not modeled

Cells tied to a PDK implementation, such as `clk_gate`, `tc_sram`, and a level shifter, are not modeled as synthesizable IRIS logic.
No counterpart to SystemVerilog register macros (`FF` and the like) is built; `sync` and `var` are enough.
When these are needed, use each PDK's implementation or a real library.
