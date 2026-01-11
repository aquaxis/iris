/**
 * IRIS AST Node Definitions
 * Defines the Abstract Syntax Tree structure for IRIS language
 */

import type { SourceLocation } from '../utils/source-location.js';

// ============================================================================
// Base Types
// ============================================================================

/**
 * All possible IRIS AST node kinds
 */
export type IrNodeKind =
    // Source
    | 'SourceFile'
    // Module
    | 'ModDef'
    | 'GenericParam'
    | 'PortDecl'
    // Types
    | 'TypeExpr'
    | 'EnumDef'
    | 'StructDef'
    | 'TypeAlias'
    // Declarations
    | 'LetDecl'
    | 'VarDecl'
    | 'ConstDecl'
    | 'InstDecl'
    | 'MemDecl'
    // Logic Blocks
    | 'CombBlock'
    | 'SyncBlock'
    // Statements
    | 'AssignStmt'
    | 'IfStmt'
    | 'MatchStmt'
    | 'MatchArm'
    | 'ForStmt'
    | 'WhileStmt'
    | 'BlockStmt'
    // Expressions
    | 'Identifier'
    | 'Literal'
    | 'BinaryExpr'
    | 'UnaryExpr'
    | 'IfExpr'
    | 'MatchExpr'
    | 'CallExpr'
    | 'IndexExpr'
    | 'FieldExpr'
    | 'CastExpr'
    | 'ConcatExpr'
    | 'RepeatExpr'
    | 'ParenExpr';

/**
 * Base interface for all IRIS AST nodes
 */
export interface IrAstNode {
    kind: IrNodeKind;
    location: SourceLocation;
}

// ============================================================================
// Source File
// ============================================================================

export interface IrSourceFile extends IrAstNode {
    kind: 'SourceFile';
    items: IrItem[];
}

export type IrItem = IrModDef | IrEnumDef | IrStructDef | IrTypeAlias | IrConstDecl;

// ============================================================================
// Module Definition
// ============================================================================

export interface IrModDef extends IrAstNode {
    kind: 'ModDef';
    name: string;
    isPublic: boolean;
    generics: IrGenericParam[];
    ports: IrPortDecl[];
    items: IrModItem[];
}

export type IrModItem =
    | IrLetDecl
    | IrVarDecl
    | IrConstDecl
    | IrCombBlock
    | IrSyncBlock
    | IrInstDecl
    | IrMemDecl
    | IrTypeAlias;

export interface IrGenericParam extends IrAstNode {
    kind: 'GenericParam';
    name: string;
    bound: IrGenericBound;
    defaultValue?: IrExpr;
}

export type IrGenericBound = 'type' | 'uint' | 'int' | 'bool' | IrTypeExpr;

export type IrPortDirection = 'in' | 'out' | 'inout';

export interface IrPortDecl extends IrAstNode {
    kind: 'PortDecl';
    direction: IrPortDirection;
    name: string;
    typeExpr: IrTypeExpr;
}

// ============================================================================
// Type Expressions
// ============================================================================

export type IrPrimitiveType = 'bit' | 'int' | 'uint' | 'bool' | 'clock' | 'reset' | 'string';

export interface IrTypeExpr extends IrAstNode {
    kind: 'TypeExpr';
    baseType: IrPrimitiveType | 'array' | 'tuple' | 'user';
    width?: IrExpr; // For bit[N], int[N], uint[N]
    elementType?: IrTypeExpr; // For array types
    arraySize?: IrExpr; // For array[N]
    tupleTypes?: IrTypeExpr[]; // For tuple types
    typeName?: string; // For user-defined types
    genericArgs?: IrExpr[]; // For generic types
}

// ============================================================================
// Enum and Struct Definitions
// ============================================================================

export interface IrEnumDef extends IrAstNode {
    kind: 'EnumDef';
    name: string;
    isPublic: boolean;
    generics: IrGenericParam[];
    variants: IrEnumVariant[];
}

export interface IrEnumVariant {
    name: string;
    value?: IrExpr;
}

export interface IrStructDef extends IrAstNode {
    kind: 'StructDef';
    name: string;
    isPublic: boolean;
    generics: IrGenericParam[];
    fields: IrStructField[];
}

