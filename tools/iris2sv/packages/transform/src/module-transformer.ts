/**
 * Module Transformer
 *
 * Transforms HIR modules to SystemVerilog modules.
 */

import type {
  HirModule,
  HirPort,
  HirSignal,
  HirParameter,
  HirCombBlock,
  HirSeqBlock,
  HirInstance,
  HirTypeDef,
  HirFunction,
  HirEnumDef,
  HirStructDef,
  HirUnionDef,
  HirInterface,
  HirModport,
  HirModportSignal,
  HirFunctionParam,
  HirStructFieldDef,
  HirConnection,
  HirEnumVariant,
  HirInitialBlock,
  HirTestSeqBlock,
  HirTestSeqStmt,
  HirStmt,
  HirLValue,
} from '@iris2sv/core';

import type {
  SvModule,
  SvModuleItem,
  SvPort,
  SvPortDirection,
  SvSignal,
  SvParameter,
  SvAlwaysBlock,
  SvInitialBlock,
  SvInstance,
  SvEnumDef,
  SvStructDef,
  SvUnionDef,
  SvInterface,
  SvFunction,
  SvFunctionArg,
  SvSensitivity,
  SvStmt,
} from '@iris2sv/sv-backend';
import {
  port,
  signal,
  parameter,
  alwaysComb,
  alwaysFf,
  initial,
  edgeSensitivity,
  instance,
  connection,
  enumDef,
  structDef,
  unionDef,
  svInterface,
  functionDef,
  svModule,
  ifStmt,
  block,
  identifier,
  blockingAssign,
  nonBlockingAssign,
  unary,
  delayStmt,
  eventControlStmt,
  waitStmt,
  assertStmt,
} from '@iris2sv/sv-backend';

import type { TypeMapper} from './type-mapper.js';
import { createTypeMapper } from './type-mapper.js';
import type { StmtTransformer} from './stmt-transformer.js';
import { createStmtTransformer } from './stmt-transformer.js';

/**
 * Module transformer context
 */
export interface ModuleTransformerContext {
  typeMapper: TypeMapper;
  stmtTransformer: StmtTransformer;
}

/**
 * Create a module transformer context
 */
export function createModuleTransformerContext(): ModuleTransformerContext {
  const typeMapper = createTypeMapper();
  return {
    typeMapper,
    stmtTransformer: createStmtTransformer(typeMapper),
  };
}

/**
 * Transform HIR module to SV module
 */
export function transformModule(hirModule: HirModule, context: ModuleTransformerContext): SvModule {
  const items: SvModuleItem[] = [];

  // Transform type definitions (enums, structs)
  for (const typeDef of hirModule.typeDefs) {
    const svTypeDef = transformTypeDef(typeDef, context);
    if (svTypeDef) {
      items.push(svTypeDef);
    }
  }

  // Transform signals
  for (const sig of hirModule.signals) {
    items.push(transformSignal(sig, context));
  }

  // Transform combinational blocks
  for (const comb of hirModule.combBlocks) {
    items.push(transformCombBlock(comb, context));
  }

  // Transform sequential blocks
  for (const seq of hirModule.seqBlocks) {
    items.push(transformSeqBlock(seq, hirModule, context));
  }

  // Transform instances
  for (const inst of hirModule.instances) {
    items.push(transformInstance(inst, context));
  }

  // Transform functions
  for (const fn of hirModule.functions) {
    items.push(transformFunction(fn, context));
  }

  // A testbench drives its own clock: `always #5 clk = ~clk;`
  for (const driver of hirModule.clockDrivers ?? []) {
    items.push({
      kind: 'SvAlwaysBlock',
      alwaysType: 'always',
      sensitivity: [],
      body: block([
        delayStmt(driver.halfPeriod),
        blockingAssign(
          identifier(driver.signal),
          unary('~', identifier(driver.signal))
        ),
      ]),
    });
  }

  // Transform initial blocks (for testbenches)
  if (hirModule.initialBlocks) {
    for (const initBlock of hirModule.initialBlocks) {
      items.push(transformInitialBlock(initBlock, context));
    }
  }

  // Transform test seq blocks (for testbenches)
  if (hirModule.testSeqBlocks) {
    for (const seqBlock of hirModule.testSeqBlocks) {
      items.push(transformTestSeqBlock(seqBlock, context));
    }
  }

  return svModule(
    hirModule.name,
    hirModule.parameters.map((p: HirParameter) => transformParameter(p, context)),
    hirModule.ports.map((p: HirPort) => transformPort(p, context)),
    items
  );
}

/**
 * Transform HIR port to SV port
 */
