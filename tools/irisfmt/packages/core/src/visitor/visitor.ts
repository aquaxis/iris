import type {
  AstNode,
  SourceFile,
  Item,
  ModDef,
  ModItem,
  PortDecl,
  GenericParams,
  GenericParam,
  WhereClause,
  Constraint,
  EnumDef,
  EnumVariant,
  StructDef,
  StructField,
  TypeAlias,
  TypeExpr,
  PrimitiveType,
  ArrayType,
  TupleType,
  UserType,
  GenericType,
  GenericArg,
  Expr,
  LiteralExpr,
  IdentExpr,
  PathExpr,
  UnaryExpr,
  BinaryExpr,
  CallExpr,
  IndexExpr,
  FieldExpr,
  CastExpr,
  IfExpr,
  MatchExpr,
  MatchArm,
  ConcatExpr,
  RepeatExpr,
  ParenExpr,
  Pattern,
  LiteralPattern,
  IdentPattern,
  WildcardPattern,
  PathPattern,
  RangePattern,
  TuplePattern,
  StructPattern,
  FieldPattern,
  Stmt,
  LetDecl,
  VarDecl,
  ConstDecl,
  AssignStmt,
  IfStmt,
  MatchStmt,
  ForStmt,
  RangeExpr,
  WhileStmt,
  ReturnStmt,
  BlockStmt,
  ExprStmt,
  CombBlock,
  SyncBlock,
  ClockSpec,
  ResetSpec,
  FsmBlock,
  StateEnum,
  StateItem,
  OutputAssign,
  TransitionsBlock,
  TransitionItem,
  WhenClause,
  OutputBlock,
  OutputCase,
  InstDecl,
  Connection,
  MemDecl,
  MemConfig,
  MemConfigItem,
  InterfaceDef,
  InterfaceSignal,
  ViewDef,
  ViewSignal,
  FnDef,
  FnParam,
  TestDef,
  TestAttribute,
  TestParam,
  TestStmt,
  AssertStmt as TestAssertStmt,
  WaitStmt,
  DriveStmt,
  SampleStmt,
  PackageDecl,
  ImportDecl,
  ImportItem,
  Attribute,
  AttributeArg,
  Identifier,
  Path,
  ConstDef,
} from '../ast/types.js';

/**
 * Result type for visitor methods
 * - undefined: continue visiting children
 * - false: skip visiting children
 * - T: return value (also skips children)
 */
export type VisitResult<T> = T | undefined | false;

/**
 * AST Visitor interface
 * Each visit method can return:
 * - undefined: continue visiting children (default)
 * - false: skip visiting children
 * - T: a result value (also skips children)
 */
export interface AstVisitor<T = void> {
  // Top-level
  visitSourceFile?(node: SourceFile): VisitResult<T>;
  visitItem?(node: Item): VisitResult<T>;

  // Module
  visitModDef?(node: ModDef): VisitResult<T>;
  visitModItem?(node: ModItem): VisitResult<T>;
  visitPortDecl?(node: PortDecl): VisitResult<T>;

  // Generic Parameters
  visitGenericParams?(node: GenericParams): VisitResult<T>;
  visitGenericParam?(node: GenericParam): VisitResult<T>;
  visitWhereClause?(node: WhereClause): VisitResult<T>;
  visitConstraint?(node: Constraint): VisitResult<T>;

  // Type Definitions
  visitEnumDef?(node: EnumDef): VisitResult<T>;
  visitEnumVariant?(node: EnumVariant): VisitResult<T>;
  visitStructDef?(node: StructDef): VisitResult<T>;
  visitStructField?(node: StructField): VisitResult<T>;
  visitTypeAlias?(node: TypeAlias): VisitResult<T>;
  visitTypeDef?(node: EnumDef | StructDef | TypeAlias): VisitResult<T>;

  // Type Expressions
  visitTypeExpr?(node: TypeExpr): VisitResult<T>;
  visitPrimitiveType?(node: PrimitiveType): VisitResult<T>;
  visitArrayType?(node: ArrayType): VisitResult<T>;
  visitTupleType?(node: TupleType): VisitResult<T>;
  visitUserType?(node: UserType): VisitResult<T>;
  visitGenericType?(node: GenericType): VisitResult<T>;
  visitGenericArg?(node: GenericArg): VisitResult<T>;

  // Expressions
  visitExpr?(node: Expr): VisitResult<T>;
  visitLiteralExpr?(node: LiteralExpr): VisitResult<T>;
  visitIdentExpr?(node: IdentExpr): VisitResult<T>;
  visitPathExpr?(node: PathExpr): VisitResult<T>;
  visitUnaryExpr?(node: UnaryExpr): VisitResult<T>;
  visitBinaryExpr?(node: BinaryExpr): VisitResult<T>;
  visitCallExpr?(node: CallExpr): VisitResult<T>;
  visitIndexExpr?(node: IndexExpr): VisitResult<T>;
  visitFieldExpr?(node: FieldExpr): VisitResult<T>;
  visitCastExpr?(node: CastExpr): VisitResult<T>;
  visitIfExpr?(node: IfExpr): VisitResult<T>;
  visitMatchExpr?(node: MatchExpr): VisitResult<T>;
  visitMatchArm?(node: MatchArm): VisitResult<T>;
  visitConcatExpr?(node: ConcatExpr): VisitResult<T>;
  visitRepeatExpr?(node: RepeatExpr): VisitResult<T>;
  visitParenExpr?(node: ParenExpr): VisitResult<T>;

