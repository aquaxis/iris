/**
 * IRIS Lexer
 *
 * Tokenizes IRIS source code into a stream of tokens.
 */

import type {
  Token,
  SourceSpan} from './token.js';
import {
  TokenKind,
  KEYWORDS,
  createSpan,
  createToken,
} from './token.js';

/**
 * Lexer error information
 */
export interface LexerError {
  message: string;
  span: SourceSpan;
}

/**
 * Lexer result containing tokens and any errors
 */
export interface LexerResult {
  tokens: Token[];
  errors: LexerError[];
}

/**
 * IRIS Language Lexer
 */
export class Lexer {
  private readonly source: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private readonly errors: LexerError[] = [];

  constructor(source: string) {
    this.source = source;
  }

  /**
   * Tokenize the entire source
   */
  tokenize(): LexerResult {
    while (!this.isAtEnd()) {
      this.scanToken();
    }

    // Add EOF token
    this.addToken(TokenKind.Eof, '');

    return {
      tokens: this.tokens,
      errors: this.errors,
    };
  }

  /**
   * Tokenize without trivia (whitespace and comments)
   */
  tokenizeWithoutTrivia(): LexerResult {
    const result = this.tokenize();
    return {
      tokens: result.tokens.filter(
        (t) =>
          t.kind !== TokenKind.Whitespace &&
          t.kind !== TokenKind.LineComment &&
          t.kind !== TokenKind.BlockComment
      ),
      errors: result.errors,
    };
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source.charAt(this.pos);
  }

  private peekNext(): string {
    if (this.pos + 1 >= this.source.length) return '\0';
    return this.source.charAt(this.pos + 1);
  }

