/**
 * Statement Transformer Tests
 *
 * Tests for HIR statement to SV statement transformation.
 */

import { describe, it, expect } from 'vitest';
import {
  createAssignStmt,
  createNonblockingAssignStmt,
  createIfStmt,
  createForStmt,
  createBlockStmt,
  createVarDeclStmt,
  createIdentifierLValue,
  createIndexLValue,
  createFieldLValue,
  createConcatLValue,
  createHirIdentifier,
  createBinaryExpr,
  createIntegerLiteral,
  createBoolLiteral,
  createLogicType,
} from '@iris2sv/core';
import { createStmtTransformer, transformStmt, createStmtTransformerContext } from '../stmt-transformer.js';

describe('StmtTransformer', () => {
  describe('Assignment statements', () => {
    it('should transform blocking assignment', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createAssignStmt(
        createIdentifierLValue('x'),
        createIntegerLiteral(42n)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
    });

    it('should transform non-blocking assignment', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createNonblockingAssignStmt(
        createIdentifierLValue('reg'),
        createIntegerLiteral(1n)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvNonBlockingAssignStmt');
    });
  });

  describe('LValue transformation', () => {
    it('should transform identifier lvalue', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createAssignStmt(
        createIdentifierLValue('signal'),
        createIntegerLiteral(0n)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
      if (svStmt.kind === 'SvBlockingAssignStmt') {
        expect(svStmt.lhs.kind).toBe('SvIdentifierExpr');
      }
    });

    it('should transform index lvalue', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createAssignStmt(
        createIndexLValue(createIdentifierLValue('arr'), createIntegerLiteral(0n)),
        createIntegerLiteral(1n)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
      if (svStmt.kind === 'SvBlockingAssignStmt') {
        expect(svStmt.lhs.kind).toBe('SvIndexExpr');
      }
    });

    it('should transform field lvalue', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createAssignStmt(
        createFieldLValue(createIdentifierLValue('pkt'), 'valid'),
        createBoolLiteral(true)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
      if (svStmt.kind === 'SvBlockingAssignStmt') {
        expect(svStmt.lhs.kind).toBe('SvMemberExpr');
      }
    });

    it('should transform concat lvalue', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createAssignStmt(
        createConcatLValue([
          createIdentifierLValue('a'),
          createIdentifierLValue('b'),
        ]),
        createIntegerLiteral(0xABn, 8)
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
      if (svStmt.kind === 'SvBlockingAssignStmt') {
        expect(svStmt.lhs.kind).toBe('SvConcatExpr');
      }
    });
  });

  describe('If statements', () => {
    it('should transform if without else', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createIfStmt(
        createBoolLiteral(true),
        [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(1n))]
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvIfStmt');
    });

    it('should transform if with else', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createIfStmt(
        createBoolLiteral(true),
        [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(1n))],
        [createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(0n))]
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvIfStmt');
      if (svStmt.kind === 'SvIfStmt') {
        expect(svStmt.elseBranch).toBeDefined();
      }
    });

    it('should transform else if chain', () => {
      const context = createStmtTransformerContext();
      const elseIf = createIfStmt(
        createBinaryExpr('eq', createHirIdentifier('x'), createIntegerLiteral(2n)),
        [createAssignStmt(createIdentifierLValue('y'), createIntegerLiteral(2n))]
      );
      const hirStmt = createIfStmt(
        createBinaryExpr('eq', createHirIdentifier('x'), createIntegerLiteral(1n)),
        [createAssignStmt(createIdentifierLValue('y'), createIntegerLiteral(1n))],
        elseIf
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvIfStmt');
    });
  });

  describe('For statements', () => {
    it('should transform for loop', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createForStmt(
        'i',
        createIntegerLiteral(0n),
        createIntegerLiteral(10n),
        false,
        [createAssignStmt(createIdentifierLValue('sum'), createBinaryExpr('add', createHirIdentifier('sum'), createHirIdentifier('i')))]
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvForStmt');
    });

    it('should transform inclusive for loop', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createForStmt(
        'i',
        createIntegerLiteral(0n),
        createIntegerLiteral(7n),
        true,  // inclusive
        []
      );
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvForStmt');
    });
  });

  describe('Block statements', () => {
    it('should transform empty block', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createBlockStmt([]);
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockStmt');
    });

    it('should transform block with statements', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createBlockStmt([
        createAssignStmt(createIdentifierLValue('a'), createIntegerLiteral(1n)),
        createAssignStmt(createIdentifierLValue('b'), createIntegerLiteral(2n)),
      ]);
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvBlockStmt');
      if (svStmt.kind === 'SvBlockStmt') {
        expect(svStmt.statements).toHaveLength(2);
      }
    });
  });

  describe('Variable declarations', () => {
    it('should transform var decl without init', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createVarDeclStmt('temp', createLogicType(8));
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvVarDeclStmt');
    });

    it('should transform var decl with init', () => {
      const context = createStmtTransformerContext();
      const hirStmt = createVarDeclStmt('temp', createLogicType(8), createIntegerLiteral(0n));
      const svStmt = transformStmt(hirStmt, context);

      expect(svStmt.kind).toBe('SvVarDeclStmt');
      if (svStmt.kind === 'SvVarDeclStmt') {
        expect(svStmt.initialValue).toBeDefined();
      }
    });
  });

  describe('StmtTransformer class', () => {
    it('should create transformer', () => {
      const transformer = createStmtTransformer();
      expect(transformer).toBeDefined();
    });

    it('should get type mapper', () => {
      const transformer = createStmtTransformer();
      expect(transformer.typeMapper).toBeDefined();
    });

    it('should get expr transformer', () => {
      const transformer = createStmtTransformer();
      expect(transformer.exprTransformer).toBeDefined();
    });

    it('should transform statement', () => {
      const transformer = createStmtTransformer();
      const hirStmt = createAssignStmt(createIdentifierLValue('x'), createIntegerLiteral(0n));
      const svStmt = transformer.transform(hirStmt);

      expect(svStmt.kind).toBe('SvBlockingAssignStmt');
    });

    it('should transform block', () => {
      const transformer = createStmtTransformer();
      const stmts = [
        createAssignStmt(createIdentifierLValue('a'), createIntegerLiteral(1n)),
        createAssignStmt(createIdentifierLValue('b'), createIntegerLiteral(2n)),
      ];
      const svStmt = transformer.transformBlock(stmts);

      expect(svStmt.kind).toBe('SvBlockStmt');
    });

    it('should set sequential mode', () => {
      const transformer = createStmtTransformer();
      transformer.setSequential(true);
      // No error means success
      expect(true).toBe(true);
    });
  });
});
