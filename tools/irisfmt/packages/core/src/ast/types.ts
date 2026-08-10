import type { SourceSpan, Trivia } from '../lexer/token.js';

/**
 * Base interface for all AST nodes
 */
export interface AstNode {
  kind: string;
  span: SourceSpan;
  /** Leading comments/whitespace before this node */
  leadingTrivia?: Trivia[];
  /** Trailing comments after this node (on same line) */
  trailingTrivia?: Trivia[];
}

// ============================================================================
// Top-level
// ============================================================================

export interface SourceFile extends AstNode {
  kind: 'SourceFile';
  items: Item[];
}

export type Item =
  | ModDef
  | UnionDef
  | ExternModDef
  | TypeDef
  | ConstDef
  | FnDef
  | InterfaceDef
  | PackageDecl
  | ImportDecl
  | TestDef
  | TestModDef;

export type Visibility = 'pub' | 'private';

// ============================================================================
// Module Definition
// ============================================================================

export interface ModDef extends AstNode {
  kind: 'ModDef';
  visibility: Visibility;
  attributes: Attribute[];
  name: Identifier;
  genericParams?: GenericParams | undefined;
  whereClause?: WhereClause | undefined;
  ports: PortDecl[];
  items: ModItem[];
}

export type ModItem =
  | SignalDecl
  | ConstDecl
  | TypeAlias
  | CombBlock
  | SyncBlock
  | InstDecl
  | MemDecl
  | FsmBlock;

export interface PortDecl extends AstNode {
  kind: 'PortDecl';
  direction: PortDirection;
  name: Identifier;
  typeExpr: TypeExpr;
}

export type PortDirection = 'in' | 'out' | 'inout' | 'initiator' | 'target' | 'monitor';

// ============================================================================
// Generic Parameters
// ============================================================================

export interface GenericParams extends AstNode {
  kind: 'GenericParams';
  params: GenericParam[];
}

export interface GenericParam extends AstNode {
  kind: 'GenericParam';
  name: Identifier;
  bound: GenericBound;
  defaultValue?: Expr | undefined;
}

export type GenericBound =
  | { kind: 'TypeBound' }
  | { kind: 'UintBound' }
  | { kind: 'IntBound' }
  | { kind: 'BoolBound' }
  | { kind: 'TypeExprBound'; typeExpr: TypeExpr };

export interface WhereClause extends AstNode {
  kind: 'WhereClause';
  constraints: Constraint[];
}

export interface Constraint extends AstNode {
  kind: 'Constraint';
  name: Identifier;
  constraintKind: ConstraintKind;
  value: Expr;
}

export type ConstraintKind = ':' | '==' | '!=' | '<' | '<=' | '>' | '>=';

// ============================================================================
// Type Definitions
// ============================================================================

export type TypeDef = EnumDef | StructDef | TypeAlias;

export interface EnumDef extends AstNode {
  kind: 'EnumDef';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  variants: EnumVariant[];
}

export interface EnumVariant extends AstNode {
  kind: 'EnumVariant';
  name: Identifier;
  value?: Expr | undefined;
}

export interface StructDef extends AstNode {
  kind: 'StructDef';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  fields: StructField[];
}

export interface StructField extends AstNode {
  kind: 'StructField';
  name: Identifier;
  typeExpr: TypeExpr;
}

/**
 * `union U { a: bit[8], b: bit[8], }`
 *
 * `union_decl = "pub"? ~ "union" ~ identifier ~ "{" ~ struct_field ~ ... ~ "}"`.
 * The word was not even a token, so a file declaring one could not be read.
 */
export interface UnionDef extends AstNode {
  kind: 'UnionDef';
  visibility: Visibility;
  name: Identifier;
  fields: StructField[];
}

/**
 * `extern mod Name(ports);` — a module implemented outside IRIS.
 *
 * `extern_mod_decl = "pub"? ~ "extern" ~ "mod" ~ identifier ~ generics?
 *  ~ "(" ~ port_list ~ ")" ~ ";"`
 */
