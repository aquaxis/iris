/**
 * SystemVerilog AST Node Definitions
 * Defines the Abstract Syntax Tree structure for parsed SystemVerilog code
 */

import type { SourceLocation } from '../utils/source-location.js';

// ============================================================================
// Base Types
// ============================================================================

/**
 * All possible AST node kinds
 */
export type SvNodeKind =
    // Source
    | 'SourceFile'
    // Module
    | 'ModuleDecl'
    | 'ParameterDecl'
    | 'PortDecl'
    // Types
    | 'DataType'
    | 'EnumDecl'
    | 'StructDecl'
    | 'TypedefDecl'
    // Declarations
    | 'VariableDecl'
    | 'NetDecl'
    | 'ConstDecl'
    // Statements
    | 'AlwaysStmt'
    | 'AssignStmt'
    | 'BlockingAssign'
    | 'NonBlockingAssign'
    | 'IfStmt'
    | 'CaseStmt'
    | 'CaseItem'
    | 'ForStmt'
    | 'WhileStmt'
    | 'BlockStmt'
    | 'ContinuousAssign'
    // Generate
    | 'GenerateBlock'
    | 'GenerateIf'
    | 'GenerateFor'
    // Expressions
    | 'Identifier'
    | 'NumberLiteral'
    | 'StringLiteral'
    | 'BinaryExpr'
    | 'UnaryExpr'
    | 'ConditionalExpr'
    | 'ConcatExpr'
    | 'ReplicateExpr'
    | 'IndexExpr'
    | 'SliceExpr'
    | 'MemberExpr'
    | 'CallExpr'
    | 'ParenExpr'
    // Sensitivity
    | 'SensitivityList'
    | 'SensitivityItem'
    // Instance
    | 'ModuleInst';

/**
 * Base interface for all AST nodes
 */
export interface SvAstNode {
    kind: SvNodeKind;
    location: SourceLocation;
}

// ============================================================================
// Source File
// ============================================================================

export interface SvSourceFile extends SvAstNode {
    kind: 'SourceFile';
    modules: SvModuleDecl[];
}

// ============================================================================
// Module Structure
// ============================================================================

export interface SvModuleDecl extends SvAstNode {
    kind: 'ModuleDecl';
    name: string;
    parameters: SvParameterDecl[];
    ports: SvPortDecl[];
    items: SvModuleItem[];
}

export type SvModuleItem =
    | SvVariableDecl
    | SvNetDecl
    | SvConstDecl
    | SvAlwaysStmt
    | SvContinuousAssign
    | SvModuleInst
    | SvEnumDecl
    | SvStructDecl
    | SvTypedefDecl
    | SvGenerateBlock;

export interface SvParameterDecl extends SvAstNode {
    kind: 'ParameterDecl';
    name: string;
    dataType?: SvDataType;
    defaultValue?: SvExpr;
    isLocal: boolean; // localparam vs parameter
}

export type PortDirection = 'input' | 'output' | 'inout';

export interface SvPortDecl extends SvAstNode {
    kind: 'PortDecl';
    direction: PortDirection;
    name: string;
    dataType: SvDataType;
}

// ============================================================================
// Data Types
// ============================================================================

export type BaseType =
    | 'logic'
    | 'reg'
    | 'wire'
    | 'integer'
    | 'int'
    | 'shortint'
    | 'longint'
    | 'byte'
    | 'bit'
    | 'real'
    | 'shortreal'
    | 'realtime'
    | 'time'
    | 'string'
    | 'void'
    | 'enum'
    | 'struct'
    | 'user'; // User-defined type

export interface SvDataType extends SvAstNode {
    kind: 'DataType';
    baseType: BaseType;
    signed?: boolean;
    packed?: boolean;
    width?: SvExpr; // For bit vectors: [N-1:0] -> width = N
    msb?: SvExpr; // MSB of range
    lsb?: SvExpr; // LSB of range
    dimensions?: SvExpr[]; // Array dimensions
    typeName?: string; // For user-defined types
}

export interface SvEnumDecl extends SvAstNode {
    kind: 'EnumDecl';
    name?: string;
    baseType?: SvDataType;
    members: SvEnumMember[];
}

export interface SvEnumMember {
    name: string;
    value?: SvExpr;
}

export interface SvStructDecl extends SvAstNode {
    kind: 'StructDecl';
    name?: string;
    packed?: boolean;
    members: SvStructMember[];
}

export interface SvStructMember {
    name: string;
    dataType: SvDataType;
}

