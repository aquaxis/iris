/**
 * AST to HIR Lowering
 *
 * Converts IRIS AST to HIR (High-level Intermediate Representation).
 * This is the first step in the transformation pipeline.
 */

import type {
  // AST Types
  SourceFile,
  ModDef,
  PortDecl,
  PortDirection as AstPortDirection,
  SignalDecl,
  InstDecl,
  Connection,
  CombBlock,
  SyncBlock,
  ClockSpec,
  ResetSpec,
  TypeExpr,
  PrimitiveType,
  ArrayType as AstArrayType,
  TupleType as AstTupleType,
  Expr,
  IntegerLiteral,
  BoolLiteral,
  UnaryExpr,
  BinaryExpr,
  IndexExpr,
  FieldExpr,
  ConcatExpr,
  RepeatExpr,
  CallExpr,
  CastExpr,
  IfExpr,
  Stmt,
  LetStmt,
  VarStmt,
  AssignStmt,
  IfStmt,
  ForStmt,
  MatchStmt,
  BlockStmt,
  LValue,
  UnaryOp,
  BinaryOp,
  Pattern,
} from '@iris2sv/core';

import type {
  // HIR Types
  HirSourceFile,
  HirModule,
  HirPort,
  HirPortDirection,
  HirSignal,
  HirInstance,
  HirConnection,
  HirCombBlock,
  HirSeqBlock,
  HirClockSpec,
  HirClockEdge,
  HirResetSpec,
  HirResetMode,
  HirDataType,
  HirExpr,
  HirUnaryOp,
  HirBinaryOp,
  HirStmt,
  HirLValue,
  HirIfStmt,
} from '@iris2sv/core';

import {
  createLogicType,
  createBoolType,
  createArrayType,
  createTupleType,
  createPort,
  createSignal,
  createInstance,
  createCombBlock,
  createSeqBlock,
  createHirSourceFile,
  createIntegerLiteral,
  createBoolLiteral,
  createHirIdentifier,
  createUnaryExpr,
  createBinaryExpr,
  createConditionalExpr,
  createConcatExpr,
  createRepeatExpr,
  createIndexExpr,
  createSliceExpr,
  createFieldExpr,
  createCallExpr,
  createCastExpr,
  createIdentifierLValue,
  createIndexLValue,
  createSliceLValue,
  createFieldLValue,
  createConcatLValue,
  createAssignStmt,
  createNonblockingAssignStmt,
  createIfStmt,
  createForStmt,
  createBlockStmt,
  createVarDeclStmt,
  createExprStmt,
} from '@iris2sv/core';

/**
 * Lowering context for tracking state during transformation
 */
export interface LoweringContext {
  /** Current module name being processed */
  currentModule: string | undefined;
  /** Whether we're in a sequential block (use non-blocking assignments) */
  inSequentialBlock: boolean;
  /** Errors collected during lowering */
  errors: LoweringError[];
  /** Warnings collected during lowering */
  warnings: LoweringWarning[];
}

/**
 * Lowering error
 */
export interface LoweringError {
  message: string;
  location: string | undefined;
}

/**
 * Lowering warning
 */
export interface LoweringWarning {
  message: string;
  location: string | undefined;
}

/**
 * Lowering result
 */
export interface LoweringResult {
  hir: HirSourceFile;
  errors: LoweringError[];
  warnings: LoweringWarning[];
}

/**
 * Create a new lowering context
 */
export function createLoweringContext(): LoweringContext {
  return {
    currentModule: undefined,
    inSequentialBlock: false,
    errors: [],
    warnings: [],
  };
}

/**
 * Lower AST source file to HIR
 */
export function lowerSourceFile(ast: SourceFile, ctx?: LoweringContext): LoweringResult {
  const context = ctx ?? createLoweringContext();
  const modules: HirModule[] = [];

  for (const item of ast.items) {
    if (item.kind === 'ModDef') {
      const hirModule = lowerModule(item, context);
      modules.push(hirModule);
    }
    // TODO: Handle top-level type definitions, functions, etc.
  }

  return {
    hir: createHirSourceFile(modules),
    errors: context.errors,
    warnings: context.warnings,
  };
}

/**
 * Lower module definition to HIR
 */