export interface ExternModDef extends AstNode {
  kind: 'ExternModDef';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  ports: PortDecl[];
}

export interface TypeAlias extends AstNode {
  kind: 'TypeAlias';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  typeExpr: TypeExpr;
}

// ============================================================================
// Type Expressions
// ============================================================================

export type TypeExpr =
  | PrimitiveType
  | ArrayType
  | TupleType
  | UserType
  | GenericType;

export interface PrimitiveType extends AstNode {
  kind: 'PrimitiveType';
  name: 'bit' | 'int' | 'uint' | 'bool' | 'clock' | 'reset' | 'string';
  width?: Expr | undefined;
  /**
   * Attributes of a clock or reset, as in `clock(period: 10ns)` or
   * `reset(active_low: true)`. Specification §2.7 defines them.
   */
  attrs?: TypeAttr[] | undefined;
}

/** One attribute of a clock or reset type, such as `active_low: true` */
export interface TypeAttr extends AstNode {
  kind: 'TypeAttr';
  name: Identifier;
  value: Expr;
  /** Time unit of a duration value, as in `clock(period: 10ns)` */
  unit?: TimeUnit | undefined;
}

export type TimeUnit = 'ps' | 'ns' | 'us' | 'ms' | 's';

export interface ArrayType extends AstNode {
  kind: 'ArrayType';
  elementType: TypeExpr;
  size: Expr;
}

export interface TupleType extends AstNode {
  kind: 'TupleType';
  elements: TypeExpr[];
}

export interface UserType extends AstNode {
  kind: 'UserType';
  path: Path;
}

export interface GenericType extends AstNode {
  kind: 'GenericType';
  path: Path;
  args: GenericArg[];
}

export interface GenericArg extends AstNode {
  kind: 'GenericArg';
  name?: Identifier | undefined;
  value: TypeExpr | Expr;
}

// ============================================================================
// Expressions
// ============================================================================

export type Expr =
  | LiteralExpr
  | IdentExpr
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

export interface LiteralExpr extends AstNode {
  kind: 'LiteralExpr';
  value: Literal;
}

export type Literal =
  | { kind: 'Int'; value: string; width?: number | undefined; base?: 'b' | 'o' | 'd' | 'h' | undefined }
  | { kind: 'Bool'; value: boolean }
  | { kind: 'String'; value: string };

export interface IdentExpr extends AstNode {
  kind: 'IdentExpr';
  name: Identifier;
}

export interface PathExpr extends AstNode {
  kind: 'PathExpr';
  path: Path;
}

export interface UnaryExpr extends AstNode {
  kind: 'UnaryExpr';
  op: UnaryOp;
  operand: Expr;
}

export type UnaryOp = '!' | '~' | '-' | '&' | '|' | '^';

