/**
 * HIR Statements
 *
 * Represents statements in the intermediate representation.
 */

import type { HirExpr } from './expr.js';
import type { HirDataType } from './types.js';

/**
 * Base statement interface
 */
export interface HirStmtBase {
  readonly kind: string;
}

/**
 * HIR Statement union type
 */
export type HirStmt =
  | HirDelayStatement
  | HirReturnStmt
  | HirImmediateAssertStmt
  | HirAssignStmt
  | HirNonblockingAssignStmt
  | HirIfStmt
  | HirCaseStmt
  | HirForStmt
  | HirBlockStmt
  | HirExprStmt
  | HirVarDeclStmt;

/**
 * Left-hand side of assignment
 */
export type HirLValue =
  | HirIdentifierLValue
  | HirIndexLValue
  | HirSliceLValue
  | HirFieldLValue
  | HirConcatLValue;

export interface HirIdentifierLValue {
  readonly kind: 'IdentifierLValue';
  readonly name: string;
}

export interface HirIndexLValue {
  readonly kind: 'IndexLValue';
  readonly base: HirLValue;
  readonly index: HirExpr;
}

export interface HirSliceLValue {
  readonly kind: 'SliceLValue';
  readonly base: HirLValue;
  readonly high: HirExpr;
  readonly low: HirExpr;
}

export interface HirFieldLValue {
  readonly kind: 'FieldLValue';
  readonly base: HirLValue;
  readonly field: string;
}

export interface HirConcatLValue {
  readonly kind: 'ConcatLValue';
  readonly elements: HirLValue[];
}

/**
 * Blocking assignment (for comb logic)
 */
export interface HirAssignStmt extends HirStmtBase {
  readonly kind: 'AssignStmt';
  readonly lvalue: HirLValue;
  readonly value: HirExpr;
}

/**
 * Non-blocking assignment (for sequential logic)
 */
export interface HirNonblockingAssignStmt extends HirStmtBase {
  readonly kind: 'NonblockingAssignStmt';
  readonly lvalue: HirLValue;
  readonly value: HirExpr;
}

/**
 * If statement
 */
export interface HirIfStmt extends HirStmtBase {
  readonly kind: 'IfStmt';
  readonly condition: HirExpr;
  readonly thenBranch: HirStmt[];
  readonly elseBranch: HirStmt[] | HirIfStmt | undefined;
}

/**
 * Case item
 */
export interface HirCaseItem {
  readonly patterns: HirExpr[];  // Multiple patterns for one case
  readonly body: HirStmt[];
}

/**
 * Default case
 */
export interface HirDefaultCase {
  readonly body: HirStmt[];
}

/**
 * Case statement (maps to case/casez in SV)
 */
export interface HirCaseStmt extends HirStmtBase {
  readonly kind: 'CaseStmt';
  readonly scrutinee: HirExpr;
  readonly items: HirCaseItem[];
  readonly defaultCase: HirDefaultCase | undefined;
  readonly style: 'normal' | 'unique' | 'priority';
}

/**
 * For loop statement
 */
export interface HirForStmt extends HirStmtBase {
  readonly kind: 'ForStmt';
  readonly variable: string;
  readonly start: HirExpr;
  readonly end: HirExpr;
  readonly inclusive: boolean;
  readonly body: HirStmt[];
}

/**
 * Block statement
 */
export interface HirBlockStmt extends HirStmtBase {
  readonly kind: 'BlockStmt';
  readonly statements: HirStmt[];
}

/**
 * Expression statement
 */
export interface HirExprStmt extends HirStmtBase {
  readonly kind: 'ExprStmt';
  readonly expr: HirExpr;
}

/**
 * Variable declaration statement (for local variables in functions)
 */
export interface HirVarDeclStmt extends HirStmtBase {
  readonly kind: 'VarDeclStmt';
  readonly name: string;
  readonly dataType: HirDataType;
  readonly init: HirExpr | undefined;
}

// ==================== Helper Functions ====================

/**
 * Create an identifier LValue
 */
export function createIdentifierLValue(name: string): HirIdentifierLValue {
  return { kind: 'IdentifierLValue', name };
}

/**
 * Create an index LValue
 */
