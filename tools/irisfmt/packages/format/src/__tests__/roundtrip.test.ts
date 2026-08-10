/**
 * Formatting rewrites the file the reader is editing.
 *
 * So the property that matters is not how the output looks but what it
 * preserves: the result must still parse, and nothing the author wrote may be
 * silently dropped. Both failed here — a `where` clause ran into the port list
 * and turned the last constraint into a call, and `else error("...")` and the
 * period of a clock were printed as nothing at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Lexer, Parser } from '@irisfmt/core';
import { format } from '../format.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = join(here, '..', '..', '..', '..', '..', '..', 'example');

function parseErrors(source: string): string[] {
  const { tokens } = new Lexer(source).tokenize();
  return new Parser(tokens)
    .parse()
    .errors.map((e) => `${e.span.start.line}:${e.span.start.column} ${e.message}`);
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

describe('formatted output still parses', () => {
  for (const file of irisFiles(exampleRoot)) {
    it(`${file.split('/').pop()}`, () => {
      const formatted = format(readFileSync(file, 'utf8'));
      expect(parseErrors(formatted).slice(0, 3)).toEqual([]);
    });
  }
});

describe('nothing the author wrote is dropped', () => {
  it('keeps the period of a clock', () => {
    const out = format('test T {\n  let clk: clock(period: 10ns);\n}\n');
    expect(out).toContain('period: 10ns');
  });

  it('keeps a reset attribute', () => {
    const out = format('test T {\n  let rst_n: reset(active_low: true);\n}\n');
    expect(out).toContain('active_low: true');
  });

  it('keeps the else clause of an assert', () => {
    const out = format('test T {\n  assert ok else error("bad");\n}\n');
    expect(out).toContain('else error("bad")');
  });

  it('keeps the comma form of an assert message', () => {
    const out = format('test T {\n  assert ok, "bad";\n}\n');
    expect(out).toContain('"bad"');
  });

  it('keeps an assert that sits inside a sync block', () => {
    // Statements print through a different switch than test-module items, and
    // a case missing there drops the assertion silently.
    const out = format('test T {\n  sync(clk.posedge) {\n    assert ok else error("bad");\n  }\n}\n');
    expect(out).toContain('else error("bad")');
  });

  it('keeps every assert in the RV32I testbench', () => {
    const source = readFileSync(join(exampleRoot, 'riscv', 'src', 'test_addi.iris'), 'utf8');
    const count = (text: string) => (text.match(/\bassert\b/g) ?? []).length;
    expect(count(format(source))).toBe(count(source));
  });

  it('keeps a where clause separate from the port list', () => {
    const source = 'mod M[W: uint = 8]\nwhere\n    W >= 1,\n(\n    in a: bit[W],\n) {\n}\n';
    const out = format(source);
    // `W >= 1(` would read as a call and the ports would be lost
    expect(out).not.toMatch(/W >= 1\s*\(/);
    expect(parseErrors(out).slice(0, 3)).toEqual([]);
  });
});

describe('formatting settles', () => {
  // A formatter that keeps changing its own output rewrites the file on every
  // save. One further pass is allowed to normalise blank lines; after that the
  // result must not move.
  for (const file of irisFiles(exampleRoot)) {
    it(`${file.split('/').pop()}`, () => {
      const once = format(readFileSync(file, 'utf8'));
      const twice = format(once);
      expect(format(twice)).toBe(twice);
    });
  }
});
