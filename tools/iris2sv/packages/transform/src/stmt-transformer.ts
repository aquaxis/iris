/**
 * Statement Transformer
 *
 * Transforms HIR statements to SystemVerilog statements.
 */

import type {
  HirStmt,
  HirLValue,
  HirIfStmt,
  HirCaseItem,
  HirCaseStmt,
  HirExpr,
} from '@iris2sv/core';

import type {
  SvStmt,
  SvExpr,
  SvCaseItem} from '@iris2sv/sv-backend';
import {
  blockingAssign,
  nonBlockingAssign,
  ifStmt,
  caseStmt,
  caseItem,
  forStmt,
  block,
  varDecl,
  emptyStmt,
  identifier,
  index,
  slice,
  member,
  concat,
  binary,
  intLiteral,
  logicType,
} from '@iris2sv/sv-backend';

import type { ExprTransformer} from './expr-transformer.js';
import { createExprTransformer } from './expr-transformer.js';
import type { TypeMapper } from './type-mapper.js';

/**
 * Statement transformer context
 */
export interface StmtTransformerContext {
  exprTransformer: ExprTransformer;
  /**
   * Whether we're in a sequential block (use non-blocking assignments)
   */
  isSequential: boolean;
}

/**
 * Create a statement transformer context
 */
export function createStmtTransformerContext(
  typeMapper?: TypeMapper,
  isSequential = false
): StmtTransformerContext {
  return {
    exprTransformer: createExprTransformer(typeMapper),
    isSequential,
  };
}

/**
 * Transform HIR statement to SV statement
 */
export function transformStmt(stmt: HirStmt, context: StmtTransformerContext): SvStmt {
  switch (stmt.kind) {
    case 'AssignStmt': {
      const lhs = transformLValue(stmt.lvalue, context);
      const rhs = context.exprTransformer.transform(stmt.value);
      // In sequential blocks, use blocking assignment for combinational logic
      return blockingAssign(lhs, rhs);
    }

    case 'NonblockingAssignStmt': {
      const lhs = transformLValue(stmt.lvalue, context);
      const rhs = context.exprTransformer.transform(stmt.value);
      return nonBlockingAssign(lhs, rhs);
    }

    case 'IfStmt':
      return transformIfStmt(stmt, context);

    case 'CaseStmt':
      return transformCaseStmt(stmt, context);

    case 'ForStmt':
      return transformForStmt(stmt, context);

    case 'BlockStmt':
      return block(stmt.statements.map((s: HirStmt) => transformStmt(s, context)));

    case 'ExprStmt':
      // Expression statements become empty in SV (or task calls)
      // This is a simplification; real implementation would handle function calls
      return emptyStmt();

    case 'VarDeclStmt': {
      const svType = context.exprTransformer.typeMapper.mapType(stmt.dataType);
      const init = stmt.init
        ? context.exprTransformer.transform(stmt.init)
        : undefined;
      return varDecl(stmt.name, svType, init);
    }

    default: {
      const _exhaustive: never = stmt;
      throw new Error(`Unknown statement kind: ${(_exhaustive as HirStmt).kind}`);
    }
  }
}

/**
 * Transform HIR LValue to SV expression
 */
function transformLValue(lvalue: HirLValue, context: StmtTransformerContext): SvExpr {
  switch (lvalue.kind) {
    case 'IdentifierLValue':
      return identifier(lvalue.name);

    case 'IndexLValue':
      return index(
        transformLValue(lvalue.base, context),
        context.exprTransformer.transform(lvalue.index)
      );

    case 'SliceLValue':
      return slice(
        transformLValue(lvalue.base, context),
        context.exprTransformer.transform(lvalue.high),
        context.exprTransformer.transform(lvalue.low)
      );

    case 'FieldLValue':
      return member(
        transformLValue(lvalue.base, context),
        lvalue.field
      );

    case 'ConcatLValue':
      return concat(...lvalue.elements.map((e: HirLValue) => transformLValue(e, context)));

    default: {
      const _exhaustive: never = lvalue;
      throw new Error(`Unknown lvalue kind: ${(_exhaustive as HirLValue).kind}`);
    }
  }
}