export interface IrStructField {
    name: string;
    typeExpr: IrTypeExpr;
}

export interface IrTypeAlias extends IrAstNode {
    kind: 'TypeAlias';
    name: string;
    isPublic: boolean;
    generics: IrGenericParam[];
    targetType: IrTypeExpr;
}

// ============================================================================
// Declarations
// ============================================================================

export interface IrLetDecl extends IrAstNode {
    kind: 'LetDecl';
    name: string;
    isMutable: boolean;
    typeExpr?: IrTypeExpr;
    initialValue?: IrExpr;
}

export interface IrVarDecl extends IrAstNode {
    kind: 'VarDecl';
    name: string;
    typeExpr?: IrTypeExpr;
    initialValue?: IrExpr;
}

export interface IrConstDecl extends IrAstNode {
    kind: 'ConstDecl';
    name: string;
    isPublic: boolean;
    typeExpr: IrTypeExpr;
    value: IrExpr;
}

export interface IrInstDecl extends IrAstNode {
    kind: 'InstDecl';
    name: string;
    modulePath: string;
    genericArgs?: IrExpr[];
    connections: IrConnection[];
}

export interface IrConnection {
    portName: string;
    expr: IrExpr;
}

export interface IrMemDecl extends IrAstNode {
    kind: 'MemDecl';
    name: string;
    elementType: IrTypeExpr;
    depth: IrExpr;
    config?: IrMemConfig;
    initializer?: IrExpr;
}

export interface IrMemConfig {
    ports?: number;
    memType?: 'ram' | 'rom';
    readMode?: 'sync' | 'async';
    writeMode?: 'sync';
}

// ============================================================================
// Logic Blocks
// ============================================================================

export interface IrCombBlock extends IrAstNode {
    kind: 'CombBlock';
    statements: IrStmt[];
}

export interface IrSyncBlock extends IrAstNode {
    kind: 'SyncBlock';
    clock: IrClockSpec;
    reset?: IrResetSpec;
    statements: IrStmt[];
}

export interface IrClockSpec {
    signal: IrExpr;
    edge: 'posedge' | 'negedge';
}

export interface IrResetSpec {
    signal: IrExpr;
    mode: 'async' | 'sync';
}

// ============================================================================
// Statements
// ============================================================================

export type IrStmt =
    | IrAssignStmt
    | IrIfStmt
    | IrMatchStmt
    | IrForStmt
    | IrWhileStmt
    | IrBlockStmt
    | IrLetDecl
    | IrVarDecl;

export interface IrAssignStmt extends IrAstNode {
    kind: 'AssignStmt';
    target: IrExpr;
    value: IrExpr;
}

export interface IrIfStmt extends IrAstNode {
    kind: 'IfStmt';
    condition: IrExpr;
    thenBlock: IrStmt[];
    elseBlock?: IrStmt[] | IrIfStmt;
}

export interface IrMatchStmt extends IrAstNode {
    kind: 'MatchStmt';
    expr: IrExpr;
    arms: IrMatchArm[];
}

export interface IrMatchArm extends IrAstNode {
    kind: 'MatchArm';
    pattern: IrPattern;
    body: IrExpr | IrStmt[];
}

export type IrPattern =
    | { kind: 'literal'; value: IrExpr }
    | { kind: 'identifier'; name: string }
    | { kind: 'wildcard' }
    | { kind: 'range'; start: IrExpr; end: IrExpr; inclusive: boolean };

export interface IrForStmt extends IrAstNode {
    kind: 'ForStmt';
    variable: string;
    start: IrExpr;
    end: IrExpr;
    inclusive: boolean;
    body: IrStmt[];
}

export interface IrWhileStmt extends IrAstNode {
    kind: 'WhileStmt';
    condition: IrExpr;
    body: IrStmt[];
}

export interface IrBlockStmt extends IrAstNode {
    kind: 'BlockStmt';
    statements: IrStmt[];
}

// ============================================================================
// Expressions
// ============================================================================

