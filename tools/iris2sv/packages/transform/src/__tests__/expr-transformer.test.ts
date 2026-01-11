/**
 * Expression Transformer Tests
 *
 * Tests for HIR expression to SV expression transformation.
 */

import { describe, it, expect } from 'vitest';
import {
  createIntegerLiteral,
  createBoolLiteral,
  createHirIdentifier,
  createUnaryExpr,
  createBinaryExpr,
  createConditionalExpr,
  createConcatExpr,
  createIndexExpr,
  createSliceExpr,
  createFieldExpr,
  createCallExpr,
} from '@iris2sv/core';
import { createExprTransformer, transformExpr, createExprTransformerContext } from '../expr-transformer.js';

describe('ExprTransformer', () => {
  describe('Integer literals', () => {
    it('should transform integer literal', () => {
      const context = createExprTransformerContext();
      const hirExpr = createIntegerLiteral(42n);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });

    it('should transform integer with width', () => {
      const context = createExprTransformerContext();
      const hirExpr = createIntegerLiteral(255n, 8);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });

    it('should transform signed integer', () => {
      const context = createExprTransformerContext();
      const hirExpr = createIntegerLiteral(-10n, 8, true);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });
  });

  describe('Boolean literals', () => {
    it('should transform true literal', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBoolLiteral(true);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });

    it('should transform false literal', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBoolLiteral(false);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });
  });

  describe('Identifiers', () => {
    it('should transform identifier', () => {
      const context = createExprTransformerContext();
      const hirExpr = createHirIdentifier('counter');
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvIdentifierExpr');
      if (svExpr.kind === 'SvIdentifierExpr') {
        expect(svExpr.name).toBe('counter');
      }
    });
  });

  describe('Unary expressions', () => {
    it('should transform logical not', () => {
      const context = createExprTransformerContext();
      const hirExpr = createUnaryExpr('not', createBoolLiteral(true));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvUnaryExpr');
      if (svExpr.kind === 'SvUnaryExpr') {
        expect(svExpr.op).toBe('!');
      }
    });

    it('should transform bitwise not', () => {
      const context = createExprTransformerContext();
      const hirExpr = createUnaryExpr('bitnot', createIntegerLiteral(0xFFn));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvUnaryExpr');
      if (svExpr.kind === 'SvUnaryExpr') {
        expect(svExpr.op).toBe('~');
      }
    });

    it('should transform negation', () => {
      const context = createExprTransformerContext();
      const hirExpr = createUnaryExpr('neg', createIntegerLiteral(5n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvUnaryExpr');
      if (svExpr.kind === 'SvUnaryExpr') {
        expect(svExpr.op).toBe('-');
      }
    });

    it('should transform reduction and', () => {
      const context = createExprTransformerContext();
      const hirExpr = createUnaryExpr('and_reduce', createIntegerLiteral(0xFFn));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvUnaryExpr');
      if (svExpr.kind === 'SvUnaryExpr') {
        expect(svExpr.op).toBe('&');
      }
    });
  });

  describe('Binary expressions', () => {
    it('should transform addition', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('add', createIntegerLiteral(1n), createIntegerLiteral(2n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('+');
      }
    });

    it('should transform subtraction', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('sub', createIntegerLiteral(5n), createIntegerLiteral(3n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('-');
      }
    });

    it('should transform multiplication', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('mul', createIntegerLiteral(2n), createIntegerLiteral(3n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('*');
      }
    });

    it('should transform equality', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('eq', createIntegerLiteral(1n), createIntegerLiteral(1n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('==');
      }
    });

    it('should transform bitwise and', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('and', createIntegerLiteral(0xFFn), createIntegerLiteral(0x0Fn));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('&');
      }
    });

    it('should transform left shift', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('shl', createIntegerLiteral(1n), createIntegerLiteral(4n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('<<');
      }
    });

    it('should transform logical and', () => {
      const context = createExprTransformerContext();
      const hirExpr = createBinaryExpr('land', createBoolLiteral(true), createBoolLiteral(false));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvBinaryExpr');
      if (svExpr.kind === 'SvBinaryExpr') {
        expect(svExpr.op).toBe('&&');
      }
    });
  });

  describe('Conditional expressions', () => {
    it('should transform ternary', () => {
      const context = createExprTransformerContext();
      const hirExpr = createConditionalExpr(
        createBoolLiteral(true),
        createIntegerLiteral(1n),
        createIntegerLiteral(0n)
      );
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvTernaryExpr');
    });
  });

  describe('Concatenation', () => {
    it('should transform concat', () => {
      const context = createExprTransformerContext();
      const hirExpr = createConcatExpr([
        createIntegerLiteral(0xAn, 4),
        createIntegerLiteral(0xBn, 4),
      ]);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvConcatExpr');
    });
  });

  describe('Indexing and slicing', () => {
    it('should transform index', () => {
      const context = createExprTransformerContext();
      const hirExpr = createIndexExpr(createHirIdentifier('arr'), createIntegerLiteral(0n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvIndexExpr');
    });

    it('should transform slice', () => {
      const context = createExprTransformerContext();
      const hirExpr = createSliceExpr(createHirIdentifier('data'), createIntegerLiteral(7n), createIntegerLiteral(0n));
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvSliceExpr');
    });
  });

  describe('Field access', () => {
    it('should transform field', () => {
      const context = createExprTransformerContext();
      const hirExpr = createFieldExpr(createHirIdentifier('pkt'), 'valid');
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvMemberExpr');
    });
  });

  describe('Function calls', () => {
    it('should transform call', () => {
      const context = createExprTransformerContext();
      const hirExpr = createCallExpr('func', [createIntegerLiteral(1n)]);
      const svExpr = transformExpr(hirExpr, context);

      expect(svExpr.kind).toBe('SvCallExpr');
    });
  });

  describe('ExprTransformer class', () => {
    it('should create transformer', () => {
      const transformer = createExprTransformer();
      expect(transformer).toBeDefined();
    });

    it('should transform expression', () => {
      const transformer = createExprTransformer();
      const hirExpr = createIntegerLiteral(42n);
      const svExpr = transformer.transform(hirExpr);

      expect(svExpr.kind).toBe('SvLiteralExpr');
    });
  });
});
