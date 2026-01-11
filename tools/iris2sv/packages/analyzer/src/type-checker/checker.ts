/**
 * Type Checker
 *
 * Performs type checking on IRIS AST using the symbol table
 * and type resolver. Checks for type errors, width mismatches,
 * and other semantic issues.
 */

import type { SourceSpan } from '@iris2sv/core';
import type { SymbolTable } from '../symbol-table/index.js';
import type {
  IrisType} from './types.js';
import {
  TypeKind,
  typeName,
  unwrapTypeAlias,
  getBitWidth,
  isNumericType,
  isSignedType,
  isErrorType,
  bitType,
  boolType,
  errorType,
} from './types.js';
import { TypeResolver } from './resolver.js';

/**
 * Type check result severity
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Type check diagnostic
 */
export interface TypeDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly span: SourceSpan | undefined;
  readonly code?: string;
}

/**
 * Type checking context
 */
export interface TypeContext {
  readonly expectedType?: IrisType;
  readonly isLValue?: boolean;
  readonly inSyncBlock?: boolean;
  readonly inCombBlock?: boolean;
}

/**
 * Type Checker class
 */
export class TypeChecker {
  private readonly _symbolTable: SymbolTable;
  private readonly _resolver: TypeResolver;
  private diagnostics: TypeDiagnostic[];

  constructor(symbolTable: SymbolTable) {
    this._symbolTable = symbolTable;
    this._resolver = new TypeResolver(symbolTable);
    this.diagnostics = [];
  }

  /**
   * Get the symbol table
   */
  get symbolTable(): SymbolTable {
    return this._symbolTable;
  }

  /**
   * Get the type resolver
   */
  get resolver(): TypeResolver {
    return this._resolver;
  }

  /**
   * Get all diagnostics
   */
  getDiagnostics(): TypeDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  /**
   * Clear all diagnostics
   */
  clearDiagnostics(): void {
    this.diagnostics = [];
  }

  // ==================== Type Equality ====================

  /**
   * Check if two types are exactly equal
   */
  areTypesEqual(a: IrisType, b: IrisType): boolean {
    // Unwrap type aliases
    const typeA = unwrapTypeAlias(a);
    const typeB = unwrapTypeAlias(b);

    // Same kind check
    if (typeA.kind !== typeB.kind) {
      return false;
    }

    switch (typeA.kind) {
      case TypeKind.Error:
        // Error types are never equal
        return false;

      case TypeKind.Bit:
        return typeA.width === (typeB as typeof typeA).width;

      case TypeKind.Int:
      case TypeKind.Uint:
        return typeA.width === (typeB as typeof typeA).width;

      case TypeKind.Bool:
      case TypeKind.Clock:
      case TypeKind.String:
      case TypeKind.Inferred:
      case TypeKind.Never:
      case TypeKind.Unit:
        return true;

      case TypeKind.Reset:
        return typeA.isAsync === (typeB as typeof typeA).isAsync;

      case TypeKind.Array: {
        const arrayB = typeB as typeof typeA;
        return (
          typeA.size === arrayB.size &&
          this.areTypesEqual(typeA.elementType, arrayB.elementType)
        );
      }

      case TypeKind.Tuple: {
        const tupleB = typeB as typeof typeA;
        if (typeA.elements.length !== tupleB.elements.length) {
          return false;
        }
        return typeA.elements.every((elem, i) => {
          const otherElem = tupleB.elements[i];
          return otherElem !== undefined && this.areTypesEqual(elem, otherElem);
        });
      }

      case TypeKind.Enum:
        return (
          typeA.name === (typeB as typeof typeA).name &&
          this.arrayEquals(typeA.modulePath, (typeB as typeof typeA).modulePath)
        );

      case TypeKind.Struct:
        return (
          typeA.name === (typeB as typeof typeA).name &&
          this.arrayEquals(typeA.modulePath, (typeB as typeof typeA).modulePath)
        );

      case TypeKind.Generic:
        return typeA.name === (typeB as typeof typeA).name;

      case TypeKind.TypeAlias:
        // Already unwrapped, shouldn't reach here
        return false;
    }
  }

