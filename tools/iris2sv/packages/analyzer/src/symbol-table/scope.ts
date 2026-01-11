/**
 * Scope Implementation
 *
 * Represents a lexical scope in the IRIS language.
 */

import type { Symbol, SymbolKind } from './symbol.js';

/**
 * Scope kind
 */
export enum ScopeKind {
  Global = 'Global',
  Module = 'Module',
  Function = 'Function',
  Block = 'Block',
  Fsm = 'Fsm',
  Package = 'Package',
}

/**
 * Scope interface
 */
export interface Scope {
  readonly id: number;
  readonly kind: ScopeKind;
  readonly name: string;
  readonly parentId: number | undefined;
  readonly symbolIds: number[];        // Symbols defined in this scope
  readonly childScopeIds: number[];    // Child scopes
}

/**
 * Scope manager for creating and managing scopes
 */
export class ScopeManager {
  private readonly scopes = new Map<number, Scope>();
  private readonly symbols = new Map<number, Symbol>();
  private readonly scopeStack: number[] = [];
  private nextScopeId = 0;
  private nextSymbolId = 0;

  constructor() {
    // Create global scope
    this.createScope(ScopeKind.Global, 'global');
  }

  /**
   * Create a new scope and enter it
   */
  createScope(kind: ScopeKind, name: string): number {
    const parentId = this.scopeStack.length > 0
      ? this.scopeStack[this.scopeStack.length - 1]
      : undefined;

    const scope: Scope = {
      id: this.nextScopeId++,
      kind,
      name,
      parentId,
      symbolIds: [],
      childScopeIds: [],
    };

    this.scopes.set(scope.id, scope);

    // Add as child to parent scope
    if (parentId !== undefined) {
      const parent = this.scopes.get(parentId);
      if (parent) {
        this.scopes.set(parentId, {
          ...parent,
          childScopeIds: [...parent.childScopeIds, scope.id],
        });
      }
    }

    this.scopeStack.push(scope.id);
    return scope.id;
  }

  /**
   * Enter an existing scope
   */
  enterScope(scopeId: number): void {
    if (!this.scopes.has(scopeId)) {
      throw new Error(`Scope ${scopeId} does not exist`);
    }
    this.scopeStack.push(scopeId);
  }

  /**
   * Exit the current scope
   */
  exitScope(): number | undefined {
    if (this.scopeStack.length <= 1) {
      return undefined; // Don't exit global scope
    }
    return this.scopeStack.pop();
  }

  /**
   * Get the current scope
   */
  currentScope(): Scope | undefined {
    if (this.scopeStack.length === 0) {
      return undefined;
    }
    const currentId = this.scopeStack[this.scopeStack.length - 1];
    return currentId !== undefined ? this.scopes.get(currentId) : undefined;
  }

  /**
   * Get the current scope ID
   */
  currentScopeId(): number | undefined {
    return this.scopeStack[this.scopeStack.length - 1];
  }

  /**
   * Get a scope by ID
   */
  getScope(id: number): Scope | undefined {
    return this.scopes.get(id);
  }

  /**
   * Get the global scope
   */
  globalScope(): Scope {
    const global = this.scopes.get(0);
    if (!global) {
      throw new Error('Global scope not found');
    }
    return global;
  }

  /**
   * Get parent scope
   */
  parentScope(scopeId: number): Scope | undefined {
    const scope = this.scopes.get(scopeId);
    if (scope?.parentId === undefined) {
      return undefined;
    }
    return this.scopes.get(scope.parentId);
  }

  /**
   * Generate a new symbol ID
   */
  newSymbolId(): number {
    return this.nextSymbolId++;
  }

  /**
   * Define a symbol in the current scope
   */
  defineSymbol(symbol: Symbol): void {
    const currentId = this.currentScopeId();
    if (currentId === undefined) {
      throw new Error('No current scope');
    }

    this.symbols.set(symbol.id, symbol);

    const scope = this.scopes.get(currentId);
    if (scope) {
      this.scopes.set(currentId, {
        ...scope,
        symbolIds: [...scope.symbolIds, symbol.id],
      });
    }
  }

  /**
   * Get a symbol by ID
   */
  getSymbol(id: number): Symbol | undefined {
    return this.symbols.get(id);
  }

