/**
 * HIR Expressions
 *
 * Represents expressions in the intermediate representation.
 */

import type { HirDataType, HirLogicType, HirEnumType } from './types.js';

/**
 * Base expression interface
 */
export interface HirExprBase {
  readonly kind: string;
  readonly dataType: HirDataType | undefined;
}

/**
 * HIR Expression union type
 */
export type HirExpr =
  | HirStringLiteral
  | HirIntegerLiteral
  | HirBoolLiteral
  | HirEnumLiteral
  | HirIdentifier
  | HirUnaryExpr
  | HirBinaryExpr
  | HirConditionalExpr
  | HirConcatExpr
  | HirRepeatExpr
  | HirIndexExpr
  | HirSliceExpr
  | HirFieldExpr
  | HirCallExpr
  | HirCastExpr
  | HirParenExpr;

/**
 * Integer literal
 */
export interface HirIntegerLiteral extends HirExprBase {
  readonly kind: 'IntegerLiteral';
  readonly value: bigint;
  readonly width: number | undefined;
  readonly signed: boolean;
}

/**
 * Boolean literal
 */
export interface HirBoolLiteral extends HirExprBase {
  readonly kind: 'BoolLiteral';
  readonly value: boolean;
}

/**
 * Enum literal (e.g., State::Idle)
 */
export interface HirEnumLiteral extends HirExprBase {
  readonly kind: 'EnumLiteral';
  readonly enumType: HirEnumType;
  readonly variant: string;
}

/**
 * Identifier reference
 */
export interface HirIdentifier extends HirExprBase {
  readonly kind: 'Identifier';
  readonly name: string;
}

/**
 * Unary operator
 */
export type HirUnaryOp =
  | 'not'       // logical NOT (!)
  | 'bitnot'    // bitwise NOT (~)
  | 'neg'       // arithmetic negation (-)
  | 'and_reduce'  // reduction AND (&)
  | 'or_reduce'   // reduction OR (|)
  | 'xor_reduce'; // reduction XOR (^)

/**
 * Unary expression
 */
export interface HirUnaryExpr extends HirExprBase {
  readonly kind: 'UnaryExpr';
  readonly op: HirUnaryOp;
  readonly operand: HirExpr;
}

/**
 * Binary operator
 */
export type HirBinaryOp =
  // Arithmetic
  | 'add'   // +
  | 'sub'   // -
  | 'mul'   // *
  | 'div'   // /
  | 'mod'   // %
  // Bitwise
  | 'and'   // &
  | 'or'    // |
  | 'xor'   // ^
  | 'shl'   // <<
  | 'shr'   // >> (logical)
  | 'ashr'  // >>> (arithmetic)
  // Comparison
  | 'eq'    // ==
  | 'ne'    // !=
  | 'lt'    // <
  | 'le'    // <=
  | 'gt'    // >
  | 'ge'    // >=
  // Logical
  | 'land'  // &&
  | 'lor';  // ||

/**
 * Binary expression
 */
export interface HirBinaryExpr extends HirExprBase {
  readonly kind: 'BinaryExpr';
  readonly op: HirBinaryOp;
  readonly left: HirExpr;
  readonly right: HirExpr;
}

/**
 * Conditional expression (ternary)
 */
export interface HirConditionalExpr extends HirExprBase {
  readonly kind: 'ConditionalExpr';
  readonly condition: HirExpr;
  readonly thenExpr: HirExpr;
  readonly elseExpr: HirExpr;
}

/**
 * Concatenation expression
 */
export interface HirConcatExpr extends HirExprBase {
  readonly kind: 'ConcatExpr';
  readonly elements: HirExpr[];
}

/**
 * Repeat expression (e.g., {4{a}})
 */
export interface HirRepeatExpr extends HirExprBase {
  readonly kind: 'RepeatExpr';
  readonly expr: HirExpr;
  readonly count: number;
}

/**
 * Index expression (e.g., arr[i])
 */
