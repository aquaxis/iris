# Editor support

IRIS ships a VSCode extension.
It lives in `tools/irisfmt/packages/vscode-iris`.

## Two layers

The extension supports the editor in two layers.
Knowing which feature lives in which layer lets you tell them apart when one
of them is not working.

| Layer | What it does | When it works |
|---|---|---|
| Syntax highlight | Colors keywords, types, numbers and operators | The grammar file alone is enough |
| Language server | Diagnostics, formatting, completion, hover, go to definition, find references, rename | The server must be built and running |

**Syntax highlighting works even where the language server does not.**
The TextMate grammar (`syntaxes/iris.tmLanguage.json`) colors on its own.

The language server is described in `tools/irisfmt-ls.md`.

## What it can do

### Syntax highlight

In `.iris` and `.irs` files it colors the following.

| Kind | Examples |
|---|---|
| Control | `if`, `else`, `match`, `for`, `while`, `return`, `when`, `goto`, `break`, `continue`, `until`, `await`, `default` |
| Declaration | `mod`, `fn`, `let`, `var`, `const`, `type`, `struct`, `union`, `enum`, `interface`, `package`, `import`, `use`, `export`, `extern`, `extends` |
| Hardware | `comb`, `sync`, `seq`, `fsm`, `state`, `transitions`, `mem`, `inst`, `ram`, `rom`, `initial`, `event` |
| Verification | `assert`, `assume`, `expect`, `cover`, `rand`, `constraint`, `test`, `wait`, `sample`, `timeout`, `should_fail` |
| Severity | `error`, `warning`, `fatal` |
| Direction | `in`, `out`, `inout`, `initiator`, `target`, `monitor` |
| Modifier | `pub`, `mut`, `async`, `parametric`, `ignore` |
| Type | `bit`, `int`, `uint`, `bool`, `clock`, `reset`, `string`, `logic` |
| Edge | `posedge`, `negedge`, `sync_reset` |
| Number | decimal, hex (`0x`), binary (`0b`), octal (`0o`), sized (`16'd400`), duration (`10ns`) |

**The keyword list was taken from `tools/iris.ebnf`.**
It only colors words the language already has; the language specification is
unchanged.

### Language server

Per `irisfmt-ls.md`, it provides the following.

| Feature | LSP method |
|---|---|
| Diagnostics | `textDocument/publishDiagnostics` |
| Formatting | `textDocument/formatting` |
| Completion | `textDocument/completion` |
| Hover | `textDocument/hover` |
| Go to definition | `textDocument/definition` |
| Find references | `textDocument/references` |
| Document symbols | `textDocument/documentSymbol` |
| Rename | `textDocument/rename` |

## Usage

### Build

Build everything from `tools/irisfmt`.

```
$ tsc --build
```

To build only the VSCode extension:

```
$ cd packages/vscode-iris
$ tsc -p ./
```

### Using the extension

The extension binds language `iris` to `.iris` and `.irs`, and binds the
grammar `source.iris` to `syntaxes/iris.tmLanguage.json`.
Open a `.iris` file in VSCode and syntax highlighting takes effect.

The extension starts the language server.
The `IRIS` item in the status bar shows starting, running or stopped.

## Verification

All measured on this machine on 2026-08-22.

### Build and tests

```
$ tsc --build
(exit code 0)

$ cd packages/vscode-iris && tsc -p ./
(exit code 0)

$ vitest run
Test Files  4 passed (4)
     Tests  104 passed (104)
```

14 of the 104 are the LSP protocol tests in `packages/ls`.

### Grammar checks

We confirmed that every regular expression in the grammar compiles, that each
added keyword matches its kind, and that a control (a misspelled word) does
not.

```
H-L1 regex compile: ok
scanned 11 example files with all patterns: ok
RESULT: all checks passed
```

Sized literals (`16'd400`, `'hFF`) and durations (`10ns`, `1.5us`) match, and
the control `8hFF` without an apostrophe does not match as a sized literal.

## What was not checked

**We did not launch VSCode and look at the colors by eye.**
The grammar checks used JavaScript regular expressions.
That differs from the Oniguruma engine VSCode uses, but the expressions here
use only word boundaries and character classes, where the two agree.

**No full tokenization through Oniguruma was performed.**