export function lowerModule(mod: ModDef, ctx: LoweringContext): HirModule {
  ctx.currentModule = mod.name.name;

  // Lower ports
  const ports: HirPort[] = mod.ports.map((p: PortDecl) => lowerPort(p, ctx));

  // Separate module items
  const signals: HirSignal[] = [];
  const instances: HirInstance[] = [];
  const combBlocks: HirCombBlock[] = [];
  const seqBlocks: HirSeqBlock[] = [];

  for (const item of mod.items) {
    switch (item.kind) {
      case 'SignalDecl':
        signals.push(lowerSignalDecl(item, ctx));
        break;
      case 'InstDecl':
        instances.push(lowerInstDecl(item, ctx));
        break;
      case 'CombBlock':
        combBlocks.push(lowerCombBlock(item, ctx));
        break;
      case 'SyncBlock':
        seqBlocks.push(lowerSyncBlock(item, ctx));
        break;
      // TODO: Handle MemDecl, FsmBlock, etc.
    }
  }

  // Create the module
  const hirModule: HirModule = {
    kind: 'HirModule',
    name: mod.name.name,
    isPublic: mod.visibility === 'public',
    isTestbench: false,
    parameters: [],
    ports,
    typeDefs: [],
    signals,
    instances,
    combBlocks,
    seqBlocks,
    initialBlocks: [],
    testSeqBlocks: [],
    fsms: [],
    functions: [],
  };

  return hirModule;
}

/**
 * Lower port declaration
 */
function lowerPort(port: PortDecl, ctx: LoweringContext): HirPort {
  const direction = lowerPortDirection(port.direction);
  const dataType = lowerTypeExpr(port.type, ctx);

  return createPort(port.name.name, direction, dataType);
}

/**
 * Lower port direction
 */
function lowerPortDirection(dir: AstPortDirection): HirPortDirection {
  switch (dir) {
    case 'in':
      return 'input';
    case 'out':
      return 'output';
    case 'inout':
      return 'inout';
    default:
      // Handle interface directions as input for now
      return 'input';
  }
}

/**
 * Lower signal declaration
 */
function lowerSignalDecl(sig: SignalDecl, ctx: LoweringContext): HirSignal {
  const dataType = sig.type ? lowerTypeExpr(sig.type, ctx) : createLogicType(1);
  const isReg = sig.declKind === 'var' || sig.mutable;
  const initialValue = sig.init ? lowerExpr(sig.init, ctx) : undefined;

  return createSignal(sig.name.name, dataType, isReg, initialValue);
}

/**
 * Check if a value is an expression (not a type expression)
 */
function isExpr(value: unknown): value is Expr {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }
  const kind = (value as { kind: string }).kind;
  // Expression kinds (not TypeExpr kinds)
  const exprKinds = [
    'IntegerLiteral',
    'BoolLiteral',
    'StringLiteral',
    'CharLiteral',
    'IdentifierExpr',
    'UnaryExpr',
    'BinaryExpr',
    'IndexExpr',
    'SliceExpr',
    'FieldExpr',
    'CallExpr',
    'CastExpr',
    'IfExpr',
    'MatchExpr',
    'BlockExpr',
    'ConcatExpr',
    'RepeatExpr',
    'ArrayExpr',
    'TupleExpr',
    'StructExpr',
    'RangeExpr',
    'PathExpr',
  ];
  return exprKinds.includes(kind);
}

/**
 * Lower instance declaration
 */
function lowerInstDecl(inst: InstDecl, ctx: LoweringContext): HirInstance {
  // Get module name from path
  const moduleName = inst.module.segments.map(s => s.name).join('::');

  // Lower connections
  const connections: HirConnection[] = inst.connections.map((conn: Connection) => ({
    port: conn.port.name,
    expr: lowerExpr(conn.expr, ctx),
  }));

  // Handle generic arguments as parameters (if any)
  const parameters: HirConnection[] = [];
  if (inst.genericArgs) {
    // Generic args can be positional or named
    // For now, we'll handle them as expressions that become parameters
    for (let i = 0; i < inst.genericArgs.args.length; i++) {
      const arg = inst.genericArgs.args[i];
      if (arg && arg.value && 'kind' in arg.value) {
        // Check if value is an Expr (not a TypeExpr)
        const value = arg.value;
        // Expr types have specific kinds like IntegerLiteral, IdentifierExpr, etc.
        if (isExpr(value)) {
          const paramName = arg.name ? arg.name.name : `param${i}`;
          parameters.push({
            port: paramName,
            expr: lowerExpr(value, ctx),
          });
        }
      }
    }
  }

  return createInstance(inst.name.name, moduleName, connections, parameters);
}

