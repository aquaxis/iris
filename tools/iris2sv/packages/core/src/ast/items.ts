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
  | ExternModDef
  | UnionDef
  | TypeDef
  | ConstDef
  | FnDef
  | InterfaceDef
  | PackageDecl
  | ImportDecl
  | TestDef
  | TestModDef;

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
  /** Instance array size, as in `inst u[4] = M { ... };`. Undefined for a single instance. */
  readonly arraySize?: Expr | undefined;
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
  /**
   * The state the machine resets to, from `initial: Idle`.
   *
   * fsm_block = ... state_enum [ "initial" ":" identifier ] { signal_decl } ...
   * Both this and `signals` were missing, so any machine using either was
   * rejected before the transform ever saw it.
   */
  readonly initialState?: Identifier | undefined;
  /** Signals declared inside the machine, before `transitions`. */
  readonly signals: SignalDecl[];
  readonly transitions: TransitionsBlock;
  readonly outputs: OutputBlock[];
  /**
   * How the state register is encoded, from `output encoding: onehot`.
   *
   * Carried through so the setting is not lost; the conversion encodes states
   * in binary whatever it says, which is what the simulator does too.
   */
  readonly encoding?: 'binary' | 'onehot' | 'gray' | undefined;
}

/**
 * Module definition
 */
/**
 * `extern mod Name(ports);` — a module implemented outside IRIS.
 *
 * `extern_mod_decl = "pub"? ~ "extern" ~ "mod" ~ identifier ~ generics?
 *  ~ "(" ~ port_list ~ ")" ~ ";"`
 */
export interface ExternModDef extends AstNode {
  readonly kind: 'ExternModDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly genericParams: GenericParams | undefined;
  readonly ports: PortDecl[];
}

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
/**
 * `union U { a: bit[8], b: bit[8], }`
 *
 * `union_decl = "pub"? ~ "union" ~ identifier ~ "{" ~ struct_field ~ ... ~ "}"`.
 * The same body as a struct, and the same conversion: a packed SystemVerilog
 * union.
 */
export interface UnionDef extends AstNode {
  readonly kind: 'UnionDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly fields: StructField[];
}

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
  /** The interface this one extends, from `interface B extends A { ... }`. */
  readonly extends?: Identifier | undefined;
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
  /**
   * Severity of the `else` action, as in `assert c else error("...")`.
   *
   * `assert_action = assert_severity ~ "(" ~ string_literal ~ ")"` in the
   * reference grammar. Absent for the bare and comma forms.
   */
  readonly severity?: 'error' | 'warning' | 'fatal' | undefined;
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

/**
 * Test module definition (testbench-style top-level module without ports)
 */
export interface TestModDef extends AstNode {
  readonly kind: 'TestModDef';
  readonly visibility: Visibility;
  readonly name: Identifier;
  readonly items: TestModItem[];
}

/**
 * Test module item
 */
export type TestModItem =
  | SignalDecl
  | ConstDecl
  | InstDecl
  | CombBlock
  | SyncBlock
  | InitialBlock
  | SeqBlock
  | UseRustDecl
  | ExternRustBlock
  | TestStmt;

/**
 * Initial block (simulation only)
 */
export interface InitialBlock extends AstNode {
  readonly kind: 'InitialBlock';
  readonly body: Stmt[];
}

/**
 * Sequential processing block (Rust code execution in test)
 */
export interface SeqBlock extends AstNode {
  readonly kind: 'SeqBlock';
  readonly name: Identifier | undefined;
  readonly body: SeqStatement[];
}

/**
 * Seq block statement types
 */
export type SeqStatement =
  | RustStatement
  | SignalRead
  | SignalWrite
  | AwaitStmt
  | DelayStmt
  | AssertStmt;

/**
 * Rust statement (any valid Rust code)
 */
export interface RustStatement extends AstNode {
  readonly kind: 'RustStatement';
  readonly code: string;
}

/**
 * Signal read operation (.value())
 */
export interface SignalRead extends AstNode {
  readonly kind: 'SignalRead';
  readonly signal: Path;
}

/**
 * Signal write operation (.set())
 */
export interface SignalWrite extends AstNode {
  readonly kind: 'SignalWrite';
  readonly signal: Path;
  readonly value: Expr;
}

/**
 * Await expression types
 */
export type AwaitExpr =
  | ClockEdgeAwait
  | UntilAwait
  | EventAwait
  | AsyncCallAwait;

/**
 * Clock edge await (await clk.posedge)
 */
export interface ClockEdgeAwait extends AstNode {
  readonly kind: 'ClockEdgeAwait';
  readonly signal: Expr;
  readonly edge: 'posedge' | 'negedge';
  readonly cycles: Expr | undefined;
}

/**
 * Until await (await until(condition))
 */
export interface UntilAwait extends AstNode {
  readonly kind: 'UntilAwait';
  readonly condition: Expr;
  readonly timeout: Duration | undefined;
}

/**
 * Event await (await event(signal))
 */
export interface EventAwait extends AstNode {
  readonly kind: 'EventAwait';
  readonly signal: Expr;
}

/**
 * Async call await (expr.await)
 */
export interface AsyncCallAwait extends AstNode {
  readonly kind: 'AsyncCallAwait';
  readonly expr: Expr;
}

/**
 * Await statement
 */
export interface AwaitStmt extends AstNode {
  readonly kind: 'AwaitStmt';
  readonly awaitExpr: AwaitExpr;
}

/**
 * Duration with time unit
 */
export interface Duration extends AstNode {
  readonly kind: 'Duration';
  readonly value: number;
  readonly unit: 'ns' | 'us' | 'ms' | 's';
}

/**
 * Delay statement (#time)
 */
export interface DelayStmt extends AstNode {
  readonly kind: 'DelayStmt';
  readonly delay: number | Duration;
}

/**
 * External Rust function import (use rust::...)
 */
export interface UseRustDecl extends AstNode {
  readonly kind: 'UseRustDecl';
  readonly path: string[];
  readonly items: string[] | '*' | undefined;
}

/**
 * External Rust function block (extern rust "module" { ... })
 */
export interface ExternRustBlock extends AstNode {
  readonly kind: 'ExternRustBlock';
  readonly moduleName: string;
  readonly functions: RustFnDecl[];
}

/**
 * Rust function declaration
 */
export interface RustFnDecl extends AstNode {
  readonly kind: 'RustFnDecl';
  readonly isAsync: boolean;
  readonly name: Identifier;
  readonly params: RustParam[];
  readonly returnType: string | undefined;
}

/**
 * Rust function parameter
 */
export interface RustParam extends AstNode {
  readonly kind: 'RustParam';
  readonly name: Identifier;
  readonly type: string;
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