function transformPort(hirPort: HirPort, context: ModuleTransformerContext): SvPort {
  const direction: SvPortDirection = hirPort.direction;
  const dataType = context.typeMapper.mapType(hirPort.dataType);

  return port(hirPort.name, direction, dataType, hirPort.isReg);
}

/**
 * Transform HIR signal to SV signal
 */
function transformSignal(hirSignal: HirSignal, context: ModuleTransformerContext): SvSignal {
  const dataType = context.typeMapper.mapType(hirSignal.dataType);
  const init = hirSignal.initialValue
    ? context.stmtTransformer.exprTransformer.transform(hirSignal.initialValue)
    : undefined;

  return signal(hirSignal.name, dataType, init);
}

/**
 * Transform HIR parameter to SV parameter
 */
function transformParameter(hirParam: HirParameter, context: ModuleTransformerContext): SvParameter {
  const dataType = context.typeMapper.mapType(hirParam.dataType);
  const defaultValue = hirParam.defaultValue
    ? context.stmtTransformer.exprTransformer.transform(hirParam.defaultValue)
    : undefined;

  return parameter(hirParam.name, defaultValue, dataType);
}

/**
 * Transform HIR combinational block to SV always_comb
 */
function transformCombBlock(hirComb: HirCombBlock, context: ModuleTransformerContext): SvAlwaysBlock {
  context.stmtTransformer.setSequential(false);
  const body = context.stmtTransformer.transformBlock(hirComb.statements);
  return alwaysComb(body);
}

/**
 * Collect the names a block assigns to
 *
 * Only the root of an lvalue matters: `q[3] = ...` and `q = ...` both make `q`
 * a register of this block.
 */
function assignedNames(stmts: HirStmt[], out: Set<string>): void {
  const root = (lv: HirLValue): void => {
    switch (lv.kind) {
      case 'IdentifierLValue':
        out.add(lv.name);
        break;
      case 'IndexLValue':
      case 'SliceLValue':
      case 'FieldLValue':
        root(lv.base);
        break;
      case 'ConcatLValue':
        lv.elements.forEach(root);
        break;
    }
  };

  for (const stmt of stmts) {
    switch (stmt.kind) {
      case 'AssignStmt':
      case 'NonblockingAssignStmt':
        root(stmt.lvalue);
        break;
      case 'IfStmt':
        assignedNames(stmt.thenBranch, out);
        if (Array.isArray(stmt.elseBranch)) {
          assignedNames(stmt.elseBranch, out);
        } else if (stmt.elseBranch) {
          assignedNames([stmt.elseBranch], out);
        }
        break;
      case 'CaseStmt':
        for (const item of stmt.items) assignedNames(item.body, out);
        if (stmt.defaultCase) assignedNames(stmt.defaultCase.body, out);
        break;
      case 'ForStmt':
      case 'BlockStmt':
        assignedNames(stmt.kind === 'ForStmt' ? stmt.body : stmt.statements, out);
        break;
    }
  }
}

/**
 * Build the reset branch a block does not write for itself
 *
 * Specification 6.3.1: "リセット値は`var`宣言時の初期値から決定されます". A
 * design that names a reset in `sync(clk.posedge, rst.async)` and does not go
 * on to write `if ~rst { ... }` is not asking for no reset. It is asking for
 * the declared initial value, and 6.3.3 shows exactly that with the comment
 * "リセット時は宣言時の初期値（0）".
 *
 * Emitting the reset into the sensitivity list and nowhere else produced a
 * register that took its normal path on a reset edge: the counter in
 * example/counter incremented while rst was rising. Yosys refused the result
 * outright ("Multiple edge sensitive events found for this signal"), so the
 * design could not be synthesised or formally checked either.
 *
 * A signal with no declared initial value keeps no reset assignment; there is
 * nothing to reset it to. Memories are likewise left alone.
 */
function synthesizeResetStatements(
  hirSeq: HirSeqBlock,
  hirModule: HirModule,
  context: ModuleTransformerContext
): SvStmt | undefined {
  const assigned = new Set<string>();
  assignedNames(hirSeq.statements, assigned);

  const stmts: SvStmt[] = [];
  for (const sig of hirModule.signals) {
    if (!assigned.has(sig.name) || sig.initialValue === undefined) continue;
    stmts.push(
      nonBlockingAssign(
        identifier(sig.name),
        context.stmtTransformer.exprTransformer.transform(sig.initialValue)
      )
    );
  }

  if (stmts.length === 0) return undefined;
  return stmts.length === 1 && stmts[0] ? stmts[0] : block(stmts);
}

/**
 * Transform HIR sequential block to SV always_ff
 */