  // Patterns
  visitPattern?(node: Pattern): VisitResult<T>;
  visitLiteralPattern?(node: LiteralPattern): VisitResult<T>;
  visitIdentPattern?(node: IdentPattern): VisitResult<T>;
  visitWildcardPattern?(node: WildcardPattern): VisitResult<T>;
  visitPathPattern?(node: PathPattern): VisitResult<T>;
  visitRangePattern?(node: RangePattern): VisitResult<T>;
  visitTuplePattern?(node: TuplePattern): VisitResult<T>;
  visitStructPattern?(node: StructPattern): VisitResult<T>;
  visitFieldPattern?(node: FieldPattern): VisitResult<T>;

  // Statements
  visitStmt?(node: Stmt): VisitResult<T>;
  visitLetDecl?(node: LetDecl): VisitResult<T>;
  visitVarDecl?(node: VarDecl): VisitResult<T>;
  visitConstDecl?(node: ConstDecl): VisitResult<T>;
  visitAssignStmt?(node: AssignStmt): VisitResult<T>;
  visitIfStmt?(node: IfStmt): VisitResult<T>;
  visitMatchStmt?(node: MatchStmt): VisitResult<T>;
  visitForStmt?(node: ForStmt): VisitResult<T>;
  visitRangeExpr?(node: RangeExpr): VisitResult<T>;
  visitWhileStmt?(node: WhileStmt): VisitResult<T>;
  visitReturnStmt?(node: ReturnStmt): VisitResult<T>;
  visitBlockStmt?(node: BlockStmt): VisitResult<T>;
  visitExprStmt?(node: ExprStmt): VisitResult<T>;

  // Logic Blocks
  visitCombBlock?(node: CombBlock): VisitResult<T>;
  visitSyncBlock?(node: SyncBlock): VisitResult<T>;
  visitClockSpec?(node: ClockSpec): VisitResult<T>;
  visitResetSpec?(node: ResetSpec): VisitResult<T>;

  // FSM
  visitFsmBlock?(node: FsmBlock): VisitResult<T>;
  visitStateEnum?(node: StateEnum): VisitResult<T>;
  visitStateItem?(node: StateItem): VisitResult<T>;
  visitOutputAssign?(node: OutputAssign): VisitResult<T>;
  visitTransitionsBlock?(node: TransitionsBlock): VisitResult<T>;
  visitTransitionItem?(node: TransitionItem): VisitResult<T>;
  visitWhenClause?(node: WhenClause): VisitResult<T>;
  visitOutputBlock?(node: OutputBlock): VisitResult<T>;
  visitOutputCase?(node: OutputCase): VisitResult<T>;

  // Instance and Memory
  visitInstDecl?(node: InstDecl): VisitResult<T>;
  visitConnection?(node: Connection): VisitResult<T>;
  visitMemDecl?(node: MemDecl): VisitResult<T>;
  visitMemConfig?(node: MemConfig): VisitResult<T>;
  visitMemConfigItem?(node: MemConfigItem): VisitResult<T>;

  // Interface
  visitInterfaceDef?(node: InterfaceDef): VisitResult<T>;
  visitInterfaceSignal?(node: InterfaceSignal): VisitResult<T>;
  visitViewDef?(node: ViewDef): VisitResult<T>;
  visitViewSignal?(node: ViewSignal): VisitResult<T>;

  // Function
  visitFnDef?(node: FnDef): VisitResult<T>;
  visitFnParam?(node: FnParam): VisitResult<T>;
  visitConstDef?(node: ConstDef): VisitResult<T>;

  // Test
  visitTestDef?(node: TestDef): VisitResult<T>;
  visitTestAttribute?(node: TestAttribute): VisitResult<T>;
  visitTestParam?(node: TestParam): VisitResult<T>;
  visitTestStmt?(node: TestStmt): VisitResult<T>;
  visitAssertStmt?(node: TestAssertStmt): VisitResult<T>;
  visitWaitStmt?(node: WaitStmt): VisitResult<T>;
  visitDriveStmt?(node: DriveStmt): VisitResult<T>;
  visitSampleStmt?(node: SampleStmt): VisitResult<T>;

  // Package and Import
  visitPackageDecl?(node: PackageDecl): VisitResult<T>;
  visitImportDecl?(node: ImportDecl): VisitResult<T>;
  visitImportItem?(node: ImportItem): VisitResult<T>;

  // Attributes
  visitAttribute?(node: Attribute): VisitResult<T>;
  visitAttributeArg?(node: AttributeArg): VisitResult<T>;

  // Common
  visitIdentifier?(node: Identifier): VisitResult<T>;
  visitPath?(node: Path): VisitResult<T>;

  // Generic handler for any node
  visitNode?(node: AstNode): VisitResult<T>;

  // Called after visiting a node and its children
  leaveNode?(node: AstNode): void;
}

/**
 * Walk the AST and call visitor methods
 */
