/**
 * Operator Precedence Table for SystemVerilog
 * Based on IEEE 1800-2017 operator precedence (Table 11-2)
 */

import { TokenType } from '../lexer/token.js';

/**
 * Precedence levels (higher = binds tighter)
 * Based on SystemVerilog operator precedence
 */
export enum Precedence {
    NONE = 0,
    CONDITIONAL = 1, // ?:
    LOGICAL_OR = 2, // ||
    LOGICAL_AND = 3, // &&
    BITWISE_OR = 4, // |
    BITWISE_XOR = 5, // ^ ~^
    BITWISE_AND = 6, // &
    EQUALITY = 7, // == != === !==
    RELATIONAL = 8, // < <= > >=
    SHIFT = 9, // << >> <<< >>>
    ADDITIVE = 10, // + -
    MULTIPLICATIVE = 11, // * / %
    POWER = 12, // **
    UNARY = 13, // ! ~ + - & | ^ ~& ~| ~^
    POSTFIX = 14, // [] . ()
}

/**
 * Associativity of operators
 */
export enum Associativity {
    LEFT,
    RIGHT,
    NONE,
}

/**
 * Information about a binary operator
 */
export interface BinaryOpInfo {
    precedence: Precedence;
    associativity: Associativity;
}

/**
 * Map of token types to their binary operator info
 */
export const BINARY_OP_INFO: ReadonlyMap<TokenType, BinaryOpInfo> = new Map([
    // Conditional (right-to-left)
    [
        TokenType.QUESTION,
        { precedence: Precedence.CONDITIONAL, associativity: Associativity.RIGHT },
    ],

    // Logical OR (left-to-right)
    [TokenType.PIPE_PIPE, { precedence: Precedence.LOGICAL_OR, associativity: Associativity.LEFT }],

    // Logical AND (left-to-right)
    [TokenType.AMP_AMP, { precedence: Precedence.LOGICAL_AND, associativity: Associativity.LEFT }],

    // Bitwise OR (left-to-right)
    [TokenType.PIPE, { precedence: Precedence.BITWISE_OR, associativity: Associativity.LEFT }],

    // Bitwise XOR (left-to-right)
    [TokenType.CARET, { precedence: Precedence.BITWISE_XOR, associativity: Associativity.LEFT }],
    [
        TokenType.TILDE_CARET,
        { precedence: Precedence.BITWISE_XOR, associativity: Associativity.LEFT },
    ],
    [
        TokenType.CARET_TILDE,
        { precedence: Precedence.BITWISE_XOR, associativity: Associativity.LEFT },
    ],

    // Bitwise AND (left-to-right)
    [TokenType.AMP, { precedence: Precedence.BITWISE_AND, associativity: Associativity.LEFT }],

    // Equality (left-to-right)
    [TokenType.EQ_EQ, { precedence: Precedence.EQUALITY, associativity: Associativity.LEFT }],
    [TokenType.BANG_EQ, { precedence: Precedence.EQUALITY, associativity: Associativity.LEFT }],
    [TokenType.EQ_EQ_EQ, { precedence: Precedence.EQUALITY, associativity: Associativity.LEFT }],
    [TokenType.BANG_EQ_EQ, { precedence: Precedence.EQUALITY, associativity: Associativity.LEFT }],

    // Relational (left-to-right)
    [TokenType.LT, { precedence: Precedence.RELATIONAL, associativity: Associativity.LEFT }],
    [TokenType.GT, { precedence: Precedence.RELATIONAL, associativity: Associativity.LEFT }],
    [TokenType.LT_EQ, { precedence: Precedence.RELATIONAL, associativity: Associativity.LEFT }],
    [TokenType.GT_EQ, { precedence: Precedence.RELATIONAL, associativity: Associativity.LEFT }],

    // Shift (left-to-right)
    [TokenType.LT_LT, { precedence: Precedence.SHIFT, associativity: Associativity.LEFT }],
    [TokenType.GT_GT, { precedence: Precedence.SHIFT, associativity: Associativity.LEFT }],
    [TokenType.LT_LT_LT, { precedence: Precedence.SHIFT, associativity: Associativity.LEFT }],
    [TokenType.GT_GT_GT, { precedence: Precedence.SHIFT, associativity: Associativity.LEFT }],

    // Additive (left-to-right)
    [TokenType.PLUS, { precedence: Precedence.ADDITIVE, associativity: Associativity.LEFT }],
    [TokenType.MINUS, { precedence: Precedence.ADDITIVE, associativity: Associativity.LEFT }],

    // Multiplicative (left-to-right)
    [TokenType.STAR, { precedence: Precedence.MULTIPLICATIVE, associativity: Associativity.LEFT }],
    [TokenType.SLASH, { precedence: Precedence.MULTIPLICATIVE, associativity: Associativity.LEFT }],
    [
        TokenType.PERCENT,
        { precedence: Precedence.MULTIPLICATIVE, associativity: Associativity.LEFT },
    ],

    // Power (right-to-left in some languages, but left-to-right in Verilog)
    [TokenType.POWER, { precedence: Precedence.POWER, associativity: Associativity.LEFT }],
]);