export interface BinaryExpr extends AstNode {
  kind: 'BinaryExpr';
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '**'
  | '&' | '|' | '^' | '<<' | '>>' | '>>>'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&&' | '||';

export interface CallExpr extends AstNode {
  kind: 'CallExpr';
  callee: Expr;
  args: Expr[];
}

export interface IndexExpr extends AstNode {
  kind: 'IndexExpr';
  base: Expr;
  index: Expr;
  rangeEnd?: Expr | undefined;
  /**
   * The operator of a part select, from `a[i +: 8]` or `a[i -: 8]`.
   *
   * `part_select = "[" ~ expr ~ part_select_op ~ expr ~ "]"`. Without it the
   * parser stopped at `+:` and the whole file failed to format.
   */
  partSelect?: '+:' | '-:' | undefined;
}

export interface FieldExpr extends AstNode {
  kind: 'FieldExpr';
  base: Expr;
  field: Identifier;
}

export interface CastExpr extends AstNode {
  kind: 'CastExpr';
  expr: Expr;
  targetType: TypeExpr;
}

export interface IfExpr extends AstNode {
  kind: 'IfExpr';
  condition: Expr;
  thenExpr: Expr;
  elseExpr: Expr;
}

export interface MatchExpr extends AstNode {
  kind: 'MatchExpr';
  scrutinee: Expr;
  arms: MatchArm[];
}

export interface MatchArm extends AstNode {
  kind: 'MatchArm';
  pattern: Pattern;
  body: Expr | BlockStmt;
}

export interface ConcatExpr extends AstNode {
  kind: 'ConcatExpr';
  elements: Expr[];
}

export interface RepeatExpr extends AstNode {
  kind: 'RepeatExpr';
  expr: Expr;
  count: Expr;
}

export interface ParenExpr extends AstNode {
  kind: 'ParenExpr';
  inner: Expr;
}

// ============================================================================
// Patterns
// ============================================================================

export type Pattern =
  | LiteralPattern
  | IdentPattern
  | WildcardPattern
  | PathPattern
  | RangePattern
  | TuplePattern
  | StructPattern;

export interface LiteralPattern extends AstNode {
  kind: 'LiteralPattern';
  value: Literal;
}

export interface IdentPattern extends AstNode {
  kind: 'IdentPattern';
  name: Identifier;
}

export interface WildcardPattern extends AstNode {
  kind: 'WildcardPattern';
}

export interface PathPattern extends AstNode {
  kind: 'PathPattern';
  path: Path;
}

export interface RangePattern extends AstNode {
  kind: 'RangePattern';
  start: Expr;
  end: Expr;
  inclusive: boolean;
}

export interface TuplePattern extends AstNode {
  kind: 'TuplePattern';
  elements: Pattern[];
}

export interface StructPattern extends AstNode {
  kind: 'StructPattern';
  path: Path;
  fields: FieldPattern[];
}

export interface FieldPattern extends AstNode {
  kind: 'FieldPattern';
  name: Identifier;
  pattern?: Pattern | undefined;
}

// ============================================================================
// Statements
// ============================================================================

export type Stmt =
  | LetDecl
  | VarDecl
  | AssignStmt
  | IfStmt
  | MatchStmt
  | ForStmt
  | WhileStmt
  | ReturnStmt
  | BlockStmt
  | ExprStmt
  | AssertStmt;

export interface LetDecl extends AstNode {
  kind: 'LetDecl';
  mutable: boolean;
  name: Identifier;
  typeExpr?: TypeExpr | undefined;
  init?: Expr | undefined;
}

export interface VarDecl extends AstNode {
  kind: 'VarDecl';
  name: Identifier;
  typeExpr?: TypeExpr | undefined;
  init?: Expr | undefined;
}

export type SignalDecl = LetDecl | VarDecl;

export interface ConstDecl extends AstNode {
  kind: 'ConstDecl';
  visibility: Visibility;
  name: Identifier;
  typeExpr: TypeExpr;
  init: Expr;
}

export interface AssignStmt extends AstNode {
  kind: 'AssignStmt';
  lvalue: LValue;
  value: Expr;
}

export type LValue =
  | { kind: 'IdentLValue'; name: Identifier }
  | { kind: 'IndexLValue'; base: LValue; index: Expr }
  | { kind: 'FieldLValue'; base: LValue; field: Identifier }
  | { kind: 'ConcatLValue'; elements: LValue[] };

export interface IfStmt extends AstNode {
  kind: 'IfStmt';
  condition: Expr;
  thenBlock: Stmt[];
  elseBlock?: Stmt[] | IfStmt | undefined;
}

export interface MatchStmt extends AstNode {
  kind: 'MatchStmt';
  scrutinee: Expr;
  arms: MatchArm[];
}

export interface ForStmt extends AstNode {
  kind: 'ForStmt';
  variable: Identifier;
  range: RangeExpr;
  body: Stmt[];
}

export interface RangeExpr extends AstNode {
  kind: 'RangeExpr';
  start: Expr;
  end: Expr;
  inclusive: boolean;
}

export interface WhileStmt extends AstNode {
  kind: 'WhileStmt';
  condition: Expr;
  body: Stmt[];
}

export interface ReturnStmt extends AstNode {
  kind: 'ReturnStmt';
  value?: Expr | undefined;
}

export interface BlockStmt extends AstNode {
  kind: 'BlockStmt';
  stmts: Stmt[];
}

export interface ExprStmt extends AstNode {
  kind: 'ExprStmt';
  expr: Expr;
}

// ============================================================================
// Logic Blocks
// ============================================================================

export interface CombBlock extends AstNode {
  kind: 'CombBlock';
  stmts: Stmt[];
}

export interface SyncBlock extends AstNode {
  kind: 'SyncBlock';
  clock: ClockSpec;
  reset?: ResetSpec | undefined;
  stmts: Stmt[];
}

export interface ClockSpec extends AstNode {
  kind: 'ClockSpec';
  signal: Expr;
  edge: 'posedge' | 'negedge';
}

export interface ResetSpec extends AstNode {
  kind: 'ResetSpec';
  signal: Expr;
  mode: 'async' | 'sync';
}

// ============================================================================
// FSM
// ============================================================================

export interface FsmBlock extends AstNode {
  kind: 'FsmBlock';
  name: Identifier;
  clock: ClockSpec;
  reset?: ResetSpec | undefined;
  stateEnum: StateEnum;
  /**
   * The state the machine resets to, from `initial: Idle`.
   *
   * fsm_block = ... state_enum [ "initial" ":" identifier ] { signal_decl } ...
   * Neither this nor `signals` had a home in the AST, so a machine using either
   * one sent the parser into a loop that ran until it exhausted memory.
   */
  initialState?: Identifier | undefined;
  /** Signals declared inside the machine, before `transitions`. */
  signals: ModItem[];
  /**
   * How the state register is encoded, from `output encoding: onehot`.
   *
   * `output_encoding = "output" "encoding" ":" encoding_type`. Without it the
   * parser took the clause for an output block, found no `{`, and spun until it
   * ran out of memory.
   */
  encoding?: 'binary' | 'onehot' | 'gray' | undefined;
  transitions: TransitionsBlock;
  outputs: OutputBlock[];
}

export interface StateEnum extends AstNode {
  kind: 'StateEnum';
  states: StateItem[];
}

export interface StateItem extends AstNode {
  kind: 'StateItem';
  name: Identifier;
  mooreOutputs?: OutputAssign[] | undefined;
}

export interface OutputAssign extends AstNode {
  kind: 'OutputAssign';
  name: Identifier;
  value: Expr;
}

export interface TransitionsBlock extends AstNode {
  kind: 'TransitionsBlock';
  items: TransitionItem[];
}

export interface TransitionItem extends AstNode {
  kind: 'TransitionItem';
  fromState: Identifier | '_';
  whenClauses: WhenClause[];
}

export interface WhenClause extends AstNode {
  kind: 'WhenClause';
  condition: Expr;
  actions: TransitionAction[];
}

export type TransitionAction =
  | { kind: 'Goto'; target: Identifier }
  | { kind: 'Stmt'; stmt: Stmt };

export interface OutputBlock extends AstNode {
  kind: 'OutputBlock';
  name: Identifier;
  cases: OutputCase[];
}

export interface OutputCase extends AstNode {
  kind: 'OutputCase';
  state: Identifier;
  value: Expr;
}

// ============================================================================
// Instance and Memory
// ============================================================================

export interface InstDecl extends AstNode {
  kind: 'InstDecl';
  name: Identifier;
  modulePath: Path;
  genericArgs?: GenericArg[] | undefined;
  connections: Connection[];
}

export interface Connection extends AstNode {
  kind: 'Connection';
  port: Identifier;
  expr: Expr;
}

export interface MemDecl extends AstNode {
  kind: 'MemDecl';
  name: Identifier;
  elementType: TypeExpr;
  depth: Expr;
  config?: MemConfig | undefined;
  init?: Expr | undefined;
}

export interface MemConfig extends AstNode {
  kind: 'MemConfig';
  items: MemConfigItem[];
}

export interface MemConfigItem extends AstNode {
  kind: 'MemConfigItem';
  key: string;
  value: Literal | Identifier;
}

// ============================================================================
// Interface
// ============================================================================

export interface InterfaceDef extends AstNode {
  kind: 'InterfaceDef';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  /** The interface this one extends, from `interface B extends A { ... }`. */
  extends?: Identifier | undefined;
  signals: InterfaceSignal[];
  views: ViewDef[];
}

export interface InterfaceSignal extends AstNode {
  kind: 'InterfaceSignal';
  isLogic: boolean;
  name: Identifier;
  typeExpr: TypeExpr;
}

export interface ViewDef extends AstNode {
  kind: 'ViewDef';
  name: Identifier;
  signals: ViewSignal[];
}

export interface ViewSignal extends AstNode {
  kind: 'ViewSignal';
  direction: 'in' | 'out' | 'inout';
  name: Identifier;
}

// ============================================================================
// Function
// ============================================================================

export interface FnDef extends AstNode {
  kind: 'FnDef';
  visibility: Visibility;
  name: Identifier;
  genericParams?: GenericParams | undefined;
  params: FnParam[];
  returnType?: TypeExpr | undefined;
  body: Stmt[];
}

export interface FnParam extends AstNode {
  kind: 'FnParam';
  name: Identifier;
  typeExpr: TypeExpr;
}

// ============================================================================
// Test
// ============================================================================

export interface TestDef extends AstNode {
  kind: 'TestDef';
  attributes: TestAttribute[];
  name: Identifier;
  body: TestStmt[];
}

export interface TestAttribute extends AstNode {
  kind: 'TestAttribute';
  name: string;
  params?: TestParam[] | undefined;
}

export interface TestParam extends AstNode {
  kind: 'TestParam';
  name: string;
  value: Expr;
}

export type TestStmt =
  | Stmt
  | AssertStmt
  | WaitStmt
  | DriveStmt
  | SampleStmt;

export interface AssertStmt extends AstNode {
  kind: 'AssertStmt';
  condition: Expr;
  message?: string | undefined;
  /** `else error("...")` — how the run reacts when the condition fails */
  severity?: AssertSeverity | undefined;
}

export type AssertSeverity = 'error' | 'warning' | 'fatal';

export interface WaitStmt extends AstNode {
  kind: 'WaitStmt';
  condition: WaitCondition;
}

export type WaitCondition =
  | { kind: 'ExprWait'; expr: Expr }
  | { kind: 'DurationWait'; value: number; unit: 'ns' | 'us' | 'ms' | 's' }
  | { kind: 'ClockWait'; clock: ClockSpec };

export interface DriveStmt extends AstNode {
  kind: 'DriveStmt';
  target: Identifier;
  value: Expr;
}

export interface SampleStmt extends AstNode {
  kind: 'SampleStmt';
  name: Identifier;
  expr: Expr;
}

// ============================================================================
// Package and Import
// ============================================================================

export interface PackageDecl extends AstNode {
  kind: 'PackageDecl';
  path: Path;
  items: Item[];
}

export interface ImportDecl extends AstNode {
  kind: 'ImportDecl';
  path: ImportPath;
  alias?: Identifier | undefined;
}

export type ImportPath =
  | { kind: 'Simple'; path: Path }
  | { kind: 'Glob'; path: Path }
  | { kind: 'List'; path: Path; items: ImportItem[] };

export interface ImportItem extends AstNode {
  kind: 'ImportItem';
  name: Identifier;
  alias?: Identifier | undefined;
}

// ============================================================================
// Attributes
// ============================================================================

export interface Attribute extends AstNode {
  kind: 'Attribute';
  path: Path;
  args?: AttributeArg[] | undefined;
}

export interface AttributeArg extends AstNode {
  kind: 'AttributeArg';
  name?: Identifier | undefined;
  value: Literal;
}

// ============================================================================
// Common
// ============================================================================

export interface Identifier extends AstNode {
  kind: 'Identifier';
  name: string;
}

export interface Path extends AstNode {
  kind: 'Path';
  segments: Identifier[];
}

export interface ConstDef extends AstNode {
  kind: 'ConstDef';
  visibility: Visibility;
  name: Identifier;
  typeExpr: TypeExpr;
  init: Expr;
}

// ============================================================================
// Test Module (Testbench)
// ============================================================================

/**
 * Test module definition (testbench-style top-level module without ports)
 */
export interface TestModDef extends AstNode {
  kind: 'TestModDef';
  visibility: Visibility;
  name: Identifier;
  items: TestModItem[];
}

/**
 * Test module item
 */
export type TestModItem =
  | SignalDecl
  | ConstDecl
  | TypeAlias
  | InstDecl
  | MemDecl
  | FsmBlock
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
  kind: 'InitialBlock';
  stmts: Stmt[];
}