export function walkAst<T>(node: AstNode, visitor: AstVisitor<T>): T | undefined {
  // Call generic visitNode if present
  if (visitor.visitNode) {
    const result = visitor.visitNode(node);
    if (result !== undefined) {
      if (result === false) {
        if (visitor.leaveNode) visitor.leaveNode(node);
        return undefined;
      }
      if (visitor.leaveNode) visitor.leaveNode(node);
      return result as T;
    }
  }

  let result: T | undefined;

  switch (node.kind) {
    case 'SourceFile':
      result = visitSourceFile(node as SourceFile, visitor);
      break;
    case 'ModDef':
      result = visitModDef(node as ModDef, visitor);
      break;
    case 'PortDecl':
      result = visitPortDecl(node as PortDecl, visitor);
      break;
    case 'GenericParams':
      result = visitGenericParams(node as GenericParams, visitor);
      break;
    case 'GenericParam':
      result = visitGenericParam(node as GenericParam, visitor);
      break;
    case 'WhereClause':
      result = visitWhereClause(node as WhereClause, visitor);
      break;
    case 'Constraint':
      result = visitConstraint(node as Constraint, visitor);
      break;
    case 'EnumDef':
      result = visitEnumDef(node as EnumDef, visitor);
      break;
    case 'EnumVariant':
      result = visitEnumVariant(node as EnumVariant, visitor);
      break;
    case 'StructDef':
      result = visitStructDef(node as StructDef, visitor);
      break;
    case 'StructField':
      result = visitStructField(node as StructField, visitor);
      break;
    case 'TypeAlias':
      result = visitTypeAlias(node as TypeAlias, visitor);
      break;
    case 'PrimitiveType':
      result = visitPrimitiveType(node as PrimitiveType, visitor);
      break;
    case 'ArrayType':
      result = visitArrayType(node as ArrayType, visitor);
      break;
    case 'TupleType':
      result = visitTupleType(node as TupleType, visitor);
      break;
    case 'UserType':
      result = visitUserType(node as UserType, visitor);
      break;
    case 'GenericType':
      result = visitGenericType(node as GenericType, visitor);
      break;
    case 'GenericArg':
      result = visitGenericArg(node as GenericArg, visitor);
      break;
    case 'LiteralExpr':
      result = visitLiteralExpr(node as LiteralExpr, visitor);
      break;
    case 'IdentExpr':
      result = visitIdentExpr(node as IdentExpr, visitor);
      break;
    case 'PathExpr':
      result = visitPathExpr(node as PathExpr, visitor);
      break;
    case 'UnaryExpr':
      result = visitUnaryExpr(node as UnaryExpr, visitor);
      break;
    case 'BinaryExpr':
      result = visitBinaryExpr(node as BinaryExpr, visitor);
      break;
    case 'CallExpr':
      result = visitCallExpr(node as CallExpr, visitor);
      break;
    case 'IndexExpr':
      result = visitIndexExpr(node as IndexExpr, visitor);
      break;
    case 'FieldExpr':
      result = visitFieldExpr(node as FieldExpr, visitor);
      break;
    case 'CastExpr':
      result = visitCastExpr(node as CastExpr, visitor);
      break;
    case 'IfExpr':
      result = visitIfExpr(node as IfExpr, visitor);
      break;
    case 'MatchExpr':
      result = visitMatchExpr(node as MatchExpr, visitor);
      break;
    case 'MatchArm':
      result = visitMatchArm(node as MatchArm, visitor);
      break;
    case 'ConcatExpr':
      result = visitConcatExpr(node as ConcatExpr, visitor);
      break;
    case 'RepeatExpr':
      result = visitRepeatExpr(node as RepeatExpr, visitor);
      break;
    case 'ParenExpr':
      result = visitParenExpr(node as ParenExpr, visitor);
      break;
    case 'LiteralPattern':
      result = visitLiteralPattern(node as LiteralPattern, visitor);
      break;
    case 'IdentPattern':
      result = visitIdentPattern(node as IdentPattern, visitor);
      break;
    case 'WildcardPattern':
      result = visitWildcardPattern(node as WildcardPattern, visitor);
      break;
    case 'PathPattern':
      result = visitPathPattern(node as PathPattern, visitor);
      break;
    case 'RangePattern':
      result = visitRangePattern(node as RangePattern, visitor);
      break;
    case 'TuplePattern':
      result = visitTuplePattern(node as TuplePattern, visitor);
      break;
    case 'StructPattern':
      result = visitStructPattern(node as StructPattern, visitor);
      break;
    case 'FieldPattern':
      result = visitFieldPattern(node as FieldPattern, visitor);
      break;
    case 'LetDecl':
      result = visitLetDecl(node as LetDecl, visitor);
      break;
    case 'VarDecl':
      result = visitVarDecl(node as VarDecl, visitor);
      break;
    case 'ConstDecl':
      result = visitConstDecl(node as ConstDecl, visitor);
      break;
    case 'AssignStmt':
      result = visitAssignStmt(node as AssignStmt, visitor);
      break;
    case 'IfStmt':
      result = visitIfStmt(node as IfStmt, visitor);
      break;
    case 'MatchStmt':
      result = visitMatchStmt(node as MatchStmt, visitor);
      break;
    case 'ForStmt':
      result = visitForStmt(node as ForStmt, visitor);
      break;
    case 'RangeExpr':
      result = visitRangeExpr(node as RangeExpr, visitor);
      break;
    case 'WhileStmt':
      result = visitWhileStmt(node as WhileStmt, visitor);
      break;
    case 'ReturnStmt':
      result = visitReturnStmt(node as ReturnStmt, visitor);
      break;
    case 'BlockStmt':
      result = visitBlockStmt(node as BlockStmt, visitor);
      break;
    case 'ExprStmt':
      result = visitExprStmt(node as ExprStmt, visitor);
      break;
    case 'CombBlock':
      result = visitCombBlock(node as CombBlock, visitor);
      break;
    case 'SyncBlock':
      result = visitSyncBlock(node as SyncBlock, visitor);
      break;
    case 'ClockSpec':
      result = visitClockSpec(node as ClockSpec, visitor);
      break;
    case 'ResetSpec':
      result = visitResetSpec(node as ResetSpec, visitor);
      break;
    case 'FsmBlock':
      result = visitFsmBlock(node as FsmBlock, visitor);
      break;
    case 'StateEnum':
      result = visitStateEnum(node as StateEnum, visitor);
      break;
    case 'StateItem':
      result = visitStateItem(node as StateItem, visitor);
      break;
    case 'OutputAssign':
      result = visitOutputAssign(node as OutputAssign, visitor);
      break;
    case 'TransitionsBlock':
      result = visitTransitionsBlock(node as TransitionsBlock, visitor);
      break;
    case 'TransitionItem':
      result = visitTransitionItem(node as TransitionItem, visitor);
      break;
    case 'WhenClause':
      result = visitWhenClause(node as WhenClause, visitor);
      break;
    case 'OutputBlock':
      result = visitOutputBlock(node as OutputBlock, visitor);
      break;
    case 'OutputCase':
      result = visitOutputCase(node as OutputCase, visitor);
      break;
    case 'InstDecl':
      result = visitInstDecl(node as InstDecl, visitor);
      break;
    case 'Connection':
      result = visitConnection(node as Connection, visitor);
      break;
    case 'MemDecl':
      result = visitMemDecl(node as MemDecl, visitor);
      break;
    case 'MemConfig':
      result = visitMemConfig(node as MemConfig, visitor);
      break;
    case 'MemConfigItem':
      result = visitMemConfigItem(node as MemConfigItem, visitor);
      break;
    case 'InterfaceDef':
      result = visitInterfaceDef(node as InterfaceDef, visitor);
      break;
    case 'InterfaceSignal':
      result = visitInterfaceSignal(node as InterfaceSignal, visitor);
      break;
    case 'ViewDef':
      result = visitViewDef(node as ViewDef, visitor);
      break;
    case 'ViewSignal':
      result = visitViewSignal(node as ViewSignal, visitor);
      break;
    case 'FnDef':
      result = visitFnDef(node as FnDef, visitor);
      break;
    case 'FnParam':
      result = visitFnParam(node as FnParam, visitor);
      break;
    case 'ConstDef':
      result = visitConstDef(node as ConstDef, visitor);
      break;
    case 'TestDef':
      result = visitTestDef(node as TestDef, visitor);
      break;
    case 'TestAttribute':
      result = visitTestAttribute(node as TestAttribute, visitor);
      break;
    case 'TestParam':
      result = visitTestParam(node as TestParam, visitor);
      break;
    case 'AssertStmt':
      result = visitAssertStmt(node as TestAssertStmt, visitor);
      break;
    case 'WaitStmt':
      result = visitWaitStmt(node as WaitStmt, visitor);
      break;
    case 'DriveStmt':
      result = visitDriveStmt(node as DriveStmt, visitor);
      break;
    case 'SampleStmt':
      result = visitSampleStmt(node as SampleStmt, visitor);
      break;
    case 'PackageDecl':
      result = visitPackageDecl(node as PackageDecl, visitor);
      break;
    case 'ImportDecl':
      result = visitImportDecl(node as ImportDecl, visitor);
      break;
    case 'ImportItem':
      result = visitImportItem(node as ImportItem, visitor);
      break;
    case 'Attribute':
      result = visitAttribute(node as Attribute, visitor);
      break;
    case 'AttributeArg':
      result = visitAttributeArg(node as AttributeArg, visitor);
      break;
    case 'Identifier':
      result = visitIdentifier(node as Identifier, visitor);
      break;
    case 'Path':
      result = visitPath(node as Path, visitor);
      break;
  }

  if (visitor.leaveNode) visitor.leaveNode(node);
  return result;
}

