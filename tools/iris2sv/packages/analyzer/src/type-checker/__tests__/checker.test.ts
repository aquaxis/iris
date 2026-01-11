/**
 * TypeChecker Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolTable } from '../../symbol-table/index.js';
import { TypeChecker, createTypeChecker } from '../checker.js';
import {
  TypeKind,
  bitType,
  intType,
  uintType,
  boolType,
  clockType,
  arrayType,
  tupleType,
  typeAliasType,
  errorType,
  inferredType,
  neverType,
} from '../types.js';

describe('TypeChecker', () => {
  let symbolTable: SymbolTable;
  let checker: TypeChecker;

  beforeEach(() => {
    symbolTable = new SymbolTable();
    checker = createTypeChecker(symbolTable);
  });

  describe('areTypesEqual', () => {
    it('should return true for identical primitive types', () => {
      expect(checker.areTypesEqual(bitType(8), bitType(8))).toBe(true);
      expect(checker.areTypesEqual(intType(32), intType(32))).toBe(true);
      expect(checker.areTypesEqual(boolType(), boolType())).toBe(true);
      expect(checker.areTypesEqual(clockType(), clockType())).toBe(true);
    });

    it('should return false for different widths', () => {
      expect(checker.areTypesEqual(bitType(8), bitType(16))).toBe(false);
      expect(checker.areTypesEqual(intType(32), intType(64))).toBe(false);
    });

    it('should return false for different type kinds', () => {
      expect(checker.areTypesEqual(bitType(8), intType(8))).toBe(false);
      expect(checker.areTypesEqual(boolType(), bitType(1))).toBe(false);
    });

    it('should compare array types', () => {
      expect(checker.areTypesEqual(
        arrayType(bitType(8), 16),
        arrayType(bitType(8), 16)
      )).toBe(true);

      expect(checker.areTypesEqual(
        arrayType(bitType(8), 16),
        arrayType(bitType(8), 32)
      )).toBe(false);

      expect(checker.areTypesEqual(
        arrayType(bitType(8), 16),
        arrayType(bitType(16), 16)
      )).toBe(false);
    });

    it('should compare tuple types', () => {
      expect(checker.areTypesEqual(
        tupleType([bitType(8), boolType()]),
        tupleType([bitType(8), boolType()])
      )).toBe(true);

      expect(checker.areTypesEqual(
        tupleType([bitType(8), boolType()]),
        tupleType([bitType(8)])
      )).toBe(false);
    });

    it('should unwrap type aliases for comparison', () => {
      const alias = typeAliasType('Word', [], bitType(32));
      expect(checker.areTypesEqual(alias, bitType(32))).toBe(true);
    });

    it('should return false for error types', () => {
      expect(checker.areTypesEqual(errorType('a'), errorType('b'))).toBe(false);
    });
  });

  describe('isAssignable', () => {
    it('should allow assignment of identical types', () => {
      expect(checker.isAssignable(bitType(8), bitType(8))).toBe(true);
    });

    it('should allow assignment to inferred type', () => {
      expect(checker.isAssignable(bitType(8), inferredType())).toBe(true);
    });

    it('should allow never type to be assigned to anything', () => {
      expect(checker.isAssignable(neverType(), bitType(8))).toBe(true);
      expect(checker.isAssignable(neverType(), boolType())).toBe(true);
    });

    it('should allow numeric type coercion', () => {
      // Widening is allowed
      expect(checker.isAssignable(bitType(8), bitType(16))).toBe(true);
      // Narrowing is also allowed (may generate warning)
      expect(checker.isAssignable(bitType(16), bitType(8))).toBe(true);
    });

    it('should allow error types to be assigned (for error recovery)', () => {
      expect(checker.isAssignable(errorType('err'), bitType(8))).toBe(true);
      expect(checker.isAssignable(bitType(8), errorType('err'))).toBe(true);
    });

    it('should compare array element types', () => {
      expect(checker.isAssignable(
        arrayType(bitType(8), 16),
        arrayType(bitType(8), 16)
      )).toBe(true);

      expect(checker.isAssignable(
        arrayType(bitType(8), 16),
        arrayType(bitType(8), 32)
      )).toBe(false);
    });
  });

  describe('checkAssignment', () => {
    it('should succeed for compatible types', () => {
      const result = checker.checkAssignment(bitType(8), bitType(8), undefined);
      expect(result).toBe(true);
      expect(checker.hasErrors()).toBe(false);
    });

    it('should fail for incompatible types', () => {
      const result = checker.checkAssignment(boolType(), clockType(), undefined);
      expect(result).toBe(false);
      expect(checker.hasErrors()).toBe(true);
    });

    it('should generate warning for truncation', () => {
      checker.checkAssignment(bitType(8), bitType(16), undefined);
      const diagnostics = checker.getDiagnostics();
      expect(diagnostics.some(d => d.severity === 'warning')).toBe(true);
    });

    it('should generate warning for sign conversion', () => {
      checker.checkAssignment(intType(8), uintType(8), undefined);
      const diagnostics = checker.getDiagnostics();
      expect(diagnostics.some(d => d.severity === 'warning')).toBe(true);
    });
  });

  describe('checkBinaryOp', () => {
    describe('arithmetic operators', () => {
      it('should return numeric type for arithmetic on numeric operands', () => {
        const result = checker.checkBinaryOp('+', bitType(8), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Bit);
      });

      it('should return wider type for mixed widths', () => {
        const result = checker.checkBinaryOp('+', bitType(8), bitType(16), undefined);
        expect(result.kind).toBe(TypeKind.Bit);
      });

      it('should return signed type if either operand is signed', () => {
        const result = checker.checkBinaryOp('+', intType(8), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Int);
      });

      it('should report error for non-numeric operands', () => {
        const result = checker.checkBinaryOp('+', boolType(), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Error);
        expect(checker.hasErrors()).toBe(true);
      });
    });

    describe('bitwise operators', () => {
      it('should return bit type for bitwise operations', () => {
        const result = checker.checkBinaryOp('&', bitType(8), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Bit);
      });

      it('should report error for non-numeric operands', () => {
        const result = checker.checkBinaryOp('|', boolType(), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Error);
      });
    });

    describe('shift operators', () => {
      it('should return left operand type for shift', () => {
        const result = checker.checkBinaryOp('<<', bitType(8), bitType(4), undefined);
        expect(result.kind).toBe(TypeKind.Bit);
      });
    });

    describe('comparison operators', () => {
      it('should return bool for comparisons', () => {
        const result = checker.checkBinaryOp('==', bitType(8), bitType(8), undefined);
        expect(result.kind).toBe(TypeKind.Bool);
      });

      it('should allow comparing different numeric types', () => {
        const result = checker.checkBinaryOp('<', bitType(8), intType(8), undefined);
        expect(result.kind).toBe(TypeKind.Bool);
        expect(checker.hasErrors()).toBe(false);
      });

      it('should report error for incompatible comparisons', () => {
        const result = checker.checkBinaryOp('==', boolType(), clockType(), undefined);
        expect(result.kind).toBe(TypeKind.Error);
      });
    });

    describe('logical operators', () => {
      it('should return bool for logical operations on bools', () => {
        const result = checker.checkBinaryOp('&&', boolType(), boolType(), undefined);
        expect(result.kind).toBe(TypeKind.Bool);
      });

      it('should report error for non-bool operands', () => {
        const result = checker.checkBinaryOp('||', boolType(), bitType(1), undefined);
        expect(result.kind).toBe(TypeKind.Error);
      });
    });
  });

  describe('checkUnaryOp', () => {
    it('should handle negation', () => {
      const result = checker.checkUnaryOp('-', bitType(8), undefined);
      expect(result.kind).toBe(TypeKind.Int);
    });

    it('should handle bitwise NOT', () => {
      const result = checker.checkUnaryOp('~', bitType(8), undefined);
      expect(result.kind).toBe(TypeKind.Bit);
    });

    it('should handle logical NOT', () => {
      const result = checker.checkUnaryOp('!', boolType(), undefined);
      expect(result.kind).toBe(TypeKind.Bool);
    });

    it('should handle reduction operators', () => {
      const result = checker.checkUnaryOp('&', bitType(8), undefined);
      expect(result.kind).toBe(TypeKind.Bit);
    });

    it('should report error for invalid operand type', () => {
      const result = checker.checkUnaryOp('!', bitType(8), undefined);
      expect(result.kind).toBe(TypeKind.Error);
    });
  });

  describe('checkIndexAccess', () => {
    it('should return element type for array access', () => {
      const result = checker.checkIndexAccess(
        arrayType(bitType(8), 16),
        bitType(4),
        undefined
      );
      expect(result.kind).toBe(TypeKind.Bit);
    });

    it('should report error for non-array type', () => {
      const result = checker.checkIndexAccess(bitType(8), bitType(4), undefined);
      expect(result.kind).toBe(TypeKind.Error);
    });

    it('should report error for non-numeric index', () => {
      const result = checker.checkIndexAccess(
        arrayType(bitType(8), 16),
        boolType(),
        undefined
      );
      expect(result.kind).toBe(TypeKind.Error);
    });
  });

  describe('checkBitSlice', () => {
    it('should return bit type for slice of numeric type', () => {
      const result = checker.checkBitSlice(
        bitType(32),
        bitType(8),
        bitType(8),
        undefined
      );
      expect(result.kind).toBe(TypeKind.Bit);
    });

    it('should report error for non-numeric value', () => {
      const result = checker.checkBitSlice(
        boolType(),
        bitType(8),
        bitType(8),
        undefined
      );
      expect(result.kind).toBe(TypeKind.Error);
    });
  });

  describe('diagnostics', () => {
    it('should track errors', () => {
      checker.error('test error', undefined);
      expect(checker.hasErrors()).toBe(true);
      expect(checker.getDiagnostics().length).toBe(1);
    });

    it('should track warnings', () => {
      checker.warning('test warning', undefined);
      expect(checker.hasErrors()).toBe(false);
      expect(checker.getDiagnostics().length).toBe(1);
    });

    it('should clear diagnostics', () => {
      checker.error('test error', undefined);
      checker.clearDiagnostics();
      expect(checker.hasErrors()).toBe(false);
      expect(checker.getDiagnostics().length).toBe(0);
    });
  });
});
