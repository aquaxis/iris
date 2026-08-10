/**
 * SystemVerilog Lexer
 * Tokenizes SystemVerilog source code for parsing
 */

import type { SourcePosition} from '../utils/source-location.js';
import { createPosition, createLocation } from '../utils/source-location.js';
import { LexerError, LexerErrorCodes } from '../errors/error.js';
import { ErrorReporter } from '../errors/reporter.js';
import type { Token} from './token.js';
import { TokenType, createToken } from './token.js';
import { KEYWORDS, OPERATORS, PUNCTUATION } from './keywords.js';

/**
 * Lexer class for SystemVerilog tokenization
 */
export class Lexer {
    private readonly source: string;
    private readonly file: string;
    private pos = 0;
    private line = 1;
    private column = 1;
    private readonly reporter: ErrorReporter;

    constructor(source: string, file = '<input>', reporter?: ErrorReporter) {
        this.source = source;
        this.file = file;
        this.reporter = reporter ?? new ErrorReporter();
    }

    /**
     * Tokenizes the entire source and returns all tokens
     */
    tokenize(): Token[] {
        const tokens: Token[] = [];

        while (!this.isAtEnd()) {
            const token = this.nextToken();
            if (token.type !== TokenType.UNKNOWN || !this.reporter.hasMaxErrors()) {
                tokens.push(token);
            }
            if (token.type === TokenType.EOF) {
                break;
            }
        }

        // Ensure EOF token is present
        if (tokens.length === 0 || tokens[tokens.length - 1].type !== TokenType.EOF) {
            tokens.push(this.makeToken(TokenType.EOF, ''));
        }

        return tokens;
    }

    /**
     * Returns the next token from the source
     */
    nextToken(): Token {
        this.skipWhitespaceAndComments();

        if (this.isAtEnd()) {
            return this.makeToken(TokenType.EOF, '');
        }

        const startPos = this.currentPosition();
        const char = this.peek();

        // Identifiers and keywords
        if (this.isAlpha(char) || char === '_') {
            return this.scanIdentifier(startPos);
        }

        // System identifiers ($...)
        if (char === '$') {
            return this.scanSystemIdentifier(startPos);
        }

        // Numbers
        if (this.isDigit(char)) {
            return this.scanNumber(startPos);
        }

        // Unsized based numbers (e.g., 'hFF, 'b1010)
        if (char === "'") {
            const nextChar = this.peekNext().toLowerCase();
            if (
                nextChar === 's' ||
                nextChar === 'b' ||
                nextChar === 'o' ||
                nextChar === 'd' ||
                nextChar === 'h' ||
                nextChar === '0' ||
                nextChar === '1'
            ) {
                return this.scanBasedNumber(startPos);
            }
        }

        // String literals
        if (char === '"') {
            return this.scanString(startPos);
        }

        // Operators (multi-character first)
        const opToken = this.scanOperator(startPos);
        if (opToken) {
            return opToken;
        }

        // Single-character punctuation
        const punctType = PUNCTUATION.get(char);
        if (punctType !== undefined) {
            this.advance();
            return this.makeTokenAt(punctType, char, startPos);
        }

        // Unknown character
        this.advance();
        const error = new LexerError(
            LexerErrorCodes.UNKNOWN_TOKEN,
            `Unexpected character '${char}'`,
            createLocation(startPos, this.currentPosition(), this.file)
        );
        this.reporter.reportError(error);
        return this.makeTokenAt(TokenType.UNKNOWN, char, startPos);
    }

    /**
     * Gets the error reporter
     */
    getReporter(): ErrorReporter {
        return this.reporter;
    }

    // ========== Private Helper Methods ==========

    /**
     * Returns current position
     */
    private currentPosition(): SourcePosition {
        return createPosition(this.line, this.column, this.pos);
    }

    /**
     * Creates a token at current position
     */
    private makeToken(type: TokenType, value: string): Token {
        const endPos = this.currentPosition();
        const startPos = createPosition(
            this.line,
            Math.max(1, this.column - value.length),
            Math.max(0, this.pos - value.length)
        );
        return createToken(type, value, createLocation(startPos, endPos, this.file));
    }

    /**
     * Creates a token with explicit start position
     */
    private makeTokenAt(type: TokenType, value: string, startPos: SourcePosition): Token {
        return createToken(
            type,
            value,
            createLocation(startPos, this.currentPosition(), this.file)
        );
    }

    /**
     * Checks if at end of source
     */
    private isAtEnd(): boolean {
        return this.pos >= this.source.length;
    }

    /**
     * Returns current character without advancing
     */
    private peek(): string {
        if (this.isAtEnd()) return '\0';
        return this.source[this.pos];
    }