export interface HirIndexExpr extends HirExprBase {
  readonly kind: 'IndexExpr';
  readonly base: HirExpr;
  readonly index: HirExpr;
}

/**
 * Slice expression (e.g., arr[7:0])
 */
export interface HirSliceExpr extends HirExprBase {
  readonly kind: 'SliceExpr';
  readonly base: HirExpr;
  readonly high: HirExpr;
  readonly low: HirExpr;
  /**
   * The operator of a part select, `+:` or `-:`.
   *
   * Without it, `a[i +: 8]` and `a[i -: 8]` both became `a[i:8]`: two different
   * selections collapsed into one, and that one was a fixed slice rather than a
   * moving window.
   */
  readonly partSelect?: '+:' | '-:' | undefined;
}

/**
 * Field access expression (e.g., struct.field)
 */
export interface HirFieldExpr extends HirExprBase {
  readonly kind: 'FieldExpr';
  readonly base: HirExpr;
  readonly field: string;
}

/**
 * Function call expression
 */
export interface HirCallExpr extends HirExprBase {
  readonly kind: 'CallExpr';
  readonly callee: string;
  readonly args: HirExpr[];
}

/**
 * Cast expression
 */
export interface HirCastExpr extends HirExprBase {
  readonly kind: 'CastExpr';
  readonly expr: HirExpr;
  readonly targetType: HirDataType;
}

/**
 * Parenthesized expression (for readability in output)
 */
export interface HirParenExpr extends HirExprBase {
  readonly kind: 'ParenExpr';
  readonly expr: HirExpr;
}

// ==================== Helper Functions ====================

/**
 * Create an integer literal
 */
export function createIntegerLiteral(
  value: bigint,
  width?: number,
  signed = false
): HirIntegerLiteral {
  const dataType: HirLogicType | undefined = width !== undefined
    ? { kind: 'LogicType', width: { kind: 'ConstWidth', value: width }, signed }
    : undefined;

  return {
    kind: 'IntegerLiteral',
    value,
    width,
    signed,
    dataType,
  };
}

/**
 * Create a boolean literal
 */
export function createBoolLiteral(value: boolean): HirBoolLiteral {
  return {
    kind: 'BoolLiteral',
    value,
    dataType: { kind: 'LogicType', width: { kind: 'ConstWidth', value: 1 }, signed: false },
  };
}

/**
 * Create an identifier
 */
export function createIdentifier(name: string, dataType?: HirDataType): HirIdentifier {
  return {
    kind: 'Identifier',
    name,
    dataType,
  };
}

/**
 * Create a unary expression
 */
export function createUnaryExpr(
  op: HirUnaryOp,
  operand: HirExpr,
  dataType?: HirDataType
): HirUnaryExpr {
  return {
    kind: 'UnaryExpr',
    op,
    operand,
    dataType: dataType ?? operand.dataType,
  };
}

/**
 * Create a binary expression
 */
export function createBinaryExpr(
  op: HirBinaryOp,
  left: HirExpr,
  right: HirExpr,
  dataType?: HirDataType
): HirBinaryExpr {
  // For comparison ops, result is always bool
  const isComparison = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'land', 'lor'].includes(op);
  const resultType: HirDataType | undefined = dataType ?? (
    isComparison
      ? { kind: 'LogicType', width: { kind: 'ConstWidth', value: 1 }, signed: false }
      : left.dataType
  );

  return {
    kind: 'BinaryExpr',
    op,
    left,
    right,
    dataType: resultType,
  };
}

/**
 * Create a conditional expression
 */
export function createConditionalExpr(
  condition: HirExpr,
  thenExpr: HirExpr,
  elseExpr: HirExpr
): HirConditionalExpr {
  return {
    kind: 'ConditionalExpr',
    condition,
    thenExpr,
    elseExpr,
    dataType: thenExpr.dataType,
  };
}

/**
 * Create a concatenation expression
 */
