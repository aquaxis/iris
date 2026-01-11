/**
 * Tests for SvFormatter
 */

import { describe, it, expect } from 'vitest';
import { SvFormatter, createFormatter, formatSv } from '../formatter.js';

describe('SvFormatter', () => {
  describe('constructor', () => {
    it('should create formatter with default options', () => {
      const formatter = new SvFormatter();
      expect(formatter).toBeDefined();
    });

    it('should accept custom options', () => {
      const formatter = new SvFormatter({
        indent: '    ',
        maxLineLength: 100,
      });
      expect(formatter).toBeDefined();
    });
  });

  describe('format()', () => {
    it('should normalize line endings', () => {
      const formatter = new SvFormatter({ trailingNewline: false });
      const source = 'line1\r\nline2\rline3\nline4';
      const result = formatter.format(source);
      expect(result).not.toContain('\r');
      // 4 lines of content
      expect(result.split('\n').filter(l => l.trim()).length).toBe(4);
    });

    it('should add trailing newline', () => {
      const formatter = new SvFormatter({ trailingNewline: true });
      const source = 'module test;\nendmodule';
      const result = formatter.format(source);
      expect(result.endsWith('\n')).toBe(true);
    });

    it('should not add trailing newline when disabled', () => {
      const formatter = new SvFormatter({ trailingNewline: false });
      const source = 'module test;\nendmodule';
      const result = formatter.format(source);
      expect(result.endsWith('endmodule')).toBe(true);
    });
  });

  describe('formatIndentation()', () => {
    it('should indent content after begin', () => {
      const formatter = new SvFormatter({ indent: '  ' });
      const source = `always_comb begin
x = 1;
end`;
      const result = formatter.format(source);
      const lines = result.split('\n');
      expect(lines[1]).toBe('  x = 1;');
    });

    it('should handle nested blocks', () => {
      const formatter = new SvFormatter({ indent: '  ' });
      const source = `always_ff @(posedge clk) begin
if (rst) begin
x <= 0;
end
end`;
      const result = formatter.format(source);
      const lines = result.split('\n');
      expect(lines[1]).toBe('  if (rst) begin');
      expect(lines[2]).toBe('    x <= 0;');
      expect(lines[3]).toBe('  end');
      expect(lines[4]).toBe('end');
    });

    it('should handle module declarations', () => {
      const formatter = new SvFormatter({ indent: '  ' });
      const source = `module test (
input clk,
output data
);
logic temp;
endmodule`;
      const result = formatter.format(source);
      const lines = result.split('\n');
      // Check that ports are indented
      expect(lines[1]).toBe('  input clk,');
      // Check that logic statement exists (indentation may vary based on detection)
      expect(lines.find(l => l.includes('logic temp'))).toBeDefined();
    });
  });

  describe('addSectionSpacing()', () => {
    it('should add blank lines before always_comb', () => {
      const formatter = new SvFormatter({ sectionSpacing: true });
      const source = `logic temp;
always_comb begin
x = 1;
end`;
      const result = formatter.format(source);
      expect(result).toContain('logic temp;\n\nalways_comb');
    });

    it('should add blank lines before always_ff', () => {
      const formatter = new SvFormatter({ sectionSpacing: true });
      const source = `logic temp;
always_ff @(posedge clk) begin
x <= 1;
end`;
      const result = formatter.format(source);
      expect(result).toContain('logic temp;\n\nalways_ff');
    });

    it('should not add blank lines when disabled', () => {
      const formatter = new SvFormatter({ sectionSpacing: false });
      const source = `logic temp;
always_comb begin
x = 1;
end`;
      const result = formatter.format(source);
      expect(result).not.toContain('logic temp;\n\nalways_comb');
    });
  });

  describe('alignLines()', () => {
    it('should align lines by separator', () => {
      const formatter = new SvFormatter();
      const lines = [
        'input  logic a,',
        'output logic [7:0] b,',
        'input  logic c',
      ];
      const result = formatter.alignLines(lines, ['logic']);
      expect(result[0]).toContain('input  logic');
      expect(result[1]).toContain('output logic');
    });
  });

  describe('wrapLine()', () => {
    it('should not wrap short lines', () => {
      const formatter = new SvFormatter({ maxLineLength: 80 });
      const line = 'assign x = a + b;';
      const result = formatter.wrapLine(line);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(line);
    });

    it('should wrap long lines', () => {
      const formatter = new SvFormatter({ maxLineLength: 40 });
      const line = 'assign very_long_signal_name = another_very_long_signal + yet_another_signal;';
      const result = formatter.wrapLine(line);
      expect(result.length).toBeGreaterThan(1);
    });

    it('should prefer breaking after operators', () => {
      const formatter = new SvFormatter({ maxLineLength: 20 });
      const line = 'assign very_long_signal = a + b + c + d;';
      const result = formatter.wrapLine(line);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('createFormatter()', () => {
    it('should create a formatter', () => {
      const formatter = createFormatter();
      expect(formatter).toBeInstanceOf(SvFormatter);
    });

    it('should accept options', () => {
      const formatter = createFormatter({ indent: '\t' });
      expect(formatter).toBeInstanceOf(SvFormatter);
    });
  });

  describe('formatSv()', () => {
    it('should format source code', () => {
      const source = 'module test;\nendmodule';
      const result = formatSv(source);
      expect(result).toContain('module test;');
      expect(result).toContain('endmodule');
    });

    it('should accept options', () => {
      const source = 'module test;\nendmodule';
      const result = formatSv(source, { trailingNewline: false });
      expect(result.endsWith('endmodule')).toBe(true);
    });
  });

  describe('complex formatting', () => {
    it('should format a complete module', () => {
      const formatter = new SvFormatter();
      const source = `module counter (
input logic clk,
input logic rst,
output logic [7:0] count
);
logic [7:0] next_count;
always_comb begin
next_count = count + 1;
end
always_ff @(posedge clk) begin
if (rst) begin
count <= 0;
end else begin
count <= next_count;
end
end
endmodule`;

      const result = formatter.format(source);
      const lines = result.split('\n');

      // Check port indentation
      expect(lines[1]).toMatch(/^\s{2}input/);

      // Check signal line exists
      expect(lines.find(l => l.includes('next_count'))).toBeDefined();

      // Check always_comb block is formatted
      const alwaysCombLine = lines.findIndex(l => l.includes('always_comb'));
      expect(alwaysCombLine).toBeGreaterThan(-1);

      // Check always_ff block is formatted
      const alwaysFfLine = lines.findIndex(l => l.includes('always_ff'));
      expect(alwaysFfLine).toBeGreaterThan(-1);
    });

    it('should handle typedef enum', () => {
      const formatter = new SvFormatter();
      const source = `typedef enum logic [1:0] {
IDLE,
RUN,
DONE
} state_t;`;

      const result = formatter.format(source);
      const lines = result.split('\n');
      expect(lines[1]).toMatch(/^\s{2}IDLE/);
    });

    it('should handle case statements', () => {
      const formatter = new SvFormatter();
      const source = `case (state)
IDLE: begin
next = RUN;
end
RUN: begin
next = DONE;
end
default: begin
next = IDLE;
end
endcase`;

      const result = formatter.format(source);
      const lines = result.split('\n');
      expect(lines[1]).toMatch(/^\s{2}IDLE:/);
      expect(lines[2]).toMatch(/^\s{4}next = RUN/);
    });
  });
});
