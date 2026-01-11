/**
 * Expression Transformer
 *
 * Transforms HIR expressions to SystemVerilog expressions.
 */

import type {
  HirExpr,
  HirUnaryOp,
  HirBinaryOp,
} from '@iris2sv/core';

import type {
  SvExpr,
  SvUnaryOp,
  SvBinaryOp} from '@iris2sv/sv-backend';
import {
  intLiteral,
  identifier,
  unary,
  binary,
  ternary,
  call,
  index,
  slice,
  member,
  concat,
  replicate,
  cast,
  paren,
  num,
} from '@iris2sv/sv-backend';

import { TypeMapper } from './type-mapper.js';

/**
 * Expression transformer context
 */
export interface ExprTransformerContext {
  typeMapper: TypeMapper;
}

/**
 * Create an expression transformer context
 */
export function createExprTransformerContext(typeMapper?: TypeMapper): ExprTransformerContext {
  return {
    typeMapper: typeMapper ?? new TypeMapper(),
  };
}

/**
 * Transform HIR expression to SV expression
 */
export function transformExpr(expr: HirExpr, context: ExprTransformerContext): SvExpr {
  switch (expr.kind) {
    case 'IntegerLiteral':
      return transformIntegerLiteral({ value: expr.value, width: expr.width, signed: expr.signed });

    case 'BoolLiteral':
      return transformBoolLiteral(expr);

    case 'EnumLiteral':
      return transformEnumLiteral(expr);

    case 'Identifier':
      return identifier(expr.name);

    case 'UnaryExpr':
      return transformUnaryExpr(expr, context);

    case 'BinaryExpr':
      return transformBinaryExpr(expr, context);

    case 'ConditionalExpr':
      return ternary(
        transformExpr(expr.condition, context),
        transformExpr(expr.thenExpr, context),
        transformExpr(expr.elseExpr, context)
      );

    case 'ConcatExpr':
      return concat(...expr.elements.map(e => transformExpr(e, context)));

    case 'RepeatExpr':
      return replicate(
        num(expr.count),
        transformExpr(expr.expr, context)
      );

    case 'IndexExpr':
      return index(
        transformExpr(expr.base, context),
        transformExpr(expr.index, context)
      );

    case 'SliceExpr':
      return slice(
        transformExpr(expr.base, context),
        transformExpr(expr.high, context),
        transformExpr(expr.low, context)
      );

    case 'FieldExpr':
      return member(
        transformExpr(expr.base, context),
        expr.field
      );

    case 'CallExpr':
      return call(
        expr.callee,
        ...expr.args.map(a => transformExpr(a, context))
      );

    case 'CastExpr': {
      const targetType = context.typeMapper.mapType(expr.targetType);
      return cast(targetType, transformExpr(expr.expr, context));
    }

    case 'ParenExpr':
      return paren(transformExpr(expr.expr, context));

    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unknown expression kind: ${(_exhaustive as HirExpr).kind}`);
    }
  }
}

/**
 * Transform integer literal
 */
function transformIntegerLiteral(expr: { value: bigint; width: number | undefined; signed: boolean }): SvExpr {
  const radix = determineRadix(expr.value, expr.width);
  return intLiteral(expr.value, expr.width, radix, expr.signed);
}

/**
 * Determine appropriate radix for integer literal
 */
function determineRadix(value: bigint, width?: number): 'b' | 'o' | 'd' | 'h' | undefined {
  // Small values: no radix
  if (value >= 0n && value < 10n && width === undefined) {
    return undefined;
  }

  // If width is specified, use hex for larger values
  if (width !== undefined && width > 8) {
    return 'h';
  }

  // For values that fit in 8 bits, decimal is fine
  if (value >= 0n && value < 256n) {
    return undefined;
  }

  // Larger values: hex
  return 'h';
}

/**
 * Transform boolean literal
 */
function transformBoolLiteral(expr: { value: boolean }): SvExpr {
  return intLiteral(expr.value ? 1 : 0, 1, 'b');
}

/**
 * Transform enum literal
 */
function transformEnumLiteral(expr: { enumType: { name: string }; variant: string }): SvExpr {
  // In SV, enum values are accessed as TypeName::VariantName
  return identifier(`${expr.enumType.name}::${expr.variant}`);
}

/**
 * Transform unary expression
 */
function transformUnaryExpr(
  expr: { op: HirUnaryOp; operand: HirExpr },
  context: ExprTransformerContext
): SvExpr {
  const operand = transformExpr(expr.operand, context);
  const op = mapUnaryOp(expr.op);
  return unary(op, operand);
}

/**
 * Map HIR unary operator to SV unary operator
 */
function mapUnaryOp(op: HirUnaryOp): SvUnaryOp {
  switch (op) {
    case 'not':
      return '!';
    case 'bitnot':
      return '~';
    case 'neg':
      return '-';
    case 'and_reduce':
      return '&';
    case 'or_reduce':
      return '|';
    case 'xor_reduce':
      return '^';
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown unary op: ${_exhaustive}`);
    }
  }
}

/**
 * Transform binary expression
 */
function transformBinaryExpr(
  expr: { op: HirBinaryOp; left: HirExpr; right: HirExpr },
  context: ExprTransformerContext
): SvExpr {
  const left = transformExpr(expr.left, context);
  const right = transformExpr(expr.right, context);
  const op = mapBinaryOp(expr.op);
  return binary(left, op, right);
}

/**
 * Map HIR binary operator to SV binary operator
 */
function mapBinaryOp(op: HirBinaryOp): SvBinaryOp {
  switch (op) {
    // Arithmetic
    case 'add':
      return '+';
    case 'sub':
      return '-';
    case 'mul':
      return '*';
    case 'div':
      return '/';
    case 'mod':
      return '%';

    // Bitwise
    case 'and':
      return '&';
    case 'or':
      return '|';
    case 'xor':
      return '^';
    case 'shl':
      return '<<';
    case 'shr':
      return '>>';
    case 'ashr':
      return '>>>';

    // Comparison
    case 'eq':
      return '==';
    case 'ne':
      return '!=';
    case 'lt':
      return '<';
    case 'le':
      return '<=';
    case 'gt':
      return '>';
    case 'ge':
      return '>=';

    // Logical
    case 'land':
      return '&&';
    case 'lor':
      return '||';

    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown binary op: ${_exhaustive}`);
    }
  }
}

/**
 * Expression transformer class
 */
export class ExprTransformer {
  private readonly context: ExprTransformerContext;

  constructor(context?: ExprTransformerContext) {
    this.context = context ?? createExprTransformerContext();
  }

  /**
   * Get the type mapper
   */
  get typeMapper(): TypeMapper {
    return this.context.typeMapper;
  }

  /**
   * Transform an expression
   */
  transform(expr: HirExpr): SvExpr {
    return transformExpr(expr, this.context);
  }
}

/**
 * Create an expression transformer
 */
export function createExprTransformer(typeMapper?: TypeMapper): ExprTransformer {
  return new ExprTransformer(createExprTransformerContext(typeMapper));
}
