/**
 * Symbol Definition
 *
 * Represents symbols in the IRIS language symbol table.
 */

import type { SourceSpan, TypeExpr } from '@iris2sv/core';

/**
 * Symbol kinds
 */
export enum SymbolKind {
  // Top-level definitions
  Module = 'Module',
  Function = 'Function',
  Interface = 'Interface',
  Package = 'Package',

  // Type definitions
  Enum = 'Enum',
  Struct = 'Struct',
  TypeAlias = 'TypeAlias',
  EnumVariant = 'EnumVariant',

  // Module-level declarations
  Port = 'Port',
  Signal = 'Signal',
  Constant = 'Constant',
  Instance = 'Instance',
  Memory = 'Memory',

  // FSM-related
  Fsm = 'Fsm',
  FsmState = 'FsmState',

  // Function-related
  Parameter = 'Parameter',
  Variable = 'Variable',

  // Generic
  GenericParam = 'GenericParam',
}

/**
 * Port direction (for Port symbols)
 */
export type PortDirection = 'in' | 'out' | 'inout';

/**
 * Symbol flags
 */
export interface SymbolFlags {
  readonly isPublic: boolean;
  readonly isMutable: boolean;
  readonly isGeneric: boolean;
}

/**
 * Default symbol flags
 */
export const DEFAULT_FLAGS: SymbolFlags = {
  isPublic: false,
  isMutable: false,
  isGeneric: false,
};

/**
 * Base symbol interface
 */
export interface SymbolBase {
  readonly id: number;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly span: SourceSpan;
  readonly flags: SymbolFlags;
  readonly type: TypeExpr | undefined;
  readonly parentId: number | undefined;  // Parent scope symbol ID
}

/**
 * Module symbol
 */
export interface ModuleSymbol extends SymbolBase {
  readonly kind: SymbolKind.Module;
  readonly ports: number[];      // Symbol IDs
  readonly signals: number[];    // Symbol IDs
  readonly instances: number[];  // Symbol IDs
  readonly fsms: number[];       // Symbol IDs
}

/**
 * Function symbol
 */
export interface FunctionSymbol extends SymbolBase {
  readonly kind: SymbolKind.Function;
  readonly params: number[];     // Parameter symbol IDs
  readonly returnType: TypeExpr | undefined;
}

/**
 * Interface symbol
 */
export interface InterfaceSymbol extends SymbolBase {
  readonly kind: SymbolKind.Interface;
  readonly signals: number[];    // Symbol IDs
  readonly views: string[];      // View names
}

/**
 * Enum symbol
 */
export interface EnumSymbol extends SymbolBase {
  readonly kind: SymbolKind.Enum;
  readonly variants: number[];   // EnumVariant symbol IDs
}

/**
 * Struct symbol
 */
export interface StructSymbol extends SymbolBase {
  readonly kind: SymbolKind.Struct;
  readonly fields: number[];     // Field symbol IDs
}

/**
 * Port symbol
 */
export interface PortSymbol extends SymbolBase {
  readonly kind: SymbolKind.Port;
  readonly direction: PortDirection;
}

/**
 * Signal symbol
 */
export interface SignalSymbol extends SymbolBase {
  readonly kind: SymbolKind.Signal;
  readonly isReg: boolean;
  readonly hasInit: boolean;
}

/**
 * Constant symbol
 */
export interface ConstantSymbol extends SymbolBase {
  readonly kind: SymbolKind.Constant;
}

/**
 * Instance symbol
 */
export interface InstanceSymbol extends SymbolBase {
  readonly kind: SymbolKind.Instance;
  readonly moduleName: string;
}

/**
 * FSM symbol
 */
export interface FsmSymbol extends SymbolBase {
  readonly kind: SymbolKind.Fsm;
  readonly states: number[];     // FsmState symbol IDs
  readonly initialState: string;
}

/**
 * FSM State symbol
 */
export interface FsmStateSymbol extends SymbolBase {
  readonly kind: SymbolKind.FsmState;
  readonly fsmId: number;        // Parent FSM symbol ID
}

/**
 * Parameter symbol
 */
export interface ParameterSymbol extends SymbolBase {
  readonly kind: SymbolKind.Parameter;
  readonly index: number;        // Parameter position
}

/**
 * Variable symbol
 */
export interface VariableSymbol extends SymbolBase {
  readonly kind: SymbolKind.Variable;
}

/**
 * Generic parameter symbol
 */
export interface GenericParamSymbol extends SymbolBase {
  readonly kind: SymbolKind.GenericParam;
  readonly isTypeParam: boolean;
  readonly defaultValue: boolean;
}

/**
 * Enum variant symbol
 */
export interface EnumVariantSymbol extends SymbolBase {
  readonly kind: SymbolKind.EnumVariant;
  readonly enumId: number;       // Parent enum symbol ID
  readonly value: bigint | undefined;
}

/**
 * Type alias symbol
 */
export interface TypeAliasSymbol extends SymbolBase {
  readonly kind: SymbolKind.TypeAlias;
  readonly aliasedType: TypeExpr;
}

/**
 * Memory symbol
 */
export interface MemorySymbol extends SymbolBase {
  readonly kind: SymbolKind.Memory;
  readonly depth: number | undefined;
}

/**
 * Package symbol
 */
export interface PackageSymbol extends SymbolBase {
  readonly kind: SymbolKind.Package;
  readonly path: string[];
}

/**
 * Symbol union type
 */
export type Symbol =
  | ModuleSymbol
  | FunctionSymbol
  | InterfaceSymbol
  | EnumSymbol
  | StructSymbol
  | PortSymbol
  | SignalSymbol
  | ConstantSymbol
  | InstanceSymbol
  | FsmSymbol
  | FsmStateSymbol
  | ParameterSymbol
  | VariableSymbol
  | GenericParamSymbol
  | EnumVariantSymbol
  | TypeAliasSymbol
  | MemorySymbol
  | PackageSymbol;

/**
 * Check if symbol kind is a type definition
 */
export function isTypeSymbol(kind: SymbolKind): boolean {
  return kind === SymbolKind.Enum ||
         kind === SymbolKind.Struct ||
         kind === SymbolKind.TypeAlias ||
         kind === SymbolKind.Interface;
}

/**
 * Check if symbol kind defines a new scope
 */
export function isScopeSymbol(kind: SymbolKind): boolean {
  return kind === SymbolKind.Module ||
         kind === SymbolKind.Function ||
         kind === SymbolKind.Fsm ||
         kind === SymbolKind.Package;
}

/**
 * Get human-readable symbol kind name
 */
export function symbolKindName(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.Module: return 'module';
    case SymbolKind.Function: return 'function';
    case SymbolKind.Interface: return 'interface';
    case SymbolKind.Package: return 'package';
    case SymbolKind.Enum: return 'enum';
    case SymbolKind.Struct: return 'struct';
    case SymbolKind.TypeAlias: return 'type alias';
    case SymbolKind.EnumVariant: return 'enum variant';
    case SymbolKind.Port: return 'port';
    case SymbolKind.Signal: return 'signal';
    case SymbolKind.Constant: return 'constant';
    case SymbolKind.Instance: return 'instance';
    case SymbolKind.Memory: return 'memory';
    case SymbolKind.Fsm: return 'fsm';
    case SymbolKind.FsmState: return 'state';
    case SymbolKind.Parameter: return 'parameter';
    case SymbolKind.Variable: return 'variable';
    case SymbolKind.GenericParam: return 'generic parameter';
  }
}
