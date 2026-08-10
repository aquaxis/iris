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
  MatchExpr,
  MemDecl,
  GenericParam,
  GenericParams,
  PortDecl,
  PortDirection as AstPortDirection,
  SignalDecl,
  MatchArm,
  EnumDef,
  StructDef,
  UnionDef,
  InterfaceDef,
  TestModDef,
  FnDef,
  FsmBlock,
  FsmStateItem,
  TransitionItem,
  TransitionAction,
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
  HirCaseItem,
  HirTypeDef,
  HirEnumDef,
  HirStructDef,
  HirUnionDef,
  HirInterface,
  HirInitialBlock,
  HirFunction,
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
  HirParameter,
  HirWidth,
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
  createCaseStmt,
} from '@iris2sv/core';

/**
 * Lowering context for tracking state during transformation
 */
export interface LoweringContext {
  /** Current module name being processed */
  currentModule: string | undefined;
  /** Whether we're in a sequential block (use non-blocking assignments) */
  inSequentialBlock: boolean;
  /** Whether we're inside a function body, where `return` is meaningful */
  inFunction?: boolean;
  /**
   * Names of the enums declared in this file.
   *
   * SystemVerilog puts the members of a `typedef enum` in the enclosing scope,
   * so `Op::Add` has to be written `Add`. Emitting the qualified form produced
   * something no tool accepted: Verilator failed with an internal fault.
   */
  enumNames?: Set<string>;
  /** The lowered type of each enum, so a signal of that type gets its width. */
  enumTypes?: Map<string, HirDataType>;
  /** Errors collected during lowering */
  errors: LoweringError[];
  /** Warnings collected during lowering */
  warnings: LoweringWarning[];
  /**
   * Declared data type of each name in the current module.
   *
   * IRIS evaluates arithmetic in the width of its operands, so an expression's
   * width has to be known to convert it faithfully.
   */
  scope?: Map<string, HirDataType>;
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
  const typeDefs: HirTypeDef[] = [];
  const functions: HirFunction[] = [];
  const interfaces: HirInterface[] = [];

  // Gathered first: a module may refer to an enum declared after it.
  context.enumNames = new Set(
    ast.items.filter((i) => i.kind === 'EnumDef').map((i) => (i as EnumDef).name.name)
  );
  context.enumTypes = new Map();
  for (const item of ast.items) {
    if (item.kind === 'EnumDef') {
      const lowered = lowerEnumDef(item, context);
      context.enumTypes.set(lowered.name, lowered.type);
    }
  }

  for (const item of ast.items) {
    switch (item.kind) {
      case 'ModDef':
        modules.push(lowerModule(item, context));
        break;

      // `enum`, `struct` and `fn` all have a direct SystemVerilog spelling, and
      // the representation and the backend already carried them. Only the step
      // from the syntax tree was missing, so a file declaring any of them
      // converted to nothing but a diagnostic.
      case 'EnumDef':
        typeDefs.push(lowerEnumDef(item, context));
        break;
      case 'StructDef':
        typeDefs.push(lowerStructDef(item, context));
        break;
      case 'UnionDef':
        typeDefs.push(lowerUnionDef(item, context));
        break;
      case 'InterfaceDef':
        interfaces.push(lowerInterfaceDef(item, context));
        break;
      case 'TestModDef':
        modules.push(lowerTestModDef(item, context));
        break;
      case 'FnDef':
        functions.push(lowerFnDef(item, context));
        break;

      // An extern module is implemented outside IRIS. SystemVerilog resolves a
      // module by name at elaboration, so the correct conversion declares
      // nothing and leaves the instances that refer to it untouched. This is
      // not a construct being dropped; there is nothing to emit.
      case 'ExternModDef':
        break;

      // `package demo;` names the file. SystemVerilog packages hold types,
      // functions and parameters but not modules, so the name has no home
      // there; the items it collected are converted at file level. The parser
      // gathers everything after the declaration into `items`, so this is where
      // the whole rest of such a file arrives.
      case 'PackageDecl': {
        const inner = lowerSourceFile(
          { kind: 'SourceFile', items: item.items, span: item.span },
          context
        );
        modules.push(...inner.hir.modules);
        typeDefs.push(...inner.hir.typeDefs);
        functions.push(...inner.hir.functions);
        interfaces.push(...inner.hir.interfaces);
        context.warnings.push({
          message:
            `package '${item.path.segments.map((seg) => seg.name).join('::')}' has no ` +
            'SystemVerilog counterpart holding modules; its items were converted at file level',
          location: undefined,
        });
        break;
      }

      default:
        // Reported rather than skipped: a file must never convert to less than
        // it says without saying so.
        context.errors.push({
          message: `Top-level '${item.kind}' is not supported and was not converted`,
          location: undefined,
        });
        break;
    }
  }

