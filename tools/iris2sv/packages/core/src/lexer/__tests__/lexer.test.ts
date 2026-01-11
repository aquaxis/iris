import { describe, it, expect } from 'vitest';
import { Lexer, tokenize, tokenizeWithoutTrivia } from '../lexer.js';
import { TokenKind } from '../token.js';

describe('Lexer', () => {
  describe('basic tokens', () => {
    it('should tokenize empty input', () => {
      const result = tokenize('');
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0].kind).toBe(TokenKind.Eof);
      expect(result.errors).toHaveLength(0);
    });

    it('should tokenize whitespace', () => {
      const result = tokenize('  \t\n  ');
      expect(result.tokens).toHaveLength(2);
      expect(result.tokens[0].kind).toBe(TokenKind.Whitespace);
      expect(result.tokens[1].kind).toBe(TokenKind.Eof);
    });

    it('should tokenize identifiers', () => {
      const result = tokenizeWithoutTrivia('foo bar_baz _test abc123');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Identifier,
        TokenKind.Identifier,
        TokenKind.Identifier,
        TokenKind.Identifier,
        TokenKind.Eof,
      ]);
      expect(result.tokens[0].text).toBe('foo');
      expect(result.tokens[1].text).toBe('bar_baz');
      expect(result.tokens[2].text).toBe('_test');
      expect(result.tokens[3].text).toBe('abc123');
    });
  });

  describe('keywords', () => {
    it('should tokenize module keywords', () => {
      const result = tokenizeWithoutTrivia('mod pub fn interface package import');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Mod,
        TokenKind.Pub,
        TokenKind.Fn,
        TokenKind.Interface,
        TokenKind.Package,
        TokenKind.Import,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize type keywords', () => {
      const result = tokenizeWithoutTrivia('type struct enum bit int uint bool clock reset string');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Type,
        TokenKind.Struct,
        TokenKind.Enum,
        TokenKind.Bit,
        TokenKind.Int,
        TokenKind.Uint,
        TokenKind.Bool,
        TokenKind.Clock,
        TokenKind.Reset,
        TokenKind.String,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize declaration keywords', () => {
      const result = tokenizeWithoutTrivia('let var mut const');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Let,
        TokenKind.Var,
        TokenKind.Mut,
        TokenKind.Const,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize control flow keywords', () => {
      const result = tokenizeWithoutTrivia('if else match for while return in');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.If,
        TokenKind.Else,
        TokenKind.Match,
        TokenKind.For,
        TokenKind.While,
        TokenKind.Return,
        TokenKind.In,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize logic block keywords', () => {
      const result = tokenizeWithoutTrivia('comb sync fsm state transitions when goto output');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Comb,
        TokenKind.Sync,
        TokenKind.Fsm,
        TokenKind.State,
        TokenKind.Transitions,
        TokenKind.When,
        TokenKind.Goto,
        TokenKind.Output,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize clock/reset keywords', () => {
      const result = tokenizeWithoutTrivia('posedge negedge async');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Posedge,
        TokenKind.Negedge,
        TokenKind.Async,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize port direction keywords', () => {
      const result = tokenizeWithoutTrivia('in out inout initiator target monitor');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.In,
        TokenKind.Out,
        TokenKind.Inout,
        TokenKind.Initiator,
        TokenKind.Target,
        TokenKind.Monitor,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize boolean literals', () => {
      const result = tokenizeWithoutTrivia('true false');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.True,
        TokenKind.False,
        TokenKind.Eof,
      ]);
    });
  });

  describe('operators', () => {
    it('should tokenize arithmetic operators', () => {
      const result = tokenizeWithoutTrivia('+ - * / % **');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Plus,
        TokenKind.Minus,
        TokenKind.Star,
        TokenKind.Slash,
        TokenKind.Percent,
        TokenKind.StarStar,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize bitwise operators', () => {
      const result = tokenizeWithoutTrivia('& | ^ ~ << >> >>>');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Amp,
        TokenKind.Pipe,
        TokenKind.Caret,
        TokenKind.Tilde,
        TokenKind.LtLt,
        TokenKind.GtGt,
        TokenKind.GtGtGt,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize comparison operators', () => {
      const result = tokenizeWithoutTrivia('== != < <= > >=');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.EqEq,
        TokenKind.BangEq,
        TokenKind.Lt,
        TokenKind.LtEq,
        TokenKind.Gt,
        TokenKind.GtEq,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize logical operators', () => {
      const result = tokenizeWithoutTrivia('&& || !');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.AmpAmp,
        TokenKind.PipePipe,
        TokenKind.Bang,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize assignment operator', () => {
      const result = tokenizeWithoutTrivia('=');
      expect(result.tokens.map((t) => t.kind)).toEqual([TokenKind.Eq, TokenKind.Eof]);
    });
  });

  describe('delimiters', () => {
    it('should tokenize brackets', () => {
      const result = tokenizeWithoutTrivia('( ) [ ] { }');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.LParen,
        TokenKind.RParen,
        TokenKind.LBracket,
        TokenKind.RBracket,
        TokenKind.LBrace,
        TokenKind.RBrace,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize punctuation', () => {
      const result = tokenizeWithoutTrivia(': ; , . :: => -> .. ..=');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Colon,
        TokenKind.Semi,
        TokenKind.Comma,
        TokenKind.Dot,
        TokenKind.ColonColon,
        TokenKind.FatArrow,
        TokenKind.Arrow,
        TokenKind.DotDot,
        TokenKind.DotDotEq,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize attribute marker', () => {
      const result = tokenizeWithoutTrivia('#[test]');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.HashLBracket,
        TokenKind.Test,
        TokenKind.RBracket,
        TokenKind.Eof,
      ]);
    });

    it('should tokenize underscore as wildcard', () => {
      const result = tokenizeWithoutTrivia('_');
      expect(result.tokens[0].kind).toBe(TokenKind.Underscore);
    });
  });

  describe('literals', () => {
    it('should tokenize decimal integers', () => {
      const result = tokenizeWithoutTrivia('0 42 123456');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.IntegerLiteral,
        TokenKind.IntegerLiteral,
        TokenKind.IntegerLiteral,
        TokenKind.Eof,
      ]);
      expect(result.tokens[0].text).toBe('0');
      expect(result.tokens[1].text).toBe('42');
      expect(result.tokens[2].text).toBe('123456');
    });

    it('should tokenize sized binary literals', () => {
      const result = tokenizeWithoutTrivia("8'b1010_1100");
      expect(result.tokens[0].kind).toBe(TokenKind.IntegerLiteral);
      expect(result.tokens[0].text).toBe("8'b1010_1100");
    });

    it('should tokenize sized hex literals', () => {
      const result = tokenizeWithoutTrivia("32'hDEAD_BEEF");
      expect(result.tokens[0].kind).toBe(TokenKind.IntegerLiteral);
      expect(result.tokens[0].text).toBe("32'hDEAD_BEEF");
    });

    it('should tokenize sized octal literals', () => {
      const result = tokenizeWithoutTrivia("12'o7654");
      expect(result.tokens[0].kind).toBe(TokenKind.IntegerLiteral);
      expect(result.tokens[0].text).toBe("12'o7654");
    });

    it('should tokenize sized decimal literals', () => {
      const result = tokenizeWithoutTrivia("16'd1234");
      expect(result.tokens[0].kind).toBe(TokenKind.IntegerLiteral);
      expect(result.tokens[0].text).toBe("16'd1234");
    });

    it('should tokenize string literals', () => {
      const result = tokenizeWithoutTrivia('"hello world"');
      expect(result.tokens[0].kind).toBe(TokenKind.StringLiteral);
      expect(result.tokens[0].text).toBe('"hello world"');
    });

    it('should tokenize string with escape sequences', () => {
      const result = tokenizeWithoutTrivia('"hello\\nworld\\t\\"test\\""');
      expect(result.tokens[0].kind).toBe(TokenKind.StringLiteral);
    });
  });

  describe('comments', () => {
    it('should tokenize line comments', () => {
      const result = tokenize('// this is a comment\nfoo');
      expect(result.tokens[0].kind).toBe(TokenKind.LineComment);
      expect(result.tokens[0].text).toBe('// this is a comment');
    });

    it('should tokenize block comments', () => {
      const result = tokenize('/* block comment */ foo');
      expect(result.tokens[0].kind).toBe(TokenKind.BlockComment);
      expect(result.tokens[0].text).toBe('/* block comment */');
    });

    it('should tokenize nested block comments', () => {
      const result = tokenize('/* outer /* inner */ outer */ foo');
      expect(result.tokens[0].kind).toBe(TokenKind.BlockComment);
      expect(result.tokens[0].text).toBe('/* outer /* inner */ outer */');
    });

    it('should filter out comments with tokenizeWithoutTrivia', () => {
      const result = tokenizeWithoutTrivia('// comment\nfoo /* block */ bar');
      expect(result.tokens.map((t) => t.kind)).toEqual([
        TokenKind.Identifier,
        TokenKind.Identifier,
        TokenKind.Eof,
      ]);
    });
  });

  describe('source location tracking', () => {
    it('should track line and column numbers', () => {
      const result = tokenizeWithoutTrivia('foo\nbar\n  baz');
      expect(result.tokens[0].span.startLine).toBe(1);
      expect(result.tokens[0].span.startColumn).toBe(1);
      expect(result.tokens[1].span.startLine).toBe(2);
      expect(result.tokens[1].span.startColumn).toBe(1);
      expect(result.tokens[2].span.startLine).toBe(3);
      expect(result.tokens[2].span.startColumn).toBe(3);
    });

    it('should track byte offsets', () => {
      const result = tokenizeWithoutTrivia('abc def');
      expect(result.tokens[0].span.start).toBe(0);
      expect(result.tokens[0].span.end).toBe(3);
      expect(result.tokens[1].span.start).toBe(4);
      expect(result.tokens[1].span.end).toBe(7);
    });
  });

  describe('error handling', () => {
    it('should handle unexpected characters', () => {
      const result = tokenize('foo @ bar');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Unexpected character');
    });

    it('should recover after error', () => {
      const result = tokenizeWithoutTrivia('foo @ bar');
      const identifiers = result.tokens.filter((t) => t.kind === TokenKind.Identifier);
      expect(identifiers).toHaveLength(2);
    });

    it('should handle unterminated string', () => {
      const result = tokenize('"hello');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Unterminated string');
    });

    it('should handle unterminated block comment', () => {
      const result = tokenize('/* incomplete');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Unterminated block comment');
    });
  });

  describe('complex examples', () => {
    it('should tokenize a simple module definition', () => {
      const source = `
        mod counter(
          in clk: clock,
          in rst: reset,
          out count: uint[8]
        ) {
          let mut value: uint[8] = 0;
          sync(clk.posedge, rst.async) {
            value = value + 1;
          }
        }
      `;
      const result = tokenizeWithoutTrivia(source);
      expect(result.errors).toHaveLength(0);
      expect(result.tokens.find((t) => t.kind === TokenKind.Mod)).toBeDefined();
      expect(result.tokens.find((t) => t.kind === TokenKind.Sync)).toBeDefined();
    });

    it('should tokenize an FSM block', () => {
      const source = `
        fsm traffic(clk.posedge, rst.async) {
          state enum { Red, Yellow, Green }
          transitions {
            Red => { when timer_done { goto Green; } }
            Green => { when timer_done { goto Yellow; } }
            Yellow => { when timer_done { goto Red; } }
          }
        }
      `;
      const result = tokenizeWithoutTrivia(source);
      expect(result.errors).toHaveLength(0);
      expect(result.tokens.find((t) => t.kind === TokenKind.Fsm)).toBeDefined();
      expect(result.tokens.find((t) => t.kind === TokenKind.State)).toBeDefined();
      expect(result.tokens.find((t) => t.kind === TokenKind.Transitions)).toBeDefined();
    });

    it('should tokenize import declarations', () => {
      const source = 'import std::logic::{And, Or, Xor};';
      const result = tokenizeWithoutTrivia(source);
      expect(result.errors).toHaveLength(0);
      expect(result.tokens.filter((t) => t.kind === TokenKind.ColonColon)).toHaveLength(2);
    });
  });
});
