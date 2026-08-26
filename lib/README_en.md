# IRIS standard library

Reusable RTL logic modules written in IRIS. Take a FIFO, a counter or an
arbiter as a part instead of writing it again each time.

## Overview

105 parts in 10 categories. Every part passes three checks: an `iris-sim`
testbench, `iris sv` (SystemVerilog conversion), and `iris lint` (naming). And
`tools/conformance/run.sh` stays at 770/0 (101 library parts registered as fixtures).

| Category | Count | Parts |
|---|---|---|
| `timing/` | 16 | `Counter`, `EdgeDetect`, `GrayCounter`, `Lfsr`, `ClkDivider`, `Pwm`, `Debounce`, `Timer`, `OneShot`, `Watchdog`, `JohnsonCounter`, `TripCounter`, `Prescaler`, `DeltaCounter`, `RingCounter`, `RateLimiter` |
| `arith/` | 25 | `PriorityEncoder`, `Lzc`, `Bin2Gray`, `Decoder`, `Rotator`, `Gray2Bin`, `MinMax`, `DivSerial`, `MulSerial`, `SatAdd`, `SatSub`, `OneHotCheck`, `Abs`, `Accumulator`, `PopcountSerial`, `Comparator`, `Bin2Bcd`, `Clamp`, `Mux1H`, `AbsDiff`, `Extend`, `Thermometer`, `BarrelShift`, `Ctz`, `Negate` |
| `mem/` | 9 | `FifoSync`, `FifoAsync`, `RamSp`, `RamDp`, `Ram2r1w`, `ShiftRegister`, `RingBuffer`, `Lifo`, `Cam` |
| `arbiter/` | 4 | `ArbiterFixed`, `ArbiterRr`, `ArbiterLock`, `Semaphore` |
| `stream/` | 14 | `SpillRegister`, `StreamRegister`, `Serializer`, `Deserializer`, `VecMux`, `VecDemux`, `StreamDownsizer`, `StreamUpsizer`, `StreamFork`, `StreamJoin`, `StreamFilter`, `CreditCounter`, `StreamArbiter`, `StreamThrottle` |
| `cdc/` | 6 | `Sync2ff`, `RstSync`, `PulseSync`, `HandshakeSync`, `GrayCodeSync`, `RstSequencer` |
| `coding/` | 10 | `Crc`, `Parity`, `Secded`, `TmrVoter`, `Checksum`, `Scrambler`, `Descrambler`, `DiffPair`, `Interleaver`, `LockstepCompare` |
| `periph/` | 4 | `UartTx`, `UartRx`, `SpiMaster`, `I2cMaster` |
| `dsp/` | 12 | `FirSerial`, `MacSerial`, `MovingAverage`, `Nco`, `ComplexMult`, `PeakDetect`, `CicDecimator`, `PidController`, `IirBiquad`, `Median3`, `Histogram`, `Correlator` |
| `util/` | 5 | `BitReverse`, `EndianSwap`, `ByteEnableExpand`, `RangeMask`, `SignMag` |
| Total | 105 | |

**The line between what is and is not expressible is the point of this list.**
Single-clock logic (counters, FIFOs, arbiters), FSM + shift (peripheral
interfaces), and accumulation unrolled over time (CRC, LFSR, serial DSP) are
written directly in IRIS. A multi-stream mux/demux is also expressible, using a
**packed vector** (`bit[Width*N]`) with a part-select (`data[i*Width +: Width]`);
`VecMux` and `VecDemux` are the examples, widening `sel` before the multiply so the
index does not overflow. A combinational sum-fold (popcount, a parallel-CRC XOR tree) is not expressible in
`comb`, but **is expressible serially over time** (`PopcountSerial` is the example).
Generic functions `fn f[W](...)` are also expressible (inlined at call sites, so a
function whose body needs no numeric width — e.g. `max2` — works at any width; iris sv
inlines them). An array-typed signal/port (`bit[W][N]`) is rejected with a clear error (`O1009`) — it would
flatten to bits and make `d[i]` read a bit, not an element; use a packed vector instead (`mem` still takes `bit[W][Depth]`). (An XOR fold is expressible with
`.xor_reduce()` and per-bit assignment — `Parity` and `Gray2Bin` are the
examples.) Each part's description and the "Implementation notes" record what
could not be done, and why.

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
| `coding/` | error detection and coding |
| `periph/` | peripheral interfaces |
| `dsp/` | DSP and signal processing |
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

To run every part's testbench (behavior / asserts) at once, use the runner below.
Where `tools/conformance/run.sh` guards conversion, round-trip and Verilator, this
runs each `_tb`'s asserts and catches **behavioral** regressions (iris-sim exits 1
on an assertion failure).

```
bash tools/lib_test.sh    # runs every lib/ <name>_tb.iris under iris-sim (currently 105/0)
```

## Parts

### timing

| Part | Function | Parameters |
|---|---|---|
| `Counter` | general counter | `Width` (default 8), `Down` (0=up / 1=down, default 0), `Saturate` (0=wrap / 1=saturate, default 0) |
| `EdgeDetect` | rising/falling edge detect (one-cycle pulse) | none (1-bit) |
| `GrayCounter` | gray-code counter (adjacent values differ by one bit) | `Width` (default 8, >= 1) |
| `Lfsr` | linear-feedback shift register (Galois, PRNG/PRBS) | `Width` (default 8, >= 2); polynomial `poly` is an input port |
| `ClkDivider` | integer divider (one-cycle `tick` every Div cycles) | `Div` (default 2, >= 2), `CountWidth` (derived) |
| `Pwm` | PWM generator (counter + compare, duty ratio `duty/Period`) | `Period` (clocks per period, default 256, >= 2), `Width` (derived `$clog2(Period)`) |

`ClkDivider` emits a clock-enable tick rather than gating a clock — the
synthesis-friendly pattern.

`Pwm` runs a free-running counter of period `Period` and holds the output high
while `cnt < duty`, so the duty ratio is `duty / Period` (`duty` of 0 is always
low). Use it for LED dimming or motor drive.

`Debounce` flips the output `q` only after the input `d` has differed from the
current output for `Count` consecutive cycles; a shorter glitch is ignored (push
button chatter removal). It is not a metastability guard, so synchronize an async
input with `Sync2ff` first.

`Counter` leaves wrap to natural width overflow, and saturation holds the value
at the maximum (all ones) and the minimum (0). The maximum is detected with
`count + 1 == 0` (all ones plus one wraps to 0 in `Width` bits).

`EdgeDetect` registers the previous value and emits `rise = d & ~prev`,
`fall = ~d & prev`.

| Part | Function | Parameters |
|---|---|---|
| `Timer` | periodic timer (down-counter, one-cycle `tick` at 0, auto-reload) | `Width` (default 16, >= 1) |
| `OneShot` | one-shot / pulse stretcher (a `Len`-cycle pulse on a `trig` rising edge) | `Len` (pulse width, default 4, >= 1), `CntWidth` (derived `$clog2(Len)+1`) |

`Timer` counts down from `reload` to 0 while `en`, pulses `tick` for one cycle at 0
and reloads (period = `reload + 1`); `reload` is sampled every cycle, so it can
change on the fly. Use it for a periodic interrupt or rate generation.

`OneShot` detects a rising edge on `trig` (comparing against the previous value)
and holds `pulse` high for `Len` cycles (counting down from `Len-1`). It stretches
a short event into a fixed-width control signal; a re-trigger while running is
ignored.

| Part | Function | Parameters |
|---|---|---|
| `Watchdog` | watchdog timer (alarm if not `kick`-ed within `timeout`) | `Width` (default 16, >= 1) |

`Watchdog` counts up while `en` and latches `alarm` on reaching `timeout`; a `kick`
resets the counter and `alarm` (`kick` takes priority over `en`). It flags a hang or
fault when the periodic `kick` stops (functional safety / monitoring) — unlike
`Timer`'s periodic tick, it checks "did a kick arrive in time".

| Part | Function | Parameters |
|---|---|---|
| `JohnsonCounter` | Johnson (twisted-ring) counter, 2N states | `Width` (default 4, >= 1; 2*Width states) |

`JohnsonCounter` cycles through 2*Width states via `r = { r[Width-2:0], ~r[Width-1] }`
(shift left, feeding the inverted MSB into the LSB): `0…0 → 0…01 → … → 1…1 → 1…10 → …
→ 10…0 → 0…0`. Adjacent states differ by one bit, so it suits phase/quadrature
generation and glitch-free state decode; `en` low holds.

| Part | Function | Parameters |
|---|---|---|
| `RingCounter` | ring counter (one-hot rotation, N states) | `Width` (states, default 8, >= 2), `Right` (direction, 0=left/1=right, default 0) |

`RingCounter` rotates a single set bit one place each `en` (`{r[Width-2:0], r[Width-1]}`
for left, `Right` for right): `0…01 → 0…10 → … → 10…0 → 0…01`, staying one-hot across
`Width` states. It pairs with `JohnsonCounter` (a 2*Width twisted ring); since all-zero
is an absorbing state, the reset value is `1`. Use it for phase generation, stepping a
one-hot FSM, or driving a mux select; `en` low holds. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `TripCounter` | trip counter (asserts on reaching a threshold, saturating) | `Width` (count/threshold width, default 8, >= 1) |