export type IrExpr =
    | IrIdentifier
    | IrLiteral
    | IrBinaryExpr
    | IrUnaryExpr
    | IrIfExpr
    | IrMatchExpr
    | IrCallExpr
    | IrIndexExpr
    | IrFieldExpr
    | IrCastExpr
    | IrConcatExpr
    | IrRepeatExpr
    | IrParenExpr;

export interface IrIdentifier extends IrAstNode {
    kind: 'Identifier';
    name: string;
}

export type IrLiteralKind = 'integer' | 'bool' | 'string';

export interface IrLiteral extends IrAstNode {
    kind: 'Literal';
    literalKind: IrLiteralKind;
    value: string;
    width?: number; // For sized integers
    base?: 'b' | 'o' | 'd' | 'h';
}

export type IrBinaryOp =
    // Arithmetic
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '**'
    // Bitwise
    | '&'
    | '|'
    | '^'
    | '<<'
    | '>>'
    | '>>>'
    // Comparison
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    // Logical
    | '&&'
    | '||';

export interface IrBinaryExpr extends IrAstNode {
    kind: 'BinaryExpr';
    operator: IrBinaryOp;
    left: IrExpr;
    right: IrExpr;
}

export type IrUnaryOp = '!' | '~' | '-' | '&' | '|' | '^';

export interface IrUnaryExpr extends IrAstNode {
    kind: 'UnaryExpr';
    operator: IrUnaryOp;
    operand: IrExpr;
}

export interface IrIfExpr extends IrAstNode {
    kind: 'IfExpr';
    condition: IrExpr;
    thenExpr: IrExpr;
    elseExpr: IrExpr;
}

export interface IrMatchExpr extends IrAstNode {
    kind: 'MatchExpr';
    expr: IrExpr;
    arms: IrMatchArm[];
}

export interface IrCallExpr extends IrAstNode {
    kind: 'CallExpr';
    callee: IrExpr;
    args: IrExpr[];
}

export interface IrIndexExpr extends IrAstNode {
    kind: 'IndexExpr';
    base: IrExpr;
    index: IrExpr;
    endIndex?: IrExpr; // For slices [start:end]
}

export interface IrFieldExpr extends IrAstNode {
    kind: 'FieldExpr';
    object: IrExpr;
    field: string;
}

export interface IrCastExpr extends IrAstNode {
    kind: 'CastExpr';
    expr: IrExpr;
    targetType: IrTypeExpr;
}

export interface IrConcatExpr extends IrAstNode {
    kind: 'ConcatExpr';
    elements: IrExpr[];
}

export interface IrRepeatExpr extends IrAstNode {
    kind: 'RepeatExpr';
    expr: IrExpr;
    count: IrExpr;
}