/**
 * Sequential processing block (Rust code execution in test)
 */
export interface SeqBlock extends AstNode {
  kind: 'SeqBlock';
  name?: Identifier | undefined;
  body: SeqStatement[];
}

/**
 * Seq block statement types
 */
export type SeqStatement =
  | RustStatement
  | SignalAccess
  | AwaitStmt
  | DelayStmt
  | AssertStmt;

/**
 * Rust statement (any valid Rust code)
 */
export interface RustStatement extends AstNode {
  kind: 'RustStatement';
  code: string;
}

/**
 * Signal access operations
 */
export type SignalAccess = SignalRead | SignalWrite;

/**
 * Signal read operation (.value())
 */
export interface SignalRead extends AstNode {
  kind: 'SignalRead';
  signal: Path;
}

/**
 * Signal write operation (.set())
 */
export interface SignalWrite extends AstNode {
  kind: 'SignalWrite';
  signal: Path;
  value: Expr;
}

/**
 * Await statement
 */
export interface AwaitStmt extends AstNode {
  kind: 'AwaitStmt';
  awaitExpr: AwaitExpr;
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
  kind: 'ClockEdgeAwait';
  signal: Expr;
  edge: 'posedge' | 'negedge';
  cycles?: Expr | undefined;
}

/**
 * Until await (await until(condition))
 */
