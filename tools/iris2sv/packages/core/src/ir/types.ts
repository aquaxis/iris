/**
 * HIR Data Types
 *
 * Represents hardware data types in the intermediate representation.
 */

/**
 * Base HIR node interface
 */
export interface HirNode {
  readonly kind: string;
}

/**
 * Width expression - can be a constant or a parameter reference
 */
export type HirWidth =
  | HirConstWidth
  | HirParamWidth
  | HirExprWidth;

export interface HirConstWidth {
  readonly kind: 'ConstWidth';
  readonly value: number;
}

export interface HirParamWidth {
  readonly kind: 'ParamWidth';
  readonly param: string;
}

export interface HirExprWidth {
  readonly kind: 'ExprWidth';
  readonly expr: HirExpr;
}

/**
 * HIR Data Type
 */
export type HirDataType =
  | HirLogicType
  | HirEnumType
  | HirStructType
  | HirArrayType
  | HirTupleType;

/**
 * Logic type (maps to SystemVerilog logic)
 */
export interface HirLogicType {
  readonly kind: 'LogicType';
  readonly width: HirWidth;
  readonly signed: boolean;
}

/**
 * Enum type
 */
export interface HirEnumType {
  readonly kind: 'EnumType';
  readonly name: string;
  readonly variants: HirEnumVariant[];
  readonly width: HirWidth;
}

export interface HirEnumVariant {
  readonly name: string;
  readonly value: number | undefined;
}

/**
 * Struct type (maps to SystemVerilog packed struct)
 */
export interface HirStructType {
  readonly kind: 'StructType';
  readonly name: string;
  readonly fields: HirStructField[];
}

export interface HirStructField {
  readonly name: string;
  readonly type: HirDataType;
}

/**
 * Array type
 */
export interface HirArrayType {
  readonly kind: 'ArrayType';
  readonly elementType: HirDataType;
  readonly size: HirWidth;
}

/**
 * Tuple type (maps to packed struct in SystemVerilog)
 */
export interface HirTupleType {
  readonly kind: 'TupleType';
  readonly elements: HirDataType[];
}

// Forward declaration for expressions
export interface HirExpr extends HirNode {
  readonly kind: string;
  readonly dataType: HirDataType | undefined;
}

/**
 * Create a logic type with constant width
 */
export function createLogicType(width: number, signed = false): HirLogicType {
  return {
    kind: 'LogicType',
    width: { kind: 'ConstWidth', value: width },
    signed,
  };
}

/**
 * Create a logic type with parameter width
 */
export function createParamLogicType(param: string, signed = false): HirLogicType {
  return {
    kind: 'LogicType',
    width: { kind: 'ParamWidth', param },
    signed,
  };
}

/**
 * Create a single-bit logic type (bool)
 */
export function createBoolType(): HirLogicType {
  return createLogicType(1, false);
}

/**
 * Create an enum type
 */
export function createEnumType(name: string, variants: string[], values?: number[]): HirEnumType {
  const enumVariants: HirEnumVariant[] = variants.map((v, i) => ({
    name: v,
    value: values ? values[i] : undefined,
  }));

  // Calculate width needed to represent all variants
  const numVariants = variants.length;
  const width = Math.max(1, Math.ceil(Math.log2(numVariants)));

  return {
    kind: 'EnumType',
    name,
    variants: enumVariants,
    width: { kind: 'ConstWidth', value: width },
  };
}

/**
 * Create a struct type
 */
export function createStructType(name: string, fields: { name: string; type: HirDataType }[]): HirStructType {
  return {
    kind: 'StructType',
    name,
    fields: fields.map(f => ({ name: f.name, type: f.type })),
  };
}

/**
 * Create an array type
 */
export function createArrayType(elementType: HirDataType, size: number): HirArrayType {
  return {
    kind: 'ArrayType',
    elementType,
    size: { kind: 'ConstWidth', value: size },
  };
}

/**
 * Create a tuple type
 */
