# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-10

### Added

#### Core Package (@iris2sv/core)
- Lexer implementation with full IRIS token support
- Parser with complete IRIS grammar support
- AST type definitions for all IRIS constructs
- HIR (High-level Intermediate Representation) types
- AST Visitor pattern (BaseVisitor, walkAst)

#### Analyzer Package (@iris2sv/analyzer)
- Symbol table with scope management
- SymbolTableBuilder for AST-to-symbol-table construction
- Type checker with IRIS type system support
- Type resolver (AST TypeExpr to IrisType)
- Semantic analyzer with diagnostics:
  - Unused input/output port detection
  - Input port write detection
  - Undefined variable detection
  - Read-before-write detection

#### Transform Package (@iris2sv/transform)
- AST to HIR lowering
- HIR to SystemVerilog AST transformation
- Type mapper (HIR types to SV types)
- Expression transformer
- Statement transformer
- Module transformer

#### SV Backend Package (@iris2sv/sv-backend)
- SystemVerilog AST type definitions
- Code emitter with full SV output support:
  - Module declarations
  - Port declarations
  - Parameter declarations
  - always_comb blocks
  - always_ff blocks
  - assign statements
  - typedef (enum, struct)
  - Module instantiation

#### CLI Package (@iris2sv/cli)
- Command-line interface with commander
- Glob pattern support for input files
- Compiler pipeline integration
- Error formatter with colored output
- Options: --output, --verbose, --strict, --check, --dry-run

#### Documentation
- CLI reference guide
- Conversion rules reference
- API reference

#### Testing
- 496 unit tests across all packages
- E2E snapshot tests with 7 fixture pairs
- Test coverage: 79.22%

#### Infrastructure
- pnpm monorepo with 5 packages
- TypeScript strict mode
- ESLint + Prettier configuration
- Vitest test runner
- GitHub Actions CI/CD workflow

### Supported IRIS Features

- Module definitions with ports
- Generic parameters
- Primitive types: bool, bit, int<N>, uint<N>, clock, reset
- Array types
- Enum definitions
- Struct definitions
- Combinational blocks (comb)
- Sequential blocks (sync) with clock/reset
- Instance declarations (inst)
- Operators: arithmetic, bitwise, comparison, logical
- Control flow: if, match, for

### Known Limitations

- FSM blocks not yet supported (parser limitation)
- Watch mode not implemented
- Configuration file not supported
- Some edge cases in type inference

## [Unreleased]

### Planned
- FSM block support
- Watch mode (--watch)
- Configuration file support
- Interface definitions
- Memory declarations
- Improved error messages with suggestions
