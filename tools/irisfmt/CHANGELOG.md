# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Core (@irisfmt/core)
- Parser support for testbench constructs:
  - `test mod` definitions (testbench modules without ports)
  - `initial` blocks for simulation-only initialization
  - `seq` blocks for sequential test execution
  - `await` statements (clock edge, until condition, event)
  - `delay` statements (`#10ns;`)
  - `use rust::` declarations for external Rust imports
  - `extern rust` blocks for Rust function declarations

#### Formatter (@irisfmt/format)
- Formatting support for all new testbench constructs:
  - `TestModDef`, `InitialBlock`, `SeqBlock`
  - `AwaitStmt`, `DelayStmt`
  - `UseRustDecl`, `ExternRustBlock`, `RustFnDecl`

#### Linter (@irisfmt/lint)
- New lint rule: `seq-missing-timeout`
  - Warns when `await until(condition)` lacks a timeout parameter
  - Helps prevent simulation deadlocks
- Extended `no-empty-block` rule:
  - Now detects empty `test mod` bodies
  - Now detects empty `initial` blocks
  - Now detects empty `seq` blocks

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
