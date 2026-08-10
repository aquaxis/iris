/**
 * Token Types and Token Structure
 * Defines all token types for SystemVerilog lexical analysis
 */

import type { SourceLocation } from '../utils/source-location.js';

/**
 * Token type enumeration
 * Covers all SystemVerilog tokens needed for synthesis-related constructs
 */
export enum TokenType {
    // === Keywords - Module Structure ===
    MODULE = 'MODULE',
    ENDMODULE = 'ENDMODULE',
    PARAMETER = 'PARAMETER',
    LOCALPARAM = 'LOCALPARAM',
    INPUT = 'INPUT',
    OUTPUT = 'OUTPUT',
    INOUT = 'INOUT',

    // === Keywords - Data Types ===
    WIRE = 'WIRE',
    TRI = 'TRI',
    REG = 'REG',
    LOGIC = 'LOGIC',
    BIT = 'BIT',
    INTEGER = 'INTEGER',
    INT = 'INT',
    SHORTINT = 'SHORTINT',
    LONGINT = 'LONGINT',
    BYTE = 'BYTE',
    REAL = 'REAL',
    SHORTREAL = 'SHORTREAL',
    REALTIME = 'REALTIME',
    TIME = 'TIME',
    STRING_TYPE = 'STRING_TYPE',
    VOID = 'VOID',
    SIGNED = 'SIGNED',
    UNSIGNED = 'UNSIGNED',
    ENUM = 'ENUM',
    STRUCT = 'STRUCT',
    UNION = 'UNION',
    TYPEDEF = 'TYPEDEF',
    PACKED = 'PACKED',

    // === Keywords - Always Blocks ===
    ALWAYS = 'ALWAYS',
    ALWAYS_FF = 'ALWAYS_FF',
    ALWAYS_COMB = 'ALWAYS_COMB',
    ALWAYS_LATCH = 'ALWAYS_LATCH',

    // === Keywords - Sensitivity ===
    POSEDGE = 'POSEDGE',
    NEGEDGE = 'NEGEDGE',
    OR = 'OR',

    // === Keywords - Statements ===
    ASSIGN = 'ASSIGN',
    IF = 'IF',
    ELSE = 'ELSE',
    ASSERT = 'ASSERT',
    CASE = 'CASE',
    CASEZ = 'CASEZ',
    CASEX = 'CASEX',
    DEFAULT = 'DEFAULT',
    ENDCASE = 'ENDCASE',
    FOR = 'FOR',
    WHILE = 'WHILE',
    BEGIN = 'BEGIN',
    END = 'END',
    GENERATE = 'GENERATE',
    ENDGENERATE = 'ENDGENERATE',
    GENVAR = 'GENVAR',
    RETURN = 'RETURN',

    // === Keywords - Functions/Tasks ===
    FUNCTION = 'FUNCTION',
    ENDFUNCTION = 'ENDFUNCTION',
    TASK = 'TASK',
    ENDTASK = 'ENDTASK',
    AUTOMATIC = 'AUTOMATIC',

    // === Keywords - Interface ===
    INTERFACE = 'INTERFACE',
    ENDINTERFACE = 'ENDINTERFACE',
    MODPORT = 'MODPORT',

    // === Keywords - Other ===
    INITIAL = 'INITIAL',
    CONST = 'CONST',

    // === Literals ===
    NUMBER = 'NUMBER',
    // `8'(expr)` — a size cast. The token carries the width; the parenthesised
    // expression that follows is parsed as an ordinary primary.
    SIZE_CAST = 'SIZE_CAST',
    STRING = 'STRING',
    IDENTIFIER = 'IDENTIFIER',
    SYSTEM_IDENTIFIER = 'SYSTEM_IDENTIFIER',

    // === Operators - Arithmetic ===
    PLUS = 'PLUS', // +
    PLUS_COLON = 'PLUS_COLON', // +: of a part select
    MINUS_COLON = 'MINUS_COLON', // -: of a part select
    MINUS = 'MINUS', // -
    STAR = 'STAR', // *
    SLASH = 'SLASH', // /
    PERCENT = 'PERCENT', // %
    POWER = 'POWER', // **

    // === Operators - Bitwise ===
    AMP = 'AMP', // &
    PIPE = 'PIPE', // |
    CARET = 'CARET', // ^
    TILDE = 'TILDE', // ~
    TILDE_AMP = 'TILDE_AMP', // ~&
    TILDE_PIPE = 'TILDE_PIPE', // ~|
    TILDE_CARET = 'TILDE_CARET', // ~^
    CARET_TILDE = 'CARET_TILDE', // ^~

    // === Operators - Logical ===
    BANG = 'BANG', // !
    AMP_AMP = 'AMP_AMP', // &&
    PIPE_PIPE = 'PIPE_PIPE', // ||

    // === Operators - Comparison ===
    EQ_EQ = 'EQ_EQ', // ==
    BANG_EQ = 'BANG_EQ', // !=
    EQ_EQ_EQ = 'EQ_EQ_EQ', // ===
    BANG_EQ_EQ = 'BANG_EQ_EQ', // !==
    LT = 'LT', // <
    GT = 'GT', // >
    LT_EQ = 'LT_EQ', // <=
    GT_EQ = 'GT_EQ', // >=

    // === Operators - Shift ===
    LT_LT = 'LT_LT', // <<
    GT_GT = 'GT_GT', // >>
    GT_GT_GT = 'GT_GT_GT', // >>>
    LT_LT_LT = 'LT_LT_LT', // <<<