export interface SvTypedefDecl extends SvAstNode {
    kind: 'TypedefDecl';
    name: string;
    targetType: SvDataType | SvEnumDecl | SvStructDecl;
}

// ============================================================================
// Declarations
// ============================================================================

export interface SvVariableDecl extends SvAstNode {
    kind: 'VariableDecl';
    names: string[]; // Multiple variable names support
    dataType: SvDataType;
    initialValue?: SvExpr;
}

export interface SvNetDecl extends SvAstNode {
    kind: 'NetDecl';
    names: string[]; // Multiple variable names support
    netType: 'wire' | 'tri' | 'wand' | 'wor' | 'supply0' | 'supply1';
    dataType: SvDataType;
    initialValue?: SvExpr;
}

export interface SvConstDecl extends SvAstNode {
    kind: 'ConstDecl';
    name: string;
    dataType?: SvDataType;
    value: SvExpr;
}

// ============================================================================
// Statements
// ============================================================================

export type SvStmt =
    | SvBlockStmt
    | SvBlockingAssign
    | SvNonBlockingAssign
    | SvIfStmt
    | SvCaseStmt
    | SvForStmt
    | SvWhileStmt
    | SvVariableDecl;

export type AlwaysType = 'always' | 'always_ff' | 'always_comb' | 'always_latch';

export interface SvAlwaysStmt extends SvAstNode {
    kind: 'AlwaysStmt';
    alwaysType: AlwaysType;
    sensitivity?: SvSensitivityList;
    body: SvStmt;
}

export interface SvContinuousAssign extends SvAstNode {
    kind: 'ContinuousAssign';
    target: SvExpr;
    value: SvExpr;
}

export interface SvBlockStmt extends SvAstNode {
    kind: 'BlockStmt';
    label?: string;
    statements: SvStmt[];
}

export interface SvBlockingAssign extends SvAstNode {
    kind: 'BlockingAssign';
    target: SvExpr;
    value: SvExpr;
}

export interface SvNonBlockingAssign extends SvAstNode {
    kind: 'NonBlockingAssign';
    target: SvExpr;
    value: SvExpr;
}

export interface SvIfStmt extends SvAstNode {
    kind: 'IfStmt';
    condition: SvExpr;
    thenBranch: SvStmt;
    elseBranch?: SvStmt;
}

export type CaseType = 'case' | 'casez' | 'casex';

export interface SvCaseStmt extends SvAstNode {
    kind: 'CaseStmt';
    caseType: CaseType;
    expr: SvExpr;
    items: SvCaseItem[];
    defaultItem?: SvStmt;
}

export interface SvCaseItem extends SvAstNode {
    kind: 'CaseItem';
    patterns: SvExpr[];
    body: SvStmt;
}

export interface SvForStmt extends SvAstNode {
    kind: 'ForStmt';
    init?: SvStmt;
    condition?: SvExpr;
    update?: SvStmt;
    body: SvStmt;
}

export interface SvWhileStmt extends SvAstNode {
    kind: 'WhileStmt';
    condition: SvExpr;
    body: SvStmt;
}

// ============================================================================
// Generate Statements
// ============================================================================

export type SvGenerateItem = SvGenerateIf | SvGenerateFor | SvModuleItem;

export interface SvGenerateBlock extends SvAstNode {
    kind: 'GenerateBlock';
    items: SvGenerateItem[];
}

export interface SvGenerateIf extends SvAstNode {
    kind: 'GenerateIf';
    condition: SvExpr;
    thenBlock: SvGenerateItem[];
    elseBlock?: SvGenerateItem[];
}

export interface SvGenerateFor extends SvAstNode {
    kind: 'GenerateFor';
    init: SvStmt;
    condition: SvExpr;
    update: SvStmt;
    label?: string;
    body: SvGenerateItem[];
}

// ============================================================================
// Sensitivity List
// ============================================================================

export interface SvSensitivityList extends SvAstNode {
    kind: 'SensitivityList';
    items: SvSensitivityItem[];
    isWildcard: boolean; // @(*)
}

export type EdgeType = 'posedge' | 'negedge' | 'none';

export interface SvSensitivityItem extends SvAstNode {
    kind: 'SensitivityItem';
    edge: EdgeType;
    signal: SvExpr;
}

// ============================================================================
// Module Instance
// ============================================================================

export interface SvModuleInst extends SvAstNode {
    kind: 'ModuleInst';
    moduleName: string;
    instanceName: string;
    parameters: SvParamAssign[];
    connections: SvPortConnection[];
}

export interface SvParamAssign {
    name?: string; // Named: .WIDTH(8), Positional: undefined
    value: SvExpr;
}

