/**
 * Emitter Tests
 */

import { describe, it, expect } from 'vitest';
import {
  // Emitter
  SvEmitter,
  createEmitter,
  emitModule,
  emitExpr,
  emitStmt,
  emitDataType,
  // Types
  logicType,
  wireType,
  arrayType,
  enumType,
  structType,
  constWidth,
  paramWidth,
  // Expressions
  identifier,
  intLiteral,
  hexLiteral,
  binLiteral,
  stringLiteral,
  binary,
  unary,
  ternary,
  call,
  index,
  slice,
  member,
  concat,
  replicate,
  paren,
  // Statements
  blockingAssign,
  nonBlockingAssign,
  ifStmt,
  caseStmt,
  caseItem,
  forStmt,
  whileStmt,
  returnStmt,
  block,
  varDecl,
  lineComment,
  type SvStmt,
  // Module
  svModule,
  port,
  signal,
  parameter,
  alwaysComb,
  alwaysFf,
  edgeSensitivity,
  instance,
  connection,
  enumDef,
  structDef,
  functionDef,
} from '../index.js';

describe('SvEmitter', () => {
  describe('Data Types', () => {
    it('should emit logic type with width 1', () => {
      expect(emitDataType(logicType(1))).toBe('logic');
    });

    it('should emit logic type with width > 1', () => {
      expect(emitDataType(logicType(8))).toBe('logic [7:0]');
    });

    it('should emit signed logic type', () => {
      expect(emitDataType(logicType(16, true))).toBe('logic signed [15:0]');
    });

    it('should emit wire type', () => {
      expect(emitDataType(wireType(32))).toBe('wire [31:0]');
    });

    it('should emit parameter-based width', () => {
      expect(emitDataType(logicType(paramWidth('WIDTH')))).toBe('logic [WIDTH-1:0]');
    });

    it('should emit enum type', () => {
      expect(emitDataType(enumType('state_t'))).toBe('state_t');
    });

    it('should emit struct type', () => {
      expect(emitDataType(structType('packet_t'))).toBe('packet_t');
    });

    it('should emit array type', () => {
      expect(emitDataType(arrayType(logicType(8), constWidth(16)))).toBe('logic [7:0] [16]');
    });
  });

  describe('Expressions', () => {
    it('should emit identifier', () => {
      expect(emitExpr(identifier('data_in'))).toBe('data_in');
    });

    it('should emit simple integer literal', () => {
      expect(emitExpr(intLiteral(42))).toBe('42');
    });

    it('should emit hex literal with width', () => {
      expect(emitExpr(hexLiteral(0xFF, 8))).toBe("8'hff");
    });

    it('should emit binary literal', () => {
      expect(emitExpr(binLiteral(0b1010, 4))).toBe("4'b1010");
    });

    it('should emit string literal', () => {
      expect(emitExpr(stringLiteral('hello'))).toBe('"hello"');
    });

    it('should emit binary expression', () => {
      expect(emitExpr(binary(identifier('a'), '+', identifier('b')))).toBe('a + b');
    });

    it('should emit unary expression', () => {
      expect(emitExpr(unary('!', identifier('valid')))).toBe('!valid');
      expect(emitExpr(unary('~', identifier('data')))).toBe('~data');
    });

    it('should emit ternary expression', () => {
      expect(emitExpr(ternary(identifier('sel'), identifier('a'), identifier('b')))).toBe('sel ? a : b');
    });

    it('should emit function call', () => {
      expect(emitExpr(call('$clog2', identifier('WIDTH')))).toBe('$clog2(WIDTH)');
    });

    it('should emit index expression', () => {
      expect(emitExpr(index(identifier('data'), intLiteral(0)))).toBe('data[0]');
    });

    it('should emit slice expression', () => {
      expect(emitExpr(slice(identifier('data'), intLiteral(7), intLiteral(0)))).toBe('data[7:0]');
    });

    it('should emit member expression', () => {
      expect(emitExpr(member(identifier('pkt'), 'valid'))).toBe('pkt.valid');
    });

    it('should emit concatenation', () => {
      expect(emitExpr(concat(identifier('a'), identifier('b'), identifier('c')))).toBe('{a, b, c}');
    });

    it('should emit replication', () => {
      expect(emitExpr(replicate(intLiteral(4), identifier('bit')))).toBe('{4{bit}}');
    });

    it('should emit parenthesized expression', () => {
      expect(emitExpr(paren(binary(identifier('a'), '+', identifier('b'))))).toBe('(a + b)');
    });
  });

  describe('Statements', () => {
    it('should emit blocking assignment', () => {
      const stmt = blockingAssign(identifier('a'), identifier('b'));
      expect(emitStmt(stmt).trim()).toBe('a = b;');
    });

    it('should emit non-blocking assignment', () => {
      const stmt = nonBlockingAssign(identifier('q'), identifier('d'));
      expect(emitStmt(stmt).trim()).toBe('q <= d;');
    });

    it('should emit if statement', () => {
      const stmt = ifStmt(
        identifier('valid'),
        blockingAssign(identifier('out'), identifier('data')),
        blockingAssign(identifier('out'), intLiteral(0))
      );
      const output = emitStmt(stmt);
      expect(output).toContain('if (valid)');
      expect(output).toContain('out = data;');
      expect(output).toContain('else');
      expect(output).toContain('out = 0;');
    });

    it('should emit case statement', () => {
      const stmt = caseStmt(
        identifier('state'),
        [
          caseItem(identifier('IDLE'), blockingAssign(identifier('next'), identifier('RUN'))),
          caseItem(identifier('RUN'), blockingAssign(identifier('next'), identifier('DONE'))),
        ],
        blockingAssign(identifier('next'), identifier('IDLE'))
      );
      const output = emitStmt(stmt);
      expect(output).toContain('case (state)');
      expect(output).toContain('IDLE:');
      expect(output).toContain('RUN:');
      expect(output).toContain('default:');
      expect(output).toContain('endcase');
    });

    it('should emit for loop', () => {
      const stmt = forStmt(
        varDecl('i', logicType(32, true), intLiteral(0)),
        binary(identifier('i'), '<', intLiteral(10)),
        blockingAssign(identifier('i'), binary(identifier('i'), '+', intLiteral(1))),
        blockingAssign(index(identifier('arr'), identifier('i')), intLiteral(0))
      );
      const output = emitStmt(stmt);
      expect(output).toContain('for (logic signed [31:0] i = 0; i < 10; i = i + 1)');
    });

    it('should emit while loop', () => {
      const stmt = whileStmt(
        identifier('running'),
        blockingAssign(identifier('count'), binary(identifier('count'), '+', intLiteral(1)))
      );
      const output = emitStmt(stmt);
      expect(output).toContain('while (running)');
    });

    it('should emit return statement', () => {
      const stmt = returnStmt(identifier('result'));
      expect(emitStmt(stmt).trim()).toBe('return result;');
    });

    it('should emit block statement', () => {
      const stmt = block([
        blockingAssign(identifier('a'), intLiteral(1)),
        blockingAssign(identifier('b'), intLiteral(2)),
      ]);
      const output = emitStmt(stmt);
      expect(output).toContain('begin');
      expect(output).toContain('a = 1;');
      expect(output).toContain('b = 2;');
      expect(output).toContain('end');
    });

    it('should emit line comment', () => {
      const stmt = lineComment('This is a comment');
      expect(emitStmt(stmt).trim()).toBe('// This is a comment');
    });
  });

  describe('Module', () => {
    it('should emit empty module', () => {
      const mod = svModule('empty_module');
      const output = emitModule(mod);
      expect(output).toContain('module empty_module;');
      expect(output).toContain('endmodule');
    });

    it('should emit module with ports', () => {
      const mod = svModule('simple_module', [], [
        port('clk', 'input', logicType(1)),
        port('rst_n', 'input', logicType(1)),
        port('data_in', 'input', logicType(8)),
        port('data_out', 'output', logicType(8)),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('module simple_module (');
      expect(output).toContain('input  logic');
      expect(output).toContain('clk');
      expect(output).toContain('rst_n');
      expect(output).toContain('data_in');
      expect(output).toContain('output logic');
      expect(output).toContain('data_out');
      expect(output).toContain('endmodule');
    });

    it('should emit module with parameters', () => {
      const mod = svModule('param_module', [
        parameter('WIDTH', intLiteral(8)),
        parameter('DEPTH', intLiteral(16)),
      ], [
        port('data', 'input', logicType(paramWidth('WIDTH'))),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('#(');
      expect(output).toContain('parameter WIDTH = 8');
      expect(output).toContain('parameter DEPTH = 16');
      expect(output).toContain('logic [WIDTH-1:0]');
    });

    it('should emit module with signals', () => {
      const mod = svModule('signal_module', [], [], [
        signal('internal', logicType(8)),
        signal('counter', logicType(32), intLiteral(0)),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('logic [7:0] internal;');
      expect(output).toContain('logic [31:0] counter = 0;');
    });

    it('should emit always_comb block', () => {
      const mod = svModule('comb_module', [], [], [
        alwaysComb(blockingAssign(identifier('y'), binary(identifier('a'), '&', identifier('b')))),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('always_comb');
      expect(output).toContain('y = a & b;');
    });

    it('should emit always_ff block', () => {
      const mod = svModule('ff_module', [], [], [
        alwaysFf(
          [edgeSensitivity('posedge', 'clk')],
          nonBlockingAssign(identifier('q'), identifier('d'))
        ),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('always_ff @(posedge clk)');
      expect(output).toContain('q <= d;');
    });

    it('should emit always_ff with async reset', () => {
      const mod = svModule('ff_rst_module', [], [], [
        alwaysFf(
          [
            edgeSensitivity('posedge', 'clk'),
            edgeSensitivity('negedge', 'rst_n'),
          ],
          ifStmt(
            unary('!', identifier('rst_n')),
            nonBlockingAssign(identifier('q'), intLiteral(0)),
            nonBlockingAssign(identifier('q'), identifier('d'))
          )
        ),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('always_ff @(posedge clk or negedge rst_n)');
      expect(output).toContain('if (!rst_n)');
      expect(output).toContain('q <= 0;');
    });

    it('should emit module instance', () => {
      const mod = svModule('top_module', [], [], [
        instance('u_sub', 'sub_module', [
          connection('clk', identifier('clk')),
          connection('data', identifier('internal_data')),
        ]),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('sub_module u_sub (');
      expect(output).toContain('.clk(clk)');
      expect(output).toContain('.data(internal_data)');
    });

    it('should emit module instance with parameters', () => {
      const mod = svModule('param_inst_module', [], [], [
        instance('u_fifo', 'fifo', [
          connection('data_in', identifier('din')),
          connection('data_out', identifier('dout')),
        ], [
          connection('WIDTH', intLiteral(32)),
          connection('DEPTH', intLiteral(8)),
        ]),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('fifo #(');
      expect(output).toContain('.WIDTH(32)');
      expect(output).toContain('.DEPTH(8)');
      expect(output).toContain(') u_fifo (');
    });

    it('should emit enum definition', () => {
      const mod = svModule('enum_module', [], [], [
        enumDef('state_t', ['IDLE', 'RUN', 'DONE'], logicType(2)),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('typedef enum logic [1:0] {');
      expect(output).toContain('IDLE');
      expect(output).toContain('RUN');
      expect(output).toContain('DONE');
      expect(output).toContain('} state_t;');
    });

    it('should emit struct definition', () => {
      const mod = svModule('struct_module', [], [], [
        structDef('packet_t', [
          { name: 'valid', dataType: logicType(1) },
          { name: 'data', dataType: logicType(32) },
        ]),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('typedef struct packed {');
      expect(output).toContain('logic valid;');
      expect(output).toContain('logic [31:0] data;');
      expect(output).toContain('} packet_t;');
    });

    it('should emit function definition', () => {
      const mod = svModule('func_module', [], [], [
        functionDef(
          'max',
          logicType(32),
          [
            { name: 'a', dataType: logicType(32), direction: 'input' as const },
            { name: 'b', dataType: logicType(32), direction: 'input' as const },
          ],
          returnStmt(ternary(
            binary(identifier('a'), '>', identifier('b')),
            identifier('a'),
            identifier('b')
          ))
        ),
      ]);
      const output = emitModule(mod);
      expect(output).toContain('function automatic logic [31:0] max(');
      expect(output).toContain('input logic [31:0] a');
      expect(output).toContain('input logic [31:0] b');
      expect(output).toContain('return a > b ? a : b;');
      expect(output).toContain('endfunction');
    });
  });

  describe('Complete Module Example', () => {
    it('should emit a complete counter module', () => {
      const counterModule = svModule(
        'counter',
        [
          parameter('WIDTH', intLiteral(8), logicType(32)),
        ],
        [
          port('clk', 'input', logicType(1)),
          port('rst_n', 'input', logicType(1)),
          port('en', 'input', logicType(1)),
          port('count', 'output', logicType(paramWidth('WIDTH'))),
        ],
        [
          signal('count_reg', logicType(paramWidth('WIDTH'))),
          alwaysFf(
            [
              edgeSensitivity('posedge', 'clk'),
              edgeSensitivity('negedge', 'rst_n'),
            ],
            ifStmt(
              unary('!', identifier('rst_n')),
              nonBlockingAssign(identifier('count_reg'), intLiteral(0)),
              ifStmt(
                identifier('en'),
                nonBlockingAssign(
                  identifier('count_reg'),
                  binary(identifier('count_reg'), '+', intLiteral(1))
                )
              )
            )
          ),
          alwaysComb(
            blockingAssign(identifier('count'), identifier('count_reg'))
          ),
        ]
      );

      const output = emitModule(counterModule);

      // Verify structure
      expect(output).toContain('module counter #(');
      expect(output).toContain('parameter logic [31:0] WIDTH = 8');
      expect(output).toContain(') (');
      expect(output).toContain('input  logic');
      expect(output).toContain('output logic [WIDTH-1:0] count');
      expect(output).toContain('logic [WIDTH-1:0] count_reg;');
      expect(output).toContain('always_ff @(posedge clk or negedge rst_n)');
      expect(output).toContain('always_comb');
      expect(output).toContain('endmodule');
    });
  });

  describe('Emitter Options', () => {
    it('should respect indent option', () => {
      const emitter = createEmitter({ indent: '    ' });  // 4 spaces
      const mod = svModule('test', [], [
        port('a', 'input', logicType(1)),
      ]);
      const output = emitter.emitModule(mod);
      expect(output).toContain('    input');  // 4 spaces
    });

    it('should use default options', () => {
      const emitter = new SvEmitter();
      const output = emitter.emitExpr(identifier('test'));
      expect(output).toBe('test');
    });
  });

  describe('Time Control Statements', () => {
    it('should emit delay statement', () => {
      const stmt: SvStmt = { kind: 'SvDelayStmt', delay: 10, unit: 'ns' };
      const output = emitStmt(stmt);
      expect(output).toContain('#10ns;');
    });

    it('should emit delay statement with different units', () => {
      const stmtUs: SvStmt = { kind: 'SvDelayStmt', delay: 100, unit: 'us' };
      expect(emitStmt(stmtUs)).toContain('#100us;');

      const stmtMs: SvStmt = { kind: 'SvDelayStmt', delay: 1, unit: 'ms' };
      expect(emitStmt(stmtMs)).toContain('#1ms;');

      const stmtPs: SvStmt = { kind: 'SvDelayStmt', delay: 50, unit: 'ps' };
      expect(emitStmt(stmtPs)).toContain('#50ps;');
    });

    it('should emit event control with posedge', () => {
      const stmt: SvStmt = { kind: 'SvEventControlStmt', edge: 'posedge', signal: 'clk' };
      const output = emitStmt(stmt);
      expect(output).toContain('@(posedge clk);');
    });

    it('should emit event control with negedge', () => {
      const stmt: SvStmt = { kind: 'SvEventControlStmt', edge: 'negedge', signal: 'rst_n' };
      const output = emitStmt(stmt);
      expect(output).toContain('@(negedge rst_n);');
    });

    it('should emit event control without edge', () => {
      const stmt: SvStmt = { kind: 'SvEventControlStmt', edge: undefined, signal: 'event_sig' };
      const output = emitStmt(stmt);
      expect(output).toContain('@(event_sig);');
    });

    it('should emit wait statement', () => {
      const stmt: SvStmt = { kind: 'SvWaitStmt', condition: identifier('done') };
      const output = emitStmt(stmt);
      expect(output).toContain('wait(done);');
    });

    it('should emit wait statement with complex condition', () => {
      const stmt: SvStmt = {
        kind: 'SvWaitStmt',
        condition: binary(identifier('count'), '==', intLiteral(10)),
      };
      const output = emitStmt(stmt);
      expect(output).toContain('wait(count == 10);');
    });
  });
});