`TripCounter` counts one per `en` and asserts `trip` when `count >= threshold` — event
counting, retry-limit detection, error-count alarms. The counter saturates at all-ones and
does not wrap, so once `trip` is set it stays until `clear` (latch-like). Saturation is
detected with `q + 1 != 0` (`0 - 1` would be an unsized 32-bit `-1`, not a width comparison,
so the wrap of `q + 1` at `Width` is used to spot all-ones instead). The threshold is an input
port. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `Prescaler` | prescaler (runtime-variable divide, tick generator) | `Width` (ratio/counter width, default 8, >= 1) |

`Prescaler` divides the `en` cycles by `ratio`, emitting a one-cycle `tick` every `ratio`
enabled cycles. Where `ClkDivider` fixes the ratio in the compile-time `Div`, this takes
`ratio` as an input port and changes it at runtime (baud generation, timer prescalers). The
terminal check is `cnt + 1 >= ratio` (`>=`, not `==`) so lowering `ratio` below the current
`cnt` does not strand the counter — it wraps next cycle. Verified that a runtime 3→2 change
recovers immediately and that no tick appears while `en` is low. Mixing `en` with the `>=`
under `&` makes iris2sv emit an expression that truncates one side to a single bit, so `tick`
is written with `if` statements to convert cleanly. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `DeltaCounter` | delta counter (variable step, preset) | `Width` (count/step width, default 8, >= 1) |

`DeltaCounter` adds `step` to the count on each `en` (where `Counter` is fixed ±1, this takes a
runtime step). Read as two's complement, a positive `step` adds and a negative one subtracts —
the add itself is sign-agnostic (same bits), so signedness is only the caller's interpretation.
`load` presets the count to `load_val`. For DSP strided-access address generation, ramp/sweep
generation, or variable-rate phase accumulation; the count wraps naturally at `Width`. Verified
step=3 counts up, `load` presets to 100, and step=-2 (0xFE) counts down. Verilator is clean
under `-Wall`.

| part | function | parameters |
|---|---|---|
| `RateLimiter` | rate limiter (token-bucket bandwidth limiting) | `Width` (token/capacity/interval width, default 8, >= 1) |

`RateLimiter` fills a bucket with tokens at a fixed interval; when a request `req` arrives and at
least one token is available, it raises `grant` and consumes one. The average rate is set by
`refill` (one token every this many enabled cycles, same `>=` terminus as `Prescaler`) and the
allowed burst by the bucket capacity `burst`. For bandwidth limiting, transmit pacing, or retry
spacing. The bucket saturates at `burst` and drops the overflow. `grant` is decided on the current
level only (a token arriving via refill this cycle is usable from the next). Raising `refill` at
runtime stops the refill and lets the bucket drain cleanly. `grant` mixes `en & req & (tokens != 0)`,
which iris2sv would truncate to one bit if written with `&`, so it is written with `if` to convert
reliably. Verified that with refill=2, burst=3 it fills to capacity and saturates, that a request
consumes one token at a time and `grant` drops when empty, and that `en=0` withholds `grant` and
holds the level. Verilator is clean under `-Wall`.

### arith

| Part | Function | Parameters |
|---|---|---|
| `PriorityEncoder` | index of the lowest set bit, with a valid flag | `Width` (default 8, >= 2), `IdxWidth` (default `$clog2(Width)`) |
| `Lzc` | leading zero count (zeros from the MSB to the first 1) | `Width` (default 8, >= 1), `CountWidth` (default `$clog2(Width)+1`) |
| `Bin2Gray` | binary to gray code (`bin ^ (bin >> 1)`) | `Width` (default 8, >= 1) |
| `Decoder` | binary index to one-hot (opened by `en`) | `Width` (output lines, default 8, >= 2), `SelWidth` (derived `$clog2(Width)`) |
| `Rotator` | barrel rotator (variable-amount circular shift) | `Width` (default 8, >= 2), `Right` (0=left / 1=right, default 0), `ShWidth` (derived `$clog2(Width)`) |
| `Gray2Bin` | gray code to binary (inverse of `Bin2Gray`) | `Width` (default 8, >= 1) |
| `MinMax` | two-input min/max (unsigned or signed) | `Width` (default 8, >= 1), `Signed` (0/1, default 0), `Max` (0=min / 1=max, default 0) |
| `DivSerial` | serial restoring divider (unsigned) | `Width` (default 8, >= 1), `CntWidth` (derived `$clog2(Width)+1`) |
| `MulSerial` | serial shift-add multiplier (unsigned, full-width product) | `Width` (default 8, >= 1), `PWidth` (derived `Width+Width`), `CntWidth` (derived) |

`MinMax` outputs the smaller or larger of `a` and `b`: it sets `out = a`, then
overwrites with `out = b` when the comparison calls for it (a selection). With
`Signed: 1` it compares with `.signed()` (a worked case of the signed-comparison fix).

`DivSerial` starts on `start` and produces quotient and remainder in `Width`
cycles (restoring division, one bit per cycle): it shifts the partial remainder,
brings in a dividend bit, and subtracts the divisor when it fits, setting a
quotient bit. `200/7 = 28 r 4` and others are checked; `done` pulses one cycle
after completion.

`MulSerial` starts on `start` and produces the full `2*Width` product in `Width`
cycles (shift-add). IRIS's `*` truncates to the operand width, but this yields the
full product (`200*200 = 40000` is checked). The add into the high half
zero-extends by one bit first to keep the carry (an add's result width is the max
operand width).

`Gray2Bin` builds each bit as `bin[i] = (gray >> i).xor_reduce()` (the XOR of the
bits from `i` up). An XOR fold is expressible in `comb` with `.xor_reduce()` and
per-bit assignment (`bin[i] = ...` accumulates bit by bit, unlike a whole-signal
reassignment); a roundtrip with `Bin2Gray` is checked.

`Rotator` circularly shifts `data` by `amt`, formed by OR-ing the two shift
directions (`(data << amt) | (data >> (Width - amt))`, reversed for a right
rotate). When `amt` is 0, `data >> Width` is 0 (a full-width shift), so a rotate
of 0 returns `data` unchanged.

`PriorityEncoder`, `Lzc`, and `Decoder` are combinational and use a `for` loop
with combinational last-write-wins.
`PriorityEncoder` scans from the high index down so the lowest set bit remains.
`Lzc` scans from the low index up so the highest set bit remains, and reports
`Width - 1 - i` as the leading-zero count.
`Decoder` sets the single bit matching `sel` (the inverse of `PriorityEncoder`).
It does not use `1 << sel`: the untyped literal `1` is inferred as one bit wide,
so the shift overflows to 0; selecting one bit with a width-bounded `for` is
reliable.

| Part | Function | Parameters |
|---|---|---|
| `SatAdd` | saturating add (clamps at the range end instead of wrapping) | `Width` (default 8, >= 2), `Signed` (0/1, default 0), `Ext` (derived `Width+1`) |
| `SatSub` | saturating subtract (unsigned floors at 0; signed clamps at ±) | `Width` (default 8, >= 2), `Signed` (0/1, default 0), `Ext` (derived `Width+1`) |

`SatAdd`/`SatSub` form the sum/difference in a one-bit-wider `bit[Width+1]` to see
the carry / sign overflow. Unsigned decides on the top bit (carry/borrow):
`SatAdd` saturates to all ones (`0 - 1` is all ones at `Width`), `SatSub` floors at
0. Signed sign-extends with `.signed().sign_extend[Ext]()`, detects overflow when
the top two bits disagree, and clamps a positive overflow to the maximum positive
(`0x7F..`) and a negative one to the minimum negative (`0x80..`) — the end values
are built with per-bit assignment (set/clear just the MSB). Combinational only.

| Part | Function | Parameters |
|---|---|---|
| `Clamp` | range limiter (clamps any value into `[lo, hi]`) | `Width` (default 8, >= 1), `Signed` (0/1, default 0) |

`Clamp` confines input `a` to the range `[lo, hi]` (`lo` if `a < lo`, `hi` if `a > hi`,
otherwise `a`). Where `SatAdd`/`SatSub` saturate on the overflow of an add/subtract, this
rounds an arbitrary value into a range supplied at runtime (`lo`/`hi` are input ports) — a
signal limiter, index/coordinate range rounding, or an AGC output clamp. It is a `comb`
selection (`out = a` by default, overwritten by two `<` comparisons that read only inputs,
the `MinMax` idea). `Signed` switches unsigned/signed comparison. The caller must keep
`lo <= hi`. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `OneHotCheck` | exactly-one-bit detector | `Width` (default 8, >= 1) |

`OneHotCheck` clears the lowest set bit with `din & (din - 1)`; if the result is 0
and `din` is non-zero, `is_onehot` is 1 (no fold/popcount needed). `is_zero` is 1
when all bits are 0. Combinational only.