export interface SvPortConnection {
    portName?: string; // Named: .clk(clock), Positional: undefined
    expr?: SvExpr; // Can be empty for .port()
}

// ============================================================================
// Expressions
// ============================================================================

export type SvExpr =
    | SvIdentifier
    | SvNumberLiteral
    | SvStringLiteral
    | SvBinaryExpr
    | SvUnaryExpr
    | SvConditionalExpr
    | SvConcatExpr
    | SvReplicateExpr
    | SvIndexExpr
    | SvSliceExpr
    | SvMemberExpr
    | SvCallExpr
    | SvParenExpr;

export interface SvIdentifier extends SvAstNode {
    kind: 'Identifier';
    name: string;
}

export interface SvNumberLiteral extends SvAstNode {
    kind: 'NumberLiteral';
    value: string; // Raw string representation
    size?: number; // Bit width if specified
    base?: 'b' | 'o' | 'd' | 'h';
    signed?: boolean;
}

export interface SvStringLiteral extends SvAstNode {
    kind: 'StringLiteral';
    value: string;
}

export type BinaryOp =
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
    | '~^'
    | '^~'
    // Logical
    | '&&'
    | '||'
    // Comparison
    | '=='
    | '!='
    | '==='
    | '!=='
    | '<'
    | '>'
    | '<='
    | '>='
    // Shift
    | '<<'
    | '>>'
    | '<<<'
    | '>>>';

export interface SvBinaryExpr extends SvAstNode {
    kind: 'BinaryExpr';
    operator: BinaryOp;
    left: SvExpr;
    right: SvExpr;
}

export type UnaryOp = '+' | '-' | '!' | '~' | '&' | '~&' | '|' | '~|' | '^' | '~^' | '^~';

export interface SvUnaryExpr extends SvAstNode {
    kind: 'UnaryExpr';
    operator: UnaryOp;
    operand: SvExpr;
}

export interface SvConditionalExpr extends SvAstNode {
    kind: 'ConditionalExpr';
    condition: SvExpr;
    thenExpr: SvExpr;
    elseExpr: SvExpr;
}

export interface SvConcatExpr extends SvAstNode {
    kind: 'ConcatExpr';
    elements: SvExpr[];
}

export interface SvReplicateExpr extends SvAstNode {
    kind: 'ReplicateExpr';
    count: SvExpr;
    expr: SvExpr;
}

export interface SvIndexExpr extends SvAstNode {
    kind: 'IndexExpr';
    base: SvExpr;
    index: SvExpr;
}

export interface SvSliceExpr extends SvAstNode {
    kind: 'SliceExpr';
    base: SvExpr;
    msb: SvExpr;
    lsb: SvExpr;
}

export interface SvMemberExpr extends SvAstNode {
    kind: 'MemberExpr';
    object: SvExpr;
    member: string;
}

export interface SvCallExpr extends SvAstNode {
    kind: 'CallExpr';
    callee: SvExpr;
    args: SvExpr[];
}

export interface SvParenExpr extends SvAstNode {
    kind: 'ParenExpr';
    expr: SvExpr;
}

// ============================================================================
// AST Factory Functions
// ============================================================================

export function createSourceFile(modules: SvModuleDecl[], location: SourceLocation): SvSourceFile {
    return { kind: 'SourceFile', modules, location };
}

export function createIdentifier(name: string, location: SourceLocation): SvIdentifier {
    return { kind: 'Identifier', name, location };
}

export function createNumberLiteral(
    value: string,
    location: SourceLocation,
    options?: { size?: number; base?: 'b' | 'o' | 'd' | 'h'; signed?: boolean }
): SvNumberLiteral {
    return {
        kind: 'NumberLiteral',
        value,
        location,
        size: options?.size,
        base: options?.base,
        signed: options?.signed,
    };
}

export function createBinaryExpr(
    operator: BinaryOp,
    left: SvExpr,
    right: SvExpr,
    location: SourceLocation
): SvBinaryExpr {
    return { kind: 'BinaryExpr', operator, left, right, location };
}

export function createUnaryExpr(
    operator: UnaryOp,
    operand: SvExpr,
    location: SourceLocation
): SvUnaryExpr {
    return { kind: 'UnaryExpr', operator, operand, location };
}

export function createConditionalExpr(
    condition: SvExpr,
    thenExpr: SvExpr,
    elseExpr: SvExpr,
    location: SourceLocation
): SvConditionalExpr {
    return { kind: 'ConditionalExpr', condition, thenExpr, elseExpr, location };
}