export function createTupleType(elements: HirDataType[]): HirTupleType {
  return {
    kind: 'TupleType',
    elements,
  };
}

/**
 * Get the bit width of a data type (returns undefined if width is parameter-dependent)
 */
export function getTypeWidth(type: HirDataType): number | undefined {
  switch (type.kind) {
    case 'LogicType':
      return type.width.kind === 'ConstWidth' ? type.width.value : undefined;

    case 'EnumType':
      return type.width.kind === 'ConstWidth' ? type.width.value : undefined;

    case 'StructType': {
      let total = 0;
      for (const field of type.fields) {
        const fieldWidth = getTypeWidth(field.type);
        if (fieldWidth === undefined) return undefined;
        total += fieldWidth;
      }
      return total;
    }

    case 'ArrayType': {
      const elemWidth = getTypeWidth(type.elementType);
      const size = type.size.kind === 'ConstWidth' ? type.size.value : undefined;
      if (elemWidth === undefined || size === undefined) return undefined;
      return elemWidth * size;
    }

    case 'TupleType': {
      let total = 0;
      for (const elem of type.elements) {
        const elemWidth = getTypeWidth(elem);
        if (elemWidth === undefined) return undefined;
        total += elemWidth;
      }
      return total;
    }
  }
}

/**
 * Check if two types are equal
 */
export function typesEqual(a: HirDataType, b: HirDataType): boolean {
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case 'LogicType': {
      const bLogic = b as HirLogicType;
      if (a.signed !== bLogic.signed) return false;
      if (a.width.kind !== bLogic.width.kind) return false;
      if (a.width.kind === 'ConstWidth' && bLogic.width.kind === 'ConstWidth') {
        return a.width.value === bLogic.width.value;
      }
      if (a.width.kind === 'ParamWidth' && bLogic.width.kind === 'ParamWidth') {
        return a.width.param === bLogic.width.param;
      }
      return false;
    }

    case 'EnumType': {
      const bEnum = b as HirEnumType;
      return a.name === bEnum.name;
    }

    case 'StructType': {
      const bStruct = b as HirStructType;
      return a.name === bStruct.name;
    }

    case 'ArrayType': {
      const bArray = b as HirArrayType;
      if (!typesEqual(a.elementType, bArray.elementType)) return false;
      if (a.size.kind !== bArray.size.kind) return false;
      if (a.size.kind === 'ConstWidth' && bArray.size.kind === 'ConstWidth') {
        return a.size.value === bArray.size.value;
      }
      return false;
    }

    case 'TupleType': {
      const bTuple = b as HirTupleType;
      if (a.elements.length !== bTuple.elements.length) return false;
      for (let i = 0; i < a.elements.length; i++) {
        const aElem = a.elements[i];
        const bElem = bTuple.elements[i];
        if (aElem === undefined || bElem === undefined) return false;
        if (!typesEqual(aElem, bElem)) return false;
      }
      return true;
    }
  }
}

/**
 * Convert type to string for debugging
 */
export function typeToString(type: HirDataType): string {
  switch (type.kind) {
    case 'LogicType': {
      const sign = type.signed ? 'int' : 'uint';
      if (type.width.kind === 'ConstWidth') {
        if (type.width.value === 1 && !type.signed) return 'bool';
        return `${sign}[${type.width.value}]`;
      }
      if (type.width.kind === 'ParamWidth') {
        return `${sign}[${type.width.param}]`;
      }
      return `${sign}[?]`;
    }

    case 'EnumType':
      return type.name;

    case 'StructType':
      return type.name;

    case 'ArrayType': {
      const elemStr = typeToString(type.elementType);
      if (type.size.kind === 'ConstWidth') {
        return `[${elemStr}; ${type.size.value}]`;
      }
      return `[${elemStr}; ?]`;
    }

    case 'TupleType': {
      const elemStrs = type.elements.map(typeToString);
      return `(${elemStrs.join(', ')})`;
    }
  }
}
