/**
 * Lowering Tests
 *
 * Tests for AST to HIR transformation.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@iris2sv/core';
import { createLowering, lowerSourceFile } from '../lowering.js';

describe('Lowering', () => {
  describe('lowerSourceFile()', () => {
    it('should lower empty source file', () => {
      const ast = parse('').ast;
      const result = lowerSourceFile(ast);

      expect(result.errors).toHaveLength(0);
      expect(result.hir.modules).toHaveLength(0);
    });

    it('should lower single empty module', () => {
      const ast = parse('mod test() {}').ast;
      const result = lowerSourceFile(ast);

      expect(result.errors).toHaveLength(0);
      expect(result.hir.modules).toHaveLength(1);
      expect(result.hir.modules[0].name).toBe('test');
    });

    it('should lower multiple modules', () => {
      const ast = parse('mod a() {} mod b() {}').ast;
      const result = lowerSourceFile(ast);

      expect(result.errors).toHaveLength(0);
      expect(result.hir.modules).toHaveLength(2);
      expect(result.hir.modules[0].name).toBe('a');
      expect(result.hir.modules[1].name).toBe('b');
    });
  });

  describe('Module lowering', () => {
    it('should preserve module name', () => {
      const ast = parse('mod my_module() {}').ast;
      const result = lowerSourceFile(ast);

      expect(result.hir.modules[0].name).toBe('my_module');
    });

    it('should set isPublic for public modules', () => {
      const ast = parse('pub mod public_mod() {}').ast;
      const result = lowerSourceFile(ast);

      expect(result.hir.modules[0].isPublic).toBe(true);
    });

    it('should set isPublic false for private modules', () => {
      const ast = parse('mod private_mod() {}').ast;
      const result = lowerSourceFile(ast);

      expect(result.hir.modules[0].isPublic).toBe(false);
    });
  });

  describe('Port lowering', () => {
    it('should lower input port', () => {
      const ast = parse('mod test(in a: bit[8]) {}').ast;
      const result = lowerSourceFile(ast);

      const ports = result.hir.modules[0].ports;
      expect(ports).toHaveLength(1);
      expect(ports[0].name).toBe('a');
      expect(ports[0].direction).toBe('input');
    });

    it('should lower output port', () => {
      const ast = parse('mod test(out b: bit[16]) {}').ast;
      const result = lowerSourceFile(ast);

      const ports = result.hir.modules[0].ports;
      expect(ports).toHaveLength(1);
      expect(ports[0].name).toBe('b');
      expect(ports[0].direction).toBe('output');
    });

    it('should lower inout port', () => {
      const ast = parse('mod test(inout io: bit[4]) {}').ast;
      const result = lowerSourceFile(ast);

      const ports = result.hir.modules[0].ports;
      expect(ports).toHaveLength(1);
      expect(ports[0].name).toBe('io');
      expect(ports[0].direction).toBe('inout');
    });

    it('should lower multiple ports', () => {
      const ast = parse('mod test(in a: bit, out b: bit, inout c: bit) {}').ast;
      const result = lowerSourceFile(ast);

      const ports = result.hir.modules[0].ports;
      expect(ports).toHaveLength(3);
      expect(ports[0].direction).toBe('input');
      expect(ports[1].direction).toBe('output');
      expect(ports[2].direction).toBe('inout');
    });

    it('should lower port with bit width', () => {
      const ast = parse('mod test(in data: bit[32]) {}').ast;
      const result = lowerSourceFile(ast);

      const port = result.hir.modules[0].ports[0];
      expect(port.dataType.kind).toBe('LogicType');
      if (port.dataType.kind === 'LogicType') {
        expect(port.dataType.width.kind).toBe('ConstWidth');
        if (port.dataType.width.kind === 'ConstWidth') {
          expect(port.dataType.width.value).toBe(32);
        }
      }
    });

    it('should lower bool port', () => {
      const ast = parse('mod test(in flag: bool) {}').ast;
      const result = lowerSourceFile(ast);

      const port = result.hir.modules[0].ports[0];
      expect(port.dataType.kind).toBe('LogicType');
      if (port.dataType.kind === 'LogicType') {
        expect(port.dataType.width.kind).toBe('ConstWidth');
        if (port.dataType.width.kind === 'ConstWidth') {
          expect(port.dataType.width.value).toBe(1);
        }
      }
    });
  });

  describe('Type lowering', () => {
    it('should lower bit type with default width', () => {
      const ast = parse('mod test(in a: bit) {}').ast;
      const result = lowerSourceFile(ast);

      const port = result.hir.modules[0].ports[0];
      expect(port.dataType.kind).toBe('LogicType');
      if (port.dataType.kind === 'LogicType') {
        expect(port.dataType.signed).toBe(false);
        if (port.dataType.width.kind === 'ConstWidth') {
          expect(port.dataType.width.value).toBe(1);
        }
      }
    });

    it('should lower int type as signed', () => {
      const ast = parse('mod test(in a: int[16]) {}').ast;
      const result = lowerSourceFile(ast);

      const port = result.hir.modules[0].ports[0];
      expect(port.dataType.kind).toBe('LogicType');
      if (port.dataType.kind === 'LogicType') {
        expect(port.dataType.signed).toBe(true);
        if (port.dataType.width.kind === 'ConstWidth') {
          expect(port.dataType.width.value).toBe(16);
        }
      }
    });

    it('should lower uint type as unsigned', () => {
      const ast = parse('mod test(in a: uint[8]) {}').ast;
      const result = lowerSourceFile(ast);

      const port = result.hir.modules[0].ports[0];
      expect(port.dataType.kind).toBe('LogicType');
      if (port.dataType.kind === 'LogicType') {
        expect(port.dataType.signed).toBe(false);
        if (port.dataType.width.kind === 'ConstWidth') {
          expect(port.dataType.width.value).toBe(8);
        }
      }
    });
  });

  describe('Lowering class', () => {
    it('should create lowering instance', () => {
      const lowering = createLowering();
      expect(lowering).toBeDefined();
    });

    it('should lower source file with class', () => {
      const lowering = createLowering();
      const ast = parse('mod test() {}').ast;
      const result = lowering.lower(ast);

      expect(result.hir.modules).toHaveLength(1);
    });

    it('should track errors', () => {
      const lowering = createLowering();
      const ast = parse('mod test() {}').ast;
      lowering.lower(ast);

      expect(lowering.errors).toBeDefined();
    });

    it('should track warnings', () => {
      const lowering = createLowering();
      const ast = parse('mod test() {}').ast;
      lowering.lower(ast);

      expect(lowering.warnings).toBeDefined();
    });
  });
});