/**
 * Lower combinational block
 */
function lowerCombBlock(block: CombBlock, ctx: LoweringContext): HirCombBlock {
  ctx.inSequentialBlock = false;
  const statements = block.body.map((s: Stmt) => lowerStmt(s, ctx));
  return createCombBlock(statements);
}

/**
 * Lower sync block (always_ff)
 */
function lowerSyncBlock(block: SyncBlock, ctx: LoweringContext): HirSeqBlock {
  ctx.inSequentialBlock = true;

  const clock = lowerClockSpec(block.clock, ctx);
  const reset = block.reset ? lowerResetSpec(block.reset, ctx) : undefined;

  // Parse statements to separate reset and normal statements
  const { resetStmts, normalStmts } = extractResetStatements(block.body, reset, ctx);

  const resetStatements = resetStmts.map((s: Stmt) => lowerStmt(s, ctx));
  const statements = normalStmts.map((s: Stmt) => lowerStmt(s, ctx));

  return createSeqBlock(clock, reset, statements, resetStatements);
}

/**
 * Lower clock specification
 */
function lowerClockSpec(spec: ClockSpec, ctx: LoweringContext): HirClockSpec {
  // Extract signal name from expression
  const signalName = extractSignalName(spec.signal, ctx);
  const edge: HirClockEdge = spec.edge;

  return { signal: signalName, edge };
}

/**
 * Lower reset specification
 */
function lowerResetSpec(spec: ResetSpec, ctx: LoweringContext): HirResetSpec {
  const signalName = extractSignalName(spec.signal, ctx);
  const mode: HirResetMode = spec.mode;

  // Determine if reset is active high or low based on naming convention
  // Common patterns: rst_n, reset_n (active low) vs rst, reset (active high)
  const activeHigh = !signalName.endsWith('_n');

  return { signal: signalName, activeHigh, mode };
}

/**
 * Extract signal name from expression
 */
function extractSignalName(expr: Expr, ctx: LoweringContext): string {
  if (expr.kind === 'IdentifierExpr') {
    return expr.name.name;
  }
  ctx.errors.push({
    message: `Expected identifier, got ${expr.kind}`,
    location: undefined,
  });
  return 'unknown';
}

/**
 * Extract reset statements from sync block body
 *
 * This detects the pattern:
 *   if (!rst_n) { reset_stmts } else { normal_stmts }
 */
function extractResetStatements(
  body: Stmt[],
  reset: HirResetSpec | undefined,
  _ctx: LoweringContext
): { resetStmts: Stmt[]; normalStmts: Stmt[] } {
  if (!reset) {
    return { resetStmts: [], normalStmts: body };
  }

  // Look for if statement at top level that checks reset
  const firstStmt = body[0];
  if (body.length === 1 && firstStmt?.kind === 'IfStmt') {
    if (isResetCondition(firstStmt.condition, reset)) {
      return {
        resetStmts: firstStmt.thenBranch,
        normalStmts: Array.isArray(firstStmt.elseBranch) ? firstStmt.elseBranch : [],
      };
    }
  }

  // If no reset pattern detected, return all as normal statements
  return { resetStmts: [], normalStmts: body };
}

/**
 * Check if expression is a reset condition
 */
function isResetCondition(expr: Expr, reset: HirResetSpec): boolean {
  // Check for !rst_n pattern (active low reset)
  if (expr.kind === 'UnaryExpr' && expr.op === '!') {
    if (expr.operand.kind === 'IdentifierExpr') {
      return expr.operand.name.name === reset.signal;
    }
  }
  // Check for rst pattern (active high reset)
  if (expr.kind === 'IdentifierExpr') {
    return expr.name.name === reset.signal;
  }
  return false;
}

/**
 * Lower type expression to HIR data type
 */