  // ==================== Type Assignability ====================

  /**
   * Check if sourceType can be assigned to targetType
   */
  isAssignable(sourceType: IrisType, targetType: IrisType): boolean {
    // Unwrap type aliases
    const source = unwrapTypeAlias(sourceType);
    const target = unwrapTypeAlias(targetType);

    // Error types are always assignable (to avoid cascading errors)
    if (isErrorType(source) || isErrorType(target)) {
      return true;
    }

    // Inferred types accept anything
    if (target.kind === TypeKind.Inferred) {
      return true;
    }

    // Exact type match
    if (this.areTypesEqual(source, target)) {
      return true;
    }

    // Never type is assignable to everything
    if (source.kind === TypeKind.Never) {
      return true;
    }

    // Numeric type coercion
    if (isNumericType(source) && isNumericType(target)) {
      return this.isNumericAssignable(source, target);
    }

    // Array element type compatibility
    if (source.kind === TypeKind.Array && target.kind === TypeKind.Array) {
      return (
        source.size === target.size &&
        this.isAssignable(source.elementType, target.elementType)
      );
    }

    // Tuple element compatibility
    if (source.kind === TypeKind.Tuple && target.kind === TypeKind.Tuple) {
      if (source.elements.length !== target.elements.length) {
        return false;
      }
      return source.elements.every((elem, i) => {
        const targetElem = target.elements[i];
        return targetElem !== undefined && this.isAssignable(elem, targetElem);
      });
    }

    return false;
  }

  /**
   * Check numeric type assignability with width consideration
   */
  private isNumericAssignable(
    source: IrisType & { kind: TypeKind.Bit | TypeKind.Int | TypeKind.Uint },
    target: IrisType & { kind: TypeKind.Bit | TypeKind.Int | TypeKind.Uint }
  ): boolean {
    const sourceWidth = getBitWidth(source);
    const targetWidth = getBitWidth(target);

    if (sourceWidth === undefined || targetWidth === undefined) {
      return true; // Allow if width is unknown
    }

    // Same signedness and width is compatible
    if (sourceWidth <= targetWidth) {
      // Widening is always safe
      if (isSignedType(source) === isSignedType(target)) {
        return true;
      }
      // Unsigned to signed widening is safe if target is wider
      if (!isSignedType(source) && isSignedType(target) && targetWidth > sourceWidth) {
        return true;
      }
    }

    // Allow assignment but may generate warning for narrowing
    return true;
  }

  // ==================== Type Checking Operations ====================

  /**
   * Check an assignment for type compatibility
   */
  checkAssignment(
    targetType: IrisType,
    sourceType: IrisType,
    span: SourceSpan | undefined
  ): boolean {
    if (!this.isAssignable(sourceType, targetType)) {
      this.error(
        `Cannot assign type '${typeName(sourceType)}' to '${typeName(targetType)}'`,
        span,
        'E001'
      );
      return false;
    }

    // Check for width truncation (warning)
    if (isNumericType(sourceType) && isNumericType(targetType)) {
      const sourceWidth = getBitWidth(sourceType);
      const targetWidth = getBitWidth(targetType);

      if (
        sourceWidth !== undefined &&
        targetWidth !== undefined &&
        sourceWidth > targetWidth
      ) {
        this.warning(
          `Implicit truncation from ${sourceWidth} bits to ${targetWidth} bits`,
          span,
          'W001'
        );
      }

      // Check for sign conversion
      if (isSignedType(sourceType) !== isSignedType(targetType)) {
        this.warning(
          `Implicit sign conversion between '${typeName(sourceType)}' and '${typeName(targetType)}'`,
          span,
          'W002'
        );
      }
    }

    return true;
  }