| Part | Function | Parameters |
|---|---|---|
| `Abs` | absolute value (signed two's complement) | `Width` (default 8, >= 2) |
| `Accumulator` | accumulator (adds on `en`, clears on `clear`) | `Width` (default 16, >= 1) |

`Abs` returns `~a + 1` when negative, `a` otherwise; the most-negative value
(`0x80..`) has no same-width magnitude and wraps back to itself (documented).
`Accumulator` does `acc += din` on each `en` and resets on `clear` — a plain
accumulator with no multiply (use `MacSerial` for multiply-accumulate, or combine
with `SatAdd` for saturation); the add wraps at `Width`.

| Part | Function | Parameters |
|---|---|---|
| `PopcountSerial` | serial popcount (number of set bits / Hamming weight) | `Width` (default 8, >= 1), `CntWidth` (derived `$clog2(Width)+1`) |

`PopcountSerial` latches `din` on `start` and adds `sr[0]` into `cnt` one bit per
cycle over `Width` cycles (shifting right each cycle). It is the worked example that
**a combinational sum-fold is not expressible, but is expressible serially over
time** (same approach as CRC/FIR/moving-average); `done` pulses on the last bit,
`busy` is high while counting.

| Part | Function | Parameters |
|---|---|---|
| `Comparator` | magnitude compare — `lt`/`eq`/`gt` (unsigned or signed) | `Width` (default 8, >= 1), `Signed` (0/1, default 0) |

`Comparator` compares `a` and `b` and drives `lt` (a<b), `eq`, and `gt`; with
`Signed: 1` it compares in two's complement via `.signed()`. Unlike `MinMax` (which
returns the selected value), it returns the relation — for thresholds, sorting
networks, or FSM branch conditions. Combinational only.

| Part | Function | Parameters |
|---|---|---|
| `Bin2Bcd` | binary to BCD (double-dabble, bit-serial) | `Width` (default 8, >= 1), `Digits` (BCD digits, default 3), `BcdWidth`/`CntWidth` (derived) |

`Bin2Bcd` latches `bin` on `start` and converts it to BCD (4 bits/digit) over `Width`
cycles — the front end of a 7-segment or decimal display. Each cycle it computes
"add 3 to any digit >= 5" in `comb` (`adj`) then shifts left in `sync`, feeding in the
top binary bit. `255 -> 0x255`, `99 -> 0x099` are checked. Same idiom as the serial
DSP/CRC parts (intermediate result in `comb`, `sync` is non-blocking); `done` pulses
on the final cycle.

| Part | Function | Parameters |
|---|---|---|
| `Mux1H` | one-hot mux (N inputs, one-hot select) | `Width` (word width, default 8, >= 1), `N` (words / select width, default 4, >= 2), `Total` (derived) |

`Mux1H` selects one of N input words with a one-hot `sel` (exactly one bit set). Where
`VecMux` selects with a binary `sel`, this fits places where a decoded control is natural
(instruction decode, ALU result select). The inputs arrive as a concatenated packed vector
`bit[Width*N]`, element `i` at `data[i*Width +: Width]`. `comb` cannot fold an OR, but this
is a selection, so `out = 0` by default is overwritten by the element whose `sel[i]` is 1
(exactly once when one-hot; 0 when `sel` is 0; highest index wins if several bits are set).
Verified that {0x11, 0x22, 0x33, 0x44} are each selected by their one-hot bit. Verilator is
clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `AbsDiff` | absolute difference (`|a - b|`, unsigned or signed) | `Width` (default 8, >= 1), `Signed` (0/1, default 0) |

`AbsDiff` computes the magnitude of the difference of two inputs in one cycle — the kernel of
sum-of-absolute-differences (video motion estimation) and distance metrics (where `Abs` is a
one-input absolute value, this is the size of a two-input difference). Subtracting the smaller
from the larger is always non-negative, so it is a `comb` selection: `a - b` by default,
overwritten by `b - a` when `a < b` (the `MinMax` idiom). `Signed` switches unsigned/signed
comparison. The signed extreme `|-128 - 127| = 255` fits in `Width` bits, as verified.
Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `Extend` | width extension (zero-extend / sign-extend) | `InWidth` (default 8, >= 1), `OutWidth` (default 16, >= InWidth), `Signed` (0/1, default 0) |

`Extend` widens an `InWidth` input to `OutWidth`. `Signed=0` zero-extends; `Signed=1`
sign-extends (replicating the MSB, preserving two's complement) — the standard bridge from a
narrow signal to a wider bus or datapath. Sign-extend uses `.signed().sign_extend[OutWidth]()`
and zero-extend uses `din.resize(OutWidth)` to make the width explicit (a bare assignment
zero-fills but draws a Verilator width warning, so `.resize` is used). Requires
`OutWidth >= InWidth`. Verified 4→8 bits: `0xF -> 0xFF` (signed) / `0x0F` (zero). Verilator is
clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `Thermometer` | binary to thermometer (unary) code | `Width` (output width, default 8, >= 1), `ValWidth` (derived `$clog2(Width+1)`) |

`Thermometer` encodes `value` (0..Width) into a `Width`-bit code whose low `value` bits are 1
(`therm[i] = 1` iff `i < value`) — for flash ADC/DAC codes, unary representation, or "open the
low N of N requests" (where `Decoder` is binary→one-hot, this is binary→thermometer, a run of
`value` ones from the LSB). Each bit is decided independently by `i < value` (`i` a loop
constant), so it is a `comb` selection (`therm = 0` default, set the bits that qualify).
Verified `value` 3 → 0x07, 5 → 0x1F, 8 → 0xFF. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `BarrelShift` | barrel shifter (variable logical / arithmetic shift) | `Width` (default 8, >= 2), `Right` (0=left / 1=right, default 0), `Arith` (0=logical / 1=arithmetic, right only, default 0), `ShWidth` (derived) |