/**
 * Create a simple visitor that collects results
 */
export function collectFromAst<T>(
  node: AstNode,
  visitor: AstVisitor<T | undefined>
): T[] {
  const results: T[] = [];

  const wrappedVisitor: AstVisitor = {};

  for (const [key, fn] of Object.entries(visitor)) {
    if (typeof fn === 'function') {
      (wrappedVisitor as Record<string, (n: AstNode) => void>)[key] = (n: AstNode): void => {
        const result = (fn as (n: AstNode) => T | undefined)(n);
        if (result !== undefined) {
          results.push(result);
        }
      };
    }
  }

  walkAst(node, wrappedVisitor);
  return results;
}

// Individual visit functions
function visitSourceFile<T>(node: SourceFile, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitSourceFile) {
    const result = visitor.visitSourceFile(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const item of node.items) {
    walkAst(item, visitor);
  }
  return undefined;
}

function visitModDef<T>(node: ModDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitModDef) {
    const result = visitor.visitModDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const attr of node.attributes) {
    walkAst(attr, visitor);
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  if (node.whereClause) walkAst(node.whereClause, visitor);
  for (const port of node.ports) {
    walkAst(port, visitor);
  }
  for (const item of node.items) {
    walkAst(item, visitor);
  }
  return undefined;
}

