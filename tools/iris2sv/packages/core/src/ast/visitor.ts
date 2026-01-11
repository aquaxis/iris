/**
 * IRIS AST Visitor Pattern
 *
 * Provides interfaces and functions for traversing the AST.
 */

import type {
  // Base types
  AstNode,
  Identifier,
  Path,
  GenericParam,
  GenericParams,
  GenericArg,
  GenericArgs,
  Attribute,
  AttrArg,
  WhereClause,
  Constraint,

  // Type expressions
  TypeExpr,
  PrimitiveType,
  ArrayType,
  TupleType,
  UserType,
  GenericType,

  // Expressions
  Expr,
  IntegerLiteral,
  StringLiteral,
  BoolLiteral,
  IdentifierExpr,
  PathExpr,
  UnaryExpr,
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
  AssignStmt,
  IfStmt,
  MatchStmt,
  ForStmt,
  WhileStmt,
  ReturnStmt,
  BlockStmt,
  ExprStmt,
  LValue,
} from './base.js';

import type {
  // Source file
  SourceFile,
  Item,

  // Ports
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
  MemDecl,
  MemConfigItem,

  // FSM
  FsmStateItem,
  FsmStateEnum,
  WhenClause,
  TransitionItem,
  TransitionsBlock,
  OutputCase,
  OutputBlock,
  FsmBlock,

  // Module definition
  ModDef,

  // Type definitions
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
  ViewSignal,
  ViewDef,
  InterfaceDef,

  // Package & Import
  PackageDecl,
  ImportItem,
  ImportDecl,

  // Test
  TestDef,
  AssertStmt,
  WaitStmt,
  DriveStmt,
  SampleStmt,
} from './items.js';

/**
 * Visitor interface for AST traversal.
 *
 * Each method returns a result type R, which can be used to transform nodes.
 * Methods can return undefined to indicate "no change" in transformation contexts.
 *
 * The default implementations return undefined, so visitors only need to
 * implement the methods they care about.
 */
export interface AstVisitor<R = void> {
  // ==================== Source File ====================
  visitSourceFile?(node: SourceFile): R;
  visitItem?(node: Item): R;

  // ==================== Module ====================
  visitModDef?(node: ModDef): R;
  visitPortDecl?(node: PortDecl): R;
  visitModItem?(node: ModItem): R;

  // ==================== Module Items ====================
  visitSignalDecl?(node: SignalDecl): R;
  visitConstDecl?(node: ConstDecl): R;
  visitTypeAlias?(node: TypeAlias): R;
  visitCombBlock?(node: CombBlock): R;
  visitSyncBlock?(node: SyncBlock): R;
  visitInstDecl?(node: InstDecl): R;
  visitMemDecl?(node: MemDecl): R;
  visitFsmBlock?(node: FsmBlock): R;

  // ==================== FSM ====================
  visitFsmStateEnum?(node: FsmStateEnum): R;
  visitFsmStateItem?(node: FsmStateItem): R;
  visitTransitionsBlock?(node: TransitionsBlock): R;
  visitTransitionItem?(node: TransitionItem): R;
  visitWhenClause?(node: WhenClause): R;
  visitOutputBlock?(node: OutputBlock): R;
  visitOutputCase?(node: OutputCase): R;

  // ==================== Clock/Reset ====================
  visitClockSpec?(node: ClockSpec): R;
  visitResetSpec?(node: ResetSpec): R;
  visitConnection?(node: Connection): R;
  visitMemConfigItem?(node: MemConfigItem): R;

  // ==================== Type Definitions ====================
  visitEnumDef?(node: EnumDef): R;
  visitEnumVariant?(node: EnumVariant): R;
  visitStructDef?(node: StructDef): R;
  visitStructField?(node: StructField): R;
  visitTypeAliasDef?(node: TypeAliasDef): R;
  visitConstDef?(node: ConstDef): R;

  // ==================== Function ====================
  visitFnDef?(node: FnDef): R;
  visitFnParam?(node: FnParam): R;

  // ==================== Interface ====================
  visitInterfaceDef?(node: InterfaceDef): R;
  visitInterfaceSignal?(node: InterfaceSignal): R;
  visitViewDef?(node: ViewDef): R;
  visitViewSignal?(node: ViewSignal): R;

  // ==================== Package & Import ====================
  visitPackageDecl?(node: PackageDecl): R;
  visitImportDecl?(node: ImportDecl): R;
  visitImportItem?(node: ImportItem): R;

  // ==================== Test ====================
  visitTestDef?(node: TestDef): R;
  visitAssertStmt?(node: AssertStmt): R;
  visitWaitStmt?(node: WaitStmt): R;
  visitDriveStmt?(node: DriveStmt): R;
  visitSampleStmt?(node: SampleStmt): R;

  // ==================== Type Expressions ====================
  visitTypeExpr?(node: TypeExpr): R;
  visitPrimitiveType?(node: PrimitiveType): R;
  visitArrayType?(node: ArrayType): R;
  visitTupleType?(node: TupleType): R;
  visitUserType?(node: UserType): R;
  visitGenericType?(node: GenericType): R;

