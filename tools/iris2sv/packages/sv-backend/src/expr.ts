/**
 * SystemVerilog Expression Types
 *
 * Represents SystemVerilog expressions for code generation.
 */

import type { SvDataType } from './types.js';

/**
 * SystemVerilog expression
 */
export type SvExpr =
  | SvLiteralExpr
  | SvIdentifierExpr
  | SvUnaryExpr
  | SvBinaryExpr
  | SvTernaryExpr
  | SvCallExpr
  | SvIndexExpr
  | SvSliceExpr
  | SvMemberExpr
  | SvConcatExpr
  | SvReplicateExpr
  | SvCastExpr
  | SvParenExpr;

// ==================== Literals ====================

/**
 * Literal expression
 */
export interface SvLiteralExpr {
  readonly kind: 'SvLiteralExpr';
  readonly literal: SvLiteral;
}

/**
 * SystemVerilog literal
 */
export type SvLiteral =
  | SvIntLiteral
  | SvRealLiteral
  | SvStringLiteral
  | SvTimeLiteral;

/**
 * Integer literal with optional radix and width
 */
export interface SvIntLiteral {
  readonly kind: 'SvIntLiteral';
  readonly value: bigint | number;
  readonly width: number | undefined;  // undefined = unsized
  readonly radix: 'b' | 'o' | 'd' | 'h' | undefined;  // undefined = decimal
  readonly signed: boolean;
}

/**
 * Real number literal
 */
export interface SvRealLiteral {
  readonly kind: 'SvRealLiteral';
  readonly value: number;
}

/**
 * String literal
 */
export interface SvStringLiteral {
  readonly kind: 'SvStringLiteral';
  readonly value: string;
}

/**
 * Time literal (e.g., 10ns)
 */
export interface SvTimeLiteral {
  readonly kind: 'SvTimeLiteral';
  readonly value: number;
  readonly unit: 's' | 'ms' | 'us' | 'ns' | 'ps' | 'fs';
}

// ==================== Expressions ====================

/**
 * Identifier expression
 */
export interface SvIdentifierExpr {
  readonly kind: 'SvIdentifierExpr';
  readonly name: string;
}

/**
 * Unary operator
 */
export type SvUnaryOp =
  | '+' | '-'      // Arithmetic
  | '!' | '~'      // Logical/bitwise NOT
  | '&' | '|' | '^' | '~&' | '~|' | '~^'  // Reduction operators
  | '++' | '--';   // Increment/decrement

/**
 * Unary expression
 */
export interface SvUnaryExpr {
  readonly kind: 'SvUnaryExpr';
  readonly op: SvUnaryOp;
  readonly operand: SvExpr;
  readonly prefix: boolean;  // For ++/--
}

/**
 * Binary operator
 */
export type SvBinaryOp =
  // Arithmetic
  | '+' | '-' | '*' | '/' | '%' | '**'
  // Comparison
  | '==' | '!=' | '===' | '!==' | '<' | '>' | '<=' | '>='
  // Logical
  | '&&' | '||'
  // Bitwise
  | '&' | '|' | '^' | '~^' | '^~'
  // Shift
  | '<<' | '>>' | '<<<' | '>>>'
  // Other
  | '->' | '<->';

/**
 * Binary expression
 */
export interface SvBinaryExpr {
  readonly kind: 'SvBinaryExpr';
  readonly op: SvBinaryOp;
  readonly left: SvExpr;
  readonly right: SvExpr;
}

/**
 * Ternary conditional expression
 */
export interface SvTernaryExpr {
  readonly kind: 'SvTernaryExpr';
  readonly condition: SvExpr;
  readonly thenExpr: SvExpr;
  readonly elseExpr: SvExpr;
}

/**
 * Function/task call expression
 */
export interface SvCallExpr {
  readonly kind: 'SvCallExpr';
  readonly callee: string;
  readonly args: SvExpr[];
}

/**
 * Index access expression (array[index])
 */
export interface SvIndexExpr {
  readonly kind: 'SvIndexExpr';
  readonly base: SvExpr;
  readonly index: SvExpr;
}

/**
 * Bit/part select expression (value[high:low])
 */
export interface SvSliceExpr {
  readonly kind: 'SvSliceExpr';
  readonly base: SvExpr;
  readonly high: SvExpr;
  readonly low: SvExpr;
}

/**
 * Member access expression (struct.field)
 */
export interface SvMemberExpr {
  readonly kind: 'SvMemberExpr';
  readonly base: SvExpr;
  readonly member: string;
}

/**
 * Concatenation expression ({a, b, c})
 */
export interface SvConcatExpr {
  readonly kind: 'SvConcatExpr';
  readonly elements: SvExpr[];
}

/**
 * Replication expression ({N{expr}})
 */