/**
 * Set of unary prefix operators
 */
export const UNARY_PREFIX_OPS: ReadonlySet<TokenType> = new Set([
    TokenType.BANG, // !
    TokenType.TILDE, // ~
    TokenType.PLUS, // +
    TokenType.MINUS, // -
    TokenType.AMP, // & (reduction)
    TokenType.PIPE, // | (reduction)
    TokenType.CARET, // ^ (reduction)
    TokenType.TILDE_AMP, // ~&
    TokenType.TILDE_PIPE, // ~|
    TokenType.TILDE_CARET, // ~^
]);

/**
 * Gets binary operator info for a token type
 */
export function getBinaryOpInfo(type: TokenType): BinaryOpInfo | undefined {
    return BINARY_OP_INFO.get(type);
}

/**
 * Checks if a token type is a unary prefix operator
 */
export function isUnaryPrefixOp(type: TokenType): boolean {
    return UNARY_PREFIX_OPS.has(type);
}

/**
 * Gets the precedence of a token type
 */
export function getPrecedence(type: TokenType): Precedence {
    const info = BINARY_OP_INFO.get(type);
    return info?.precedence ?? Precedence.NONE;
}

/**
 * Converts TokenType to BinaryOp string
 */
export function tokenTypeToBinaryOp(
    type: TokenType
):
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '**'
    | '&'
    | '|'
    | '^'
    | '~^'
    | '^~'
    | '&&'
    | '||'
    | '=='
    | '!='
    | '==='
    | '!=='
    | '<'
    | '>'
    | '<='
    | '>='
    | '<<'
    | '>>'
    | '<<<'
    | '>>>'
    | undefined {
    switch (type) {
        case TokenType.PLUS:
            return '+';
        case TokenType.MINUS:
            return '-';
        case TokenType.STAR:
            return '*';
        case TokenType.SLASH:
            return '/';
        case TokenType.PERCENT:
            return '%';
        case TokenType.POWER:
            return '**';
        case TokenType.AMP:
            return '&';
        case TokenType.PIPE:
            return '|';
        case TokenType.CARET:
            return '^';
        case TokenType.TILDE_CARET:
            return '~^';
        case TokenType.CARET_TILDE:
            return '^~';
        case TokenType.AMP_AMP:
            return '&&';
        case TokenType.PIPE_PIPE:
            return '||';
        case TokenType.EQ_EQ:
            return '==';
        case TokenType.BANG_EQ:
            return '!=';
        case TokenType.EQ_EQ_EQ:
            return '===';
        case TokenType.BANG_EQ_EQ:
            return '!==';
        case TokenType.LT:
            return '<';
        case TokenType.GT:
            return '>';
        case TokenType.LT_EQ:
            return '<=';
        case TokenType.GT_EQ:
            return '>=';
        case TokenType.LT_LT:
            return '<<';
        case TokenType.GT_GT:
            return '>>';
        case TokenType.LT_LT_LT:
            return '<<<';
        case TokenType.GT_GT_GT:
            return '>>>';
        default:
            return undefined;
    }
}

/**
 * Converts TokenType to UnaryOp string
 */
export function tokenTypeToUnaryOp(
    type: TokenType
): '+' | '-' | '!' | '~' | '&' | '~&' | '|' | '~|' | '^' | '~^' | '^~' | undefined {
    switch (type) {
        case TokenType.PLUS:
            return '+';
        case TokenType.MINUS:
            return '-';
        case TokenType.BANG:
            return '!';
        case TokenType.TILDE:
            return '~';
        case TokenType.AMP:
            return '&';
        case TokenType.TILDE_AMP:
            return '~&';
        case TokenType.PIPE:
            return '|';
        case TokenType.TILDE_PIPE:
            return '~|';
        case TokenType.CARET:
            return '^';
        case TokenType.TILDE_CARET:
            return '~^';
        case TokenType.CARET_TILDE:
            return '^~';
        default:
            return undefined;
    }
}