  /**
   * Look up a symbol by name in the current scope and its parents
   */
  lookup(name: string): Symbol | undefined {
    let scopeId = this.currentScopeId();

    while (scopeId !== undefined) {
      const scope = this.scopes.get(scopeId);
      if (!scope) break;

      // Search in current scope
      for (const symbolId of scope.symbolIds) {
        const symbol = this.symbols.get(symbolId);
        if (symbol?.name === name) {
          return symbol;
        }
      }

      // Move to parent scope
      scopeId = scope.parentId;
    }

    return undefined;
  }

  /**
   * Look up a symbol by name in a specific scope only (no parent lookup)
   */
  lookupInScope(name: string, scopeId: number): Symbol | undefined {
    const scope = this.scopes.get(scopeId);
    if (!scope) return undefined;

    for (const symbolId of scope.symbolIds) {
      const symbol = this.symbols.get(symbolId);
      if (symbol?.name === name) {
        return symbol;
      }
    }

    return undefined;
  }

  /**
   * Look up a symbol by name and kind
   */
  lookupByKind(name: string, kind: SymbolKind): Symbol | undefined {
    let scopeId = this.currentScopeId();

    while (scopeId !== undefined) {
      const scope = this.scopes.get(scopeId);
      if (!scope) break;

      for (const symbolId of scope.symbolIds) {
        const symbol = this.symbols.get(symbolId);
        if (symbol?.name === name && symbol.kind === kind) {
          return symbol;
        }
      }

      scopeId = scope.parentId;
    }

    return undefined;
  }

  /**
   * Check if a name is defined in the current scope (not parents)
   */
  isDefinedInCurrentScope(name: string): boolean {
    const currentId = this.currentScopeId();
    if (currentId === undefined) return false;
    return this.lookupInScope(name, currentId) !== undefined;
  }

  /**
   * Get all symbols of a specific kind in a scope
   */
  getSymbolsOfKind(scopeId: number, kind: SymbolKind): Symbol[] {
    const scope = this.scopes.get(scopeId);
    if (!scope) return [];

    const result: Symbol[] = [];
    for (const symbolId of scope.symbolIds) {
      const symbol = this.symbols.get(symbolId);
      if (symbol?.kind === kind) {
        result.push(symbol);
      }
    }
    return result;
  }

  /**
   * Get all symbols in a scope
   */
  getSymbolsInScope(scopeId: number): Symbol[] {
    const scope = this.scopes.get(scopeId);
    if (!scope) return [];

    const result: Symbol[] = [];
    for (const symbolId of scope.symbolIds) {
      const symbol = this.symbols.get(symbolId);
      if (symbol) {
        result.push(symbol);
      }
    }
    return result;
  }

  /**
   * Get all scopes
   */
  getAllScopes(): Scope[] {
    return Array.from(this.scopes.values());
  }

  /**
   * Get all symbols
   */
  getAllSymbols(): Symbol[] {
    return Array.from(this.symbols.values());
  }

  /**
   * Get scope depth (number of parent scopes)
   */
  getScopeDepth(scopeId: number): number {
    let depth = 0;
    let currentId: number | undefined = scopeId;

    while (currentId !== undefined) {
      const scope = this.scopes.get(currentId);
      if (scope?.parentId === undefined) break;
      currentId = scope.parentId;
      depth++;
    }

    return depth;
  }

  /**
   * Get the scope path (names from global to current)
   */
  getScopePath(scopeId: number): string[] {
    const path: string[] = [];
    let currentId: number | undefined = scopeId;

    while (currentId !== undefined) {
      const scope = this.scopes.get(currentId);
      if (!scope) break;
      path.unshift(scope.name);
      currentId = scope.parentId;
    }

    return path;
  }

  /**
   * Update module symbol with port IDs
   */
  updateModulePorts(moduleId: number, portIds: number[]): void {
    const symbol = this.symbols.get(moduleId);
    if (symbol && symbol.kind === 'Module') {
      // Create updated module symbol with ports
      const updatedSymbol = {
        ...symbol,
        ports: portIds,
      };
      this.symbols.set(moduleId, updatedSymbol);
    }
  }
}
