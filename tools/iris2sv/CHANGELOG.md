# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Found by building the formal equivalence flow in `tools/formal`. Each of these
produced SystemVerilog that Verilator accepted and that was not the design.

### Fixed

- **A `sync` block with a reset now emits the reset branch.** The reset went
  into the sensitivity list and nowhere else, so `always_ff @(posedge clk or
  posedge rst)` took its normal path on a reset edge: the counter in
  `example/counter` incremented while `rst` was rising. Specification 6.3.1
  already gave the answer, that the reset value is the declaration's initial
  value, and the branch is now built from those initialisers. A block that
  resets nothing no longer carries the reset edge at all.
- **An instance output read as `alu.y` now becomes a wire and a port
  connection.** It was emitted as a hierarchical reference with the port left
  unconnected. `example/riscv/sv/riscv_core.sv` had 21 of them; yosys turned
  each into an undriven implicit wire, warned, and carried on.
- **`truncate` and `resize` are accepted.** Specification 3.4.2 lists them,
  `iris-sim` and `iris-compile` both implement them, error message O2003 tells
  the reader to write `truncate`, and this rejected it. A round trip through
  `sv2iris` could not close as a result.
- **A `where` clause without a trailing comma parses.** The grammar is
  `where_clause = "where" constraint { "," constraint }`, which permits no
  trailing comma; the only form accepted was the one with a trailing comma. The
  constraint's value was swallowing the `(` that opens the port list.
- **A width that is an expression is emitted as that expression.** Both the type
  path and the size-cast path substituted a comment, producing
  `input logic [/* expr */-1:0] wr_data` and
  `wr_ptr <= /* width */'(...)`, and reported the file as converted. A width
  that cannot be written down now fails the conversion.

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

### Added

#### Core Package (@iris2sv/core)
- Parser support for testbench constructs:
  - `test mod` definitions (testbench modules without ports)
  - `initial` blocks for simulation-only initialization
  - `seq` blocks for sequential test execution
  - `await` statements (clock edge, until condition, event)
  - `delay` statements (`#10ns;`)
  - `use rust::` declarations for external Rust imports
  - `extern rust` blocks for Rust function declarations
- New AST types: TestModDef, SeqBlock, InitialBlock, AwaitStmt, DelayStmt, etc.
- Visitor pattern support for all new node types

#### HIR Package
- HirInitialBlock type for initial blocks
- HirTestSeqBlock type for seq blocks
- HirDelayStmt, HirAwaitStmt, HirAssertStmt for time control

#### Transform Package (@iris2sv/transform)
- Transform support for initial blocks → SV initial blocks
- Transform support for seq blocks → SV initial blocks with time control
- await/delay statement transformation:
  - `await clk.posedge` → `@(posedge clk)`
  - `await until(cond)` → `wait(cond)`
  - `#10ns;` → `#10ns;`

#### SV Backend Package (@iris2sv/sv-backend)
- New statement types: SvDelayStmt, SvEventControlStmt, SvWaitStmt
- Emitter support for time control statements

#### Core Package (@iris2sv/core) — conversion of example/async_fifo
- System function tokens (`$clog2`, `$display`, `$finish`) in the lexer and parser
- Trailing commas in parameter lists, port lists, `where` clauses and port connections
- Clock and reset attributes: `clock(period: 10ns)`, `reset(active_low: true)`
- `arraySize` on `InstDecl`, so `inst u[4] = M { ... };` is no longer parsed and discarded

#### Transform Package (@iris2sv/transform) — conversion of example/async_fifo
- `mem` declarations lower to unpacked array signals
- Generic parameters lower to SystemVerilog module parameters, defaults included
- Widths stay symbolic: `bit[DataWidth]` keeps the parameter instead of collapsing to one bit
- Size casts preserve IRIS arithmetic width, so `(p + 1) >> 1` does not keep a carry
  bit that IRIS would have dropped

#### SV Backend Package (@iris2sv/sv-backend) — conversion of example/async_fifo
- `SvSizeCastExpr`, emitted as `Width'(expr)`
- Unpacked array dimensions emitted after the signal name

### Changed
- Constructs the lowering cannot convert now fail with a diagnostic instead of
  being skipped silently
- Lowering diagnostics reach the compilation result. They previously appeared
  only under `--verbose` and did not affect success

### Fixed
- `mem name: bit[Width][Depth];` parses the depth from the type expression
  rather than demanding a further bracket group
- `parsePortConnection` referenced a method that does not exist, so an instance
  inside a `test` module failed to build

### Verified
- `example/async_fifo` converts and runs under Verilator, reproducing the
  IRIS simulator's result: 40 words verified, no mismatch

### Planned
- FSM block support
- Lowering of `test` modules to SystemVerilog testbenches
  (the parser accepts them; the lowering reports them as unsupported)
- Time literals (`10ns`) in expressions
- `match` used as an expression
- Watch mode (--watch)
- Configuration file support
- Interface definitions
- Improved error messages with suggestions
- External Rust function DPI-C conversion
- Signal access API conversion
