/**
 * The round-trip tests check that formatted output parses again — but with this
 * package's own parser. That parser accepted `int<32>`, `test mod T` and
 * `d: M( .p(x) );`, none of which are IRIS, so printer and parser were wrong
 * together and agreed with each other. Seven of the eleven designs in
 * `example/` came out of the formatter unable to load in `iris-sim`.
 *
 * These tests use the reference grammar as the oracle instead. The shapes below
 * are taken from `sim/iris-sim/src/parser/iris.pest`:
 *
 *   bit_type     = "bit"  ~ ("[" ~ width_expr ~ "]")?
 *   int_type     = "int"  ~ ("[" ~ width_expr ~ "]")?
 *   instance     = "inst" ~ identifier ~ ... ~ "=" ~ identifier
 *                  ~ generic_args? ~ "{" ~ port_connections ~ "}" ~ ";"
 *   generic_args = "[" ~ generic_arg ~ ("," ~ generic_arg)* ~ ","? ~ "]"
 *   port_connection = identifier ~ ":" ~ expr
 */

import { describe, it, expect } from 'vitest';
import { format, FormatError } from '../format.js';

describe('sized primitive types print with brackets', () => {
  // `int<32>` reached iris-sim as `expected array_suffix`.
  it('int', () => {
    expect(format('mod M(\n  in x: bit,\n) {\n  var a: int[32] = 0;\n}\n')).toContain('int[32]');
  });

  it('bit', () => {
    expect(format('mod M(\n  in x: bit,\n) {\n  var a: bit[32] = 0;\n}\n')).toContain('bit[32]');
  });

  it('uint', () => {
    expect(format('mod M(\n  in x: bit,\n) {\n  var a: uint[16] = 0;\n}\n')).toContain('uint[16]');
  });

  it('a width that is an expression', () => {
    const out = format('mod M[W: uint = 8](\n  in a: bit[W],\n) {\n}\n');
    expect(out).toContain('bit[W]');
  });

  it('never uses angle brackets for a width', () => {
    const out = format('mod M(\n  in x: bit,\n) {\n  var a: int[32] = 0;\n  var b: uint[8] = 0;\n}\n');
    expect(out).not.toMatch(/(int|uint|bit)</);
  });
});

describe('instances print in the form the language defines', () => {
  const source = 'mod M(\n  in x: bit,\n) {\n  inst dec = Decoder {\n    instr: x,\n  };\n}\n';

  it('declares with inst and =', () => {
    expect(format(source)).toMatch(/inst\s+dec\s*=\s*Decoder\s*\{/);
  });

  it('connects ports with a colon, not a dot and parentheses', () => {
    const out = format(source);
    expect(out).toContain('instr: x');
    expect(out).not.toContain('.instr(');
  });

  it('closes the body with a brace and a semicolon', () => {
    expect(format(source)).toMatch(/\}\s*;/);
  });

  it('passes generic arguments in brackets', () => {
    const out = format('mod M(\n  in clk: clock,\n) {\n  inst f = Fifo[Depth: 16] {\n    clk: clk,\n  };\n}\n');
    expect(out).toContain('Fifo[Depth: 16]');
    expect(out).not.toContain('Fifo<');
  });

  it('keeps every connection of a multi-port instance', () => {
    const out = format(
      'mod M(\n  in clk: clock,\n) {\n  inst rf = RegFile {\n    clk: clk,\n    we: en,\n    waddr: a,\n  };\n}\n',
    );
    for (const port of ['clk: clk', 'we: en', 'waddr: a']) {
      expect(out).toContain(port);
    }
  });
});

describe('a test module keeps its own keyword', () => {
  // `test mod T` is the old spelling; iris-sim stops at `expected identifier`.
  it('prints test, not test mod', () => {
    const out = format('test T {\n  let clk: clock(period: 10ns);\n}\n');
    expect(out).toMatch(/^test\s+T\s*\{/m);
    expect(out).not.toContain('test mod');
  });
});

describe('unparseable input is refused, not silently emptied', () => {
  // `format` used to print whatever AST the parser salvaged. When the parse
  // failed that AST was empty, so the result was the empty string — and
  // `irisfmt -w` stored it, truncating the file to zero bytes and exiting 0.
  const rejected: Record<string, string> = {
    'not IRIS at all': 'this is not iris at all !!!\n',
    'truncated module': 'mod M(\n  in x: bit,\n',
    'module without a port list': 'mod M {\n  var a: int[32] = 0;\n}\n',
  };

  for (const [name, source] of Object.entries(rejected)) {
    it(`throws on ${name}`, () => {
      expect(() => format(source)).toThrow(FormatError);
    });

    it(`never returns empty output for ${name}`, () => {
      let out: string | undefined;
      try {
        out = format(source);
      } catch {
        return; // refused, which is the point
      }
      expect(out).not.toBe('');
    });
  }

  it('reports where the parse failed', () => {
    try {
      format('mod M(\n  in x: bit,\n');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FormatError);
      expect((err as FormatError).errors.length).toBeGreaterThan(0);
      expect((err as FormatError).errors[0]).toMatch(/^\d+:\d+: /);
    }
  });

  it('still formats valid input', () => {
    expect(format('mod M(\n  in x: bit,\n) {\n}\n')).toContain('mod M');
  });
});