function transformSeqBlock(
  hirSeq: HirSeqBlock,
  hirModule: HirModule,
  context: ModuleTransformerContext
): SvAlwaysBlock {
  context.stmtTransformer.setSequential(true);

  // Build sensitivity list
  const sensitivity: SvSensitivity[] = [
    edgeSensitivity(hirSeq.clock.edge, hirSeq.clock.signal),
  ];

  // Add reset to sensitivity for async reset
  if (hirSeq.reset?.mode === 'async') {
    const resetEdge = hirSeq.reset.activeHigh ? 'posedge' : 'negedge';
    sensitivity.push(edgeSensitivity(resetEdge, hirSeq.reset.signal));
  }

  // Build body with reset handling
  let body;
  let resetStmts: SvStmt | undefined;
  if (hirSeq.reset) {
    resetStmts =
      hirSeq.resetStatements.length > 0
        ? context.stmtTransformer.transformBlock(hirSeq.resetStatements)
        : synthesizeResetStatements(hirSeq, hirModule, context);
  }

  if (hirSeq.reset && resetStmts) {
    const normalStmts = context.stmtTransformer.transformBlock(hirSeq.statements);

    // Create reset condition
    const resetCond = hirSeq.reset.activeHigh
      ? identifier(hirSeq.reset.signal)
      : unary('!', identifier(hirSeq.reset.signal));

    body = ifStmt(resetCond, resetStmts, normalStmts);
  } else {
    // Nothing to reset. Leaving the reset edge in the sensitivity list would
    // describe a register that changes on that edge without saying how.
    if (hirSeq.reset?.mode === 'async') {
      sensitivity.pop();
    }
    body = context.stmtTransformer.transformBlock(hirSeq.statements);
  }

  return alwaysFf(sensitivity, body);
}

/**
 * Transform HIR instance to SV instance
 */
function transformInstance(hirInst: HirInstance, context: ModuleTransformerContext): SvInstance {
  const params = hirInst.parameters.map((p: HirConnection) =>
    connection(p.port, context.stmtTransformer.exprTransformer.transform(p.expr))
  );

  const connections = hirInst.connections.map((c: HirConnection) =>
    connection(c.port, context.stmtTransformer.exprTransformer.transform(c.expr))
  );

  return instance(hirInst.name, hirInst.module, connections, params);
}

/**
 * Transform HIR type definition
 */
export function transformTypeDef(
  typeDef: HirTypeDef,
  context: ModuleTransformerContext
): SvEnumDef | SvStructDef | SvUnionDef {
  switch (typeDef.kind) {
    case 'HirEnumDef':
      return transformEnumDef(typeDef, context);
    case 'HirStructDef':
      return transformStructDef(typeDef, context);
    case 'HirUnionDef':
      return transformUnionDef(typeDef, context);
    default: {
      const _exhaustive: never = typeDef;
      throw new Error(`Unknown type def kind: ${(_exhaustive as HirTypeDef).kind}`);
    }
  }
}

/**
 * Transform HIR enum definition
 */
function transformEnumDef(hirEnum: HirEnumDef, context: ModuleTransformerContext): SvEnumDef {
  // The base type is the storage the enum sits in, not the enum itself.
  // Mapping the enum type gave `typedef enum Op { ... } Op;`, which Verilator
  // rejects as a self-referential enumerated type definition.
  const baseType = context.typeMapper.mapType({
    kind: 'LogicType',
    width: hirEnum.type.width,
    signed: false,
  });
  const members = hirEnum.type.variants.map((v: HirEnumVariant) => {
    if (v.value !== undefined) {
      return { name: v.name, value: { kind: 'SvLiteralExpr' as const, literal: { kind: 'SvIntLiteral' as const, value: v.value, width: undefined, radix: undefined, signed: false } } };
    }
    return v.name;
  });

  return enumDef(hirEnum.name, members, baseType);
}

/**
 * Transform HIR struct definition
 */
function transformStructDef(hirStruct: HirStructDef, context: ModuleTransformerContext): SvStructDef {
  const fields = hirStruct.fields.map((f: HirStructFieldDef) => ({
    name: f.name,
    dataType: context.typeMapper.mapType(f.type),
  }));

  return structDef(hirStruct.name, fields, true);  // packed struct
}

/**
 * Transform an interface and its modports.
 */
export function transformInterface(
  hirIface: HirInterface,
  context: ModuleTransformerContext
): SvInterface {
  return svInterface(
    hirIface.name,
    hirIface.signals.map((s: HirSignal) => transformSignal(s, context)),
    hirIface.modports.map((m: HirModport) => ({
      name: m.name,
      signals: m.signals.map((s: HirModportSignal) => ({
        name: s.name,
        direction: s.direction,
      })),
    }))
  );
}

