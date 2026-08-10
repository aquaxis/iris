# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Language Server (@irisfmt/ls)
- Go to definition (`textDocument/definition`), including hierarchical names
  such as `rf.rdata1`, which resolve through the instance to the module it
  instantiates
- Find references (`textDocument/references`)
- Document symbols (`textDocument/documentSymbol`), with a module's ports,
  signals, memories and instances nested beneath it
- Rename (`textDocument/rename`), refusing a rename to a reserved word
- The remaining 21 reserved words in hover and completion, so all 58 of
  specification §2.4 are covered

#### Core (@irisfmt/core)
- A symbol table (`buildSymbolTable`, `resolve`) recording modules, ports,
  signals, memories, instances and generic parameters, and resolving
  hierarchical names

#### Lint (@irisfmt/lint)
- `seq-missing-timeout`: an `await until(...)` with no timeout stops the
  sequence for the rest of the run if the condition never holds

### Fixed

#### Parser
The parser had fallen behind the language. Every example design now parses
without error; before, `example/riscv` produced 978 errors.

- `reset(active_low: true)` and `clock(period: 10ns)` attributes
- `int[32]` / `uint[32]`; the older `int<32>` still parses
- `inst u = M { ... };`; the older `u: M(...)` still parses
- Port connections written `port: expr`; the older `.port(expr)` still parses
- `$clog2(Depth)` and other system functions
- Trailing commas in generic parameters, `where` clauses and port connections
- `{a, b}` after `=>` read as a concatenation rather than a block

Two of those changes first introduced hangs — a zero-length token at `$`, and a
`match` arm that consumed nothing. A language server that hangs freezes the
editor, so `parseMatchArms` now always makes progress.

#### Build
- `packages/lint` exported a rule from a file that did not exist, which stopped
  the whole workspace from building
- `packages/vscode-iris` had no `build` script, so it was skipped by `pnpm -r build`

#### Testbench constructs
- `test mod` definitions, `initial` blocks, `seq` blocks, `await` statements
  (clock edge, until condition, event), `delay` statements, `use rust::`
  declarations and `extern rust` blocks

#### Linter (@irisfmt/lint)
- Extended `no-empty-block`: empty `test mod` bodies, `initial` blocks and
  `seq` blocks

### Testing
- The language server is tested over the protocol: the built server is spawned
  and spoken to in LSP. 10 tests, including the RV32I core from `example/riscv`.
  The workspace previously had none

### Fixed — testbenches

The designs in `example/` parsed; the testbenches beside them did not. Measured
over every `.iris` file rather than the six designs, the four testbenches
produced 2082 errors, and four of them exhausted memory instead of finishing.

- `test Name { ... }` was gated on the older spelling `test mod Name`, so the
  form the grammar defines (`tools/iris.ebnf`, `test_mod_def`) and every
  testbench in `example/` uses was not recognised at all
- `test name() { ... }`, the test function of specification chapter 11
- A test module body took an instance only in the older `u :: M` form, and had
  no case for `mem`, `fsm` or `type`, which `test_item` allows
- `assert cond else error("...")` was not parsed. `expect` consumes nothing when
  it fails, so the enclosing statement loop never advanced and the parser spun
- `assert` was missing from the statement parser, so a check inside a `sync`,
  `initial` or `seq` block spun in the same way
- `clock(period: 10ns)`: the duration's unit was left unconsumed. The entry
  above claiming this attribute already worked was true only of
  `reset(active_low: true)`

Statement and item loops now assert progress: an iteration that consumes
nothing reports the token and steps over it. A parser that spins is worse than
one that parses wrongly, because it freezes the editor on a half-typed file.

### Fixed — formatting

Formatting rewrites the file the reader is editing, so what it drops matters
more than how it looks. Each of these silently discarded what the author wrote.

- A `where` clause was printed on one line, running into the port list so that
  `Depth >= 4(` read as a call. Formatting `example/async_fifo/src/async_fifo.iris`
  produced a file with 385 parse errors
- `clock` and `reset` attributes were not printed at all
- `else error("...")` on an assert was not printed
- An `assert` inside a `sync`, `initial` or `seq` block was printed as nothing,
  so the assertion disappeared from the file

### Fixed — language server
- The enclosing module of a position was found by matching `mod` and
  `test mod`, so no name inside a `test Name { ... }` body resolved. Definition,
  references and rename all returned nothing in a testbench

### Fixed — tests
- The protocol test harness framed messages by character count while
  `Content-Length` counts bytes. IRIS sources carry Japanese comments, so any
  reply containing them was never assembled and the request appeared to hang.
  This is why formatting and code actions had no test

## [0.1.0] - 2026-01-09

### Added

#### Core (@irisfmt/core)
- Lexer implementation
  - Full tokenization support for IRIS language
  - Comment handling (line and block comments)
  - Trivia (whitespace) preservation
  - Position tracking (line, column, offset)
  - Error recovery
- Parser implementation
  - Complete IRIS syntax support
  - Module definitions with ports and generic parameters
  - Type definitions (enum, struct, type alias)
  - Function definitions
  - Interface definitions with views
  - Import and package declarations
  - Test definitions
  - Hardware blocks (comb, sync, fsm)
  - Instance and memory declarations
- AST types and Visitor pattern
  - Full AST node type definitions
  - `walkAst` function for tree traversal

#### Formatter (@irisfmt/format)
- Pretty Printer with configurable style
  - `indentWidth`: Number of spaces for indentation
  - `useTabs`: Use tabs instead of spaces
  - `maxLineLength`: Maximum line length
  - `braceStyle`: Brace placement (same-line, new-line)
  - `trailingComma`: Trailing comma style (none, all, multi-line)
- Comment preservation during formatting
- CLI tool (`irisfmt-format`)
  - `--check`: Check if files are formatted
  - `--write`: Write formatted output back to files
  - Glob pattern support for multiple files
  - Configuration file support (`.irisfmtrc.json`)

#### Linter (@irisfmt/lint)
- 8 lint rules:
  - `naming-convention`: Enforce naming conventions
  - `unused-variable`: Detect unused variables
  - `unused-signal`: Detect unused signals
  - `unused-import`: Detect unused imports
  - `no-empty-block`: Detect empty blocks
  - `var-context-restriction`: Enforce var usage context
  - `import-order`: Enforce import ordering
  - `duplicate-import`: Detect duplicate imports
- Auto-fix support for applicable rules
- CLI tool (`irisfmt-lint`)
  - `--fix`: Automatically fix fixable issues
  - Glob pattern support for multiple files
  - Configuration file support

#### Language Server (@irisfmt/ls)
- LSP protocol implementation
  - `textDocument/publishDiagnostics`: Real-time diagnostics
  - `textDocument/formatting`: Document formatting
  - `textDocument/rangeFormatting`: Range formatting
  - `textDocument/codeAction`: Quick fixes for lint issues
- Integration with formatter and linter

#### VSCode Extension (vscode-iris)
- Syntax highlighting (TextMate grammar)
- Language configuration (comments, brackets, indentation)
- Language server client integration
- Status bar indicator

#### Documentation
- README.md with installation and usage instructions
- Configuration reference (`docs/configuration.md`)
- Lint rules reference (`docs/lint-rules.md`)

#### Infrastructure
- pnpm workspace monorepo setup
- TypeScript configuration
- Vitest test setup
- ESLint configuration
- GitHub Actions CI workflow
