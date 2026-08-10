/**
 * sv2iris shipped with no tests at all, so nothing recorded what it was
 * supposed to produce. Every case below is a defect it had: output that no
 * IRIS front-end could parse, and a reset branch that disappeared while the
 * run reported success.
 *
 * The oracle is the reference grammar in `sim/iris-sim/src/parser/iris.pest`,
 * not this package's own idea of IRIS.
 */

import { describe, it, expect } from 'vitest';
import { Lexer } from '../lexer/index.js';
import { Parser } from '../parser/index.js';
import { Transformer } from '../transformer/index.js';
import { Generator } from '../generator/index.js';
import { ErrorReporter } from '../errors/index.js';

interface Result {
  output: string;
  errors: string[];
}

/** Run the whole pipeline the way the CLI does, sharing one reporter. */
function transpile(source: string): Result {
  const reporter = new ErrorReporter();
  const tokens = new Lexer(source, 'test.sv', reporter).tokenize();
  if (reporter.hasErrors()) {
    return { output: '', errors: reporter.getErrors().map((e) => e.message) };
  }

  const svAst = new Parser(tokens, reporter).parse();
  if (reporter.hasErrors()) {
    return { output: '', errors: reporter.getErrors().map((e) => e.message) };
  }

  const irAst = new Transformer(reporter).transform(svAst);
  const errors = reporter.getErrors().map((e) => e.message);
  return { output: new Generator().generate(irAst), errors };
}

const COUNTER = `
module counter (
    input  logic clk,
    input  logic rst_n,
    input  logic en,
    output logic [7:0] count
);
    logic [7:0] counter;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) counter <= 8'd5;
        else if (en) counter <= counter + 8'd1;
    end
    assign count = counter;
endmodule
`;

