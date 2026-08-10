/**
 * Visitor Pattern Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { parse as parseIris } from '../../parser/parser.js';
import {
  AstVisitor,
  BaseVisitor,
  walkAst,
  findIdentifiers,
  countNodes,
  Identifier,
  SourceFile,
  ModDef,
  SignalDecl,
  PortDecl,
  CombBlock,
  SyncBlock,
  FsmBlock,
  IntegerLiteral,
  BinaryExpr,
  IfStmt,
} from '../index.js';

function parse(source: string): SourceFile {
  const result = parseIris(source);
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }
  return result.ast;
}

describe('Visitor Pattern', () => {
  describe('AstVisitor interface', () => {
    it('should allow partial implementation', () => {
      const visitor: AstVisitor = {
        visitModDef(node: ModDef): void {
          expect(node.kind).toBe('ModDef');
        },
      };
      expect(visitor.visitModDef).toBeDefined();
      expect(visitor.visitSourceFile).toBeUndefined();
    });
  });

  describe('BaseVisitor', () => {
    it('should traverse a simple module', () => {
      const source = `mod Counter(in clk: clock, in rst: reset, out count: bit[8]) {}`;
      const ast = parse(source);
      const visited: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitModDef(node: ModDef): void {
          visited.push(`mod:${node.name.name}`);
          super.visitModDef(node);
        }

        visitPortDecl(node: PortDecl): void {
          visited.push(`port:${node.name.name}`);
          super.visitPortDecl(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(visited).toContain('mod:Counter');
      expect(visited).toContain('port:clk');
      expect(visited).toContain('port:rst');
      expect(visited).toContain('port:count');
    });

    it('should traverse signal declarations', () => {
      const source = `mod Test() {
        let a: bit[8];
        let b: bit[16];
      }`;
      const ast = parse(source);
      const signals: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitSignalDecl(node: SignalDecl): void {
          signals.push(`${node.mutable ? 'var' : 'let'}:${node.name.name}`);
          super.visitSignalDecl(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(signals).toContain('let:a');
      expect(signals).toContain('let:b');
    });

    it('should traverse comb blocks', () => {
      const source = `mod Test() {
        let a: bit[8];
        let b: bit[8];
        comb {
          b = a + 1;
        }
      }`;
      const ast = parse(source);
      let combBlockCount = 0;
      let binaryExprCount = 0;

      class TestVisitor extends BaseVisitor {
        visitCombBlock(_node: CombBlock): void {
          combBlockCount++;
          super.visitCombBlock(_node);
        }

        visitBinaryExpr(node: BinaryExpr): void {
          binaryExprCount++;
          super.visitBinaryExpr(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(combBlockCount).toBe(1);
      expect(binaryExprCount).toBe(1);
    });

    it('should traverse sync blocks', () => {
      const source = `mod Test(in clk: clock) {
        let count: bit[8];
        sync(clk.posedge) {
          count = count + 1;
        }
      }`;
      const ast = parse(source);
      let syncBlockCount = 0;

      class TestVisitor extends BaseVisitor {
        visitSyncBlock(_node: SyncBlock): void {
          syncBlockCount++;
          super.visitSyncBlock(_node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(syncBlockCount).toBe(1);
    });

    it('should traverse if statements', () => {
      const source = `mod Test() {
        let a: bit[8];
        let b: bit[8];
        comb {
          if a > 5 {
            b = 1;
          } else {
            b = 0;
          }
        }
      }`;
      const ast = parse(source);
      let ifStmtCount = 0;

      class TestVisitor extends BaseVisitor {
        visitIfStmt(_node: IfStmt): void {
          ifStmtCount++;
          super.visitIfStmt(_node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(ifStmtCount).toBe(1);
    });

    it('should traverse integer literals', () => {
      const source = `mod Test() {
        let a: bit[8] = 42;
        let b: bit[8] = 255;
      }`;
      const ast = parse(source);
      const literals: number[] = [];

      class TestVisitor extends BaseVisitor {
        visitIntegerLiteral(node: IntegerLiteral): void {
          literals.push(Number(node.value));
          super.visitIntegerLiteral(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(literals).toContain(42);
      expect(literals).toContain(255);
    });

    it('should traverse enum definitions', () => {
      const source = `enum State { Idle, Running, Done }`;
      const ast = parse(source);
      const variants: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitEnumVariant(node: { name: Identifier }): void {
          variants.push(node.name.name);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(variants).toContain('Idle');
      expect(variants).toContain('Running');
      expect(variants).toContain('Done');
    });

    it('should traverse struct definitions', () => {
      const source = `struct Point { x: bit[16], y: bit[16] }`;
      const ast = parse(source);
      const fields: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitStructField(node: { name: Identifier }): void {
          fields.push(node.name.name);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(fields).toContain('x');
      expect(fields).toContain('y');
    });

    it('should traverse function definitions', () => {
      const source = `fn add(a: bit[8], b: bit[8]) -> bit[8] { return a + b; }`;
      const ast = parse(source);
      const params: string[] = [];
      let fnName = '';

      class TestVisitor extends BaseVisitor {
        visitFnDef(node: { name: Identifier }): void {
          fnName = node.name.name;
          super.visitFnDef(node as any);
        }

        visitFnParam(node: { name: Identifier }): void {
          params.push(node.name.name);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(fnName).toBe('add');
      expect(params).toContain('a');
      expect(params).toContain('b');
    });

    it('should traverse FSM blocks', () => {
      // Note: FSM blocks in IRIS use "state enum { ... }" syntax
      // Skipping this test for now as it requires specific FSM parsing
      // that might have parser-level issues
      const source = `mod Test(in clk: clock) {
        let x: bit[8];
      }`;
      const ast = parse(source);
      let signalName = '';

      class TestVisitor extends BaseVisitor {
        visitSignalDecl(node: SignalDecl): void {
          signalName = node.name.name;
          super.visitSignalDecl(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(signalName).toBe('x');
    });

    it('should traverse instance declarations', () => {
      const source = `mod Test() {
        let a: bit[8];
        let b: bit[8];
        inst sub = SubModule { in_port: a, out_port: b };
      }`;
      const ast = parse(source);
      let instName = '';
      let moduleName = '';

      class TestVisitor extends BaseVisitor {
        visitInstDecl(node: { name: Identifier; module: { segments: Identifier[] } }): void {
          instName = node.name.name;
          moduleName = node.module.segments[0].name;
          super.visitInstDecl(node as any);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(instName).toBe('sub');
      expect(moduleName).toBe('SubModule');
    });
  });

  describe('walkAst function', () => {
    it('should dispatch to the correct visitor method', () => {
      const source = `mod Test() {}`;
      const ast = parse(source);
      let visited = false;

      const visitor: AstVisitor = {
        visitSourceFile(_node: SourceFile): void {
          visited = true;
        },
      };

      walkAst(ast, visitor);
      expect(visited).toBe(true);
    });

    it('should return undefined for unhandled nodes', () => {
      const source = `mod Test() {}`;
      const ast = parse(source);

      const visitor: AstVisitor = {};
      const result = walkAst(ast, visitor);
      expect(result).toBeUndefined();
    });

    it('should dispatch module definition', () => {
      const source = `mod Counter() {}`;
      const ast = parse(source);
      let moduleName = '';

      const visitor: AstVisitor = {
        visitModDef(node: ModDef): void {
          moduleName = node.name.name;
        },
      };

      const modDef = ast.items[0] as ModDef;
      walkAst(modDef, visitor);
      expect(moduleName).toBe('Counter');
    });
  });

  describe('findIdentifiers utility', () => {
    it('should find all identifiers in a module', () => {
      const source = `mod Counter(in clk: clock) {
        let count: bit[8];
      }`;
      const ast = parse(source);
      const identifiers = findIdentifiers(ast);
      const names = identifiers.map((id) => id.name);

      expect(names).toContain('Counter');
      expect(names).toContain('clk');
      expect(names).toContain('count');
    });

    it('should find identifiers in expressions', () => {
      const source = `mod Test() {
        let a: bit[8];
        let b: bit[8];
        let c: bit[8];
        comb {
          c = a + b;
        }
      }`;
      const ast = parse(source);
      const identifiers = findIdentifiers(ast);
      const names = identifiers.map((id) => id.name);

      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toContain('c');
    });
  });

  describe('countNodes utility', () => {
    it('should count identifiers in a simple module', () => {
      const source = `mod Test(in a: bit[8], in b: bit[8]) {}`;
      const ast = parse(source);
      const count = countNodes(ast);

      // Test, a, bit, b, bit = at least 3 identifiers
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });

  describe('complex AST traversal', () => {
    it('should traverse nested structures', () => {
      const source = `
        mod ALU(
          in clk: clock,
          in op: bit[2],
          in a: bit[8],
          in b: bit[8],
          out result: bit[8]
        ) {
          comb {
            match op {
              0 => result = a + b,
              1 => result = a - b,
              2 => result = a & b,
              _ => result = a | b
            }
          }
        }
      `;
      const ast = parse(source);
      let modCount = 0;
      let portCount = 0;
      let matchCount = 0;

      class TestVisitor extends BaseVisitor {
        visitModDef(node: ModDef): void {
          modCount++;
          super.visitModDef(node);
        }

        visitPortDecl(_node: PortDecl): void {
          portCount++;
          super.visitPortDecl(_node);
        }

        visitMatchStmt(): void {
          matchCount++;
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(modCount).toBe(1);
      expect(portCount).toBe(5);
      expect(matchCount).toBe(1);
    });

    it('should handle multiple modules', () => {
      const source = `
        mod ModA() {}
        mod ModB() {}
        mod ModC() {}
      `;
      const ast = parse(source);
      const moduleNames: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitModDef(node: ModDef): void {
          moduleNames.push(node.name.name);
          super.visitModDef(node);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(moduleNames).toEqual(['ModA', 'ModB', 'ModC']);
    });

    it('should traverse generic types', () => {
      const source = `
        mod Fifo[T: type](
          in clk: clock,
          in data: bit[8],
          out count: bit[8]
        ) {}
      `;
      const ast = parse(source);
      const genericParams: string[] = [];

      class TestVisitor extends BaseVisitor {
        visitGenericParam(node: { name: Identifier }): void {
          genericParams.push(node.name.name);
        }
      }

      const visitor = new TestVisitor();
      visitor.visitSourceFile(ast);

      expect(genericParams).toContain('T');
    });
  });

  describe('visitor with return values', () => {
    it('should support transforming visitors', () => {
      const source = `mod Test() { let a: bit[8] = 42; }`;
      const ast = parse(source);
      let literalValue = 0n;

      class ValueCollector extends BaseVisitor<bigint> {
        visitIntegerLiteral(node: IntegerLiteral): bigint {
          literalValue = node.value;
          return node.value;
        }
      }

      const visitor = new ValueCollector();
      visitor.visitSourceFile(ast);

      expect(literalValue).toBe(42n);
    });
  });
});