/**
 * Transform HIR if statement
 */
function transformIfStmt(stmt: HirIfStmt, context: StmtTransformerContext): SvStmt {
  const condition = context.exprTransformer.transform(stmt.condition);
  const thenBranch = transformStatements(stmt.thenBranch, context);

  let elseBranch: SvStmt | undefined;
  if (stmt.elseBranch) {
    if (Array.isArray(stmt.elseBranch)) {
      elseBranch = transformStatements(stmt.elseBranch, context);
    } else {
      // else if chain
      elseBranch = transformIfStmt(stmt.elseBranch, context);
    }
  }

  return ifStmt(condition, thenBranch, elseBranch);
}

/**
 * Transform HIR case statement
 */
function transformCaseStmt(
  stmt: HirCaseStmt,
  context: StmtTransformerContext
): SvStmt {
  const scrutinee = context.exprTransformer.transform(stmt.scrutinee);

  const items: SvCaseItem[] = stmt.items.map((item: HirCaseItem) => {
    const patterns = item.patterns.map((p: HirExpr) => context.exprTransformer.transform(p));
    const body = transformStatements(item.body, context);
    return caseItem(patterns, body);
  });

  const defaultBody = stmt.defaultCase
    ? transformStatements(stmt.defaultCase.body, context)
    : undefined;

  return caseStmt(scrutinee, items, defaultBody, {
    isUnique: stmt.style === 'unique',
    isPriority: stmt.style === 'priority',
  });
}

/**
 * Transform HIR for statement
 */
function transformForStmt(
  stmt: {
    variable: string;
    start: Parameters<ExprTransformer['transform']>[0];
    end: Parameters<ExprTransformer['transform']>[0];
    inclusive: boolean;
    body: HirStmt[];
  },
  context: StmtTransformerContext
): SvStmt {
  const startExpr = context.exprTransformer.transform(stmt.start);
  const endExpr = context.exprTransformer.transform(stmt.end);

  // Create for loop: for (int i = start; i < end; i++)
  // or for (int i = start; i <= end; i++) if inclusive
  const init = varDecl(stmt.variable, logicType(32, true), startExpr);
  const condition = binary(
    identifier(stmt.variable),
    stmt.inclusive ? '<=' : '<',
    endExpr
  );
  const update = blockingAssign(
    identifier(stmt.variable),
    binary(identifier(stmt.variable), '+', intLiteral(1))
  );

  const body = transformStatements(stmt.body, context);

  return forStmt(init, condition, update, body, stmt.variable, logicType(32, true));
}

/**
 * Transform a list of statements into a block
 */
function transformStatements(stmts: HirStmt[], context: StmtTransformerContext): SvStmt {
  if (stmts.length === 0) {
    return emptyStmt();
  }
  if (stmts.length === 1 && stmts[0]) {
    return transformStmt(stmts[0], context);
  }
  return block(stmts.map(s => transformStmt(s, context)));
}

/**
 * Statement transformer class
 */
export class StmtTransformer {
  private readonly context: StmtTransformerContext;

  constructor(context?: StmtTransformerContext) {
    this.context = context ?? createStmtTransformerContext();
  }

  /**
   * Get the type mapper
   */
  get typeMapper(): TypeMapper {
    return this.context.exprTransformer.typeMapper;
  }

  /**
   * Get the expression transformer
   */
  get exprTransformer(): ExprTransformer {
    return this.context.exprTransformer;
  }

  /**
   * Transform a statement
   */
  transform(stmt: HirStmt): SvStmt {
    return transformStmt(stmt, this.context);
  }

  /**
   * Transform multiple statements to a block
   */
  transformBlock(stmts: HirStmt[]): SvStmt {
    return transformStatements(stmts, this.context);
  }

  /**
   * Set sequential mode (for always_ff blocks)
   */
  setSequential(isSequential: boolean): void {
    this.context.isSequential = isSequential;
  }
}

/**
 * Create a statement transformer
 */
export function createStmtTransformer(
  typeMapper?: TypeMapper,
  isSequential = false
): StmtTransformer {
  return new StmtTransformer(createStmtTransformerContext(typeMapper, isSequential));
}
