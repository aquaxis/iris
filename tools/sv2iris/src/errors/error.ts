/**
 * Error Classes for SV2IRIS
 * Hierarchical error types for different compilation phases
 */

import type { SourceLocation} from '../utils/source-location.js';
import { formatLocation } from '../utils/source-location.js';

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    Error = 'error',
    Warning = 'warning',
    Info = 'info',
}

/**
 * Error category codes
 */
export enum ErrorCategory {
    Lexer = 'E0', // E001-E099: Lexical analysis errors
    Parser = 'E1', // E100-E199: Syntax analysis errors
    Transform = 'E2', // E200-E299: Transformation errors
    Output = 'E3', // E300-E399: Output/generation errors
}

/**
 * Warning category codes
 */
export enum WarningCategory {
    Deprecated = 'W0', // W001-W099: Deprecated syntax usage
    Unsupported = 'W1', // W100-W199: Unsupported constructs skipped
    Quality = 'W2', // W200-W299: Suboptimal conversion results
}

/**
 * Base error class for all SV2IRIS errors
 */
export abstract class Sv2IrisError extends Error {
    /** Error code (e.g., E001, E102) */
    abstract readonly code: string;
    /** Error severity */
    abstract readonly severity: ErrorSeverity;
    /** Source location where error occurred */
    readonly location?: SourceLocation;

    constructor(message: string, location?: SourceLocation) {
        super(message);
        this.name = this.constructor.name;
        this.location = location;
        Object.setPrototypeOf(this, new.target.prototype);
    }

    /**
     * Formats the error for display
     */
    format(): string {
        const loc = this.location ? formatLocation(this.location) : '<unknown>';
        return `${loc}: ${this.severity}[${this.code}]: ${this.message}`;
    }
}

/**
 * Lexer error - occurs during tokenization
 */
export class LexerError extends Sv2IrisError {
    readonly code: string;
    readonly severity = ErrorSeverity.Error;

    constructor(code: number, message: string, location?: SourceLocation) {
        super(message, location);
        this.code = `E${code.toString().padStart(3, '0')}`;
    }
}

/**
 * Parser error - occurs during syntax analysis
 */
export class ParserError extends Sv2IrisError {
    readonly code: string;
    readonly severity = ErrorSeverity.Error;

    constructor(code: number, message: string, location?: SourceLocation) {
        super(message, location);
        this.code = `E${(100 + code).toString()}`;
    }
}

/**
 * Transform error - occurs during AST transformation
 */
export class TransformError extends Sv2IrisError {
    readonly code: string;
    readonly severity = ErrorSeverity.Error;

    constructor(code: number, message: string, location?: SourceLocation) {
        super(message, location);
        this.code = `E${(200 + code).toString()}`;
    }
}

/**
 * Generator error - occurs during code generation
 */
export class GeneratorError extends Sv2IrisError {
    readonly code: string;
    readonly severity = ErrorSeverity.Error;

    constructor(code: number, message: string, location?: SourceLocation) {
        super(message, location);
        this.code = `E${(300 + code).toString()}`;
    }
}

/**
 * Warning class for non-fatal issues
 */
export class Sv2IrisWarning extends Sv2IrisError {
    readonly code: string;
    readonly severity = ErrorSeverity.Warning;

    constructor(code: number, message: string, location?: SourceLocation) {
        super(message, location);
        this.code = `W${code.toString().padStart(3, '0')}`;
    }
}

/**
 * Common error codes for lexer
 */
export const LexerErrorCodes = {
    UNKNOWN_TOKEN: 1,
    UNTERMINATED_STRING: 2,
    INVALID_NUMBER: 3,
    UNTERMINATED_COMMENT: 4,
    INVALID_ESCAPE_SEQUENCE: 5,
} as const;

/**
 * Common error codes for parser
 */
export const ParserErrorCodes = {
    UNEXPECTED_TOKEN: 1,
    EXPECTED_TOKEN: 2,
    UNEXPECTED_EOF: 3,
    INVALID_SYNTAX: 4,
    MISSING_SEMICOLON: 5,
    MISSING_IDENTIFIER: 6,
    INVALID_EXPRESSION: 7,
    INVALID_STATEMENT: 8,
} as const;

/**
 * Common error codes for transformer
 */
export const TransformErrorCodes = {
    UNSUPPORTED_CONSTRUCT: 1,
    INVALID_TYPE: 2,
    INVALID_EXPRESSION: 3,
    INVALID_STATEMENT: 4,
    SEMANTIC_ERROR: 5,
} as const;

/**
 * Common warning codes
 */
export const WarningCodes = {
    DEPRECATED_SYNTAX: 1,
    UNSUPPORTED_SKIPPED: 100,
    SUBOPTIMAL_CONVERSION: 200,
} as const;