describe('a reset value is carried over, never dropped', () => {
  // The reset branch used to be deleted outright: the sync block kept only the
  // else branch and nothing put the reset value anywhere. The transpiler then
  // reported success, so the loss was invisible.
  it('becomes the initial value of the declaration', () => {
    const { output } = transpile(COUNTER);
    expect(output).toMatch(/var counter: bit\[8\] = 8'd5;/);
  });

  it('makes the signal mutable, since a clock edge writes it', () => {
    const { output } = transpile(COUNTER);
    expect(output).not.toMatch(/let counter/);
  });

  it('leaves the reset out of the sync block body', () => {
    const { output } = transpile(COUNTER);
    const sync = output.slice(output.indexOf('sync('));
    expect(sync).not.toContain('rst_n)');
  });

  it('reports a reset it cannot place instead of dropping it', () => {
    // An IRIS port carries no initial value, so a reset written straight to an
    // output port has nowhere to go. Saying so is the only honest answer.
    const { errors } = transpile(`
module direct (
    input  logic clk,
    input  logic rst_n,
    output logic [7:0] count
);
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) count <= 8'd0;
        else count <= count + 8'd1;
    end
endmodule
`);
    expect(errors.join('\n')).toMatch(/reset value for 'count'/);
  });
});

describe('literals are spelled the way IRIS spells them', () => {
  // sized_literal = integer ~ "'" ~ (bin_literal | hex_literal | dec_literal)
  // The old output was `8d_1`, which is not a literal in any language here.
  const cases: Array<[string, RegExp]> = [
    ["8'd1", /8'd1/],
    ["8'hFF", /8'hFF/],
    ["4'b1010", /4'b1010/],
  ];

  for (const [literal, expected] of cases) {
    it(literal, () => {
      const { output } = transpile(`
module lit (input logic clk, output logic [7:0] y);
    logic [7:0] r;
    always_ff @(posedge clk) r <= ${literal};
    assign y = r;
endmodule
`);
      expect(output).toMatch(expected);
      expect(output).not.toMatch(/\d+[dhb]_/);
    });
  }
});

describe('a packed range becomes a width', () => {
  // `[7:0]` came out as `bit[7 + 1]` — right, but written the long way.
  it('folds a constant range', () => {
    const { output } = transpile(COUNTER);
    expect(output).toContain('bit[8]');
    expect(output).not.toContain('7 + 1');
  });

  it('folds a range written as N-1', () => {
    const { output } = transpile(`
module r (input logic clk, output logic [16-1:0] y);
    logic [16-1:0] q;
    always_ff @(posedge clk) q <= 16'd0;
    assign y = q;
endmodule
`);
    expect(output).toContain('bit[16]');
  });

  it('leaves a parameterised range as an expression', () => {
    const { output } = transpile(`
module p #(parameter W = 8) (input logic clk, output logic [W-1:0] y);
    logic [W-1:0] q;
    always_ff @(posedge clk) q <= 0;
    assign y = q;
endmodule
`);
    expect(output).toMatch(/bit\[W/);
  });
});

describe('a clocked signal is typed as a clock', () => {
  it('the edge a sync block runs on', () => {
    const { output } = transpile(COUNTER);
    expect(output).toContain('in clk: clock');
  });

  it('an active-low reset keeps its own type', () => {
    const { output } = transpile(COUNTER);
    expect(output).toContain('in rst_n: reset(active_low: true)');
  });

  it('an ordinary input stays a bit', () => {
    const { output } = transpile(COUNTER);
    expect(output).toContain('in en: bit');
  });
});

describe('size casts are accepted and converted', () => {
  // iris2sv emits `8'(x)` for every width conversion, so refusing these meant
  // the two transpilers could not be chained on any design at all.
  it('a literal width', () => {
    const { output, errors } = transpile(`
module c (input logic clk, input logic [7:0] a, output logic [7:0] y);
    logic [7:0] q;
    always_ff @(posedge clk) q <= 8'(a + 1);
    assign y = q;
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toContain('.truncate[8]()');
  });

  it('a parameter width', () => {
    const { output, errors } = transpile(`
module c #(parameter W = 8) (input logic clk, input logic [W-1:0] a, output logic [W-1:0] y);
    logic [W-1:0] q;
    always_ff @(posedge clk) q <= W'(a + 1);
    assign y = q;
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toContain('.truncate[W]()');
  });

  it('never emits an `as` cast, which IRIS has no operator for', () => {
    const { output } = transpile(`
module c (input logic clk, input logic [7:0] a, output logic [7:0] y);
    logic [7:0] q;
    always_ff @(posedge clk) q <= 8'(a);
    assign y = q;
endmodule
`);
    expect(output).not.toMatch(/\bas\s+bit/);
  });
});

describe('unsupported input is reported, not silently dropped', () => {
  it('an error in the transformer reaches the caller', () => {
    // The CLI used to give the transformer a private reporter that nobody
    // read, so everything it raised was discarded.
    const { errors } = transpile(`
module direct (
    input  logic clk,
    input  logic rst_n,
    output logic [7:0] count
);
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) count <= 8'd0;
        else count <= count + 8'd1;
    end
endmodule
`);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('a clean design reports nothing', () => {
    expect(transpile(COUNTER).errors).toEqual([]);
  });
});

describe('a bit slice keeps its bounds in the order they were written', () => {
  // `a[11:4]` came out as `a[4:11]`. Both parse and both simulate; on
  // 16'hABCD the first is 0xBC and the second is 0x01. Nothing reported it.
  it('high bound first', () => {
    const { output } = transpile(`
module sl (input logic [15:0] a, output logic [7:0] y);
  assign y = a[11:4];
endmodule
`);
    expect(output).toContain('a[11:4]');
    expect(output).not.toContain('a[4:11]');
  });

  it('a parameterised range too', () => {
    const { output } = transpile(`
module sl #(parameter W = 8) (input logic [15:0] a, output logic [7:0] y);
  assign y = a[W-1:0];
endmodule
`);
    expect(output).toMatch(/a\[W - 1:0\]/);
  });
});

describe('an instance is written the way IRIS writes one', () => {
  const source = `
module sub (input logic a, output logic y);
  assign y = a;
endmodule
module top (input logic a, output logic y);
  sub u0 (.a(a), .y(y));
endmodule
`;

  it('uses inst and =', () => {
    expect(transpile(source).output).toMatch(/inst\s+u0\s*=\s*sub\s*\{/);
  });

  it('connects ports with a colon', () => {
    const { output } = transpile(source);
    expect(output).toContain('a: a');
    expect(output).not.toContain('.a(a)');
  });
});

describe('signed and unsigned become methods', () => {
  // `$signed` is a SystemVerilog system function. IRIS has no such function,
  // so passing the name through produced something that parsed and then failed
  // to evaluate.
  it('$signed', () => {
    const { output } = transpile(`
module s (input logic [11:0] a, output logic [11:0] y);
  assign y = $signed(a);
endmodule
`);
    expect(output).toContain('a.signed()');
    expect(output).not.toContain('$signed');
  });

  it('$unsigned', () => {
    const { output } = transpile(`
module s (input logic [11:0] a, output logic [11:0] y);
  assign y = $unsigned(a);
endmodule
`);
    expect(output).toContain('a.unsigned()');
  });
});

describe('a case without a default still converts to an exhaustive match', () => {
  // SystemVerilog lets a case miss values, and whatever it misses holds. An
  // IRIS match must cover everything, so the same meaning needs a wildcard.
  it('adds a wildcard arm', () => {
    const { output } = transpile(`
module c (input logic clk, input logic [1:0] s, output logic [7:0] y);
  logic [7:0] r;
  always_ff @(posedge clk) begin
    case (s)
      2'd0: r <= 8'd1;
      2'd1: r <= 8'd2;
    endcase
  end
  assign y = r;
endmodule
`);
    expect(output).toMatch(/_\s*=>/);
  });
});

describe('declarations outside a module are converted', () => {
  // Only modules were accepted at the top level, so a file opening with a
  // typedef was rejected outright — including the files iris2sv now writes.
  it('typedef enum becomes an enum', () => {
    const { output, errors } = transpile(`
typedef enum logic [1:0] { Add = 0, Sub = 1 } Op;
module m (input logic clk, output logic y);
  assign y = 0;
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toMatch(/enum Op/);
  });

  it('typedef struct becomes a struct', () => {
    const { output, errors } = transpile(`
typedef struct packed { logic valid; logic [7:0] data; } Packet;
module m (input logic clk, output logic y);
  assign y = 0;
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toMatch(/struct Packet/);
  });

  it('a function becomes an fn', () => {
    const { output, errors } = transpile(`
function automatic logic [7:0] add(input logic [7:0] a, input logic [7:0] b);
  return a + b;
endfunction
module m (input logic clk, output logic [7:0] y);
  assign y = add(8'd1, 8'd2);
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toMatch(/fn add\(a: bit\[8\], b: bit\[8\]\) -> bit\[8\]/);
    expect(output).toContain('return');
  });
});

describe('a part select keeps its operator', () => {
  // `a[i +: 8]` selects a window whose position varies. Read as `+` then `:`,
  // the expression parser took the plus as addition and stopped at the colon.
  it('upward', () => {
    const { output, errors } = transpile(`
module p (input logic [31:0] a, input logic [4:0] i, output logic [7:0] y);
  assign y = a[i +: 8];
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toContain('a[i +: 8]');
  });

  it('downward', () => {
    const { output } = transpile(`
module p (input logic [31:0] a, input logic [4:0] i, output logic [7:0] y);
  assign y = a[i -: 8];
endmodule
`);
    expect(output).toContain('a[i -: 8]');
  });
});

describe('a signal of a user-defined type is a declaration, not an instance', () => {
  // Every identifier at the head of a module item was read as a module
  // instantiation, so `Op op = Add;` was rejected — and iris2sv writes exactly
  // that for any signal whose type is an enum.
  const source = `
typedef enum logic [1:0] { Add = 0, Sub = 1 } Op;
module m (input logic clk, output logic [7:0] y);
  Op op = Add;
  assign y = op == Add ? 8'd1 : 8'd2;
endmodule
`;

  it('parses without error', () => {
    expect(transpile(source).errors).toEqual([]);
  });

  it('names the enum member through its enum', () => {
    // IRIS reaches a member through its enum; the bare name is an undefined
    // signal there.
    const { output } = transpile(source);
    expect(output).toContain('Op::Add');
  });

  it('still treats a real instantiation as one', () => {
    const { output } = transpile(`
module sub (input logic a, output logic y);
  assign y = a;
endmodule
module top (input logic a, output logic y);
  sub u0 (.a(a), .y(y));
endmodule
`);
    expect(output).toMatch(/inst\s+u0\s*=\s*sub/);
  });
});

describe('a typedef union converts to an IRIS union', () => {
  // iris2sv emits `typedef union packed` for an IRIS `union`, and only enum
  // and struct were recognised here, so the chain broke on any design with one.
  it('parses and keeps its members', () => {
    const { output, errors } = transpile(`
typedef union packed { logic [31:0] raw; logic [15:0] half; } Word;
module m (input logic clk, output logic y);
  assign y = 0;
endmodule
`);
    expect(errors).toEqual([]);
    expect(output).toMatch(/union Word \{/);
    expect(output).toContain('raw: bit[32],');
    expect(output).toContain('half: bit[16],');
  });

  it('is not turned into a struct', () => {
    const { output } = transpile(`
typedef union packed { logic [31:0] raw; } Word;
module m (input logic clk, output logic y);
  assign y = 0;
endmodule
`);
    expect(output).not.toMatch(/struct Word/);
  });
});