    /**
     * Returns next character without advancing
     */
    private peekNext(): string {
        if (this.pos + 1 >= this.source.length) return '\0';
        return this.source[this.pos + 1];
    }

    /**
     * Advances position and returns current character
     */
    private advance(): string {
        const char = this.source[this.pos];
        this.pos++;
        if (char === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        return char;
    }

    /**
     * Checks if string matches at current position
     */
    private matchString(expected: string): boolean {
        if (this.pos + expected.length > this.source.length) return false;
        for (let i = 0; i < expected.length; i++) {
            if (this.source[this.pos + i] !== expected[i]) return false;
        }
        return true;
    }

    /**
     * Skips whitespace and comments
     */
    private skipWhitespaceAndComments(): void {
        while (!this.isAtEnd()) {
            const char = this.peek();

            // Whitespace
            if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
                this.advance();
                continue;
            }

            // Single-line comment
            if (char === '/' && this.peekNext() === '/') {
                this.advance(); // /
                this.advance(); // /
                while (!this.isAtEnd() && this.peek() !== '\n') {
                    this.advance();
                }
                continue;
            }

            // Multi-line comment
            if (char === '/' && this.peekNext() === '*') {
                const startPos = this.currentPosition();
                this.advance(); // /
                this.advance(); // *
                while (!this.isAtEnd()) {
                    if (this.peek() === '*' && this.peekNext() === '/') {
                        this.advance(); // *
                        this.advance(); // /
                        break;
                    }
                    if (this.isAtEnd()) {
                        const error = new LexerError(
                            LexerErrorCodes.UNTERMINATED_COMMENT,
                            'Unterminated block comment',
                            createLocation(startPos, this.currentPosition(), this.file)
                        );
                        this.reporter.reportError(error);
                        return;
                    }
                    this.advance();
                }
                continue;
            }

            // Compiler directives (e.g., `default_nettype, `timescale, `define)
            // Skip entire line starting with backtick
            if (char === '`') {
                this.advance(); // `
                while (!this.isAtEnd() && this.peek() !== '\n') {
                    this.advance();
                }
                continue;
            }

            // Not whitespace or comment
            break;
        }
    }

    /**
     * Scans an identifier or keyword
     */
    private scanIdentifier(startPos: SourcePosition): Token {
        let value = '';

        while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }

        // Check if it's a keyword
        const keywordType = KEYWORDS.get(value);
        if (keywordType !== undefined) {
            return this.makeTokenAt(keywordType, value, startPos);
        }

        // `PtrWidth'(expr)` is a size cast whose width is a parameter rather
        // than a literal. iris2sv emits this form for every generic design.
        if (this.peek() === "'" && this.peekNext() === '(') {
            this.advance(); // '
            return this.makeTokenAt(TokenType.SIZE_CAST, value, startPos);
        }