  return {
    hir: createHirSourceFile(modules, typeDefs, functions, interfaces),
    errors: context.errors,
    warnings: context.warnings,
  };
}

/**
 * Lower an enum to a SystemVerilog `typedef enum`.
 *
 * A variant without an explicit value takes the next one up from the last, as
 * both languages do.
 */
function lowerEnumDef(def: EnumDef, ctx: LoweringContext): HirEnumDef {
  let next = 0;
  const variants = def.variants.map((variant) => {
    const value =
      variant.value !== undefined ? constantValueOf(variant.value, ctx) ?? next : next;
    next = value + 1;
    return { name: variant.name.name, value };
  });

  // Wide enough to hold the largest value the enum can take.
  const highest = variants.reduce((max, v) => Math.max(max, v.value), 0);
  const width = Math.max(1, Math.ceil(Math.log2(highest + 1)));

  return {
    kind: 'HirEnumDef',
    name: def.name.name,
    type: {
      kind: 'EnumType',
      name: def.name.name,
      variants,
      width: { kind: 'ConstWidth', value: width },
    },
  };
}

/** Lower a struct to a SystemVerilog `typedef struct packed`. */
function lowerStructDef(def: StructDef, ctx: LoweringContext): HirStructDef {
  return {
    kind: 'HirStructDef',
    name: def.name.name,
    fields: def.fields.map((field) => ({
      name: field.name.name,
      type: lowerTypeExpr(field.type, ctx),
    })),
  };
}

/**
 * Lower a `test` module to a SystemVerilog testbench module.
 *
 * A testbench is a module with no ports: signals, the instance under test, and
 * `initial` blocks that drive it. Everything it needs already existed in the
 * representation and in the backend — `isTestbench`, `initialBlocks` and
 * `testSeqBlocks` were all there, and the module transformer emitted them.
 * Only the step from the syntax tree was missing, so all five testbenches in
 * the repository converted to one diagnostic.
 */
function lowerTestModDef(def: TestModDef, ctx: LoweringContext): HirModule {
  const outerScope = ctx.scope;
  const scope = new Map<string, HirDataType>();
  for (const item of def.items) {
    if (item.kind === 'SignalDecl') {
      scope.set(item.name.name, item.type ? lowerTypeExpr(item.type, ctx) : createLogicType(1));
    }
  }
  ctx.scope = scope;

  const signals: HirSignal[] = [];
  const instances: HirInstance[] = [];
  const combBlocks: HirCombBlock[] = [];
  const seqBlocks: HirSeqBlock[] = [];
  const initialBlocks: HirInitialBlock[] = [];
  const clockDrivers: { signal: string; halfPeriod: number }[] = [];

  for (const item of def.items) {
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
      case 'InitialBlock':
        initialBlocks.push({
          kind: 'HirInitialBlock',
          statements: item.body.map((stmt: Stmt) => lowerStmt(stmt, ctx)),
        });
        break;
      default:
        // A `seq` block runs Rust, and the verification vocabulary around it
        // has no SystemVerilog spelling this pass can produce. Reported rather
        // than skipped.
        ctx.errors.push({
          message: `'${item.kind}' in a test module was not converted`,
          location: undefined,
        });
        break;
    }
  }

  if (outerScope === undefined) {
    delete (ctx as { scope?: Map<string, HirDataType> }).scope;
  } else {
    ctx.scope = outerScope;
  }

  // A `clock(period: 10ns)` declaration in a test module is a clock generator:
  // the simulator drives it. SystemVerilog has to be told to. Emitting only
  // `logic clk;` produced a testbench that built, ran, and ended at 0s.
  for (const item of def.items) {
    if (item.kind !== 'SignalDecl' || item.type?.kind !== 'PrimitiveType') continue;

    if (item.type.type === 'clock') {
      const half = halfPeriodOf(item.type, ctx, item.name.name);
      initialBlocks.push({
        kind: 'HirInitialBlock',
        statements: [
          createAssignStmt(createIdentifierLValue(item.name.name), createIntegerLiteral(0n, 1)),
        ],
      });
      clockDrivers.push({ signal: item.name.name, halfPeriod: half });
    } else if (item.type.type === 'reset') {
      // A reset is asserted at time zero and released after a few edges, which
      // is what the simulator does for it.
      const activeLow = (item.type.attrs ?? []).some(
        (a) => a.name.name === 'active_low' && a.value.kind === 'BoolLiteral' && a.value.value
      );
      initialBlocks.push({
        kind: 'HirInitialBlock',
        statements: [
          createAssignStmt(
            createIdentifierLValue(item.name.name),
            createIntegerLiteral(activeLow ? 0n : 1n, 1)
          ),
          { kind: 'DelayStmt', delay: 20 },
          createAssignStmt(
            createIdentifierLValue(item.name.name),
            createIntegerLiteral(activeLow ? 1n : 0n, 1)
          ),
        ],
      });
    }
  }

  return {
    kind: 'HirModule',
    name: def.name.name,
    isPublic: def.visibility === 'public',
    isTestbench: true,
    clockDrivers,
    parameters: [],
    ports: [],
    typeDefs: [],
    signals,
    instances,
    combBlocks,
    seqBlocks,
    initialBlocks,
    testSeqBlocks: [],
    fsms: [],
    functions: [],
  };
}

