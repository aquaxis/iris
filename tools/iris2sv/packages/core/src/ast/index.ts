/**
 * IRIS AST Module
 *
 * Exports all AST types and helper functions.
 */

// Base types
export {
  // Node types
  AstNode,
  Identifier,
  Path,
  Visibility,
  GenericBound,
  GenericParam,
  GenericParams,
  GenericArg,
  GenericArgs,
  Constraint,
  WhereClause,
  AttrArg,
  Attribute,

  // Type expressions
  TypeExpr,
  PrimitiveType,
  TypeAttr,
  ArrayType,
  TupleType,
  UserType,
  GenericType,

  // Expressions
  Expr,
  Literal,
  IntegerLiteral,
  StringLiteral,
  BoolLiteral,
  IdentifierExpr,
  PathExpr,
  UnaryOp,
  UnaryExpr,
  BinaryOp,
  BinaryExpr,
  CallExpr,
  IndexExpr,
  FieldExpr,
  CastExpr,
  IfExpr,
  MatchArm,
  MatchExpr,
  ConcatExpr,
  RepeatExpr,
  ParenExpr,

  // Patterns
  Pattern,
  LiteralPattern,
  IdentifierPattern,
  WildcardPattern,
  PathPattern,
  RangePattern,
  TuplePattern,
  FieldPattern,
  StructPattern,

  // Statements
  Stmt,
  LetStmt,
  VarStmt,
  ConstStmt,
  LValue,
  AssignStmt,
  IfStmt,
  MatchStmt,
  ForStmt,
  WhileStmt,
  ReturnStmt,
  BlockStmt,
  ExprStmt,

  // Helper functions
  createIdentifier,
  createPath,
  identifierToPath,
} from './base.js';

// Item types
export {
  // Source file
  SourceFile,
  Item,

  // Ports
  PortDirection,
  PortDecl,

  // Module items
  ModItem,
  SignalDecl,
  ConstDecl,
  TypeAlias,
  ClockSpec,
  ResetSpec,
  CombBlock,
  SyncBlock,
  Connection,
  InstDecl,
  MemConfigItem,
  MemDecl,

  // FSM
  FsmStateItem,
  FsmStateEnum,
  TransitionAction,
  WhenClause,
  TransitionItem,
  TransitionsBlock,
  OutputCase,
  OutputBlock,
  FsmBlock,

  // Module definition
  ModDef,
  ExternModDef,
  UnionDef,

  // Type definitions
  TypeDef,
  EnumVariant,
  EnumDef,
  StructField,
  StructDef,
  TypeAliasDef,

  // Const definition
  ConstDef,

  // Function definition
  FnParam,
  FnDef,

  // Interface
  InterfaceSignal,
  ViewDirection,
  ViewSignal,
  ViewDef,
  InterfaceDef,

  // Package & Import
  PackageDecl,
  ImportItem,
  ImportDecl,

  // Test
  TestParam,
  TestStmt,
  AssertStmt,
  WaitCondition,
  WaitStmt,
  DriveStmt,
  SampleStmt,
  TestDef,

  // Test module (testbench)
  TestModDef,
  TestModItem,
  InitialBlock,
  SeqBlock,
  SeqStatement,
  RustStatement,
  SignalRead,
  SignalWrite,
  AwaitExpr,
  ClockEdgeAwait,
  UntilAwait,
  EventAwait,
  AsyncCallAwait,
  AwaitStmt,
  Duration,
  DelayStmt,
  UseRustDecl,
  ExternRustBlock,
  RustFnDecl,
  RustParam,

  // Helper functions
  createSourceFile,
  createModDef,
} from './items.js';

// Visitor pattern
export {
  AstVisitor,
  BaseVisitor,
  walkAst,
  collectNodes,
  countNodes,
  findIdentifiers,
} from './visitor.js';
