/**
 * IRIS Type System
 *
 * Defines the resolved type representations used during type checking.
 * These types are resolved from AST TypeExpr nodes and used for
 * type equality, assignability, and compatibility checks.
 */

/**
 * Type kind enumeration
 */
export enum TypeKind {
  // Error type (for error recovery)
  Error = 'Error',

  // Primitive types
  Bit = 'Bit',
  Int = 'Int',
  Uint = 'Uint',
  Bool = 'Bool',
  Clock = 'Clock',
  Reset = 'Reset',
  String = 'String',

  // Compound types
  Array = 'Array',
  Tuple = 'Tuple',

  // User-defined types
  Enum = 'Enum',
  Struct = 'Struct',

  // Reference types
  TypeAlias = 'TypeAlias',
  Generic = 'Generic',

  // Special types
  Inferred = 'Inferred',
  Never = 'Never',
  Unit = 'Unit',
}

/**
 * Base type interface
 */
export interface TypeBase {
  readonly kind: TypeKind;
}

/**
 * Error type - used for error recovery
 */
export interface ErrorType extends TypeBase {
  readonly kind: TypeKind.Error;
  readonly message: string;
}

/**
 * Bit type - bit, bit[N]
 */
export interface BitType extends TypeBase {
  readonly kind: TypeKind.Bit;
  readonly width: number | undefined; // undefined means single bit
}

/**
 * Signed integer type - int[N]
 */
export interface IntType extends TypeBase {
  readonly kind: TypeKind.Int;
  readonly width: number;
}

/**
 * Unsigned integer type - uint[N]
 */
export interface UintType extends TypeBase {
  readonly kind: TypeKind.Uint;
  readonly width: number;
}

/**
 * Boolean type
 */
export interface BoolType extends TypeBase {
  readonly kind: TypeKind.Bool;
}

/**
 * Clock type
 */
export interface ClockType extends TypeBase {
  readonly kind: TypeKind.Clock;
}

/**
 * Reset type
 */
export interface ResetType extends TypeBase {
  readonly kind: TypeKind.Reset;
  readonly isAsync: boolean;
}

/**
 * String type (for parameters/attributes)
 */
export interface StringType extends TypeBase {
  readonly kind: TypeKind.String;
}

/**
 * Array type - T[N]
 */
export interface ArrayType extends TypeBase {
  readonly kind: TypeKind.Array;
  readonly elementType: IrisType;
  readonly size: number;
}

/**
 * Tuple type - (T1, T2, ...)
 */
export interface TupleType extends TypeBase {
  readonly kind: TypeKind.Tuple;
  readonly elements: IrisType[];
}

/**
 * Enum type reference
 */
export interface EnumType extends TypeBase {
  readonly kind: TypeKind.Enum;
  readonly name: string;
  readonly modulePath: string[];
  readonly variants: string[];
}

/**
 * Struct type reference
 */
export interface StructType extends TypeBase {
  readonly kind: TypeKind.Struct;
  readonly name: string;
  readonly modulePath: string[];
  readonly fields: StructField[];
}

/**
 * Struct field
 */
export interface StructField {
  readonly name: string;
  readonly type: IrisType;
}

/**
 * Type alias reference
 */
export interface TypeAliasType extends TypeBase {
  readonly kind: TypeKind.TypeAlias;
  readonly name: string;
  readonly modulePath: string[];
  readonly resolvedType: IrisType;
}

/**
 * Generic type parameter reference
 */
export interface GenericType extends TypeBase {
  readonly kind: TypeKind.Generic;
  readonly name: string;
  readonly constraint: IrisType | undefined;
}

/**
 * Inferred type (to be resolved)
 */
export interface InferredType extends TypeBase {
  readonly kind: TypeKind.Inferred;
}

/**
 * Never type (unreachable)
 */
export interface NeverType extends TypeBase {
  readonly kind: TypeKind.Never;
}

/**
 * Unit type (void)
 */
export interface UnitType extends TypeBase {
  readonly kind: TypeKind.Unit;
}

/**
 * Union of all IRIS types
 */
export type IrisType =
  | ErrorType
  | BitType
  | IntType
  | UintType
  | BoolType
  | ClockType
  | ResetType
  | StringType
  | ArrayType
  | TupleType
  | EnumType
  | StructType
  | TypeAliasType
  | GenericType
  | InferredType
  | NeverType
  | UnitType;

// ==================== Type Constructors ====================

/**
 * Create an error type
 */
export function errorType(message: string): ErrorType {
  return { kind: TypeKind.Error, message };
}

/**
 * Create a bit type
 */
export function bitType(width?: number): BitType {
  return { kind: TypeKind.Bit, width };
}

/**
 * Create a signed integer type
 */
export function intType(width: number): IntType {
  return { kind: TypeKind.Int, width };
}

/**
 * Create an unsigned integer type
 */
export function uintType(width: number): UintType {
  return { kind: TypeKind.Uint, width };
}

/**
 * Create a boolean type
 */
export function boolType(): BoolType {
  return { kind: TypeKind.Bool };
}

/**
 * Create a clock type
 */
export function clockType(): ClockType {
  return { kind: TypeKind.Clock };
}

/**
 * Create a reset type
 */
export function resetType(isAsync = false): ResetType {
  return { kind: TypeKind.Reset, isAsync };
}

/**
 * Create a string type
 */
export function stringType(): StringType {
  return { kind: TypeKind.String };
}

/**
 * Create an array type
 */
