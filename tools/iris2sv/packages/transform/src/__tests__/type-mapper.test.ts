/**
 * Type Mapper Tests
 *
 * Tests for HIR type to SV type mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  createLogicType,
  createBoolType,
  createArrayType,
  createTupleType,
  createEnumType,
  createStructType,
} from '@iris2sv/core';
import { createTypeMapper, mapDataType, mapWidth } from '../type-mapper.js';

describe('TypeMapper', () => {
  describe('mapWidth()', () => {
    it('should map constant width', () => {
      const hirWidth = { kind: 'ConstWidth' as const, value: 8 };
      const svWidth = mapWidth(hirWidth);

      expect(svWidth.kind).toBe('SvConstWidth');
      if (svWidth.kind === 'SvConstWidth') {
        expect(svWidth.value).toBe(8);
      }
    });

    it('should map parameter width', () => {
      const hirWidth = { kind: 'ParamWidth' as const, param: 'WIDTH' };
      const svWidth = mapWidth(hirWidth);

      expect(svWidth.kind).toBe('SvParamWidth');
      if (svWidth.kind === 'SvParamWidth') {
        expect(svWidth.param).toBe('WIDTH');
      }
    });
  });

  describe('mapDataType()', () => {
    it('should map logic type with width', () => {
      const hirType = createLogicType(16);
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvLogicType');
      if (svType.kind === 'SvLogicType') {
        expect(svType.width.kind).toBe('SvConstWidth');
        if (svType.width.kind === 'SvConstWidth') {
          expect(svType.width.value).toBe(16);
        }
      }
    });

    it('should map logic type with signed', () => {
      const hirType = createLogicType(32, true);
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvLogicType');
      if (svType.kind === 'SvLogicType') {
        expect(svType.signed).toBe(true);
      }
    });

    it('should map bool type', () => {
      const hirType = createBoolType();
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvLogicType');
      if (svType.kind === 'SvLogicType') {
        expect(svType.width.kind).toBe('SvConstWidth');
        if (svType.width.kind === 'SvConstWidth') {
          expect(svType.width.value).toBe(1);
        }
      }
    });

    it('should map array type', () => {
      const hirType = createArrayType(createLogicType(8), 16);
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvArrayType');
    });

    it('should map enum type', () => {
      const hirType = createEnumType('State', [
        { name: 'IDLE', value: undefined },
        { name: 'RUN', value: undefined },
      ], 2);
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvEnumType');
      if (svType.kind === 'SvEnumType') {
        expect(svType.name).toBe('State');
      }
    });

    it('should map struct type', () => {
      const hirType = createStructType('Packet', [
        { name: 'valid', type: createBoolType() },
        { name: 'data', type: createLogicType(8) },
      ]);
      const svType = mapDataType(hirType);

      expect(svType.kind).toBe('SvStructType');
      if (svType.kind === 'SvStructType') {
        expect(svType.name).toBe('Packet');
      }
    });
  });

  describe('TypeMapper class', () => {
    it('should create type mapper', () => {
      const mapper = createTypeMapper();
      expect(mapper).toBeDefined();
    });

    it('should map type using mapType()', () => {
      const mapper = createTypeMapper();
      const hirType = createLogicType(8);
      const svType = mapper.mapType(hirType);

      expect(svType.kind).toBe('SvLogicType');
    });

    it('should map width using mapWidth()', () => {
      const mapper = createTypeMapper();
      const hirWidth = { kind: 'ConstWidth' as const, value: 4 };
      const svWidth = mapper.mapWidth(hirWidth);

      expect(svWidth.kind).toBe('SvConstWidth');
    });

    it('should track tuple structs', () => {
      const mapper = createTypeMapper();
      const hirType = createTupleType([createLogicType(8), createLogicType(16)]);

      mapper.mapType(hirType);

      expect(mapper.getTupleStructs().size).toBeGreaterThan(0);
    });
  });
});
