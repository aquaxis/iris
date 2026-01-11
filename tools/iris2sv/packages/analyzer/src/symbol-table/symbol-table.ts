/**
 * Symbol Table
 *
 * High-level interface for symbol management during semantic analysis.
 */

import type { SourceSpan, TypeExpr } from '@iris2sv/core';
import type {
  Symbol,
  SymbolFlags,
  ModuleSymbol,
  FunctionSymbol,
  PortSymbol,
  SignalSymbol,
  ConstantSymbol,
  EnumSymbol,
  StructSymbol,
  InstanceSymbol,
  FsmSymbol,
  FsmStateSymbol,
  ParameterSymbol,
  VariableSymbol,
  GenericParamSymbol,
  EnumVariantSymbol,
  TypeAliasSymbol,
  MemorySymbol,
  PortDirection} from './symbol.js';
import {
  SymbolKind,
  DEFAULT_FLAGS,
  symbolKindName,
} from './symbol.js';
import type { Scope } from './scope.js';
import { ScopeManager, ScopeKind } from './scope.js';

/**
 * Diagnostic severity
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Diagnostic message
 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly span: SourceSpan;
  readonly relatedSpan?: SourceSpan;
}

/**
 * Symbol table for IRIS semantic analysis
 */
export class SymbolTable {
  private readonly scopeManager: ScopeManager;
  private diagnostics: Diagnostic[] = [];

  constructor() {
    this.scopeManager = new ScopeManager();
  }

  // ==================== Scope Management ====================

  /**
   * Enter a new module scope
   */
  enterModule(name: string): number {
    return this.scopeManager.createScope(ScopeKind.Module, name);
  }

  /**
   * Enter a new function scope
   */
  enterFunction(name: string): number {
    return this.scopeManager.createScope(ScopeKind.Function, name);
  }

  /**
   * Enter a new block scope
   */
  enterBlock(name = 'block'): number {
    return this.scopeManager.createScope(ScopeKind.Block, name);
  }

  /**
   * Enter a new FSM scope
   */
  enterFsm(name: string): number {
    return this.scopeManager.createScope(ScopeKind.Fsm, name);
  }

  /**
   * Enter a new package scope
   */
  enterPackage(name: string): number {
    return this.scopeManager.createScope(ScopeKind.Package, name);
  }

  /**
   * Exit the current scope
   */
  exitScope(): void {
    this.scopeManager.exitScope();
  }

  /**
   * Get the current scope
   */
  currentScope(): Scope | undefined {
    return this.scopeManager.currentScope();
  }

  /**
   * Get the global scope
   */
  globalScope(): Scope {
    return this.scopeManager.globalScope();
  }

  // ==================== Symbol Definition ====================

