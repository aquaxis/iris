# iris2sv API Reference

This document describes the programmatic API for using iris2sv as a library.

## Package Overview

The iris2sv project consists of five packages:

| Package | Description |
|---------|-------------|
| `@iris2sv/core` | Lexer, Parser, AST, HIR definitions |
| `@iris2sv/analyzer` | Symbol table, Type checker, Semantic analyzer |
| `@iris2sv/transform` | AST to HIR lowering, HIR to SV AST transformation |
| `@iris2sv/sv-backend` | SystemVerilog AST, Code emitter |
| `@iris2sv/cli` | Compiler pipeline, CLI interface |

## Quick Start

### Basic Compilation

```typescript
import { Compiler } from '@iris2sv/cli';

const compiler = new Compiler();

const source = `
mod counter(
    in  clk: clock,
    in  rst: reset,
    out count: bit[8],
) {
}
`;

const result = compiler.compile(source, 'counter.iris');

if (result.success) {
  console.log(result.output);
} else {
  console.error('Compilation failed:');
  for (const diag of result.diagnostics) {
    console.error(`${diag.severity}: ${diag.message}`);
  }
}
```

## @iris2sv/cli

### Compiler Class

```typescript
import { Compiler, CompilerOptions, CompileResult } from '@iris2sv/cli';
```

#### CompilerOptions

```typescript
interface CompilerOptions {
  /** Treat warnings as errors (default: false) */
  strict: boolean;

  /** Verbose output (default: false) */
  verbose: boolean;

  /** Skip code generation, check only (default: false) */
  checkOnly: boolean;

  /** Target SystemVerilog version (default: 'sv2012') */
  target: 'sv2012' | 'sv2017';
}
```

#### CompileResult

```typescript
interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;

  /** Parsed AST (if parsing succeeded) */
  ast: SourceFile | null;

  /** Generated SystemVerilog code (if generation succeeded) */
  output: string | null;

  /** Diagnostic messages */
  diagnostics: Diagnostic[];

  /** Parse errors (separate from semantic diagnostics) */
  parseErrors: ParseError[];
}
```

#### Usage

```typescript
// Create compiler with default options
const compiler = new Compiler();

// Create compiler with custom options
const compiler = new Compiler({
  strict: true,
  verbose: true,
});

// Compile source code
const result = compiler.compile(sourceCode, 'filename.iris');
```

### ErrorFormatter Class

```typescript
import { ErrorFormatter, Diagnostic } from '@iris2sv/cli';
```

Format diagnostics for console output with colors and source context.

```typescript
const formatter = new ErrorFormatter({ color: true });
formatter.setSource('input.iris', sourceCode);

const output = formatter.formatDiagnostics(diagnostics, 'input.iris');
console.log(output);
```

## @iris2sv/core

### Lexer

```typescript
import { createLexer, Token, TokenKind } from '@iris2sv/core';

const lexer = createLexer(sourceCode);
const tokens: Token[] = [];

while (true) {
  const token = lexer.nextToken();
  tokens.push(token);
  if (token.kind === TokenKind.EOF) break;
}
```

### Parser

```typescript
import { parse, SourceFile, ParseError } from '@iris2sv/core';

const { ast, errors } = parse(sourceCode);

if (errors.length > 0) {
  console.error('Parse errors:', errors);
} else {
  console.log('AST:', ast);
}
```

### AST Types

Key AST node types:

```typescript
// Source file (root)
interface SourceFile {
  kind: 'SourceFile';
  items: SourceItem[];
  span: SourceSpan;
}

// Module definition
interface ModDef {
  kind: 'ModDef';
  name: Identifier;
  generics?: GenericParams;
  ports: PortDecl[];
  items: ModItem[];
  span: SourceSpan;
}

// Port declaration
interface PortDecl {
  kind: 'PortDecl';
  direction: 'in' | 'out' | 'inout';
  name: Identifier;
  typeExpr: TypeExpr;
  span: SourceSpan;
}
```

### HIR Types

High-level Intermediate Representation:

```typescript
interface HirModule {
  kind: 'HirModule';
  name: string;
  parameters: HirParameter[];
  ports: HirPort[];
  signals: HirSignal[];
  items: HirModuleItem[];
}

interface HirPort {
  kind: 'HirPort';
  name: string;
  direction: 'input' | 'output' | 'inout';
  dataType: HirDataType;
}
```

### AST Visitor

```typescript
import { walkAst, BaseVisitor } from '@iris2sv/core';

class MyVisitor extends BaseVisitor {
  visitModDef(node: ModDef): void {
    console.log('Found module:', node.name.name);
    super.visitModDef(node);
  }
}

const visitor = new MyVisitor();
walkAst(ast, visitor);
```

## @iris2sv/analyzer

### Symbol Table

