# Where the specification, the grammar and the implementation disagree

## What this covers

The IRIS language is written down in three places.

| Document | Role |
|---|---|
| `spec/*.md` | Each chapter's EBNF, its prose, and its examples |
| `tools/iris.ebnf` | The grammar. Identical to `spec/16_grammar.md` |
| `sim/iris-sim/src/parser/iris.pest` | The grammar the reference actually runs |

The chapters and `tools/iris.ebnf` no longer disagree.
`tools/conformance/grammar_check.py` keeps them from drifting again.

**What is left is the syntax the specification's examples use.**

Fifty-five complete examples were extracted from `spec/` and run through the
reference. Nineteen do not parse.

```bash
python3 tools/conformance/grammar_check.py   # chapters against the grammar
```

This document lists what those nineteen would need.
**None of them are changed here.** Implementing one, or removing it from the
specification, is a decision about the language.

## Three kinds

### 1. In the grammar, not in the implementation

`tools/iris.ebnf` defines these and `iris.pest` does not. Either side can move.

| Construct | Chapter | Rule |
|---|---|---|
| `T: type = bit[8]`, a type bound | 15 | `generic_bound = "type" \| "uint" \| ...` |
| `extern rust "..." { }` | 11 | `extern_rust_block` |
| `enum E[W: uint = 8]` | 03 | `[ generic_params ]` in `enum_def` |
| `struct S[W: uint = 8]` | 03 | `[ generic_params ]` in `struct_def` |
| `comb default(y = 0) { }` | 05 | `default_spec` |
| `'hFF`, an unsized literal | 02 | `[ literal_size ]` in `integer_literal` |

**For these six the grammar states the language and the implementation has not
caught up.** What the specification says is right.

### 2. In neither

These appear only in the specification's examples. Neither `tools/iris.ebnf`
nor `iris.pest` has a rule for them.

| Construct | Chapter | Example |
|---|---|---|
| A type parameter with no bound | 03 | `mod Fifo[T, Depth: uint = 16]` |
| Array expansion | 04 | `enable: enables[..]` |
| Instantiating a generic interface | 08 | `let bus: AxiLite[AddrWidth: 16]` |
| A port array | 08 | `initiator ports[4]: AxiLite` |
| A view direction naming a view | 08 | `write: initiator` |
| An array literal | 10 | `const t: bit[8][16] = [ ... ]` |
| The `clocks` memory setting | 10 | `clocks: independent` |
| A testbench API | 11 | `Clock.new(period: 10.ns)`, five examples |
| A module declared with no body | 11 | `pub mod test_utils;` |
| A shorthand for a view | 15 | `out awaddr,` |

**For these ten the specification describes a language that does not exist.**

### 3. An artifact of extraction

Three examples in `03_type_system` put a definition and its use in one code
block, so neither half stands alone as a file. Nothing is wrong with the
grammar there.

## What each would take

### A type parameter with no bound

```
mod Fifo[T, Depth: uint = 16]
```

`generic_param = identifier ":" generic_bound [ "=" default_value ]` makes the
bound compulsory. Writing `T` alone needs a default for the bound. `type` is the
obvious one, and it invites confusion with `uint`.

Chapter 15 writes `T: type = bit[Width]`, which the grammar does allow.
**One document uses both spellings.**

### Array expansion

```
inst cells[4] = Cell { enable: enables[..] };
```

It hands each element of an array to the matching element of an instance array.
Instance arrays are in the grammar; how their connections are written is not.

### Port arrays and generic interfaces

```
initiator ports[4]: AxiLite
let bus: AxiLite[AddrWidth: 16, DataWidth: 32]
```

`port_decl = port_direction identifier ":" type_expr` has no array, and there is
no way to give an interface type arguments.

Chapter 8 is the interface chapter, so **its own subject falls outside the
grammar.**

### An array literal

```
const lookup: bit[8][16] = [
    8'h00, 8'h01, ...
];
```

It is how a ROM's contents are written. Initialising a memory is chapter 10's
subject, and no other way of doing it is offered.

### `Clock.new(period: 10.ns)`

Five examples in chapter 11 use it.

```
let clk = Clock.new(period: 10.ns);
```

What IRIS has is a declaration by type.

```
let clk: clock(period: 10ns);
```

**These are two APIs, not two spellings.** Choosing between them is a decision
about the verification environment.

## Why none of this is changed here

**Deleting loses what was intended.** Removing the examples that do not parse
would make the specification consistent and make it say less. The FSM chapter
came to describe a language nobody implemented exactly that way: nobody
checked, and nothing was written down.

**Adding to `tools/iris.ebnf` moves the contradiction.** It would grow the
first list above rather than shorten anything.

**Implementing adds features to the language.** Port arrays and array literals
would do no harm. `Clock.new` competes with a way of writing the same thing
that already exists.

Assembling the material for that decision is what this document is for.

## Regenerating

```bash
python3 tools/conformance/grammar_check.py
tools/conformance/run.sh
```