function visitPortDecl<T>(node: PortDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPortDecl) {
    const result = visitor.visitPortDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  return undefined;
}

function visitGenericParams<T>(node: GenericParams, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitGenericParams) {
    const result = visitor.visitGenericParams(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const param of node.params) {
    walkAst(param, visitor);
  }
  return undefined;
}

function visitGenericParam<T>(node: GenericParam, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitGenericParam) {
    const result = visitor.visitGenericParam(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.defaultValue) walkAst(node.defaultValue, visitor);
  return undefined;
}

function visitWhereClause<T>(node: WhereClause, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitWhereClause) {
    const result = visitor.visitWhereClause(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const constraint of node.constraints) {
    walkAst(constraint, visitor);
  }
  return undefined;
}

function visitConstraint<T>(node: Constraint, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitConstraint) {
    const result = visitor.visitConstraint(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.value, visitor);
  return undefined;
}

function visitEnumDef<T>(node: EnumDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitEnumDef) {
    const result = visitor.visitEnumDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeDef) {
    const result = visitor.visitTypeDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  for (const variant of node.variants) {
    walkAst(variant, visitor);
  }
  return undefined;
}

function visitEnumVariant<T>(node: EnumVariant, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitEnumVariant) {
    const result = visitor.visitEnumVariant(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.value) walkAst(node.value, visitor);
  return undefined;
}

function visitStructDef<T>(node: StructDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitStructDef) {
    const result = visitor.visitStructDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeDef) {
    const result = visitor.visitTypeDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  for (const field of node.fields) {
    walkAst(field, visitor);
  }
  return undefined;
}

function visitStructField<T>(node: StructField, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitStructField) {
    const result = visitor.visitStructField(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  return undefined;
}

function visitTypeAlias<T>(node: TypeAlias, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTypeAlias) {
    const result = visitor.visitTypeAlias(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeDef) {
    const result = visitor.visitTypeDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  walkAst(node.typeExpr, visitor);
  return undefined;
}

function visitPrimitiveType<T>(node: PrimitiveType, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPrimitiveType) {
    const result = visitor.visitPrimitiveType(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeExpr) {
    const result = visitor.visitTypeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.width) walkAst(node.width, visitor);
  return undefined;
}

function visitArrayType<T>(node: ArrayType, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitArrayType) {
    const result = visitor.visitArrayType(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeExpr) {
    const result = visitor.visitTypeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.elementType, visitor);
  walkAst(node.size, visitor);
  return undefined;
}

function visitTupleType<T>(node: TupleType, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTupleType) {
    const result = visitor.visitTupleType(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeExpr) {
    const result = visitor.visitTypeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const elem of node.elements) {
    walkAst(elem, visitor);
  }
  return undefined;
}

function visitUserType<T>(node: UserType, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitUserType) {
    const result = visitor.visitUserType(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeExpr) {
    const result = visitor.visitTypeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  return undefined;
}

function visitGenericType<T>(node: GenericType, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitGenericType) {
    const result = visitor.visitGenericType(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTypeExpr) {
    const result = visitor.visitTypeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  for (const arg of node.args) {
    walkAst(arg, visitor);
  }
  return undefined;
}

function visitGenericArg<T>(node: GenericArg, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitGenericArg) {
    const result = visitor.visitGenericArg(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.name) walkAst(node.name, visitor);
  walkAst(node.value as AstNode, visitor);
  return undefined;
}

function visitLiteralExpr<T>(node: LiteralExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitLiteralExpr) {
    const result = visitor.visitLiteralExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  return undefined;
}

function visitIdentExpr<T>(node: IdentExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIdentExpr) {
    const result = visitor.visitIdentExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  return undefined;
}

function visitPathExpr<T>(node: PathExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPathExpr) {
    const result = visitor.visitPathExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  return undefined;
}

function visitUnaryExpr<T>(node: UnaryExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitUnaryExpr) {
    const result = visitor.visitUnaryExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.operand, visitor);
  return undefined;
}

function visitBinaryExpr<T>(node: BinaryExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitBinaryExpr) {
    const result = visitor.visitBinaryExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.left, visitor);
  walkAst(node.right, visitor);
  return undefined;
}

function visitCallExpr<T>(node: CallExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitCallExpr) {
    const result = visitor.visitCallExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.callee, visitor);
  for (const arg of node.args) {
    walkAst(arg, visitor);
  }
  return undefined;
}

function visitIndexExpr<T>(node: IndexExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIndexExpr) {
    const result = visitor.visitIndexExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.base, visitor);
  walkAst(node.index, visitor);
  if (node.rangeEnd) walkAst(node.rangeEnd, visitor);
  return undefined;
}