  private advance(): string {
    const ch = this.source.charAt(this.pos);
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source[this.pos] !== expected) return false;
    this.advance();
    return true;
  }

  private scanToken(): void {
    const startPos = this.pos;
    const startLine = this.line;
    const startColumn = this.column;

    const ch = this.advance();

    switch (ch) {
      // Single-character tokens
      case '(':
        this.addTokenAt(TokenKind.LParen, '(', startPos, startLine, startColumn);
        break;
      case ')':
        this.addTokenAt(TokenKind.RParen, ')', startPos, startLine, startColumn);
        break;
      case '[':
        this.addTokenAt(TokenKind.LBracket, '[', startPos, startLine, startColumn);
        break;
      case ']':
        this.addTokenAt(TokenKind.RBracket, ']', startPos, startLine, startColumn);
        break;
      case '{':
        this.addTokenAt(TokenKind.LBrace, '{', startPos, startLine, startColumn);
        break;
      case '}':
        this.addTokenAt(TokenKind.RBrace, '}', startPos, startLine, startColumn);
        break;
      case ';':
        this.addTokenAt(TokenKind.Semi, ';', startPos, startLine, startColumn);
        break;
      case ',':
        this.addTokenAt(TokenKind.Comma, ',', startPos, startLine, startColumn);
        break;
      case '~':
        this.addTokenAt(TokenKind.Tilde, '~', startPos, startLine, startColumn);
        break;
      case '^':
        this.addTokenAt(TokenKind.Caret, '^', startPos, startLine, startColumn);
        break;
      case '%':
        this.addTokenAt(TokenKind.Percent, '%', startPos, startLine, startColumn);
        break;
      case "'":
        this.addTokenAt(TokenKind.Quote, "'", startPos, startLine, startColumn);
        break;

      // Two-character tokens
      case ':':
        if (this.match(':')) {
          this.addTokenAt(TokenKind.ColonColon, '::', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Colon, ':', startPos, startLine, startColumn);
        }
        break;

      case '.':
        if (this.match('.')) {
          if (this.match('=')) {
            this.addTokenAt(TokenKind.DotDotEq, '..=', startPos, startLine, startColumn);
          } else {
            this.addTokenAt(TokenKind.DotDot, '..', startPos, startLine, startColumn);
          }
        } else {
          this.addTokenAt(TokenKind.Dot, '.', startPos, startLine, startColumn);
        }
        break;

      case '+':
        // `+:` is one token. Left as `+` then `:`, the expression parser takes
        // the `+` as addition and finds no right operand.
        if (this.match(':')) {
          this.addTokenAt(TokenKind.PlusColon, '+:', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Plus, '+', startPos, startLine, startColumn);
        }
        break;

      case '-':
        if (this.match(':')) {
          this.addTokenAt(TokenKind.MinusColon, '-:', startPos, startLine, startColumn);
        } else if (this.match('>')) {
          this.addTokenAt(TokenKind.Arrow, '->', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Minus, '-', startPos, startLine, startColumn);
        }
        break;

      case '*':
        if (this.match('*')) {
          this.addTokenAt(TokenKind.StarStar, '**', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Star, '*', startPos, startLine, startColumn);
        }
        break;

      case '/':
        if (this.match('/')) {
          this.scanLineComment(startPos, startLine, startColumn);
        } else if (this.match('*')) {
          this.scanBlockComment(startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Slash, '/', startPos, startLine, startColumn);
        }
        break;

      case '&':
        if (this.match('&')) {
          this.addTokenAt(TokenKind.AmpAmp, '&&', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Amp, '&', startPos, startLine, startColumn);
        }
        break;

      case '|':
        if (this.match('|')) {
          this.addTokenAt(TokenKind.PipePipe, '||', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Pipe, '|', startPos, startLine, startColumn);
        }
        break;

      case '!':
        if (this.match('=')) {
          this.addTokenAt(TokenKind.BangEq, '!=', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Bang, '!', startPos, startLine, startColumn);
        }
        break;

      case '=':
        if (this.match('=')) {
          this.addTokenAt(TokenKind.EqEq, '==', startPos, startLine, startColumn);
        } else if (this.match('>')) {
          this.addTokenAt(TokenKind.FatArrow, '=>', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Eq, '=', startPos, startLine, startColumn);
        }
        break;

      case '<':
        if (this.match('<')) {
          this.addTokenAt(TokenKind.LtLt, '<<', startPos, startLine, startColumn);
        } else if (this.match('=')) {
          this.addTokenAt(TokenKind.LtEq, '<=', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Lt, '<', startPos, startLine, startColumn);
        }
        break;

      case '>':
        if (this.match('>')) {
          if (this.match('>')) {
            this.addTokenAt(TokenKind.GtGtGt, '>>>', startPos, startLine, startColumn);
          } else {
            this.addTokenAt(TokenKind.GtGt, '>>', startPos, startLine, startColumn);
          }
        } else if (this.match('=')) {
          this.addTokenAt(TokenKind.GtEq, '>=', startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Gt, '>', startPos, startLine, startColumn);
        }
        break;

      case '#':
        if (this.match('[')) {
          this.addTokenAt(TokenKind.HashLBracket, '#[', startPos, startLine, startColumn);
        } else {
          // Hash for delay syntax: #10ns;
          this.addTokenAt(TokenKind.Hash, '#', startPos, startLine, startColumn);
        }
        break;

      case '_':
        if (this.isIdentifierPart(this.peek())) {
          this.scanIdentifier(startPos, startLine, startColumn);
        } else {
          this.addTokenAt(TokenKind.Underscore, '_', startPos, startLine, startColumn);
        }
        break;

      // String literal
      case '"':
        this.scanString(startPos, startLine, startColumn);
        break;

      // System function: $clog2, $display, $finish
      case '$':
        this.scanSysFunc(startPos, startLine, startColumn);
        break;

      // Whitespace
      case ' ':
      case '\t':
      case '\r':
      case '\n':
        this.scanWhitespace(startPos, startLine, startColumn);
        break;

      default:
        if (this.isDigit(ch)) {
          this.scanNumber(startPos, startLine, startColumn);
        } else if (this.isIdentifierStart(ch)) {
          this.scanIdentifier(startPos, startLine, startColumn);
        } else {
          this.addError(`Unexpected character: ${ch}`, startPos, startLine, startColumn);
        }
        break;
    }
  }

  private scanLineComment(startPos: number, startLine: number, startColumn: number): void {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.LineComment, text, startPos, startLine, startColumn);
  }

  private scanBlockComment(startPos: number, startLine: number, startColumn: number): void {
    let depth = 1;
    while (!this.isAtEnd() && depth > 0) {
      if (this.peek() === '/' && this.peekNext() === '*') {
        this.advance();
        this.advance();
        depth++;
      } else if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance();
        this.advance();
        depth--;
      } else {
        this.advance();
      }
    }

    if (depth > 0) {
      this.addError('Unterminated block comment', startPos, startLine, startColumn);
    }

    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.BlockComment, text, startPos, startLine, startColumn);
  }

  private scanWhitespace(startPos: number, startLine: number, startColumn: number): void {
    while (this.isWhitespace(this.peek())) {
      this.advance();
    }
    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.Whitespace, text, startPos, startLine, startColumn);
  }

  private scanString(startPos: number, startLine: number, startColumn: number): void {
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance(); // Skip backslash
        if (!this.isAtEnd()) {
          this.advance(); // Skip escaped character
        }
      } else if (this.peek() === '\n') {
        this.addError('Unterminated string literal', startPos, startLine, startColumn);
        return;
      } else {
        this.advance();
      }
    }

    if (this.isAtEnd()) {
      this.addError('Unterminated string literal', startPos, startLine, startColumn);
      return;
    }

    this.advance(); // Closing quote
    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.StringLiteral, text, startPos, startLine, startColumn);
  }

  private scanNumber(startPos: number, startLine: number, startColumn: number): void {
    // Scan decimal digits (potential bit width)
    while (this.isDigit(this.peek())) {
      this.advance();
    }

    // Check for base specifier (e.g., 8'h, 32'b) or without quote (e.g., 32h, 8b)
    let hasBaseSpecifier = false;
    if (this.peek() === "'" && this.isBaseSpecifier(this.peekNext())) {
      // Format with quote: 32'h00000000
      this.advance(); // '
      hasBaseSpecifier = true;
    } else if (this.isBaseSpecifier(this.peek())) {
      // Format without quote: 32h00000000, 32h_00000000
      hasBaseSpecifier = true;
    }

    if (hasBaseSpecifier) {
      const base = this.advance(); // base character

      // Scan digits based on base
      if (base === 'b' || base === 'B') {
        this.scanBinaryDigits();
      } else if (base === 'o' || base === 'O') {
        this.scanOctalDigits();
      } else if (base === 'd' || base === 'D') {
        this.scanDecimalDigits();
      } else if (base === 'h' || base === 'H') {
        this.scanHexDigits();
      }
    }

    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.IntegerLiteral, text, startPos, startLine, startColumn);
  }

  private scanBinaryDigits(): void {
    while (this.isBinaryDigit(this.peek()) || this.peek() === '_') {
      this.advance();
    }
  }

  private scanOctalDigits(): void {
    while (this.isOctalDigit(this.peek()) || this.peek() === '_') {
      this.advance();
    }
  }

  private scanDecimalDigits(): void {
    while (this.isDigit(this.peek()) || this.peek() === '_') {
      this.advance();
    }
  }

  private scanHexDigits(): void {
    while (this.isHexDigit(this.peek()) || this.peek() === '_') {
      this.advance();
    }
  }

  private scanIdentifier(startPos: number, startLine: number, startColumn: number): void {
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }

    const text = this.source.slice(startPos, this.pos);
    const kind = KEYWORDS.get(text) ?? TokenKind.Identifier;
    this.addTokenAt(kind, text, startPos, startLine, startColumn);
  }

  /**
   * Scan a system function name. The leading '$' has already been consumed.
   * The name is kept with its '$' so it can be emitted to SystemVerilog as-is.
   */
  private scanSysFunc(startPos: number, startLine: number, startColumn: number): void {
    if (!this.isIdentifierStart(this.peek())) {
      this.addError('Expected a name after $', startPos, startLine, startColumn);
      return;
    }
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }
    const text = this.source.slice(startPos, this.pos);
    this.addTokenAt(TokenKind.SysFunc, text, startPos, startLine, startColumn);
  }

  private isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isBinaryDigit(ch: string): boolean {
    return ch === '0' || ch === '1';
  }

  private isOctalDigit(ch: string): boolean {
    return ch >= '0' && ch <= '7';
  }

  private isHexDigit(ch: string): boolean {
    return (
      this.isDigit(ch) ||
      (ch >= 'a' && ch <= 'f') ||
      (ch >= 'A' && ch <= 'F')
    );
  }

  private isBaseSpecifier(ch: string): boolean {
    return ch === 'b' || ch === 'B' || ch === 'o' || ch === 'O' ||
           ch === 'd' || ch === 'D' || ch === 'h' || ch === 'H';
  }

  private isIdentifierStart(ch: string): boolean {
    return (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      ch === '_'
    );
  }

  private isIdentifierPart(ch: string): boolean {
    return this.isIdentifierStart(ch) || this.isDigit(ch);
  }

  private addToken(kind: TokenKind, text: string): void {
    const span = createSpan(
      this.pos - text.length,
      this.pos,
      this.line,
      this.column - text.length,
      this.line,
      this.column
    );
    this.tokens.push(createToken(kind, text, span));
  }

  private addTokenAt(
    kind: TokenKind,
    text: string,
    startPos: number,
    startLine: number,
    startColumn: number
  ): void {
    const span = createSpan(
      startPos,
      this.pos,
      startLine,
      startColumn,
      this.line,
      this.column
    );
    this.tokens.push(createToken(kind, text, span));
  }

  private addError(message: string, startPos: number, startLine: number, startColumn: number): void {
    const span = createSpan(
      startPos,
      this.pos,
      startLine,
      startColumn,
      this.line,
      this.column
    );
    this.errors.push({ message, span });
    this.tokens.push(createToken(TokenKind.Error, this.source.slice(startPos, this.pos), span));
  }
}

/**
 * Tokenize IRIS source code
 */
export function tokenize(source: string): LexerResult {
  const lexer = new Lexer(source);
  return lexer.tokenize();
}

/**
 * Tokenize IRIS source code without trivia
 */
export function tokenizeWithoutTrivia(source: string): LexerResult {
  const lexer = new Lexer(source);
  return lexer.tokenizeWithoutTrivia();
}