  // ==================== Expressions ====================
  visitExpr?(node: Expr): R;
  visitIntegerLiteral?(node: IntegerLiteral): R;
  visitStringLiteral?(node: StringLiteral): R;
  visitBoolLiteral?(node: BoolLiteral): R;
  visitIdentifierExpr?(node: IdentifierExpr): R;
  visitPathExpr?(node: PathExpr): R;
  visitUnaryExpr?(node: UnaryExpr): R;
  visitBinaryExpr?(node: BinaryExpr): R;
  visitCallExpr?(node: CallExpr): R;
  visitIndexExpr?(node: IndexExpr): R;
  visitFieldExpr?(node: FieldExpr): R;
  visitCastExpr?(node: CastExpr): R;
  visitIfExpr?(node: IfExpr): R;
  visitMatchExpr?(node: MatchExpr): R;
  visitMatchArm?(node: MatchArm): R;
  visitConcatExpr?(node: ConcatExpr): R;
  visitRepeatExpr?(node: RepeatExpr): R;
  visitParenExpr?(node: ParenExpr): R;

  // ==================== Statements ====================
  visitStmt?(node: Stmt): R;
  visitLetStmt?(node: LetStmt): R;
  visitVarStmt?(node: VarStmt): R;
  visitConstStmt?(node: ConstStmt): R;
  visitAssignStmt?(node: AssignStmt): R;
  visitIfStmt?(node: IfStmt): R;
  visitMatchStmt?(node: MatchStmt): R;
  visitForStmt?(node: ForStmt): R;
  visitWhileStmt?(node: WhileStmt): R;
  visitReturnStmt?(node: ReturnStmt): R;
  visitBlockStmt?(node: BlockStmt): R;
  visitExprStmt?(node: ExprStmt): R;
  visitLValue?(node: LValue): R;

  // ==================== Patterns ====================
  visitPattern?(node: Pattern): R;
  visitLiteralPattern?(node: LiteralPattern): R;
  visitIdentifierPattern?(node: IdentifierPattern): R;
  visitWildcardPattern?(node: WildcardPattern): R;
  visitPathPattern?(node: PathPattern): R;
  visitRangePattern?(node: RangePattern): R;
  visitTuplePattern?(node: TuplePattern): R;
  visitStructPattern?(node: StructPattern): R;
  visitFieldPattern?(node: FieldPattern): R;

  // ==================== Basic ====================
  visitIdentifier?(node: Identifier): R;
  visitPath?(node: Path): R;
  visitAttribute?(node: Attribute): R;
  visitAttrArg?(node: AttrArg): R;
  visitGenericParams?(node: GenericParams): R;
  visitGenericParam?(node: GenericParam): R;
  visitGenericArgs?(node: GenericArgs): R;
  visitGenericArg?(node: GenericArg): R;
  visitWhereClause?(node: WhereClause): R;
  visitConstraint?(node: Constraint): R;
}

/**
 * Abstract base class for AST visitors.
 *
 * Provides default implementations that walk the entire tree.
 * Subclasses can override specific methods to process particular node types.
 */
export abstract class BaseVisitor<R = void> implements AstVisitor<R> {
  // ==================== Source File ====================

  visitSourceFile(node: SourceFile): R {
    for (const item of node.items) {
      this.visitItem(item);
    }
    return undefined as R;
  }

  visitItem(node: Item): R {
    switch (node.kind) {
      case 'ModDef':
        return this.visitModDef(node);
      case 'EnumDef':
        return this.visitEnumDef(node);
      case 'StructDef':
        return this.visitStructDef(node);
      case 'TypeAliasDef':
        return this.visitTypeAliasDef(node);
      case 'ConstDef':
        return this.visitConstDef(node);
      case 'FnDef':
        return this.visitFnDef(node);
      case 'InterfaceDef':
        return this.visitInterfaceDef(node);
      case 'PackageDecl':
        return this.visitPackageDecl(node);
      case 'ImportDecl':
        return this.visitImportDecl(node);
      case 'TestDef':
        return this.visitTestDef(node);
    }
  }

  // ==================== Module ====================

  visitModDef(node: ModDef): R {
    if (node.attributes) {
      for (const attr of node.attributes) {
        this.visitAttribute(attr);
      }
    }
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    if (node.whereClause) {
      this.visitWhereClause(node.whereClause);
    }
    for (const port of node.ports) {
      this.visitPortDecl(port);
    }
    for (const item of node.items) {
      this.visitModItem(item);
    }
    return undefined as R;
  }

  visitPortDecl(node: PortDecl): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  visitModItem(node: ModItem): R {
    switch (node.kind) {
      case 'SignalDecl':
        return this.visitSignalDecl(node);
      case 'ConstDecl':
        return this.visitConstDecl(node);
      case 'TypeAlias':
        return this.visitTypeAlias(node);
      case 'CombBlock':
        return this.visitCombBlock(node);
      case 'SyncBlock':
        return this.visitSyncBlock(node);
      case 'FsmBlock':
        return this.visitFsmBlock(node);
      case 'InstDecl':
        return this.visitInstDecl(node);
      case 'MemDecl':
        return this.visitMemDecl(node);
    }
  }

  // ==================== Module Items ====================

