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

`ClkDivider` emits a clock-enable tick rather than gating a clock — the
synthesis-friendly pattern.

`Counter` leaves wrap to natural width overflow, and saturation holds the value
at the maximum (all ones) and the minimum (0). The maximum is detected with
`count + 1 == 0` (all ones plus one wraps to 0 in `Width` bits).

`EdgeDetect` registers the previous value and emits `rise = d & ~prev`,
`fall = ~d & prev`.

### arith

| Part | Function | Parameters |
|---|---|---|
| `PriorityEncoder` | index of the lowest set bit, with a valid flag | `Width` (default 8, >= 2), `IdxWidth` (default `$clog2(Width)`) |
| `Lzc` | leading zero count (zeros from the MSB to the first 1) | `Width` (default 8, >= 1), `CountWidth` (default `$clog2(Width)+1`) |
| `Bin2Gray` | binary to gray code (`bin ^ (bin >> 1)`) | `Width` (default 8, >= 1) |

Both are combinational and use a `for` loop with combinational last-write-wins.
`PriorityEncoder` scans from the high index down so the lowest set bit remains.
`Lzc` scans from the low index up so the highest set bit remains, and reports
`Width - 1 - i` as the leading-zero count.

### mem

| Part | Function | Parameters |
|---|---|---|
| `FifoSync` | single-clock synchronous FIFO (first-in first-out) | `Width` (default 8), `Depth` (default 4, power of two), `AddrWidth`/`PtrWidth` (derived from Depth) |
| `FifoAsync` | two-clock-domain asynchronous FIFO (gray-code pointer sync) | `DataWidth` (default 8), `Depth` (default 16, power of two >= 4), `AddrWidth`/`PtrWidth` (derived) |

`FifoSync` uses a `mem` and pointers with a wrap bit. `empty` is pointer
equality; `full` is a differing wrap bit with equal low address bits.

`FifoAsync` synchronizes gray-code pointers through two flops so metastability
does not propagate (the `example/async_fifo` design as a part). **Its resets are
active-low (`wr_rst_n`/`rd_rst_n`)**, unlike the library default (active-high) —
a deliberate exception matching the usual async-FIFO convention. The max-delay
SDC constraints cannot be emitted from IRIS and are the user's responsibility.

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

`Crc` takes one bit per cycle MSB-first and updates with `poly` (an LFSR with a
data input); `clear` starts a new stream. A parallel CRC (a byte per cycle)
needs an XOR fold and is not expressible in today's `comb`.

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

`FirSerial` computes `y[n] = Σ coeff[k]*x[n-k]` with a single multiplier used
across `Taps` cycles. Coefficients are loaded through a write port; samples enter
one at a time on `in_valid` and results leave on `out_valid`. **A convolution
(a sum) cannot be written in `comb`, but making it serial and unrolling over time
lets `sync` accumulate it one tap per cycle** — the concrete case of the Tier-3
policy "if it can be serialized, write it in IRIS". Multiplication truncates to
the operand width, so coefficients and samples are held zero-extended in
`AccWidth`-wide mems, and the wide product is not truncated. Values are unsigned
(a signed FIR needs int types; a future item).

## Implementation notes

**IRIS does not allow `var` in `comb`** — `var` is for `sync`/`fsm` only. And a
combinational signal re-assignment is last-write-wins, not a running accumulation
(each assignment reads the block-entry value). So **selection (pick the first or
last set bit) is expressible, but a sum (popcount) is not** combinationally.
A part that needs accumulation or a fold — such as `popcount` (sum) or
`gray2bin` (an XOR fold from the MSB) — cannot be expressed in today's IRIS
`comb` (future work). `bin2gray` is a single XOR, so it is fine; the reverse
`gray2bin` needs the fold and is held. For the same reason **parity generation
and SECDED parity (an XOR of a subset of bits = a fold) are not expressible in
`comb`**. A CRC works if made bit-serial (the accumulation is spread over time).

**Array-typed ports and `var`s with a non-constant dimension are not
expressible.** `in d: bit[Width][N]` or `var a: bit[W][N]` is rejected
("expected integer"); only `mem` allows a generic dimension. So a mux/demux that
bundles N streams is not expressible with a generic array port (it needs
per-stream ports or an interface — future work).

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

- **Buildable in IRIS (added when needed)**: `uart`/`spi`/`i2c` (FSM + shift
  register), serial/systolic `fir` (accumulate in `sync`), a simple `cache`
  (mem + tags + FSM).
- **Reuse OSS**: the AXI set (pulp-platform/axi), crypto (OpenTitan prim_*),
  floating-point units (hardfloat/FPnew), large DSP. Do not re-implement proven
  IP.

The criteria are IRIS's `comb` limits (no XOR fold/accumulation) and no generic
array ports: anything that can be made serial or written as an FSM goes in IRIS;
anything heavy, proof-sensitive, or hitting those limits comes from OSS.

## What is not expressed in IRIS

Technology-dependent cells (`clk_gate`, `tc_sram`, level shifters, ...) bind to a
PDK implementation and are not expressed as synthesisable IRIS logic.
SystemVerilog register macros (`FF` and the like) get no counterpart; `sync` and
`var` are enough. When these are needed, use a PDK implementation or a real
library (section B of `instructions.md`).
