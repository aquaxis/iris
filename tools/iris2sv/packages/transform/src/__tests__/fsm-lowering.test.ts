/**
 * A state machine used to reach the transform and fall through to the default
 * branch: `'FsmBlock' is not supported and was not converted`. Three of its
 * constructs never got that far, because the parser had nowhere to put an
 * initial state, a signal declared inside the machine, or an `if` in a `when`.
 *
 * The oracle for the semantics is `iris-sim`. The behaviour that mattered most
 * is the one this file's last group covers: the clauses of a state are
 * first-match-wins. Lowering them as independent `if`s produced SystemVerilog
 * that Verilator ran happily and that disagreed with the reference after ten
 * cycles.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@iris2sv/core';
import { lowerSourceFile } from '../lowering.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
function convert(source: string): { mod: any; errors: string[] } {
  const { ast, errors: parseErrors } = parse(source);
  if (parseErrors.length > 0) {
    return { mod: undefined, errors: parseErrors.map((e) => e.message) };
  }
  const { hir, errors } = lowerSourceFile(ast);
  return { mod: (hir as any).modules[0], errors: errors.map((e) => e.message) };
}

function signal(mod: any, name: string): any {
  return mod.signals.find((s: { name: string }) => s.name === name);
}

/** The case arm for a state, found by its encoded value. */
function arm(mod: any, code: bigint): any {
  return mod.seqBlocks[0].statements[0].items.find(
    (i: { patterns: { value: bigint }[] }) => i.patterns[0]?.value === code
  );
}

const BLINKER = `
mod Blinker(
    in clk: clock,
    in rst_n: reset(active_low: true),
    in go: bit,
    out led: bit,
) {
    fsm main(clk.posedge, rst_n.async) {
        state enum { Idle, Run, Done }
        initial: Run

        var ticks: bit[8] = 0;

        transitions {
            Idle => { when go { goto Run; } }
            Run => {
                when ticks == 8'd3 { goto Done; }
                when go {
                    if ticks == 8'd0 { ticks = 8'd1; } else { ticks = ticks + 8'd1; }
                }
            }
            Done => { when go { goto Idle; } }
        }

        output led { Idle => 0, Run => 1, Done => 0, }
    }
}
`;

describe('a state machine converts', () => {
  it('without reporting it as unsupported', () => {
    const { errors } = convert(BLINKER);
    expect(errors.join('\n')).not.toMatch(/FsmBlock/);
  });

  it('reports nothing at all', () => {
    expect(convert(BLINKER).errors).toEqual([]);
  });
});

describe('the machine becomes a register, a sequential block and combinational logic', () => {
  it('declares a state signal wide enough for its states', () => {
    // Three states need two bits.
    const { mod } = convert(BLINKER);
    expect(signal(mod, 'main_state')).toBeDefined();
    expect(signal(mod, 'main_state').dataType.width).toEqual({ kind: 'ConstWidth', value: 2 });
  });

  it('gives the state signal the initial state as its reset value', () => {
    // `initial: Run` is the second state, so code 1 rather than 0.
    const { mod } = convert(BLINKER);
    expect(signal(mod, 'main_state').initialValue.value).toBe(1n);
  });

  it('keeps a signal declared inside the machine', () => {
    const { mod } = convert(BLINKER);
    expect(mod.signals.map((s: { name: string }) => s.name)).toContain('ticks');
  });

  it('produces one sequential block for the transitions', () => {
    const { mod } = convert(BLINKER);
    expect(mod.seqBlocks).toHaveLength(1);
  });

  it('produces a combinational block for the output', () => {
    const { mod } = convert(BLINKER);
    expect(mod.combBlocks.length).toBeGreaterThan(0);
  });

  it('gives the output case a default, so no latch is inferred', () => {
    // Three states in two bits leave 2'b11 uncovered, and `always_comb` on an
    // incomplete case infers a latch. Verilator reports it as CASEINCOMPLETE.
    const { mod } = convert(BLINKER);
    expect(mod.combBlocks[0].statements[0].defaultCase).toBeDefined();
  });
});

describe('the clauses of a state are first-match-wins', () => {
  // This is the one that produced plausible, working, wrong SystemVerilog.
  // With independent ifs, a machine leaving `Run` on `ticks == 3` also ran the
  // `when go` clause and incremented `ticks` on the way out.
  it('nests later clauses in the else branch of earlier ones', () => {
    const { mod } = convert(BLINKER);
    const runArm = arm(mod, 1n);

    expect(runArm.body).toHaveLength(1);
    const outer = runArm.body[0];
    expect(outer.kind).toBe('IfStmt');
    expect(outer.elseBranch).toBeDefined();
    expect(outer.elseBranch[0].kind).toBe('IfStmt');
  });

  it('does not emit the clauses as siblings', () => {
    const { mod } = convert(BLINKER);
    // Two clauses as two statements in a row is exactly the defect.
    expect(arm(mod, 1n).body.length).not.toBe(2);
  });
});

describe('a machine without an initial state resets to its first', () => {
  it('uses state code 0', () => {
    const { mod } = convert(`
mod M(in clk: clock, in rst_n: reset(active_low: true), out y: bit,) {
    fsm m(clk.posedge, rst_n.async) {
        state enum { A, B }
        transitions { A => { when 1 { goto B; } } }
        output y { A => 0, B => 1, }
    }
}
`);
    expect(signal(mod, 'm_state').initialValue.value).toBe(0n);
  });
});