export function lowerTypeExpr(type: TypeExpr, ctx: LoweringContext): HirDataType {
  switch (type.kind) {
    case 'PrimitiveType':
      return lowerPrimitiveType(type, ctx);

    case 'ArrayType':
      return lowerArrayType(type, ctx);

    case 'TupleType':
      return lowerTupleType(type, ctx);

    case 'UserType':
    case 'GenericType':
      // For now, treat user types as logic[1]
      ctx.warnings.push({
        message: `User type '${type.kind}' treated as logic[1]`,
        location: undefined,
      });
      return createLogicType(1);

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown type kind: ${(_exhaustive as TypeExpr).kind}`);
    }
  }
}

/**
 * Lower primitive type
 */
function lowerPrimitiveType(type: PrimitiveType, ctx: LoweringContext): HirDataType {
  switch (type.type) {
    case 'bit':
    case 'uint': {
      const width = type.width ? evaluateConstExpr(type.width, ctx) : 1;
      return createLogicType(width, false);
    }

    case 'int': {
      const width = type.width ? evaluateConstExpr(type.width, ctx) : 32;
      return createLogicType(width, true);
    }

    case 'bool':
      return createBoolType();

    case 'clock':
    case 'reset':
      // Clock and reset are 1-bit signals
      return createLogicType(1, false);

    case 'string':
      // String is not synthesizable, treat as placeholder
      ctx.warnings.push({
        message: 'String type is not synthesizable',
        location: undefined,
      });
      return createLogicType(1, false);

    default: {
      const _exhaustive: never = type.type;
      throw new Error(`Unknown primitive type: ${_exhaustive}`);
    }
  }
}

/**
 * Lower array type
 */
function lowerArrayType(type: AstArrayType, ctx: LoweringContext): HirDataType {
  const elementType = lowerTypeExpr(type.elementType, ctx);
  const size = evaluateConstExpr(type.size, ctx);

  return createArrayType(elementType, size);
}

/**
 * Lower tuple type
 */
function lowerTupleType(type: AstTupleType, ctx: LoweringContext): HirDataType {
  const elements = type.elements.map((e: TypeExpr) => lowerTypeExpr(e, ctx));
  return createTupleType(elements);
}

/**
 * Evaluate constant expression to integer
 */
function evaluateConstExpr(expr: Expr, ctx: LoweringContext): number {
  if (expr.kind === 'IntegerLiteral') {
    return Number(expr.value);
  }

  if (expr.kind === 'IdentifierExpr') {
    // TODO: Look up parameter/constant value
    ctx.warnings.push({
      message: `Unable to evaluate '${expr.name.name}', using 1`,
      location: undefined,
    });
    return 1;
  }

  if (expr.kind === 'BinaryExpr') {
    const left = evaluateConstExpr(expr.left, ctx);
    const right = evaluateConstExpr(expr.right, ctx);

    switch (expr.op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return Math.floor(left / right);
      default:
        ctx.errors.push({
          message: `Cannot evaluate binary op '${expr.op}' at compile time`,
          location: undefined,
        });
        return 1;
    }
  }

  ctx.errors.push({
    message: `Cannot evaluate expression kind '${expr.kind}' at compile time`,
    location: undefined,
  });
  return 1;
}

/**
 * Lower expression to HIR expression
 */
export function lowerExpr(expr: Expr, ctx: LoweringContext): HirExpr {
  switch (expr.kind) {
    case 'IntegerLiteral':
      return lowerIntegerLiteral(expr);

    case 'BoolLiteral':
      return lowerBoolLiteral(expr);

    case 'StringLiteral':
      ctx.warnings.push({
        message: 'String literal not supported in synthesis',
        location: undefined,
      });
      return createIntegerLiteral(0n);

    case 'IdentifierExpr':
      return createHirIdentifier(expr.name.name);

    case 'PathExpr':
      // Convert path to identifier (for enum variants, etc.)
      return createHirIdentifier(
        expr.path.segments.map((s) => s.name).join('::')
      );

    case 'UnaryExpr':
      return lowerUnaryExpr(expr, ctx);

    case 'BinaryExpr':
      return lowerBinaryExpr(expr, ctx);

    case 'IndexExpr':
      return lowerIndexExpr(expr, ctx);

    case 'FieldExpr':
      return lowerFieldExpr(expr, ctx);

    case 'ConcatExpr':
      return lowerConcatExpr(expr, ctx);

    case 'RepeatExpr':
      return lowerRepeatExpr(expr, ctx);

    case 'ParenExpr':
      return lowerExpr(expr.expr, ctx);

    case 'CallExpr':
      return lowerCallExpr(expr, ctx);

    case 'CastExpr':
      return lowerCastExpr(expr, ctx);

    case 'IfExpr':
      return lowerIfExpr(expr, ctx);

    case 'MatchExpr':
      // TODO: Implement match expression lowering
      ctx.errors.push({
        message: 'Match expression not yet supported',
        location: undefined,
      });
      return createIntegerLiteral(0n);

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unknown expression kind: ${(_exhaustive as Expr).kind}`);
    }
  }
}

