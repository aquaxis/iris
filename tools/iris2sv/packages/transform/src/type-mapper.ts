/**
 * Type Mapper
 *
 * Maps HIR data types to SystemVerilog data types.
 */

import type {
  HirDataType,
  HirLogicType,
  HirEnumType,
  HirStructType,
  HirArrayType,
  HirTupleType,
  HirWidth,
} from '@iris2sv/core';

import type {
  SvDataType,
  SvWidth} from '@iris2sv/sv-backend';
import {
  logicType,
  enumType,
  structType,
  arrayType,
  constWidth,
  paramWidth,
  exprWidth,
} from '@iris2sv/sv-backend';

/**
 * Type mapping context for custom type resolution
 */
export interface TypeMapperContext {
  /**
   * Registered type definitions
   */
  typeDefs: Map<string, HirDataType>;
}

/**
 * Create a new type mapper context
 */
export function createTypeMapperContext(): TypeMapperContext {
  return {
    typeDefs: new Map(),
  };
}

/**
 * Map HIR width to SV width
 */
/**
 * Render a width expression
 *
 * A width is a constant expression: a parameter, a literal, arithmetic over
 * those, or `$clog2` of one. That subset is rendered here rather than by the
 * general expression transformer, which imports this module and would make the
 * dependency circular.
 *
 * An expression outside the subset throws. It used to return the string
 * `/* expr *\/`, which was emitted into the port declaration verbatim:
 *
 *   input logic [/* expr *\/-1:0] wr_data
 *
 * That is not a width, and iris2sv reported the file as converted. A round trip
 * through sv2iris produces `bit[DataWidth - 1 + 1]`, which is exactly this
 * shape, so the output silently became a design with two-bit ports. Refusing is
 * the only honest option when the width cannot be written down.
 */
export type WidthExpr = { readonly kind: string } & Record<string, unknown>;

/**
 * HIR spells its operators as words; SystemVerilog wants the symbols
 *
 * expr-transformer.ts has the full table, and importing it here would make the
 * dependency circular, so the arithmetic subset a width can use is repeated.
 */
const WIDTH_OPS: Record<string, string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  mod: '%',
  shl: '<<',
  shr: '>>',
};

const WIDTH_UNARY_OPS: Record<string, string> = {
  neg: '-',
  pos: '+',
};

export function renderWidthExpr(expr: WidthExpr): string {
  // `HirExprWidth.expr` carries the forward declaration in core/ir/types.ts,
  // whose only field is `kind`, so the shape is narrowed structurally here.
  const e = expr;
  switch (e.kind) {
    case 'IntegerLiteral':
      return String(e.value);
    case 'Identifier':
      return String(e.name);
    case 'ParenExpr':
      return `(${renderWidthExpr(e.expr as WidthExpr)})`;
    case 'UnaryExpr': {
      const op = WIDTH_UNARY_OPS[String(e.op)];
      if (op === undefined) {
        throw new Error(`A width cannot use the operator '${String(e.op)}'`);
      }
      return `(${op}${renderWidthExpr(e.operand as WidthExpr)})`;
    }
    case 'BinaryExpr': {
      const op = WIDTH_OPS[String(e.op)];
      if (op === undefined) {
        throw new Error(`A width cannot use the operator '${String(e.op)}'`);
      }
      return `(${renderWidthExpr(e.left as WidthExpr)} ${op} ${renderWidthExpr(e.right as WidthExpr)})`;
    }
    case 'CallExpr':
      return `${String(e.callee)}(${(e.args as WidthExpr[]).map(renderWidthExpr).join(', ')})`;
    default:
      throw new Error(
        `A width must be a constant expression; '${e.kind}' cannot be written as one`
      );
  }
}

export function mapWidth(width: HirWidth): SvWidth {
  switch (width.kind) {
    case 'ConstWidth':
      return constWidth(width.value);
    case 'ParamWidth':
      return paramWidth(width.param);
    case 'ExprWidth':
      return exprWidth(renderWidthExpr(width.expr as unknown as WidthExpr));
    default: {
      const _exhaustive: never = width;
      throw new Error(`Unknown width kind: ${(_exhaustive as HirWidth).kind}`);
    }
  }
}

