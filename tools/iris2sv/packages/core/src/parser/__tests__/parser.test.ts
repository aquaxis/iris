/**
 * IRIS Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { parse, ParseResult } from '../parser.js';
import type { SourceFile } from '../../ast/index.js';

// Helper function to parse and get the AST
function parseSource(source: string): SourceFile {
  const result = parse(source);
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map(e => e.message).join(', ')}`);
  }
  return result.ast;
}

// Helper to check parse result has errors
function expectParseError(source: string): ParseResult {
  const result = parse(source);
  expect(result.errors.length).toBeGreaterThan(0);
  return result;
}

describe('Parser', () => {
  describe('Empty Module', () => {
    it('parses empty module', () => {
      const ast = parseSource('mod empty() {}');
      expect(ast.items.length).toBe(1);
      const mod = ast.items[0];
      expect(mod.kind).toBe('ModDef');
      if (mod.kind === 'ModDef') {
        expect(mod.name.name).toBe('empty');
        expect(mod.ports.length).toBe(0);
        expect(mod.items.length).toBe(0);
      }
    });

    it('parses module with ports', () => {
      const ast = parseSource('mod adder(in a: bit[8], in b: bit[8], out sum: bit[8]) {}');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        expect(mod.ports.length).toBe(3);
        expect(mod.ports[0].direction).toBe('in');
        expect(mod.ports[0].name.name).toBe('a');
        expect(mod.ports[2].direction).toBe('out');
      }
    });

    it('parses public module', () => {
      const ast = parseSource('pub mod public_mod() {}');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        expect(mod.visibility).toBe('public');
      }
    });
  });

  describe('Type Expressions', () => {
    it('parses primitive types', () => {
      const ast = parseSource('mod test() { let a: bit[8]; }');
      expect(ast.items.length).toBe(1);
      const mod = ast.items[0];
      expect(mod.kind).toBe('ModDef');
      if (mod.kind === 'ModDef') {
        expect(mod.items.length).toBe(1);
        const decl = mod.items[0];
        expect(decl.kind).toBe('SignalDecl');
        if (decl.kind === 'SignalDecl') {
          expect(decl.type?.kind).toBe('PrimitiveType');
          if (decl.type?.kind === 'PrimitiveType') {
            expect(decl.type.type).toBe('bit');
          }
        }
      }
    });

    it('parses bool type', () => {
      const ast = parseSource('mod test() { let flag: bool; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.type?.kind === 'PrimitiveType') {
          expect(decl.type.type).toBe('bool');
        }
      }
    });

    it('parses clock type in port', () => {
      const ast = parseSource('mod test(in clk: clock) {}');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        expect(mod.ports.length).toBe(1);
        const port = mod.ports[0];
        if (port.type.kind === 'PrimitiveType') {
          expect(port.type.type).toBe('clock');
        }
      }
    });

    it('parses array types', () => {
      const ast = parseSource('mod test() { let arr: [bit[8]; 16]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.type?.kind === 'ArrayType') {
          expect(decl.type.elementType.kind).toBe('PrimitiveType');
        }
      }
    });

    it('parses tuple types', () => {
      const ast = parseSource('mod test() { let tup: (bit[8], bit[16]); }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.type?.kind === 'TupleType') {
          expect(decl.type.elements.length).toBe(2);
        }
      }
    });

    it('parses user-defined types', () => {
      const ast = parseSource('mod test() { let s: MyStruct; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.type?.kind === 'UserType') {
          expect(decl.type.path.segments[0].name).toBe('MyStruct');
        }
      }
    });
  });

  describe('Expressions', () => {
    it('parses integer literals', () => {
      const ast = parseSource('mod test() { let x: bit[8] = 42; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'IntegerLiteral') {
          expect(decl.init.value).toBe(42n);
        }
      }
    });

    it('parses sized integer literals', () => {
      const ast = parseSource("mod test() { let x: bit[8] = 8'd255; }");
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'IntegerLiteral') {
          expect(decl.init.width).toBe(8);
          expect(decl.init.base).toBe('d');
          expect(decl.init.value).toBe(255n);
        }
      }
    });

    it('parses hex literals', () => {
      const ast = parseSource("mod test() { let x: bit[8] = 8'hFF; }");
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'IntegerLiteral') {
          expect(decl.init.base).toBe('h');
          expect(decl.init.value).toBe(255n);
        }
      }
    });

    it('parses binary expressions with correct precedence', () => {
      const ast = parseSource('mod test() { let x: bit[8] = a + b * c; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'BinaryExpr') {
          // a + (b * c) - addition should be at the top
          expect(decl.init.op).toBe('+');
          expect(decl.init.right.kind).toBe('BinaryExpr');
          if (decl.init.right.kind === 'BinaryExpr') {
            expect(decl.init.right.op).toBe('*');
          }
        }
      }
    });

    it('parses unary expressions', () => {
      const ast = parseSource('mod test() { let x: bool = !flag; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'UnaryExpr') {
          expect(decl.init.op).toBe('!');
        }
      }
    });

    it('parses field access', () => {
      const ast = parseSource('mod test() { let x: bit[8] = foo.bar; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'FieldExpr') {
          expect(decl.init.field.name).toBe('bar');
        }
      }
    });

    it('parses index access', () => {
      const ast = parseSource('mod test() { let x: bit[8] = arr[0]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'IndexExpr') {
          expect(decl.init.endIndex).toBeUndefined();
        }
      }
    });

    it('parses slice access', () => {
      const ast = parseSource('mod test() { let x: bit[4] = arr[7:4]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'IndexExpr') {
          expect(decl.init.endIndex).toBeDefined();
        }
      }
    });

    it('parses function calls', () => {
      const ast = parseSource('mod test() { let x: bit[8] = foo(a, b); }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'CallExpr') {
          expect(decl.init.args.length).toBe(2);
        }
      }
    });

    it('parses concatenation expressions', () => {
      const ast = parseSource('mod test() { let x: bit[16] = {a, b}; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'ConcatExpr') {
          expect(decl.init.elements.length).toBe(2);
        }
      }
    });

    it('parses repeat expressions', () => {
      const ast = parseSource('mod test() { let x: bit[16] = {4{a}}; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'RepeatExpr') {
          expect(decl.init.count.kind).toBe('IntegerLiteral');
        }
      }
    });

    it('parses cast expressions', () => {
      const ast = parseSource('mod test() { let x: bit[16] = a as bit[16]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl' && decl.init?.kind === 'CastExpr') {
          expect(decl.init.targetType.kind).toBe('PrimitiveType');
        }
      }
    });
  });

  describe('Module Items', () => {
    it('parses let statements', () => {
      const ast = parseSource('mod test() { let x: bit[8]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        expect(mod.items.length).toBe(1);
        expect(mod.items[0].kind).toBe('SignalDecl');
      }
    });

    it('parses var statements', () => {
      const ast = parseSource('mod test() { var x: bit[8]; }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const decl = mod.items[0];
        if (decl.kind === 'SignalDecl') {
          expect(decl.declKind).toBe('var');
        }
      }
    });

    it('parses comb blocks', () => {
      const ast = parseSource('mod test() { comb { } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        expect(mod.items[0].kind).toBe('CombBlock');
      }
    });

    it('parses sync blocks', () => {
      const ast = parseSource('mod test(in clk: clock) { sync(clk.posedge) { } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const sync = mod.items[0];
        if (sync.kind === 'SyncBlock') {
          expect(sync.clock.edge).toBe('posedge');
        }
      }
    });

    it('parses sync blocks with reset', () => {
      const ast = parseSource('mod test(in clk: clock, in rst: reset) { sync(clk.posedge, rst.async) { } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const sync = mod.items[0];
        if (sync.kind === 'SyncBlock') {
          expect(sync.reset).toBeDefined();
          expect(sync.reset?.mode).toBe('async');
        }
      }
    });

    it('parses instance declaration with inst keyword', () => {
      const ast = parseSource('mod test() { inst sub: SubMod(.a(x), .b(y)); }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const inst = mod.items[0];
        if (inst.kind === 'InstDecl') {
          expect(inst.name.name).toBe('sub');
          expect(inst.connections.length).toBe(2);
        }
      }
    });
  });

  describe('Statements in Blocks', () => {
    it('parses if statements in comb', () => {
      const ast = parseSource('mod test() { comb { if cond { x = 1; } } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const comb = mod.items[0];
        if (comb.kind === 'CombBlock') {
          expect(comb.body[0].kind).toBe('IfStmt');
        }
      }
    });

    it('parses if-else statements', () => {
      const ast = parseSource('mod test() { comb { if cond { x = 1; } else { x = 0; } } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const comb = mod.items[0];
        if (comb.kind === 'CombBlock') {
          const ifStmt = comb.body[0];
          if (ifStmt.kind === 'IfStmt') {
            expect(ifStmt.elseBranch).toBeDefined();
          }
        }
      }
    });

    it('parses match statements', () => {
      const ast = parseSource('mod test() { comb { match x { 0 => y = 0, 1 => y = 1, _ => y = 2 } } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const comb = mod.items[0];
        if (comb.kind === 'CombBlock') {
          expect(comb.body[0].kind).toBe('MatchStmt');
        }
      }
    });

    it('parses for statements', () => {
      const ast = parseSource('mod test() { comb { for i in 0..8 { } } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const comb = mod.items[0];
        if (comb.kind === 'CombBlock') {
          const forStmt = comb.body[0];
          if (forStmt.kind === 'ForStmt') {
            expect(forStmt.variable.name).toBe('i');
            expect(forStmt.inclusive).toBe(false);
          }
        }
      }
    });

    it('parses inclusive range for statements', () => {
      const ast = parseSource('mod test() { comb { for i in 0..=7 { } } }');
      const mod = ast.items[0];
      if (mod.kind === 'ModDef') {
        const comb = mod.items[0];
        if (comb.kind === 'CombBlock') {
          const forStmt = comb.body[0];
          if (forStmt.kind === 'ForStmt') {
            expect(forStmt.inclusive).toBe(true);
          }
        }
      }
    });
  });

  describe('Type Definitions', () => {
    it('parses enum definition', () => {
      const ast = parseSource('enum Color { Red, Green, Blue }');
      expect(ast.items.length).toBe(1);
      const def = ast.items[0];
      if (def.kind === 'EnumDef') {
        expect(def.name.name).toBe('Color');
        expect(def.variants.length).toBe(3);
      }
    });

    it('parses enum with values', () => {
      const ast = parseSource('enum State { Idle = 0, Running = 1, Done = 2 }');
      const def = ast.items[0];
      if (def.kind === 'EnumDef') {
        expect(def.variants[0].value).toBeDefined();
      }
    });

    it('parses struct definition', () => {
      const ast = parseSource('struct Point { x: bit[16], y: bit[16] }');
      const def = ast.items[0];
      if (def.kind === 'StructDef') {
        expect(def.name.name).toBe('Point');
        expect(def.fields.length).toBe(2);
      }
    });

    it('parses type alias', () => {
      const ast = parseSource('type Word = bit[32];');
      const def = ast.items[0];
      if (def.kind === 'TypeAliasDef') {
        expect(def.name.name).toBe('Word');
      }
    });
  });

  describe('Function Definitions', () => {
    it('parses function definition', () => {
      const ast = parseSource('fn add(a: bit[8], b: bit[8]) -> bit[8] { return a + b; }');
      const fn = ast.items[0];
      if (fn.kind === 'FnDef') {
        expect(fn.name.name).toBe('add');
        expect(fn.params.length).toBe(2);
        expect(fn.returnType).toBeDefined();
      }
    });

    it('parses function without return type', () => {
      const ast = parseSource('fn noop() { }');
      const fn = ast.items[0];
      if (fn.kind === 'FnDef') {
        expect(fn.returnType).toBeUndefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('reports error on missing closing brace', () => {
      expectParseError('mod test() {');
    });

    it('reports error on missing semicolon', () => {
      expectParseError('mod test() { let x: bit[8] }');
    });
  });
});