export interface UntilAwait extends AstNode {
  kind: 'UntilAwait';
  condition: Expr;
  timeout?: Duration | undefined;
}

/**
 * Event await (await event(signal))
 */
export interface EventAwait extends AstNode {
  kind: 'EventAwait';
  signal: Expr;
}

/**
 * Async call await (expr.await)
 */
export interface AsyncCallAwait extends AstNode {
  kind: 'AsyncCallAwait';
  expr: Expr;
}

/**
 * Duration with time unit
 */
export interface Duration extends AstNode {
  kind: 'Duration';
  value: number;
  unit: 'ns' | 'us' | 'ms' | 's';
}

/**
 * Delay statement (#time)
 */
export interface DelayStmt extends AstNode {
  kind: 'DelayStmt';
  delay: number | Duration;
}

/**
 * External Rust function import (use rust::...)
 */
export interface UseRustDecl extends AstNode {
  kind: 'UseRustDecl';
  path: string[];
  items: string[] | '*' | undefined;
}

/**
 * External Rust function block (extern rust "module" { ... })
 */
export interface ExternRustBlock extends AstNode {
  kind: 'ExternRustBlock';
  moduleName: string;
  functions: RustFnDecl[];
}

/**
 * Rust function declaration
 */
export interface RustFnDecl extends AstNode {
  kind: 'RustFnDecl';
  isAsync: boolean;
  name: Identifier;
  params: RustParam[];
  returnType?: string | undefined;
}

/**
 * Rust function parameter
 */
export interface RustParam extends AstNode {
  kind: 'RustParam';
  name: Identifier;
  typeStr: string;
}