/**
 * Map HIR data type to SV data type
 */
export function mapDataType(hirType: HirDataType, _context?: TypeMapperContext): SvDataType {
  switch (hirType.kind) {
    case 'LogicType':
      return mapLogicType(hirType);

    case 'EnumType':
      return mapEnumType(hirType);

    case 'StructType':
      return mapStructType(hirType);

    case 'ArrayType':
      return mapArrayType(hirType, _context);

    case 'TupleType':
      return mapTupleType(hirType, _context);

    default: {
      const _exhaustive: never = hirType;
      throw new Error(`Unknown type kind: ${(_exhaustive as HirDataType).kind}`);
    }
  }
}

/**
 * Map HIR logic type to SV logic type
 */
function mapLogicType(hir: HirLogicType): SvDataType {
  return logicType(mapWidth(hir.width), hir.signed);
}

/**
 * Map HIR enum type to SV enum type reference
 */
function mapEnumType(hir: HirEnumType): SvDataType {
  return enumType(hir.name);
}

/**
 * Map HIR struct type to SV struct type reference
 */
function mapStructType(hir: HirStructType): SvDataType {
  return structType(hir.name);
}

/**
 * Map HIR array type to SV unpacked array type
 */
function mapArrayType(hir: HirArrayType, context?: TypeMapperContext): SvDataType {
  const elementType = mapDataType(hir.elementType, context);
  const size = mapWidth(hir.size);
  return arrayType(elementType, size);
}

/**
 * Map HIR tuple type to SV packed struct
 *
 * Tuples are mapped to anonymous packed structs with fields named _0, _1, etc.
 * Note: The actual struct definition should be generated separately.
 */
function mapTupleType(hir: HirTupleType, _context?: TypeMapperContext): SvDataType {
  // Generate a name for the tuple struct based on its contents
  const tupleName = generateTupleName(hir);
  return structType(tupleName);
}

/**
 * Generate a unique name for a tuple type
 */
function generateTupleName(hir: HirTupleType): string {
  // Create a name based on the element types
  const typeNames = hir.elements.map(getTypeShortName).join('_');
  return `tuple_${typeNames}`;
}

/**
 * Get a short name for a type (for tuple naming)
 */
function getTypeShortName(type: HirDataType): string {
  switch (type.kind) {
    case 'LogicType':
      if (type.width.kind === 'ConstWidth') {
        const prefix = type.signed ? 'i' : 'u';
        return `${prefix}${type.width.value}`;
      }
      return type.signed ? 'int' : 'uint';

    case 'EnumType':
      return type.name;

    case 'StructType':
      return type.name;

    case 'ArrayType':
      return `arr`;

    case 'TupleType':
      return `tup${type.elements.length}`;

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown type kind: ${(_exhaustive as HirDataType).kind}`);
    }
  }
}

/**
 * Type mapper class for more complex transformations
 */
export class TypeMapper {
  private readonly context: TypeMapperContext;
  private readonly tupleStructs: Map<string, HirTupleType>;

  constructor(context?: TypeMapperContext) {
    this.context = context ?? createTypeMapperContext();
    this.tupleStructs = new Map();
  }

  /**
   * Map a data type
   */
  mapType(hirType: HirDataType): SvDataType {
    if (hirType.kind === 'TupleType') {
      // Track tuple structs that need to be generated
      const name = generateTupleName(hirType);
      if (!this.tupleStructs.has(name)) {
        this.tupleStructs.set(name, hirType);
      }
    }
    return mapDataType(hirType, this.context);
  }

  /**
   * Map width
   */
  mapWidth(width: HirWidth): SvWidth {
    return mapWidth(width);
  }

  /**
   * Get all tuple structs that need to be generated
   */
  getTupleStructs(): Map<string, HirTupleType> {
    return this.tupleStructs;
  }

  /**
   * Register a type definition
   */
  registerTypeDef(name: string, type: HirDataType): void {
    this.context.typeDefs.set(name, type);
  }
}

/**
 * Create a type mapper
 */
export function createTypeMapper(context?: TypeMapperContext): TypeMapper {
  return new TypeMapper(context);
}
