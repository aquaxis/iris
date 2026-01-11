/**
 * IRIS AST - Item Types
 *
 * Top-level items: modules, types, functions, interfaces, etc.
 */

import type { SourceSpan } from '../lexer/token.js';
import type {
  AstNode,
  Identifier,
  Path,
  Visibility,
  GenericParams,
  GenericArgs,
  WhereClause,
  Attribute,
  TypeExpr,
  Expr,
  Stmt,
} from './base.js';

/**
 * Source file (compilation unit)
 */
export interface SourceFile extends AstNode {
  readonly kind: 'SourceFile';
  readonly items: Item[];
}

/**
 * All top-level item types
 */
export type Item =
  | ModDef
  | TypeDef
  | ConstDef
  | FnDef
  | InterfaceDef
  | PackageDecl
  | ImportDecl
  | TestDef;

/**
 * Port direction
 */
export type PortDirection = 'in' | 'out' | 'inout' | 'initiator' | 'target' | 'monitor';

/**
 * Port declaration
 */
export interface PortDecl extends AstNode {
  readonly kind: 'PortDecl';
  readonly direction: PortDirection;
  readonly name: Identifier;
  readonly type: TypeExpr;
}

/**
 * Module item (contents of a module)
 */
export type ModItem =
  | SignalDecl
  | ConstDecl
  | TypeAlias
  | CombBlock
  | SyncBlock
  | FsmBlock
  | InstDecl
  | MemDecl;

/**
 * Signal declaration (let or var)
 */
export interface SignalDecl extends AstNode {
  readonly kind: 'SignalDecl';
  readonly declKind: 'let' | 'var';
  readonly mutable: boolean;
  readonly name: Identifier;
  readonly type: TypeExpr | undefined;
  readonly init: Expr | undefined;
}

/**
 * Const declaration within module
 */
export interface ConstDecl extends AstNode {
  readonly kind: 'ConstDecl';
  readonly name: Identifier;
  readonly type: TypeExpr;
  readonly init: Expr;
}

/**
 * Type alias within module
 */
export interface TypeAlias extends AstNode {
  readonly kind: 'TypeAlias';
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly type: TypeExpr;
}

/**
 * Clock specification
 */
export interface ClockSpec extends AstNode {
  readonly kind: 'ClockSpec';
  readonly signal: Expr;
  readonly edge: 'posedge' | 'negedge';
}

/**
 * Reset specification
 */
export interface ResetSpec extends AstNode {
  readonly kind: 'ResetSpec';
  readonly signal: Expr;
  readonly mode: 'async' | 'sync';
}

/**
 * Combinational logic block
 */
export interface CombBlock extends AstNode {
  readonly kind: 'CombBlock';
  readonly body: Stmt[];
}

/**
 * Sequential logic block
 */
export interface SyncBlock extends AstNode {
  readonly kind: 'SyncBlock';
  readonly clock: ClockSpec;
  readonly reset: ResetSpec | undefined;
  readonly body: Stmt[];
}

/**
 * Connection in instance declaration
 */
export interface Connection extends AstNode {
  readonly kind: 'Connection';
  readonly port: Identifier;
  readonly expr: Expr;
}

/**
 * Instance declaration
 */
export interface InstDecl extends AstNode {
  readonly kind: 'InstDecl';
  readonly name: Identifier;
  readonly module: Path;
  readonly genericArgs: GenericArgs | undefined;
  readonly connections: Connection[];
}

/**
 * Memory configuration item
 */
export interface MemConfigItem extends AstNode {
  readonly kind: 'MemConfigItem';
  readonly key: 'ports' | 'type' | 'read_mode' | 'write_mode' | 'init_file';
  readonly value: Expr;
}

/**
 * Memory declaration
 */
export interface MemDecl extends AstNode {
  readonly kind: 'MemDecl';
  readonly name: Identifier;
  readonly elementType: TypeExpr;
  readonly depth: Expr;
  readonly config: MemConfigItem[] | undefined;
  readonly init: Expr | undefined;
}

