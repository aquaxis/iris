/**
 * Constructs that no design in `example/` happens to use, so nothing in the
 * conformance corpus exercised them. Each one below failed until this round.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@iris2sv/core';
import { lowerSourceFile } from '../lowering.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function convert(source: string): { hir: any; errors: string[] } {
  const { ast, errors: parseErrors } = parse(source);
  if (parseErrors.length > 0) {
    return { hir: undefined, errors: parseErrors.map((e) => e.message) };
  }
  const { hir, errors } = lowerSourceFile(ast);
  return { hir, errors: errors.map((e) => e.message) };
}

describe('top-level declarations convert', () => {
  it('an enum becomes a type definition', () => {
    const { hir, errors } = convert('enum Op { Add, Sub, And }\nmod M(in x: bit,) {}\n');
    expect(errors).toEqual([]);
    expect(hir.typeDefs.map((t: { name: string }) => t.name)).toContain('Op');
  });

  it('an enum is wide enough for its variants', () => {
    // Three variants need two bits. A one-bit enum makes every comparison
    // against it mismatch, which Verilator reports as a width warning.
    const { hir } = convert('enum Op { Add, Sub, And }\nmod M(in x: bit,) {}\n');
    expect(hir.typeDefs[0].type.width).toEqual({ kind: 'ConstWidth', value: 2 });
  });

  it('a struct becomes a type definition', () => {
    const { hir, errors } = convert(
      'struct P {\n  valid: bit,\n  data: bit[8],\n}\nmod M(in x: bit,) {}\n',
    );
    expect(errors).toEqual([]);
    expect(hir.typeDefs[0].fields.map((f: { name: string }) => f.name)).toEqual([
      'valid',
      'data',
    ]);
  });

  it('a function becomes a function', () => {
    const { hir, errors } = convert(
      'fn add(a: bit[8], b: bit[8]) -> bit[8] {\n  return a + b;\n}\nmod M(in x: bit,) {}\n',
    );
    expect(errors).toEqual([]);
    expect(hir.functions[0].name).toBe('add');
    expect(hir.functions[0].body[0].kind).toBe('ReturnStmt');
  });

  it('an extern module declares nothing and reports nothing', () => {
    // SystemVerilog resolves a module by name, so there is genuinely nothing
    // to emit. That is not the same as dropping a construct.
    const { hir, errors } = convert(
      'extern mod Ext(\n  in clk: clock,\n  out y: bit,\n);\nmod M(in x: bit,) {}\n',
    );
    expect(errors).toEqual([]);
    expect(hir.modules).toHaveLength(1);
  });
});

describe('an enum member is named the way SystemVerilog names it', () => {
  // `Op::Add` is not valid SystemVerilog outside a package: the members of a
  // `typedef enum` sit in the enclosing scope. Emitting the qualified form made
  // Verilator fail with an internal fault.
  it('drops the enum qualifier', () => {
    const { hir } = convert(`
enum Op { Add, Sub }
mod M(in clk: clock, out y: bit[8],) {
  var op: Op = Op::Add;
  comb { y = 0; }
}
`);
    const signal = hir.modules[0].signals.find((s: { name: string }) => s.name === 'op');
    expect(signal.initialValue.name).toBe('Add');
  });

  it('gives a signal of an enum type the enum width', () => {
    const { hir } = convert(`
enum Op { Add, Sub, And }
mod M(in clk: clock, out y: bit[8],) {
  var op: Op = Op::Add;
  comb { y = 0; }
}
`);
    const signal = hir.modules[0].signals.find((s: { name: string }) => s.name === 'op');
    expect(signal.dataType.width).toEqual({ kind: 'ConstWidth', value: 2 });
  });
});

describe('exhaustiveness of a match expression', () => {
  it('accepts every variant of an enum without a wildcard', () => {
    const { errors } = convert(`
enum Op { Add, Sub }
mod M(in clk: clock, out y: bit[8],) {
  var op: Op = Op::Add;
  comb { y = match op { Op::Add => 8'd1, Op::Sub => 8'd2, }; }
}
`);
    expect(errors).toEqual([]);
  });

  it('still rejects a genuine gap', () => {
    // The reference calls this non-exhaustive: 2 of 4 values on a bit[2].
    const { errors } = convert(`
mod Sel(in op: bit[2], out y: bit[8],) {
  comb { y = match op { 2'd0 => 8'd1, 2'd1 => 8'd2, }; }
}
`);
    expect(errors.join('\n')).toContain('needs a `_` arm');
  });

  it('rejects a partial enumeration of an enum too', () => {
    const { errors } = convert(`
enum Op { Add, Sub, And }
mod M(in clk: clock, out y: bit[8],) {
  var op: Op = Op::Add;
  comb { y = match op { Op::Add => 8'd1, Op::Sub => 8'd2, }; }
}
`);
    expect(errors.join('\n')).toContain('needs a `_` arm');
  });
});

describe('a part select keeps its operator', () => {
  it('upward', () => {
    const { hir, errors } = convert(`
mod M(in a: bit[32], in i: bit[5], out y: bit[8],) {
  comb { y = a[i +: 8]; }
}
`);
    expect(errors).toEqual([]);
    const stmt = hir.modules[0].combBlocks[0].statements[0];
    expect(stmt.value.partSelect).toBe('+:');
  });

  it('downward', () => {
    const { hir } = convert(`
mod M(in a: bit[32], in i: bit[5], out y: bit[8],) {
  comb { y = a[i -: 8]; }
}
`);
    expect(hir.modules[0].combBlocks[0].statements[0].value.partSelect).toBe('-:');
  });

  it('a plain slice carries no operator', () => {
    const { hir } = convert(`
mod M(in a: bit[32], out y: bit[8],) {
  comb { y = a[7:0]; }
}
`);
    expect(hir.modules[0].combBlocks[0].statements[0].value.partSelect).toBeUndefined();
  });
});

describe('a package declaration and its contents', () => {
  // `package demo;` names the file; the parser gathers everything after it as
  // the package's items, so this is where the whole rest of such a file
  // arrives. Reporting it as unsupported meant no file could open with one.
  const source = `
package demo;

union Word {
    raw: bit[32],
    half: bit[16],
}

mod M(in clk: clock, out y: bit,) {
    comb { y = 0; }
}
`;

  it('converts what the package holds', () => {
    const { hir, errors } = convert(source);
    expect(errors).toEqual([]);
    expect(hir.modules.map((m: { name: string }) => m.name)).toContain('M');
    expect(hir.typeDefs.map((t: { name: string }) => t.name)).toContain('Word');
  });

  it('says the package name has no counterpart', () => {
    // SystemVerilog packages hold types and functions, not modules, so the
    // name genuinely cannot be carried over. Saying so beats silence.
    const { ast, errors: parseErrors } = parse(source);
    expect(parseErrors).toEqual([]);
    const { warnings } = lowerSourceFile(ast);
    expect(warnings.map((w: { message: string }) => w.message).join('\n')).toContain('demo');
  });
});

describe('a union becomes a packed union, not a struct', () => {
  // A union overlays its members where a struct lays them end to end, so the
  // two cannot share a node without changing what the design means.
  it('lowers to its own node', () => {
    const { hir, errors } = convert(
      'union U {\n  a: bit[8],\n  b: bit[8],\n}\nmod M(in x: bit,) {}\n',
    );
    expect(errors).toEqual([]);
    expect(hir.typeDefs[0].kind).toBe('HirUnionDef');
    expect(hir.typeDefs[0].fields.map((f: { name: string }) => f.name)).toEqual(['a', 'b']);
  });
});
