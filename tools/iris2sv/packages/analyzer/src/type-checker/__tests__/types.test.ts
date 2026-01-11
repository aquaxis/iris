/**
 * IrisType Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../types.js';

describe('IrisType', () => {
  describe('type constructors', () => {
    it('should create bit type without width', () => {
      const type = bitType();
      expect(type.kind).toBe(TypeKind.Bit);
      expect(type.width).toBeUndefined();
    });

    it('should create bit type with width', () => {
      const type = bitType(8);
      expect(type.kind).toBe(TypeKind.Bit);
      expect(type.width).toBe(8);
    });

    it('should create int type', () => {
      const type = intType(32);
      expect(type.kind).toBe(TypeKind.Int);
      expect(type.width).toBe(32);
    });

    it('should create uint type', () => {
      const type = uintType(16);
      expect(type.kind).toBe(TypeKind.Uint);
      expect(type.width).toBe(16);
    });

    it('should create bool type', () => {
      const type = boolType();
      expect(type.kind).toBe(TypeKind.Bool);
    });

    it('should create clock type', () => {
      const type = clockType();
      expect(type.kind).toBe(TypeKind.Clock);
    });

    it('should create reset type', () => {
      const type = resetType();
      expect(type.kind).toBe(TypeKind.Reset);
      expect(type.isAsync).toBe(false);
    });

    it('should create async reset type', () => {
      const type = resetType(true);
      expect(type.kind).toBe(TypeKind.Reset);
      expect(type.isAsync).toBe(true);
    });

    it('should create string type', () => {
      const type = stringType();
      expect(type.kind).toBe(TypeKind.String);
    });

    it('should create array type', () => {
      const type = arrayType(bitType(8), 16);
      expect(type.kind).toBe(TypeKind.Array);
      expect(type.size).toBe(16);
      expect(type.elementType.kind).toBe(TypeKind.Bit);
    });

    it('should create tuple type', () => {
      const type = tupleType([bitType(8), boolType()]);
      expect(type.kind).toBe(TypeKind.Tuple);
      expect(type.elements.length).toBe(2);
    });

    it('should create enum type', () => {
      const type = enumType('Color', [], ['Red', 'Green', 'Blue']);
      expect(type.kind).toBe(TypeKind.Enum);
      expect(type.name).toBe('Color');
      expect(type.variants).toEqual(['Red', 'Green', 'Blue']);
    });

    it('should create struct type', () => {
      const type = structType('Point', [], [
        { name: 'x', type: intType(32) },
        { name: 'y', type: intType(32) },
      ]);
      expect(type.kind).toBe(TypeKind.Struct);
      expect(type.name).toBe('Point');
      expect(type.fields.length).toBe(2);
    });

    it('should create type alias type', () => {
      const type = typeAliasType('Word', [], bitType(32));
      expect(type.kind).toBe(TypeKind.TypeAlias);
      expect(type.name).toBe('Word');
      expect(type.resolvedType.kind).toBe(TypeKind.Bit);
    });

    it('should create generic type', () => {
      const type = genericType('T');
      expect(type.kind).toBe(TypeKind.Generic);
      expect(type.name).toBe('T');
    });

    it('should create error type', () => {
      const type = errorType('test error');
      expect(type.kind).toBe(TypeKind.Error);
      expect(type.message).toBe('test error');
    });

    it('should create inferred type', () => {
      const type = inferredType();
      expect(type.kind).toBe(TypeKind.Inferred);
    });

    it('should create never type', () => {
      const type = neverType();
      expect(type.kind).toBe(TypeKind.Never);
    });

    it('should create unit type', () => {
      const type = unitType();
      expect(type.kind).toBe(TypeKind.Unit);
    });
  });

  describe('type predicates', () => {
    it('isErrorType should identify error types', () => {
      expect(isErrorType(errorType('test'))).toBe(true);
      expect(isErrorType(bitType())).toBe(false);
    });

    it('isNumericType should identify numeric types', () => {
      expect(isNumericType(bitType(8))).toBe(true);
      expect(isNumericType(intType(32))).toBe(true);
      expect(isNumericType(uintType(16))).toBe(true);
      expect(isNumericType(boolType())).toBe(false);
      expect(isNumericType(clockType())).toBe(false);
    });

    it('isSignedType should identify signed types', () => {
      expect(isSignedType(intType(32))).toBe(true);
      expect(isSignedType(bitType(8))).toBe(false);
      expect(isSignedType(uintType(16))).toBe(false);
    });

    it('isUnsignedType should identify unsigned types', () => {
      expect(isUnsignedType(bitType(8))).toBe(true);
      expect(isUnsignedType(uintType(16))).toBe(true);
      expect(isUnsignedType(intType(32))).toBe(false);
    });

    it('isPrimitiveType should identify primitive types', () => {
      expect(isPrimitiveType(bitType(8))).toBe(true);
      expect(isPrimitiveType(intType(32))).toBe(true);
      expect(isPrimitiveType(boolType())).toBe(true);
      expect(isPrimitiveType(clockType())).toBe(true);
      expect(isPrimitiveType(resetType())).toBe(true);
      expect(isPrimitiveType(arrayType(bitType(), 8))).toBe(false);
    });

    it('isCompoundType should identify compound types', () => {
      expect(isCompoundType(arrayType(bitType(), 8))).toBe(true);
      expect(isCompoundType(tupleType([bitType()]))).toBe(true);
      expect(isCompoundType(bitType(8))).toBe(false);
    });

    it('isUserDefinedType should identify user-defined types', () => {
      expect(isUserDefinedType(enumType('E', [], []))).toBe(true);
      expect(isUserDefinedType(structType('S', [], []))).toBe(true);
      expect(isUserDefinedType(typeAliasType('T', [], bitType()))).toBe(true);
      expect(isUserDefinedType(bitType())).toBe(false);
    });
  });

  describe('getBitWidth', () => {
    it('should return width for bit type', () => {
      expect(getBitWidth(bitType())).toBe(1);
      expect(getBitWidth(bitType(8))).toBe(8);
    });

    it('should return width for int/uint types', () => {
      expect(getBitWidth(intType(32))).toBe(32);
      expect(getBitWidth(uintType(16))).toBe(16);
    });

    it('should return 1 for bool type', () => {
      expect(getBitWidth(boolType())).toBe(1);
    });

    it('should return undefined for non-numeric types', () => {
      expect(getBitWidth(clockType())).toBeUndefined();
      expect(getBitWidth(stringType())).toBeUndefined();
    });
  });

  describe('typeName', () => {
    it('should format primitive types', () => {
      expect(typeName(bitType())).toBe('bit');
      expect(typeName(bitType(8))).toBe('bit[8]');
      expect(typeName(intType(32))).toBe('int[32]');
      expect(typeName(uintType(16))).toBe('uint[16]');
      expect(typeName(boolType())).toBe('bool');
      expect(typeName(clockType())).toBe('clock');
      expect(typeName(resetType())).toBe('reset');
      expect(typeName(resetType(true))).toBe('reset(async)');
      expect(typeName(stringType())).toBe('string');
    });

    it('should format array types', () => {
      expect(typeName(arrayType(bitType(8), 16))).toBe('bit[8][16]');
    });

    it('should format tuple types', () => {
      expect(typeName(tupleType([bitType(8), boolType()]))).toBe('(bit[8], bool)');
    });

    it('should format user-defined types', () => {
      expect(typeName(enumType('Color', [], []))).toBe('Color');
      expect(typeName(enumType('Color', ['pkg'], []))).toBe('pkg::Color');
      expect(typeName(structType('Point', [], []))).toBe('Point');
    });

    it('should format special types', () => {
      expect(typeName(errorType('err'))).toBe('<error: err>');
      expect(typeName(inferredType())).toBe('<inferred>');
      expect(typeName(neverType())).toBe('never');
      expect(typeName(unitType())).toBe('()');
    });
  });

  describe('unwrapTypeAlias', () => {
    it('should unwrap type aliases', () => {
      const alias = typeAliasType('Word', [], bitType(32));
      const unwrapped = unwrapTypeAlias(alias);
      expect(unwrapped.kind).toBe(TypeKind.Bit);
    });

    it('should unwrap nested type aliases', () => {
      const inner = typeAliasType('Inner', [], bitType(16));
      const outer = typeAliasType('Outer', [], inner);
      const unwrapped = unwrapTypeAlias(outer);
      expect(unwrapped.kind).toBe(TypeKind.Bit);
    });

    it('should return non-alias types unchanged', () => {
      const type = bitType(8);
      const unwrapped = unwrapTypeAlias(type);
      expect(unwrapped).toBe(type);
    });
  });
});
