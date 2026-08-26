# IRIS standard library

## What this document covers

Reusable RTL logic modules written in IRIS.
Take a FIFO, a counter or an arbiter as a part instead of writing it again each time.
Each part's implementation, testbench, and detailed notes live under `lib/`.
This document gives the overview and the line between what is and is not expressible.

The full list and each part's parameters are in [`lib/README_en.md`](../lib/README_en.md).

## Layout

One directory per category.
105 parts in 10 categories.

| Category | Count | Main parts |
|---|---|---|
| `timing/` | 16 | Counter, EdgeDetect, GrayCounter, Lfsr, ClkDivider, Pwm, Debounce, Timer, OneShot, Watchdog, JohnsonCounter, TripCounter, Prescaler, DeltaCounter, RingCounter, RateLimiter |
| `arith/` | 25 | PriorityEncoder, Lzc, Bin2Gray, Decoder, Rotator, Gray2Bin, MinMax, DivSerial, MulSerial, SatAdd, SatSub, OneHotCheck, Abs, Accumulator, PopcountSerial, Comparator, Bin2Bcd, Clamp, Mux1H, AbsDiff, Extend, Thermometer, BarrelShift, Ctz, Negate |
| `mem/` | 9 | FifoSync, FifoAsync, RamSp, RamDp, Ram2r1w, ShiftRegister, RingBuffer, Lifo, Cam |
| `arbiter/` | 4 | ArbiterFixed, ArbiterRr, ArbiterLock, Semaphore |
| `stream/` | 14 | SpillRegister, StreamRegister, Serializer, Deserializer, VecMux, VecDemux, StreamDownsizer, StreamUpsizer, StreamFork, StreamJoin, StreamFilter, CreditCounter, StreamArbiter, StreamThrottle |
| `cdc/` | 6 | Sync2ff, RstSync, PulseSync, HandshakeSync, GrayCodeSync, RstSequencer |
| `coding/` | 10 | Crc, Parity, Secded, TmrVoter, Checksum, Scrambler, Descrambler, DiffPair, Interleaver, LockstepCompare |
| `periph/` | 4 | UartTx, UartRx, SpiMaster, I2cMaster |
| `dsp/` | 12 | FirSerial, MacSerial, MovingAverage, Nco, ComplexMult, PeakDetect, CicDecimator, PidController, IirBiquad, Median3, Histogram, Correlator |
| `util/` | 5 | BitReverse, EndianSwap, ByteEnableExpand, RangeMask, SignMag |

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

All 105 testbenches pass under `iris-sim`; run them at once with `bash tools/lib_test.sh`
(catches behavioral/assert regressions that conformance's convert/round-trip checks miss).
`tools/conformance/run.sh` stays at 770/0 (101 library parts registered as fixtures).
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
| A sum-fold unrolled over time | PopcountSerial | the comb fold, done serially over `Width` cycles |
| Signed arithmetic | MacSerial[Signed: 1], ComplexMult, PidController, IirBiquad | `.signed()` + `.sign_extend[N]()` accumulate in two's complement; read with `acc.signed()` |
| An XOR fold | Parity, Gray2Bin, Secded | `.xor_reduce()` plus per-bit assignment (`out[i]=...` accumulates bit by bit) |
| A multi-stream mux/demux (packed vector) | VecMux, VecDemux | a concatenated `bit[Width*N]` with a part-select `[i*Width +: Width]` (widen the index before the multiply) |
| Vocabulary conversions (bit/byte order, mask expand) | BitReverse, EndianSwap, ByteEnableExpand | `for` plus per-bit assignment / part-select fills one element at a time |
| Generic functions (width-agnostic) | `fn max2[W](a,b)` | inlined at call sites; works at any width when the body needs no numeric `W` |

What could not be done is recorded, with the reason.

| Not expressible | Reason |
|---|---|
| A combinational sum-fold (popcount, a parallel-CRC XOR tree) | `var` is not allowed in comb, and a whole-signal reassignment is last-write-wins, not a running sum (an XOR fold is fine via `.xor_reduce()`; **serially it is expressible** — `PopcountSerial`) |
| An array-typed signal/port (`bit[W][N]`) | rejected with a clear error (`O1009`) — it would flatten to bits so `d[i]` reads a bit, not an element; use a packed vector (table above); `mem` still takes `bit[W][Depth]` |
| Generic functions whose body needs the numeric width | `fn f[W]` itself works (inlined); but using `W` as a value in the body leaves it unresolved after inlining |
| A parameterizable synchronizer depth | a var array needs a constant bound, so the depth is fixed at two |
| An arithmetic right shift via `>>` | `>>` is a logical shift even on `.signed()` (zero-fill); build it by hand by OR-ing a top-bits mask when the sign bit is set (`BarrelShift[Arith:1]` is the example) |

Signed `==`/`!=` were fixed in iris-sim to compare by value (so a signed value compares against a negative literal; spec 9.3.1).

What can be serialized, written as an FSM, or expressed over a packed vector is written in IRIS.
What hits the comb sum-fold limit, or is heavy and needs proven silicon, reuses OSS.
The reuse targets for heavy IP (AXI, crypto, floating-point units, large DSP) are recorded in [`lib/README_en.md`](../lib/README_en.md).

## Technology cells are not modeled

Cells tied to a PDK implementation, such as `clk_gate`, `tc_sram`, and a level shifter, are not modeled as synthesizable IRIS logic.
No counterpart to SystemVerilog register macros (`FF` and the like) is built; `sync` and `var` are enough.
When these are needed, use each PDK's implementation or a real library.