/**
 * Transform HIR union definition
 */
function transformUnionDef(hirUnion: HirUnionDef, context: ModuleTransformerContext): SvUnionDef {
  const fields = hirUnion.fields.map((f: HirStructFieldDef) => ({
    name: f.name,
    dataType: context.typeMapper.mapType(f.type),
  }));

  return unionDef(hirUnion.name, fields, true);  // packed union
}

/**
 * Transform HIR function definition
 */
export function transformFunction(hirFn: HirFunction, context: ModuleTransformerContext): SvFunction {
  const returnType = context.typeMapper.mapType(hirFn.returnType);

  const args: SvFunctionArg[] = hirFn.params.map((p: HirFunctionParam) => ({
    name: p.name,
    dataType: context.typeMapper.mapType(p.dataType),
    direction: 'input' as const,
  }));

  const body = context.stmtTransformer.transformBlock(hirFn.body);

  return functionDef(hirFn.name, returnType, args, body, true);
}

/**
 * Transform HIR initial block to SV initial block
 */
function transformInitialBlock(
  hirInit: HirInitialBlock,
  context: ModuleTransformerContext
): SvInitialBlock {
  const body = context.stmtTransformer.transformBlock(hirInit.statements);
  return initial(body);
}

/**
 * Transform HIR testbench seq block to SV initial block
 * seq blocks are transformed to initial blocks with time control
 */
function transformTestSeqBlock(
  hirSeq: HirTestSeqBlock,
  context: ModuleTransformerContext
): SvInitialBlock {
  const svStmts: SvStmt[] = [];

  for (const stmt of hirSeq.statements) {
    const svStmt = transformTestSeqStmt(stmt, context);
    if (svStmt) {
      svStmts.push(svStmt);
    }
  }

  // If the block has a name, wrap in a named block
  const body = hirSeq.name
    ? block(svStmts, hirSeq.name)
    : block(svStmts);

  return initial(body);
}

/**
 * Transform a testbench sequential statement
 */
function transformTestSeqStmt(
  stmt: HirTestSeqStmt,
  context: ModuleTransformerContext
): SvStmt | undefined {
  switch (stmt.kind) {
    case 'HirDelayStmt':
      return delayStmt(stmt.delay, stmt.unit);

    case 'HirAwaitStmt':
      return transformAwaitStmt(stmt);

    case 'HirAssertStmt':
      return assertStmt(
        context.stmtTransformer.exprTransformer.transform(stmt.condition),
        stmt.message
      );

    default:
      // Regular HIR statement
      return context.stmtTransformer.transform(stmt);
  }
}

/**
 * Transform HIR await statement to SV event control or wait
 */
function transformAwaitStmt(stmt: {
  awaitType: 'clock_edge' | 'until' | 'event';
  signal: string | undefined;
  edge: 'posedge' | 'negedge' | undefined;
  cycles: number | undefined;
  condition: unknown;
}): SvStmt {
  switch (stmt.awaitType) {
    case 'clock_edge':
      // await clk.posedge -> @(posedge clk)
      // await clk.posedge(5) -> repeat(5) @(posedge clk)
      if (stmt.cycles !== undefined && stmt.cycles > 1) {
        // For multiple cycles, we'd need a repeat statement
        // For now, just emit a single event control
        return eventControlStmt(stmt.signal ?? 'clk', stmt.edge);
      }
      return eventControlStmt(stmt.signal ?? 'clk', stmt.edge);

    case 'until':
      // await until(condition) -> wait(condition)
      if (stmt.condition) {
        // Need to convert HirExpr to SvExpr
        // For now, create a simple identifier
        return waitStmt(identifier('condition'));
      }
      return waitStmt(identifier('1'));

    case 'event':
      // await signal -> @(signal)
      return eventControlStmt(stmt.signal ?? 'event', undefined);

    default:
      return eventControlStmt('clk', 'posedge');
  }
}

/**
 * Module transformer class
 */
export class ModuleTransformer {
  private readonly context: ModuleTransformerContext;

  constructor(context?: ModuleTransformerContext) {
    this.context = context ?? createModuleTransformerContext();
  }

  /**
   * Get the type mapper
   */
  get typeMapper(): TypeMapper {
    return this.context.typeMapper;
  }

  /**
   * Get the statement transformer
   */
  get stmtTransformer(): StmtTransformer {
    return this.context.stmtTransformer;
  }

  /**
   * Transform a module
   */
  transform(module: HirModule): SvModule {
    return transformModule(module, this.context);
  }
}

/**
 * Create a module transformer
 */
export function createModuleTransformer(): ModuleTransformer {
  return new ModuleTransformer();
}
