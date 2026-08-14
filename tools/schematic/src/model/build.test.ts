import { describe, expect, it } from 'vitest';
import { buildDiagrams } from './build.js';

const build = (text: string) => buildDiagrams([{ file: 'test.iris', text }]);
const only = (text: string) => {
  const { graphs, failures } = build(text);
  expect(failures).toEqual([]);
  expect(graphs).toHaveLength(1);
  return graphs[0];
};
const pairs = (g: ReturnType<typeof only>) =>
  new Set(g.edges.map((e) => `${e.from}->${e.to}`));

describe('edges written in the source', () => {
  it('draws a connection that names an instance output', () => {
    const g = only(`
      mod Src(in en: bit, out y: bit[8]) { comb { y = 0; } }
      mod Dst(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      mod Top(in en: bit, out o: bit[8]) {
        inst s = Src { en: en, };
        inst d = Dst { d: s.y, };
        comb { o = d.q; }
      }
    `);
    expect(pairs(g).has('inst:s->inst:d')).toBe(true);
    expect(g.edges.find((e) => e.from === 'inst:s')?.origin).toBe('direct');
  });
});

describe('edges that must be traced through comb', () => {
  it('follows an intermediate signal back to the driving instance', () => {
    const g = only(`
      mod Src(in en: bit, out y: bit[8]) { comb { y = 0; } }
      mod Dst(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      mod Top(in en: bit, out o: bit[8]) {
        var mid: bit[8] = 0;
        inst s = Src { en: en, };
        comb { mid = s.y; o = 0; }
        inst d = Dst { d: mid, };
      }
    `);
    // Stated nowhere: the connection names `mid`, not `s.y`.
    expect(pairs(g).has('inst:s->inst:d')).toBe(true);
    expect(g.edges.find((e) => e.from === 'inst:s' && e.to === 'inst:d')?.origin).toBe('traced');
  });

  it('reaches a boundary input through an intermediate signal', () => {
    const g = only(`
      mod Dst(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      mod Top(in a: bit[8], out o: bit[8]) {
        var mid: bit[8] = 0;
        comb { mid = a; o = 0; }
        inst d = Dst { d: mid, };
      }
    `);
    expect(pairs(g).has('io:a->inst:d')).toBe(true);
  });
});

describe('the three traps', () => {
  it('does not mistake a method call for an instance output', () => {
    // `raw.extend[16]()` is a FieldExpr over an identifier, the same shape
    // as `alu.y`. Only the set of instance names tells them apart.
    const g = only(`
      mod Dst(in d: bit[16], out q: bit[16]) { comb { q = d; } }
      mod Top(in raw: bit[8], out o: bit[16]) {
        var wide: bit[16] = 0;
        comb { wide = raw.extend[16](); o = 0; }
        inst d = Dst { d: wide, };
      }
    `);
    expect(g.nodes.map((n) => n.id)).not.toContain('inst:raw');
    // The read still resolves, through the boundary input it actually came from.
    expect(pairs(g).has('io:raw->inst:d')).toBe(true);
  });

  it('stops at a register instead of drawing through it', () => {
    // `held` is assigned under a clock. An edge from `s` to `d` would claim
    // the value arrives in the same cycle, when it arrives in the next.
    const g = only(`
      mod Src(in en: bit, out y: bit[8]) { comb { y = 0; } }
      mod Dst(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      mod Top(in clk: clock, in en: bit, out o: bit[8]) {
        var held: bit[8] = 0;
        inst s = Src { en: en, };
        comb { o = 0; }
        sync(clk.posedge) { held = s.y; }
        inst d = Dst { d: held, };
      }
    `);
    expect(g.nodes.map((n) => n.id)).toContain('reg:held');
    expect(pairs(g).has('reg:held->inst:d')).toBe(true);
    expect(pairs(g).has('inst:s->inst:d')).toBe(false);
  });

  it('never draws a self-loop', () => {
    const g = only(`
      mod Acc(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      mod Top(in a: bit[8], out o: bit[8]) {
        var loop_sig: bit[8] = 0;
        comb { loop_sig = loop_sig + a; o = 0; }
        inst u = Acc { d: loop_sig, };
      }
    `);
    expect(g.edges.every((e) => e.from !== e.to)).toBe(true);
  });
});

describe('containers', () => {
  it('draws test modules, where most instances live', () => {
    const g = only(`
      mod Dut(in a: bit, out y: bit) { comb { y = a; } }
      test Bench {
        let clk: clock(period: 10ns);
        var a: bit = 0;
        inst dut = Dut { a: a, };
      }
    `);
    expect(g.isTest).toBe(true);
    expect(g.name).toBe('Bench');
  });

  it('skips a module with no instances, having no block diagram to draw', () => {
    const { graphs } = build(`mod Leaf(in a: bit, out y: bit) { comb { y = a; } }`);
    expect(graphs).toEqual([]);
  });
});

describe('failures', () => {
  it('reports a file that does not parse rather than dropping it', () => {
    const { graphs, failures } = build('mod Broken( this is not iris');
    expect(graphs).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0].file).toBe('test.iris');
  });
});

describe('what is worth drawing', () => {
  it('drops a register no edge touches', () => {
    // `spare` is state, but it reaches neither an instance nor the boundary,
    // so a block diagram has nothing to say about it. `held` does reach one.
    const g = only(`
      mod Dst(in d: bit[8], out q: bit[8]) { comb { q = d; } }
      test Bench {
        let clk: clock(period: 10ns);
        var a: bit[8] = 0;
        var held: bit[8] = 0;
        var spare: bit[8] = 0;
        sync(clk.posedge) { held = a; spare = spare + 1; }
        inst d = Dst { d: held, };
      }
    `);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain('reg:held');
    expect(ids).not.toContain('reg:spare');
  });

  it('keeps an instance even when nothing connects to it', () => {
    // An unconnected submodule is itself worth seeing.
    const g = only(`
      mod Lonely(in a: bit, out y: bit) { comb { y = a; } }
      mod Other(in a: bit, out y: bit) { comb { y = a; } }
      test Bench {
        var a: bit = 0;
        inst lonely = Lonely { };
        inst wired = Other { a: a, };
      }
    `);
    expect(g.nodes.map((n) => n.id)).toContain('inst:lonely');
  });
});