        return this.makeTokenAt(TokenType.IDENTIFIER, value, startPos);
    }

    /**
     * Scans a system identifier ($name)
     */
    private scanSystemIdentifier(startPos: SourcePosition): Token {
        let value = this.advance(); // $

        while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }

        return this.makeTokenAt(TokenType.SYSTEM_IDENTIFIER, value, startPos);
    }

    /**
     * Scans a number literal
     */
    private scanNumber(startPos: SourcePosition): Token {
        let value = '';

        // Scan decimal digits (possibly size specifier)
        while (!this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === '_')) {
            value += this.advance();
        }

        // Check for based number (e.g., 8'hFF)
        if (this.peek() === "'") {
            return this.scanBasedNumberWithSize(value, startPos);
        }

        // Check for real number
        if (this.peek() === '.' && this.isDigit(this.peekNext())) {
            value += this.advance(); // .
            while (!this.isAtEnd() && (this.isDigit(this.peek()) || this.peek() === '_')) {
                value += this.advance();
            }
            // Exponent
            if (this.peek() === 'e' || this.peek() === 'E') {
                value += this.advance();
                if (this.peek() === '+' || this.peek() === '-') {
                    value += this.advance();
                }
                while (!this.isAtEnd() && this.isDigit(this.peek())) {
                    value += this.advance();
                }
            }
        }

        return this.makeTokenAt(TokenType.NUMBER, value, startPos);
    }

    /**
     * Scans a based number starting with '
     */
    private scanBasedNumber(startPos: SourcePosition): Token {
        let value = this.advance(); // '

        // Optional signed specifier
        if (this.peek() === 's' || this.peek() === 'S') {
            value += this.advance();
        }

        // Base specifier
        const base = this.peek().toLowerCase();
        if (base === 'b' || base === 'o' || base === 'd' || base === 'h') {
            value += this.advance();
        } else {
            // Special literals '0 or '1
            if (this.peek() === '0' || this.peek() === '1') {
                value += this.advance();
                return this.makeTokenAt(TokenType.NUMBER, value, startPos);
            }
            const error = new LexerError(
                LexerErrorCodes.INVALID_NUMBER,
                `Invalid number base '${this.peek()}'`,
                createLocation(startPos, this.currentPosition(), this.file)
            );
            this.reporter.reportError(error);
            return this.makeTokenAt(TokenType.UNKNOWN, value, startPos);
        }

        // Scan digits according to base
        while (!this.isAtEnd() && this.isBaseDigit(this.peek(), base)) {
            value += this.advance();
        }

        return this.makeTokenAt(TokenType.NUMBER, value, startPos);
    }

    /**
     * Scans a based number with size prefix
     */
    private scanBasedNumberWithSize(size: string, startPos: SourcePosition): Token {
        let value = size;
        value += this.advance(); // '

        // `8'(expr)` is a size cast, not a based literal. iris2sv emits these
        // for every width conversion, so refusing them meant the two
        // transpilers could not be chained on any design at all.
        if (this.peek() === '(') {
            return this.makeTokenAt(TokenType.SIZE_CAST, size, startPos);
        }

        // Optional signed specifier
        if (this.peek() === 's' || this.peek() === 'S') {
            value += this.advance();
        }

        // Base specifier
        const base = this.peek().toLowerCase();
        if (base === 'b' || base === 'o' || base === 'd' || base === 'h') {
            value += this.advance();
        } else {
            const error = new LexerError(
                LexerErrorCodes.INVALID_NUMBER,
                `Invalid number base '${this.peek()}'`,
                createLocation(startPos, this.currentPosition(), this.file)
            );
            this.reporter.reportError(error);
            return this.makeTokenAt(TokenType.UNKNOWN, value, startPos);
        }

        // Scan digits according to base
        while (!this.isAtEnd() && this.isBaseDigit(this.peek(), base)) {
            value += this.advance();
        }

        return this.makeTokenAt(TokenType.NUMBER, value, startPos);
    }

    /**
     * Checks if character is valid for given base
     */
    private isBaseDigit(char: string, base: string): boolean {
        const c = char.toLowerCase();
        if (c === '_') return true;
        if (c === 'x' || c === 'z' || c === '?') return true; // Unknown/high-Z

        switch (base) {
            case 'b':
                return c === '0' || c === '1';
            case 'o':
                return c >= '0' && c <= '7';
            case 'd':
                return c >= '0' && c <= '9';
            case 'h':
                return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
            default:
                return false;
        }
    }

    /**
     * Scans a string literal
     */
    private scanString(startPos: SourcePosition): Token {
        let value = this.advance(); // Opening "

        while (!this.isAtEnd() && this.peek() !== '"') {
            if (this.peek() === '\n') {
                const error = new LexerError(
                    LexerErrorCodes.UNTERMINATED_STRING,
                    'Unterminated string literal',
                    createLocation(startPos, this.currentPosition(), this.file)
                );
                this.reporter.reportError(error);
                return this.makeTokenAt(TokenType.STRING, value, startPos);
            }

            // Handle escape sequences
            if (this.peek() === '\\') {
                value += this.advance(); // backslash
                if (!this.isAtEnd()) {
                    value += this.advance(); // escaped char
                }
            } else {
                value += this.advance();
            }
        }

        if (this.isAtEnd()) {
            const error = new LexerError(
                LexerErrorCodes.UNTERMINATED_STRING,
                'Unterminated string literal',
                createLocation(startPos, this.currentPosition(), this.file)
            );
            this.reporter.reportError(error);
            return this.makeTokenAt(TokenType.STRING, value, startPos);
        }

        value += this.advance(); // Closing "
        return this.makeTokenAt(TokenType.STRING, value, startPos);
    }

    /**
     * Scans an operator
     */
    private scanOperator(startPos: SourcePosition): Token | null {
        // Try matching operators from longest to shortest
        for (const [op, type] of OPERATORS) {
            if (this.matchString(op)) {
                // Advance for each character
                for (const _ of op) {
                    this.advance();
                }
                return this.makeTokenAt(type, op, startPos);
            }
        }
        return null;
    }

    /**
     * Checks if character is alphabetic
     */
    private isAlpha(char: string): boolean {
        return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    }

    /**
     * Checks if character is a digit
     */
    private isDigit(char: string): boolean {
        return char >= '0' && char <= '9';
    }

    /**
     * Checks if character is alphanumeric or underscore
     */
    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char) || char === '_' || char === '$';
    }
}
