/**
 * Symbol Table Builder
 *
 * Builds symbol table from IRIS AST using visitor pattern.
 * First pass collects all symbol definitions.
 */

import type {
  SourceFile,
  Item,
  ModDef,
  FnDef,
  EnumDef,
  StructDef,
  TypeAliasDef,
  ConstDef,
  InterfaceDef,
  PackageDecl,
  PortDecl,
  ModItem,
  SignalDecl,
  ConstDecl,
  TypeAlias,
  FsmBlock,
  InstDecl,
  MemDecl,
  FnParam,
  EnumVariant,
  GenericParam,
  Stmt,
  LetStmt,
  VarStmt,
  ForStmt,
  IfStmt,
  MatchStmt,
  BlockStmt,
  Visibility,
} from '@iris2sv/core';
import { SymbolTable } from './symbol-table.js';
import type { PortDirection as SymbolPortDirection } from './symbol.js';

/**
 * Build result
 */
export interface BuildResult {
  readonly symbolTable: SymbolTable;
  readonly hasErrors: boolean;
}

/**
 * Symbol table builder
 */
export class SymbolTableBuilder {
  private readonly symbolTable: SymbolTable;

  constructor() {
    this.symbolTable = new SymbolTable();
  }

  /**
   * Build symbol table from source file
   */
  build(sourceFile: SourceFile): BuildResult {
    // Process all top-level items
    for (const item of sourceFile.items) {
      this.visitItem(item);
    }

    return {
      symbolTable: this.symbolTable,
      hasErrors: this.symbolTable.hasErrors(),
    };
  }

  /**
   * Get the symbol table (for testing)
   */
  getSymbolTable(): SymbolTable {
    return this.symbolTable;
  }

  // ==================== Item Visitors ====================

  private visitItem(item: Item): void {
    switch (item.kind) {
      case 'ModDef':
        this.visitModDef(item);
        break;
      case 'FnDef':
        this.visitFnDef(item);
        break;
      case 'EnumDef':
        this.visitEnumDef(item);
        break;
      case 'StructDef':
        this.visitStructDef(item);
        break;
      case 'TypeAliasDef':
        this.visitTypeAliasDef(item);
        break;
      case 'ConstDef':
        this.visitConstDef(item);
        break;
      case 'InterfaceDef':
        this.visitInterfaceDef(item);
        break;
      case 'PackageDecl':
        this.visitPackageDecl(item);
        break;
      case 'ImportDecl':
        // Import declarations don't create symbols in this pass
        break;
      case 'TestDef':
        // Test definitions are not part of symbol table
        break;
    }
  }

  private visitModDef(mod: ModDef): void {
    // Define module symbol
    const modSymbol = this.symbolTable.defineModule(
      mod.name.name,
      mod.span,
      { isPublic: this.isPublic(mod.visibility) }
    );

    // Enter module scope
    this.symbolTable.enterModule(mod.name.name);

    // Process generic parameters
    if (mod.genericParams) {
      for (const param of mod.genericParams.params) {
        this.visitGenericParam(param);
      }
    }

    // Process ports and collect their IDs
    const portIds: number[] = [];
    for (const port of mod.ports) {
      const portSymbol = this.visitPortDecl(port);
      portIds.push(portSymbol.id);
    }

    // Update module symbol with port IDs
    this.symbolTable.updateModulePorts(modSymbol.id, portIds);

    // Process module items
    for (const item of mod.items) {
      this.visitModItem(item, modSymbol.id);
    }

    // Exit module scope
    this.symbolTable.exitScope();
  }