export interface IrParenExpr extends IrAstNode {
    kind: 'ParenExpr';
    expr: IrExpr;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createIrSourceFile(items: IrItem[], location: SourceLocation): IrSourceFile {
    return { kind: 'SourceFile', items, location };
}

export function createIrModDef(
    name: string,
    generics: IrGenericParam[],
    ports: IrPortDecl[],
    items: IrModItem[],
    location: SourceLocation,
    isPublic = false
): IrModDef {
    return { kind: 'ModDef', name, isPublic, generics, ports, items, location };
}

export function createIrPortDecl(
    direction: IrPortDirection,
    name: string,
    typeExpr: IrTypeExpr,
    location: SourceLocation
): IrPortDecl {
    return { kind: 'PortDecl', direction, name, typeExpr, location };
}

export function createIrTypeExpr(
    baseType: IrPrimitiveType | 'array' | 'tuple' | 'user',
    location: SourceLocation,
    options?: {
        width?: IrExpr;
        elementType?: IrTypeExpr;
        arraySize?: IrExpr;
        tupleTypes?: IrTypeExpr[];
        typeName?: string;
        genericArgs?: IrExpr[];
    }
): IrTypeExpr {
    return {
        kind: 'TypeExpr',
        baseType,
        location,
        ...options,
    };
}

export function createIrIdentifier(name: string, location: SourceLocation): IrIdentifier {
    return { kind: 'Identifier', name, location };
}

export function createIrLiteral(
    literalKind: IrLiteralKind,
    value: string,
    location: SourceLocation,
    options?: { width?: number; base?: 'b' | 'o' | 'd' | 'h' }
): IrLiteral {
    return { kind: 'Literal', literalKind, value, location, ...options };
}

export function createIrBinaryExpr(
    operator: IrBinaryOp,
    left: IrExpr,
    right: IrExpr,
    location: SourceLocation
): IrBinaryExpr {
    return { kind: 'BinaryExpr', operator, left, right, location };
}

export function createIrUnaryExpr(
    operator: IrUnaryOp,
    operand: IrExpr,
    location: SourceLocation
): IrUnaryExpr {
    return { kind: 'UnaryExpr', operator, operand, location };
}

export function createIrIfExpr(
    condition: IrExpr,
    thenExpr: IrExpr,
    elseExpr: IrExpr,
    location: SourceLocation
): IrIfExpr {
    return { kind: 'IfExpr', condition, thenExpr, elseExpr, location };
}

export function createIrConcatExpr(elements: IrExpr[], location: SourceLocation): IrConcatExpr {
    return { kind: 'ConcatExpr', elements, location };
}

export function createIrRepeatExpr(
    expr: IrExpr,
    count: IrExpr,
    location: SourceLocation
): IrRepeatExpr {
    return { kind: 'RepeatExpr', expr, count, location };
}

export function createIrLetDecl(
    name: string,
    location: SourceLocation,
    options?: {
        isMutable?: boolean;
        typeExpr?: IrTypeExpr;
        initialValue?: IrExpr;
    }
): IrLetDecl {
    return {
        kind: 'LetDecl',
        name,
        isMutable: options?.isMutable ?? false,
        typeExpr: options?.typeExpr,
        initialValue: options?.initialValue,
        location,
    };
}

export function createIrAssignStmt(
    target: IrExpr,
    value: IrExpr,
    location: SourceLocation
): IrAssignStmt {
    return { kind: 'AssignStmt', target, value, location };
}

export function createIrIfStmt(
    condition: IrExpr,
    thenBlock: IrStmt[],
    location: SourceLocation,
    elseBlock?: IrStmt[] | IrIfStmt
): IrIfStmt {
    return { kind: 'IfStmt', condition, thenBlock, elseBlock, location };
}

export function createIrCombBlock(statements: IrStmt[], location: SourceLocation): IrCombBlock {
    return { kind: 'CombBlock', statements, location };
}

export function createIrSyncBlock(
    clock: IrClockSpec,
    statements: IrStmt[],
    location: SourceLocation,
    reset?: IrResetSpec
): IrSyncBlock {
    return { kind: 'SyncBlock', clock, reset, statements, location };
}

export function createIrInstDecl(
    name: string,
    modulePath: string,
    connections: IrConnection[],
    location: SourceLocation,
    genericArgs?: IrExpr[]
): IrInstDecl {
    return { kind: 'InstDecl', name, modulePath, genericArgs, connections, location };
}

export function createIrMatchStmt(
    expr: IrExpr,
    arms: IrMatchArm[],
    location: SourceLocation
): IrMatchStmt {
    return { kind: 'MatchStmt', expr, arms, location };
}

export function createIrMatchArm(
    pattern: IrPattern,
    body: IrExpr | IrStmt[],
    location: SourceLocation
): IrMatchArm {
    return { kind: 'MatchArm', pattern, body, location };
}

export function createIrForStmt(
    variable: string,
    start: IrExpr,
    end: IrExpr,
    body: IrStmt[],
    location: SourceLocation,
    inclusive = false
): IrForStmt {
    return { kind: 'ForStmt', variable, start, end, inclusive, body, location };
}

export function createIrIndexExpr(
    base: IrExpr,
    index: IrExpr,
    location: SourceLocation,
    endIndex?: IrExpr
): IrIndexExpr {
    return { kind: 'IndexExpr', base, index, endIndex, location };
}

export function createIrGenericParam(
    name: string,
    bound: IrGenericBound,
    location: SourceLocation,
    defaultValue?: IrExpr
): IrGenericParam {
    return { kind: 'GenericParam', name, bound, defaultValue, location };
}
