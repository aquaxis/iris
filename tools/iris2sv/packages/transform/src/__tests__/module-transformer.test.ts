/**
 * Module Transformer Tests
 *
 * Tests for HIR to SV AST transformation.
 */

import { describe, it, expect } from 'vitest';
import {
  createModule,
  createPort,
  createSignal,
  createLogicType,
  createCombBlock,
  createSeqBlock,
  createAssignStmt,
  createNonblockingAssignStmt,
  createIdentifierLValue,
  createHirIdentifier,
  createBinaryExpr,
  createIntegerLiteral,
  type HirModule,
  type HirPort,
  type HirSignal,
} from '@iris2sv/core';
import { createModuleTransformer, transformModule, createModuleTransformerContext } from '../module-transformer.js';

describe('ModuleTransformer', () => {
  describe('createModuleTransformer()', () => {
    it('should create transformer instance', () => {
      const transformer = createModuleTransformer();
      expect(transformer).toBeDefined();
    });

    it('should have typeMapper', () => {
      const transformer = createModuleTransformer();
      expect(transformer.typeMapper).toBeDefined();
    });

    it('should have stmtTransformer', () => {
      const transformer = createModuleTransformer();
      expect(transformer.stmtTransformer).toBeDefined();
    });
  });

  describe('transformModule()', () => {
    it('should transform empty module', () => {
      const context = createModuleTransformerContext();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'empty',
        isPublic: false,
        parameters: [],
        ports: [],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformModule(hirModule, context);

      expect(svModule.kind).toBe('SvModule');
      expect(svModule.name).toBe('empty');
      expect(svModule.ports).toHaveLength(0);
      expect(svModule.items).toHaveLength(0);
    });

    it('should transform module name', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        ...createModule('my_module'),
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.name).toBe('my_module');
    });

    it('should transform input port', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [createPort('data_in', 'input', createLogicType(8))],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.ports).toHaveLength(1);
      expect(svModule.ports[0].name).toBe('data_in');
      expect(svModule.ports[0].direction).toBe('input');
    });

    it('should transform output port', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [createPort('data_out', 'output', createLogicType(16))],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.ports).toHaveLength(1);
      expect(svModule.ports[0].name).toBe('data_out');
      expect(svModule.ports[0].direction).toBe('output');
    });

    it('should transform inout port', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [createPort('io', 'inout', createLogicType(4))],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.ports).toHaveLength(1);
      expect(svModule.ports[0].name).toBe('io');
      expect(svModule.ports[0].direction).toBe('inout');
    });

    it('should transform port data type width', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [createPort('wide', 'input', createLogicType(32))],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      const port = svModule.ports[0];
      expect(port.dataType.kind).toBe('SvLogicType');
      if (port.dataType.kind === 'SvLogicType') {
        expect(port.dataType.width.kind).toBe('SvConstWidth');
        if (port.dataType.width.kind === 'SvConstWidth') {
          expect(port.dataType.width.value).toBe(32);
        }
      }
    });

    it('should transform signals', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [],
        typeDefs: [],
        signals: [createSignal('counter', createLogicType(8), true)],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.items).toHaveLength(1);
      expect(svModule.items[0].kind).toBe('SvSignal');
    });

    it('should transform comb block', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [
          createCombBlock([
            createAssignStmt(
              createIdentifierLValue('out'),
              createHirIdentifier('in')
            ),
          ]),
        ],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.items).toHaveLength(1);
      expect(svModule.items[0].kind).toBe('SvAlwaysBlock');
    });

    it('should transform seq block', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [
          createSeqBlock(
            { signal: 'clk', edge: 'posedge' },
            undefined,
            [
              createNonblockingAssignStmt(
                createIdentifierLValue('reg'),
                createBinaryExpr('add', createHirIdentifier('reg'), createIntegerLiteral(1n))
              ),
            ],
            []
          ),
        ],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.items).toHaveLength(1);
      expect(svModule.items[0].kind).toBe('SvAlwaysBlock');
    });
  });

  describe('Multiple ports', () => {
    it('should transform multiple ports in order', () => {
      const transformer = createModuleTransformer();
      const hirModule: HirModule = {
        kind: 'HirModule',
        name: 'test',
        isPublic: false,
        parameters: [],
        ports: [
          createPort('a', 'input', createLogicType(8)),
          createPort('b', 'input', createLogicType(8)),
          createPort('c', 'output', createLogicType(8)),
        ],
        typeDefs: [],
        signals: [],
        instances: [],
        combBlocks: [],
        seqBlocks: [],
        fsms: [],
        functions: [],
      };

      const svModule = transformer.transform(hirModule);

      expect(svModule.ports).toHaveLength(3);
      expect(svModule.ports[0].name).toBe('a');
      expect(svModule.ports[1].name).toBe('b');
      expect(svModule.ports[2].name).toBe('c');
    });
  });
});