describe('constructs no design in example/ happens to use', () => {
  // The conformance corpus covered none of these, so the checks that were
  // green said nothing about them. Two sent the parser into a loop that ran
  // until it exhausted memory.
  it('an interface signal ends with a comma, not a semicolon', () => {
    const out = format('interface Bus {\n  valid: bit,\n  data: bit[8],\n}\n');
    expect(out).toContain('valid: bit,');
    expect(out).not.toContain('valid: bit;');
  });

  it('a view groups its signals under one direction', () => {
    const out = format(
      'interface Bus {\n  valid: bit,\n  ready: bit,\n\n  view initiator {\n    out: valid,\n    in: ready,\n  }\n}\n',
    );
    expect(out).toMatch(/out:\s*valid,/);
    expect(out).toMatch(/in:\s*ready,/);
    expect(out).not.toMatch(/out valid;/);
  });

  it('a view may be named with a keyword', () => {
    // `initiator`, `target` and `monitor` are keywords in this lexer, so
    // asking for an identifier rejected every view the specification shows.
    expect(() =>
      format('interface Bus {\n  valid: bit,\n\n  view target {\n    in: valid,\n  }\n}\n'),
    ).not.toThrow();
  });

  it('an interface can extend another', () => {
    const out = format('interface B extends A {\n  extra: bit,\n}\n');
    expect(out).toContain('extends A');
  });

  it('a package declaration ends at the semicolon', () => {
    // `package demo;` heads a file; it does not enclose it. The braced form
    // printed here was not IRIS.
    const out = format('package demo;\n\nmod M(\n  in x: bit,\n) {\n}\n');
    expect(out).toMatch(/^package demo;/m);
    expect(out).not.toMatch(/package demo\s*\{/);
  });

  it('a union prints like a struct', () => {
    const out = format('union U {\n  a: bit[8],\n  b: bit[8],\n}\n');
    expect(out).toContain('union U {');
    expect(out).toContain('a: bit[8],');
  });

  it('an extern module keeps its ports and semicolon', () => {
    const out = format('extern mod Ext(\n  in clk: clock,\n  out y: bit,\n);\n');
    expect(out).toContain('extern mod Ext(');
    expect(out).toMatch(/\);\s*$/);
  });

  it('a part select keeps its operator', () => {
    // `a[i +: 8]` and `a[i -: 8]` select different bits, and neither is the
    // slice `a[i:8]` they were both printed as.
    const source = 'mod M(\n  in a: bit[32],\n  in i: bit[5],\n  out y: bit[8],\n) {\n  comb {\n    y = a[i +: 8];\n  }\n}\n';
    expect(format(source)).toContain('a[i +: 8]');
  });

  it('a downward part select keeps its own operator', () => {
    const source = 'mod M(\n  in a: bit[32],\n  in i: bit[5],\n  out y: bit[8],\n) {\n  comb {\n    y = a[i -: 8];\n  }\n}\n';
    expect(format(source)).toContain('a[i -: 8]');
  });
});

describe('a package can hold every item the file can', () => {
  // `parsePackageItem` is a second copy of the dispatch in `parseItem`, and it
  // fell behind: `union`, `extern mod` and `test` were added to one and not the
  // other, so a file that opened with `package` could not contain them.
  const items: Record<string, string> = {
    union: 'union U {\n  a: bit[8],\n}\n',
    'extern mod': 'extern mod Ext(\n  in clk: clock,\n);\n',
    struct: 'struct S {\n  a: bit[8],\n}\n',
    enum: 'enum E {\n  A,\n  B,\n}\n',
  };

  for (const [name, body] of Object.entries(items)) {
    it(`holds a ${name}`, () => {
      expect(() => format(`package demo;\n\n${body}`)).not.toThrow();
    });
  }
});
