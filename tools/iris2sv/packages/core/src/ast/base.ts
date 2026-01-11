/**
 * IRIS AST - Base Types
 *
 * Common base types for all AST nodes.
 */

import type { SourceSpan } from '../lexer/token.js';

/**
 * Base interface for all AST nodes
 */
export interface AstNode {
  /** Node type discriminator */
  readonly kind: string;
  /** Source location of this node */
  readonly span: SourceSpan;
}

/**
 * Identifier node
 */
export interface Identifier extends AstNode {
  readonly kind: 'Identifier';
  readonly name: string;
}

/**
 * Path node (e.g., std::logic::And)
 */
export interface Path extends AstNode {
  readonly kind: 'Path';
  readonly segments: Identifier[];
}

/**
 * Visibility modifier
 */
export type Visibility = 'public' | 'private';

/**
 * Generic parameter bound
 */
export type GenericBound =
  | { kind: 'TypeBound' }
  | { kind: 'UintBound' }
  | { kind: 'IntBound' }
  | { kind: 'BoolBound' }
  | { kind: 'TypeExprBound'; type: TypeExpr };

/**
 * Generic parameter definition
 */
export interface GenericParam extends AstNode {
  readonly kind: 'GenericParam';
  readonly name: Identifier;
  readonly bound: GenericBound;
  readonly defaultValue: Expr | undefined;
}

/**
 * Generic parameters list
 */
export interface GenericParams extends AstNode {
  readonly kind: 'GenericParams';
  readonly params: GenericParam[];
}

/**
 * Generic argument (for instantiation)
 */
export interface GenericArg extends AstNode {
  readonly kind: 'GenericArg';
  readonly name: Identifier | undefined;
  readonly value: TypeExpr | Expr;
}

/**
 * Generic arguments list
 */
export interface GenericArgs extends AstNode {
  readonly kind: 'GenericArgs';
  readonly args: GenericArg[];
}

/**
 * Where clause constraint
 */
export type Constraint =
  | { kind: 'TypeConstraint'; name: Identifier; type: TypeExpr }
  | { kind: 'ValueConstraint'; name: Identifier; op: '==' | '!=' | '<' | '<=' | '>' | '>='; value: Expr };

/**
 * Where clause
 */
export interface WhereClause extends AstNode {
  readonly kind: 'WhereClause';
  readonly constraints: Constraint[];
}

/**
 * Attribute argument
 */
export interface AttrArg extends AstNode {
  readonly kind: 'AttrArg';
  readonly name: Identifier | undefined;
  readonly value: Literal;
}

/**
 * Attribute (e.g., #[test], #[inline])
 */
export interface Attribute extends AstNode {
  readonly kind: 'Attribute';
  readonly path: Path;
  readonly args: AttrArg[] | undefined;
}

// Forward declarations for type expressions, expressions, and literals
// These will be fully defined in their respective modules

/**
 * Type expression base (forward declaration)
 */
export type TypeExpr =
  | PrimitiveType
  | ArrayType
  | TupleType
  | UserType
  | GenericType;

/**
 * Primitive type
 */
export interface PrimitiveType extends AstNode {
  readonly kind: 'PrimitiveType';
  readonly type: 'bit' | 'int' | 'uint' | 'bool' | 'clock' | 'reset' | 'string';
  readonly width: Expr | undefined; // For bit[N], int[N], uint[N]
}

/**
 * Array type
 */
export interface ArrayType extends AstNode {
  readonly kind: 'ArrayType';
  readonly elementType: TypeExpr;
  readonly size: Expr;
}

/**
 * Tuple type
 */
export interface TupleType extends AstNode {
  readonly kind: 'TupleType';
  readonly elements: TypeExpr[];
}

/**
 * User-defined type (path reference)
 */
export interface UserType extends AstNode {
  readonly kind: 'UserType';
  readonly path: Path;
}

/**
 * Generic type instantiation
 */
export interface GenericType extends AstNode {
  readonly kind: 'GenericType';
  readonly path: Path;
  readonly args: GenericArgs;
}

// Expression types (forward declaration - full definition in expr.ts)
export type Expr =
  | Literal
  | IdentifierExpr
  | PathExpr
  | UnaryExpr
  | BinaryExpr
  | CallExpr
  | IndexExpr
  | FieldExpr
  | CastExpr
  | IfExpr
  | MatchExpr
  | ConcatExpr
  | RepeatExpr
  | ParenExpr;

/**
 * Literal expression base
 */
