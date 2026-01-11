/**
 * Type Checker Module
 *
 * Provides type system infrastructure for IRIS semantic analysis.
 */

// Type definitions
export {
  TypeKind,
  bitType,
  intType,
  uintType,
  boolType,
  clockType,
  resetType,
  stringType,
  arrayType,
  tupleType,
  enumType,
  structType,
  typeAliasType,
  genericType,
  errorType,
  inferredType,
  neverType,
  unitType,
  isErrorType,
  isNumericType,
  isSignedType,
  isUnsignedType,
  isPrimitiveType,
  isCompoundType,
  isUserDefinedType,
  getBitWidth,
  typeName,
  unwrapTypeAlias,
} from './types.js';

export type {
  IrisType,
  TypeBase,
  ErrorType,
  BitType,
  IntType,
  UintType,
  BoolType,
  ClockType,
  ResetType,
  StringType,
  ArrayType,
  TupleType,
  EnumType,
  StructType,
  StructField,
  TypeAliasType,
  GenericType,
  InferredType,
  NeverType,
  UnitType,
} from './types.js';

// Type resolver
export { TypeResolver, createTypeResolver } from './resolver.js';

export type { ResolveResult, TypeDiagnostic as ResolverDiagnostic } from './resolver.js';

// Type checker
export { TypeChecker, createTypeChecker } from './checker.js';

export type {
  DiagnosticSeverity as TypeDiagnosticSeverity,
  TypeDiagnostic,
  TypeContext,
} from './checker.js';