`BarrelShift` shifts `din` by `amt` (where `Rotator` rotates, this fills the vacated side with 0
or the sign). It supports left (zero-fill low), logical right (zero-fill high), and arithmetic
right (sign-replicate). **IRIS's `>>` is a logical shift even on `.signed()`** (zero-fill), so
the arithmetic right shift is built by hand: OR the logical right shift with a top-`amt`-bits
mask `~((din | ~din) >> amt)` when the sign bit is set (all-ones is formed as `din | ~din`;
`comb` can't re-read what it just wrote, so this is one expression). Verified 0x80(-128)>>1 =
0xC0, 0xF0(-16)>>4 = 0xFF, positive values match the logical shift, and amt=0 is unchanged.
Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `Ctz` | count trailing zeros (index of the lowest set bit) | `Width` (default 8, >= 1), `CountWidth` (derived `$clog2(Width)+1`) |

`Ctz` counts the zeros from the LSB up to the first 1 (the index of the lowest set bit; `Width`
if none) — the counterpart to `Lzc`, for priority encoders, alignment, or power-of-two tests.
Since `comb` is last-wins, the lowest set bit must be written last; IRIS's `for` runs low→high,
so the index is walked as `Width-1-i` (high→low) to let the lowest set bit win. Verified
ctz(0x08)=3, 0x0A=1, 0x01=0, 0x80=7, 0x00=8. The `count = Width;` WIDTHTRUNC note matches the
shipped `Lzc`.

| part | function | parameters |
|---|---|---|
| `Negate` | two's-complement negation (with overflow flag) | `Width` (default 8, >= 2) |

`Negate` outputs `-a` for a signed (two's-complement) `a` (equivalent to `~a + 1`) — for
building a subtrahend, flipping a coefficient's sign, or polarity switching. Combinational only.
It is written as `0 - a` so the NOT is not placed in a 32-bit context, keeping Verilator clean
under `-Wall` (the same trick as `SignMag`). Only the most-negative value (0x80..) cannot be
represented positive in the same width and wraps back to itself, so `ovf` flags exactly that one
case. Verified -(5)=0xFB, -(-5)=5, and -(0x80)=0x80 with ovf=1.

### mem

| Part | Function | Parameters |
|---|---|---|
| `FifoSync` | single-clock synchronous FIFO (first-in first-out) | `Width` (default 8), `Depth` (default 4, power of two), `AddrWidth`/`PtrWidth` (derived from Depth) |
| `FifoAsync` | two-clock-domain asynchronous FIFO (gray-code pointer sync) | `DataWidth` (default 8), `Depth` (default 16, power of two >= 4), `AddrWidth`/`PtrWidth` (derived) |
| `RamSp` | single-port synchronous RAM (registered read, read-before-write) | `Width` (default 8), `Depth` (default 256, >= 2), `AddrWidth` (derived) |
| `RamDp` | simple dual-port RAM (one write, one read, registered read) | `Width` (default 8), `Depth` (default 256, >= 2), `AddrWidth` (derived) |
| `Ram2r1w` | 2-read / 1-write RAM (register-file shape, registered read) | `Width` (default 8), `Depth` (default 32, >= 2), `AddrWidth` (derived) |

`FifoSync` uses a `mem` and pointers with a wrap bit. `empty` is pointer
equality; `full` is a differing wrap bit with equal low address bits.

`FifoAsync` synchronizes gray-code pointers through two flops so metastability
does not propagate (the `example/async_fifo` design as a part). **Its resets are
active-low (`wr_rst_n`/`rd_rst_n`)**, unlike the library default (active-high) —
a deliberate exception matching the usual async-FIFO convention. The max-delay
SDC constraints cannot be emitted from IRIS and are the user's responsibility.

`RamSp` is a plain single-port synchronous RAM (a `mem`) read and written through
one address port. The read is registered, so it takes one cycle. Reading and
writing the same address on one cycle returns the old value on `dout`
(read-before-write). The RAM contents are not reset (a `mem` is not a reset
target); reset only clears the output register `dout`. Write byte-enables are not
included (add a variant when needed).

`RamDp` is a synchronous RAM with a separate write port (`we`/`waddr`/`din`) and
read port (`raddr`/`dout`). On one clock it can be written while a different
address is read (the basis for a FIFO or a line buffer). The read is registered,
and if the write and read address the same location on one cycle, `dout` returns
the old value (the same read-before-write as `RamSp`). A true dual-port RAM (read
and write on both ports) is not included.

`Ram2r1w` has two read ports and one write port (a register-file shape), so two
operands can be read at once. Registered reads, read-before-write.

| Part | Function | Parameters |
|---|---|---|
| `ShiftRegister` | fixed-stage delay line (`en` advances one stage) | `Width` (default 8, >= 1), `Stages` (stages = delay cycles, default 4, >= 1), `Total` (derived `Width*Stages`) |

`ShiftRegister` latches `din` on `en` and emits it `Stages` cycles later on
`dout`. Stages live in a packed vector `bit[Width*Stages]`; on `en`, stage `i`
takes stage `i-1`. sync is non-blocking (the right-hand side reads the pre-edge
value), so the part-select assignments are a correct shift; `en` low holds. Use it
for pipeline delay matching or sample delay.

| Part | Function | Parameters |
|---|---|---|
| `RingBuffer` | circular buffer (sequential write + random read, registered read) | `Width` (default 8, >= 1), `Depth` (default 8, >= 2), `AddrWidth` (derived) |

`RingBuffer` writes `din` at the write pointer `wp` on each `we` and advances `wp`
(wrapping to 0 at the end); reads are addressable via `raddr` (registered, one-cycle
delay). It exposes `wptr` so relative addressing is computed from `wp` by the user.
Use it for FIR delay lines, line buffers, or history — unlike a FIFO's sequential
front-read, the write auto-advances and the read is absolute-addressed. Contents are
not reset (`mem`).

| Part | Function | Parameters |
|---|---|---|
| `Lifo` | LIFO (stack, last-in first-out) | `Width` (default 8, >= 1), `Depth` (default 8, >= 2), `AddrWidth`/`PtrWidth` (derived) |

`Lifo` pushes `din` to `storage[sp]` and increments `sp` on `push`, and reads the
top `storage[sp-1]` and decrements `sp` on `pop` (registered read, one-cycle delay);
`sp` is the element count and `push` takes priority (issue one at a time). The FIFO's
counterpart — for save/restore, bracket matching, backtracking, or reversal. Contents
are not reset (`mem`).

| Part | Function | Parameters |
|---|---|---|
| `Cam` | content-addressable memory (search by key, one-hot match) | `Width` (key width, default 8, >= 1), `Entries` (default 4, >= 2), `SelWidth`/`IdxWidth`/`Total` (derived) |

`Cam` stores a key in each of `Entries` entries and marks the entries matching a search
`key` in a one-hot `match_oh` (`hit = match_oh != 0`) — a routing table, cache tag match, or
address compare. An entry is written at `waddr` on `we` and enabled with a `valid` bit;
`clear` invalidates all. With no array ports, entries live in a concatenated packed vector
`bit[Width*Entries]` accessed by part-select / part-write (the `VecMux`/`VecDemux` idiom; the
write position is widened `waddr.resize(IdxWidth)*Width`, but the single-bit `valid` write
indexes with `waddr` directly, since an over-wide index draws a Verilator width warning). The
search compares each entry against `key` with a fixed part-select and builds `match_oh` in
`comb`. `match` is an IRIS keyword, so the output is named `match_oh`. A duplicate key sets
several bits (pair with `PriorityEncoder` for the first-match index). Verilator is clean under
`-Wall`.

### arbiter

| Part | Function | Parameters |
|---|---|---|
| `ArbiterFixed` | fixed-priority arbiter (one-hot grant to the lowest request) | `N` (requests, default 4, >= 2) |
| `ArbiterRr` | round-robin arbiter (fair rotation, `update` advances) | `N` (requests, default 4, >= 2) |

`ArbiterFixed` isolates the lowest set bit with two's complement
(`req & (~req + 1)`) — no loop needed.
`ArbiterRr` rotates using a priority mask (indices above the last grant):
`mask = ~(grant | (grant - 1))`. Granting the top bit makes the mask 0, which
wraps to the lowest — so no all-ones literal is needed.

| Part | Function | Parameters |
|---|---|---|
| `ArbiterLock` | fixed-priority arbiter with grant hold (held while `lock`) | `N` (requesters, default 4, >= 2) |

`ArbiterLock` is `ArbiterFixed`'s lowest-priority pick, but while `lock` is high it holds the
previous grant as long as that master keeps requesting — so an atomic/locked burst is not
preempted by a higher-priority request mid-transaction (DMA locked transfers, read-modify-write,
indivisible transactions). It registers the previous grant and, when `lock && (held & req) != 0`,
keeps `grant = held & req`; otherwise `req & (~req + 1)` (no fold — just bitwise ops and a
compare-to-0). The `&`-with-compare mix is avoided with nested `if`s. Verified that master2 is
held under lock even as higher-priority master1 arrives, and switches once lock releases. The
`~req + 1` WIDTHEXPAND matches the shipped `ArbiterFixed`.

| part | function | parameters |
|---|---|---|
| `Semaphore` | counting semaphore (acquire/release, capacity limit) | `Width` (count/capacity width, default 4, >= 1) |

`Semaphore` counts tokens from 0 to capacity `max`: `acquire` takes one (with `grant` when there
is room) and `rel` returns one — for limiting concurrent use of a shared resource, bounding
outstanding requests, or producer/consumer inventory. Capacity 1 makes it a mutex (binary
semaphore). `grant` is combinational `acquire & (count < max)` (the `&`-with-compare mix avoided
with nested `if`s); `rel` decrements only when `count > 0` (saturates at 0). Simultaneous
`acquire` and `rel` cancel, leaving `count` unchanged. The input is named `rel` because `release`
is a SystemVerilog keyword. Verified filling 0→3 with grant dropping when full, draining 3→0 with
`empty` at the bottom, and the cancel on simultaneous acquire/release.

### stream

| Part | Function | Parameters |
|---|---|---|
| `SpillRegister` | ready/valid depth-2 buffer (skid buffer) | `Width` (default 8, >= 1) |

`SpillRegister` breaks the upstream/downstream path, loses no data under
backpressure, and passes one word per cycle when not stalled. `in_ready` depends
only on the skid slot being free (not combinationally on `out_ready`).

| Part | Function | Parameters |
|---|---|---|
| `StreamRegister` | ready/valid depth-1 registered stage (cuts both combinational paths, with `flush`) | `Width` (default 8, >= 1) |

`StreamRegister` registers the forward side (valid/data) and drives the backward
side from its own slot (`in_ready = ~valid_q`), so it breaks the combinational
path between upstream and downstream in both directions. Being depth-1, it passes
one word every two cycles under continuous flow (50% throughput). Use the depth-2
`SpillRegister` when 100% throughput is needed; use `StreamRegister` for the
shortest path and smallest area. A cycle with `flush` high drops the stored word
and empties the stage (for pipeline flush / bubble insertion).

| Part | Function | Parameters |
|---|---|---|
| `Serializer` | parallel-in serial-out (PISO, LSB-first) | `Width` (default 8, >= 1), `CntWidth` (derived) |

`Serializer` latches `din` on `load` and shifts out one bit per cycle on `dout`
over `Width` cycles (LSB-first); `valid` is high while sending and `done` on the
last bit. Sending `0xB4` and reassembling the bits recovers the byte.
`Deserializer` is its dual (SIPO): each `en` latches `din`, and after `Width`
bits it drives `dout` with `valid`.

| Part | Function | Parameters |
|---|---|---|
| `VecMux` | N-to-1 select over a packed vector | `Width` (default 8, >= 1), `N` (default 4, >= 2), `SelWidth`/`IdxWidth`/`Total` (derived) |
| `VecDemux` | 1-to-N routing over a packed vector | same |

`VecMux`/`VecDemux` show how a multi-stream mux/demux is expressed without array
ports: N `Width`-bit elements are concatenated into one `bit[Width*N]` vector and
element `i` is selected with `[i*Width +: Width]`. `sel` is widened to `IdxWidth`
before the multiply so `sel*Width` does not overflow (IRIS multiply wraps to the
operand width). `VecDemux` fills `data` with 0 first, then overwrites the chosen
element with a part-select write (combinational partial writes accumulate).
Combinational only.

| Part | Function | Parameters |
|---|---|---|
| `StreamDownsizer` | width conversion (one wide word -> N narrow words, ready/valid) | `Width` (default 8, >= 1), `N` (default 4, >= 2), `Total`/`CntWidth`/`IdxWidth` (derived) |
| `StreamUpsizer` | width conversion (N narrow words -> one wide word, ready/valid) | same |

`StreamDownsizer` latches one `Width*N` word into a holding register and emits it
one `Width`-bit element at a time (LSB-first) on each `out_ready`, dropping
`in_ready` while busy. `StreamUpsizer` is the reverse: it gathers N narrow words
into one wide word and raises `out_valid` when full. The element position is
`cnt` widened to `IdxWidth` times `Width`, read/written with a part-select (the
same technique as `VecMux`/`VecDemux`). Both honor ready/valid backpressure.

| Part | Function | Parameters |
|---|---|---|
| `StreamFork` | 1 input -> N outputs (transfers when all consumers are ready) | `Width` (default 8, >= 1), `N` (default 2, >= 2), `Total` (derived) |
| `StreamJoin` | N inputs -> 1 output (transfers when all inputs are valid) | same |

`StreamFork` broadcasts the input to N outputs (each `out_valid` = `in_valid`, each
`out_data` element = `in_data`) and sets `in_ready` to the AND of `out_ready` (the
beat transfers when every consumer is ready at once). `StreamJoin` is the reverse:
`out_valid` is the AND of `in_valid`, and each `in_ready[i]` is "all valid and
`out_ready`" (all inputs consumed together). The N-way valid/ready are `bit[N]`,
data is a packed vector. Combinational only; no per-output/-input buffering (insert
a `SpillRegister` where independent buffering is needed).

| Part | Function | Parameters |
|---|---|---|
| `StreamFilter` | pass/drop items by a `keep` predicate | `Width` (default 8, >= 1) |
| `CreditCounter` | credit-based flow control | `Width` (default 8, >= 1), `MaxCredit` (initial credits, default 8) |

`StreamFilter` forwards an item when `keep` is 1 (`out_valid = in_valid`, gated by
`out_ready`) and swallows it when `keep` is 0 (`in_ready` held high, no output) —
for dropping unwanted items. Combinational only. `CreditCounter` tracks available
credits: `give` returns one (+1), `take` spends one (-1), both at once cancel; it
starts at `MaxCredit` and raises `available` while any remain — the classic
credit-based flow-control counter.

| Part | Function | Parameters |
|---|---|---|
| `StreamArbiter` | N-input to 1-output round-robin arbitration | `Width` (default 8, >= 1), `N` (default 4, >= 2), `Total`/`SelW`/`KW`/`IdxW` (derived) |

`StreamArbiter` picks one valid input and forwards it. It rotates fairly from just
after the last granted position `ptr` (round-robin). The selection uses comb
last-wins: it scans offsets from far to near so the valid input nearest `ptr` is
written last and wins. `out_valid` is "any input valid", `in_ready` is asserted on
the granted line only, and accepting the output advances `ptr`. Unlike `StreamJoin`
(all inputs required), it selects one — for merging onto a shared bus.

| Part | Function | Parameters |
|---|---|---|
| `StreamThrottle` | limit the number of outstanding transactions | `Width` (default 8, >= 1), `CntWidth` (default 4), `MaxOutstanding` (default 4) |

`StreamThrottle` passes a ready/valid stream through but caps the number of
issued-but-not-completed (in-flight) transactions at `MaxOutstanding`. While at the
cap it stalls the forward path (`out_valid=0`, `in_ready=0`). An issue is a cycle
with `out_valid & out_ready`, a completion is a cycle with `done`, and the two
cancel when they coincide. Use it to bound read reordering depth or the number of
unanswered requests on a bus. The decision is written as nested `if`s to avoid
mixing `&` with a comparison. `cnt < MaxOutstanding` compares operands of different
widths, so Verilator emits WIDTHEXPAND, but the value is correct (same class of
warning as `ArbiterFixed`).

### cdc

| Part | Function | Parameters |
|---|---|---|
| `Sync2ff` | two-flop synchronizer | `Width` (default 1, >= 1) |
| `RstSync` | reset synchronizer (async assert, sync deassert) | none |
| `PulseSync` | pulse across clock domains (toggle + two-flop sync + edge detect) | none (two clocks) |

`PulseSync` passes a toggle rather than a level, so a pulse is not lost in the
sync stages. Space input pulses wider than the sync latency (a few cycles).

`Sync2ff` takes a signal from another domain through two flops. `RstSync`
synchronizes only the reset release (assert is immediate). Both fix the depth at
the usual two stages.

**CDC parts give logic only.** The placement constraints real synchronization
needs (`ASYNC_REG`/`dont_touch`, a max-delay SDC) cannot be emitted from IRIS;
adding them is the user's responsibility. A parameterizable stage count is not
expressible today (a `var` array needs a constant size), so the depth is two.

| Part | Function | Parameters |
|---|---|---|
| `HandshakeSync` | multi-bit value across clock domains (2-phase toggle handshake) | `Width` (default 8, >= 1) |

`HandshakeSync` passes one word from the source domain to the destination domain
(lighter than an async FIFO, for occasional single-word transfers). On `send` (when
`src_ready`) it latches the word and flips a request toggle; the destination 2-flop
syncs the toggle, captures the held register (a stable multi-cycle path) on a change,
pulses `valid`, and returns an ack toggle; the source 2-flop syncs the ack and, once
it catches up, re-raises `src_ready`. The data lines themselves are not synchronized
(the source holds them until the ack returns, so they are stable). Max-delay SDC on
the toggle/data lines is the user's responsibility.

| Part | Function | Parameters |
|---|---|---|
| `GrayCodeSync` | gray-coded value synchronizer (multi-bit CDC pointer receive) | `Width` (value width, default 8, >= 1) |

`GrayCodeSync` 2-flop-synchronizes a gray-coded value `gray_in` from another domain (a
`GrayCounter` output or a FIFO pointer) on the receive clock, then converts it back to binary
`bin_out`. Because a gray code changes one bit at a time, a sample taken mid-transition
settles to either the old or new value (never a corrupt intermediate), so a multi-bit value
crosses safely — the core of `FifoAsync` pointer passing. The depth is fixed at two (same
reason as `Sync2ff`); the synchronized value is decoded with the `Gray2Bin` reduction
`(g2 >> i).xor_reduce()`. Verified that gray(0..7) decodes to 0..7 with a two-cycle latency.
**The input must be gray-coded** (not a raw binary bus). CDC constraints (`ASYNC_REG`,
max-delay SDC) can't be emitted from IRIS — logic only. Verilator is clean under `-Wall`.

| part | function | parameters |
|---|---|---|
| `RstSequencer` | staged reset-release sequencer | `N` (stages, default 4, >= 1), `Width` (timer width, default 8, >= 1), `StgWidth` (derived) |

`RstSequencer` releases `N` reset outputs `rst_out` one at a time from the LSB, every `step` cycles,
after the global reset deasserts — for bringing blocks up in stages once power/clocks are stable, or
waking dependent domains in a fixed order (where `RstSync` is a single-bit deassert sync, this builds
a multi-stage release order). It holds a released-stage count `stage` and bumps it whenever the timer
reaches `step` (the same `>=` terminus as `Prescaler`). The output is an inverted `Thermometer`,
`rst_out[i] = 1 ⇔ i >= stage` (default 1, overwritten to 0 where `i < stage`); `stage == N` raises
`done`. `step` is a runtime port (`step >= 1`). The `i`/`N` compares are width-matched with
`.resize(StgWidth)` to stay warning-free. Outputs are active-high (1 = in reset). Verified with N=4,
step=5 the release goes 0xF→0xE→0xC→0x8→0x0 and `done` asserts, with per-cycle invariants that a
released stage never re-asserts and the released set is always low-contiguous. Verilator is clean
under `-Wall`.

### coding

| Part | Function | Parameters |
|---|---|---|
| `Crc` | CRC (cyclic redundancy check, bit-serial) | `Width` (default 8, >= 2); polynomial `poly` is an input port |
| `Parity` | parity generator (even/odd) | `Width` (default 8, >= 1), `Odd` (0=even / 1=odd, default 0) |
| `Secded` | single-error-correct, double-error-detect (extended Hamming (13,8) over 8-bit data) | none (data fixed at 8 bits); `SecdedEnc` + `SecdedDec` |
| `TmrVoter` | triple-modular-redundancy vote (bitwise, with a mismatch flag) | `Width` (default 8, >= 1) |
| `Checksum` | one's-complement sum checksum (end-around carry) | `Width` (default 8, >= 1), `Ext` (derived `Width+1`) |

`Crc` takes one bit per cycle MSB-first and updates with `poly` (an LFSR with a
data input); `clear` starts a new stream. A parallel CRC (a byte per cycle)
needs a sum-fold XOR tree and is not expressible in today's `comb`.

`Parity` XORs the bits with `.xor_reduce()` (even parity); `Odd` inverts it for
odd parity. iris2sv converts `.xor_reduce()` to the SV reduction operator `(^d)`.

`Secded` is the classic memory ECC: `SecdedEnc` (8-bit data → 13-bit codeword)
and `SecdedDec` (codeword → corrected data plus `single_err`/`double_err`).
Parity uses `.xor_reduce()`, and correction flips the bit the syndrome points at.
A testbench confirms it corrects a single-bit error and detects a double-bit
error. The data width is fixed at 8 (a general Hamming code needs a compile-time
parity count, which IRIS cannot express as a generic width).

`TmrVoter` outputs the bitwise majority of three redundant inputs `a`/`b`/`c`
(`y = a&b | b&c | a&c`), so a single bit-flip in any one is absorbed. It raises
`mismatch` from the OR-reduction of the three pairwise XORs, flagging a
disagreement. Use it for SEU tolerance or a functional-safety output vote.
Combinational only.

`Checksum` accumulates `din` into a one's-complement sum on each `en` (the Internet
checksum): the carry is folded back into the low bits (end-around carry), so the
result is order-independent; `clear` resets it. A single addition cannot double-carry,
so one fold is exact. The sum is formed in `comb` (reading a var written in the same
`sync` block would give last cycle's value) and registered into `acc`; the
transmitted checksum is the one's complement of `sum` (`~sum`). Bit-serial, like `Crc`.

| Part | Function | Parameters |
|---|---|---|
| `Scrambler` | scrambler (self-synchronizing, bit-serial, LFSR) | `Width` (LFSR length, default 7, >= 2); polynomial `poly` is an input port |
| `Descrambler` | descrambler (the dual of `Scrambler`, self-synchronizing) | same |

`Scrambler` whitens the input with a `poly` LFSR: feedback is
`(sr & poly).xor_reduce()`, the output is `scr = din ^ feedback`, and the state `sr`
shifts in the **transmitted `scr`** (the self-synchronizing key). `Descrambler` uses
the same `poly`, outputs `din ^ feedback`, and shifts the **received `din`** into
`sr`. Being self-synchronizing it needs no seed exchange — it locks within a few
bits and recovers the original stream (round-trip verified). Use it to break up runs
of 0/1 and keep DC balance (line coding).

| Part | Function | Parameters |
|---|---|---|
| `DiffPair` | dual-rail differential encode/decode (break / fault detection) | `Width` (data width, default 8, >= 1; code is 2*Width) |

`DiffPair` is the `DiffEncode`/`DiffDecode` pair. Each data bit `d[i]` is encoded onto a
complementary rail pair `{d[i], ~d[i]}` (`enc[2*i]` = true, `enc[2*i+1]` = complement); the
receiver recovers the bit when the pair is complementary and raises `err` on `(0,0)` or
`(1,1)` (a broken wire or stuck-at fault) — for functional-safety signal lines. Both encode
and decode are combinational, built one pair at a time with a `for` loop. The `err` flag
needs a reduction, which `comb` cannot fold, so per-pair bad flags are gathered into a
`Width`-wide vector `bad` and collapsed with `err = bad != 0` (a compare to 0). Verified with
a 0xB4→0x659A→0xB4 loopback (err=0) and both all-`(0,0)` and single-broken-pair codes (err=1).
The MULTITOP (two modules in one file) and MULTIDRIVEN (a `comb` temp) `-Wall` notes match the
established `Secded` (two modules) and `SatAdd` (comb temp) patterns; the conformance Verilator
functional check passes.

| Part | Function | Parameters |
|---|---|---|
| `Interleaver` | block interleaver (row-major write, column-major read) | `Width` (symbol width, default 8, >= 1), `Rows` (power of 2, default 2, >= 2), `Cols` (power of 2, default 4, >= 2), `Depth`/`RowWidth`/`ColWidth`/`AddrWidth` (derived) |

`Interleaver` writes symbols row-major into a Rows×Cols block and reads them column-major to
reorder them, spreading a burst error over time so a downstream FEC sees scattered single
errors (comms, storage). `we` fills the block via a write counter; `re` reads column-major.
Restricting `Rows` and `Cols` to powers of two makes the column-major address `rr*Cols + rc`
exactly the concatenation `{rr, rc}` (no multiply), and the counters wrap naturally at each
width. The concatenation indexes the memory inline (no `comb` temp, so no MULTIDRIVEN warning).
Registered read gives a one-cycle latency; `dvalid` follows `re` by one cycle. Verified that
0..7 reorders to 0,4,1,5,2,6,3,7. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `LockstepCompare` | compares two redundant cores (staggered delay, sticky fault latch) | `Width` (default 8, >= 1), `Delay` (stagger stages, default 1, >= 1), `Total` (derived = Width*Delay) |

`LockstepCompare` checks the outputs of two redundant cores that run the same
computation and raises `error` when they disagree. To avoid common-cause faults,
core B runs `Delay` cycles behind core A; the comparator delays core A's output
through a `Delay`-stage line (a packed vector, like `ShiftRegister`) to align it
with core B's current value before comparing. A parallel 1-bit validity line
(`bit[Delay]`) suppresses false errors while the delay line fills. `error_sticky`
latches on the first mismatch and holds until reset. Unlike `TmrVoter` (three-way
majority that masks a single fault), it detects faults by comparing two inputs —
for functional safety. Verilator is clean under `-Wall`.

### periph

| Part | Function | Parameters |
|---|---|---|
| `UartTx` | UART transmitter (start 0, LSB-first 8 bits, stop 1) | `ClksPerBit` (baud divisor, default 4, >= 2) |
| `UartRx` | UART receiver (falling-edge detect, sample at bit centers) | `ClksPerBit` (default 4, >= 2) |
| `SpiMaster` | SPI master (mode 0, MSB-first, full-duplex) | `Width` (default 8), `ClkDiv` (clocks per sclk half-period, default 2) |
| `I2cMaster` | I2C master (single-byte write: START + 8 bits + ACK + STOP) | `ClkDiv` (clocks per quarter-bit, default 2) |

`UartTx`/`UartRx` are FSM + shift register + bit-time counter (the first Tier-3
"buildable in IRIS" parts). A TX→RX loopback confirms a sent byte is received
unchanged. The baud rate is `clk / ClksPerBit`; raise `ClksPerBit` to match a
real baud rate.

`SpiMaster` divides the clock for `sclk`, samples MISO on the rising edge and
updates MOSI on the falling edge (mode 0). Tying MISO to MOSI makes received
equal sent, which the loopback test checks (full-duplex). The `sclk` period is
`2 * ClkDiv` clocks; `cs_n` is active-low.

`I2cMaster` does a single-byte write (START + 8 bits + ACK + STOP). SDA is
open-drain, modeled by an output enable `sda_oe` (1 drives 0, 0 releases) and an
input `sda_i`. Each bit is four quarter-phases; START pulls SDA 1→0 while SCL is
high, STOP drives SDA 0→1 while SCL is high. Repeated start, reads, multi-byte,
clock stretching, and arbitration are not included (see OSS for a full version).

### dsp

| Part | Function | Parameters |
|---|---|---|
| `FirSerial` | serial (time-multiplexed) FIR filter (one multiplier, `Taps` cycles per sample) | `Width` (default 8), `Taps` (default 4, >= 2), `CoeffWidth` (default 8), `AccWidth`/`IdxWidth`/`CntWidth` (derived) |
| `MacSerial` | serial multiply-accumulate: `acc += a*b` on each `en`, `clear` zeroes it | `AWidth` (default 8), `BWidth` (default 8), `GuardBits` (default 8), `AccWidth` (derived), `Signed` (0=unsigned / 1=signed, default 0) |

`MacSerial` is the elemental DSP part: it adds `a*b` to `acc` on each `en`, and
computes a dot product Σ a[i]*b[i] by streaming pairs one at a time (the core of
`FirSerial` on its own). To avoid the multiply truncation, inputs are
zero-extended to `AccWidth`, and, to fit the non-blocking `sync`, it is two stages
(register+widen, then multiply-accumulate) — so there is a 2-cycle latency from
input to `acc`, and `valid_out` pulses with the same latency. `clear` takes
priority over `en`. With `Signed: 1` the inputs are sign-extended with
`.signed().sign_extend[AccWidth]()` instead (the two's-complement bits accumulate
correctly, so the add and multiply are unchanged); read the result with
`acc.signed()` (a signed dot product of `-68` is checked).

`FirSerial` computes `y[n] = Σ coeff[k]*x[n-k]` with a single multiplier used
across `Taps` cycles. Coefficients are loaded through a write port; samples enter
one at a time on `in_valid` and results leave on `out_valid`. **A convolution
(a sum) cannot be written in `comb`, but making it serial and unrolling over time
lets `sync` accumulate it one tap per cycle** — the concrete case of the Tier-3
policy "if it can be serialized, write it in IRIS". Multiplication truncates to
the operand width, so coefficients and samples are held zero-extended in
`AccWidth`-wide mems, and the wide product is not truncated. `FirSerial` itself is
unsigned, but a signed FIR follows the same recipe as `MacSerial`'s `Signed` mode
(`.signed().sign_extend[AccWidth]()`).

**Signed arithmetic works.** Reinterpret a `bit[N]` as signed with `.signed()` and
sign-extend with `.sign_extend[M]()`; the two's-complement product accumulates
correctly (`MacSerial[Signed: 1]` is the worked example). Signed `==`/`!=` compare
by value, so a signed result compares against a negative literal
(`acc.signed() == -68`); this comparison was fixed in iris-sim (see spec 9.3.1).
A generic width on `int[Width]`/`uint[Width]` also works now (like `bit[Width]`; a
parser limitation was fixed) — so signed parts can use either `bit[N]` + `.signed()`
or `int[N]` directly and keep the width generic.

| Part | Function | Parameters |
|---|---|---|
| `MovingAverage` | moving average (boxcar, window `N` = power of two) | `Width` (default 8, >= 1), `N` (window, power of two, default 4, >= 2), `LogN`/`SumWidth`/`Total` (derived) |

`MovingAverage` outputs the mean of the last `N` samples. A sum-fold (adding `N`
samples every cycle) is not expressible in `comb`, but a **running sum** is
(`sum += din - the oldest sample leaving the window`); the oldest comes from the
last stage of an `N`-deep delay line (a packed vector). With `N` a power of two the
mean is `sum >> LogN`. After reset the delay line is 0, so it ramps up correctly
over the first `N` cycles — the same "unroll a convolution over time" approach as
`FirSerial`.

| Part | Function | Parameters |
|---|---|---|
| `ComplexMult` | complex multiply ((ar+j*ai)*(br+j*bi), signed, combinational) | `Width` (input real/imag width, default 8, >= 1), `OutWidth` (derived = 2*Width+1) |

`ComplexMult` computes the product of two complex numbers in one combinational
cycle (real = ar*br - ai*bi, imag = ar*bi + ai*br) — the core of a mixer, an FFT
butterfly, or a complex correlator. IRIS's `*` truncates to the operand width, so
each input is sign-extended to the result width with `.signed().sign_extend[OutWidth]()`
before the multiply; the full product then lands in the low bits, and the difference
and sum are correct in two's complement. `comb` cannot re-read a variable updated in
the same block, so it uses no intermediates and writes the expressions directly. The
output is signed (read with `.signed()`). Checked against `(3+2j)(4+5j)=2+23j` and
`(-3+2j)(4-5j)=-2+23j`.

| `PeakDetect` | peak / threshold detection (with hysteresis, unsigned) | `Width` (sample and threshold width, default 8, >= 1) |

`PeakDetect` raises `over` when `din` rises above `thr_high` and holds it until `din`
falls below `thr_low` (a Schmitt-trigger hysteresis). A single threshold chatters near
the level under noise; the two thresholds form a dead band that prevents it. It also
latches the maximum during an event into `peak` (started at the rising sample, updated
to the running max while over, held after the falling edge, restarted on the next rise).
`sync` is non-blocking, so every update is decided by pre-edge values with no self-
reference. The thresholds are input ports and can change at runtime (keep
`thr_low < thr_high`). Verified over the sequence 50, 210, 230, 180, 90, 250 for both
the hysteresis and the peak hold.

| `CicDecimator` | CIC decimator (1st order, decimation filter, no multiplier) | `Width` (input width, default 8, >= 1), `R` (decimation rate, default 4, >= 2), `CntWidth` / `AccWidth` (derived) |

`CicDecimator` feeds the input into an integrator (accumulator) and, once every R samples,
outputs the difference between the current accumulator and its value at the previous
decimation point (a 1st-order CIC: integrator plus comb). That difference equals the sum
of the most recent R samples, so it decimates and boxcar-sums without a multiplier. A CIC
works in modular arithmetic: the integrator wraps naturally in `AccWidth` bits and the
comb difference recovers the correct sum (`AccWidth = Width + $clog2(R)` absorbs the
1st-order bit growth). `sync` is non-blocking, so the updated accumulator is written out as
`acc + din` (the block cannot re-read `acc`). Verified: constant 10 gives a sum of 40,
switching to 20 gives 80, and `dvalid` asserts once per four samples. The `$clog2`-derived
`CntWidth` compared against `cnt == R - 1` draws a WIDTHEXPAND note under `-Wall` (the same
as `ClkDivider` and other parameterized-compare parts); the value is correct and the
conformance Verilator functional check passes.

| `PidController` | PID controller (positional form, signed) | `DataWidth` (setpoint/measured width, default 8, >= 1), `GainWidth` (gain width, default 8, >= 1), `OutWidth` (internal/output width, default 32) |

`PidController` sums the proportional, integral, and derivative terms of the error
`e = sp - pv` into a control output (`dout = Kp*e + Ki*Σe + Kd*(e - e_prev)`) — the core of a
closed loop. To avoid multiply truncation, everything is sign-extended into one wide signed
domain `OutWidth` with `.signed().sign_extend[OutWidth]()` before multiplying (same as
`ComplexMult`). `sync` is non-blocking, so the error is registered one stage and the three
terms are formed the next cycle from that error, the previous error, and the integral (the
same two-stage shape as `MacSerial`); hence `dout` is 0 on the first `en` (one-cycle error
registration). Verified with Kp=2/Ki=1/Kd=3 for a positive error +6 (36→24→30→42…) and a
negative error -6 (mirrored). No integral anti-windup (pair with `SatAdd` if needed).
Verilator is clean under `-Wall`.

| `IirBiquad` | 2nd-order IIR filter (biquad, Direct Form I, signed) | `DataWidth` (input width, default 8, >= 1), `CoeffWidth` (coefficient width, default 8, >= 1), `FracBits` (fractional bits, default 0), `AccWidth` (internal/output width, default 32) |

`IirBiquad` computes one 2nd-order IIR section in Direct Form I
(`y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]`) — the building block for
higher-order filters by cascading, and the infinite-response counterpart to `FirSerial`.
Coefficients, input, and state are sign-extended to `AccWidth` before multiplying (same as
`ComplexMult`). Because `sync` is non-blocking, the output register `y1` doubles as the
feedback source: assigning the new output to `y1`, the old `y1` to `y2`, the current input to
`x1`, and the old `x1` to `x2` all resolve from pre-edge values, so no intermediates are
needed. Verified with a b=[1,2,1] FIR step response (1,3,4,4) and a b0=1/a1=-1 accumulator
(1,2,3,4,5, exercising feedback and a negative coefficient). `FracBits > 0` drops the
fractional part with an arithmetic right shift (truncation toward negative infinity, no
rounding); the TB covers `FracBits = 0` integer coefficients. Verilator is clean under `-Wall`.

| `Median3` | 3-tap median filter (streaming, unsigned or signed) | `Width` (sample width, default 8, >= 1), `Signed` (0 = unsigned / 1 = signed, default 0) |

`Median3` outputs the median of the most recent three samples every cycle — a nonlinear
filter that removes single-sample spikes (salt-and-pepper noise, outliers) without blurring
edges (unlike a moving average, a one-sample impulse is never selected as the median). No
multiplier. The median is the value that is neither the max nor the min; for three inputs it
is chosen with nested comparisons. `comb` cannot re-read a signal it just wrote, but this is
a selection (the comparisons read only inputs), so it is expressible in `comb` (the `MinMax`
idea nested for three inputs). Verified that a spike of 100 in 10,10,100,10,10… never appears
at the output. Verilator is clean under `-Wall`.

| Part | Function | Parameters |
|---|---|---|
| `Histogram` | histogram accumulation (per-bin counters) | `Bins` (default 8, >= 2), `CountWidth` (counter width, default 8, >= 1), `BinWidth`/`Total`/`IdxWidth` (derived) |

`Histogram` increments the counter of the bin `bin` on each `en` and reads any bin's count on
`raddr`→`rcount`; `clear` zeroes all bins — for a luminance histogram, statistics gathering, or
threshold selection. The per-bin counters live in a concatenated packed vector
`bit[CountWidth*Bins]` of registers, so a **read-modify-write completes in one cycle** and
consecutive hits on the same bin are not dropped (a registered-read RAM would incur a
one-cycle read latency and an RMW hazard on back-to-back increments; this avoids it). The
write position is widened `bin.resize(IdxWidth)*CountWidth`; `clear` zeroes the whole vector at
once. Verified the sequence 1,1,2,1,3,3 gives counts 3/1/2 and `clear` resets to 0. Counters
wrap (no saturation — pair with `SatAdd` if needed). Verilator is clean under `-Wall`.

| part | function | parameters |
|---|---|---|
| `Correlator` | serial bit correlator (matched filter, sync-word detect) | `Length` (correlation length, default 8, >= 2), `IdxWidth`/`SumWidth` (derived) |

`Correlator` starts a block on `start`, takes one input bit `din` per `en`, and counts how many
match the reference `pattern`'s corresponding bit. After `Length` bits it pulses `done` for one
cycle and settles the match count `score` and the over-threshold decision `detect` — for PN-code,
preamble, or sync-word detection, and bit-level matched filtering. The correlation is accumulated
serially per `en` (like `MacSerial`), since `comb` cannot express the addition reduction. `pattern`
and `threshold` are input ports (runtime-variable). The terminal test `idx == (Length-1)` is
width-matched with `.resize(IdxWidth)` to stay warning-free. The output is named `score` because
`matches` is a SystemVerilog keyword. Verified a full match gives score=8/detect=1, all-zero input
matches only the pattern's four zero-bits (detect=0), and `done` is a single-cycle pulse.

### util

| Part | Function | Parameters |
|---|---|---|
| `BitReverse` | reverse bit order (`dout[i]=din[Width-1-i]`) | `Width` (default 8, >= 1) |
| `EndianSwap` | reverse byte order (endianness) | `Bytes` (default 4, >= 1), `Width` (derived `Bytes*8`) |
| `ByteEnableExpand` | byte-enable to bit mask (1 bit -> 8 bits) | `Bytes` (default 4, >= 1), `Width` (derived `Bytes*8`) |

Combinational vocabulary conversions, each filling one element per `for`
iteration: `BitReverse` uses per-bit assignment (`dout[i]=...` accumulates bit by
bit), `EndianSwap` a byte-granular part-select read/write, `ByteEnableExpand` a
part-select write with an `if be[i] { 8'hFF } else { 8'h00 }` value. `EndianSwap`'s
`(Bytes-1-i)*8` — where parentheses override precedence — round-trips through
iris2sv with the grouping preserved (iris2sv now parenthesizes by precedence;
previously it emitted `Bytes-1-i*8`, silently changing the meaning).

| Part | Function | Parameters |
|---|---|---|
| `RangeMask` | range (boxcar) mask — bits in `[lo, hi)` set | `Width` (default 8, >= 1), `IdxWidth` (derived `$clog2(Width)+1`) |

`RangeMask` sets bits from `lo` up to (not including) `hi` (`mask[i] = lo<=i<hi`),
filling one bit per `for` iteration by comparing the loop constant `i` with `lo`/`hi`.
Use it for field extraction, windowing, or ranged byte-enables; `hi<=lo` gives an
empty mask. Combinational only.

| Part | Function | Parameters |
|---|---|---|
| `SignMag` | sign-magnitude ↔ two's-complement (`Sm2Tc` / `Tc2Sm`) | `Width` (default 8, >= 2) |

`SignMag` is the `Sm2Tc` (sign-magnitude → two's complement) and `Tc2Sm` (the inverse) pair.
Sign-magnitude keeps the sign in the MSB and the magnitude in the low `Width-1` bits — for some
audio formats, sign-magnitude ALUs, or floating-point mantissa handling. `Sm2Tc` negates the
magnitude **after widening it to `Width`** (`0 - mag`; negating in the narrow width is wrong, so
`.resize(Width)`). `Tc2Sm` places the low bits of `0 - tc` and sets the sign bit (part-writes,
no `comb` re-read). Verified 0x81(-1)⇔0xFF, 0xFF(-127)⇔0x81, and ±5/±127/-0. The two's-complement
minimum 0x80 (-2^(Width-1)) has no sign-magnitude form and folds to magnitude 0 (documented). The
two-module MULTITOP note matches the established `Secded`/`DiffPair` pattern.

## Implementation notes

**IRIS does not allow `var` in `comb`** — `var` is for `sync`/`fsm` only. And a
*whole-signal* re-assignment is last-write-wins, not a running accumulation
(each assignment reads the block-entry value). So **a sum-fold (popcount, a
parallel-CRC XOR tree) is not expressible** combinationally (future work).

**An XOR fold, however, is expressible.** `.xor_reduce()` (and `.and_reduce()` /
`.or_reduce()`) gives the XOR of all bits, and a **per-bit assignment
(`out[i] = ...`) accumulates bit by bit** (unlike a whole-signal reassignment, a
`for` loop can fill every bit one at a time). Together these express `Parity`
(`d.xor_reduce()`) and `Gray2Bin` (`bin[i] = (gray >> i).xor_reduce()`); SECDED
parity (an XOR of a subset of bits) follows the same recipe. iris2sv converts
`.xor_reduce()` / `.and_reduce()` / `.or_reduce()` to the SV reduction operators
`(^d)` / `(&d)` / `(|d)`. A CRC works if made bit-serial (accumulation over time).

**An array-typed signal/port (`bit[W][N]`) is rejected with a clear error
(`O1009`).** An array signal flattens to bits, so `d[i]` would read a bit, not the
i-th element (silently wrong), so the checker stops it (literal `bit[8][4]` too);
`mem` still takes `bit[W][Depth]` (a memory carries its own element width). A
mux/demux that bundles N streams is written over a **packed vector** `bit[Width*N]`
with a part-select `data[i*Width +: Width]` — see `VecMux`/`VecDemux`. Widen the
index before the multiply (`sel.resize(IdxWidth) * Width`) so it does not wrap.
This covers the common cases; true `bit[W][N]` unpacked-array ports (lowered as
sugar `d[i]` → `d[i*W +: W]`) remain future work.

**`iris2sv` now supports `for` loops.** A `for` with constant bounds becomes a
synthesisable SystemVerilog `for` (inside `always_comb`/`always_ff`), so the
`for`-based parts above convert to SystemVerilog too.

**Functions (`fn`) work at a fixed width, but generic functions do not parse.**
`fn f(a: bit[8]) -> bit[8] { ... }` works and becomes an SV `function`, but
`fn f[Width](a: bit[Width])` does not. Width and parameter math uses built-ins
(`$clog2`, ...). So a reusable generic math-function library is limited for now
and is not included yet.

**`iris2sv` does not yet support a block-local `let`.** A `let x = expr;` inside
`sync`/`comb` does not convert (it needs width inference). For now, inline the
expression instead (`SpillRegister` inlines its fire conditions). Future iris2sv
work.

**Multiplication `*` truncates to the operand width.** `bit[8] * bit[8]` yields 8
bits, not 16 (`200*200` becomes the low 8 bits, 64, not 40000). For a full-width
product, zero-extend the operands first. An `as` cast in expression position does
not parse inside `comb`/`sync` (`let x: bit[16] = a as bit[16];` parses, but
iris2sv does not support a block-local `let`). So `FirSerial` holds coefficients
and samples zero-extended in `AccWidth`-wide mems (assignment zero-extends) and
multiplies the wide values, avoiding the truncation. A parallel convolution (the
sum) is not expressible in `comb`, so `FirSerial` serializes it and accumulates
one tap per cycle in `sync`.

**Some SV raises verilator width warnings, but the values are correct** (a
warning, not an error). `Lzc` warns on the all-zero default (`count = Width`;
`Width` is a 32-bit parameter in SV but the value fits the output width).
`ArbiterFixed`/`ArbiterRr` warn because the untyped `1` in `~x + 1` widens to 32
bits in SV (the `&` masks it back, so behavior is correct). `ClkDivider`/`UartTx`/`UartRx`/`SpiMaster`/`I2cMaster` warn on
`count == Div - 1` and similar because the parameter is 32-bit (the compare is
correct). These stem from IRIS untyped literals and parameters becoming 32-bit
in SV.

## Tier 3 (heavy IP) policy

The heavy layer (DMA, crypto, DSP, peripheral IF, on-chip bus) is not all
written in IRIS.

**Buildable in IRIS (added when needed)**: `uart`/`spi`/`i2c` (FSM + shift
register), serial `fir`/`mac` (accumulate in `sync`), a simple `cache`
(mem + tags + FSM).

**Reuse OSS (do not re-implement proven IP).** Reuse targets by area, below.
Do not write these in IRIS; instantiate them from the converted SystemVerilog.

| Area | Reuse target (OSS) | License | Integration note |
|---|---|---|---|
| AXI set (xbar/dma/cdc/cut) | [pulp-platform/axi](https://github.com/pulp-platform/axi) | Solderpad 0.51 | A packed-vector mux (`VecMux`) covers the datapath, but the full multi-master protocol and arbitration is large and proof-sensitive; wire it in SV |
| Common cells (deep FIFO, N-stage sync, ...) | [pulp-platform/common_cells](https://github.com/pulp-platform/common_cells) | Solderpad 0.51 | Variants this lib lacks (e.g. parameterizable sync depth, `fifo_v3`) |
| Crypto (AES, SHA-2, PRNG) | [OpenTitan](https://github.com/lowRISC/opentitan) `hw/ip/*`, `prim_*` | Apache 2.0 | Correctness and SCA hardening; a round function's XOR net also hits the comb fold limit |
| Floating-point units | [berkeley-hardfloat](https://github.com/ucb-bar/berkeley-hardfloat) / [pulp-platform/fpnew](https://github.com/pulp-platform/cvfpu) | BSD / Solderpad | IRIS `f32`/`f64` are for simulation; synthesizable units come from here |
| Peripheral IF (Ethernet, PCIe, UART DMA, ...) | [alexforencich/verilog-*](https://github.com/alexforencich) | MIT | This lib's `uart`/`spi`/`i2c` are lightweight; full versions here |
| Large DSP (FFT, ...) | vendor / OSS | varies | Large and proof-sensitive |

The criterion is IRIS's `comb` sum-fold limit (no popcount/parallel-CRC XOR tree):
anything that can be made serial, written as an FSM, or expressed over a packed
vector goes in IRIS; anything heavy, proof-sensitive, or hitting that limit comes
from OSS.

## What is not expressed in IRIS

Technology-dependent cells (`clk_gate`, `tc_sram`, level shifters, ...) bind to a
PDK implementation and are not expressed as synthesisable IRIS logic.
SystemVerilog register macros (`FF` and the like) get no counterpart; `sync` and
`var` are enough. When these are needed, use a PDK implementation or a real
library (section B of `instructions.md`).