function visitFieldExpr<T>(node: FieldExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitFieldExpr) {
    const result = visitor.visitFieldExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.base, visitor);
  walkAst(node.field, visitor);
  return undefined;
}

function visitCastExpr<T>(node: CastExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitCastExpr) {
    const result = visitor.visitCastExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.expr, visitor);
  walkAst(node.targetType, visitor);
  return undefined;
}

function visitIfExpr<T>(node: IfExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIfExpr) {
    const result = visitor.visitIfExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.condition, visitor);
  walkAst(node.thenExpr, visitor);
  walkAst(node.elseExpr, visitor);
  return undefined;
}

function visitMatchExpr<T>(node: MatchExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMatchExpr) {
    const result = visitor.visitMatchExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.scrutinee, visitor);
  for (const arm of node.arms) {
    walkAst(arm, visitor);
  }
  return undefined;
}

function visitMatchArm<T>(node: MatchArm, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMatchArm) {
    const result = visitor.visitMatchArm(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.pattern, visitor);
  walkAst(node.body as AstNode, visitor);
  return undefined;
}

function visitConcatExpr<T>(node: ConcatExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitConcatExpr) {
    const result = visitor.visitConcatExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const elem of node.elements) {
    walkAst(elem, visitor);
  }
  return undefined;
}

function visitRepeatExpr<T>(node: RepeatExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitRepeatExpr) {
    const result = visitor.visitRepeatExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.expr, visitor);
  walkAst(node.count, visitor);
  return undefined;
}

function visitParenExpr<T>(node: ParenExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitParenExpr) {
    const result = visitor.visitParenExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitExpr) {
    const result = visitor.visitExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.inner, visitor);
  return undefined;
}

function visitLiteralPattern<T>(node: LiteralPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitLiteralPattern) {
    const result = visitor.visitLiteralPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  return undefined;
}

function visitIdentPattern<T>(node: IdentPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIdentPattern) {
    const result = visitor.visitIdentPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  return undefined;
}

function visitWildcardPattern<T>(node: WildcardPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitWildcardPattern) {
    const result = visitor.visitWildcardPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  return undefined;
}

function visitPathPattern<T>(node: PathPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPathPattern) {
    const result = visitor.visitPathPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  return undefined;
}

function visitRangePattern<T>(node: RangePattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitRangePattern) {
    const result = visitor.visitRangePattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.start, visitor);
  walkAst(node.end, visitor);
  return undefined;
}

function visitTuplePattern<T>(node: TuplePattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTuplePattern) {
    const result = visitor.visitTuplePattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const elem of node.elements) {
    walkAst(elem, visitor);
  }
  return undefined;
}

function visitStructPattern<T>(node: StructPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitStructPattern) {
    const result = visitor.visitStructPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitPattern) {
    const result = visitor.visitPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  for (const field of node.fields) {
    walkAst(field, visitor);
  }
  return undefined;
}

function visitFieldPattern<T>(node: FieldPattern, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitFieldPattern) {
    const result = visitor.visitFieldPattern(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.pattern) walkAst(node.pattern, visitor);
  return undefined;
}

function visitLetDecl<T>(node: LetDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitLetDecl) {
    const result = visitor.visitLetDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.typeExpr) walkAst(node.typeExpr, visitor);
  if (node.init) walkAst(node.init, visitor);
  return undefined;
}

function visitVarDecl<T>(node: VarDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitVarDecl) {
    const result = visitor.visitVarDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.typeExpr) walkAst(node.typeExpr, visitor);
  if (node.init) walkAst(node.init, visitor);
  return undefined;
}

function visitConstDecl<T>(node: ConstDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitConstDecl) {
    const result = visitor.visitConstDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  walkAst(node.init, visitor);
  return undefined;
}

function visitAssignStmt<T>(node: AssignStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitAssignStmt) {
    const result = visitor.visitAssignStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.value, visitor);
  return undefined;
}

function visitIfStmt<T>(node: IfStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIfStmt) {
    const result = visitor.visitIfStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.condition, visitor);
  for (const stmt of node.thenBlock) {
    walkAst(stmt, visitor);
  }
  if (node.elseBlock) {
    if (Array.isArray(node.elseBlock)) {
      for (const stmt of node.elseBlock) {
        walkAst(stmt, visitor);
      }
    } else {
      walkAst(node.elseBlock, visitor);
    }
  }
  return undefined;
}

function visitMatchStmt<T>(node: MatchStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMatchStmt) {
    const result = visitor.visitMatchStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.scrutinee, visitor);
  for (const arm of node.arms) {
    walkAst(arm, visitor);
  }
  return undefined;
}

function visitForStmt<T>(node: ForStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitForStmt) {
    const result = visitor.visitForStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.variable, visitor);
  walkAst(node.range, visitor);
  for (const stmt of node.body) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitRangeExpr<T>(node: RangeExpr, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitRangeExpr) {
    const result = visitor.visitRangeExpr(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.start, visitor);
  walkAst(node.end, visitor);
  return undefined;
}

