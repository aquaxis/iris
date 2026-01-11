import type { Token, Trivia, SourceLocation, SourceSpan } from './token.js';
import { TokenKind } from './token.js';

/**
 * Lexer error information
 */
export interface LexerError {
  message: string;
  span: SourceSpan;
}

/**
 * Lexer result
 */
export interface LexerResult {
  tokens: Token[];
  errors: LexerError[];
}

/**
 * IRIS Language Lexer
 * Converts source code into a stream of tokens
 */
export class Lexer {
  private readonly source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly errors: LexerError[] = [];

  private static readonly KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
    ['mod', TokenKind.Mod],
    ['pub', TokenKind.Pub],
    ['let', TokenKind.Let],
    ['var', TokenKind.Var],
    ['const', TokenKind.Const],
    ['fn', TokenKind.Fn],
    ['if', TokenKind.If],
    ['else', TokenKind.Else],
    ['match', TokenKind.Match],
    ['for', TokenKind.For],
    ['while', TokenKind.While],
    ['return', TokenKind.Return],
    ['type', TokenKind.Type],
    ['struct', TokenKind.Struct],
    ['enum', TokenKind.Enum],
    ['interface', TokenKind.Interface],
    ['import', TokenKind.Import],
    ['package', TokenKind.Package],
    ['comb', TokenKind.Comb],
    ['sync', TokenKind.Sync],
    ['fsm', TokenKind.Fsm],
    ['state', TokenKind.State],
    ['transitions', TokenKind.Transitions],
    ['when', TokenKind.When],
    ['goto', TokenKind.Goto],
    ['mem', TokenKind.Mem],
    ['in', TokenKind.In],
    ['out', TokenKind.Out],
    ['inout', TokenKind.Inout],
    ['as', TokenKind.As],
    ['where', TokenKind.Where],
    ['true', TokenKind.True],
    ['false', TokenKind.False],
    ['mut', TokenKind.Mut],
    ['logic', TokenKind.Logic],
    ['view', TokenKind.View],
    ['output', TokenKind.Output],
    ['test', TokenKind.Test],
    ['assert', TokenKind.Assert],
    ['wait', TokenKind.Wait],
    ['sample', TokenKind.Sample],
    ['timeout', TokenKind.Timeout],
    ['should_fail', TokenKind.ShouldFail],
    ['ignore', TokenKind.Ignore],
    ['parametric', TokenKind.Parametric],
    ['initiator', TokenKind.Initiator],
    ['target', TokenKind.Target],
    ['monitor', TokenKind.Monitor],
    ['bit', TokenKind.Bit],
    ['int', TokenKind.Int],
    ['uint', TokenKind.Uint],
    ['bool', TokenKind.Bool],
    ['clock', TokenKind.Clock],
    ['reset', TokenKind.Reset],
    ['string', TokenKind.String],
    ['posedge', TokenKind.Posedge],
    ['negedge', TokenKind.Negedge],
    ['async', TokenKind.Async],
  ]);

  constructor(source: string) {
    this.source = source;
  }

  /**
   * Tokenize the source code
   */
  tokenize(): LexerResult {
    const tokens: Token[] = [];

    while (!this.isEof()) {
      const token = this.nextToken();
      if (token.kind !== TokenKind.Invalid || token.text !== '') {
        tokens.push(token);
      }
    }

    tokens.push(this.makeToken(TokenKind.Eof, '', []));
    return { tokens, errors: this.errors };
  }

  private isEof(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] ?? '\0' : '\0';
  }

  private advance(): string {
    const ch = this.peek();
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private currentLocation(): SourceLocation {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private makeSpan(start: SourceLocation): SourceSpan {
    return { start, end: this.currentLocation() };
  }

  private makeToken(kind: TokenKind, text: string, leadingTrivia: Trivia[]): Token {
    const startLoc = this.currentLocation();
    startLoc.offset -= text.length;
    startLoc.column -= text.length;
    return {
      kind,
      text,
      span: { start: startLoc, end: this.currentLocation() },
      leadingTrivia,
      trailingTrivia: [],
    };
  }

  private nextToken(): Token {
    const leadingTrivia = this.collectLeadingTrivia();
    const start = this.currentLocation();

    if (this.isEof()) {
      return this.makeToken(TokenKind.Eof, '', leadingTrivia);
    }

    const ch = this.peek();

    // Identifiers and keywords
    if (this.isIdentStart(ch)) {
      return this.scanIdentifier(leadingTrivia);
    }

    // Numbers
    if (this.isDigit(ch)) {
      return this.scanNumber(leadingTrivia);
    }

    // Strings
    if (ch === '"') {
      return this.scanString(leadingTrivia);
    }

    // Single character or multi-character operators/delimiters
    return this.scanOperatorOrDelimiter(leadingTrivia, start);
  }

  private collectLeadingTrivia(): Trivia[] {
    const trivia: Trivia[] = [];

    while (!this.isEof()) {
      const ch = this.peek();
      const start = this.currentLocation();

      if (ch === ' ' || ch === '\t' || ch === '\r') {
        trivia.push(this.scanWhitespace(start));
      } else if (ch === '\n') {
        this.advance();
        trivia.push({
          kind: 'newline',
          text: '\n',
          span: this.makeSpan(start),
        });
      } else if (ch === '/' && this.peek(1) === '/') {
        trivia.push(this.scanLineComment(start));
      } else if (ch === '/' && this.peek(1) === '*') {
        trivia.push(this.scanBlockComment(start));
      } else {
        break;
      }
    }

    return trivia;
  }

  private scanWhitespace(start: SourceLocation): Trivia {
    let text = '';
    while (!this.isEof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        text += this.advance();
      } else {
        break;
      }
    }
    return { kind: 'whitespace', text, span: this.makeSpan(start) };
  }

  private scanLineComment(start: SourceLocation): Trivia {
    let text = '';
    text += this.advance(); // /
    text += this.advance(); // /

    while (!this.isEof() && this.peek() !== '\n') {
      text += this.advance();
    }

    return { kind: 'line_comment', text, span: this.makeSpan(start) };
  }

  private scanBlockComment(start: SourceLocation): Trivia {
    let text = '';
    text += this.advance(); // /
    text += this.advance(); // *

    while (!this.isEof()) {
      if (this.peek() === '*' && this.peek(1) === '/') {
        text += this.advance(); // *
        text += this.advance(); // /
        break;
      }
      text += this.advance();
    }

    return { kind: 'block_comment', text, span: this.makeSpan(start) };
  }

  private scanIdentifier(leadingTrivia: Trivia[]): Token {
    const start = this.currentLocation();
    let text = '';

    while (!this.isEof() && this.isIdentContinue(this.peek())) {
      text += this.advance();
    }

    const kind = Lexer.KEYWORDS.get(text) ?? TokenKind.Ident;
    return {
      kind,
      text,
      span: this.makeSpan(start),
      leadingTrivia,
      trailingTrivia: [],
    };
  }

  private scanNumber(leadingTrivia: Trivia[]): Token {
    const start = this.currentLocation();
    let text = '';

    // Scan size prefix (optional)
    while (this.isDigit(this.peek())) {
      text += this.advance();
    }

    // Check for base prefix
    if (this.peek() === "'") {
      text += this.advance();
      const base = this.peek().toLowerCase();
      if (base === 'b' || base === 'o' || base === 'd' || base === 'h') {
        text += this.advance();
      }
    }

    // Scan digits (with underscores)
    while (!this.isEof()) {
      const ch = this.peek();
      if (this.isHexDigit(ch) || ch === '_') {
        text += this.advance();
      } else {
        break;
      }
    }

    return {
      kind: TokenKind.IntLiteral,
      text,
      span: this.makeSpan(start),
      leadingTrivia,
      trailingTrivia: [],
    };
  }

  private scanString(leadingTrivia: Trivia[]): Token {
    const start = this.currentLocation();
    let text = '';

    text += this.advance(); // opening "

    while (!this.isEof() && this.peek() !== '"') {
      if (this.peek() === '\\') {
        text += this.advance(); // backslash
        if (!this.isEof()) {
          text += this.advance(); // escaped char
        }
      } else if (this.peek() === '\n') {
        this.errors.push({
          message: 'Unterminated string literal',
          span: this.makeSpan(start),
        });
        break;
      } else {
        text += this.advance();
      }
    }

    if (this.peek() === '"') {
      text += this.advance(); // closing "
    }

    return {
      kind: TokenKind.StringLiteral,
      text,
      span: this.makeSpan(start),
      leadingTrivia,
      trailingTrivia: [],
    };
  }

  private scanOperatorOrDelimiter(leadingTrivia: Trivia[], start: SourceLocation): Token {
    const ch = this.advance();
    let text = ch;
    let kind: TokenKind;

    switch (ch) {
      case '(':
        kind = TokenKind.LParen;
        break;
      case ')':
        kind = TokenKind.RParen;
        break;
      case '{':
        kind = TokenKind.LBrace;
        break;
      case '}':
        kind = TokenKind.RBrace;
        break;
      case '[':
        kind = TokenKind.LBracket;
        break;
      case ']':
        kind = TokenKind.RBracket;
        break;
      case ',':
        kind = TokenKind.Comma;
        break;
      case ';':
        kind = TokenKind.Semicolon;
        break;
      case '#':
        kind = TokenKind.Hash;
        break;
      case '~':
        kind = TokenKind.Tilde;
        break;
      case '_':
        kind = TokenKind.Underscore;
        break;

      case ':':
        if (this.peek() === ':') {
          text += this.advance();
          kind = TokenKind.ColonColon;
        } else {
          kind = TokenKind.Colon;
        }
        break;

      case '.':
        if (this.peek() === '.') {
          text += this.advance();
          if (this.peek() === '=') {
            text += this.advance();
            kind = TokenKind.DotDotEq;
          } else {
            kind = TokenKind.DotDot;
          }
        } else {
          kind = TokenKind.Dot;
        }
        break;

      case '+':
        kind = TokenKind.Plus;
        break;

      case '-':
        if (this.peek() === '>') {
          text += this.advance();
          kind = TokenKind.Arrow;
        } else {
          kind = TokenKind.Minus;
        }
        break;

      case '*':
        if (this.peek() === '*') {
          text += this.advance();
          kind = TokenKind.Power;
        } else {
          kind = TokenKind.Star;
        }
        break;

      case '/':
        kind = TokenKind.Slash;
        break;

      case '%':
        kind = TokenKind.Percent;
        break;

      case '&':
        if (this.peek() === '&') {
          text += this.advance();
          kind = TokenKind.AmpAmp;
        } else {
          kind = TokenKind.Amp;
        }
        break;

      case '|':
        if (this.peek() === '|') {
          text += this.advance();
          kind = TokenKind.PipePipe;
        } else {
          kind = TokenKind.Pipe;
        }
        break;

      case '^':
        kind = TokenKind.Caret;
        break;

      case '!':
        if (this.peek() === '=') {
          text += this.advance();
          kind = TokenKind.Ne;
        } else {
          kind = TokenKind.Bang;
        }
        break;

      case '=':
        if (this.peek() === '=') {
          text += this.advance();
          kind = TokenKind.EqEq;
        } else if (this.peek() === '>') {
          text += this.advance();
          kind = TokenKind.FatArrow;
        } else {
          kind = TokenKind.Eq;
        }
        break;

      case '<':
        if (this.peek() === '=') {
          text += this.advance();
          kind = TokenKind.Le;
        } else if (this.peek() === '<') {
          text += this.advance();
          kind = TokenKind.Shl;
        } else {
          kind = TokenKind.Lt;
        }
        break;

      case '>':
        if (this.peek() === '=') {
          text += this.advance();
          kind = TokenKind.Ge;
        } else if (this.peek() === '>') {
          text += this.advance();
          if (this.peek() === '>') {
            text += this.advance();
            kind = TokenKind.Ashr;
          } else {
            kind = TokenKind.Shr;
          }
        } else {
          kind = TokenKind.Gt;
        }
        break;

      default:
        this.errors.push({
          message: `Unexpected character: '${ch}'`,
          span: this.makeSpan(start),
        });
        kind = TokenKind.Invalid;
        break;
    }

    return {
      kind,
      text,
      span: this.makeSpan(start),
      leadingTrivia,
      trailingTrivia: [],
    };
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentContinue(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isHexDigit(ch: string): boolean {
    return (
      this.isDigit(ch) ||
      (ch >= 'a' && ch <= 'f') ||
      (ch >= 'A' && ch <= 'F')
    );
  }
}
