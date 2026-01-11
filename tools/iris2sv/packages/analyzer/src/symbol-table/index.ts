/**
 * Symbol Table Module
 *
 * Provides symbol table infrastructure for IRIS semantic analysis.
 */

// Symbol definitions
export {
  SymbolKind,
  PortDirection,
  DEFAULT_FLAGS,
  isTypeSymbol,
  isScopeSymbol,
  symbolKindName,
} from './symbol.js';

export type {
  SymbolFlags,
  SymbolBase,
  ModuleSymbol,
  FunctionSymbol,
  InterfaceSymbol,
  EnumSymbol,
  StructSymbol,
  PortSymbol,
  SignalSymbol,
  ConstantSymbol,
  InstanceSymbol,
  FsmSymbol,
  FsmStateSymbol,
  ParameterSymbol,
  VariableSymbol,
  GenericParamSymbol,
  EnumVariantSymbol,
  TypeAliasSymbol,
  MemorySymbol,
  PackageSymbol,
  Symbol,
} from './symbol.js';

// Scope definitions
export { ScopeKind, ScopeManager } from './scope.js';

export type { Scope } from './scope.js';

// Symbol table
export { SymbolTable } from './symbol-table.js';

export type { DiagnosticSeverity, Diagnostic } from './symbol-table.js';

// Symbol table builder
export { SymbolTableBuilder, buildSymbolTable } from './builder.js';

export type { BuildResult } from './builder.js';
