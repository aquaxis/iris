/**
 * SystemVerilog Keywords Map
 * Maps keyword strings to their corresponding TokenType
 */

import { TokenType } from './token.js';

/**
 * Map of SystemVerilog keywords to token types
 * Only includes keywords needed for synthesis-related constructs
 */
export const KEYWORDS: ReadonlyMap<string, TokenType> = new Map([
    // Module Structure
    ['module', TokenType.MODULE],
    ['endmodule', TokenType.ENDMODULE],
    ['parameter', TokenType.PARAMETER],
    ['localparam', TokenType.LOCALPARAM],
    ['input', TokenType.INPUT],
    ['output', TokenType.OUTPUT],
    ['inout', TokenType.INOUT],

    // Data Types
    ['wire', TokenType.WIRE],
    ['tri', TokenType.TRI],
    ['reg', TokenType.REG],
    ['logic', TokenType.LOGIC],
    ['bit', TokenType.BIT],
    ['integer', TokenType.INTEGER],
    ['int', TokenType.INT],
    ['shortint', TokenType.SHORTINT],
    ['longint', TokenType.LONGINT],
    ['byte', TokenType.BYTE],
    ['real', TokenType.REAL],
    ['shortreal', TokenType.SHORTREAL],
    ['realtime', TokenType.REALTIME],
    ['time', TokenType.TIME],
    ['string', TokenType.STRING_TYPE],
    ['void', TokenType.VOID],
    ['signed', TokenType.SIGNED],
    ['unsigned', TokenType.UNSIGNED],
    ['enum', TokenType.ENUM],
    ['struct', TokenType.STRUCT],
    ['union', TokenType.UNION],
    ['typedef', TokenType.TYPEDEF],
    ['packed', TokenType.PACKED],

    // Always Blocks
    ['always', TokenType.ALWAYS],
    ['always_ff', TokenType.ALWAYS_FF],
    ['always_comb', TokenType.ALWAYS_COMB],
    ['always_latch', TokenType.ALWAYS_LATCH],

    // Sensitivity
    ['posedge', TokenType.POSEDGE],
    ['negedge', TokenType.NEGEDGE],
    ['or', TokenType.OR],

    // Statements
    ['assign', TokenType.ASSIGN],
    ['if', TokenType.IF],
    ['else', TokenType.ELSE],
    ['case', TokenType.CASE],
    ['casez', TokenType.CASEZ],
    ['casex', TokenType.CASEX],
    ['default', TokenType.DEFAULT],
    ['endcase', TokenType.ENDCASE],
    ['for', TokenType.FOR],
    ['while', TokenType.WHILE],
    ['begin', TokenType.BEGIN],
    ['end', TokenType.END],
    ['generate', TokenType.GENERATE],
    ['endgenerate', TokenType.ENDGENERATE],
    ['genvar', TokenType.GENVAR],
    ['return', TokenType.RETURN],

    // Functions/Tasks
    ['function', TokenType.FUNCTION],
    ['endfunction', TokenType.ENDFUNCTION],
    ['task', TokenType.TASK],
    ['endtask', TokenType.ENDTASK],
    ['automatic', TokenType.AUTOMATIC],

    // Interface
    ['assert', TokenType.ASSERT],
    ['interface', TokenType.INTERFACE],
    ['endinterface', TokenType.ENDINTERFACE],
    ['modport', TokenType.MODPORT],

    // Other
    ['initial', TokenType.INITIAL],
    ['const', TokenType.CONST],
]);

/**
 * Checks if a string is a SystemVerilog keyword
 */
export function isKeywordString(str: string): boolean {
    return KEYWORDS.has(str);
}

/**
 * Gets the TokenType for a keyword string, or undefined if not a keyword
 */
export function getKeywordType(str: string): TokenType | undefined {
    return KEYWORDS.get(str);
}

/**
 * Map of multi-character operators (sorted by length, longest first)
 * Used for lexer to match operators
 */
export const OPERATORS: readonly [string, TokenType][] = [
    // 3-character operators
    ['>>>', TokenType.GT_GT_GT],
    ['<<<', TokenType.LT_LT_LT],
    ['===', TokenType.EQ_EQ_EQ],
    ['!==', TokenType.BANG_EQ_EQ],
    ['>>=', TokenType.GT_GT_EQ],
    ['<<=', TokenType.LT_LT_EQ],

    // 2-character operators
    ['**', TokenType.POWER],
    ['~&', TokenType.TILDE_AMP],
    ['~|', TokenType.TILDE_PIPE],
    ['~^', TokenType.TILDE_CARET],
    ['^~', TokenType.CARET_TILDE],
    ['&&', TokenType.AMP_AMP],
    ['||', TokenType.PIPE_PIPE],
    ['==', TokenType.EQ_EQ],
    ['!=', TokenType.BANG_EQ],
    ['<=', TokenType.LT_EQ],
    ['>=', TokenType.GT_EQ],
    ['<<', TokenType.LT_LT],
    ['>>', TokenType.GT_GT],
    ['+=', TokenType.PLUS_EQ],
    ['-=', TokenType.MINUS_EQ],
    ['*=', TokenType.STAR_EQ],
    ['/=', TokenType.SLASH_EQ],
    ['%=', TokenType.PERCENT_EQ],
    ['&=', TokenType.AMP_EQ],
    ['|=', TokenType.PIPE_EQ],
    ['^=', TokenType.CARET_EQ],
    ['::', TokenType.DOUBLE_COLON],
    ['+:', TokenType.PLUS_COLON],
    ['-:', TokenType.MINUS_COLON],

    // 1-character operators
    ['+', TokenType.PLUS],
    ['-', TokenType.MINUS],
    ['*', TokenType.STAR],
    ['/', TokenType.SLASH],
    ['%', TokenType.PERCENT],
    ['&', TokenType.AMP],
    ['|', TokenType.PIPE],
    ['^', TokenType.CARET],
    ['~', TokenType.TILDE],
    ['!', TokenType.BANG],
    ['<', TokenType.LT],
    ['>', TokenType.GT],
    ['=', TokenType.EQ],
];

/**
 * Map of single-character punctuation
 */
export const PUNCTUATION: ReadonlyMap<string, TokenType> = new Map([
    ['(', TokenType.LPAREN],
    [')', TokenType.RPAREN],
    ['[', TokenType.LBRACKET],
    [']', TokenType.RBRACKET],
    ['{', TokenType.LBRACE],
    ['}', TokenType.RBRACE],
    [';', TokenType.SEMICOLON],
    [':', TokenType.COLON],
    [',', TokenType.COMMA],
    ['.', TokenType.DOT],
    ['?', TokenType.QUESTION],
    ['@', TokenType.AT],
    ['#', TokenType.HASH],
    ["'", TokenType.TICK],
]);

/**
 * Gets the punctuation token type for a character
 */
export function getPunctuationType(char: string): TokenType | undefined {
    return PUNCTUATION.get(char);
}