export type Literal =
  | IntegerLiteral
  | StringLiteral
  | BoolLiteral;

/**
 * Integer literal
 */
export interface IntegerLiteral extends AstNode {
  readonly kind: 'IntegerLiteral';
  readonly value: bigint;
  readonly width: number | undefined;
  readonly base: 'b' | 'o' | 'd' | 'h' | undefined;
  readonly raw: string;
}

/**
 * String literal
 */
export interface StringLiteral extends AstNode {
  readonly kind: 'StringLiteral';
  readonly value: string;
  readonly raw: string;
}

/**
 * Boolean literal
 */
export interface BoolLiteral extends AstNode {
  readonly kind: 'BoolLiteral';
  readonly value: boolean;
}

/**
 * Identifier expression
 */
export interface IdentifierExpr extends AstNode {
  readonly kind: 'IdentifierExpr';
  readonly name: Identifier;
}

/**
 * Path expression
 */
export interface PathExpr extends AstNode {
  readonly kind: 'PathExpr';
  readonly path: Path;
}

/**
 * Unary operator
 */
export type UnaryOp = '!' | '~' | '-' | '&' | '|' | '^';

/**
 * Unary expression
 */
export interface UnaryExpr extends AstNode {
  readonly kind: 'UnaryExpr';
  readonly op: UnaryOp;
  readonly operand: Expr;
}

/**
 * Binary operator
 */
export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '**'
  | '&' | '|' | '^' | '<<' | '>>' | '>>>'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&&' | '||';

/**
 * Binary expression
 */
export interface BinaryExpr extends AstNode {
  readonly kind: 'BinaryExpr';
  readonly op: BinaryOp;
  readonly left: Expr;
  readonly right: Expr;
}

/**
 * Function/method call expression
 */
export interface CallExpr extends AstNode {
  readonly kind: 'CallExpr';
  readonly callee: Expr;
  readonly args: Expr[];
}

/**
 * Index/slice expression
 */
export interface IndexExpr extends AstNode {
  readonly kind: 'IndexExpr';
  readonly base: Expr;
  readonly index: Expr;
  readonly endIndex: Expr | undefined; // For slicing: base[start:end]
}

/**
 * Field access expression
 */
export interface FieldExpr extends AstNode {
  readonly kind: 'FieldExpr';
  readonly base: Expr;
  readonly field: Identifier;
}

/**
 * Cast expression
 */
export interface CastExpr extends AstNode {
  readonly kind: 'CastExpr';
  readonly expr: Expr;
  readonly targetType: TypeExpr;
}

/**
 * If expression
 */
export interface IfExpr extends AstNode {
  readonly kind: 'IfExpr';
  readonly condition: Expr;
  readonly thenExpr: Expr;
  readonly elseExpr: Expr;
}

/**
 * Match arm
 */
export interface MatchArm extends AstNode {
  readonly kind: 'MatchArm';
  readonly pattern: Pattern;
  readonly body: Expr | Stmt[];
}

/**
 * Match expression
 */
export interface MatchExpr extends AstNode {
  readonly kind: 'MatchExpr';
  readonly scrutinee: Expr;
  readonly arms: MatchArm[];
}

/**
 * Concatenation expression
 */
export interface ConcatExpr extends AstNode {
  readonly kind: 'ConcatExpr';
  readonly elements: Expr[];
}

/**
 * Repeat expression
 */
export interface RepeatExpr extends AstNode {
  readonly kind: 'RepeatExpr';
  readonly expr: Expr;
  readonly count: Expr;
}

/**
 * Parenthesized expression
 */
export interface ParenExpr extends AstNode {
  readonly kind: 'ParenExpr';
  readonly expr: Expr;
}

// Pattern types (for match expressions)
export type Pattern =
  | LiteralPattern
  | IdentifierPattern
  | WildcardPattern
  | PathPattern
  | RangePattern
  | TuplePattern
  | StructPattern;

/**
 * Literal pattern
 */
export interface LiteralPattern extends AstNode {
  readonly kind: 'LiteralPattern';
  readonly literal: Literal;
}

/**
 * Identifier pattern (binding)
 */
export interface IdentifierPattern extends AstNode {
  readonly kind: 'IdentifierPattern';
  readonly name: Identifier;
}

/**
 * Wildcard pattern (_)
 */
export interface WildcardPattern extends AstNode {
  readonly kind: 'WildcardPattern';
}

/**
 * Path pattern (enum variant)
 */