  /**
   * Check a binary operation for type compatibility
   */
  checkBinaryOp(
    op: string,
    leftType: IrisType,
    rightType: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    const left = unwrapTypeAlias(leftType);
    const right = unwrapTypeAlias(rightType);

    // Error propagation
    if (isErrorType(left) || isErrorType(right)) {
      return errorType('error propagation');
    }

    switch (op) {
      // Arithmetic operators
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
        return this.checkArithmeticOp(op, left, right, span);

      // Bitwise operators
      case '&':
      case '|':
      case '^':
        return this.checkBitwiseOp(op, left, right, span);

      // Shift operators
      case '<<':
      case '>>':
      case '<<<':
      case '>>>':
        return this.checkShiftOp(op, left, right, span);

      // Comparison operators
      case '==':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return this.checkComparisonOp(op, left, right, span);

      // Logical operators
      case '&&':
      case '||':
        return this.checkLogicalOp(op, left, right, span);

      default:
        this.error(`Unknown binary operator: ${op}`, span, 'E002');
        return errorType(`unknown operator: ${op}`);
    }
  }

  private checkArithmeticOp(
    op: string,
    left: IrisType,
    right: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    if (!isNumericType(left)) {
      this.error(
        `Left operand of '${op}' must be numeric, got '${typeName(left)}'`,
        span,
        'E003'
      );
      return errorType('type error');
    }

    if (!isNumericType(right)) {
      this.error(
        `Right operand of '${op}' must be numeric, got '${typeName(right)}'`,
        span,
        'E003'
      );
      return errorType('type error');
    }

    // Result type is the wider of the two operands
    const leftWidth = getBitWidth(left) ?? 32;
    const rightWidth = getBitWidth(right) ?? 32;
    const resultWidth = Math.max(leftWidth, rightWidth);

    // If either is signed, result is signed
    if (isSignedType(left) || isSignedType(right)) {
      return { kind: TypeKind.Int, width: resultWidth };
    }

    return bitType(resultWidth);
  }

  private checkBitwiseOp(
    op: string,
    left: IrisType,
    right: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    if (!isNumericType(left) || !isNumericType(right)) {
      this.error(
        `Bitwise operator '${op}' requires numeric operands`,
        span,
        'E004'
      );
      return errorType('type error');
    }

    // Result type is the wider of the two operands
    const leftWidth = getBitWidth(left) ?? 32;
    const rightWidth = getBitWidth(right) ?? 32;
    const resultWidth = Math.max(leftWidth, rightWidth);

    return bitType(resultWidth);
  }

  private checkShiftOp(
    op: string,
    left: IrisType,
    right: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    if (!isNumericType(left)) {
      this.error(
        `Left operand of '${op}' must be numeric`,
        span,
        'E005'
      );
      return errorType('type error');
    }

    if (!isNumericType(right)) {
      this.error(
        `Shift amount must be numeric`,
        span,
        'E005'
      );
      return errorType('type error');
    }

    // Result type maintains the left operand's type and width
    return left;
  }

  private checkComparisonOp(
    _op: string,
    left: IrisType,
    right: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    if (!this.isComparable(left, right)) {
      this.error(
        `Cannot compare '${typeName(left)}' with '${typeName(right)}'`,
        span,
        'E006'
      );
      return errorType('type error');
    }

    return boolType();
  }

  private checkLogicalOp(
    op: string,
    left: IrisType,
    right: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    if (left.kind !== TypeKind.Bool) {
      this.error(
        `Left operand of '${op}' must be bool, got '${typeName(left)}'`,
        span,
        'E007'
      );
      return errorType('type error');
    }

    if (right.kind !== TypeKind.Bool) {
      this.error(
        `Right operand of '${op}' must be bool, got '${typeName(right)}'`,
        span,
        'E007'
      );
      return errorType('type error');
    }

    return boolType();
  }