export function arrayType(elementType: IrisType, size: number): ArrayType {
  return { kind: TypeKind.Array, elementType, size };
}

/**
 * Create a tuple type
 */
export function tupleType(elements: IrisType[]): TupleType {
  return { kind: TypeKind.Tuple, elements };
}

/**
 * Create an enum type
 */
export function enumType(
  name: string,
  modulePath: string[],
  variants: string[]
): EnumType {
  return { kind: TypeKind.Enum, name, modulePath, variants };
}

/**
 * Create a struct type
 */
export function structType(
  name: string,
  modulePath: string[],
  fields: StructField[]
): StructType {
  return { kind: TypeKind.Struct, name, modulePath, fields };
}

/**
 * Create a type alias type
 */
export function typeAliasType(
  name: string,
  modulePath: string[],
  resolvedType: IrisType
): TypeAliasType {
  return { kind: TypeKind.TypeAlias, name, modulePath, resolvedType };
}

/**
 * Create a generic type
 */
export function genericType(
  name: string,
  constraint?: IrisType
): GenericType {
  return { kind: TypeKind.Generic, name, constraint };
}

/**
 * Create an inferred type
 */
export function inferredType(): InferredType {
  return { kind: TypeKind.Inferred };
}

/**
 * Create a never type
 */
export function neverType(): NeverType {
  return { kind: TypeKind.Never };
}

/**
 * Create a unit type
 */
export function unitType(): UnitType {
  return { kind: TypeKind.Unit };
}

// ==================== Type Predicates ====================

/**
 * Check if type is an error type
 */
export function isErrorType(type: IrisType): type is ErrorType {
  return type.kind === TypeKind.Error;
}

/**
 * Check if type is a numeric type (bit, int, uint)
 */
export function isNumericType(
  type: IrisType
): type is BitType | IntType | UintType {
  return (
    type.kind === TypeKind.Bit ||
    type.kind === TypeKind.Int ||
    type.kind === TypeKind.Uint
  );
}

/**
 * Check if type is a signed numeric type
 */
export function isSignedType(type: IrisType): type is IntType {
  return type.kind === TypeKind.Int;
}

/**
 * Check if type is an unsigned numeric type
 */
export function isUnsignedType(type: IrisType): type is BitType | UintType {
  return type.kind === TypeKind.Bit || type.kind === TypeKind.Uint;
}

/**
 * Check if type is a primitive type
 */
export function isPrimitiveType(type: IrisType): boolean {
  return (
    type.kind === TypeKind.Bit ||
    type.kind === TypeKind.Int ||
    type.kind === TypeKind.Uint ||
    type.kind === TypeKind.Bool ||
    type.kind === TypeKind.Clock ||
    type.kind === TypeKind.Reset ||
    type.kind === TypeKind.String
  );
}

/**
 * Check if type is a compound type (array, tuple)
 */
export function isCompoundType(type: IrisType): type is ArrayType | TupleType {
  return type.kind === TypeKind.Array || type.kind === TypeKind.Tuple;
}

/**
 * Check if type is a user-defined type
 */
export function isUserDefinedType(
  type: IrisType
): type is EnumType | StructType | TypeAliasType {
  return (
    type.kind === TypeKind.Enum ||
    type.kind === TypeKind.Struct ||
    type.kind === TypeKind.TypeAlias
  );
}

// ==================== Type Utilities ====================

/**
 * Get the bit width of a numeric type
 */
export function getBitWidth(type: IrisType): number | undefined {
  switch (type.kind) {
    case TypeKind.Bit:
      return type.width ?? 1;
    case TypeKind.Int:
    case TypeKind.Uint:
      return type.width;
    case TypeKind.Bool:
      return 1;
    default:
      return undefined;
  }
}

/**
 * Get a human-readable type name
 */
export function typeName(type: IrisType): string {
  switch (type.kind) {
    case TypeKind.Error:
      return `<error: ${type.message}>`;
    case TypeKind.Bit:
      return type.width !== undefined ? `bit[${type.width}]` : 'bit';
    case TypeKind.Int:
      return `int[${type.width}]`;
    case TypeKind.Uint:
      return `uint[${type.width}]`;
    case TypeKind.Bool:
      return 'bool';
    case TypeKind.Clock:
      return 'clock';
    case TypeKind.Reset:
      return type.isAsync ? 'reset(async)' : 'reset';
    case TypeKind.String:
      return 'string';
    case TypeKind.Array:
      return `${typeName(type.elementType)}[${type.size}]`;
    case TypeKind.Tuple:
      return `(${type.elements.map(typeName).join(', ')})`;
    case TypeKind.Enum:
      return type.modulePath.length > 0
        ? `${type.modulePath.join('::')}::${type.name}`
        : type.name;
    case TypeKind.Struct:
      return type.modulePath.length > 0
        ? `${type.modulePath.join('::')}::${type.name}`
        : type.name;
    case TypeKind.TypeAlias:
      return type.name;
    case TypeKind.Generic:
      return type.name;
    case TypeKind.Inferred:
      return '<inferred>';
    case TypeKind.Never:
      return 'never';
    case TypeKind.Unit:
      return '()';
  }
}

/**
 * Unwrap type aliases to get the underlying type
 */
export function unwrapTypeAlias(type: IrisType): IrisType {
  if (type.kind === TypeKind.TypeAlias) {
    return unwrapTypeAlias(type.resolvedType);
  }
  return type;
}