export interface PathPattern extends AstNode {
  readonly kind: 'PathPattern';
  readonly path: Path;
}

/**
 * Range pattern
 */
export interface RangePattern extends AstNode {
  readonly kind: 'RangePattern';
  readonly start: Expr;
  readonly end: Expr;
  readonly inclusive: boolean;
}

/**
 * Tuple pattern
 */
export interface TuplePattern extends AstNode {
  readonly kind: 'TuplePattern';
  readonly elements: Pattern[];
}

/**
 * Field pattern (for struct patterns)
 */
export interface FieldPattern extends AstNode {
  readonly kind: 'FieldPattern';
  readonly name: Identifier;
  readonly pattern: Pattern | undefined;
}

/**
 * Struct pattern
 */
export interface StructPattern extends AstNode {
  readonly kind: 'StructPattern';
  readonly path: Path;
  readonly fields: FieldPattern[];
}

// Statement types (forward declaration - full definition in stmt.ts)
export type Stmt =
  | LetStmt
  | VarStmt
  | ConstStmt
  | AssignStmt
  | IfStmt
  | MatchStmt
  | ForStmt
  | WhileStmt
  | ReturnStmt
  | BlockStmt
  | ExprStmt;

/**
 * Let statement (combinational or sequential depending on context)
 */
export interface LetStmt extends AstNode {
  readonly kind: 'LetStmt';
  readonly mutable: boolean;
  readonly name: Identifier;
  readonly type: TypeExpr | undefined;
  readonly init: Expr | undefined;
}

/**
 * Var statement (sequential logic only)
 */
export interface VarStmt extends AstNode {
  readonly kind: 'VarStmt';
  readonly name: Identifier;
  readonly type: TypeExpr | undefined;
  readonly init: Expr | undefined;
}

/**
 * Const statement
 */
export interface ConstStmt extends AstNode {
  readonly kind: 'ConstStmt';
  readonly name: Identifier;
  readonly type: TypeExpr;
  readonly init: Expr;
}

/**
 * L-value for assignments
 */
export type LValue =
  | { kind: 'IdentifierLValue'; name: Identifier }
  | { kind: 'IndexLValue'; base: LValue; index: Expr; endIndex: Expr | undefined }
  | { kind: 'FieldLValue'; base: LValue; field: Identifier }
  | { kind: 'ConcatLValue'; elements: LValue[] };

/**
 * Assignment statement
 */
export interface AssignStmt extends AstNode {
  readonly kind: 'AssignStmt';
  readonly lvalue: LValue;
  readonly value: Expr;
}

/**
 * If statement
 */
export interface IfStmt extends AstNode {
  readonly kind: 'IfStmt';
  readonly condition: Expr;
  readonly thenBranch: Stmt[];
  readonly elseBranch: Stmt[] | IfStmt | undefined;
}

/**
 * Match statement
 */
export interface MatchStmt extends AstNode {
  readonly kind: 'MatchStmt';
  readonly scrutinee: Expr;
  readonly arms: MatchArm[];
}

/**
 * For statement
 */
export interface ForStmt extends AstNode {
  readonly kind: 'ForStmt';
  readonly variable: Identifier;
  readonly start: Expr;
  readonly end: Expr;
  readonly inclusive: boolean;
  readonly body: Stmt[];
}

/**
 * While statement
 */
export interface WhileStmt extends AstNode {
  readonly kind: 'WhileStmt';
  readonly condition: Expr;
  readonly body: Stmt[];
}

/**
 * Return statement
 */
export interface ReturnStmt extends AstNode {
  readonly kind: 'ReturnStmt';
  readonly value: Expr | undefined;
}

/**
 * Block statement
 */
export interface BlockStmt extends AstNode {
  readonly kind: 'BlockStmt';
  readonly statements: Stmt[];
}

/**
 * Expression statement
 */
export interface ExprStmt extends AstNode {
  readonly kind: 'ExprStmt';
  readonly expr: Expr;
}

// Helper functions

/**
 * Create an identifier node
 */
export function createIdentifier(name: string, span: SourceSpan): Identifier {
  return { kind: 'Identifier', name, span };
}

/**
 * Create a path node
 */
export function createPath(segments: Identifier[], span: SourceSpan): Path {
  return { kind: 'Path', segments, span };
}

/**
 * Create a single-segment path from identifier
 */
export function identifierToPath(id: Identifier): Path {
  return { kind: 'Path', segments: [id], span: id.span };
}
