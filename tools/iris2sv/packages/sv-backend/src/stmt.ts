/**
 * SystemVerilog Statement Types
 *
 * Represents SystemVerilog statements for code generation.
 */

import type { SvExpr } from './expr.js';
import type { SvDataType } from './types.js';

/**
 * SystemVerilog statement
 */
export type SvStmt =
  | SvBlockingAssignStmt
  | SvNonBlockingAssignStmt
  | SvContinuousAssignStmt
  | SvIfStmt
  | SvCaseStmt
  | SvForStmt
  | SvWhileStmt
  | SvDoWhileStmt
  | SvForeverStmt
  | SvRepeatStmt
  | SvReturnStmt
  | SvBreakStmt
  | SvContinueStmt
  | SvBlockStmt
  | SvVarDeclStmt
  | SvTaskCallStmt
  | SvAssertStmt
  | SvDisplayStmt
  | SvEmptyStmt
  | SvCommentStmt;

// ==================== Assignment Statements ====================

/**
 * Blocking assignment (=)
 */
export interface SvBlockingAssignStmt {
  readonly kind: 'SvBlockingAssignStmt';
  readonly lhs: SvExpr;
  readonly rhs: SvExpr;
}

/**
 * Non-blocking assignment (<=)
 */
export interface SvNonBlockingAssignStmt {
  readonly kind: 'SvNonBlockingAssignStmt';
  readonly lhs: SvExpr;
  readonly rhs: SvExpr;
}

/**
 * Continuous assignment (assign)
 */
export interface SvContinuousAssignStmt {
  readonly kind: 'SvContinuousAssignStmt';
  readonly lhs: SvExpr;
  readonly rhs: SvExpr;
}

// ==================== Control Flow Statements ====================

/**
 * If statement
 */
export interface SvIfStmt {
  readonly kind: 'SvIfStmt';
  readonly condition: SvExpr;
  readonly thenBranch: SvStmt;
  readonly elseBranch: SvStmt | undefined;
  readonly isUnique: boolean;   // unique if
  readonly isPriority: boolean; // priority if
}

/**
 * Case item
 */
export interface SvCaseItem {
  readonly patterns: SvExpr[];  // Multiple patterns for same action
  readonly body: SvStmt;
}

/**
 * Case statement
 */
export interface SvCaseStmt {
  readonly kind: 'SvCaseStmt';
  readonly expr: SvExpr;
  readonly items: SvCaseItem[];
  readonly defaultCase: SvStmt | undefined;
  readonly caseType: 'case' | 'casex' | 'casez';
  readonly isUnique: boolean;
  readonly isPriority: boolean;
}

/**
 * For loop statement
 */
export interface SvForStmt {
  readonly kind: 'SvForStmt';
  readonly init: SvStmt | undefined;
  readonly condition: SvExpr | undefined;
  readonly update: SvStmt | undefined;
  readonly body: SvStmt;
  readonly loopVar: string | undefined;
  readonly loopVarType: SvDataType | undefined;
}

/**
 * While loop statement
 */
export interface SvWhileStmt {
  readonly kind: 'SvWhileStmt';
  readonly condition: SvExpr;
  readonly body: SvStmt;
}

/**
 * Do-while loop statement
 */
export interface SvDoWhileStmt {
  readonly kind: 'SvDoWhileStmt';
  readonly body: SvStmt;
  readonly condition: SvExpr;
}

/**
 * Forever loop statement
 */
export interface SvForeverStmt {
  readonly kind: 'SvForeverStmt';
  readonly body: SvStmt;
}

/**
 * Repeat loop statement
 */
export interface SvRepeatStmt {
  readonly kind: 'SvRepeatStmt';
  readonly count: SvExpr;
  readonly body: SvStmt;
}

// ==================== Other Statements ====================

/**
 * Return statement
 */
export interface SvReturnStmt {
  readonly kind: 'SvReturnStmt';
  readonly value: SvExpr | undefined;
}

/**
 * Break statement
 */
export interface SvBreakStmt {
  readonly kind: 'SvBreakStmt';
}

/**
 * Continue statement
 */
export interface SvContinueStmt {
  readonly kind: 'SvContinueStmt';
}

/**
 * Block statement (begin...end)
 */
export interface SvBlockStmt {
  readonly kind: 'SvBlockStmt';
  readonly statements: SvStmt[];
  readonly label: string | undefined;
}

/**
 * Variable declaration statement
 */
export interface SvVarDeclStmt {
  readonly kind: 'SvVarDeclStmt';
  readonly name: string;
  readonly dataType: SvDataType;
  readonly initialValue: SvExpr | undefined;
}

/**
 * Task call statement
 */
export interface SvTaskCallStmt {
  readonly kind: 'SvTaskCallStmt';
  readonly taskName: string;
  readonly args: SvExpr[];
}

/**
 * Assert statement (for simulation)
 */
export interface SvAssertStmt {
  readonly kind: 'SvAssertStmt';
  readonly condition: SvExpr;
  readonly message: string | undefined;
}

/**
 * $display/$write statement
 */