/**
 * FSM state item with optional Moore outputs
 */
export interface FsmStateItem extends AstNode {
  readonly kind: 'FsmStateItem';
  readonly name: Identifier;
  readonly outputs: { name: Identifier; value: Expr }[] | undefined;
}

/**
 * FSM state enum
 */
export interface FsmStateEnum extends AstNode {
  readonly kind: 'FsmStateEnum';
  readonly states: FsmStateItem[];
}

/**
 * Transition action (goto or regular statement)
 */
export type TransitionAction =
  | { kind: 'GotoAction'; target: Identifier; span: SourceSpan }
  | { kind: 'StmtAction'; stmt: Stmt };

/**
 * When clause in transitions
 */
export interface WhenClause extends AstNode {
  readonly kind: 'WhenClause';
  readonly condition: Expr;
  readonly actions: TransitionAction[];
}

/**
 * Transition item
 */
export interface TransitionItem extends AstNode {
  readonly kind: 'TransitionItem';
  readonly state: Identifier | '_';
  readonly clauses: WhenClause[];
}

/**
 * Transitions block
 */
export interface TransitionsBlock extends AstNode {
  readonly kind: 'TransitionsBlock';
  readonly items: TransitionItem[];
}

/**
 * Output case (for Mealy outputs)
 */
export interface OutputCase extends AstNode {
  readonly kind: 'OutputCase';
  readonly state: Identifier;
  readonly value: Expr;
}

/**
 * Output block (Mealy outputs)
 */
export interface OutputBlock extends AstNode {
  readonly kind: 'OutputBlock';
  readonly signal: Identifier;
  readonly cases: OutputCase[];
}

/**
 * FSM block
 */
export interface FsmBlock extends AstNode {
  readonly kind: 'FsmBlock';
  readonly name: Identifier;
  readonly clock: ClockSpec;
  readonly reset: ResetSpec | undefined;
  readonly states: FsmStateEnum;
  readonly transitions: TransitionsBlock;
  readonly outputs: OutputBlock[];
}

/**
 * Module definition
 */
export interface ModDef extends AstNode {
  readonly kind: 'ModDef';
  readonly visibility: Visibility;
  readonly attributes: Attribute[] | undefined;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly whereClause: WhereClause | undefined;
  readonly ports: PortDecl[];
  readonly items: ModItem[];
}

/**
 * Type definition (enum, struct, or type alias)
 */
export type TypeDef = EnumDef | StructDef | TypeAliasDef;

/**
 * Enum variant
 */
export interface EnumVariant extends AstNode {
  readonly kind: 'EnumVariant';
  readonly name: Identifier;
  readonly value: Expr | undefined;
}

/**
 * Enum definition
 */
export interface EnumDef extends AstNode {
  readonly kind: 'EnumDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly variants: EnumVariant[];
}

/**
 * Struct field
 */
export interface StructField extends AstNode {
  readonly kind: 'StructField';
  readonly name: Identifier;
  readonly type: TypeExpr;
}

/**
 * Struct definition
 */
export interface StructDef extends AstNode {
  readonly kind: 'StructDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly fields: StructField[];
}

/**
 * Type alias definition (top-level)
 */
export interface TypeAliasDef extends AstNode {
  readonly kind: 'TypeAliasDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly type: TypeExpr;
}

/**
 * Const definition (top-level)
 */
export interface ConstDef extends AstNode {
  readonly kind: 'ConstDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly type: TypeExpr;
  readonly init: Expr;
}

/**
 * Function parameter
 */
export interface FnParam extends AstNode {
  readonly kind: 'FnParam';
  readonly name: Identifier;
  readonly type: TypeExpr;
}

/**
 * Function definition
 */
export interface FnDef extends AstNode {
  readonly kind: 'FnDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly params: FnParam[];
  readonly returnType: TypeExpr | undefined;
  readonly body: Stmt[];
}

/**
 * Interface signal
 */
