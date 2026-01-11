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
export function mapWidth(width: HirWidth): SvWidth {
  switch (width.kind) {
    case 'ConstWidth':
      return constWidth(width.value);
    case 'ParamWidth':
      return paramWidth(width.param);
    case 'ExprWidth':
      // For expression widths, emit as string
      // This is a simplification; in practice we'd convert the expression
      return exprWidth('/* expr */');
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