export interface SvDisplayStmt {
  readonly kind: 'SvDisplayStmt';
  readonly format: string;
  readonly args: SvExpr[];
  readonly newline: boolean;  // $display vs $write
}

/**
 * Empty statement
 */
export interface SvEmptyStmt {
  readonly kind: 'SvEmptyStmt';
}

/**
 * Comment statement
 */
export interface SvCommentStmt {
  readonly kind: 'SvCommentStmt';
  readonly text: string;
  readonly isBlock: boolean;  // /* */ vs //
}

// ==================== Helper Functions ====================

/**
 * Create a blocking assignment
 */
export function blockingAssign(lhs: SvExpr, rhs: SvExpr): SvBlockingAssignStmt {
  return { kind: 'SvBlockingAssignStmt', lhs, rhs };
}

/**
 * Create a non-blocking assignment
 */
export function nonBlockingAssign(lhs: SvExpr, rhs: SvExpr): SvNonBlockingAssignStmt {
  return { kind: 'SvNonBlockingAssignStmt', lhs, rhs };
}

/**
 * Create a continuous assignment
 */
export function continuousAssign(lhs: SvExpr, rhs: SvExpr): SvContinuousAssignStmt {
  return { kind: 'SvContinuousAssignStmt', lhs, rhs };
}

/**
 * Create an if statement
 */
export function ifStmt(
  condition: SvExpr,
  thenBranch: SvStmt,
  elseBranch?: SvStmt,
  options?: { isUnique?: boolean; isPriority?: boolean }
): SvIfStmt {
  return {
    kind: 'SvIfStmt',
    condition,
    thenBranch,
    elseBranch,
    isUnique: options?.isUnique ?? false,
    isPriority: options?.isPriority ?? false,
  };
}

/**
 * Create a case statement
 */
export function caseStmt(
  expr: SvExpr,
  items: SvCaseItem[],
  defaultCase?: SvStmt,
  options?: { caseType?: 'case' | 'casex' | 'casez'; isUnique?: boolean; isPriority?: boolean }
): SvCaseStmt {
  return {
    kind: 'SvCaseStmt',
    expr,
    items,
    defaultCase,
    caseType: options?.caseType ?? 'case',
    isUnique: options?.isUnique ?? false,
    isPriority: options?.isPriority ?? false,
  };
}

/**
 * Create a case item
 */
export function caseItem(patterns: SvExpr | SvExpr[], body: SvStmt): SvCaseItem {
  return {
    patterns: Array.isArray(patterns) ? patterns : [patterns],
    body,
  };
}

/**
 * Create a for loop
 */
export function forStmt(
  init: SvStmt | undefined,
  condition: SvExpr | undefined,
  update: SvStmt | undefined,
  body: SvStmt,
  loopVar?: string,
  loopVarType?: SvDataType
): SvForStmt {
  return {
    kind: 'SvForStmt',
    init,
    condition,
    update,
    body,
    loopVar,
    loopVarType,
  };
}

/**
 * Create a while loop
 */
export function whileStmt(condition: SvExpr, body: SvStmt): SvWhileStmt {
  return { kind: 'SvWhileStmt', condition, body };
}

/**
 * Create a return statement
 */
export function returnStmt(value?: SvExpr): SvReturnStmt {
  return { kind: 'SvReturnStmt', value };
}

/**
 * Create a break statement
 */
export function breakStmt(): SvBreakStmt {
  return { kind: 'SvBreakStmt' };
}

/**
 * Create a continue statement
 */
export function continueStmt(): SvContinueStmt {
  return { kind: 'SvContinueStmt' };
}

/**
 * Create a block statement
 */
export function block(statements: SvStmt[], label?: string): SvBlockStmt {
  return { kind: 'SvBlockStmt', statements, label };
}

/**
 * Create a variable declaration
 */
export function varDecl(name: string, dataType: SvDataType, initialValue?: SvExpr): SvVarDeclStmt {
  return { kind: 'SvVarDeclStmt', name, dataType, initialValue };
}

/**
 * Create a task call
 */
export function taskCall(taskName: string, ...args: SvExpr[]): SvTaskCallStmt {
  return { kind: 'SvTaskCallStmt', taskName, args };
}

/**
 * Create an assert statement
 */
export function assertStmt(condition: SvExpr, message?: string): SvAssertStmt {
  return { kind: 'SvAssertStmt', condition, message };
}

/**
 * Create a display statement
 */
export function displayStmt(format: string, args: SvExpr[], newline = true): SvDisplayStmt {
  return { kind: 'SvDisplayStmt', format, args, newline };
}

/**
 * Create an empty statement
 */
export function emptyStmt(): SvEmptyStmt {
  return { kind: 'SvEmptyStmt' };
}

/**
 * Create a line comment
 */
export function lineComment(text: string): SvCommentStmt {
  return { kind: 'SvCommentStmt', text, isBlock: false };
}

/**
 * Create a block comment
 */
export function blockComment(text: string): SvCommentStmt {
  return { kind: 'SvCommentStmt', text, isBlock: true };
}