/**
 * Half the period of a clock, in the simulation's time unit.
 *
 * `clock(period: 10ns)` toggles every 5. Without a stated period the clock has
 * no rate to carry, and a default is invented rather than the design silently
 * standing still.
 */
function halfPeriodOf(
  type: { attrs?: { name: { name: string }; value: Expr }[] | undefined },
  ctx: LoweringContext,
  name: string
): number {
  const period = (type.attrs ?? []).find((a) => a.name.name === 'period');
  if (period && period.value.kind === 'IntegerLiteral') {
    return Math.max(1, Math.floor(Number(period.value.value) / 2));
  }
  ctx.warnings.push({
    message: `clock '${name}' has no period; the testbench toggles it every 5 time units`,
    location: undefined,
  });
  return 5;
}

/**
 * Lower an interface and its views to a SystemVerilog `interface` with
 * `modport`s.
 *
 * The two languages say the same thing here, so nothing is lost. An interface
 * that extends another carries a note rather than a silent partial result: the
 * inherited signals live in the other declaration and are not copied in.
 */
function lowerInterfaceDef(def: InterfaceDef, ctx: LoweringContext): HirInterface {
  const signals = def.signals.map((signal) =>
    createSignal(signal.name.name, lowerTypeExpr(signal.type, ctx), false)
  );

  const modports = def.views.map((view) => ({
    name: view.name.name,
    signals: view.signals.map((s) => ({
      name: s.name.name,
      direction:
        s.direction === 'in'
          ? ('input' as const)
          : s.direction === 'out'
            ? ('output' as const)
            : ('inout' as const),
    })),
  }));

  if (def.extends) {
    ctx.warnings.push({
      message:
        `interface '${def.name.name}' extends '${def.extends.name}'. SystemVerilog ` +
        'has no interface inheritance, so the inherited signals were not copied in',
      location: undefined,
    });
  }

  return {
    kind: 'HirInterface',
    name: def.name.name,
    signals,
    modports,
  };
}

/** Lower a union to a SystemVerilog `typedef union packed`. */
function lowerUnionDef(def: UnionDef, ctx: LoweringContext): HirUnionDef {
  return {
    kind: 'HirUnionDef',
    name: def.name.name,
    fields: def.fields.map((field) => ({
      name: field.name.name,
      type: lowerTypeExpr(field.type, ctx),
    })),
  };
}

/** Lower a function to a SystemVerilog `function`. */
function lowerFnDef(def: FnDef, ctx: LoweringContext): HirFunction {
  const outer = ctx.scope;
  const scope = new Map(outer ?? []);
  for (const param of def.params) {
    scope.set(param.name.name, lowerTypeExpr(param.type, ctx));
  }
  ctx.scope = scope;

  ctx.inFunction = true;
  const body = def.body.map((stmt: Stmt) => lowerStmt(stmt, ctx));
  ctx.inFunction = false;
  if (outer === undefined) {
    delete (ctx as { scope?: Map<string, HirDataType> }).scope;
  } else {
    ctx.scope = outer;
  }

  return {
    kind: 'HirFunction',
    name: def.name.name,
    params: def.params.map((param) => ({
      name: param.name.name,
      dataType: lowerTypeExpr(param.type, ctx),
    })),
    returnType: def.returnType ? lowerTypeExpr(def.returnType, ctx) : createLogicType(1),
    body,
  };
}

