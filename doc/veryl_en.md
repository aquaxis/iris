# Interworking with Veryl

## What this covers

[Veryl](https://veryl-lang.org/) and IRIS both drop SystemVerilog's syntax
while keeping its ecosystem. This document covers whether source can be
converted between the two.

What can and cannot be converted was established by comparing the two grammars
and by rewriting real designs by hand. A converter over that range is partly
built.

The working record is in `report_veryl.md`.

## Where the converter stands

**`tools/veryl2iris/` holds a partial one.**

| Direction | State |
|---|---|
| IRIS → Veryl (`iris2veryl`) | Working, over part of the common subset |
| Veryl → IRIS (`veryl2iris`) | Working, over part of the common subset |

**The round trip closes.**

```
$ veryl2iris example/comparison/veryl/counter.veryl > c1.iris
$ iris2veryl c1.iris > c2.veryl
$ veryl2iris c2.veryl > c3.iris
$ iris-sim -i c1.iris tb.iris ...   resumed=21
$ iris-sim -i c3.iris tb.iris ...   resumed=21
```

**The two agree in simulation (T-L3).** They do not agree character for
character: parenthesisation changes. A check that failed on formatting would
not be checking meaning, so the comparison is by value.

**The ALU round-trips too.**

```
$ veryl2iris alu.veryl > a1.iris ; iris2veryl a1.iris > a2.veryl ; veryl2iris a2.veryl > a3.iris
a1.iris  alu fails=0
a3.iris  alu fails=0
```

Checked where sign matters: SLT against SLTU and SRA against SRL, which
`alu.veryl`'s own comment notes still run when swapped.

**The register file round-trips too.** An IRIS `mem` becomes a Veryl array.

```
IRIS    mem regs: bit[32][32];
Veryl   var regs: logic<32> [32];
```

**The decoder round-trips as well, once the sign extension was measured.**

`sign_extend` had been written down as something Veryl has no counterpart
for. **Measuring it said otherwise.**

| | What it emits |
|---|---|
| IRIS `x.sign_extend[32]()` | `32'($signed(x))` |
| Veryl `x as i32` | `int'(x)` |

`int'(x)` zero-extends an unsigned operand. While `x` is unsigned the cast is
not a sign extension at all. **The cast is not the counterpart.**

Both languages do have a repeated sign bit, though.

```
IRIS    {20{instr[31]}}, ...
Veryl   {instr[31] repeat 20, ...}
```

Only the notation differs. Writing `x.sign_extend[N]()` out this way leans on
neither language's rules about when a value counts as signed.

**This was a gap in the tool, not between the languages.** A note that had
never been checked stood in place of a measurement, and it was wrong.

All four immediate forms -- I, S, B and J -- are checked.

**The async FIFO round-trips too, carrying its generic parameters.**

```
IRIS    mod AsyncFifo[DataWidth: uint = 8, Depth: uint = 16,
                      AddrWidth: uint = $clog2(Depth), ...]
Veryl   module AsyncFifo #(param DataWidth: logic<32> = 8, ...)
```

Widths and the memory depth travel as the parameter expressions they are.
`$clog2` exists in both languages.

**The `where` clause is the one part that cannot travel.** Veryl bounds a
parameter with a `proto`, which constrains its shape and not its value, so
`where DataWidth >= 1` has no counterpart.

**It is reported, not dropped.** A module that quietly loses its own bounds
accepts an argument its author ruled out and then fails somewhere else
entirely.

**The processor round-trips too, which makes it all six designs.**

Four modules across four files, and `riscv_core` reads an instance's outputs
straight out of the instance.

```
IRIS    alu_b = if dec.alu_b_imm { dec.imm } else { rf.rdata2 };
```

**Veryl has no such expression.** An output is wired to a variable at the
instantiation and the variable is read.

```
Veryl   var dec_imm: logic<32>;
        inst dec: Decoder (instr: imem_rdata, imm: dec_imm, ...);
        alu_b = if dec_alu_b_imm ? dec_imm : rf_rdata2;
```

**That is why several files are now read as one project.** What `dec.rd` is
comes from `decoder.iris`, and `riscv_core.iris` alone cannot say.

The variable is named `<instance>_<port>`, lengthened if the module already
declares that name. **Reusing a declared name would connect the instance to
whatever that name already meant**, which simulates and is wrong.

Across the four RV32I test programs, the original and the round trip produce
byte-identical output.

**There are controls.**

| Check | Mutation | Result |
|---|---|---|
| counter round trip | increment becomes 2 | `resumed=21` → `42` |
| ALU round trip | SLT becomes unsigned | `fails=0` → `1` |
| regfile round trip | the written value becomes `wdata+1` | `fails=0` → `1` |
| decoder round trip | the repeated sign bit becomes zero | all four immediate forms change |
| async fifo round trip | `DataWidth` is narrowed to 4 | the verification fails |
| processor round trip | `rdata1`'s wire is crossed onto `rdata2` | the output changes |

**The async FIFO control shows directly that the parameter survived the round
trip**: narrowing it breaks the design, which means the value is doing work.

**The decoder control is exactly the failure the cast would have caused.**
Turning `{20{instr[31]}}` into `{20{1'b0}}` makes it a zero extension, and
`i_neg` goes from `ffffffff` to `fff`. Taking `x as i32` as the counterpart
would have produced that.

**The decoder round trip is compared against the original decoder**, not
against values written out by hand, because a mistake in retyping the
instruction encodings would quietly stop the check from checking anything.
Two runs that both failed to sign-extend would agree with each other, so the
original is first confirmed to produce `ffffffff`.

**The regfile control had to be chosen again.** Removing the guard on writes
to x0 changed nothing: the design also forces x0 to zero on the read side, so
the mutation is invisible. **A control aimed where nothing can observe it is
not a control.**

All are in `tools/conformance/run.sh`, which went from 130 checks to 151, no
failures.

**The checks were themselves checked.** Deliberately breaking the converter so
it drops a `case` default makes `alu round trip` fail.

**The designs that round-trip today.**

| Design | State |
|---|---|
| `counter` | Round-trips |
| `alu` | Round-trips |
| `regfile` | Round-trips |
| `decoder` | Round-trips |
| `async_fifo` | Round-trips |
| `riscv_core` | Round-trips |

**All six designs round-trip.**

### Every row of the table, one at a time

**Six designs passing is not the same as covering the syntax.** So each of the
30 rows marked `Exact` got a small fragment of its own, and each fragment was
round-tripped.

| | Count |
|---|---|
| `Exact` rows | 30 |
| with a round trip | **29** |
| no fragment to write | 1 |

**The one remaining row is unimplemented in `iris-sim`, not in this converter.**

| Row | Why |
|---|---|
| `string` | `iris-sim` has no string-valued constant to round trip through |

`import` round trips.
`import Pkg::Item;` and `import Pkg::{A, B};` carry across both ways.
Only `::*` does not, since `iris-sim` does not keep it apart from a bare
import, so the fragment uses just those two forms.

`function` round trips too.
A pure function (bindings then a single `return`) carries across both ways.
IRIS parameters carry no direction, so they are written as `input` in Veryl.
`iris-sim` does not keep a `let`'s type inside a function, so only the type
annotation is lost on the round trip.

`interface` and `modport` round trip as well.
A Veryl `var` signal becomes an IRIS signal and a `modport` becomes an IRIS
`view`. A modport lists a direction per signal and a view groups them, so the
signals regroup by direction on the round trip. A modport `..` default has no
IRIS counterpart and is refused.

`type` round trips now too. `iris-sim` implements the type alias: it parses one
and resolves it to the type it names.

```
$ iris-sim -i alias.iris -c 2
Simulation completed successfully.
```

IRIS writes `type` at file level and Veryl inside the module. It is hoisted the
same way `enum` and `struct` are: lifted out going Veryl to IRIS, written into
the module going IRIS to Veryl.

**`tools/veryl2iris/mapping`'s own tests hold that count.** Add a row without
a fragment or a stated reason and they fail; delete a fragment and they fail.
**A machine, not a memory, keeps the rows and the tests in step.**

### The comparison starts at the second pass

The first pass normalises.

```
pass 1  y = b < c        ->  y = (b < c)
pass 2  y = (b < c)      ->  y = (b < c)
```

A check that failed on parenthesisation would be checking formatting, not
meaning. **What has to hold is that it reaches a point where it stops
moving.** Passes two and three are compared.

Refusals come in two kinds, and they are reported differently.

| Kind | Example | What the reader does |
|---|---|---|
| The language has no counterpart | `fsm`, `f32`, `tri` | Rewrite the design, or give up on it |
| This converter has not caught up | `as` casts, multi-value case arms | Wait for the tool |

**The two are never conflated.** One is a fact about the design, the other a
fact about the tool, and they call for different actions.

### Expressions whose shape differs cannot be carried

Veryl-to-IRIS expressions are carried as a token sequence and re-spelled,
rather than printed node by node. **Writing a printer per node means every
node the implementation forgets is a sub-expression that disappears without a
word.**

That only works where both languages build the expression the same way.

```
Veryl   case x { 1: a, default: b }
IRIS    match x { 1 => a, _ => b }
```

Same meaning, different shape. Carrying the tokens produces something that is
not IRIS at all.

**This was found by converting `alu.veryl`.** Its `case` expression came out
verbatim and the IRIS parser rejected it, while the converter had reported
success.

**`case` and `if` expressions are now rebuilt in IRIS' shape.**

```
Veryl   y = case op { 4'd0: a + b, default: 32'd0, };
IRIS    y = match op { 4'd0 => a + b, _ => 32'd0, };

Veryl   if sa <: sb ? 32'd1 : 32'd0
IRIS    if sa < sb { 32'd1 } else { 32'd0 }
```

**The same mistake was made again, with `repeat`.**

Just after sign extension started reaching Veryl, the other direction gave
this:

```
$ veryl2iris rep.veryl
    o_y = {i_v [11] repeat 20, i_v};    <- not IRIS
$ echo $?
0                                        <- reported as a success
```

`repeat` was missing from the list of shapes that differ. **A construct left
off that list passes through in silence.**

It is the same kind of failure as the `case` one and was found the same way:
by putting the output through the other language's parser.

```
Veryl   {a repeat n, b}
IRIS    {{n{a}}, b}
```

**A third time, with `as`.**

```
$ veryl2iris cast.veryl
    y = a as 32;    <- not IRIS
$ echo $?
0
```

### `as` had nothing to be converted into

The reason for refusing it was measured. **IRIS' own `as` is not
implemented.**

The specification and the grammar both carry it.

```
spec/03_type_system.md:514   | `as T` | type cast | `x as bit[16]` |
tools/iris.ebnf:154          cast_expr = expr "as" type_expr ;
```

`iris-sim` does not accept it.

```
$ iris-sim -i as.iris
comb { y = a as bit[32]; }
Parse error: Syntax error at line 5, column 18: expected postfix or bin_op
```

**Every method form does parse.**

| | Result |
|---|---|
| `.extend[32]()`, `.truncate[4]()` | parses |
| `.saturate[4]()`, `.signed()`, `.unsigned()` | parses |
| `x as bit[32]` | **syntax error** |

So `as` is written down and not built. **With nothing to convert into,
refusing is the right answer.**

This is a gap between the specification and the implementation, not between
IRIS and Veryl. `tools/conformance/run.sh` now checks both halves at once:
that the converter refuses it, and that `iris-sim` rejects the IRIS cast it
would have to produce. If `iris-sim` ever accepts it, the check fails and says
the refusal can be lifted.

### `else if` cannot be chained in an expression

`riscv_core`'s write-back picks one of five values.

```
Veryl   if a ? x : if b ? y : if c ? z : w
```

Copied out flat, that does not parse as IRIS.

```
IRIS    if_expr = "if" expr "{" expr "}" "else" "{" expr "}"
```

After `else` comes `{ expr }` and nothing else; there is no `else if` form.
**Statements have one; expressions do not.** So it nests.

```
IRIS    if a { x } else { if b { y } else { if c { z } else { w } } }
```

No design with a single condition showed this. **`riscv_core` was the first.**

### A definition written on a declaration was being dropped

**The second of its kind, after the width.**

It surfaced while working through the table row by row, on `let` and `const`.

```
IRIS                          what was emitted
const K: bit[8] = 8'd3;   ->  var K: logic<8>;      the 3 is gone
let w: bit[8] = a;        ->  var w: logic<8>;      w = a is gone
var acc: bit[8] = 8'd7;   ->  var acc: logic<8>;    it starts at zero
```

**Each is valid Veryl, elaborates, simulates, and computes something else.**

The reasoning had been written down:

> IRIS writes an initial value on the declaration; Veryl has no such form,
> and the reset branch of an always_ff is where the value belongs

**True of a register whose design writes its own reset. False of everything
else.** For `const` and `let` the initialiser is the definition, not a reset
value. And a `var`'s initialiser is doing work in any design that does not
write a reset branch:

```
$ iris-sim -i initv.iris        # the sync block has no reset branch
before=7    <- the declaration's value is in effect
after=9
```

Now `let` and `const` carry their definitions, a `var`'s starting value
becomes a Veryl `initial` block, and coming back the `initial` block folds
onto the declarations. **That folding is the exact inverse.**

**`let` and `const` cannot be told apart.** `iris-sim`'s parser records both
as immutable-with-an-initialiser and keeps no note of which word was written.
`let` is right for both and `const` would be wrong for `let w = a`, so `let`
is what gets written.

### "No width" and "a width I could not read" were the same answer

**This is the worst defect found in this tool so far.**

It surfaced as soon as generic parameters were handled.

```
$ veryl2iris w.veryl
mod W(
    in a: bit,        <- logic<Width> has become one bit
    out y: bit,
)
$ echo $?
0                      <- reported as a success
```

**The output is valid IRIS and simulates.** No parser catches it. Only a value
does.

```
what eight bits give: 200 + 1 = 201
what came out:        200 + 1 = 1
```

The cause was the function that read a type's width.

```rust
fn width_of(spelled: &str) -> Option<usize> {
    ...
    spelled.get(start + 1..end)?.parse().ok()   // "Width" gives None
}
```

The caller read `None` as "no width was written" and produced `bit`. **`logic`
and `logic<Width>` were arriving at the same answer.**

It now has three cases.

| | Meaning | IRIS |
|---|---|---|
| `None` | there is no `<...>` | `bit` |
| `Literal(8)` | `<8>` | `bit[8]` |
| `Expression("Width")` | `<Width>` | `bit[Width]` |

IRIS takes a constant expression as a width too, so carrying the expression
through was all it needed.

**This is the same kind of failure as `veryl translate` dropping assignments**:
output that parses, simulates, and is wrong. This tool exists to avoid that,
and was doing it.

**Something else was being dropped in the same place.** Nothing read the
`#(param ...)` block, so the parameters vanished with it. The grammar puts it
at `module_declaration_opt1`, and only `opt` (generics) and `opt2` (ports) were
ever looked at. `opt0`, which declares that a module implements a proto, was
not looked at either; it is now refused.

**Nowhere in the code does it say which nodes are not being read.**

**Still refused.**

| | Reason |
|---|---|
| An arm listing several values (`2'd0, 2'd1: x`) | An IRIS match arm takes one pattern; splitting the arm is not written |
| A cast written with `as` | **IRIS' own `as` is not implemented** (below) |
| `truncate`, `saturate`, `signed`, `unsigned` | Veryl can write them. Not written |
| Multi-dimensional arrays | An IRIS `mem` is one-dimensional; folding changes what the index means |
| A `case` inside a larger expression (`8'd1 + case ...`) | Only a whole expression is rebuilt |
| `switch`, `inside`, `outside`, `msb`, `lsb` | Not written |

## The conclusion first

**It can only be complete over the common subset.**

| Direction | What is lost |
|---|---|
| Veryl → IRIS | 7 constructs, 4 types, real literals, range patterns, `step`, three `modport` features |
| IRIS → Veryl | `fsm`, `constraint`, `rand`, `mem` configuration |

**Neither language can receive the whole of the other.**

That said, the common subset is usefully wide. The two designs in
`example/comparison/veryl/` sit inside it, and rewriting them by hand produced
matching simulation results.

## What converts

**The following round-trips without changing either language.**

```
module declarations and ports (input / output / inout)
types: logic, logic<N>, signed logic<N>, u8..u64, i8..i64, string, clock, reset
declarations: let, var, const, type, enum, struct, union, function, import
bodies: always_ff, always_comb, assign, inst
expressions: case, conditionals, arithmetic / logical / comparison / shift
interface and modport (with a direction written per signal)
```

The correspondence:

| Veryl | IRIS |
|---|---|
| `module X ( ... ) { }` | `mod X( ... ) { }` |
| `a: input logic<8>` | `in a: bit[8]` |
| `var x: signed logic<32>` | `var x: int[32] = 0` |
| `always_ff (clk) { }` | `sync(clk.posedge) { }` |
| `always_comb { }` | `comb { }` |
| `case op { 4'd0: e, ... }` | `match op { 4'd0 => e, ... }` |
| `if c ? x : y` | `if c { x } else { y }` |
| `a <: b` | `a < b` |
| `u8`, `i32` | `uint[8]`, `int[32]` |

`u8` is a built-in alias for `uint[8]` in IRIS too, and it does behave as eight
bits:

```
$ iris-sim -i u8test.iris ...
u8: 255+1 = 0
```

## What does not convert

**Read this part first.**

### In Veryl, absent from IRIS

| Veryl construct | Why it cannot be converted |
|---|---|
| `f32`, `f64` | IRIS has no floating point |
| `p8`–`p64` | IRIS has no corresponding type |
| Real literals (`1.5`) | An IRIS `literal` is integer, boolean or string only |
| `tri` | IRIS has no tri-state; `inout` is a different thing |
| `bind` | No construct binds to an existing instance from outside |
| `connect` | No construct joins two interfaces |
| `generate_if`, `generate_block` | No conditional structural generation |
| `alias` | No module aliasing |
| `final` | No end-of-simulation block |
| `unsafe` | No counterpart |
| `modport`'s `..`, `same`, `converse` | An IRIS `view` has neither defaults nor reversal |
| Range patterns | An IRIS `match` pattern has no range form |
| `step` in a part select | Only `+:` and `-:` |

**`bbool` and `lbool` both map onto IRIS `bool`, and the distinction between
the two is lost.**

### In IRIS, absent from Veryl

Not one of these words appears in Veryl's grammar:

```
assert  cover  constraint  rand  fsm  state  memory  ram  rom
```

| IRIS construct | What happens in Veryl |
|---|---|
| `fsm`, `transitions`, `state`, `goto` | No counterpart; it must be written out by hand |
| `assert`, `cover`, `constraint`, `rand` | No counterpart |
| `mem`'s `ram` / `rom` / `read_mode` / `init_file` | Arrays exist, the configuration does not |
| `test`, `seq`, `await`, `wait`, `drive`, `sample` | No counterpart |
| `use rust`, `extern rust` | No counterpart |

**IRIS carries verification and state machines in the language; Veryl does
not.**

## What a converter must do

**It must not drop anything silently.**

There are two precedents for that failure.

**One: `veryl translate` (SystemVerilog → Veryl).**

| Design | Assignments in the source | Left after conversion |
|---|---|---|
| `alu` | 5 | 1 |
| `decoder` | 27 | 1 |
| `riscv_core` | 33 | 9 |

Even with `--strict` it drops assignments without a word.

**Two: IRIS' own `iris-sim`.**

It accepts a type name that does not exist, with no diagnostic, and treats it
as one bit.

| Type name | Result of assigning 3 from a `bit[8]` |
|---|---|
| `f32`, `f64`, `p32`, `lbool` | all 1 |
| `NoSuchTypeAtAll`, `Zzz` | all 1 |

`iris2sv` warns on the same input:

```
modonly.iris: warning: User type 'f32' treated as logic[1]
```

**The two together are the worst case.**

A converter that passes Veryl's `f32` through unchanged produces this:

```
converter    reports success
iris-sim     silently takes it as one bit
simulation   succeeds
the value    is wrong
```

**Nothing says a word.**

So a converter behaves in three ways:

| Verdict | Behaviour |
|---|---|
| Converts | Convert it |
| A counterpart exists but differs | **State the difference, then convert** |
| No counterpart | **Refuse, with the source position** |

## Checked by rewriting

The two designs in `example/comparison/veryl/` were moved to IRIS using the
correspondence above and nothing else.

**The ALU was checked where sign matters.** `alu.veryl`'s own comment says SLT
against SLTU and SRA against SRL still run when swapped.

| Check | Expected |
|---|---|
| SLT, `-1 < 1` | 1 |
| SLTU, `0xFFFFFFFF < 1` | 0 |
| SRA, `-16 >> 1` | `0xFFFFFFF8` |
| SRL, `0xFFFFFFF0 >> 1` | `0x7FFFFFF8` |
| ADD, `12 + 5` | 17 |

```
$ iris-sim -i alu_from_veryl.iris tb.iris -o /dev/null -c 60
fails=0
```

**The counter.**

```
$ iris-sim -i counter_from_veryl.iris ctb.iris -o /dev/null -c 40
snap=16 final=21 fails=0
```

It counts while enabled, holds while disabled, and resumes from where it left
off.

**Two designs are not enough.** Both are designs known to be expressible in
IRIS, written in Veryl. **Neither contains any Veryl that IRIS cannot
express.**

The "does not convert" verdicts were therefore checked separately:

```
real literal 1.5    => rejected
tri bit             => rejected
range pattern 0..3  => rejected
```

## Parsing is already solved

**A Veryl parser does not need to be written.** `veryl-parser` is published as
a crate.

```
$ cargo add veryl-parser@0.20.3 && cargo build
   Compiling veryl-parser v0.20.3
    Finished `dev` profile in 21.54s
```

It parses the real files:

```
alu.veryl:     OK  top-level items = 1
counter.veryl: OK  top-level items = 1
```

and rejects broken input with a position:

```
/tmp/broken.veryl: PARSE ERROR SyntaxError { cause: "LA(1): this (IdentifierTerm) at 2:3-7 ...
```

| Component | Purpose |
|---|---|
| `Parser::parse(text, path)` | Parsing |
| `veryl_grammar_trait` | The AST types |
| `veryl_walker::VerylWalker` | Walking the AST |
| `veryl_token` | Tokens carrying source positions |

**Positions are available, so a refusal can point at the place.**

IRIS' own parser is also Rust, in `sim/iris-sim`. **Both directions close in
Rust.**

## How Veryl runs

**Veryl has a native simulator.**
It is the `veryl-simulator` crate.
Cranelift starts it quickly, GCC builds an optimised binary in the background,
and the run switches to that binary once it is ready.
Testbenches are written in Veryl and run with `veryl test`.

**So verifying Veryl is not limited to lowering it to SystemVerilog.**
This document used to describe Veryl's execution as if `veryl build` and
Verilator were the only path. That is wrong: there is a native simulator.

Veryl's published figures (the veryl-lang.org blog) report this native
simulator as faster than Verilator, substantially on the first run and more
modestly once cached. **These are Veryl's numbers, not measured on this machine.**

## What has not been checked

| | Detail |
|---|---|
| `veryl` itself | **Could not be installed here.** wasmtime asks for rustc 1.94; this machine has 1.91.1. Neither the native simulator nor `veryl build` was run on this machine |
| Formal equivalence | With `veryl` unrunnable here, the path that checks against Veryl's own execution was not taken. **This is a limit of this environment, not of Veryl** |
| The version of `veryl.ebnf` | Taken from Veryl 0.20.3; the difference from upstream is unverified |
| `proto` against `extern mod` | Known to differ, but the extent was not measured |
| Veryl's standard library | Not examined |

**The construct lists here are those of Veryl 0.20.3.** `tools/veryl.ebnf`
carries its own warning:

```
Veryl moves quickly. This was taken from the release named above; check the
upstream grammar before relying on it for a later version.
```

## Related material

- [Language comparison](./language_comparison_en.md) — syntax, size and speed
- `tools/veryl.ebnf` — Veryl 0.20.3 grammar, 187 rules
- `tools/iris.ebnf` — IRIS grammar, 210 rules
- `example/comparison/veryl/` — two hand-written Veryl designs
- `report_veryl.md` — the record of this investigation
