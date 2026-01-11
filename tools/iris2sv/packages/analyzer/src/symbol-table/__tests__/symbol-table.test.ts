/**
 * Symbol Table Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SymbolTable,
  ScopeKind,
  ScopeManager,
  SymbolKind,
  symbolKindName,
  isTypeSymbol,
  isScopeSymbol,
  DEFAULT_FLAGS,
} from '../index.js';
import type { SourceSpan, TypeExpr } from '@iris2sv/core';

// Helper to create a mock SourceSpan
function mockSpan(startLine = 1, startColumn = 1): SourceSpan {
  return {
    start: 0,
    end: 10,
    startLine,
    startColumn,
    endLine: startLine,
    endColumn: startColumn + 10,
  };
}

// Helper to create a mock TypeExpr
function mockType(name: string): TypeExpr {
  const span = mockSpan();
  return {
    kind: 'UserType',
    path: {
      kind: 'Path',
      segments: [{ kind: 'Identifier', name, span }],
      span,
    },
    span,
  } as TypeExpr;
}

describe('Symbol', () => {
  describe('symbolKindName', () => {
    it('should return human-readable names for all symbol kinds', () => {
      expect(symbolKindName(SymbolKind.Module)).toBe('module');
      expect(symbolKindName(SymbolKind.Function)).toBe('function');
      expect(symbolKindName(SymbolKind.Interface)).toBe('interface');
      expect(symbolKindName(SymbolKind.Package)).toBe('package');
      expect(symbolKindName(SymbolKind.Enum)).toBe('enum');
      expect(symbolKindName(SymbolKind.Struct)).toBe('struct');
      expect(symbolKindName(SymbolKind.TypeAlias)).toBe('type alias');
      expect(symbolKindName(SymbolKind.EnumVariant)).toBe('enum variant');
      expect(symbolKindName(SymbolKind.Port)).toBe('port');
      expect(symbolKindName(SymbolKind.Signal)).toBe('signal');
      expect(symbolKindName(SymbolKind.Constant)).toBe('constant');
      expect(symbolKindName(SymbolKind.Instance)).toBe('instance');
      expect(symbolKindName(SymbolKind.Memory)).toBe('memory');
      expect(symbolKindName(SymbolKind.Fsm)).toBe('fsm');
      expect(symbolKindName(SymbolKind.FsmState)).toBe('state');
      expect(symbolKindName(SymbolKind.Parameter)).toBe('parameter');
      expect(symbolKindName(SymbolKind.Variable)).toBe('variable');
      expect(symbolKindName(SymbolKind.GenericParam)).toBe('generic parameter');
    });
  });

  describe('isTypeSymbol', () => {
    it('should return true for type definition symbols', () => {
      expect(isTypeSymbol(SymbolKind.Enum)).toBe(true);
      expect(isTypeSymbol(SymbolKind.Struct)).toBe(true);
      expect(isTypeSymbol(SymbolKind.TypeAlias)).toBe(true);
      expect(isTypeSymbol(SymbolKind.Interface)).toBe(true);
    });

    it('should return false for non-type symbols', () => {
      expect(isTypeSymbol(SymbolKind.Module)).toBe(false);
      expect(isTypeSymbol(SymbolKind.Function)).toBe(false);
      expect(isTypeSymbol(SymbolKind.Port)).toBe(false);
      expect(isTypeSymbol(SymbolKind.Signal)).toBe(false);
    });
  });

  describe('isScopeSymbol', () => {
    it('should return true for scope-defining symbols', () => {
      expect(isScopeSymbol(SymbolKind.Module)).toBe(true);
      expect(isScopeSymbol(SymbolKind.Function)).toBe(true);
      expect(isScopeSymbol(SymbolKind.Fsm)).toBe(true);
      expect(isScopeSymbol(SymbolKind.Package)).toBe(true);
    });

    it('should return false for non-scope symbols', () => {
      expect(isScopeSymbol(SymbolKind.Port)).toBe(false);
      expect(isScopeSymbol(SymbolKind.Signal)).toBe(false);
      expect(isScopeSymbol(SymbolKind.Enum)).toBe(false);
    });
  });

  describe('DEFAULT_FLAGS', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_FLAGS.isPublic).toBe(false);
      expect(DEFAULT_FLAGS.isMutable).toBe(false);
      expect(DEFAULT_FLAGS.isGeneric).toBe(false);
    });
  });
});

describe('ScopeManager', () => {
  let manager: ScopeManager;

  beforeEach(() => {
    manager = new ScopeManager();
  });

  describe('scope creation', () => {
    it('should create global scope on construction', () => {
      const global = manager.globalScope();
      expect(global).toBeDefined();
      expect(global.kind).toBe(ScopeKind.Global);
      expect(global.name).toBe('global');
      expect(global.parentId).toBeUndefined();
    });

    it('should create child scopes with correct parent', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      const module = manager.getScope(moduleId);

      expect(module).toBeDefined();
      expect(module!.kind).toBe(ScopeKind.Module);
      expect(module!.name).toBe('MyModule');
      expect(module!.parentId).toBe(0); // Global scope
    });

    it('should track child scopes in parent', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      const global = manager.globalScope();

      expect(global.childScopeIds).toContain(moduleId);
    });
  });

  describe('scope navigation', () => {
    it('should track current scope correctly', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      expect(manager.currentScopeId()).toBe(moduleId);

      const funcId = manager.createScope(ScopeKind.Function, 'myFunc');
      expect(manager.currentScopeId()).toBe(funcId);
    });

    it('should exit scope correctly', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      manager.createScope(ScopeKind.Function, 'myFunc');

      manager.exitScope();
      expect(manager.currentScopeId()).toBe(moduleId);
    });

    it('should not exit global scope', () => {
      manager.exitScope(); // Try to exit global
      expect(manager.currentScope()).toBeDefined();
      expect(manager.currentScope()!.kind).toBe(ScopeKind.Global);
    });

    it('should enter existing scope', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      manager.exitScope();

      manager.enterScope(moduleId);
      expect(manager.currentScopeId()).toBe(moduleId);
    });

    it('should throw when entering non-existent scope', () => {
      expect(() => manager.enterScope(999)).toThrow();
    });
  });

  describe('symbol definition and lookup', () => {
    it('should define and lookup symbol in current scope', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const symbol = {
        id: manager.newSymbolId(),
        name: 'clk',
        kind: SymbolKind.Port as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('clock'),
        parentId: manager.currentScopeId(),
        direction: 'in' as const,
      };

      manager.defineSymbol(symbol);

      const found = manager.lookup('clk');
      expect(found).toBeDefined();
      expect(found!.name).toBe('clk');
      expect(found!.kind).toBe(SymbolKind.Port);
    });

    it('should lookup symbol in parent scope', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const portSymbol = {
        id: manager.newSymbolId(),
        name: 'clk',
        kind: SymbolKind.Port as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('clock'),
        parentId: manager.currentScopeId(),
        direction: 'in' as const,
      };
      manager.defineSymbol(portSymbol);

      manager.createScope(ScopeKind.Function, 'myFunc');

      // Should find clk from parent scope
      const found = manager.lookup('clk');
      expect(found).toBeDefined();
      expect(found!.name).toBe('clk');
    });

    it('should shadow parent scope symbols', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const portSymbol = {
        id: manager.newSymbolId(),
        name: 'x',
        kind: SymbolKind.Port as const,
        span: mockSpan(1),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        direction: 'in' as const,
      };
      manager.defineSymbol(portSymbol);

      manager.createScope(ScopeKind.Function, 'myFunc');

      const varSymbol = {
        id: manager.newSymbolId(),
        name: 'x',
        kind: SymbolKind.Variable as const,
        span: mockSpan(10),
        flags: DEFAULT_FLAGS,
        type: mockType('int'),
        parentId: manager.currentScopeId(),
      };
      manager.defineSymbol(varSymbol);

      // Should find local variable, not port
      const found = manager.lookup('x');
      expect(found).toBeDefined();
      expect(found!.kind).toBe(SymbolKind.Variable);
    });

    it('should return undefined for undefined symbol', () => {
      const found = manager.lookup('nonexistent');
      expect(found).toBeUndefined();
    });

    it('should lookup by kind', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const signal = {
        id: manager.newSymbolId(),
        name: 'data',
        kind: SymbolKind.Signal as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        isReg: false,
        hasInit: false,
      };
      manager.defineSymbol(signal);

      const foundSignal = manager.lookupByKind('data', SymbolKind.Signal);
      expect(foundSignal).toBeDefined();

      const foundPort = manager.lookupByKind('data', SymbolKind.Port);
      expect(foundPort).toBeUndefined();
    });

    it('should check if defined in current scope', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const signal = {
        id: manager.newSymbolId(),
        name: 'data',
        kind: SymbolKind.Signal as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        isReg: false,
        hasInit: false,
      };
      manager.defineSymbol(signal);

      manager.createScope(ScopeKind.Function, 'myFunc');

      // Not defined in current (function) scope
      expect(manager.isDefinedInCurrentScope('data')).toBe(false);

      manager.exitScope();

      // Defined in current (module) scope
      expect(manager.isDefinedInCurrentScope('data')).toBe(true);
    });
  });

  describe('scope utilities', () => {
    it('should get scope depth', () => {
      const globalId = 0;
      expect(manager.getScopeDepth(globalId)).toBe(0);

      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');
      expect(manager.getScopeDepth(moduleId)).toBe(1);

      const funcId = manager.createScope(ScopeKind.Function, 'myFunc');
      expect(manager.getScopeDepth(funcId)).toBe(2);
    });

    it('should get scope path', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');
      manager.createScope(ScopeKind.Function, 'myFunc');
      const blockId = manager.createScope(ScopeKind.Block, 'block');

      const path = manager.getScopePath(blockId);
      expect(path).toEqual(['global', 'MyModule', 'myFunc', 'block']);
    });

    it('should get all scopes', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');
      manager.createScope(ScopeKind.Function, 'myFunc');

      const allScopes = manager.getAllScopes();
      expect(allScopes.length).toBe(3); // global + module + function
    });

    it('should get all symbols', () => {
      manager.createScope(ScopeKind.Module, 'MyModule');

      const signal1 = {
        id: manager.newSymbolId(),
        name: 'a',
        kind: SymbolKind.Signal as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        isReg: false,
        hasInit: false,
      };
      manager.defineSymbol(signal1);

      const signal2 = {
        id: manager.newSymbolId(),
        name: 'b',
        kind: SymbolKind.Signal as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        isReg: false,
        hasInit: false,
      };
      manager.defineSymbol(signal2);

      const allSymbols = manager.getAllSymbols();
      expect(allSymbols.length).toBe(2);
    });

    it('should get symbols of specific kind in scope', () => {
      const moduleId = manager.createScope(ScopeKind.Module, 'MyModule');

      const port = {
        id: manager.newSymbolId(),
        name: 'clk',
        kind: SymbolKind.Port as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('clock'),
        parentId: manager.currentScopeId(),
        direction: 'in' as const,
      };
      manager.defineSymbol(port);

      const signal = {
        id: manager.newSymbolId(),
        name: 'data',
        kind: SymbolKind.Signal as const,
        span: mockSpan(),
        flags: DEFAULT_FLAGS,
        type: mockType('bit'),
        parentId: manager.currentScopeId(),
        isReg: false,
        hasInit: false,
      };
      manager.defineSymbol(signal);

      const ports = manager.getSymbolsOfKind(moduleId, SymbolKind.Port);
      expect(ports.length).toBe(1);
      expect(ports[0]!.name).toBe('clk');

      const signals = manager.getSymbolsOfKind(moduleId, SymbolKind.Signal);
      expect(signals.length).toBe(1);
      expect(signals[0]!.name).toBe('data');
    });
  });
});

describe('SymbolTable', () => {
  let table: SymbolTable;

  beforeEach(() => {
    table = new SymbolTable();
  });

  describe('scope management', () => {
    it('should enter and exit module scope', () => {
      const scopeId = table.enterModule('MyModule');
      expect(scopeId).toBeGreaterThan(0);

      const scope = table.currentScope();
      expect(scope).toBeDefined();
      expect(scope!.kind).toBe(ScopeKind.Module);

      table.exitScope();
      const afterExit = table.currentScope();
      expect(afterExit!.kind).toBe(ScopeKind.Global);
    });

    it('should enter and exit function scope', () => {
      table.enterModule('MyModule');
      table.enterFunction('myFunc');

      const scope = table.currentScope();
      expect(scope!.kind).toBe(ScopeKind.Function);

      table.exitScope();
      expect(table.currentScope()!.kind).toBe(ScopeKind.Module);
    });

    it('should enter and exit block scope', () => {
      table.enterModule('MyModule');
      table.enterFunction('myFunc');
      table.enterBlock('if_block');

      expect(table.currentScope()!.kind).toBe(ScopeKind.Block);
    });

    it('should enter and exit FSM scope', () => {
      table.enterModule('MyModule');
      table.enterFsm('stateMachine');

      expect(table.currentScope()!.kind).toBe(ScopeKind.Fsm);
    });

    it('should enter and exit package scope', () => {
      table.enterPackage('myPackage');

      expect(table.currentScope()!.kind).toBe(ScopeKind.Package);
    });
  });

  describe('symbol definition', () => {
    it('should define module symbol', () => {
      table.enterModule('MyModule');
      const mod = table.defineModule('Counter', mockSpan());

      expect(mod.name).toBe('Counter');
      expect(mod.kind).toBe(SymbolKind.Module);
      expect(mod.ports).toEqual([]);
      expect(mod.signals).toEqual([]);
    });

    it('should define function symbol', () => {
      table.enterModule('MyModule');
      const func = table.defineFunction('add', mockSpan(), mockType('int'));

      expect(func.name).toBe('add');
      expect(func.kind).toBe(SymbolKind.Function);
      expect(func.params).toEqual([]);
      expect(func.returnType).toBeDefined();
    });

    it('should define port symbol', () => {
      table.enterModule('MyModule');
      const port = table.definePort('clk', mockSpan(), 'in', mockType('clock'));

      expect(port.name).toBe('clk');
      expect(port.kind).toBe(SymbolKind.Port);
      expect(port.direction).toBe('in');
    });

    it('should define signal symbol', () => {
      table.enterModule('MyModule');
      const signal = table.defineSignal('data', mockSpan(), mockType('bit[8]'), true, true);

      expect(signal.name).toBe('data');
      expect(signal.kind).toBe(SymbolKind.Signal);
      expect(signal.isReg).toBe(true);
      expect(signal.hasInit).toBe(true);
    });

    it('should define constant symbol', () => {
      table.enterModule('MyModule');
      const constant = table.defineConstant('WIDTH', mockSpan(), mockType('int'));

      expect(constant.name).toBe('WIDTH');
      expect(constant.kind).toBe(SymbolKind.Constant);
    });

    it('should define enum symbol', () => {
      table.enterModule('MyModule');
      const enumSym = table.defineEnum('State', mockSpan());

      expect(enumSym.name).toBe('State');
      expect(enumSym.kind).toBe(SymbolKind.Enum);
      expect(enumSym.variants).toEqual([]);
    });

    it('should define enum variant symbol', () => {
      table.enterModule('MyModule');
      const enumSym = table.defineEnum('State', mockSpan());
      const variant = table.defineEnumVariant('Idle', mockSpan(), enumSym.id, BigInt(0));

      expect(variant.name).toBe('Idle');
      expect(variant.kind).toBe(SymbolKind.EnumVariant);
      expect(variant.enumId).toBe(enumSym.id);
      expect(variant.value).toBe(BigInt(0));
    });

    it('should define struct symbol', () => {
      table.enterModule('MyModule');
      const struct = table.defineStruct('Packet', mockSpan());

      expect(struct.name).toBe('Packet');
      expect(struct.kind).toBe(SymbolKind.Struct);
      expect(struct.fields).toEqual([]);
    });

    it('should define type alias symbol', () => {
      table.enterModule('MyModule');
      const alias = table.defineTypeAlias('Word', mockSpan(), mockType('bit[32]'));

      expect(alias.name).toBe('Word');
      expect(alias.kind).toBe(SymbolKind.TypeAlias);
    });

    it('should define instance symbol', () => {
      table.enterModule('MyModule');
      const instance = table.defineInstance('counter0', mockSpan(), 'Counter');

      expect(instance.name).toBe('counter0');
      expect(instance.kind).toBe(SymbolKind.Instance);
      expect(instance.moduleName).toBe('Counter');
    });

    it('should define memory symbol', () => {
      table.enterModule('MyModule');
      const memory = table.defineMemory('ram', mockSpan(), mockType('bit[8]'), 1024);

      expect(memory.name).toBe('ram');
      expect(memory.kind).toBe(SymbolKind.Memory);
      expect(memory.depth).toBe(1024);
    });

    it('should define FSM symbol', () => {
      table.enterModule('MyModule');
      const fsm = table.defineFsm('controller', mockSpan(), 'Idle');

      expect(fsm.name).toBe('controller');
      expect(fsm.kind).toBe(SymbolKind.Fsm);
      expect(fsm.initialState).toBe('Idle');
      expect(fsm.states).toEqual([]);
    });

    it('should define FSM state symbol', () => {
      table.enterModule('MyModule');
      const fsm = table.defineFsm('controller', mockSpan(), 'Idle');
      table.enterFsm('controller');
      const state = table.defineFsmState('Running', mockSpan(), fsm.id);

      expect(state.name).toBe('Running');
      expect(state.kind).toBe(SymbolKind.FsmState);
      expect(state.fsmId).toBe(fsm.id);
    });

    it('should define parameter symbol', () => {
      table.enterModule('MyModule');
      table.enterFunction('add');
      const param = table.defineParameter('a', mockSpan(), mockType('int'), 0);

      expect(param.name).toBe('a');
      expect(param.kind).toBe(SymbolKind.Parameter);
      expect(param.index).toBe(0);
    });

    it('should define variable symbol', () => {
      table.enterModule('MyModule');
      table.enterFunction('process');
      const variable = table.defineVariable('temp', mockSpan(), mockType('int'));

      expect(variable.name).toBe('temp');
      expect(variable.kind).toBe(SymbolKind.Variable);
    });

    it('should define generic parameter symbol', () => {
      table.enterModule('MyModule');
      const generic = table.defineGenericParam('T', mockSpan(), true, false);

      expect(generic.name).toBe('T');
      expect(generic.kind).toBe(SymbolKind.GenericParam);
      expect(generic.isTypeParam).toBe(true);
      expect(generic.defaultValue).toBe(false);
    });

    it('should apply custom flags', () => {
      table.enterModule('MyModule');
      const mod = table.defineModule('Counter', mockSpan(), { isPublic: true });

      expect(mod.flags.isPublic).toBe(true);
    });
  });

  describe('duplicate detection', () => {
    it('should report error for duplicate definition', () => {
      table.enterModule('MyModule');
      table.defineSignal('data', mockSpan(1), mockType('bit'), false, false);
      table.defineSignal('data', mockSpan(5), mockType('bit[8]'), false, false);

      const diagnostics = table.getDiagnostics();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]!.severity).toBe('error');
      expect(diagnostics[0]!.message).toContain('Duplicate definition');
      expect(diagnostics[0]!.message).toContain('data');
    });
  });

  describe('symbol lookup', () => {
    it('should lookup symbol by name', () => {
      table.enterModule('MyModule');
      table.definePort('clk', mockSpan(), 'in', mockType('clock'));

      const found = table.lookup('clk');
      expect(found).toBeDefined();
      expect(found!.name).toBe('clk');
    });

    it('should lookup symbol by name and kind', () => {
      table.enterModule('MyModule');
      table.definePort('data', mockSpan(), 'in', mockType('bit'));

      const asPort = table.lookupByKind('data', SymbolKind.Port);
      expect(asPort).toBeDefined();

      const asSignal = table.lookupByKind('data', SymbolKind.Signal);
      expect(asSignal).toBeUndefined();
    });

    it('should get symbol by ID', () => {
      table.enterModule('MyModule');
      const port = table.definePort('clk', mockSpan(), 'in', mockType('clock'));

      const found = table.getSymbol(port.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('clk');
    });

    it('should get symbols in scope', () => {
      const moduleId = table.enterModule('MyModule');
      table.definePort('clk', mockSpan(), 'in', mockType('clock'));
      table.definePort('rst', mockSpan(), 'in', mockType('reset'));

      const symbols = table.getSymbolsInScope(moduleId);
      expect(symbols.length).toBe(2);
    });

    it('should get symbols of kind in scope', () => {
      const moduleId = table.enterModule('MyModule');
      table.definePort('clk', mockSpan(), 'in', mockType('clock'));
      table.defineSignal('data', mockSpan(), mockType('bit'), false, false);

      const ports = table.getSymbolsOfKind(moduleId, SymbolKind.Port);
      expect(ports.length).toBe(1);

      const signals = table.getSymbolsOfKind(moduleId, SymbolKind.Signal);
      expect(signals.length).toBe(1);
    });
  });

  describe('diagnostics', () => {
    it('should report error', () => {
      table.error('Test error', mockSpan());

      const diagnostics = table.getDiagnostics();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]!.severity).toBe('error');
      expect(diagnostics[0]!.message).toBe('Test error');
    });

    it('should report warning', () => {
      table.warning('Test warning', mockSpan());

      const diagnostics = table.getDiagnostics();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]!.severity).toBe('warning');
    });

    it('should report info', () => {
      table.info('Test info', mockSpan());

      const diagnostics = table.getDiagnostics();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]!.severity).toBe('info');
    });

    it('should report error with related span', () => {
      table.error('Duplicate', mockSpan(10), mockSpan(1));

      const diagnostics = table.getDiagnostics();
      expect(diagnostics[0]!.relatedSpan).toBeDefined();
      expect(diagnostics[0]!.relatedSpan!.startLine).toBe(1);
    });

    it('should check for errors', () => {
      expect(table.hasErrors()).toBe(false);

      table.error('Error', mockSpan());
      expect(table.hasErrors()).toBe(true);
    });

    it('should clear diagnostics', () => {
      table.error('Error', mockSpan());
      table.warning('Warning', mockSpan());

      table.clearDiagnostics();
      expect(table.getDiagnostics().length).toBe(0);
    });
  });

  describe('debug utilities', () => {
    it('should get all scopes', () => {
      table.enterModule('MyModule');
      table.enterFunction('myFunc');

      const scopes = table.getAllScopes();
      expect(scopes.length).toBe(3); // global + module + function
    });

    it('should get all symbols', () => {
      table.enterModule('MyModule');
      table.definePort('clk', mockSpan(), 'in', mockType('clock'));
      table.defineSignal('data', mockSpan(), mockType('bit'), false, false);

      const symbols = table.getAllSymbols();
      expect(symbols.length).toBe(2);
    });
  });
});