  /**
   * Define a module symbol
   */
  defineModule(
    name: string,
    span: SourceSpan,
    flags: Partial<SymbolFlags> = {}
  ): ModuleSymbol {
    const symbol: ModuleSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Module,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      ports: [],
      signals: [],
      instances: [],
      fsms: [],
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a function symbol
   */
  defineFunction(
    name: string,
    span: SourceSpan,
    returnType: TypeExpr | undefined,
    flags: Partial<SymbolFlags> = {}
  ): FunctionSymbol {
    const symbol: FunctionSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Function,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      params: [],
      returnType,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a port symbol
   */
  definePort(
    name: string,
    span: SourceSpan,
    direction: PortDirection,
    type: TypeExpr
  ): PortSymbol {
    const symbol: PortSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Port,
      span,
      flags: DEFAULT_FLAGS,
      type,
      parentId: this.scopeManager.currentScopeId(),
      direction,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a signal symbol
   */
  defineSignal(
    name: string,
    span: SourceSpan,
    type: TypeExpr | undefined,
    isReg: boolean,
    hasInit: boolean,
    flags: Partial<SymbolFlags> = {}
  ): SignalSymbol {
    const symbol: SignalSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Signal,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type,
      parentId: this.scopeManager.currentScopeId(),
      isReg,
      hasInit,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a constant symbol
   */
  defineConstant(
    name: string,
    span: SourceSpan,
    type: TypeExpr,
    flags: Partial<SymbolFlags> = {}
  ): ConstantSymbol {
    const symbol: ConstantSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Constant,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type,
      parentId: this.scopeManager.currentScopeId(),
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define an enum symbol
   */
  defineEnum(
    name: string,
    span: SourceSpan,
    flags: Partial<SymbolFlags> = {}
  ): EnumSymbol {
    const symbol: EnumSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Enum,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      variants: [],
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define an enum variant symbol
   */
  defineEnumVariant(
    name: string,
    span: SourceSpan,
    enumId: number,
    value: bigint | undefined
  ): EnumVariantSymbol {
    const symbol: EnumVariantSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.EnumVariant,
      span,
      flags: DEFAULT_FLAGS,
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      enumId,
      value,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a struct symbol
   */
  defineStruct(
    name: string,
    span: SourceSpan,
    flags: Partial<SymbolFlags> = {}
  ): StructSymbol {
    const symbol: StructSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Struct,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      fields: [],
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a type alias symbol
   */
  defineTypeAlias(
    name: string,
    span: SourceSpan,
    aliasedType: TypeExpr,
    flags: Partial<SymbolFlags> = {}
  ): TypeAliasSymbol {
    const symbol: TypeAliasSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.TypeAlias,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      aliasedType,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define an instance symbol
   */
  defineInstance(
    name: string,
    span: SourceSpan,
    moduleName: string
  ): InstanceSymbol {
    const symbol: InstanceSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Instance,
      span,
      flags: DEFAULT_FLAGS,
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      moduleName,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a memory symbol
   */
  defineMemory(
    name: string,
    span: SourceSpan,
    type: TypeExpr,
    depth: number | undefined
  ): MemorySymbol {
    const symbol: MemorySymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Memory,
      span,
      flags: DEFAULT_FLAGS,
      type,
      parentId: this.scopeManager.currentScopeId(),
      depth,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define an FSM symbol
   */
  defineFsm(
    name: string,
    span: SourceSpan,
    initialState: string
  ): FsmSymbol {
    const symbol: FsmSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Fsm,
      span,
      flags: DEFAULT_FLAGS,
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      states: [],
      initialState,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define an FSM state symbol
   */
  defineFsmState(
    name: string,
    span: SourceSpan,
    fsmId: number
  ): FsmStateSymbol {
    const symbol: FsmStateSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.FsmState,
      span,
      flags: DEFAULT_FLAGS,
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      fsmId,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a parameter symbol
   */
  defineParameter(
    name: string,
    span: SourceSpan,
    type: TypeExpr,
    index: number
  ): ParameterSymbol {
    const symbol: ParameterSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Parameter,
      span,
      flags: DEFAULT_FLAGS,
      type,
      parentId: this.scopeManager.currentScopeId(),
      index,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a variable symbol
   */
  defineVariable(
    name: string,
    span: SourceSpan,
    type: TypeExpr | undefined,
    flags: Partial<SymbolFlags> = {}
  ): VariableSymbol {
    const symbol: VariableSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.Variable,
      span,
      flags: { ...DEFAULT_FLAGS, ...flags },
      type,
      parentId: this.scopeManager.currentScopeId(),
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  /**
   * Define a generic parameter symbol
   */
  defineGenericParam(
    name: string,
    span: SourceSpan,
    isTypeParam: boolean,
    hasDefault: boolean
  ): GenericParamSymbol {
    const symbol: GenericParamSymbol = {
      id: this.scopeManager.newSymbolId(),
      name,
      kind: SymbolKind.GenericParam,
      span,
      flags: DEFAULT_FLAGS,
      type: undefined,
      parentId: this.scopeManager.currentScopeId(),
      isTypeParam,
      defaultValue: hasDefault,
    };

    this.defineSymbolWithCheck(symbol);
    return symbol;
  }

  // ==================== Symbol Updates ====================

  /**
   * Update module symbol with port IDs
   */
  updateModulePorts(moduleId: number, portIds: number[]): void {
    this.scopeManager.updateModulePorts(moduleId, portIds);
  }

  // ==================== Symbol Lookup ====================

  /**
   * Look up a symbol by name
   */
  lookup(name: string): Symbol | undefined {
    return this.scopeManager.lookup(name);
  }

  /**
   * Look up a symbol by name and kind
   */
  lookupByKind(name: string, kind: SymbolKind): Symbol | undefined {
    return this.scopeManager.lookupByKind(name, kind);
  }

  /**
   * Get a symbol by ID
   */
  getSymbol(id: number): Symbol | undefined {
    return this.scopeManager.getSymbol(id);
  }

  /**
   * Get all symbols in a scope
   */
  getSymbolsInScope(scopeId: number): Symbol[] {
    return this.scopeManager.getSymbolsInScope(scopeId);
  }

  /**
   * Get all symbols of a specific kind in a scope
   */
  getSymbolsOfKind(scopeId: number, kind: SymbolKind): Symbol[] {
    return this.scopeManager.getSymbolsOfKind(scopeId, kind);
  }

  // ==================== Diagnostics ====================

  /**
   * Report an error
   */
  error(message: string, span: SourceSpan, relatedSpan?: SourceSpan): void {
    const diagnostic: Diagnostic = relatedSpan !== undefined
      ? { severity: 'error', message, span, relatedSpan }
      : { severity: 'error', message, span };
    this.diagnostics.push(diagnostic);
  }

  /**
   * Report a warning
   */
  warning(message: string, span: SourceSpan, relatedSpan?: SourceSpan): void {
    const diagnostic: Diagnostic = relatedSpan !== undefined
      ? { severity: 'warning', message, span, relatedSpan }
      : { severity: 'warning', message, span };
    this.diagnostics.push(diagnostic);
  }

  /**
   * Report an info message
   */
  info(message: string, span: SourceSpan): void {
    this.diagnostics.push({ severity: 'info', message, span });
  }

  /**
   * Get all diagnostics
   */
  getDiagnostics(): Diagnostic[] {
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

  // ==================== Internal Helpers ====================

  private defineSymbolWithCheck(symbol: Symbol): void {
    // Check for duplicate definition in current scope
    if (this.scopeManager.isDefinedInCurrentScope(symbol.name)) {
      const existing = this.scopeManager.lookupInScope(
        symbol.name,
        this.scopeManager.currentScopeId() ?? 0
      );
      if (existing) {
        this.error(
          `Duplicate definition of '${symbol.name}'. Previously defined as ${symbolKindName(existing.kind)}.`,
          symbol.span,
          existing.span
        );
      }
    }

    this.scopeManager.defineSymbol(symbol);
  }

  // ==================== Debug ====================

  /**
   * Get all scopes (for debugging)
   */
  getAllScopes(): Scope[] {
    return this.scopeManager.getAllScopes();
  }

  /**
   * Get all symbols (for debugging)
   */
  getAllSymbols(): Symbol[] {
    return this.scopeManager.getAllSymbols();
  }
}
