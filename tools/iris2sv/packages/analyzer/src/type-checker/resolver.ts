/**
 * Type Resolver
 *
 * Resolves AST TypeExpr nodes to IrisType representations.
 * Works with SymbolTable for user-defined type resolution.
 */

import type { TypeExpr, Expr, SourceSpan } from '@iris2sv/core';
import type { SymbolTable, Symbol } from '../symbol-table/index.js';
import { SymbolKind } from '../symbol-table/index.js';
import type {
  IrisType} from './types.js';
import {
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
} from './types.js';

/**
 * Type resolution result
 */
export interface ResolveResult {
  readonly type: IrisType;
  readonly diagnostics: TypeDiagnostic[];
}

/**
 * Type diagnostic
 */
export interface TypeDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly span: SourceSpan | undefined;
}

/**
 * Type Resolver class
 */
export class TypeResolver {
  private readonly symbolTable: SymbolTable;
  private diagnostics: TypeDiagnostic[];

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.diagnostics = [];
  }

  /**
   * Resolve a TypeExpr to an IrisType
   */
  resolve(typeExpr: TypeExpr): ResolveResult {
    this.diagnostics = [];
    const type = this.resolveTypeExpr(typeExpr);
    return {
      type,
      diagnostics: [...this.diagnostics],
    };
  }

  /**
   * Resolve TypeExpr or undefined
   */
  resolveOptional(typeExpr: TypeExpr | undefined): IrisType {
    if (typeExpr === undefined) {
      return inferredType();
    }
    return this.resolveTypeExpr(typeExpr);
  }

  // ==================== Internal Methods ====================

  private resolveTypeExpr(typeExpr: TypeExpr): IrisType {
    switch (typeExpr.kind) {
      case 'PrimitiveType':
        return this.resolvePrimitiveType(typeExpr);
      case 'ArrayType':
        return this.resolveArrayType(typeExpr);
      case 'TupleType':
        return this.resolveTupleType(typeExpr);
      case 'UserType':
        return this.resolveUserType(typeExpr);
      case 'GenericType':
        return this.resolveGenericType(typeExpr);
      default: {
        // This should be unreachable - handle any future type expression kinds
        const exhaustiveCheck: never = typeExpr;
        return this.error(`Unknown type expression kind: ${(exhaustiveCheck as TypeExpr).kind}`, undefined);
      }
    }
  }

  private resolvePrimitiveType(
    typeExpr: TypeExpr & { kind: 'PrimitiveType' }
  ): IrisType {
    const width = typeExpr.width !== undefined
      ? this.evaluateConstantExpr(typeExpr.width)
      : undefined;

    switch (typeExpr.type) {
      case 'bit':
        return bitType(width);
      case 'int':
        if (width === undefined) {
          return this.error('int type requires width specification', typeExpr.span);
        }
        return intType(width);
      case 'uint':
        if (width === undefined) {
          return this.error('uint type requires width specification', typeExpr.span);
        }
        return uintType(width);
      case 'bool':
        return boolType();
      case 'clock':
        return clockType();
      case 'reset':
        return resetType(false);
      case 'string':
        return stringType();
      default:
        return this.error(`Unknown primitive type: ${typeExpr.type}`, typeExpr.span);
    }
  }

  private resolveArrayType(
    typeExpr: TypeExpr & { kind: 'ArrayType' }
  ): IrisType {
    const elementType = this.resolveTypeExpr(typeExpr.elementType);
    const size = this.evaluateConstantExpr(typeExpr.size);

    if (size === undefined) {
      return this.error('Array size must be a constant expression', typeExpr.span);
    }

    if (size <= 0) {
      return this.error(`Array size must be positive, got ${size}`, typeExpr.span);
    }

    return arrayType(elementType, size);
  }

  private resolveTupleType(
    typeExpr: TypeExpr & { kind: 'TupleType' }
  ): IrisType {
    const elements = typeExpr.elements.map(elem => this.resolveTypeExpr(elem));
    return tupleType(elements);
  }

  private resolveUserType(
    typeExpr: TypeExpr & { kind: 'UserType' }
  ): IrisType {
    // Get the type name from the path
    const pathSegments = typeExpr.path.segments.map(s => s.name);
    const typeName = pathSegments[pathSegments.length - 1];

    if (typeName === undefined) {
      return this.error('Empty type path', typeExpr.span);
    }

    // Look up in symbol table
    const symbol = this.symbolTable.lookup(typeName);

    if (symbol === undefined) {
      return this.error(`Unknown type: ${pathSegments.join('::')}`, typeExpr.span);
    }

    return this.resolveSymbolType(symbol, pathSegments, typeExpr.span);
  }

  private resolveGenericType(
    typeExpr: TypeExpr & { kind: 'GenericType' }
  ): IrisType {
    // First resolve the base type
    const baseType = this.resolveUserType({
      kind: 'UserType',
      path: typeExpr.path,
      span: typeExpr.span,
    });

    // TODO: Apply generic arguments
    // For now, just return the base type
    // Generic instantiation will be handled later

    return baseType;
  }

  private resolveSymbolType(
    symbol: Symbol,
    modulePath: string[],
    span: SourceSpan | undefined
  ): IrisType {
    switch (symbol.kind) {
      case SymbolKind.Enum:
        return enumType(
          symbol.name,
          modulePath.slice(0, -1),
          [] // Variants will be resolved separately
        );

      case SymbolKind.Struct:
        return structType(
          symbol.name,
          modulePath.slice(0, -1),
          [] // Fields will be resolved separately
        );

      case SymbolKind.TypeAlias:
        // Type alias needs to resolve its underlying type
        if ('aliasedType' in symbol && symbol.aliasedType) {
          const resolvedType = this.resolveTypeExpr(symbol.aliasedType);
          return typeAliasType(
            symbol.name,
            modulePath.slice(0, -1),
            resolvedType
          );
        }
        return this.error(`Type alias ${symbol.name} has no underlying type`, span);

      case SymbolKind.GenericParam:
        return genericType(symbol.name);

      default:
        return this.error(
          `${symbol.name} is not a type (found ${symbol.kind})`,
          span
        );
    }
  }

  /**
   * Evaluate a constant expression to a number
   * This is a simplified version - full constant evaluation
   * would require more context
   */
  private evaluateConstantExpr(expr: Expr): number | undefined {
    switch (expr.kind) {
      case 'IntegerLiteral':
        return Number(expr.value);

      case 'IdentifierExpr':
        // Look up constant in symbol table
        const symbol = this.symbolTable.lookup(expr.name.name);
        if (symbol?.kind === SymbolKind.Constant) {
          // TODO: Evaluate constant value
          return undefined;
        }
        return undefined;

      case 'BinaryExpr': {
        const left = this.evaluateConstantExpr(expr.left);
        const right = this.evaluateConstantExpr(expr.right);
        if (left === undefined || right === undefined) {
          return undefined;
        }
        switch (expr.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return right !== 0 ? Math.floor(left / right) : undefined;
          case '%':
            return right !== 0 ? left % right : undefined;
          case '<<':
            return left << right;
          case '>>':
            return left >> right;
          case '&':
            return left & right;
          case '|':
            return left | right;
          case '^':
            return left ^ right;
          default:
            return undefined;
        }
      }

      case 'UnaryExpr': {
        const operand = this.evaluateConstantExpr(expr.operand);
        if (operand === undefined) {
          return undefined;
        }
        switch (expr.op) {
          case '-':
            return -operand;
          case '~':
            return ~operand;
          default:
            return undefined;
        }
      }

      case 'CallExpr':
        // Handle built-in functions like $clog2
        if (expr.callee.kind === 'IdentifierExpr') {
          const funcName = expr.callee.name.name;
          if (funcName === '$clog2' && expr.args.length === 1) {
            const arg = expr.args[0];
            if (arg !== undefined) {
              const argValue = this.evaluateConstantExpr(arg);
              if (argValue !== undefined && argValue > 0) {
                return Math.ceil(Math.log2(argValue));
              }
            }
          }
        }
        return undefined;

      case 'ParenExpr':
        return this.evaluateConstantExpr(expr.expr);

      default:
        return undefined;
    }
  }

  private error(message: string, span: SourceSpan | undefined): IrisType {
    this.diagnostics.push({
      severity: 'error',
      message,
      span,
    });
    return errorType(message);
  }
}

/**
 * Create a type resolver
 */
export function createTypeResolver(symbolTable: SymbolTable): TypeResolver {
  return new TypeResolver(symbolTable);
}
