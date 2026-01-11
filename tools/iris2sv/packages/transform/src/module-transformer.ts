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
  HirFunctionParam,
  HirStructFieldDef,
  HirConnection,
  HirEnumVariant,
} from '@iris2sv/core';

import type {
  SvModule,
  SvModuleItem,
  SvPort,
  SvPortDirection,
  SvSignal,
  SvParameter,
  SvAlwaysBlock,
  SvInstance,
  SvEnumDef,
  SvStructDef,
  SvFunction,
  SvFunctionArg,
  SvSensitivity} from '@iris2sv/sv-backend';
import {
  port,
  signal,
  parameter,
  alwaysComb,
  alwaysFf,
  edgeSensitivity,
  instance,
  connection,
  enumDef,
  structDef,
  functionDef,
  svModule,
  ifStmt,
  identifier,
  unary,
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
    items.push(transformSeqBlock(seq, context));
  }

  // Transform instances
  for (const inst of hirModule.instances) {
    items.push(transformInstance(inst, context));
  }

  // Transform functions
  for (const fn of hirModule.functions) {
    items.push(transformFunction(fn, context));
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
 * Transform HIR sequential block to SV always_ff
 */
function transformSeqBlock(hirSeq: HirSeqBlock, context: ModuleTransformerContext): SvAlwaysBlock {
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
  if (hirSeq.reset && hirSeq.resetStatements.length > 0) {
    const resetStmts = context.stmtTransformer.transformBlock(hirSeq.resetStatements);
    const normalStmts = context.stmtTransformer.transformBlock(hirSeq.statements);

    // Create reset condition
    const resetCond = hirSeq.reset.activeHigh
      ? identifier(hirSeq.reset.signal)
      : unary('!', identifier(hirSeq.reset.signal));

    body = ifStmt(resetCond, resetStmts, normalStmts);
  } else {
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
function transformTypeDef(
  typeDef: HirTypeDef,
  context: ModuleTransformerContext
): SvEnumDef | SvStructDef {
  switch (typeDef.kind) {
    case 'HirEnumDef':
      return transformEnumDef(typeDef, context);
    case 'HirStructDef':
      return transformStructDef(typeDef, context);
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
  const baseType = context.typeMapper.mapType(hirEnum.type);
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
 * Transform HIR function definition
 */
function transformFunction(hirFn: HirFunction, context: ModuleTransformerContext): SvFunction {
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
