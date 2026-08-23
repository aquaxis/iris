# The iris command

One entry point for the IRIS tools. Each tool is a subcommand, as in `iris sim`.

It lives in `tools/iris`. It is written in Rust and has no dependencies.

## Why one command

The entry points were scattered. Simulation was `iris-sim`, formatting was
`irisfmt-format`, conversion was `iris2sv`, each its own command.

`iris` gathers them as subcommands, the way `cargo` gathers `cargo build` and
`cargo test`.

## Usage

```bash
iris sim -i design.iris -o out.vcd -c 100    # iris-sim
iris compile -i design.iris -o sim --release # iris-compile
iris formal -i design.iris -o out/           # iris-formal
iris veryl import design.veryl               # veryl2iris (Veryl -> IRIS)
iris veryl export design.iris                # iris2veryl (IRIS -> Veryl)
```

**Arguments after the command pass through unchanged.**
`iris sim -i design.iris -c 100` runs `iris-sim -i design.iris -c 100`, so each
tool's own options work as they are.

## Subcommands

### Subcommands (all Rust)

| Subcommand | Tool | Role |
|---|---|---|
| `iris sim` | `iris-sim` | simulator (interpreter) |
| `iris compile` | `iris-compile` | simulator (compiled) |
| `iris formal` | `iris-formal` | formal-equivalence reference model |
| `iris veryl import` | `veryl2iris` | Veryl -> IRIS |
| `iris veryl export` | `iris2veryl` | IRIS -> Veryl |
| `iris sv` | `iris2sv` | IRIS -> SystemVerilog |
| `iris from-sv` | `sv2iris` | SystemVerilog -> IRIS |
| `iris fmt` | `irisfmt` | format IRIS source |
| `iris lint` | `irisfmt-lint` | check IRIS style |
| `iris lsp` | `irisfmt-lsp` | language server |

`veryl` has two directions, so `import` and `export` split them.
`sv`/`from-sv` are ported to Rust (stage A4); `fmt`/`lint`/`lsp` are ported to
Rust (stage A5). All are at parity with the former TypeScript tools (`fmt`
passes the conformance suite; `lint` and `lsp` carry the same rule set and
features). **No subcommand shells out to node any more.**
`fmt` lexes IRIS keeping comments, checks the source parses with the shared
`iris-sim` parser, then re-emits the token stream with canonical whitespace
(IRIS is not layout-sensitive, so meaning is preserved).
`lint` runs its rules over the shared `iris-sim` AST. That AST is built for
simulation and carries a span only on definitions (modules, enums, structs,
functions), so diagnostics anchor more coarsely than the TypeScript linter
(to the nearest such definition). It checks naming, unused imports/signals/
variables, empty blocks, complexity, and un-timed `await until` in seq blocks.
Two TypeScript rules have no home on this AST: `dead-code`'s "after return"
form (a function body is one expression, with no return statement) is
re-expressed as unreachable code after `break`/`continue`, and
`var-context-restriction` is omitted (a module-level `var` is valid in current
IRIS and the AST does not tag a statement-level `let` as `var`).
`lsp` is a synchronous JSON-RPC server over stdio that reuses `irisfmt`'s
formatter and linter and the `iris-sim` AST. It offers diagnostics (lint),
formatting, completion, hover, go-to-definition, references, document symbols,
and rename. Definition and document symbols use the definitions that carry a
span (modules, functions, enums, structs); references and rename use a
whole-word text search, so they work on any identifier.

### Browser front end (npm)

| Subcommand | Runs | How |
|---|---|---|
| `iris schematic` | block diagram viewer | `npm run dev` starts the dev server |

`schematic` is a web app, so it cannot fold into the CLI; only it needs npm.

**The entry point is one command.** Arguments pass straight through, so
`iris sv design.iris` and `iris fmt design.iris` work as they are.

## Finding a tool

`iris` looks for each tool's binary in this order:

1. the environment variable `IRIS_<TOOL>_BIN` (e.g. `IRIS_IRIS_SIM_BIN`)
2. beside the `iris` binary itself
3. the repository build paths (`sim/iris-sim/target/release/iris-sim`, ...)
4. `PATH`

Run from the repository root, the built tools are found as they are. Every
subcommand is a Rust binary, so `node` is no longer needed; only
`iris schematic`'s browser dev server uses npm.

## Why no dependencies

`iris` does not link the tools; it runs them as subprocesses.

The reason is a dependency conflict. `iris-sim` pins clap 4.4.18 while
`veryl-parser` needs clap ^4.6, and the two cannot share a lock. Linking both
into `iris` would inherit that conflict. So it links neither, parses its own
arguments, and hands off to the built binaries. This also builds offline.

## What is not done

- The CLI tool port is complete. `sv` (iris2sv), `from-sv` (sv2iris), and
  `fmt`/`lint`/`lsp` (irisfmt) are all Rust and never invoke node.
- `iris schematic` only starts the browser dev server; it is not a CLI (npm).
- `lsp`'s position precision is bounded by the `iris-sim` AST's spans, so it is
  coarser than the TypeScript server. Making it finer needs per-identifier
  spans in the AST (future work).
