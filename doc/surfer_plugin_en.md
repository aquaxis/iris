# Waveforms in Surfer

## What this covers

Reading an IRIS simulation's waveform in [Surfer](https://surfer-project.org/),
**with multi-dimensional arrays expanded element by element**.

```bash
iris-sim -i design.iris -o out.vcd --dump-arrays
surfer out.vcd
```

![A waveform open in Surfer: the scope tree on the left, pc and four memory
words on the right](images/surfer_memory_array.png)

`64` to `67` above are words 64 to 67 of `mem dmem`. Each changes to a
different value at a different time.

## The work was not on the viewer side

**Surfer already had everything that was needed.**

| What was wanted | What Surfer has |
|---|---|
| Read a waveform | VCD, FST, GHW |
| See an array | An array is a scope, its elements are variables |
| Expand it | Open the scope and the elements are listed |
| Extend it | Extism translator plugins |

**What was missing was on the side that writes the waveform.**

Before this work:

```
$ grep -nF 'dmem' example/riscv/sim/output_mem.vcd
100:$var wire 32 z core.dmem_rdata [31:0] $end
```

Of `mem dmem: bit[32][1024]`, only the read port's value reached the waveform.
**Not one word of the array was in the file.**

Nothing in the viewer can expand what the file does not contain.

## Three things were fixed

```
Stage 0  Identifier collisions   VCD codes wrapped after 94 signals
Stage 1  Hierarchy               There was only ever one $scope
Stage 2  Arrays                  mem was never written per element
```

### Stage 0: codes wrapped after 94 signals

Past 94 signals the 95th received the same code as the first, with no warning.

```
$ grep -cF '$var' idov.vcd
102
$ grep -F '$var' idov.vcd | awk '{print $4}' | LC_ALL=C sort -u | wc -l
94
$ grep -F '$var' idov.vcd | awk '$4=="!"{print $5}'
clk s92
```

94 is exactly the number of codes from `'!'` to `'~'`. The existing designs sat
at 91 signals: **three short of the ceiling.**

A VCD identifier may be a string, so codes are now allocated in base 94.
**The first 94 are the same single characters as before, so waveforms that
never reached the ceiling are unchanged.**

Dumping arrays produces 1147 signals, twelve times the old ceiling, so this had
to be fixed first.

### Stage 1: hierarchy became nested scopes

The hierarchy was already in the names.

```
$var wire 5 7 dut.wr_ptr [4:0] $end
```

Splitting on the dots and building a tree was enough; the recording side did
not change.

```
$scope module TestMem $end
$scope module rom $end
$upscope $end
$scope module core $end
$scope module dec $end
$upscope $end
$scope module rf $end
$upscope $end
$scope module alu $end
$upscope $end
$upscope $end
$upscope $end
```

**That is the structure of the design itself.**

### Stage 2: arrays became scopes

With `--dump-arrays`, one element becomes one variable.

```
$scope module dmem $end
$var wire 32 | 0 [31:0] $end
$var wire 32 } 1 [31:0] $end
$var wire 32 ~ 2 [31:0] $end
   ...
$upscope $end
```

It is off by default: `dmem` has 1024 words, and dumping them every time would
grow the waveform more than tenfold.

| | `$var` count | Size |
|---|---|---|
| Default | 91 | As before |
| `--dump-arrays` | 1147 | 200,130 bytes |

### Element names cannot use brackets

**The design called for naming elements `[0]`.** Measured, a name containing
brackets is not loaded at all.

| Element name | Variables `scope_add` loaded |
|---|---|
| `[2]` | **0** |
| `dmem[2]` | **0** |
| `2` | **4** |

The reader treats brackets as an index annotation rather than part of the name,
so elements are named `0`, `1`, `2`.

## Using it

```
$ iris-sim -i test_mem.iris riscv_core.iris ... -o dump.vcd -c 200 --dump-arrays
$ surfer dump.vcd
```

Inside Surfer, or by command:

```
scope_add TestMem.core.dmem            list the whole memory (1024 variables)
variable_add TestMem.core.dmem.3       just word 3
```

A subscript that does not exist is reported as missing.

```
variable_add TestMem.core.dmem.9999    => Failed to find variable
```

![The full Surfer window: scope tree on the left, core signals in the middle,
memory elements below](images/surfer_full.png)

## Signed values

An IRIS `int[N]` is two's complement. VCD has no field for a source-language
type name.

**So the distinction is carried in vocabulary VCD does have.** `iris-sim`
writes a signed signal as `$var integer`.

```
$var integer 32 ; s_rs1 [31:0] $end
$var wire    32 z dmem_rdata [31:0] $end
```

Surfer then treats it as signed and negative values display as negative.

**That one change is enough on its own.** Surfer has a built-in `Signed`
translator that handles `$var integer`.

## The translator plugin

`tools/surfer-plugin/` holds an Extism plugin.

```
$ cargo build --release --target wasm32-unknown-unknown --ignore-rust-version
$ cp target/wasm32-unknown-unknown/release/iris_surfer_translator.wasm \
     ~/.local/share/surfer/translators/
```

Surfer loads it at startup.

```
INFO libsurfer::translation::wasm_translator: Found .../iris_surfer_translator.wasm
INFO libsurfer: Translator IRIS loaded
```

The `IRIS` in `Translator IRIS loaded` is the string this plugin's `name()`
returned; Surfer's own source reads `info!("Translator {} loaded", t.name())`.
A corrupt `.wasm` produces `Failed to load plugin from` instead.

### How it works

**Extism, not WIT and not the component model.**

| Item | Value |
|---|---|
| Mechanism | Extism 1.21.0 |
| Types | `surfer-translation-types` v0.7.0, a git dependency pinned to the tag |
| Required functions | `name` / `translates` / `variable_info` / `translate` |

`surfer-translation-types` is part of Surfer and is EUPL-1.2. **It is
referenced as a dependency, not copied into this repository.** Surfer itself is
not bundled either.

### What the plugin does today

**Stated plainly.**

The plugin is loaded and Surfer calls it. This warning is the evidence:

```
WARN libsurfer::wave_data: More than one preferred translator for
     variable s_rs1 in scope TestMem.core: IRIS, Signed
```

Surfer can only emit that after calling the plugin's `translates` and receiving
its answer.

**The values on screen, however, come from Surfer's built-in `Signed`.** The
built-in also claims `$var integer`, and it is the one that wins.

To tell them apart, a build that marked its own output was tried. The mark did
not appear on screen.

**So the position is this.**

| | State |
|---|---|
| The plugin loads | **Confirmed** |
| Surfer calls the plugin | **Confirmed** |
| The plugin's output reaches the screen | **Not confirmed** |
| Signed values display correctly | **Confirmed, by the built-in `Signed`** |

The only type information a VCD can carry is the difference between `wire` and
`integer`, and the built-ins already cover what that distinction supports.

**The plugin's value arrives when IRIS can pass information a VCD cannot
carry.** For now, nothing more is claimed than that the socket is wired up.

## Environment checked against

| Tool | Version |
|---|---|
| `surfer` | 0.7.0 |
| `extism-pdk` | 1.4 |
| `surfer-translation-types` | v0.7.0 |
| `cargo` / `rustc` | 1.91.1 |

`--ignore-rust-version` is required: `ecolor`, which Surfer's type definitions
depend on, asks for rustc 1.92. Building and running on 1.91.1 has been
checked.