export function createIndexLValue(base: HirLValue, index: HirExpr): HirIndexLValue {
  return { kind: 'IndexLValue', base, index };
}

/**
 * Create a slice LValue
 */
export function createSliceLValue(base: HirLValue, high: HirExpr, low: HirExpr): HirSliceLValue {
  return { kind: 'SliceLValue', base, high, low };
}

/**
 * Create a field LValue
 */
export function createFieldLValue(base: HirLValue, field: string): HirFieldLValue {
  return { kind: 'FieldLValue', base, field };
}

/**
 * Create a concat LValue
 */
export function createConcatLValue(elements: HirLValue[]): HirConcatLValue {
  return { kind: 'ConcatLValue', elements };
}

/**
 * Create a blocking assignment
 */
export function createAssignStmt(lvalue: HirLValue, value: HirExpr): HirAssignStmt {
  return { kind: 'AssignStmt', lvalue, value };
}

/**
 * Create a non-blocking assignment
 */
export function createNonblockingAssignStmt(lvalue: HirLValue, value: HirExpr): HirNonblockingAssignStmt {
  return { kind: 'NonblockingAssignStmt', lvalue, value };
}

/**
 * Create an if statement
 */
export function createIfStmt(
  condition: HirExpr,
  thenBranch: HirStmt[],
  elseBranch?: HirStmt[] | HirIfStmt
): HirIfStmt {
  return {
    kind: 'IfStmt',
    condition,
    thenBranch,
    elseBranch,
  };
}

/**
 * Create a case statement
 */
export function createCaseStmt(
  scrutinee: HirExpr,
  items: HirCaseItem[],
  defaultCase?: HirDefaultCase,
  style: 'normal' | 'unique' | 'priority' = 'normal'
): HirCaseStmt {
  return {
    kind: 'CaseStmt',
    scrutinee,
    items,
    defaultCase,
    style,
  };
}

/**
 * Create a for loop statement
 */
export function createForStmt(
  variable: string,
  start: HirExpr,
  end: HirExpr,
  inclusive: boolean,
  body: HirStmt[]
): HirForStmt {
  return {
    kind: 'ForStmt',
    variable,
    start,
    end,
    inclusive,
    body,
  };
}

/**
 * Create a block statement
 */
export function createBlockStmt(statements: HirStmt[]): HirBlockStmt {
  return { kind: 'BlockStmt', statements };
}

/**
 * Create an expression statement
 */
export function createExprStmt(expr: HirExpr): HirExprStmt {
  return { kind: 'ExprStmt', expr };
}

/**
 * Create a variable declaration statement
 */
export function createVarDeclStmt(
  name: string,
  dataType: HirDataType,
  init?: HirExpr
): HirVarDeclStmt {
  return {
    kind: 'VarDeclStmt',
    name,
    dataType,
    init,
  };
}


/**
 * An immediate assertion, as `assert c else error("...")` in IRIS.
 *
 * Named apart from `HirAssertStmt` in `module.ts`, which is the testbench-level
 * assertion and carries a different shape. Two types of the same name in one
 * package is a trap for whoever reads the next `kind` check.
 *
 * The SystemVerilog backend already had a node for this; the intermediate
 * representation did not, so an assertion could not survive lowering and every
 * testbench stopped at its first one.
 */
export interface HirImmediateAssertStmt {
  readonly kind: 'AssertStmt';
  readonly condition: HirExpr;
  readonly message?: string | undefined;
  readonly severity?: 'error' | 'warning' | 'fatal' | undefined;
}


/**
 * `return expr;` inside a function.
 *
 * Only meaningful in a function body: a return in synthesizable module logic
 * has no equivalent and is still reported. SystemVerilog functions take this
 * form directly, so nothing further is needed downstream.
 */
export interface HirReturnStmt {
  readonly kind: 'ReturnStmt';
  readonly value: HirExpr | undefined;
}


/**
 * `#20;` — a delay, used by a testbench to sequence its stimulus.
 *
 * Distinct from `HirDelayStmt` in `module.ts`, which belongs to the `seq` block
 * vocabulary and carries a unit.
 */
export interface HirDelayStatement {
  readonly kind: 'DelayStmt';
  readonly delay: number;
}
