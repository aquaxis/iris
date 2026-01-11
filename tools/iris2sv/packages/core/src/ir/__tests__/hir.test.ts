/**
 * HIR Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  // Types
  createLogicType,
  createParamLogicType,
  createBoolType,
  createEnumType,
  createStructType,
  createArrayType,
  createTupleType,
  getTypeWidth,
  typesEqual,
  typeToString,
  HirDataType,

  // Expressions
  createIntegerLiteral,
  createBoolLiteral,
  createHirIdentifier as createIdentifier,
  createUnaryExpr,
  createBinaryExpr,
  createConditionalExpr,
  createConcatExpr,
  createRepeatExpr,
  createIndexExpr,
  createSliceExpr,
  createFieldExpr,
  createCallExpr,
  createCastExpr,

  // Statements
  createIdentifierLValue,
  createIndexLValue,
  createFieldLValue,
  createAssignStmt,
  createNonblockingAssignStmt,
  createIfStmt,
  createCaseStmt,
  createForStmt,

  // Module structures
  createParameter,
  createPort,
  createSignal,
  createClockSpec,
  createResetSpec,
  createCombBlock,
  createSeqBlock,
  createFsm,
  createInstance,
  createFunction,
  createModule,
  createHirSourceFile as createSourceFile,
} from '../index.js';

describe('HIR Types', () => {
  describe('createLogicType', () => {
    it('should create unsigned logic type', () => {
      const type = createLogicType(8);
      expect(type.kind).toBe('LogicType');
      expect(type.width).toEqual({ kind: 'ConstWidth', value: 8 });
      expect(type.signed).toBe(false);
    });

    it('should create signed logic type', () => {
      const type = createLogicType(16, true);
      expect(type.signed).toBe(true);
    });
  });

  describe('createParamLogicType', () => {
    it('should create parameter-dependent width', () => {
      const type = createParamLogicType('WIDTH');
      expect(type.width).toEqual({ kind: 'ParamWidth', param: 'WIDTH' });
    });
  });

  describe('createBoolType', () => {
    it('should create single-bit unsigned type', () => {
      const type = createBoolType();
      expect(type.width).toEqual({ kind: 'ConstWidth', value: 1 });
      expect(type.signed).toBe(false);
    });
  });

  describe('createEnumType', () => {
    it('should create enum with variants', () => {
      const type = createEnumType('State', ['Idle', 'Running', 'Done']);
      expect(type.kind).toBe('EnumType');
      expect(type.name).toBe('State');
      expect(type.variants.length).toBe(3);
      expect(type.variants[0]?.name).toBe('Idle');
    });

    it('should calculate correct width', () => {
      const type = createEnumType('Small', ['A', 'B']);
      expect(type.width).toEqual({ kind: 'ConstWidth', value: 1 });

      const type3 = createEnumType('Three', ['A', 'B', 'C']);
      expect(type3.width).toEqual({ kind: 'ConstWidth', value: 2 });
    });

    it('should support explicit values', () => {
      const type = createEnumType('Flags', ['A', 'B', 'C'], [1, 2, 4]);
      expect(type.variants[0]?.value).toBe(1);
      expect(type.variants[2]?.value).toBe(4);
    });
  });

  describe('createStructType', () => {
    it('should create struct with fields', () => {
      const type = createStructType('Point', [
        { name: 'x', type: createLogicType(16) },
        { name: 'y', type: createLogicType(16) },
      ]);
      expect(type.kind).toBe('StructType');
      expect(type.name).toBe('Point');
      expect(type.fields.length).toBe(2);
    });
  });

  describe('createArrayType', () => {
    it('should create array type', () => {
      const type = createArrayType(createLogicType(8), 16);
      expect(type.kind).toBe('ArrayType');
      expect(type.size).toEqual({ kind: 'ConstWidth', value: 16 });
    });
  });

  describe('createTupleType', () => {
    it('should create tuple type', () => {
      const type = createTupleType([
        createLogicType(8),
        createLogicType(16),
      ]);
      expect(type.kind).toBe('TupleType');
      expect(type.elements.length).toBe(2);
    });
  });

  describe('getTypeWidth', () => {
    it('should return width for logic type', () => {
      expect(getTypeWidth(createLogicType(8))).toBe(8);
    });

    it('should return undefined for param width', () => {
      expect(getTypeWidth(createParamLogicType('W'))).toBeUndefined();
    });

    it('should calculate struct width', () => {
      const struct = createStructType('Test', [
        { name: 'a', type: createLogicType(8) },
        { name: 'b', type: createLogicType(16) },
      ]);
      expect(getTypeWidth(struct)).toBe(24);
    });

    it('should calculate array width', () => {
      const arr = createArrayType(createLogicType(8), 4);
      expect(getTypeWidth(arr)).toBe(32);
    });

    it('should calculate tuple width', () => {
      const tuple = createTupleType([createLogicType(8), createLogicType(8)]);
      expect(getTypeWidth(tuple)).toBe(16);
    });
  });

  describe('typesEqual', () => {
    it('should compare logic types', () => {
      expect(typesEqual(createLogicType(8), createLogicType(8))).toBe(true);
      expect(typesEqual(createLogicType(8), createLogicType(16))).toBe(false);
      expect(typesEqual(createLogicType(8, true), createLogicType(8, false))).toBe(false);
    });

    it('should compare enum types by name', () => {
      const e1 = createEnumType('State', ['A']);
      const e2 = createEnumType('State', ['B']);
      const e3 = createEnumType('Other', ['A']);
      expect(typesEqual(e1, e2)).toBe(true); // Same name
      expect(typesEqual(e1, e3)).toBe(false); // Different name
    });
  });

  describe('typeToString', () => {
    it('should format logic types', () => {
      expect(typeToString(createLogicType(8))).toBe('uint[8]');
      expect(typeToString(createLogicType(32, true))).toBe('int[32]');
      expect(typeToString(createBoolType())).toBe('bool');
    });

    it('should format enum types', () => {
      expect(typeToString(createEnumType('State', ['A']))).toBe('State');
    });

    it('should format array types', () => {
      expect(typeToString(createArrayType(createLogicType(8), 16))).toBe('[uint[8]; 16]');
    });

    it('should format tuple types', () => {
      expect(typeToString(createTupleType([createLogicType(8), createBoolType()]))).toBe('(uint[8], bool)');
    });
  });
});

describe('HIR Expressions', () => {
  describe('createIntegerLiteral', () => {
    it('should create integer literal', () => {
      const lit = createIntegerLiteral(42n, 8);
      expect(lit.kind).toBe('IntegerLiteral');
      expect(lit.value).toBe(42n);
      expect(lit.width).toBe(8);
    });

    it('should set dataType for sized literals', () => {
      const lit = createIntegerLiteral(255n, 8);
      expect(lit.dataType?.kind).toBe('LogicType');
    });
  });

  describe('createBoolLiteral', () => {
    it('should create boolean literals', () => {
      const t = createBoolLiteral(true);
      const f = createBoolLiteral(false);
      expect(t.value).toBe(true);
      expect(f.value).toBe(false);
      expect(t.dataType?.kind).toBe('LogicType');
    });
  });

  describe('createIdentifier', () => {
    it('should create identifier', () => {
      const id = createIdentifier('counter', createLogicType(8));
      expect(id.name).toBe('counter');
      expect(id.dataType).toBeDefined();
    });
  });

  describe('createUnaryExpr', () => {
    it('should create unary expressions', () => {
      const operand = createIdentifier('a');
      const expr = createUnaryExpr('not', operand);
      expect(expr.kind).toBe('UnaryExpr');
      expect(expr.op).toBe('not');
    });
  });

  describe('createBinaryExpr', () => {
    it('should create binary expressions', () => {
      const left = createIdentifier('a');
      const right = createIntegerLiteral(1n, 8);
      const expr = createBinaryExpr('add', left, right);
      expect(expr.kind).toBe('BinaryExpr');
      expect(expr.op).toBe('add');
    });

    it('should set bool type for comparisons', () => {
      const left = createIdentifier('a');
      const right = createIdentifier('b');
      const expr = createBinaryExpr('eq', left, right);
      expect(expr.dataType?.kind).toBe('LogicType');
      if (expr.dataType?.kind === 'LogicType') {
        expect(expr.dataType.width).toEqual({ kind: 'ConstWidth', value: 1 });
      }
    });
  });

  describe('createConditionalExpr', () => {
    it('should create conditional expression', () => {
      const cond = createBoolLiteral(true);
      const then_ = createIntegerLiteral(1n);
      const else_ = createIntegerLiteral(0n);
      const expr = createConditionalExpr(cond, then_, else_);
      expect(expr.kind).toBe('ConditionalExpr');
    });
  });

  describe('createConcatExpr', () => {
    it('should create concatenation', () => {
      const a = createIdentifier('a', createLogicType(4));
      const b = createIdentifier('b', createLogicType(4));
      const expr = createConcatExpr([a, b]);
      expect(expr.kind).toBe('ConcatExpr');
      if (expr.dataType?.kind === 'LogicType' && expr.dataType.width.kind === 'ConstWidth') {
        expect(expr.dataType.width.value).toBe(8);
      }
    });
  });

  describe('createRepeatExpr', () => {
    it('should create repeat expression', () => {
      const a = createIdentifier('a', createLogicType(4));
      const expr = createRepeatExpr(a, 4);
      expect(expr.count).toBe(4);
      if (expr.dataType?.kind === 'LogicType' && expr.dataType.width.kind === 'ConstWidth') {
        expect(expr.dataType.width.value).toBe(16);
      }
    });
  });

  describe('createSliceExpr', () => {
    it('should create slice expression', () => {
      const base = createIdentifier('data', createLogicType(16));
      const expr = createSliceExpr(base, createIntegerLiteral(7n), createIntegerLiteral(0n));
      expect(expr.kind).toBe('SliceExpr');
      if (expr.dataType?.kind === 'LogicType' && expr.dataType.width.kind === 'ConstWidth') {
        expect(expr.dataType.width.value).toBe(8);
      }
    });
  });
});

describe('HIR Statements', () => {
  describe('createAssignStmt', () => {
    it('should create blocking assignment', () => {
      const lv = createIdentifierLValue('a');
      const val = createIntegerLiteral(1n);
      const stmt = createAssignStmt(lv, val);
      expect(stmt.kind).toBe('AssignStmt');
    });
  });

  describe('createNonblockingAssignStmt', () => {
    it('should create non-blocking assignment', () => {
      const lv = createIdentifierLValue('reg');
      const val = createIdentifier('data');
      const stmt = createNonblockingAssignStmt(lv, val);
      expect(stmt.kind).toBe('NonblockingAssignStmt');
    });
  });

  describe('createIfStmt', () => {
    it('should create if statement', () => {
      const cond = createBoolLiteral(true);
      const then_ = [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(1n))];
      const stmt = createIfStmt(cond, then_);
      expect(stmt.kind).toBe('IfStmt');
      expect(stmt.elseBranch).toBeUndefined();
    });

    it('should support else branch', () => {
      const cond = createBoolLiteral(true);
      const then_ = [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(1n))];
      const else_ = [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(0n))];
      const stmt = createIfStmt(cond, then_, else_);
      expect(stmt.elseBranch).toBeDefined();
    });
  });

  describe('createCaseStmt', () => {
    it('should create case statement', () => {
      const scrutinee = createIdentifier('sel');
      const items = [
        { patterns: [createIntegerLiteral(0n)], body: [] },
        { patterns: [createIntegerLiteral(1n)], body: [] },
      ];
      const stmt = createCaseStmt(scrutinee, items, { body: [] });
      expect(stmt.kind).toBe('CaseStmt');
      expect(stmt.items.length).toBe(2);
    });
  });

  describe('createForStmt', () => {
    it('should create for loop', () => {
      const stmt = createForStmt(
        'i',
        createIntegerLiteral(0n),
        createIntegerLiteral(8n),
        false,
        []
      );
      expect(stmt.kind).toBe('ForStmt');
      expect(stmt.variable).toBe('i');
      expect(stmt.inclusive).toBe(false);
    });
  });

  describe('LValue helpers', () => {
    it('should create indexed LValue', () => {
      const base = createIdentifierLValue('arr');
      const lv = createIndexLValue(base, createIntegerLiteral(0n));
      expect(lv.kind).toBe('IndexLValue');
    });

    it('should create field LValue', () => {
      const base = createIdentifierLValue('struct');
      const lv = createFieldLValue(base, 'field');
      expect(lv.kind).toBe('FieldLValue');
      expect(lv.field).toBe('field');
    });
  });
});

describe('HIR Module Structures', () => {
  describe('createParameter', () => {
    it('should create parameter', () => {
      const param = createParameter('WIDTH', createLogicType(32), createIntegerLiteral(8n));
      expect(param.kind).toBe('HirParameter');
      expect(param.name).toBe('WIDTH');
      expect(param.defaultValue).toBeDefined();
    });
  });

  describe('createPort', () => {
    it('should create input port', () => {
      const port = createPort('clk', 'input', createLogicType(1));
      expect(port.kind).toBe('HirPort');
      expect(port.direction).toBe('input');
      expect(port.isReg).toBe(false);
    });

    it('should create output reg port', () => {
      const port = createPort('data', 'output', createLogicType(8), true);
      expect(port.isReg).toBe(true);
    });
  });

  describe('createSignal', () => {
    it('should create wire signal', () => {
      const sig = createSignal('temp', createLogicType(8));
      expect(sig.kind).toBe('HirSignal');
      expect(sig.isReg).toBe(false);
    });

    it('should create reg signal with initial value', () => {
      const sig = createSignal('counter', createLogicType(8), true, createIntegerLiteral(0n));
      expect(sig.isReg).toBe(true);
      expect(sig.initialValue).toBeDefined();
    });
  });

  describe('createClockSpec', () => {
    it('should create clock spec with default posedge', () => {
      const spec = createClockSpec('clk');
      expect(spec.signal).toBe('clk');
      expect(spec.edge).toBe('posedge');
    });

    it('should create clock spec with negedge', () => {
      const spec = createClockSpec('clk', 'negedge');
      expect(spec.edge).toBe('negedge');
    });
  });

  describe('createResetSpec', () => {
    it('should create async active-high reset', () => {
      const spec = createResetSpec('rst');
      expect(spec.signal).toBe('rst');
      expect(spec.activeHigh).toBe(true);
      expect(spec.mode).toBe('async');
    });

    it('should create sync active-low reset', () => {
      const spec = createResetSpec('rst_n', false, 'sync');
      expect(spec.activeHigh).toBe(false);
      expect(spec.mode).toBe('sync');
    });
  });

  describe('createCombBlock', () => {
    it('should create combinational block', () => {
      const block = createCombBlock([
        createAssignStmt(createIdentifierLValue('out'), createIdentifier('in')),
      ]);
      expect(block.kind).toBe('HirCombBlock');
      expect(block.statements.length).toBe(1);
    });
  });

  describe('createSeqBlock', () => {
    it('should create sequential block', () => {
      const clock = createClockSpec('clk');
      const reset = createResetSpec('rst');
      const block = createSeqBlock(clock, reset, [], []);
      expect(block.kind).toBe('HirSeqBlock');
      expect(block.clock.signal).toBe('clk');
    });
  });

  describe('createFsm', () => {
    it('should create FSM', () => {
      const clock = createClockSpec('clk');
      const stateType = createEnumType('State', ['Idle', 'Running', 'Done']);
      const fsm = createFsm(
        'controller',
        clock,
        undefined,
        stateType,
        'Idle',
        [{ name: 'Idle', mooreOutputs: [] }],
        []
      );
      expect(fsm.kind).toBe('HirFsm');
      expect(fsm.name).toBe('controller');
      expect(fsm.initialState).toBe('Idle');
    });
  });

  describe('createInstance', () => {
    it('should create module instance', () => {
      const inst = createInstance('u_sub', 'SubModule', [
        { port: 'clk', expr: createIdentifier('clk') },
        { port: 'data', expr: createIdentifier('data') },
      ]);
      expect(inst.kind).toBe('HirInstance');
      expect(inst.name).toBe('u_sub');
      expect(inst.module).toBe('SubModule');
      expect(inst.connections.length).toBe(2);
    });
  });

  describe('createFunction', () => {
    it('should create function', () => {
      const fn = createFunction(
        'add',
        [
          { name: 'a', dataType: createLogicType(8) },
          { name: 'b', dataType: createLogicType(8) },
        ],
        createLogicType(8),
        []
      );
      expect(fn.kind).toBe('HirFunction');
      expect(fn.name).toBe('add');
      expect(fn.params.length).toBe(2);
    });
  });

  describe('createModule', () => {
    it('should create empty module', () => {
      const mod = createModule('Test');
      expect(mod.kind).toBe('HirModule');
      expect(mod.name).toBe('Test');
      expect(mod.isPublic).toBe(false);
      expect(mod.ports.length).toBe(0);
    });

    it('should create public module', () => {
      const mod = createModule('PublicMod', true);
      expect(mod.isPublic).toBe(true);
    });
  });

  describe('createSourceFile', () => {
    it('should create source file', () => {
      const mod = createModule('Test');
      const sf = createSourceFile([mod]);
      expect(sf.kind).toBe('HirSourceFile');
      expect(sf.modules.length).toBe(1);
    });
  });
});
