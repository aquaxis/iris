/**
 * SystemVerilog Data Types
 *
 * Represents SystemVerilog data types for code generation.
 */

/**
 * Base SV AST node
 */
export interface SvNode {
  readonly kind: string;
}

// ==================== Data Types ====================

/**
 * SystemVerilog data type
 */
export type SvDataType =
  | SvLogicType
  | SvRegType
  | SvWireType
  | SvIntType
  | SvIntegerType
  | SvEnumType
  | SvStructType
  | SvArrayType
  | SvPackedArrayType
  | SvUserDefinedType;

/**
 * Logic type (logic [N-1:0])
 */
export interface SvLogicType {
  readonly kind: 'SvLogicType';
  readonly width: SvWidth;
  readonly signed: boolean;
}

/**
 * Reg type (reg [N-1:0]) - for compatibility
 */
export interface SvRegType {
  readonly kind: 'SvRegType';
  readonly width: SvWidth;
  readonly signed: boolean;
}

/**
 * Wire type (wire [N-1:0])
 */
export interface SvWireType {
  readonly kind: 'SvWireType';
  readonly width: SvWidth;
  readonly signed: boolean;
}

/**
 * Int type (int)
 */
export interface SvIntType {
  readonly kind: 'SvIntType';
  readonly unsigned: boolean;
}

/**
 * Integer type (integer)
 */
export interface SvIntegerType {
  readonly kind: 'SvIntegerType';
}

/**
 * Enum type reference
 */
export interface SvEnumType {
  readonly kind: 'SvEnumType';
  readonly name: string;
}

/**
 * Struct type reference
 */
export interface SvStructType {
  readonly kind: 'SvStructType';
  readonly name: string;
}

/**
 * Unpacked array type (type name [size])
 */
export interface SvArrayType {
  readonly kind: 'SvArrayType';
  readonly elementType: SvDataType;
  readonly dimensions: SvWidth[];
}

/**
 * Packed array type (type [size-1:0])
 */
export interface SvPackedArrayType {
  readonly kind: 'SvPackedArrayType';
  readonly elementType: SvDataType;
  readonly width: SvWidth;
}

/**
 * User-defined type reference
 */
export interface SvUserDefinedType {
  readonly kind: 'SvUserDefinedType';
  readonly name: string;
}

// ==================== Width ====================

/**
 * Width expression
 */
export type SvWidth =
  | SvConstWidth
  | SvParamWidth
  | SvExprWidth;

/**
 * Constant width
 */
export interface SvConstWidth {
  readonly kind: 'SvConstWidth';
  readonly value: number;
}

/**
 * Parameter-based width
 */
export interface SvParamWidth {
  readonly kind: 'SvParamWidth';
  readonly param: string;
}

/**
 * Expression-based width
 */
export interface SvExprWidth {
  readonly kind: 'SvExprWidth';
  readonly expr: string;  // Expression as string for simplicity
}

// ==================== Helper Functions ====================

/**
 * Create a constant width
 */
export function constWidth(value: number): SvConstWidth {
  return { kind: 'SvConstWidth', value };
}

/**
 * Create a parameter width
 */
export function paramWidth(param: string): SvParamWidth {
  return { kind: 'SvParamWidth', param };
}

/**
 * Create an expression width
 */
export function exprWidth(expr: string): SvExprWidth {
  return { kind: 'SvExprWidth', expr };
}

/**
 * Create a logic type
 */
export function logicType(width: SvWidth | number, signed = false): SvLogicType {
  return {
    kind: 'SvLogicType',
    width: typeof width === 'number' ? constWidth(width) : width,
    signed,
  };
}

/**
 * Create a wire type
 */
export function wireType(width: SvWidth | number, signed = false): SvWireType {
  return {
    kind: 'SvWireType',
    width: typeof width === 'number' ? constWidth(width) : width,
    signed,
  };
}

/**
 * Create a reg type
 */
export function regType(width: SvWidth | number, signed = false): SvRegType {
  return {
    kind: 'SvRegType',
    width: typeof width === 'number' ? constWidth(width) : width,
    signed,
  };
}

/**
 * Create an int type
 */
export function intType(unsigned = false): SvIntType {
  return { kind: 'SvIntType', unsigned };
}

/**
 * Create an integer type
 */
export function integerType(): SvIntegerType {
  return { kind: 'SvIntegerType' };
}

/**
 * Create an enum type reference
 */
export function enumType(name: string): SvEnumType {
  return { kind: 'SvEnumType', name };
}

/**
 * Create a struct type reference
 */
export function structType(name: string): SvStructType {
  return { kind: 'SvStructType', name };
}

/**
 * Create an unpacked array type
 */
export function arrayType(elementType: SvDataType, ...dimensions: (SvWidth | number)[]): SvArrayType {
  return {
    kind: 'SvArrayType',
    elementType,
    dimensions: dimensions.map(d => typeof d === 'number' ? constWidth(d) : d),
  };
}

/**
 * Create a packed array type
 */
export function packedArrayType(elementType: SvDataType, width: SvWidth | number): SvPackedArrayType {
  return {
    kind: 'SvPackedArrayType',
    elementType,
    width: typeof width === 'number' ? constWidth(width) : width,
  };
}

/**
 * Create a user-defined type reference
 */
export function userDefinedType(name: string): SvUserDefinedType {
  return { kind: 'SvUserDefinedType', name };
}

/**
 * Check if width is 1 (single bit)
 */
export function isSingleBit(width: SvWidth): boolean {
  return width.kind === 'SvConstWidth' && width.value === 1;
}

/**
 * Get width value if constant
 */
export function getConstWidthValue(width: SvWidth): number | undefined {
  return width.kind === 'SvConstWidth' ? width.value : undefined;
}