function visitWhileStmt<T>(node: WhileStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitWhileStmt) {
    const result = visitor.visitWhileStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.condition, visitor);
  for (const stmt of node.body) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitReturnStmt<T>(node: ReturnStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitReturnStmt) {
    const result = visitor.visitReturnStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.value) walkAst(node.value, visitor);
  return undefined;
}

function visitBlockStmt<T>(node: BlockStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitBlockStmt) {
    const result = visitor.visitBlockStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const stmt of node.stmts) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitExprStmt<T>(node: ExprStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitExprStmt) {
    const result = visitor.visitExprStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitStmt) {
    const result = visitor.visitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.expr, visitor);
  return undefined;
}

function visitCombBlock<T>(node: CombBlock, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitCombBlock) {
    const result = visitor.visitCombBlock(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitModItem) {
    const result = visitor.visitModItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const stmt of node.stmts) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitSyncBlock<T>(node: SyncBlock, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitSyncBlock) {
    const result = visitor.visitSyncBlock(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitModItem) {
    const result = visitor.visitModItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.clock, visitor);
  if (node.reset) walkAst(node.reset, visitor);
  for (const stmt of node.stmts) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitClockSpec<T>(node: ClockSpec, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitClockSpec) {
    const result = visitor.visitClockSpec(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.signal, visitor);
  return undefined;
}

function visitResetSpec<T>(node: ResetSpec, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitResetSpec) {
    const result = visitor.visitResetSpec(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.signal, visitor);
  return undefined;
}

function visitFsmBlock<T>(node: FsmBlock, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitFsmBlock) {
    const result = visitor.visitFsmBlock(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitModItem) {
    const result = visitor.visitModItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.clock, visitor);
  if (node.reset) walkAst(node.reset, visitor);
  walkAst(node.stateEnum, visitor);
  walkAst(node.transitions, visitor);
  for (const output of node.outputs) {
    walkAst(output, visitor);
  }
  return undefined;
}

function visitStateEnum<T>(node: StateEnum, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitStateEnum) {
    const result = visitor.visitStateEnum(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const state of node.states) {
    walkAst(state, visitor);
  }
  return undefined;
}

function visitStateItem<T>(node: StateItem, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitStateItem) {
    const result = visitor.visitStateItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.mooreOutputs) {
    for (const output of node.mooreOutputs) {
      walkAst(output, visitor);
    }
  }
  return undefined;
}

function visitOutputAssign<T>(node: OutputAssign, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitOutputAssign) {
    const result = visitor.visitOutputAssign(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.value, visitor);
  return undefined;
}

function visitTransitionsBlock<T>(node: TransitionsBlock, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTransitionsBlock) {
    const result = visitor.visitTransitionsBlock(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const item of node.items) {
    walkAst(item, visitor);
  }
  return undefined;
}

function visitTransitionItem<T>(node: TransitionItem, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTransitionItem) {
    const result = visitor.visitTransitionItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.fromState !== '_') {
    walkAst(node.fromState, visitor);
  }
  for (const clause of node.whenClauses) {
    walkAst(clause, visitor);
  }
  return undefined;
}

function visitWhenClause<T>(node: WhenClause, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitWhenClause) {
    const result = visitor.visitWhenClause(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.condition, visitor);
  for (const action of node.actions) {
    if (action.kind === 'Goto') {
      walkAst(action.target, visitor);
    } else {
      walkAst(action.stmt, visitor);
    }
  }
  return undefined;
}

function visitOutputBlock<T>(node: OutputBlock, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitOutputBlock) {
    const result = visitor.visitOutputBlock(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  for (const c of node.cases) {
    walkAst(c, visitor);
  }
  return undefined;
}

function visitOutputCase<T>(node: OutputCase, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitOutputCase) {
    const result = visitor.visitOutputCase(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.state, visitor);
  walkAst(node.value, visitor);
  return undefined;
}

function visitInstDecl<T>(node: InstDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitInstDecl) {
    const result = visitor.visitInstDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitModItem) {
    const result = visitor.visitModItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.modulePath, visitor);
  if (node.genericArgs) {
    for (const arg of node.genericArgs) {
      walkAst(arg, visitor);
    }
  }
  for (const conn of node.connections) {
    walkAst(conn, visitor);
  }
  return undefined;
}

function visitConnection<T>(node: Connection, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitConnection) {
    const result = visitor.visitConnection(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.port, visitor);
  walkAst(node.expr, visitor);
  return undefined;
}

function visitMemDecl<T>(node: MemDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMemDecl) {
    const result = visitor.visitMemDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitModItem) {
    const result = visitor.visitModItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.elementType, visitor);
  walkAst(node.depth, visitor);
  if (node.config) walkAst(node.config, visitor);
  if (node.init) walkAst(node.init, visitor);
  return undefined;
}

function visitMemConfig<T>(node: MemConfig, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMemConfig) {
    const result = visitor.visitMemConfig(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const item of node.items) {
    walkAst(item, visitor);
  }
  return undefined;
}