/**
 * Lower integer literal
 */
function lowerIntegerLiteral(lit: IntegerLiteral): HirExpr {
  return createIntegerLiteral(lit.value, lit.width, false);
}

/**
 * Lower boolean literal
 */
function lowerBoolLiteral(lit: BoolLiteral): HirExpr {
  return createBoolLiteral(lit.value);
}

/**
 * Lower unary expression
 */
function lowerUnaryExpr(expr: UnaryExpr, ctx: LoweringContext): HirExpr {
  const operand = lowerExpr(expr.operand, ctx);
  const op = lowerUnaryOp(expr.op);
  return createUnaryExpr(op, operand);
}

/**
 * Lower unary operator
 */
function lowerUnaryOp(op: UnaryOp): HirUnaryOp {
  switch (op) {
    case '!':
      return 'not';
    case '~':
      return 'bitnot';
    case '-':
      return 'neg';
    case '&':
      return 'and_reduce';
    case '|':
      return 'or_reduce';
    case '^':
      return 'xor_reduce';
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown unary op: ${_exhaustive}`);
    }
  }
}

/**
 * Lower binary expression
 */
function lowerBinaryExpr(expr: BinaryExpr, ctx: LoweringContext): HirExpr {
  const left = lowerExpr(expr.left, ctx);
  const right = lowerExpr(expr.right, ctx);
  const op = lowerBinaryOp(expr.op);
  return createBinaryExpr(op, left, right);
}

/**
 * Lower binary operator
 */
function lowerBinaryOp(op: BinaryOp): HirBinaryOp {
  switch (op) {
    case '+':
      return 'add';
    case '-':
      return 'sub';
    case '*':
      return 'mul';
    case '/':
      return 'div';
    case '%':
      return 'mod';
    case '**':
      // Power operator - not directly supported, would need expansion
      return 'mul'; // Placeholder
    case '&':
      return 'and';
    case '|':
      return 'or';
    case '^':
      return 'xor';
    case '<<':
      return 'shl';
    case '>>':
      return 'shr';
    case '>>>':
      return 'ashr';
    case '==':
      return 'eq';
    case '!=':
      return 'ne';
    case '<':
      return 'lt';
    case '<=':
      return 'le';
    case '>':
      return 'gt';
    case '>=':
      return 'ge';
    case '&&':
      return 'land';
    case '||':
      return 'lor';
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown binary op: ${_exhaustive}`);
    }
  }
}

/**
 * Lower index expression
 */
function lowerIndexExpr(expr: IndexExpr, ctx: LoweringContext): HirExpr {
  const base = lowerExpr(expr.base, ctx);
  const index = lowerExpr(expr.index, ctx);

  if (expr.endIndex) {
    // Slice expression
    const high = index;
    const low = lowerExpr(expr.endIndex, ctx);
    return createSliceExpr(base, high, low);
  }

  return createIndexExpr(base, index);
}

/**
 * Lower field expression
 */
function lowerFieldExpr(expr: FieldExpr, ctx: LoweringContext): HirExpr {
  const base = lowerExpr(expr.base, ctx);
  return createFieldExpr(base, expr.field.name);
}

/**
 * Lower concatenation expression
 */
function lowerConcatExpr(expr: ConcatExpr, ctx: LoweringContext): HirExpr {
  const elements = expr.elements.map((e: Expr) => lowerExpr(e, ctx));
  return createConcatExpr(elements);
}

/**
 * Lower repeat expression
 */
function lowerRepeatExpr(expr: RepeatExpr, ctx: LoweringContext): HirExpr {
  const inner = lowerExpr(expr.expr, ctx);
  const count = evaluateConstExpr(expr.count, ctx);
  return createRepeatExpr(inner, count);
}

/**
 * Lower call expression
 */
function lowerCallExpr(expr: CallExpr, ctx: LoweringContext): HirExpr {
  // Extract function name
  let callee: string;
  if (expr.callee.kind === 'IdentifierExpr') {
    callee = expr.callee.name.name;
  } else if (expr.callee.kind === 'PathExpr') {
    callee = expr.callee.path.segments.map((s) => s.name).join('::');
  } else {
    ctx.errors.push({
      message: `Unsupported callee type: ${expr.callee.kind}`,
      location: undefined,
    });
    callee = 'unknown';
  }

  const args = expr.args.map((a: Expr) => lowerExpr(a, ctx));
  return createCallExpr(callee, args);
}