export function createConcatExpr(elements: HirExpr[]): HirConcatExpr {
  // Calculate total width
  let totalWidth = 0;
  let allConst = true;

  for (const elem of elements) {
    if (elem.dataType?.kind === 'LogicType') {
      if (elem.dataType.width.kind === 'ConstWidth') {
        totalWidth += elem.dataType.width.value;
      } else {
        allConst = false;
      }
    } else {
      allConst = false;
    }
  }

  const dataType: HirDataType | undefined = allConst
    ? { kind: 'LogicType', width: { kind: 'ConstWidth', value: totalWidth }, signed: false }
    : undefined;

  return {
    kind: 'ConcatExpr',
    elements,
    dataType,
  };
}

/**
 * Create a repeat expression
 */
export function createRepeatExpr(expr: HirExpr, count: number): HirRepeatExpr {
  let dataType: HirDataType | undefined;

  if (expr.dataType?.kind === 'LogicType' && expr.dataType.width.kind === 'ConstWidth') {
    dataType = {
      kind: 'LogicType',
      width: { kind: 'ConstWidth', value: expr.dataType.width.value * count },
      signed: false,
    };
  }

  return {
    kind: 'RepeatExpr',
    expr,
    count,
    dataType,
  };
}

/**
 * Create an index expression
 */
export function createIndexExpr(base: HirExpr, index: HirExpr): HirIndexExpr {
  // For arrays, element type; for logic, single bit
  let dataType: HirDataType | undefined;

  if (base.dataType?.kind === 'ArrayType') {
    dataType = base.dataType.elementType;
  } else if (base.dataType?.kind === 'LogicType') {
    dataType = { kind: 'LogicType', width: { kind: 'ConstWidth', value: 1 }, signed: false };
  }

  return {
    kind: 'IndexExpr',
    base,
    index,
    dataType,
  };
}

/**
 * Create a slice expression
 */
export function createSliceExpr(
  base: HirExpr,
  high: HirExpr,
  low: HirExpr,
  partSelect?: '+:' | '-:'
): HirSliceExpr {
  // Width is high - low + 1 (if both are constants)
  let dataType: HirDataType | undefined;

  if (partSelect) {
    // A part select is as wide as its second operand, whatever the position.
    if (low.kind === 'IntegerLiteral') {
      dataType = {
        kind: 'LogicType',
        width: { kind: 'ConstWidth', value: Number(low.value) },
        signed: false,
      };
    }
  } else if (high.kind === 'IntegerLiteral' && low.kind === 'IntegerLiteral') {
    const width = Number(high.value - low.value) + 1;
    dataType = { kind: 'LogicType', width: { kind: 'ConstWidth', value: width }, signed: false };
  }

  return {
    kind: 'SliceExpr',
    base,
    high,
    low,
    partSelect,
    dataType,
  };
}

/**
 * Create a field access expression
 */
export function createFieldExpr(base: HirExpr, field: string): HirFieldExpr {
  let dataType: HirDataType | undefined;

  if (base.dataType?.kind === 'StructType') {
    const fieldDef = base.dataType.fields.find(f => f.name === field);
    dataType = fieldDef?.type;
  }

  return {
    kind: 'FieldExpr',
    base,
    field,
    dataType,
  };
}

/**
 * Create a function call expression
 */
export function createCallExpr(
  callee: string,
  args: HirExpr[],
  dataType?: HirDataType
): HirCallExpr {
  return {
    kind: 'CallExpr',
    callee,
    args,
    dataType,
  };
}

/**
 * Create a cast expression
 */
export function createCastExpr(expr: HirExpr, targetType: HirDataType): HirCastExpr {
  return {
    kind: 'CastExpr',
    expr,
    targetType,
    dataType: targetType,
  };
}


/**
 * A string literal.
 *
 * Not synthesizable on its own, but `$display("...")` needs one, and lowering
 * it to `0` turned every message a testbench prints into a zero.
 */
export interface HirStringLiteral extends HirExprBase {
  readonly kind: 'StringLiteral';
  readonly value: string;
}
