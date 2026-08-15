import type { HirDataType } from '@iris2sv/core';
import { mapWidth, renderWidthExpr } from './type-mapper.js';
import type { WidthExpr } from './type-mapper.js';
import type { SvWidth } from '@iris2sv/sv-backend';
import { constWidth, exprWidth } from '@iris2sv/sv-backend';
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
  stringLiteral,
  identifier,
  unary,
  binary,
  sizeCast,
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

    case 'StringLiteral':
      return stringLiteral(expr.value);

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
        transformExpr(expr.low, context),
        expr.partSelect
      );

    case 'FieldExpr':
      return member(
        transformExpr(expr.base, context),
        expr.field
      );

    case 'CallExpr': {
      // Width-carrying methods become SystemVerilog size casts.
      //   x.sign_extend[32]()  ->  32'($signed(x))
      //   x.extend[32]()       ->  32'(x)
      //   x.truncate[8]()      ->  8'(x)
      // The signed cast is what makes the first one replicate the sign bit.
      // The size cast is what does the other two: SystemVerilog zero-pads when
      // the cast is wider and drops the high bits when it is narrower, which is
      // extend and truncate respectively. `resize` is whichever of the two the
      // widths call for, so it is the same cast again.
      if (['sign_extend', 'extend', 'truncate', 'resize'].includes(expr.callee)
          && expr.args.length === 2) {
        const value = transformExpr(expr.args[0]!, context);
        const widthExpr = expr.args[1]!;
        // A width that is not a literal is still a constant expression, and it
        // has to be written out. Emitting the string `/* width */` produced
        // `wr_ptr <= /* width */'(...)`, which is not SystemVerilog, and
        // iris2sv reported the file as converted.
        const width: SvWidth = widthExpr.kind === 'IntegerLiteral'
          ? constWidth(Number(widthExpr.value))
          : exprWidth(renderWidthExpr(widthExpr as unknown as WidthExpr));
        const inner = expr.callee === 'sign_extend'
          ? call('$signed', value)
          : value;
        return sizeCast(width, inner);
      }
      return call(
        expr.callee,
        ...expr.args.map(a => transformExpr(a, context))
      );
    }

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
  expr: { op: HirBinaryOp; left: HirExpr; right: HirExpr; dataType?: HirDataType | undefined },
  context: ExprTransformerContext
): SvExpr {
  const left = transformExpr(expr.left, context);
  const right = transformExpr(expr.right, context);
  const op = mapBinaryOp(expr.op);
  const result = binary(left, op, right);

  // IRIS evaluates arithmetic in the width of its operands; SystemVerilog
  // widens to at least 32 bits. A size cast restores the IRIS width, which
  // matters as soon as the result is shifted, compared or concatenated:
  // without it, `(p + 1) >> 1` keeps a carry bit that IRIS would have dropped.
  if (TRUNCATING_OPS.has(expr.op)) {
    const dt = expr.dataType;
    if (dt && dt.kind === 'LogicType') {
      return sizeCast(mapWidth(dt.width), result);
    }
  }

  return result;
}

/** Operators whose SystemVerilog result can be wider than the IRIS one. */
const TRUNCATING_OPS = new Set<HirBinaryOp>(['add', 'sub', 'mul', 'shl']);

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