/**
 * Lower cast expression
 */
function lowerCastExpr(expr: CastExpr, ctx: LoweringContext): HirExpr {
  const inner = lowerExpr(expr.expr, ctx);
  const targetType = lowerTypeExpr(expr.targetType, ctx);
  return createCastExpr(inner, targetType);
}

/**
 * Lower if expression (ternary)
 */
function lowerIfExpr(expr: IfExpr, ctx: LoweringContext): HirExpr {
  const condition = lowerExpr(expr.condition, ctx);
  const thenExpr = lowerExpr(expr.thenExpr, ctx);
  const elseExpr = lowerExpr(expr.elseExpr, ctx);
  return createConditionalExpr(condition, thenExpr, elseExpr);
}

/**
 * Lower statement to HIR statement
 */
export function lowerStmt(stmt: Stmt, ctx: LoweringContext): HirStmt {
  switch (stmt.kind) {
    case 'LetStmt':
    case 'VarStmt':
      return lowerLetOrVarStmt(stmt, ctx);

    case 'ConstStmt':
      // Const statements become variable declarations in HIR
      return createVarDeclStmt(
        stmt.name.name,
        lowerTypeExpr(stmt.type, ctx),
        lowerExpr(stmt.init, ctx)
      );

    case 'AssignStmt':
      return lowerAssignStmt(stmt, ctx);

    case 'IfStmt':
      return lowerIfStmt(stmt, ctx);

    case 'ForStmt':
      return lowerForStmt(stmt, ctx);

    case 'MatchStmt':
      return lowerMatchStmt(stmt, ctx);

    case 'WhileStmt':
      // While is not synthesizable
      ctx.errors.push({
        message: 'While statement not supported in synthesis',
        location: undefined,
      });
      return createBlockStmt([]);

    case 'ReturnStmt':
      // TODO: Implement return for functions
      ctx.errors.push({
        message: 'Return statement not yet supported',
        location: undefined,
      });
      return createBlockStmt([]);

    case 'BlockStmt':
      return lowerBlockStmt(stmt, ctx);

    case 'ExprStmt':
      // Expression statements (like function calls) need special handling
      return createExprStmt(lowerExpr(stmt.expr, ctx));

    default: {
      const _exhaustive: never = stmt;
      throw new Error(`Unknown statement kind: ${(_exhaustive as Stmt).kind}`);
    }
  }
}

/**
 * Lower let or var statement
 */
function lowerLetOrVarStmt(stmt: LetStmt | VarStmt, ctx: LoweringContext): HirStmt {
  const dataType = stmt.type ? lowerTypeExpr(stmt.type, ctx) : createLogicType(1);
  const init = stmt.init ? lowerExpr(stmt.init, ctx) : undefined;
  return createVarDeclStmt(stmt.name.name, dataType, init);
}

/**
 * Lower assignment statement
 */
function lowerAssignStmt(stmt: AssignStmt, ctx: LoweringContext): HirStmt {
  const lvalue = lowerLValue(stmt.lvalue, ctx);
  const value = lowerExpr(stmt.value, ctx);

  if (ctx.inSequentialBlock) {
    return createNonblockingAssignStmt(lvalue, value);
  }
  return createAssignStmt(lvalue, value);
}

/**
 * Lower L-value
 */
function lowerLValue(lvalue: LValue, ctx: LoweringContext): HirLValue {
  switch (lvalue.kind) {
    case 'IdentifierLValue':
      return createIdentifierLValue(lvalue.name.name);

    case 'IndexLValue': {
      const base = lowerLValue(lvalue.base, ctx);
      const index = lowerExpr(lvalue.index, ctx);

      if (lvalue.endIndex) {
        const high = index;
        const low = lowerExpr(lvalue.endIndex, ctx);
        return createSliceLValue(base, high, low);
      }
      return createIndexLValue(base, index);
    }

    case 'FieldLValue': {
      const base = lowerLValue(lvalue.base, ctx);
      return createFieldLValue(base, lvalue.field.name);
    }

    case 'ConcatLValue': {
      const elements = lvalue.elements.map((e: LValue) => lowerLValue(e, ctx));
      return createConcatLValue(elements);
    }

    default: {
      const _exhaustive: never = lvalue;
      throw new Error(`Unknown lvalue kind: ${(_exhaustive as LValue).kind}`);
    }
  }
}