export interface SvReplicateExpr {
  readonly kind: 'SvReplicateExpr';
  readonly count: SvExpr;
  readonly expr: SvExpr;
}

/**
 * Type cast expression (type'(expr))
 */
export interface SvCastExpr {
  readonly kind: 'SvCastExpr';
  readonly targetType: SvDataType;
  readonly expr: SvExpr;
}

/**
 * Parenthesized expression
 */
export interface SvParenExpr {
  readonly kind: 'SvParenExpr';
  readonly expr: SvExpr;
}

// ==================== Helper Functions ====================

/**
 * Create an integer literal
 */
export function intLiteral(
  value: number | bigint,
  width?: number,
  radix?: 'b' | 'o' | 'd' | 'h',
  signed = false
): SvLiteralExpr {
  return {
    kind: 'SvLiteralExpr',
    literal: {
      kind: 'SvIntLiteral',
      value,
      width,
      radix,
      signed,
    },
  };
}

/**
 * Create a decimal literal
 */
export function decLiteral(value: number | bigint): SvLiteralExpr {
  return intLiteral(value);
}

/**
 * Create a hex literal
 */
export function hexLiteral(value: number | bigint, width?: number): SvLiteralExpr {
  return intLiteral(value, width, 'h');
}

/**
 * Create a binary literal
 */
export function binLiteral(value: number | bigint, width?: number): SvLiteralExpr {
  return intLiteral(value, width, 'b');
}

/**
 * Create a string literal
 */
export function stringLiteral(value: string): SvLiteralExpr {
  return {
    kind: 'SvLiteralExpr',
    literal: { kind: 'SvStringLiteral', value },
  };
}

/**
 * Create an identifier expression
 */
export function identifier(name: string): SvIdentifierExpr {
  return { kind: 'SvIdentifierExpr', name };
}

/**
 * Create a unary expression
 */
export function unary(op: SvUnaryOp, operand: SvExpr, prefix = true): SvUnaryExpr {
  return { kind: 'SvUnaryExpr', op, operand, prefix };
}

/**
 * Create a binary expression
 */
export function binary(left: SvExpr, op: SvBinaryOp, right: SvExpr): SvBinaryExpr {
  return { kind: 'SvBinaryExpr', op, left, right };
}

/**
 * Create a ternary expression
 */
export function ternary(condition: SvExpr, thenExpr: SvExpr, elseExpr: SvExpr): SvTernaryExpr {
  return { kind: 'SvTernaryExpr', condition, thenExpr, elseExpr };
}

/**
 * Create a function call expression
 */
export function call(callee: string, ...args: SvExpr[]): SvCallExpr {
  return { kind: 'SvCallExpr', callee, args };
}

/**
 * Create an index expression
 */
export function index(base: SvExpr, idx: SvExpr): SvIndexExpr {
  return { kind: 'SvIndexExpr', base, index: idx };
}

/**
 * Create a slice expression
 */
export function slice(base: SvExpr, high: SvExpr, low: SvExpr): SvSliceExpr {
  return { kind: 'SvSliceExpr', base, high, low };
}

/**
 * Create a member access expression
 */
export function member(base: SvExpr, memberName: string): SvMemberExpr {
  return { kind: 'SvMemberExpr', base, member: memberName };
}

/**
 * Create a concatenation expression
 */
export function concat(...elements: SvExpr[]): SvConcatExpr {
  return { kind: 'SvConcatExpr', elements };
}

/**
 * Create a replication expression
 */
export function replicate(count: SvExpr, expr: SvExpr): SvReplicateExpr {
  return { kind: 'SvReplicateExpr', count, expr };
}

/**
 * Create a cast expression
 */
export function cast(targetType: SvDataType, expr: SvExpr): SvCastExpr {
  return { kind: 'SvCastExpr', targetType, expr };
}

/**
 * Create a parenthesized expression
 */
export function paren(expr: SvExpr): SvParenExpr {
  return { kind: 'SvParenExpr', expr };
}

/**
 * Create a simple number
 */
export function num(value: number): SvLiteralExpr {
  return decLiteral(value);
}

/**
 * Create a zero literal
 */
export function zero(): SvLiteralExpr {
  return intLiteral(0);
}

/**
 * Create a one literal
 */
export function one(): SvLiteralExpr {
  return intLiteral(1);
}

/**
 * Create all-ones literal ('1)
 */
export function allOnes(width?: number): SvLiteralExpr {
  if (width === undefined) {
    // '1 in SystemVerilog
    return intLiteral(-1);
  }
  return intLiteral((1n << BigInt(width)) - 1n, width);
}

/**
 * Create all-zeros literal ('0)
 */
export function allZeros(width?: number): SvLiteralExpr {
  return intLiteral(0, width);
}
