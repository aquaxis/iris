# IRIS standard library

Reusable RTL logic modules written in IRIS. Take a FIFO, a counter or an
arbiter as a part instead of writing it again each time.

## Overview

56 parts in 10 categories. Every part passes three checks: an `iris-sim`
testbench, `iris sv` (SystemVerilog conversion), and `iris lint` (naming). And
`tools/conformance/run.sh` stays at 470/0 (52 library parts registered as fixtures).

| Category | Count | Parts |
|---|---|---|
| `timing/` | 9 | `Counter`, `EdgeDetect`, `GrayCounter`, `Lfsr`, `ClkDivider`, `Pwm`, `Debounce`, `Timer`, `OneShot` |
| `arith/` | 12 | `PriorityEncoder`, `Lzc`, `Bin2Gray`, `Decoder`, `Rotator`, `Gray2Bin`, `MinMax`, `DivSerial`, `MulSerial`, `SatAdd`, `SatSub`, `OneHotCheck` |
| `mem/` | 6 | `FifoSync`, `FifoAsync`, `RamSp`, `RamDp`, `Ram2r1w`, `ShiftRegister` |
| `arbiter/` | 2 | `ArbiterFixed`, `ArbiterRr` |
| `stream/` | 9 | `SpillRegister`, `Serializer`, `Deserializer`, `VecMux`, `VecDemux`, `StreamDownsizer`, `StreamUpsizer`, `StreamFork`, `StreamJoin` |
| `cdc/` | 3 | `Sync2ff`, `RstSync`, `PulseSync` |
| `coding/` | 5 | `Crc`, `Parity`, `Secded`, `TmrVoter`, `Checksum` |
| `periph/` | 4 | `UartTx`, `UartRx`, `SpiMaster`, `I2cMaster` |
| `dsp/` | 3 | `FirSerial`, `MacSerial`, `MovingAverage` |
| `util/` | 3 | `BitReverse`, `EndianSwap`, `ByteEnableExpand` |
| Total | 56 | |

**The line between what is and is not expressible is the point of this list.**
Single-clock logic (counters, FIFOs, arbiters), FSM + shift (peripheral
interfaces), and accumulation unrolled over time (CRC, LFSR, serial DSP) are
written directly in IRIS. A multi-stream mux/demux is also expressible, using a
**packed vector** (`bit[Width*N]`) with a part-select (`data[i*Width +: Width]`);
`VecMux` and `VecDemux` are the examples, widening `sel` before the multiply so the
index does not overflow. A combinational sum-fold (popcount, a parallel-CRC XOR
tree), the `bit[W][N]` array-port syntax itself, and generic functions (a general
math library) are not expressible today. (An XOR fold is expressible with
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
| `OneHotCheck` | exactly-one-bit detector | `Width` (default 8, >= 1) |

`OneHotCheck` clears the lowest set bit with `din & (din - 1)`; if the result is 0
and `din` is non-zero, `is_onehot` is 1 (no fold/popcount needed). `is_zero` is 1
when all bits are 0. Combinational only.

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

### stream

| Part | Function | Parameters |
|---|---|---|
| `SpillRegister` | ready/valid depth-2 buffer (skid buffer) | `Width` (default 8, >= 1) |

`SpillRegister` breaks the upstream/downstream path, loses no data under
backpressure, and passes one word per cycle when not stalled. `in_ready` depends
only on the skid slot being free (not combinationally on `out_ready`).

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

**The `bit[W][N]` array-port syntax is not expressible, but a packed vector
replaces it.** `in d: bit[Width][N]` or `var a: bit[W][N]` is rejected
("expected integer"); only `mem` allows a generic dimension. A mux/demux that
bundles N streams is instead written over a **packed vector** `bit[Width*N]` with
a part-select `data[i*Width +: Width]` — see `VecMux`/`VecDemux`. Widen the index
before the multiply (`sel.resize(IdxWidth) * Width`) so it does not wrap. This
covers the common cases; true `bit[W][N]` unpacked-array ports remain future work.

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