/**
 * Lower if statement
 */
function lowerIfStmt(stmt: IfStmt, ctx: LoweringContext): HirIfStmt {
  const condition = lowerExpr(stmt.condition, ctx);
  const thenBranch = stmt.thenBranch.map((s: Stmt) => lowerStmt(s, ctx));

  let elseBranch: HirStmt[] | HirIfStmt | undefined;
  if (stmt.elseBranch) {
    if (Array.isArray(stmt.elseBranch)) {
      elseBranch = stmt.elseBranch.map((s: Stmt) => lowerStmt(s, ctx));
    } else {
      // else if chain
      elseBranch = lowerIfStmt(stmt.elseBranch, ctx);
    }
  }

  return createIfStmt(condition, thenBranch, elseBranch);
}

/**
 * Lower for statement
 */
function lowerForStmt(stmt: ForStmt, ctx: LoweringContext): HirStmt {
  const start = lowerExpr(stmt.start, ctx);
  const end = lowerExpr(stmt.end, ctx);
  const body = stmt.body.map((s: Stmt) => lowerStmt(s, ctx));

  return createForStmt(stmt.variable.name, start, end, stmt.inclusive, body);
}

/**
 * Lower match statement to case statement
 */
function lowerMatchStmt(stmt: MatchStmt, ctx: LoweringContext): HirStmt {
  // Convert match to case statement
  const scrutinee = lowerExpr(stmt.scrutinee, ctx);

  const items: { patterns: HirExpr[]; body: HirStmt[] }[] = [];
  let defaultCase: { body: HirStmt[] } | undefined = undefined;

  for (const arm of stmt.arms) {
    const body = Array.isArray(arm.body)
      ? arm.body.map((s: Stmt) => lowerStmt(s, ctx))
      : []; // Expression bodies need conversion

    // WildcardPattern becomes the default case
    if (arm.pattern.kind === 'WildcardPattern') {
      defaultCase = { body };
    } else {
      const patterns = [lowerPattern(arm.pattern, ctx)];
      items.push({ patterns, body });
    }
  }

  return {
    kind: 'CaseStmt' as const,
    scrutinee,
    items,
    defaultCase,
    style: 'normal' as const,
  };
}

/**
 * Lower pattern to expression (for case labels)
 */
function lowerPattern(pattern: Pattern, ctx: LoweringContext): HirExpr {
  switch (pattern.kind) {
    case 'LiteralPattern':
      if (pattern.literal.kind === 'IntegerLiteral') {
        return createIntegerLiteral(pattern.literal.value);
      }
      if (pattern.literal.kind === 'BoolLiteral') {
        return createBoolLiteral(pattern.literal.value);
      }
      return createIntegerLiteral(0n);

    case 'IdentifierPattern':
      return createHirIdentifier(pattern.name.name);

    case 'PathPattern':
      return createHirIdentifier(pattern.path.segments.map((s) => s.name).join('::'));

    default:
      ctx.errors.push({
        message: `Pattern kind '${pattern.kind}' not yet supported`,
        location: undefined,
      });
      return createIntegerLiteral(0n);
  }
}

/**
 * Lower block statement
 */
function lowerBlockStmt(stmt: BlockStmt, ctx: LoweringContext): HirStmt {
  const statements = stmt.statements.map((s: Stmt) => lowerStmt(s, ctx));
  return createBlockStmt(statements);
}

/**
 * Lowering class for convenience
 */
export class Lowering {
  private context: LoweringContext;

  constructor() {
    this.context = createLoweringContext();
  }

  /**
   * Lower a source file
   */
  lower(ast: SourceFile): LoweringResult {
    this.context = createLoweringContext();
    return lowerSourceFile(ast, this.context);
  }

  /**
   * Lower a single module
   */
  lowerModule(mod: ModDef): HirModule {
    return lowerModule(mod, this.context);
  }

  /**
   * Get errors from last lowering
   */
  get errors(): LoweringError[] {
    return this.context.errors;
  }

  /**
   * Get warnings from last lowering
   */
  get warnings(): LoweringWarning[] {
    return this.context.warnings;
  }
}

/**
 * Create a new Lowering instance
 */
export function createLowering(): Lowering {
  return new Lowering();
}