  private visitFnDef(fn: FnDef): void {
    // Define function symbol
    this.symbolTable.defineFunction(
      fn.name.name,
      fn.span,
      fn.returnType,
      { isPublic: this.isPublic(fn.visibility) }
    );

    // Enter function scope
    this.symbolTable.enterFunction(fn.name.name);

    // Process generic parameters
    if (fn.genericParams) {
      for (const param of fn.genericParams.params) {
        this.visitGenericParam(param);
      }
    }

    // Process function parameters
    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i];
      if (param) {
        this.visitFnParam(param, i);
      }
    }

    // Process function body statements
    for (const stmt of fn.body) {
      this.visitStmt(stmt);
    }

    // Exit function scope
    this.symbolTable.exitScope();
  }

  private visitEnumDef(enumDef: EnumDef): void {
    // Define enum symbol
    const enumSymbol = this.symbolTable.defineEnum(
      enumDef.name.name,
      enumDef.span,
      { isPublic: this.isPublic(enumDef.visibility) }
    );

    // Process generic parameters
    if (enumDef.genericParams) {
      for (const param of enumDef.genericParams.params) {
        this.visitGenericParam(param);
      }
    }

    // Process variants
    for (const variant of enumDef.variants) {
      this.visitEnumVariant(variant, enumSymbol.id);
    }
  }

  private visitStructDef(structDef: StructDef): void {
    // Define struct symbol
    this.symbolTable.defineStruct(
      structDef.name.name,
      structDef.span,
      { isPublic: this.isPublic(structDef.visibility) }
    );

    // Process generic parameters
    if (structDef.genericParams) {
      for (const param of structDef.genericParams.params) {
        this.visitGenericParam(param);
      }
    }

    // Fields are part of struct type, not separately defined as symbols
  }

  private visitTypeAliasDef(alias: TypeAliasDef): void {
    this.symbolTable.defineTypeAlias(
      alias.name.name,
      alias.span,
      alias.type,
      { isPublic: this.isPublic(alias.visibility) }
    );

    // Process generic parameters
    if (alias.genericParams) {
      for (const param of alias.genericParams.params) {
        this.visitGenericParam(param);
      }
    }
  }

  private visitConstDef(constDef: ConstDef): void {
    this.symbolTable.defineConstant(
      constDef.name.name,
      constDef.span,
      constDef.type,
      { isPublic: this.isPublic(constDef.visibility) }
    );
  }

  private visitInterfaceDef(iface: InterfaceDef): void {
    // Interfaces are not directly supported in symbol table yet
    // Could add InterfaceSymbol support if needed
    this.symbolTable.warning(
      `Interface '${iface.name.name}' - interface symbol support not yet implemented`,
      iface.span
    );
  }

  private visitPackageDecl(pkg: PackageDecl): void {
    // Get package name from path
    const packageName = pkg.path.segments.map(s => s.name).join('::');

    // Enter package scope
    this.symbolTable.enterPackage(packageName);

    // Process package items
    for (const item of pkg.items) {
      this.visitItem(item);
    }

    // Exit package scope
    this.symbolTable.exitScope();
  }

  // ==================== Module Item Visitors ====================

  private visitModItem(item: ModItem, _moduleId: number): void {
    switch (item.kind) {
      case 'SignalDecl':
        this.visitSignalDecl(item);
        break;
      case 'ConstDecl':
        this.visitConstDecl(item);
        break;
      case 'TypeAlias':
        this.visitTypeAliasInModule(item);
        break;
      case 'CombBlock':
        // Comb blocks don't define new symbols, but may contain statements
        // that could be analyzed in a later pass
        break;
      case 'SyncBlock':
        // Sync blocks similar to comb
        break;
      case 'FsmBlock':
        this.visitFsmBlock(item);
        break;
      case 'InstDecl':
        this.visitInstDecl(item);
        break;
      case 'MemDecl':
        this.visitMemDecl(item);
        break;
    }
  }

  private visitPortDecl(port: PortDecl) {
    const direction = this.mapPortDirection(port.direction);
    return this.symbolTable.definePort(
      port.name.name,
      port.span,
      direction,
      port.type
    );
  }

  private visitSignalDecl(signal: SignalDecl): void {
    const isReg = signal.declKind === 'var';
    this.symbolTable.defineSignal(
      signal.name.name,
      signal.span,
      signal.type,
      isReg,
      signal.init !== undefined,
      { isMutable: signal.mutable }
    );
  }

  private visitConstDecl(constDecl: ConstDecl): void {
    this.symbolTable.defineConstant(
      constDecl.name.name,
      constDecl.span,
      constDecl.type
    );
  }

  private visitTypeAliasInModule(alias: TypeAlias): void {
    this.symbolTable.defineTypeAlias(
      alias.name.name,
      alias.span,
      alias.type
    );

    // Process generic parameters
    if (alias.genericParams) {
      for (const param of alias.genericParams.params) {
        this.visitGenericParam(param);
      }
    }
  }

  private visitFsmBlock(fsm: FsmBlock): void {
    // Get initial state from first state in enum
    const initialState = fsm.states.states[0]?.name.name ?? 'unknown';

    // Define FSM symbol
    const fsmSymbol = this.symbolTable.defineFsm(
      fsm.name.name,
      fsm.span,
      initialState
    );

    // Enter FSM scope
    this.symbolTable.enterFsm(fsm.name.name);

    // Define state symbols
    for (const state of fsm.states.states) {
      this.symbolTable.defineFsmState(
        state.name.name,
        state.span,
        fsmSymbol.id
      );
    }

    // Exit FSM scope
    this.symbolTable.exitScope();
  }

  private visitInstDecl(inst: InstDecl): void {
    // Get module name from path
    const moduleName = inst.module.segments.map(s => s.name).join('::');

    this.symbolTable.defineInstance(
      inst.name.name,
      inst.span,
      moduleName
    );
  }

  private visitMemDecl(mem: MemDecl): void {
    // Depth is an expression - for now just mark it as undefined
    // Actual depth evaluation would happen in type checking
    this.symbolTable.defineMemory(
      mem.name.name,
      mem.span,
      mem.elementType,
      undefined
    );
  }

  // ==================== Helper Visitors ====================

  private visitGenericParam(param: GenericParam): void {
    // Check if it's a type parameter based on bound kind
    const isTypeParam = param.bound.kind === 'TypeBound';
    const hasDefault = param.defaultValue !== undefined;

    this.symbolTable.defineGenericParam(
      param.name.name,
      param.span,
      isTypeParam,
      hasDefault
    );
  }

  private visitFnParam(param: FnParam, index: number): void {
    this.symbolTable.defineParameter(
      param.name.name,
      param.span,
      param.type,
      index
    );
  }

  private visitEnumVariant(variant: EnumVariant, enumId: number): void {
    // Value would be evaluated during type checking
    this.symbolTable.defineEnumVariant(
      variant.name.name,
      variant.span,
      enumId,
      undefined
    );
  }

  // ==================== Statement Visitors ====================

  private visitStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'LetStmt':
        this.visitLetStmt(stmt);
        break;
      case 'VarStmt':
        this.visitVarStmt(stmt);
        break;
      case 'ForStmt':
        this.visitForStmt(stmt);
        break;
      case 'IfStmt':
        this.visitIfStmt(stmt);
        break;
      case 'MatchStmt':
        this.visitMatchStmt(stmt);
        break;
      case 'BlockStmt':
        this.visitBlockStmt(stmt);
        break;
      // Other statement types don't introduce new symbols
      default:
        break;
    }
  }

  private visitLetStmt(stmt: LetStmt): void {
    this.symbolTable.defineVariable(
      stmt.name.name,
      stmt.span,
      stmt.type,
      { isMutable: stmt.mutable }
    );
  }

  private visitVarStmt(stmt: VarStmt): void {
    this.symbolTable.defineVariable(
      stmt.name.name,
      stmt.span,
      stmt.type,
      { isMutable: true }
    );
  }

  private visitForStmt(stmt: ForStmt): void {
    // Enter block scope for loop
    this.symbolTable.enterBlock('for');

    // Define loop variable
    this.symbolTable.defineVariable(
      stmt.variable.name,
      stmt.variable.span,
      undefined, // Type inferred from range
      { isMutable: false }
    );

    // Visit body statements
    for (const bodyStmt of stmt.body) {
      this.visitStmt(bodyStmt);
    }

    this.symbolTable.exitScope();
  }

  private visitIfStmt(stmt: IfStmt): void {
    // Enter block scope for then branch
    this.symbolTable.enterBlock('if_then');
    for (const thenStmt of stmt.thenBranch) {
      this.visitStmt(thenStmt);
    }
    this.symbolTable.exitScope();

    // Handle else branch if present
    if (stmt.elseBranch) {
      if (Array.isArray(stmt.elseBranch)) {
        // Else branch is a list of statements
        this.symbolTable.enterBlock('if_else');
        for (const elseStmt of stmt.elseBranch) {
          this.visitStmt(elseStmt);
        }
        this.symbolTable.exitScope();
      } else {
        // Else branch is an if statement (else if)
        this.visitIfStmt(stmt.elseBranch);
      }
    }
  }

  private visitMatchStmt(stmt: MatchStmt): void {
    // Each arm is a separate scope
    for (const arm of stmt.arms) {
      this.symbolTable.enterBlock('match_arm');

      // Pattern bindings would be defined here
      // For now, just visit body if it's statements
      const body = arm.body;
      if (Array.isArray(body)) {
        for (const bodyStmt of body) {
          this.visitStmt(bodyStmt);
        }
      }
      // If body is an Expr, no statements to visit

      this.symbolTable.exitScope();
    }
  }

  private visitBlockStmt(stmt: BlockStmt): void {
    this.symbolTable.enterBlock('block');

    for (const bodyStmt of stmt.statements) {
      this.visitStmt(bodyStmt);
    }

    this.symbolTable.exitScope();
  }

  // ==================== Utility Methods ====================

  private isPublic(visibility: Visibility): boolean {
    return visibility === 'public';
  }

  private mapPortDirection(dir: PortDecl['direction']): SymbolPortDirection {
    switch (dir) {
      case 'in':
        return 'in';
      case 'out':
        return 'out';
      case 'inout':
        return 'inout';
      case 'initiator':
      case 'target':
      case 'monitor':
        // Interface ports are mapped to inout for now
        return 'inout';
    }
  }
}

/**
 * Build symbol table from source file (convenience function)
 */
export function buildSymbolTable(sourceFile: SourceFile): BuildResult {
  const builder = new SymbolTableBuilder();
  return builder.build(sourceFile);
}