    // === Operators - Assignment ===
    EQ = 'EQ', // =
    LT_EQ_NONBLOCK = 'LT_EQ_NONBLOCK', // <= (non-blocking, context dependent)
    PLUS_EQ = 'PLUS_EQ', // +=
    MINUS_EQ = 'MINUS_EQ', // -=
    STAR_EQ = 'STAR_EQ', // *=
    SLASH_EQ = 'SLASH_EQ', // /=
    PERCENT_EQ = 'PERCENT_EQ', // %=
    AMP_EQ = 'AMP_EQ', // &=
    PIPE_EQ = 'PIPE_EQ', // |=
    CARET_EQ = 'CARET_EQ', // ^=
    LT_LT_EQ = 'LT_LT_EQ', // <<=
    GT_GT_EQ = 'GT_GT_EQ', // >>=

    // === Punctuation ===
    LPAREN = 'LPAREN', // (
    RPAREN = 'RPAREN', // )
    LBRACKET = 'LBRACKET', // [
    RBRACKET = 'RBRACKET', // ]
    LBRACE = 'LBRACE', // {
    RBRACE = 'RBRACE', // }
    SEMICOLON = 'SEMICOLON', // ;
    COLON = 'COLON', // :
    COMMA = 'COMMA', // ,
    DOT = 'DOT', // .
    QUESTION = 'QUESTION', // ?
    AT = 'AT', // @
    HASH = 'HASH', // #
    TICK = 'TICK', // '
    DOUBLE_COLON = 'DOUBLE_COLON', // ::

    // === Special ===
    EOF = 'EOF',
    UNKNOWN = 'UNKNOWN',
}

/**
 * Token structure
 */
export interface Token {
    /** Token type */
    type: TokenType;
    /** Token lexeme (raw text) */
    value: string;
    /** Source location of the token */
    location: SourceLocation;
}

/**
 * Creates a new token
 */
export function createToken(type: TokenType, value: string, location: SourceLocation): Token {
    return { type, value, location };
}

/**
 * Checks if a token type is a keyword
 */
export function isKeyword(type: TokenType): boolean {
    return (
        type === TokenType.MODULE ||
        type === TokenType.ENDMODULE ||
        type === TokenType.PARAMETER ||
        type === TokenType.LOCALPARAM ||
        type === TokenType.INPUT ||
        type === TokenType.OUTPUT ||
        type === TokenType.INOUT ||
        type === TokenType.WIRE ||
        type === TokenType.TRI ||
        type === TokenType.REG ||
        type === TokenType.LOGIC ||
        type === TokenType.BIT ||
        type === TokenType.INTEGER ||
        type === TokenType.INT ||
        type === TokenType.SHORTINT ||
        type === TokenType.LONGINT ||
        type === TokenType.BYTE ||
        type === TokenType.REAL ||
        type === TokenType.SHORTREAL ||
        type === TokenType.REALTIME ||
        type === TokenType.TIME ||
        type === TokenType.STRING_TYPE ||
        type === TokenType.VOID ||
        type === TokenType.SIGNED ||
        type === TokenType.UNSIGNED ||
        type === TokenType.ENUM ||
        type === TokenType.STRUCT ||
        type === TokenType.TYPEDEF ||
        type === TokenType.PACKED ||
        type === TokenType.ALWAYS ||
        type === TokenType.ALWAYS_FF ||
        type === TokenType.ALWAYS_COMB ||
        type === TokenType.ALWAYS_LATCH ||
        type === TokenType.POSEDGE ||
        type === TokenType.NEGEDGE ||
        type === TokenType.OR ||
        type === TokenType.ASSIGN ||
        type === TokenType.IF ||
        type === TokenType.ELSE ||
        type === TokenType.CASE ||
        type === TokenType.CASEZ ||
        type === TokenType.CASEX ||
        type === TokenType.DEFAULT ||
        type === TokenType.ENDCASE ||
        type === TokenType.FOR ||
        type === TokenType.WHILE ||
        type === TokenType.BEGIN ||
        type === TokenType.END ||
        type === TokenType.GENERATE ||
        type === TokenType.ENDGENERATE ||
        type === TokenType.GENVAR ||
        type === TokenType.RETURN ||
        type === TokenType.FUNCTION ||
        type === TokenType.ENDFUNCTION ||
        type === TokenType.TASK ||
        type === TokenType.ENDTASK ||
        type === TokenType.AUTOMATIC ||
        type === TokenType.INTERFACE ||
        type === TokenType.ENDINTERFACE ||
        type === TokenType.MODPORT ||
        type === TokenType.INITIAL ||
        type === TokenType.CONST
    );
}

/**
 * Checks if a token type is an operator
 */
export function isOperator(type: TokenType): boolean {
    return (
        type === TokenType.PLUS ||
        type === TokenType.MINUS ||
        type === TokenType.STAR ||
        type === TokenType.SLASH ||
        type === TokenType.PERCENT ||
        type === TokenType.POWER ||
        type === TokenType.AMP ||
        type === TokenType.PIPE ||
        type === TokenType.CARET ||
        type === TokenType.TILDE ||
        type === TokenType.BANG ||
        type === TokenType.AMP_AMP ||
        type === TokenType.PIPE_PIPE ||
        type === TokenType.EQ_EQ ||
        type === TokenType.BANG_EQ ||
        type === TokenType.EQ_EQ_EQ ||
        type === TokenType.BANG_EQ_EQ ||
        type === TokenType.LT ||
        type === TokenType.GT ||
        type === TokenType.LT_EQ ||
        type === TokenType.GT_EQ ||
        type === TokenType.LT_LT ||
        type === TokenType.GT_GT ||
        type === TokenType.GT_GT_GT ||
        type === TokenType.LT_LT_LT
    );
}

/**
 * Gets the string representation of a token type
 */
export function tokenTypeName(type: TokenType): string {
    return type;
}
