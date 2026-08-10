/**
 * Conversion tests for the constructs example/async_fifo depends on.
 *
 * Each case here corresponds to something that was silently dropped or
 * mistranslated before: the generated SystemVerilog compiled, but said less
 * than the IRIS source did, or meant something different.
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../compiler.js';

describe('async_fifo constructs', () => {
  describe('system functions', () => {
    it('keeps $clog2 in a parameter default', () => {
      const result = compile(`
mod M[Depth: uint = 16, AddrWidth: uint = $clog2(Depth)](
  in a: bit[AddrWidth],
  out y: bit[AddrWidth],
) {
  comb { y = a; }
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toContain('$clog2(Depth)');
    });
  });

  describe('trailing commas', () => {
    it('accepts them in parameters, ports and where clauses', () => {
      const result = compile(`
mod M[
  Width: uint = 8,
]
where
  Width >= 1,
(
  in a: bit[Width],
  out y: bit[Width],
) {
  comb { y = a; }
}
`);
      expect(result.success).toBe(true);
      expect(result.parseErrors).toHaveLength(0);
    });
  });

  describe('clock and reset attributes', () => {
    it('accepts reset(active_low: true) and drives negedge', () => {
      const result = compile(`
mod M(
  in clk: clock,
  in rst_n: reset(active_low: true),
  in d: bit[8],
  out q: bit[8],
) {
  var r: bit[8] = 0;
  sync(clk.posedge, rst_n.async) {
    if ~rst_n { r = 0; } else { r = d; }
  }
  comb { q = r; }
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toContain('negedge rst_n');
    });
  });

  describe('generic parameters', () => {
    it('declares them rather than leaving them dangling', () => {
      const result = compile(`
mod M[Width: uint = 8](
  in a: bit[Width],
  out y: bit[Width],
) {
  comb { y = a; }
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toContain('parameter');
      expect(result.output).toContain('Width = 8');
      // The port must carry the parameter, not collapse to one bit
      expect(result.output).toContain('[Width-1:0] a');
    });
  });

  describe('widths', () => {
    it('does not collapse a parameterised width to one bit', () => {
      const result = compile(`
mod M[W: uint = 8](
  in a: bit[W],
  out y: bit[W],
) {
  var r: bit[W] = 0;
  comb { y = a; r = a; }
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toContain('[W-1:0] a');
      expect(result.output).toContain('[W-1:0] r');
      expect(result.output).not.toMatch(/logic\s+a\b/);
    });

    it('truncates arithmetic to the operand width', () => {
      // IRIS evaluates `p + 1` in p's width, so at the wrap the carry is
      // dropped. SystemVerilog would widen to 32 bits and keep it, which
      // changes `(p + 1) >> 1` — the Gray-code step in the FIFO.
      const result = compile(`
mod M[PtrWidth: uint = 5](
  in clk: clock,
  out g: bit[PtrWidth],
) {
  var p: bit[PtrWidth] = 0;
  sync(clk.posedge) {
    p = p + 1;
  }
  comb { g = (p + 1) ^ ((p + 1) >> 1); }
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toContain("PtrWidth'(p + 1)");
    });
  });

  describe('memory', () => {
    it('declares the storage array', () => {
      const result = compile(`
mod M[Width: uint = 8, Depth: uint = 16](
  in clk: clock,
  in we: bit,
  in addr: bit[4],
  in d: bit[Width],
  out q: bit[Width],
) {
  mem storage: bit[Width][Depth];
  sync(clk.posedge) {
    if we { storage[addr] = d; }
  }
  comb { q = storage[addr]; }
}
`);
      expect(result.success).toBe(true);
      // An unpacked array carries its dimension after the name
      expect(result.output).toContain('[Width-1:0] storage [Depth]');
    });
  });

  describe('unsupported constructs', () => {
    it('converts a test module to a testbench module', () => {
      // This asserted that a test module was reported as unsupported. It
      // converts now: a testbench is a module with no ports, and everything it
      // needs was already in the representation and the backend.
      const result = compile(`
test T {
  var x: bit[8] = 0;
}
`);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/module T\s*;/);
      expect(result.output).toContain('logic [7:0] x');
    });
  });
});

describe('RV32I core constructs', () => {
  it('converts a match expression to a conditional chain', () => {
    const result = compile(`
mod Sel(in op: bit[2], in a: bit[8], in b: bit[8], out y: bit[8]) {
  comb {
    y = match op {
      2'd0 => a + b,
      2'd1 => a - b,
      _    => 8'd0,
    };
  }
}
`);
    expect(result.success).toBe(true);
    expect(result.output).toContain('?');
    expect(result.output).toContain(':');
  });

  it('requires a default arm in a match expression', () => {
    const result = compile(`
mod Sel(in op: bit[2], out y: bit[8]) {
  comb {
    y = match op {
      2'd0 => 8'd1,
      2'd1 => 8'd2,
    };
  }
}
`);
    expect(result.success).toBe(false);
    const messages = result.diagnostics.map(d => d.message).join('\n');
    expect(messages).toContain('needs a `_` arm');
  });

  it('converts a width-carrying method call to a size cast', () => {
    const result = compile(`
mod Ext(in a: bit[12], out s: bit[32], out z: bit[32]) {
  comb {
    s = a.sign_extend[32]();
    z = a.extend[32]();
  }
}
`);
    expect(result.success).toBe(true);
    // Sign extension needs the signed cast; zero extension must not have it
    expect(result.output).toContain("32'($signed(a))");
    expect(result.output).toContain("32'(a)");
  });

  it('tells a concatenation from a block after =>', () => {
    const result = compile(`
mod Pack(in sel: bit, in a: bit[4], in b: bit[4], out y: bit[8]) {
  comb {
    y = match sel {
      1'd0 => {a, b},
      _    => {b, a},
    };
  }
}
`);
    expect(result.success).toBe(true);
  });
});