function visitMemConfigItem<T>(node: MemConfigItem, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitMemConfigItem) {
    const result = visitor.visitMemConfigItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  return undefined;
}

function visitInterfaceDef<T>(node: InterfaceDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitInterfaceDef) {
    const result = visitor.visitInterfaceDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  for (const signal of node.signals) {
    walkAst(signal, visitor);
  }
  for (const view of node.views) {
    walkAst(view, visitor);
  }
  return undefined;
}

function visitInterfaceSignal<T>(node: InterfaceSignal, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitInterfaceSignal) {
    const result = visitor.visitInterfaceSignal(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  return undefined;
}

function visitViewDef<T>(node: ViewDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitViewDef) {
    const result = visitor.visitViewDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  for (const signal of node.signals) {
    walkAst(signal, visitor);
  }
  return undefined;
}

function visitViewSignal<T>(node: ViewSignal, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitViewSignal) {
    const result = visitor.visitViewSignal(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  return undefined;
}

function visitFnDef<T>(node: FnDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitFnDef) {
    const result = visitor.visitFnDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.genericParams) walkAst(node.genericParams, visitor);
  for (const param of node.params) {
    walkAst(param, visitor);
  }
  if (node.returnType) walkAst(node.returnType, visitor);
  for (const stmt of node.body) {
    walkAst(stmt, visitor);
  }
  return undefined;
}

function visitFnParam<T>(node: FnParam, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitFnParam) {
    const result = visitor.visitFnParam(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  return undefined;
}

function visitConstDef<T>(node: ConstDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitConstDef) {
    const result = visitor.visitConstDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.typeExpr, visitor);
  walkAst(node.init, visitor);
  return undefined;
}

function visitTestDef<T>(node: TestDef, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTestDef) {
    const result = visitor.visitTestDef(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const attr of node.attributes) {
    walkAst(attr, visitor);
  }
  walkAst(node.name, visitor);
  for (const stmt of node.body) {
    walkAst(stmt as AstNode, visitor);
  }
  return undefined;
}

function visitTestAttribute<T>(node: TestAttribute, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTestAttribute) {
    const result = visitor.visitTestAttribute(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.params) {
    for (const param of node.params) {
      walkAst(param, visitor);
    }
  }
  return undefined;
}

function visitTestParam<T>(node: TestParam, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitTestParam) {
    const result = visitor.visitTestParam(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.value, visitor);
  return undefined;
}

function visitAssertStmt<T>(node: TestAssertStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitAssertStmt) {
    const result = visitor.visitAssertStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTestStmt) {
    const result = visitor.visitTestStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.condition, visitor);
  return undefined;
}

function visitWaitStmt<T>(node: WaitStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitWaitStmt) {
    const result = visitor.visitWaitStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTestStmt) {
    const result = visitor.visitTestStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  const cond = node.condition;
  if (cond.kind === 'ExprWait') {
    walkAst(cond.expr, visitor);
  } else if (cond.kind === 'ClockWait') {
    walkAst(cond.clock, visitor);
  }
  return undefined;
}

function visitDriveStmt<T>(node: DriveStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitDriveStmt) {
    const result = visitor.visitDriveStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTestStmt) {
    const result = visitor.visitTestStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.target, visitor);
  walkAst(node.value, visitor);
  return undefined;
}

function visitSampleStmt<T>(node: SampleStmt, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitSampleStmt) {
    const result = visitor.visitSampleStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitTestStmt) {
    const result = visitor.visitTestStmt(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  walkAst(node.expr, visitor);
  return undefined;
}

function visitPackageDecl<T>(node: PackageDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPackageDecl) {
    const result = visitor.visitPackageDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  for (const item of node.items) {
    walkAst(item, visitor);
  }
  return undefined;
}

function visitImportDecl<T>(node: ImportDecl, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitImportDecl) {
    const result = visitor.visitImportDecl(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (visitor.visitItem) {
    const result = visitor.visitItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.alias) walkAst(node.alias, visitor);
  return undefined;
}

function visitImportItem<T>(node: ImportItem, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitImportItem) {
    const result = visitor.visitImportItem(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.name, visitor);
  if (node.alias) walkAst(node.alias, visitor);
  return undefined;
}

function visitAttribute<T>(node: Attribute, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitAttribute) {
    const result = visitor.visitAttribute(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  walkAst(node.path, visitor);
  if (node.args) {
    for (const arg of node.args) {
      walkAst(arg, visitor);
    }
  }
  return undefined;
}

function visitAttributeArg<T>(node: AttributeArg, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitAttributeArg) {
    const result = visitor.visitAttributeArg(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  if (node.name) walkAst(node.name, visitor);
  return undefined;
}

function visitIdentifier<T>(node: Identifier, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitIdentifier) {
    const result = visitor.visitIdentifier(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  return undefined;
}

function visitPath<T>(node: Path, visitor: AstVisitor<T>): T | undefined {
  if (visitor.visitPath) {
    const result = visitor.visitPath(node);
    if (result !== undefined && result !== false) return result as T;
    if (result === false) return undefined;
  }
  for (const segment of node.segments) {
    walkAst(segment, visitor);
  }
  return undefined;
}