  /**
   * Check a unary operation
   */
  checkUnaryOp(
    op: string,
    operandType: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    const operand = unwrapTypeAlias(operandType);

    if (isErrorType(operand)) {
      return errorType('error propagation');
    }

    switch (op) {
      case '-':
        if (!isNumericType(operand)) {
          this.error(
            `Unary '-' requires numeric operand, got '${typeName(operand)}'`,
            span,
            'E008'
          );
          return errorType('type error');
        }
        // Negation of unsigned produces signed
        if (operand.kind === TypeKind.Bit || operand.kind === TypeKind.Uint) {
          const width = getBitWidth(operand) ?? 32;
          return { kind: TypeKind.Int, width };
        }
        return operand;

      case '~':
        if (!isNumericType(operand)) {
          this.error(
            `Bitwise NOT requires numeric operand, got '${typeName(operand)}'`,
            span,
            'E008'
          );
          return errorType('type error');
        }
        return operand;

      case '!':
        if (operand.kind !== TypeKind.Bool) {
          this.error(
            `Logical NOT requires bool operand, got '${typeName(operand)}'`,
            span,
            'E008'
          );
          return errorType('type error');
        }
        return boolType();

      case '&':
      case '|':
      case '^':
        // Reduction operators
        if (!isNumericType(operand)) {
          this.error(
            `Reduction operator '${op}' requires numeric operand`,
            span,
            'E008'
          );
          return errorType('type error');
        }
        return bitType(1);

      default:
        this.error(`Unknown unary operator: ${op}`, span, 'E009');
        return errorType(`unknown operator: ${op}`);
    }
  }

  /**
   * Check array index access
   */
  checkIndexAccess(
    arrayType: IrisType,
    indexType: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    const array = unwrapTypeAlias(arrayType);

    if (isErrorType(array)) {
      return errorType('error propagation');
    }

    if (array.kind !== TypeKind.Array) {
      this.error(
        `Cannot index into type '${typeName(array)}'`,
        span,
        'E010'
      );
      return errorType('type error');
    }

    if (!isNumericType(indexType)) {
      this.error(
        `Array index must be numeric, got '${typeName(indexType)}'`,
        span,
        'E011'
      );
      return errorType('type error');
    }

    return array.elementType;
  }

  /**
   * Check bit slice access
   */
  checkBitSlice(
    valueType: IrisType,
    highType: IrisType,
    lowType: IrisType,
    span: SourceSpan | undefined
  ): IrisType {
    const value = unwrapTypeAlias(valueType);

    if (!isNumericType(value)) {
      this.error(
        `Bit slice requires numeric type, got '${typeName(value)}'`,
        span,
        'E012'
      );
      return errorType('type error');
    }

    if (!isNumericType(highType) || !isNumericType(lowType)) {
      this.error(
        `Bit slice indices must be numeric`,
        span,
        'E012'
      );
      return errorType('type error');
    }

    // Return bit type with inferred width (would need constant evaluation)
    return bitType(undefined);
  }

  // ==================== Helper Methods ====================

  private isComparable(left: IrisType, right: IrisType): boolean {
    // Same types are comparable
    if (this.areTypesEqual(left, right)) {
      return true;
    }

    // Numeric types are comparable
    if (isNumericType(left) && isNumericType(right)) {
      return true;
    }

    // Bool is comparable with bool
    if (left.kind === TypeKind.Bool && right.kind === TypeKind.Bool) {
      return true;
    }

    return false;
  }

  private arrayEquals<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((elem, i) => elem === b[i]);
  }

  // ==================== Diagnostic Helpers ====================

  error(message: string, span: SourceSpan | undefined, code?: string): void {
    const diagnostic: TypeDiagnostic = code !== undefined
      ? { severity: 'error', message, span, code }
      : { severity: 'error', message, span };
    this.diagnostics.push(diagnostic);
  }

  warning(message: string, span: SourceSpan | undefined, code?: string): void {
    const diagnostic: TypeDiagnostic = code !== undefined
      ? { severity: 'warning', message, span, code }
      : { severity: 'warning', message, span };
    this.diagnostics.push(diagnostic);
  }

  info(message: string, span: SourceSpan | undefined, code?: string): void {
    const diagnostic: TypeDiagnostic = code !== undefined
      ? { severity: 'info', message, span, code }
      : { severity: 'info', message, span };
    this.diagnostics.push(diagnostic);
  }
}

/**
 * Create a type checker
 */
export function createTypeChecker(symbolTable: SymbolTable): TypeChecker {
  return new TypeChecker(symbolTable);
}
