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

**There are controls.**

| Check | Mutation | Result |
|---|---|---|
| counter round trip | increment becomes 2 | `resumed=21` → `42` |
| ALU round trip | SLT becomes unsigned | `fails=0` → `1` |
| regfile round trip | the written value becomes `wdata+1` | `fails=0` → `1` |
| decoder round trip | the repeated sign bit becomes zero | all four immediate forms change |

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

All are in `tools/conformance/run.sh`, which went from 130 checks to 141, no
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
| `riscv_core` | Refused (unimplemented). Reads an instance's port |
| `async_fifo` | Refused (unimplemented). Generic width |

**`riscv_core`'s reason changed.** With `sign_extend` settled, this is what it
hit next.

```
IRIS    alu_a = if dec.alu_a_pc { pc } else { rf.rdata1 };
```

IRIS reads an instance's output port directly in an expression. Veryl has no
such expression: an output is wired to a variable at the instantiation and
that variable is read. **The rewrite is possible but needs the ports of the
instantiated module**, and this converter reads one file at a time.

**That is not a gap between the languages either.**

Refusals come in two kinds, and they are reported differently.

| Kind | Example | What the reader does |
|---|---|---|
| The language has no counterpart | `fsm`, `f32`, `tri` | Rewrite the design, or give up on it |
| This converter has not caught up | generics, instance port reads, multi-value case arms | Wait for the tool |

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

**Still refused.**

| | Reason |
|---|---|
| An arm listing several values (`2'd0, 2'd1: x`) | An IRIS match arm takes one pattern; splitting the arm is not written |
| Generics (`bit[DataWidth]`) | Veryl has generics too. Not written |
| Reading an instance's port (`dec.rd`) | Veryl wires it to a variable first; the other module's ports are needed. Not written |
| Width conversions other than `sign_extend` | Veryl can write them. Not written |
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

## What has not been checked

| | Detail |
|---|---|
| `veryl` itself | **Will not install here.** wasmtime asks for rustc 1.94; this machine has 1.91.1 |
| Formal equivalence | Blocked: comparing through SystemVerilog needs `veryl build` |
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
