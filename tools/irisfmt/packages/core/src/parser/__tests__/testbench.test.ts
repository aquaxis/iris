/**
 * Testbenches are IRIS files too.
 *
 * The parser reached the designs in `example/` but not the testbenches beside
 * them: `test Name { ... }` was gated on an older spelling, so every `.iris`
 * testbench arrived as a wall of errors, and one construct inside them made
 * the parser spin instead of stopping.
 *
 * A spin is worse than a wrong parse. The parser runs inside an editor, so a
 * loop that never advances freezes the window on a file that is only half
 * typed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Lexer } from '../../lexer/lexer.js';
import { Parser } from '../parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = join(here, '..', '..', '..', '..', '..', '..', '..', 'example');

function parse(source: string) {
  const { tokens } = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

function irisFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...irisFiles(path));
    } else if (entry.name.endsWith('.iris')) {
      found.push(path);
    }
  }
  return found;
}

describe('test modules', () => {
  it('parses `test Name { ... }`', () => {
    const result = parse('test T {\n  var i: bit[4] = 0;\n}\n');
    expect(result.errors).toHaveLength(0);
    expect(result.ast.items[0]?.kind).toBe('TestModDef');
  });

  it('still parses the older `test mod Name { ... }`', () => {
    const result = parse('test mod T {\n  var i: bit[4] = 0;\n}\n');
    expect(result.errors).toHaveLength(0);
    expect(result.ast.items[0]?.kind).toBe('TestModDef');
  });

  it('takes a duration in a clock attribute', () => {
    const result = parse('test T {\n  let clk: clock(period: 10ns);\n}\n');
    expect(result.errors).toHaveLength(0);
  });

  it('keeps the unit of a duration rather than dropping it', () => {
    const result = parse('test T {\n  let clk: clock(period: 25ns);\n}\n');
    const decl = (result.ast.items[0] as any).items[0];
    expect(decl.typeExpr.attrs[0].unit).toBe('ns');
  });

  it('takes an instance written in the current syntax', () => {
    const result = parse('test T {\n  inst dut = Fifo {\n    clk: clk,\n  };\n}\n');
    expect(result.errors).toHaveLength(0);
  });

  it('takes a memory, which the grammar allows in a test module', () => {
    const result = parse('test T {\n  mem regs: bit[32][32];\n}\n');
    expect(result.errors).toHaveLength(0);
  });
});

describe('assert', () => {
  it('takes the `else` form the grammar defines', () => {
    const result = parse('test T {\n  assert ok else error("bad");\n}\n');
    expect(result.errors).toHaveLength(0);
  });

  it('records the severity and the message', () => {
    const result = parse('test T {\n  assert ok else error("bad");\n}\n');
    const stmt = (result.ast.items[0] as any).items[0];
    expect(stmt.kind).toBe('AssertStmt');
    expect(stmt.severity).toBe('error');
    expect(stmt.message).toBe('bad');
  });

  it('takes the comma form as well', () => {
    const result = parse('test T {\n  assert ok, "bad";\n}\n');
    expect(result.errors).toHaveLength(0);
  });

  it('stands inside a sync block, where it used to spin', () => {
    const source = 'test T {\n  sync(clk.posedge) {\n    if a {\n      assert ok else error("bad");\n    }\n  }\n}\n';
    const result = parse(source);
    expect(result.errors).toHaveLength(0);
  });
});

describe('the parser always terminates', () => {
  // Each of these once left a loop where it started, or is the shape that
  // would. Reaching the assertion at all is the point of the test.
  const awkward = [
    'test T {\n  assert\n',
    'test T {\n  let clk: clock(period: );\n}\n',
    'test T {\n  sync(clk.posedge) {\n    @\n  }\n}\n',
    'mod M(\n  in a: bit,\n) {\n  comb {\n    @@@\n  }\n}\n',
    'test T {\n  inst = { ,,, }\n',
    'test',
    '}',
  ];

  for (const source of awkward) {
    it(`stops on ${JSON.stringify(source.slice(0, 32))}`, () => {
      const result = parse(source);
      expect(Array.isArray(result.errors)).toBe(true);
    });
  }
});

describe('every .iris file in example/', () => {
  const files = irisFiles(exampleRoot);

  it('finds the testbenches, not only the designs', () => {
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('test_addi.iris');
    expect(names).toContain('async_fifo_tb.iris');
  });

  for (const file of files) {
    it(`parses ${file.split('/').pop()} without error`, () => {
      const result = parse(readFileSync(file, 'utf8'));
      const messages = result.errors
        .slice(0, 3)
        .map((e) => `${e.span.start.line}:${e.span.start.column} ${e.message}`);
      expect(messages).toEqual([]);
    });
  }
});