/** Value of a constant expression, or undefined when it is not one. */
function constantValueOf(expr: Expr, ctx: LoweringContext): number | undefined {
  void ctx;
  if (expr.kind === 'IntegerLiteral') {
    return Number(expr.value);
  }
  return undefined;
}

/**
 * Lower module definition to HIR
 */
export function lowerModule(mod: ModDef, ctx: LoweringContext): HirModule {
  ctx.currentModule = mod.name.name;

  // Lower parameters and ports
  const hirParams = lowerGenericParams(mod.genericParams, ctx);
  const ports: HirPort[] = mod.ports.map((p: PortDecl) => lowerPort(p, ctx));

  // Record declared types first: a block may name a signal declared below it.
  const scope = new Map<string, HirDataType>();
  for (const param of hirParams) {
    scope.set(param.name, param.dataType);
  }
  for (const port of ports) {
    scope.set(port.name, port.dataType);
  }
  for (const item of mod.items) {
    if (item.kind === 'SignalDecl') {
      scope.set(item.name.name, item.type ? lowerTypeExpr(item.type, ctx) : createLogicType(1));
    } else if (item.kind === 'MemDecl') {
      scope.set(item.name.name, lowerTypeExpr(item.elementType, ctx));
    }
  }
  ctx.scope = scope;

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
      case 'MemDecl':
        signals.push(lowerMemDecl(item, ctx));
        break;
      case 'FsmBlock':
        lowerFsmBlock(item, ctx, signals, combBlocks, seqBlocks);
        break;
      default:
        // Nothing is dropped in silence: an item this pass cannot lower is
        // reported, so a design never converts to less than it says.
        ctx.errors.push({
          message: `'${item.kind}' is not supported and was not converted`,
          location: undefined,
        });
        break;
    }
  }

  // Create the module
  const hirModule: HirModule = {
    kind: 'HirModule',
    name: mod.name.name,
    isPublic: mod.visibility === 'public',
    isTestbench: false,
    parameters: hirParams,
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
    case 'GenericType': {
      // A signal whose type is an enum takes the enum's own type, so it is as
      // wide as the enum needs. Falling back to `logic[1]` made a three-state
      // enum one bit wide, and every comparison against it mismatched.
      const name =
        type.kind === 'UserType'
          ? type.path.segments.map((seg) => seg.name).join('::')
          : type.path.segments.map((seg) => seg.name).join('::');
      const enumType = ctx.enumTypes?.get(name);
      if (enumType) {
        return enumType;
      }

      ctx.warnings.push({
        message: `User type '${name}' treated as logic[1]`,
        location: undefined,
      });
      return createLogicType(1);
    }

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
      const width = type.width ? lowerWidth(type.width, ctx) : constWidth(1);
      return { kind: 'LogicType', width, signed: false };
    }

    case 'int': {
      const width = type.width ? lowerWidth(type.width, ctx) : constWidth(32);
      return { kind: 'LogicType', width, signed: true };
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
  const size = lowerWidth(type.size, ctx);

  return { kind: 'ArrayType', elementType, size };
}

/**
 * Lower a memory declaration to an unpacked array signal.
 */
function lowerMemDecl(mem: MemDecl, ctx: LoweringContext): HirSignal {
  if (mem.config && mem.config.length > 0) {
    ctx.warnings.push({
      message: `Memory attributes on '${mem.name.name}' are not converted`,
      location: undefined,
    });
  }
  if (mem.init) {
    ctx.warnings.push({
      message: `Memory initialiser on '${mem.name.name}' is not converted`,
      location: undefined,
    });
  }

  const elementType = lowerTypeExpr(mem.elementType, ctx);
  const size = lowerWidth(mem.depth, ctx);

  return createSignal(mem.name.name, { kind: 'ArrayType', elementType, size }, true);
}

/**
 * Lower generic parameters to SystemVerilog module parameters.
 *
 * A parameter with no default still becomes a parameter; SystemVerilog requires
 * some value, so it gets 0 and the omission is reported.
 */