```typescript
import { SymbolTableBuilder, SymbolTable } from '@iris2sv/analyzer';

const builder = new SymbolTableBuilder();
builder.build(ast);

const symbolTable: SymbolTable = builder.getSymbolTable();
const symbol = symbolTable.lookup('counter');
```

### Type Checker

```typescript
import { TypeChecker, IrisType } from '@iris2sv/analyzer';

const typeChecker = new TypeChecker(symbolTable);
const exprType: IrisType = typeChecker.checkExpr(expr);
```

### Semantic Analyzer

```typescript
import { createSemanticAnalyzer, SemanticDiagnostic } from '@iris2sv/analyzer';

const analyzer = createSemanticAnalyzer();
const diagnostics: SemanticDiagnostic[] = analyzer.analyze(ast, symbolTable);

for (const diag of diagnostics) {
  console.log(`${diag.severity}: ${diag.message}`);
}
```

## @iris2sv/transform

### Lowering (AST to HIR)

```typescript
import { createLowering, LoweringResult } from '@iris2sv/transform';

const lowering = createLowering();
const result: LoweringResult = lowering.lower(ast);

const hirModules = result.hir.modules;
const errors = result.errors;
const warnings = result.warnings;
```

### Module Transformer (HIR to SV AST)

```typescript
import { createModuleTransformer } from '@iris2sv/transform';
import { SvModule } from '@iris2sv/sv-backend';

const transformer = createModuleTransformer();
const svModule: SvModule = transformer.transform(hirModule);
```

## @iris2sv/sv-backend

### SystemVerilog AST

```typescript
import { SvModule, SvPort, SvDataType } from '@iris2sv/sv-backend';

interface SvModule {
  kind: 'SvModule';
  name: string;
  parameters: SvParameter[];
  ports: SvPort[];
  items: SvModuleItem[];
}
```

### Code Emitter

```typescript
import { emitModule } from '@iris2sv/sv-backend';

const svCode: string = emitModule(svModule);
console.log(svCode);
```

### Builder Functions

```typescript
import {
  logicType,
  constWidth,
  createPort,
  createModule,
} from '@iris2sv/sv-backend';

// Create a logic type: logic [7:0]
const uint8 = logicType(constWidth(8), false);

// Create a port
const port = createPort('data', 'input', uint8);

// Create a module
const module = createModule('my_module', [], [port], []);
```

## Complete Example

Full compilation pipeline:

```typescript
import { parse } from '@iris2sv/core';
import { SymbolTableBuilder, createSemanticAnalyzer } from '@iris2sv/analyzer';
import { createLowering, createModuleTransformer } from '@iris2sv/transform';
import { emitModule } from '@iris2sv/sv-backend';

// Source code
const source = `
mod alu(
    in  a: bit[8],
    in  b: bit[8],
    in  op: bit[2],
    out result: bit[8],
) {
}
`;

// Parse
const { ast, errors: parseErrors } = parse(source);
if (parseErrors.length > 0) {
  console.error('Parse errors:', parseErrors);
  process.exit(1);
}

// Build symbol table
const builder = new SymbolTableBuilder();
builder.build(ast);
const symbolTable = builder.getSymbolTable();

// Semantic analysis
const analyzer = createSemanticAnalyzer();
const diagnostics = analyzer.analyze(ast, symbolTable);
if (diagnostics.some(d => d.severity === 'error')) {
  console.error('Semantic errors:', diagnostics);
  process.exit(1);
}

// Lower to HIR
const lowering = createLowering();
const loweringResult = lowering.lower(ast);

// Transform to SV AST and emit
const transformer = createModuleTransformer();
const outputs: string[] = [];

for (const hirModule of loweringResult.hir.modules) {
  const svModule = transformer.transform(hirModule);
  outputs.push(emitModule(svModule));
}

// Output
const header = '// Generated by iris2sv\n// Do not edit manually\n\n';
console.log(header + outputs.join('\n\n'));
```

## TypeScript Types

All packages export TypeScript type definitions. Import types as needed:

```typescript
import type {
  SourceFile,
  ModDef,
  TypeExpr,
  Expr,
  Stmt,
  HirModule,
  HirDataType,
} from '@iris2sv/core';

import type {
  Symbol,
  SymbolTable,
  IrisType,
  SemanticDiagnostic,
} from '@iris2sv/analyzer';

import type {
  LoweringResult,
  TypeMapperContext,
} from '@iris2sv/transform';

import type {
  SvModule,
  SvPort,
  SvDataType,
  SvExpr,
  SvStmt,
} from '@iris2sv/sv-backend';
```

## Error Handling

All compilation stages can produce errors:

1. **Lexer errors**: Invalid tokens, unterminated strings
2. **Parser errors**: Syntax errors, unexpected tokens
3. **Symbol errors**: Undefined symbols, duplicate definitions
4. **Type errors**: Type mismatches, invalid operations
5. **Semantic errors**: Signal direction violations, unused ports

Use the `Compiler` class for automatic error aggregation, or handle each stage manually for fine-grained control.