export interface InterfaceSignal extends AstNode {
  readonly kind: 'InterfaceSignal';
  readonly isLogic: boolean;
  readonly name: Identifier;
  readonly type: TypeExpr;
}

/**
 * View signal direction
 */
export type ViewDirection = 'in' | 'out' | 'inout';

/**
 * View signal
 */
export interface ViewSignal extends AstNode {
  readonly kind: 'ViewSignal';
  readonly direction: ViewDirection;
  readonly name: Identifier;
}

/**
 * View definition
 */
export interface ViewDef extends AstNode {
  readonly kind: 'ViewDef';
  readonly name: Identifier;
  readonly signals: ViewSignal[];
}

/**
 * Interface definition
 */
export interface InterfaceDef extends AstNode {
  readonly kind: 'InterfaceDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly signals: InterfaceSignal[];
  readonly views: ViewDef[];
}

/**
 * Package declaration
 */
export interface PackageDecl extends AstNode {
  readonly kind: 'PackageDecl';
  readonly visibility: Visibility;
  readonly path: Path;
  readonly items: Item[];
}

/**
 * Import item
 */
export interface ImportItem extends AstNode {
  readonly kind: 'ImportItem';
  readonly name: Identifier;
  readonly alias: Identifier | undefined;
}

/**
 * Import declaration
 */
export interface ImportDecl extends AstNode {
  readonly kind: 'ImportDecl';
  readonly visibility: Visibility;
  readonly path: Path;
  readonly items: ImportItem[] | '*' | undefined;
  readonly alias: Identifier | undefined;
}

/**
 * Test parameter
 */
export type TestParam =
  | { kind: 'TimeoutParam'; value: number; unit: 'ns' | 'us' | 'ms' | 's' }
  | { kind: 'ShouldFailParam' }
  | { kind: 'IgnoreParam' }
  | { kind: 'ParametricParam'; values: Expr[] };

/**
 * Test statement (extends regular statements)
 */
export type TestStmt =
  | Stmt
  | AssertStmt
  | WaitStmt
  | DriveStmt
  | SampleStmt;

/**
 * Assert statement
 */
export interface AssertStmt extends AstNode {
  readonly kind: 'AssertStmt';
  readonly condition: Expr;
  readonly message: string | undefined;
}

/**
 * Wait condition
 */
export type WaitCondition =
  | { kind: 'ExprCondition'; expr: Expr }
  | { kind: 'DurationCondition'; value: number; unit: 'ns' | 'us' | 'ms' | 's' }
  | { kind: 'ClockCondition'; clock: ClockSpec };

/**
 * Wait statement
 */
export interface WaitStmt extends AstNode {
  readonly kind: 'WaitStmt';
  readonly condition: WaitCondition;
}

/**
 * Drive statement (non-blocking assignment in tests)
 */
export interface DriveStmt extends AstNode {
  readonly kind: 'DriveStmt';
  readonly signal: Identifier;
  readonly value: Expr;
}

/**
 * Sample statement
 */
export interface SampleStmt extends AstNode {
  readonly kind: 'SampleStmt';
  readonly variable: Identifier;
  readonly signal: Expr;
}

/**
 * Test definition
 */
export interface TestDef extends AstNode {
  readonly kind: 'TestDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly params: TestParam[] | undefined;
  readonly body: TestStmt[];
}

// Helper functions

/**
 * Create a source file node
 */
export function createSourceFile(items: Item[], span: SourceSpan): SourceFile {
  return { kind: 'SourceFile', items, span };
}

/**
 * Create a module definition
 */
export function createModDef(
  visibility: Visibility,
  name: Identifier,
  ports: PortDecl[],
  items: ModItem[],
  span: SourceSpan,
  options?: {
    attributes?: Attribute[];
    genericParams?: GenericParams;
    whereClause?: WhereClause;
  }
): ModDef {
  return {
    kind: 'ModDef',
    visibility,
    name,
    ports,
    items,
    span,
    attributes: options?.attributes,
    genericParams: options?.genericParams,
    whereClause: options?.whereClause,
  };
}