function lowerGenericParams(
  params: GenericParams | undefined,
  ctx: LoweringContext
): HirParameter[] {
  if (!params) {
    return [];
  }

  return params.params.map((p: GenericParam) => {
    if (p.bound.kind === 'TypeBound') {
      ctx.errors.push({
        message: `Type parameter '${p.name.name}' is not supported`,
        location: undefined,
      });
    }

    const signed = p.bound.kind === 'IntBound';
    const dataType: HirDataType = { kind: 'LogicType', width: constWidth(32), signed };

    let defaultValue: HirExpr | undefined;
    if (p.defaultValue) {
      defaultValue = lowerExpr(p.defaultValue, ctx);
    } else {
      ctx.warnings.push({
        message: `Parameter '${p.name.name}' has no default; using 0`,
        location: undefined,
      });
      defaultValue = createIntegerLiteral(0n);
    }

    return { kind: 'HirParameter' as const, name: p.name.name, dataType, defaultValue };
  });
}

/**
 * Lower a width or array-size expression, keeping it symbolic.
 *
 * A width written in terms of a generic parameter must stay a parameter in the
 * output: collapsing `bit[DataWidth]` to a number would silently produce a
 * one-bit port.
 */
function lowerWidth(expr: Expr, ctx: LoweringContext): HirWidth {
  if (expr.kind === 'IntegerLiteral') {
    return constWidth(Number(expr.value));
  }
  if (expr.kind === 'IdentifierExpr') {
    return { kind: 'ParamWidth', param: expr.name.name };
  }
  if (expr.kind === 'ParenExpr') {
    return lowerWidth(expr.expr, ctx);
  }
  return { kind: 'ExprWidth', expr: lowerExpr(expr, ctx) };
}

function constWidth(value: number): HirWidth {
  return { kind: 'ConstWidth', value };
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
      // A string is not synthesizable on its own, but `$display("...")` takes
      // one. Lowering it to 0 turned every message into a zero.
      return { kind: 'StringLiteral', value: expr.value, dataType: undefined };

    case 'IdentifierExpr': {
      const name = expr.name.name;
      return { kind: 'Identifier', name, dataType: ctx.scope?.get(name) };
    }

    case 'PathExpr':
      return createHirIdentifier(pathToName(expr.path.segments.map((s) => s.name), ctx));

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
      return lowerMatchExpr(expr, ctx);

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

  // The result of an arithmetic or bitwise operation is as wide as its
  // operands. Comparisons yield one bit and are left untyped here.
  const dataType = WIDTH_PRESERVING_OPS.has(op)
    ? (left.dataType ?? right.dataType)
    : undefined;

  return { kind: 'BinaryExpr', op, left, right, dataType };
}

/** Operators whose result takes the width of their operands. */
const WIDTH_PRESERVING_OPS = new Set<HirBinaryOp>([
  'add', 'sub', 'mul', 'div', 'mod', 'shl', 'shr', 'and', 'or', 'xor',
]);

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
    return createSliceExpr(base, high, low, expr.partSelect);
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
 * Lower a match expression to a chain of conditional expressions.
 *
 * SystemVerilog has no expression-level `case`, so
 *
 *   match sel { A => x, B => y, _ => z }
 *
 * becomes `(sel == A) ? x : ((sel == B) ? y : z)`.
 *
 * The arms are folded from the last to the first, so the written order is the
 * order they are tested in — which is what `match` means.
 *
 * A wildcard or bare-identifier arm is the default. Without one there is no
 * value to fall back on, so a zero is used and the omission reported: a match
 * that does not cover its scrutinee has no defined result.
 */