  visitSignalDecl(node: SignalDecl): R {
    this.visitIdentifier(node.name);
    if (node.type) {
      this.visitTypeExpr(node.type);
    }
    if (node.init) {
      this.visitExpr(node.init);
    }
    return undefined as R;
  }

  visitConstDecl(node: ConstDecl): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    this.visitExpr(node.init);
    return undefined as R;
  }

  visitTypeAlias(node: TypeAlias): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  visitCombBlock(node: CombBlock): R {
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitSyncBlock(node: SyncBlock): R {
    this.visitClockSpec(node.clock);
    if (node.reset) {
      this.visitResetSpec(node.reset);
    }
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitInstDecl(node: InstDecl): R {
    this.visitIdentifier(node.name);
    this.visitPath(node.module);
    if (node.genericArgs) {
      this.visitGenericArgs(node.genericArgs);
    }
    for (const conn of node.connections) {
      this.visitConnection(conn);
    }
    return undefined as R;
  }

  visitMemDecl(node: MemDecl): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.elementType);
    this.visitExpr(node.depth);
    if (node.config) {
      for (const item of node.config) {
        this.visitMemConfigItem(item);
      }
    }
    if (node.init) {
      this.visitExpr(node.init);
    }
    return undefined as R;
  }

  visitFsmBlock(node: FsmBlock): R {
    this.visitIdentifier(node.name);
    this.visitClockSpec(node.clock);
    if (node.reset) {
      this.visitResetSpec(node.reset);
    }
    this.visitFsmStateEnum(node.states);
    this.visitTransitionsBlock(node.transitions);
    for (const output of node.outputs) {
      this.visitOutputBlock(output);
    }
    return undefined as R;
  }

  // ==================== FSM ====================

  visitFsmStateEnum(node: FsmStateEnum): R {
    for (const state of node.states) {
      this.visitFsmStateItem(state);
    }
    return undefined as R;
  }

  visitFsmStateItem(node: FsmStateItem): R {
    this.visitIdentifier(node.name);
    if (node.outputs) {
      for (const output of node.outputs) {
        this.visitIdentifier(output.name);
        this.visitExpr(output.value);
      }
    }
    return undefined as R;
  }

  visitTransitionsBlock(node: TransitionsBlock): R {
    for (const item of node.items) {
      this.visitTransitionItem(item);
    }
    return undefined as R;
  }

  visitTransitionItem(node: TransitionItem): R {
    if (node.state !== '_') {
      this.visitIdentifier(node.state);
    }
    for (const clause of node.clauses) {
      this.visitWhenClause(clause);
    }
    return undefined as R;
  }

  visitWhenClause(node: WhenClause): R {
    this.visitExpr(node.condition);
    for (const action of node.actions) {
      if (action.kind === 'GotoAction') {
        this.visitIdentifier(action.target);
      } else {
        this.visitStmt(action.stmt);
      }
    }
    return undefined as R;
  }

  visitOutputBlock(node: OutputBlock): R {
    this.visitIdentifier(node.signal);
    for (const c of node.cases) {
      this.visitOutputCase(c);
    }
    return undefined as R;
  }

  visitOutputCase(node: OutputCase): R {
    this.visitIdentifier(node.state);
    this.visitExpr(node.value);
    return undefined as R;
  }

  // ==================== Clock/Reset ====================

  visitClockSpec(node: ClockSpec): R {
    this.visitExpr(node.signal);
    return undefined as R;
  }

  visitResetSpec(node: ResetSpec): R {
    this.visitExpr(node.signal);
    return undefined as R;
  }

  visitConnection(node: Connection): R {
    this.visitIdentifier(node.port);
    this.visitExpr(node.expr);
    return undefined as R;
  }

  visitMemConfigItem(node: MemConfigItem): R {
    this.visitExpr(node.value);
    return undefined as R;
  }

  // ==================== Type Definitions ====================

  visitEnumDef(node: EnumDef): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    for (const variant of node.variants) {
      this.visitEnumVariant(variant);
    }
    return undefined as R;
  }

  visitEnumVariant(node: EnumVariant): R {
    this.visitIdentifier(node.name);
    if (node.value) {
      this.visitExpr(node.value);
    }
    return undefined as R;
  }

  visitStructDef(node: StructDef): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    for (const field of node.fields) {
      this.visitStructField(field);
    }
    return undefined as R;
  }

  visitStructField(node: StructField): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  visitTypeAliasDef(node: TypeAliasDef): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  visitConstDef(node: ConstDef): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    this.visitExpr(node.init);
    return undefined as R;
  }

  // ==================== Function ====================

  visitFnDef(node: FnDef): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    for (const param of node.params) {
      this.visitFnParam(param);
    }
    if (node.returnType) {
      this.visitTypeExpr(node.returnType);
    }
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitFnParam(node: FnParam): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  // ==================== Interface ====================

  visitInterfaceDef(node: InterfaceDef): R {
    this.visitIdentifier(node.name);
    if (node.genericParams) {
      this.visitGenericParams(node.genericParams);
    }
    for (const signal of node.signals) {
      this.visitInterfaceSignal(signal);
    }
    for (const view of node.views) {
      this.visitViewDef(view);
    }
    return undefined as R;
  }

  visitInterfaceSignal(node: InterfaceSignal): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    return undefined as R;
  }

  visitViewDef(node: ViewDef): R {
    this.visitIdentifier(node.name);
    for (const signal of node.signals) {
      this.visitViewSignal(signal);
    }
    return undefined as R;
  }

  visitViewSignal(node: ViewSignal): R {
    this.visitIdentifier(node.name);
    return undefined as R;
  }

  // ==================== Package & Import ====================

  visitPackageDecl(node: PackageDecl): R {
    this.visitPath(node.path);
    for (const item of node.items) {
      this.visitItem(item);
    }
    return undefined as R;
  }

  visitImportDecl(node: ImportDecl): R {
    this.visitPath(node.path);
    if (Array.isArray(node.items)) {
      for (const item of node.items) {
        this.visitImportItem(item);
      }
    }
    if (node.alias) {
      this.visitIdentifier(node.alias);
    }
    return undefined as R;
  }

  visitImportItem(node: ImportItem): R {
    this.visitIdentifier(node.name);
    if (node.alias) {
      this.visitIdentifier(node.alias);
    }
    return undefined as R;
  }

  // ==================== Test ====================

  visitTestDef(node: TestDef): R {
    this.visitIdentifier(node.name);
    for (const stmt of node.body) {
      this.visitTestStmt(stmt);
    }
    return undefined as R;
  }

  private visitTestStmt(node: Stmt | AssertStmt | WaitStmt | DriveStmt | SampleStmt): void {
    switch (node.kind) {
      case 'AssertStmt':
        this.visitAssertStmt(node);
        break;
      case 'WaitStmt':
        this.visitWaitStmt(node);
        break;
      case 'DriveStmt':
        this.visitDriveStmt(node);
        break;
      case 'SampleStmt':
        this.visitSampleStmt(node);
        break;
      default:
        this.visitStmt(node);
    }
  }

  visitAssertStmt(node: AssertStmt): R {
    this.visitExpr(node.condition);
    return undefined as R;
  }

  visitWaitStmt(node: WaitStmt): R {
    if (node.condition.kind === 'ExprCondition') {
      this.visitExpr(node.condition.expr);
    } else if (node.condition.kind === 'ClockCondition') {
      this.visitClockSpec(node.condition.clock);
    }
    return undefined as R;
  }

  visitDriveStmt(node: DriveStmt): R {
    this.visitIdentifier(node.signal);
    this.visitExpr(node.value);
    return undefined as R;
  }

  visitSampleStmt(node: SampleStmt): R {
    this.visitIdentifier(node.variable);
    this.visitExpr(node.signal);
    return undefined as R;
  }

  // ==================== Type Expressions ====================

  visitTypeExpr(node: TypeExpr): R {
    switch (node.kind) {
      case 'PrimitiveType':
        return this.visitPrimitiveType(node);
      case 'ArrayType':
        return this.visitArrayType(node);
      case 'TupleType':
        return this.visitTupleType(node);
      case 'UserType':
        return this.visitUserType(node);
      case 'GenericType':
        return this.visitGenericType(node);
    }
  }

  visitPrimitiveType(node: PrimitiveType): R {
    if (node.width) {
      this.visitExpr(node.width);
    }
    return undefined as R;
  }

  visitArrayType(node: ArrayType): R {
    this.visitTypeExpr(node.elementType);
    this.visitExpr(node.size);
    return undefined as R;
  }

  visitTupleType(node: TupleType): R {
    for (const elem of node.elements) {
      this.visitTypeExpr(elem);
    }
    return undefined as R;
  }

  visitUserType(node: UserType): R {
    this.visitPath(node.path);
    return undefined as R;
  }

  visitGenericType(node: GenericType): R {
    this.visitPath(node.path);
    this.visitGenericArgs(node.args);
    return undefined as R;
  }

  // ==================== Expressions ====================

  visitExpr(node: Expr): R {
    switch (node.kind) {
      case 'IntegerLiteral':
        return this.visitIntegerLiteral(node);
      case 'StringLiteral':
        return this.visitStringLiteral(node);
      case 'BoolLiteral':
        return this.visitBoolLiteral(node);
      case 'IdentifierExpr':
        return this.visitIdentifierExpr(node);
      case 'PathExpr':
        return this.visitPathExpr(node);
      case 'UnaryExpr':
        return this.visitUnaryExpr(node);
      case 'BinaryExpr':
        return this.visitBinaryExpr(node);
      case 'CallExpr':
        return this.visitCallExpr(node);
      case 'IndexExpr':
        return this.visitIndexExpr(node);
      case 'FieldExpr':
        return this.visitFieldExpr(node);
      case 'CastExpr':
        return this.visitCastExpr(node);
      case 'IfExpr':
        return this.visitIfExpr(node);
      case 'MatchExpr':
        return this.visitMatchExpr(node);
      case 'ConcatExpr':
        return this.visitConcatExpr(node);
      case 'RepeatExpr':
        return this.visitRepeatExpr(node);
      case 'ParenExpr':
        return this.visitParenExpr(node);
    }
  }

  visitIntegerLiteral(_node: IntegerLiteral): R {
    return undefined as R;
  }

  visitStringLiteral(_node: StringLiteral): R {
    return undefined as R;
  }

  visitBoolLiteral(_node: BoolLiteral): R {
    return undefined as R;
  }

  visitIdentifierExpr(node: IdentifierExpr): R {
    this.visitIdentifier(node.name);
    return undefined as R;
  }

  visitPathExpr(node: PathExpr): R {
    this.visitPath(node.path);
    return undefined as R;
  }

  visitUnaryExpr(node: UnaryExpr): R {
    this.visitExpr(node.operand);
    return undefined as R;
  }

  visitBinaryExpr(node: BinaryExpr): R {
    this.visitExpr(node.left);
    this.visitExpr(node.right);
    return undefined as R;
  }

  visitCallExpr(node: CallExpr): R {
    this.visitExpr(node.callee);
    for (const arg of node.args) {
      this.visitExpr(arg);
    }
    return undefined as R;
  }

  visitIndexExpr(node: IndexExpr): R {
    this.visitExpr(node.base);
    this.visitExpr(node.index);
    if (node.endIndex) {
      this.visitExpr(node.endIndex);
    }
    return undefined as R;
  }

  visitFieldExpr(node: FieldExpr): R {
    this.visitExpr(node.base);
    this.visitIdentifier(node.field);
    return undefined as R;
  }

  visitCastExpr(node: CastExpr): R {
    this.visitExpr(node.expr);
    this.visitTypeExpr(node.targetType);
    return undefined as R;
  }

  visitIfExpr(node: IfExpr): R {
    this.visitExpr(node.condition);
    this.visitExpr(node.thenExpr);
    this.visitExpr(node.elseExpr);
    return undefined as R;
  }

  visitMatchExpr(node: MatchExpr): R {
    this.visitExpr(node.scrutinee);
    for (const arm of node.arms) {
      this.visitMatchArm(arm);
    }
    return undefined as R;
  }

  visitMatchArm(node: MatchArm): R {
    this.visitPattern(node.pattern);
    if (Array.isArray(node.body)) {
      for (const stmt of node.body) {
        this.visitStmt(stmt);
      }
    } else {
      this.visitExpr(node.body);
    }
    return undefined as R;
  }

  visitConcatExpr(node: ConcatExpr): R {
    for (const elem of node.elements) {
      this.visitExpr(elem);
    }
    return undefined as R;
  }

  visitRepeatExpr(node: RepeatExpr): R {
    this.visitExpr(node.expr);
    this.visitExpr(node.count);
    return undefined as R;
  }

  visitParenExpr(node: ParenExpr): R {
    this.visitExpr(node.expr);
    return undefined as R;
  }

  // ==================== Statements ====================

  visitStmt(node: Stmt): R {
    switch (node.kind) {
      case 'LetStmt':
        return this.visitLetStmt(node);
      case 'VarStmt':
        return this.visitVarStmt(node);
      case 'ConstStmt':
        return this.visitConstStmt(node);
      case 'AssignStmt':
        return this.visitAssignStmt(node);
      case 'IfStmt':
        return this.visitIfStmt(node);
      case 'MatchStmt':
        return this.visitMatchStmt(node);
      case 'ForStmt':
        return this.visitForStmt(node);
      case 'WhileStmt':
        return this.visitWhileStmt(node);
      case 'ReturnStmt':
        return this.visitReturnStmt(node);
      case 'BlockStmt':
        return this.visitBlockStmt(node);
      case 'ExprStmt':
        return this.visitExprStmt(node);
    }
  }

  visitLetStmt(node: LetStmt): R {
    this.visitIdentifier(node.name);
    if (node.type) {
      this.visitTypeExpr(node.type);
    }
    if (node.init) {
      this.visitExpr(node.init);
    }
    return undefined as R;
  }

  visitVarStmt(node: VarStmt): R {
    this.visitIdentifier(node.name);
    if (node.type) {
      this.visitTypeExpr(node.type);
    }
    if (node.init) {
      this.visitExpr(node.init);
    }
    return undefined as R;
  }

  visitConstStmt(node: ConstStmt): R {
    this.visitIdentifier(node.name);
    this.visitTypeExpr(node.type);
    this.visitExpr(node.init);
    return undefined as R;
  }

  visitAssignStmt(node: AssignStmt): R {
    this.visitLValue(node.lvalue);
    this.visitExpr(node.value);
    return undefined as R;
  }

  visitLValue(node: LValue): R {
    switch (node.kind) {
      case 'IdentifierLValue':
        this.visitIdentifier(node.name);
        break;
      case 'IndexLValue':
        this.visitLValue(node.base);
        this.visitExpr(node.index);
        if (node.endIndex) {
          this.visitExpr(node.endIndex);
        }
        break;
      case 'FieldLValue':
        this.visitLValue(node.base);
        this.visitIdentifier(node.field);
        break;
      case 'ConcatLValue':
        for (const elem of node.elements) {
          this.visitLValue(elem);
        }
        break;
    }
    return undefined as R;
  }

  visitIfStmt(node: IfStmt): R {
    this.visitExpr(node.condition);
    for (const stmt of node.thenBranch) {
      this.visitStmt(stmt);
    }
    if (node.elseBranch) {
      if (Array.isArray(node.elseBranch)) {
        for (const stmt of node.elseBranch) {
          this.visitStmt(stmt);
        }
      } else {
        this.visitIfStmt(node.elseBranch);
      }
    }
    return undefined as R;
  }

  visitMatchStmt(node: MatchStmt): R {
    this.visitExpr(node.scrutinee);
    for (const arm of node.arms) {
      this.visitMatchArm(arm);
    }
    return undefined as R;
  }

  visitForStmt(node: ForStmt): R {
    this.visitIdentifier(node.variable);
    this.visitExpr(node.start);
    this.visitExpr(node.end);
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitWhileStmt(node: WhileStmt): R {
    this.visitExpr(node.condition);
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitReturnStmt(node: ReturnStmt): R {
    if (node.value) {
      this.visitExpr(node.value);
    }
    return undefined as R;
  }

  visitBlockStmt(node: BlockStmt): R {
    for (const stmt of node.statements) {
      this.visitStmt(stmt);
    }
    return undefined as R;
  }

  visitExprStmt(node: ExprStmt): R {
    this.visitExpr(node.expr);
    return undefined as R;
  }

  // ==================== Patterns ====================

  visitPattern(node: Pattern): R {
    switch (node.kind) {
      case 'LiteralPattern':
        return this.visitLiteralPattern(node);
      case 'IdentifierPattern':
        return this.visitIdentifierPattern(node);
      case 'WildcardPattern':
        return this.visitWildcardPattern(node);
      case 'PathPattern':
        return this.visitPathPattern(node);
      case 'RangePattern':
        return this.visitRangePattern(node);
      case 'TuplePattern':
        return this.visitTuplePattern(node);
      case 'StructPattern':
        return this.visitStructPattern(node);
    }
  }

  visitLiteralPattern(node: LiteralPattern): R {
    this.visitExpr(node.literal);
    return undefined as R;
  }

  visitIdentifierPattern(node: IdentifierPattern): R {
    this.visitIdentifier(node.name);
    return undefined as R;
  }

  visitWildcardPattern(_node: WildcardPattern): R {
    return undefined as R;
  }

  visitPathPattern(node: PathPattern): R {
    this.visitPath(node.path);
    return undefined as R;
  }

  visitRangePattern(node: RangePattern): R {
    this.visitExpr(node.start);
    this.visitExpr(node.end);
    return undefined as R;
  }

  visitTuplePattern(node: TuplePattern): R {
    for (const elem of node.elements) {
      this.visitPattern(elem);
    }
    return undefined as R;
  }

  visitStructPattern(node: StructPattern): R {
    this.visitPath(node.path);
    for (const field of node.fields) {
      this.visitFieldPattern(field);
    }
    return undefined as R;
  }

  visitFieldPattern(node: FieldPattern): R {
    this.visitIdentifier(node.name);
    if (node.pattern) {
      this.visitPattern(node.pattern);
    }
    return undefined as R;
  }

  // ==================== Basic ====================

  visitIdentifier(_node: Identifier): R {
    return undefined as R;
  }

  visitPath(node: Path): R {
    for (const seg of node.segments) {
      this.visitIdentifier(seg);
    }
    return undefined as R;
  }

  visitAttribute(node: Attribute): R {
    this.visitPath(node.path);
    if (node.args) {
      for (const arg of node.args) {
        this.visitAttrArg(arg);
      }
    }
    return undefined as R;
  }

  visitAttrArg(node: AttrArg): R {
    if (node.name) {
      this.visitIdentifier(node.name);
    }
    this.visitExpr(node.value);
    return undefined as R;
  }

  visitGenericParams(node: GenericParams): R {
    for (const param of node.params) {
      this.visitGenericParam(param);
    }
    return undefined as R;
  }

  visitGenericParam(node: GenericParam): R {
    this.visitIdentifier(node.name);
    if (node.defaultValue) {
      this.visitExpr(node.defaultValue);
    }
    return undefined as R;
  }

  visitGenericArgs(node: GenericArgs): R {
    for (const arg of node.args) {
      this.visitGenericArg(arg);
    }
    return undefined as R;
  }

  visitGenericArg(node: GenericArg): R {
    if (node.name) {
      this.visitIdentifier(node.name);
    }
    // value can be TypeExpr or Expr
    const value = node.value as AstNode;
    if ('type' in value || value.kind === 'PrimitiveType' ||
        value.kind === 'ArrayType' || value.kind === 'TupleType' ||
        value.kind === 'UserType' || value.kind === 'GenericType') {
      this.visitTypeExpr(value as TypeExpr);
    } else {
      this.visitExpr(value as Expr);
    }
    return undefined as R;
  }

  visitWhereClause(node: WhereClause): R {
    for (const constraint of node.constraints) {
      this.visitConstraint(constraint);
    }
    return undefined as R;
  }

  visitConstraint(node: Constraint): R {
    this.visitIdentifier(node.name);
    if (node.kind === 'TypeConstraint') {
      this.visitTypeExpr(node.type);
    } else {
      this.visitExpr(node.value);
    }
    return undefined as R;
  }
}

// ==================== Utility Functions ====================

/**
 * Walk the AST and call the visitor's methods.
 */
export function walkAst<R>(node: AstNode, visitor: AstVisitor<R>): R | undefined {
  switch (node.kind) {
    // Source file
    case 'SourceFile':
      return visitor.visitSourceFile?.(node as SourceFile);

    // Module
    case 'ModDef':
      return visitor.visitModDef?.(node as ModDef);
    case 'PortDecl':
      return visitor.visitPortDecl?.(node as PortDecl);

    // Module items
    case 'SignalDecl':
      return visitor.visitSignalDecl?.(node as SignalDecl);
    case 'ConstDecl':
      return visitor.visitConstDecl?.(node as ConstDecl);
    case 'TypeAlias':
      return visitor.visitTypeAlias?.(node as TypeAlias);
    case 'CombBlock':
      return visitor.visitCombBlock?.(node as CombBlock);
    case 'SyncBlock':
      return visitor.visitSyncBlock?.(node as SyncBlock);
    case 'InstDecl':
      return visitor.visitInstDecl?.(node as InstDecl);
    case 'MemDecl':
      return visitor.visitMemDecl?.(node as MemDecl);
    case 'FsmBlock':
      return visitor.visitFsmBlock?.(node as FsmBlock);

    // FSM
    case 'FsmStateEnum':
      return visitor.visitFsmStateEnum?.(node as FsmStateEnum);
    case 'FsmStateItem':
      return visitor.visitFsmStateItem?.(node as FsmStateItem);
    case 'TransitionsBlock':
      return visitor.visitTransitionsBlock?.(node as TransitionsBlock);
    case 'TransitionItem':
      return visitor.visitTransitionItem?.(node as TransitionItem);
    case 'WhenClause':
      return visitor.visitWhenClause?.(node as WhenClause);
    case 'OutputBlock':
      return visitor.visitOutputBlock?.(node as OutputBlock);
    case 'OutputCase':
      return visitor.visitOutputCase?.(node as OutputCase);

    // Clock/Reset
    case 'ClockSpec':
      return visitor.visitClockSpec?.(node as ClockSpec);
    case 'ResetSpec':
      return visitor.visitResetSpec?.(node as ResetSpec);
    case 'Connection':
      return visitor.visitConnection?.(node as Connection);
    case 'MemConfigItem':
      return visitor.visitMemConfigItem?.(node as MemConfigItem);

    // Type definitions
    case 'EnumDef':
      return visitor.visitEnumDef?.(node as EnumDef);
    case 'EnumVariant':
      return visitor.visitEnumVariant?.(node as EnumVariant);
    case 'StructDef':
      return visitor.visitStructDef?.(node as StructDef);
    case 'StructField':
      return visitor.visitStructField?.(node as StructField);
    case 'TypeAliasDef':
      return visitor.visitTypeAliasDef?.(node as TypeAliasDef);
    case 'ConstDef':
      return visitor.visitConstDef?.(node as ConstDef);

    // Function
    case 'FnDef':
      return visitor.visitFnDef?.(node as FnDef);
    case 'FnParam':
      return visitor.visitFnParam?.(node as FnParam);

    // Interface
    case 'InterfaceDef':
      return visitor.visitInterfaceDef?.(node as InterfaceDef);
    case 'InterfaceSignal':
      return visitor.visitInterfaceSignal?.(node as InterfaceSignal);
    case 'ViewDef':
      return visitor.visitViewDef?.(node as ViewDef);
    case 'ViewSignal':
      return visitor.visitViewSignal?.(node as ViewSignal);

    // Package & Import
    case 'PackageDecl':
      return visitor.visitPackageDecl?.(node as PackageDecl);
    case 'ImportDecl':
      return visitor.visitImportDecl?.(node as ImportDecl);
    case 'ImportItem':
      return visitor.visitImportItem?.(node as ImportItem);

    // Test
    case 'TestDef':
      return visitor.visitTestDef?.(node as TestDef);
    case 'AssertStmt':
      return visitor.visitAssertStmt?.(node as AssertStmt);
    case 'WaitStmt':
      return visitor.visitWaitStmt?.(node as WaitStmt);
    case 'DriveStmt':
      return visitor.visitDriveStmt?.(node as DriveStmt);
    case 'SampleStmt':
      return visitor.visitSampleStmt?.(node as SampleStmt);

    // Type expressions
    case 'PrimitiveType':
      return visitor.visitPrimitiveType?.(node as PrimitiveType);
    case 'ArrayType':
      return visitor.visitArrayType?.(node as ArrayType);
    case 'TupleType':
      return visitor.visitTupleType?.(node as TupleType);
    case 'UserType':
      return visitor.visitUserType?.(node as UserType);
    case 'GenericType':
      return visitor.visitGenericType?.(node as GenericType);

    // Expressions
    case 'IntegerLiteral':
      return visitor.visitIntegerLiteral?.(node as IntegerLiteral);
    case 'StringLiteral':
      return visitor.visitStringLiteral?.(node as StringLiteral);
    case 'BoolLiteral':
      return visitor.visitBoolLiteral?.(node as BoolLiteral);
    case 'IdentifierExpr':
      return visitor.visitIdentifierExpr?.(node as IdentifierExpr);
    case 'PathExpr':
      return visitor.visitPathExpr?.(node as PathExpr);
    case 'UnaryExpr':
      return visitor.visitUnaryExpr?.(node as UnaryExpr);
    case 'BinaryExpr':
      return visitor.visitBinaryExpr?.(node as BinaryExpr);
    case 'CallExpr':
      return visitor.visitCallExpr?.(node as CallExpr);
    case 'IndexExpr':
      return visitor.visitIndexExpr?.(node as IndexExpr);
    case 'FieldExpr':
      return visitor.visitFieldExpr?.(node as FieldExpr);
    case 'CastExpr':
      return visitor.visitCastExpr?.(node as CastExpr);
    case 'IfExpr':
      return visitor.visitIfExpr?.(node as IfExpr);
    case 'MatchExpr':
      return visitor.visitMatchExpr?.(node as MatchExpr);
    case 'MatchArm':
      return visitor.visitMatchArm?.(node as MatchArm);
    case 'ConcatExpr':
      return visitor.visitConcatExpr?.(node as ConcatExpr);
    case 'RepeatExpr':
      return visitor.visitRepeatExpr?.(node as RepeatExpr);
    case 'ParenExpr':
      return visitor.visitParenExpr?.(node as ParenExpr);

    // Statements
    case 'LetStmt':
      return visitor.visitLetStmt?.(node as LetStmt);
    case 'VarStmt':
      return visitor.visitVarStmt?.(node as VarStmt);
    case 'ConstStmt':
      return visitor.visitConstStmt?.(node as ConstStmt);
    case 'AssignStmt':
      return visitor.visitAssignStmt?.(node as AssignStmt);
    case 'IfStmt':
      return visitor.visitIfStmt?.(node as IfStmt);
    case 'MatchStmt':
      return visitor.visitMatchStmt?.(node as MatchStmt);
    case 'ForStmt':
      return visitor.visitForStmt?.(node as ForStmt);
    case 'WhileStmt':
      return visitor.visitWhileStmt?.(node as WhileStmt);
    case 'ReturnStmt':
      return visitor.visitReturnStmt?.(node as ReturnStmt);
    case 'BlockStmt':
      return visitor.visitBlockStmt?.(node as BlockStmt);
    case 'ExprStmt':
      return visitor.visitExprStmt?.(node as ExprStmt);

    // Patterns
    case 'LiteralPattern':
      return visitor.visitLiteralPattern?.(node as LiteralPattern);
    case 'IdentifierPattern':
      return visitor.visitIdentifierPattern?.(node as IdentifierPattern);
    case 'WildcardPattern':
      return visitor.visitWildcardPattern?.(node as WildcardPattern);
    case 'PathPattern':
      return visitor.visitPathPattern?.(node as PathPattern);
    case 'RangePattern':
      return visitor.visitRangePattern?.(node as RangePattern);
    case 'TuplePattern':
      return visitor.visitTuplePattern?.(node as TuplePattern);
    case 'StructPattern':
      return visitor.visitStructPattern?.(node as StructPattern);
    case 'FieldPattern':
      return visitor.visitFieldPattern?.(node as FieldPattern);

    // Basic
    case 'Identifier':
      return visitor.visitIdentifier?.(node as Identifier);
    case 'Path':
      return visitor.visitPath?.(node as Path);
    case 'Attribute':
      return visitor.visitAttribute?.(node as Attribute);
    case 'AttrArg':
      return visitor.visitAttrArg?.(node as AttrArg);
    case 'GenericParams':
      return visitor.visitGenericParams?.(node as GenericParams);
    case 'GenericParam':
      return visitor.visitGenericParam?.(node as GenericParam);
    case 'GenericArgs':
      return visitor.visitGenericArgs?.(node as GenericArgs);
    case 'GenericArg':
      return visitor.visitGenericArg?.(node as GenericArg);
    case 'WhereClause':
      return visitor.visitWhereClause?.(node as WhereClause);

    default:
      return undefined;
  }
}

/**
 * Collect all nodes of a specific kind from the AST.
 */
export function collectNodes<T extends AstNode>(
  root: AstNode,
  kind: string
): T[] {
  const nodes: T[] = [];

  class CollectorVisitor extends BaseVisitor {
    visitSourceFile(node: SourceFile): void {
      if (node.kind === kind) nodes.push(node as unknown as T);
      super.visitSourceFile(node);
    }
  }

  const visitor = new CollectorVisitor();
  if (root.kind === 'SourceFile') {
    visitor.visitSourceFile(root as SourceFile);
  }

  return nodes;
}

/**
 * Count the number of nodes in the AST.
 */
export function countNodes(root: AstNode): number {
  let count = 0;

  class CounterVisitor extends BaseVisitor {
    visitIdentifier(_node: Identifier): void {
      count++;
    }
  }

  const visitor = new CounterVisitor();
  if (root.kind === 'SourceFile') {
    visitor.visitSourceFile(root as SourceFile);
  }

  return count;
}

/**
 * Find all identifiers in the AST.
 */
export function findIdentifiers(root: AstNode): Identifier[] {
  const identifiers: Identifier[] = [];

  class IdentifierVisitor extends BaseVisitor {
    visitIdentifier(node: Identifier): void {
      identifiers.push(node);
    }
  }

  const visitor = new IdentifierVisitor();
  if (root.kind === 'SourceFile') {
    visitor.visitSourceFile(root as SourceFile);
  }

  return identifiers;
}