function lowerMatchExpr(expr: MatchExpr, ctx: LoweringContext): HirExpr {
  const scrutinee = lowerExpr(expr.scrutinee, ctx);

  let fallback: HirExpr | undefined;
  const guarded: { test: HirExpr; value: HirExpr }[] = [];

  for (const arm of expr.arms) {
    // An expression arm parses as a one-statement block holding that
    // expression, so unwrap it before giving up on the arm.
    let body: Expr | undefined;
    if (!Array.isArray(arm.body)) {
      body = arm.body;
    } else if (arm.body.length === 1 && arm.body[0]!.kind === 'ExprStmt') {
      body = (arm.body[0] as unknown as { expr: Expr }).expr;
    }

    if (body === undefined) {
      ctx.errors.push({
        message: 'A match expression arm must be an expression, not a block',
        location: undefined,
      });
      continue;
    }
    const value = lowerExpr(body, ctx);

    if (arm.pattern.kind === 'WildcardPattern' || arm.pattern.kind === 'IdentifierPattern') {
      // The default arm. A later one cannot be reached, so the first wins.
      if (fallback === undefined) {
        fallback = value;
      }
      continue;
    }

    // An enum variant is written as a path, `Op::Add`. The statement form
    // already handled it through `lowerPattern`; the expression form only
    // accepted literals, so matching on an enum failed here alone.
    if (arm.pattern.kind !== 'LiteralPattern' && arm.pattern.kind !== 'PathPattern') {
      ctx.errors.push({
        message: `Pattern '${arm.pattern.kind}' is not supported in a match expression`,
        location: undefined,
      });
      continue;
    }

    const literal =
      arm.pattern.kind === 'PathPattern'
        ? lowerPattern(arm.pattern, ctx)
        : lowerExpr(arm.pattern.literal, ctx);
    guarded.push({
      test: { kind: 'BinaryExpr', op: 'eq', left: scrutinee, right: literal, dataType: undefined },
      value,
    });
  }

  if (fallback === undefined) {
    // Listing every value is exhaustive too, so a match naming all the variants
    // of an enum needs no `_` arm. Anything short of that is a real gap: the
    // reference rejects `match op { 2'd0 => .., 2'd1 => .. }` on a `bit[2]` as
    // covering 2 of 4 values, and so does this.
    if (coversEveryVariant(expr.arms, ctx)) {
      const last = guarded.pop();
      fallback = last ? last.value : createIntegerLiteral(0n);
    } else {
      ctx.errors.push({
        message: 'A match expression needs a `_` arm; without one its value is undefined',
        location: undefined,
      });
      fallback = createIntegerLiteral(0n);
    }
  }

  let result = fallback;
  for (let i = guarded.length - 1; i >= 0; i--) {
    const arm = guarded[i]!;
    result = {
      kind: 'ConditionalExpr',
      condition: arm.test,
      thenExpr: arm.value,
      elseExpr: result,
      dataType: arm.value.dataType,
    };
  }
  return result;
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
  } else if (
    expr.callee.kind === 'IndexExpr' &&
    expr.callee.base.kind === 'FieldExpr'
  ) {
    // A width-carrying method: `x.sign_extend[32]()`.
    //
    // It parses as a call whose callee is an index over a field access, so the
    // shape has to be recognised before the name can be read. The receiver and
    // the width become the call's arguments, which is what the transformer
    // expects when it emits the SystemVerilog cast.
    const method = expr.callee.base.field.name;
    const receiver = lowerExpr(expr.callee.base.base, ctx);
    const width = lowerExpr(expr.callee.index, ctx);

    if (method !== 'sign_extend' && method !== 'extend') {
      ctx.errors.push({
        message: `Method '${method}' is not supported`,
        location: undefined,
      });
    }

    return createCallExpr(method, [receiver, width]);
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
      // A function returns a value; synthesizable module logic has no such
      // thing, so the report stays for that case.
      if (!ctx.inFunction) {
        ctx.errors.push({
          message: 'Return statement is only supported inside a function',
          location: undefined,
        });
        return createBlockStmt([]);
      }
      return {
        kind: 'ReturnStmt',
        value: stmt.value ? lowerExpr(stmt.value, ctx) : undefined,
      };

    case 'BlockStmt':
      return lowerBlockStmt(stmt, ctx);

    case 'ExprStmt':
      // Expression statements (like function calls) need special handling
      return createExprStmt(lowerExpr(stmt.expr, ctx));

    case 'AssertStmt':
      return {
        kind: 'AssertStmt',
        condition: lowerExpr(stmt.condition, ctx),
        ...(stmt.message !== undefined ? { message: stmt.message } : {}),
        ...(stmt.severity !== undefined ? { severity: stmt.severity } : {}),
      };

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
 * Whether the arms name every variant of one enum.
 *
 * That is exhaustive, so no `_` arm is needed. Any other shape is not judged
 * here and keeps the requirement.
 */
function coversEveryVariant(arms: MatchArm[], ctx: LoweringContext): boolean {
  if (arms.length === 0 || ctx.enumTypes === undefined) {
    return false;
  }

  const seen = new Set<string>();
  let enumName: string | undefined;
  for (const arm of arms) {
    if (arm.pattern.kind !== 'PathPattern') {
      return false;
    }
    const segments = arm.pattern.path.segments.map((seg: { name: string }) => seg.name);
    if (segments.length !== 2) {
      return false;
    }
    if (enumName === undefined) {
      enumName = segments[0]!;
    } else if (enumName !== segments[0]!) {
      return false;
    }
    seen.add(segments[1]!);
  }

  const type = enumName ? ctx.enumTypes.get(enumName) : undefined;
  if (type === undefined || type.kind !== 'EnumType') {
    return false;
  }
  return type.variants.every((v: { name: string }) => seen.has(v.name));
}

/**
 * Name for a path, dropping an enum qualifier that SystemVerilog does not use.
 *
 * `Op::Add` becomes `Add` when `Op` is an enum declared here; anything else
 * keeps its `::`, which is how a package member is written in both languages.
 */
function pathToName(segments: string[], ctx: LoweringContext): string {
  if (segments.length === 2 && ctx.enumNames?.has(segments[0]!)) {
    return segments[1]!;
  }
  return segments.join('::');
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
      return createHirIdentifier(pathToName(pattern.path.segments.map((s) => s.name), ctx));

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


/**
 * Lower a state machine into the pieces the backend already emits.
 *
 * An FSM is a state register, the logic that decides the next state, and the
 * logic that drives the outputs from the state. All three already exist in this
 * representation, so nothing new is needed downstream:
 *
 *   state enum { A, B }      a signal wide enough to hold the states
 *   initial: B               the reset value of that signal
 *   transitions { ... }      a sequential block with a case over the state
 *   when c { goto S; }       `if c` assigning the next state inside that arm
 *   A [y = 0]                a combinational block driving y from the state
 *   output y { A => 0, }     the same
 *   var t: bit[8] = 0;       an ordinary signal, written by the sequential block
 *
 * States are encoded as consecutive integers. The specification also names
 * `onehot` and `gray`, but only through an `output encoding` clause that no
 * implementation accepts, so binary is the only encoding reachable today.
 */
function lowerFsmBlock(
  fsm: FsmBlock,
  ctx: LoweringContext,
  signals: HirSignal[],
  combBlocks: HirCombBlock[],
  seqBlocks: HirSeqBlock[]
): void {
  const stateNames = fsm.states.states.map((s: FsmStateItem) => s.name.name);
  if (stateNames.length === 0) {
    ctx.errors.push({
      message: `state machine '${fsm.name.name}' declares no states`,
      location: undefined,
    });
    return;
  }

  const stateWidth = Math.max(1, Math.ceil(Math.log2(stateNames.length)));
  const stateSignal = `${fsm.name.name}_state`;
  const codeOf = new Map<string, number>();
  stateNames.forEach((name: string, index: number) => codeOf.set(name, index));

  const stateLiteral = (name: string): HirExpr => {
    const code = codeOf.get(name);
    if (code === undefined) {
      ctx.errors.push({
        message: `state '${name}' is not one of the states of '${fsm.name.name}'`,
        location: undefined,
      });
      return createIntegerLiteral(0n, stateWidth);
    }
    return createIntegerLiteral(BigInt(code), stateWidth);
  };

  // The state register. `initial:` gives its reset value; without one the
  // machine resets to the first state it declares.
  const initialName = fsm.initialState ? fsm.initialState.name : stateNames[0]!;
  signals.push(
    createSignal(stateSignal, createLogicType(stateWidth), true, stateLiteral(initialName))
  );
  ctx.scope?.set(stateSignal, createLogicType(stateWidth));

  // Signals declared inside the machine are ordinary registers.
  for (const signal of fsm.signals) {
    const lowered = lowerSignalDecl(signal, ctx);
    signals.push(lowered);
    ctx.scope?.set(signal.name.name, lowered.dataType);
  }

  // ---- next state and machine-local updates, on the clock edge ----
  ctx.inSequentialBlock = true;
  const caseItems: HirCaseItem[] = [];
  for (const item of fsm.transitions.items) {
    // The clauses of a state are first-match-wins, so they become one
    // if / else-if chain rather than a sequence of independent ifs.
    //
    // Emitting them independently let a later clause run after an earlier one
    // had already matched. In the reference, a machine whose first clause is
    // `when ticks == 3 { goto Done; }` leaves `ticks` alone on the cycle it
    // leaves the state; running both clauses incremented it as well, and the
    // two implementations parted company after ten cycles.
    const clauses: Array<{ condition: HirExpr; actions: HirStmt[] }> = [];
    for (const when of item.clauses) {
      const actions = when.actions
        .map((action: TransitionAction) =>
          lowerTransitionAction(action, stateSignal, stateLiteral, ctx)
        )
        .filter((a: HirStmt | undefined): a is HirStmt => a !== undefined);
      if (actions.length > 0) {
        clauses.push({ condition: lowerExpr(when.condition, ctx), actions });
      }
    }

    let chain: HirStmt[] = [];
    for (let i = clauses.length - 1; i >= 0; i--) {
      const clause = clauses[i]!;
      chain = [
        chain.length > 0
          ? createIfStmt(clause.condition, clause.actions, chain)
          : createIfStmt(clause.condition, clause.actions),
      ];
    }
    const body: HirStmt[] = chain;

    if (item.state === '_') {
      // A wildcard arm applies to every state that has no arm of its own.
      caseItems.push({
        patterns: stateNames
          .filter(
            (name: string) =>
              !fsm.transitions.items.some(
                (i: TransitionItem) => i.state !== '_' && i.state.name === name
              )
          )
          .map((name: string) => stateLiteral(name)),
        body,
      });
    } else {
      caseItems.push({ patterns: [stateLiteral(item.state.name)], body });
    }
  }

  const nonEmpty = caseItems.filter((item: HirCaseItem) => item.patterns.length > 0);
  if (nonEmpty.length > 0) {
    const clock = lowerClockSpec(fsm.clock, ctx);
    const reset = fsm.reset ? lowerResetSpec(fsm.reset, ctx) : undefined;

    // On reset the machine returns to its initial state, and every signal it
    // owns returns to the value its declaration gives.
    const resetStatements: HirStmt[] = [
      createNonblockingAssignStmt(
        createIdentifierLValue(stateSignal),
        stateLiteral(initialName)
      ),
    ];
    for (const signal of fsm.signals) {
      if (signal.init) {
        resetStatements.push(
          createNonblockingAssignStmt(
            createIdentifierLValue(signal.name.name),
            lowerExpr(signal.init, ctx)
          )
        );
      }
    }

    seqBlocks.push(
      createSeqBlock(
        clock,
        reset,
        [createCaseStmt(createHirIdentifier(stateSignal), nonEmpty)],
        resetStatements
      )
    );
  }
  ctx.inSequentialBlock = false;

  // ---- outputs driven from the state ----
  // Moore outputs written on the state item, as `A [y = 0]`, and `output`
  // blocks are the same thing said two ways, so they are collected together.
  const byOutput = new Map<string, Map<string, HirExpr>>();
  const record = (port: string, state: string, value: HirExpr): void => {
    let cases = byOutput.get(port);
    if (!cases) {
      cases = new Map();
      byOutput.set(port, cases);
    }
    cases.set(state, value);
  };

  for (const state of fsm.states.states) {
    for (const assign of state.outputs ?? []) {
      record(assign.name.name, state.name.name, lowerExpr(assign.value, ctx));
    }
  }
  for (const block of fsm.outputs) {
    for (const entry of block.cases) {
      record(block.signal.name, entry.state.name, lowerExpr(entry.value, ctx));
    }
  }

  for (const [port, cases] of byOutput) {
    const items: HirCaseItem[] = [];
    for (const [state, value] of cases) {
      items.push({
        patterns: [stateLiteral(state)],
        body: [createAssignStmt(createIdentifierLValue(port), value)],
      });
    }
    // A default arm is always emitted, even when every state is named.
    // The encoding is wider than the state count whenever that count is not a
    // power of two, so three states in two bits leave 2'b11 unreachable but
    // uncovered, and `always_comb` infers a latch on it. Verilator says so as
    // CASEINCOMPLETE.
    const defaultCase = {
      body: [createAssignStmt(createIdentifierLValue(port), createIntegerLiteral(0n, 1))],
    };

    combBlocks.push(
      createCombBlock([createCaseStmt(createHirIdentifier(stateSignal), items, defaultCase)])
    );
  }
}

/**
 * Lower one action of a `when` clause.
 *
 * `goto` is not an ordinary statement, so the conditional form has to be spelled
 * out separately rather than going through `lowerStmt`.
 */
function lowerTransitionAction(
  action: TransitionAction,
  stateSignal: string,
  stateLiteral: (name: string) => HirExpr,
  ctx: LoweringContext
): HirStmt | undefined {
  switch (action.kind) {
    case 'GotoAction':
      return createNonblockingAssignStmt(
        createIdentifierLValue(stateSignal),
        stateLiteral(action.target.name)
      );

    case 'StmtAction':
      return lowerStmt(action.stmt, ctx);

    default:
      ctx.errors.push({
        message: `transition action '${(action as { kind: string }).kind}' was not converted`,
        location: undefined,
      });
      return undefined;
  }
}
