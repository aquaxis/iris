import type {
  SourceFile,
  Item,
  ModDef,
  FnDef,
  EnumDef,
  StructDef,
  TypeAlias,
  InterfaceDef,
  PackageDecl,
  ImportDecl,
  TestDef,
  ModItem,
  PortDecl,
  GenericParams,
  GenericParam,
  WhereClause,
  Constraint,
  EnumVariant,
  StructField,
  TypeExpr,
  Expr,
  Stmt,
  Pattern,
  CombBlock,
  SyncBlock,
  FsmBlock,
  InstDecl,
  MemDecl,
  LetDecl,
  VarDecl,
  ConstDecl,
  AssignStmt,
  IfStmt,
  MatchStmt,
  ForStmt,
  WhileStmt,
  ReturnStmt,
  BlockStmt,
  ExprStmt,
  MatchArm,
  LValue,
  InterfaceSignal,
  ViewDef,
  ViewSignal,
  FnParam,
  StateEnum,
  StateItem,
  TransitionsBlock,
  TransitionItem,
  WhenClause,
  TransitionAction,
  OutputBlock,
  OutputCase,
  OutputAssign,
  Connection,
  MemConfig,
  Attribute,
  AttributeArg,
  Identifier,
  Path,
  TestAttribute,
  TestStmt,
  AssertStmt,
  WaitStmt,
  DriveStmt,
  SampleStmt,
  ConstDef,
  Literal,
  Token,
  Trivia,
  AstNode,
} from '@irisfmt/core';
import type { FormatStyle } from './format.js';

/**
 * Extracted comment with position information
 */
interface ExtractedComment {
  text: string;
  kind: 'line_comment' | 'block_comment';
  line: number;
  column: number;
  offset: number;
}

/**
 * Pretty printer for IRIS AST with comment preservation
 */
export class Printer {
  private readonly style: FormatStyle;
  private readonly tokens: Token[];
  private readonly comments: ExtractedComment[];
  private output: string[] = [];
  private indentLevel: number = 0;
  private atLineStart: boolean = true;
  private currentOutputLine: number = 1;
  private lastPrintedCommentIndex: number = -1;

  constructor(style: FormatStyle, tokens: Token[] = []) {
    this.style = style;
    this.tokens = tokens;
    this.comments = this.extractComments(tokens);
  }

  /**
   * Extract all comments from tokens
   */
  private extractComments(tokens: Token[]): ExtractedComment[] {
    const comments: ExtractedComment[] = [];

    for (const token of tokens) {
      // Extract comments from leading trivia
      for (const trivia of token.leadingTrivia) {
        if (trivia.kind === 'line_comment' || trivia.kind === 'block_comment') {
          comments.push({
            text: trivia.text,
            kind: trivia.kind,
            line: trivia.span.start.line,
            column: trivia.span.start.column,
            offset: trivia.span.start.offset,
          });
        }
      }

      // Extract comments from trailing trivia
      for (const trivia of token.trailingTrivia) {
        if (trivia.kind === 'line_comment' || trivia.kind === 'block_comment') {
          comments.push({
            text: trivia.text,
            kind: trivia.kind,
            line: trivia.span.start.line,
            column: trivia.span.start.column,
            offset: trivia.span.start.offset,
          });
        }
      }
    }

    // Sort by offset to maintain order
    return comments.sort((a, b) => a.offset - b.offset);
  }

  /**
   * Print AST to formatted source code
   */
  print(ast: SourceFile): string {
    this.output = [];
    this.indentLevel = 0;
    this.atLineStart = true;
    this.currentOutputLine = 1;
    this.lastPrintedCommentIndex = -1;

    this.printSourceFile(ast);

    return this.output.join('');
  }

  /**
   * Print any comments that appear before the given AST node
   */
  private printLeadingComments(node: AstNode): void {
    if (this.comments.length === 0) return;

    const nodeOffset = node.span.start.offset;

    for (let i = this.lastPrintedCommentIndex + 1; i < this.comments.length; i++) {
      const comment = this.comments[i]!;
      if (comment.offset >= nodeOffset) break;

      this.printComment(comment);
      this.lastPrintedCommentIndex = i;
    }
  }

  /**
   * Print any trailing comments on the same line as the current position
   */
  private printTrailingComment(node: AstNode): void {
    if (this.comments.length === 0) return;

    const nodeEndLine = node.span.end.line;

    for (let i = this.lastPrintedCommentIndex + 1; i < this.comments.length; i++) {
      const comment = this.comments[i]!;
      // Only print inline comments (same line as the end of the node)
      if (comment.line === nodeEndLine && comment.kind === 'line_comment') {
        this.write(' ');
        this.write(comment.text);
        this.lastPrintedCommentIndex = i;
        break;
      }
      if (comment.offset > node.span.end.offset + 100) break; // Don't look too far ahead
    }
  }

  /**
   * Print a single comment
   */
  private printComment(comment: ExtractedComment): void {
    if (comment.kind === 'line_comment') {
      this.write(comment.text);
      this.newline();
    } else {
      this.write(comment.text);
      if (comment.text.includes('\n')) {
        this.newline();
      } else {
        this.newline();
      }
    }
  }

  // ========================================
  // Source File
  // ========================================

  private printSourceFile(node: SourceFile): void {
    // Track the end offset of the previous item for comment positioning
    let prevItemEndOffset = -1;

    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]!;

      // Print any comments that appear between the previous item and this item
      const hadComments = this.printCommentsBetween(prevItemEndOffset, item.span.start.offset);

      if (i > 0) {
        // If there were comments, we already have newlines from them
        if (!hadComments) {
          this.newline();
        }
        this.newline();
      }

      this.printItem(item);
      prevItemEndOffset = item.span.end.offset;
    }
    // Print any remaining comments at the end of the file
    this.printRemainingComments();
    if (node.items.length > 0) {
      this.newline();
    }
  }

  /**
   * Print comments between two offsets
   * Returns true if any comments were printed
   */
  private printCommentsBetween(startOffset: number, endOffset: number): boolean {
    let printedAny = false;
    for (let i = this.lastPrintedCommentIndex + 1; i < this.comments.length; i++) {
      const comment = this.comments[i]!;
      if (comment.offset >= endOffset) break;
      if (comment.offset > startOffset) {
        // Always start comments on a new line
        if (!this.atLineStart) {
          this.newline();
        }
        this.printComment(comment);
        this.lastPrintedCommentIndex = i;
        printedAny = true;
      }
    }
    return printedAny;
  }

  /**
   * Print any remaining comments that haven't been printed yet
   */
  private printRemainingComments(): void {
    for (let i = this.lastPrintedCommentIndex + 1; i < this.comments.length; i++) {
      const comment = this.comments[i]!;
      this.newline();
      this.printComment(comment);
      this.lastPrintedCommentIndex = i;
    }
  }

  // ========================================
  // Items
  // ========================================

  private printItem(item: Item): void {
    switch (item.kind) {
      case 'ModDef':
        this.printModDef(item);
        break;
      case 'FnDef':
        this.printFnDef(item);
        break;
      case 'EnumDef':
        this.printEnumDef(item);
        break;
      case 'StructDef':
        this.printStructDef(item);
        break;
      case 'TypeAlias':
        this.printTypeAlias(item);
        break;
      case 'InterfaceDef':
        this.printInterfaceDef(item);
        break;
      case 'PackageDecl':
        this.printPackageDecl(item);
        break;
      case 'ImportDecl':
        this.printImportDecl(item);
        break;
      case 'TestDef':
        this.printTestDef(item);
        break;
      case 'ConstDef':
        this.printConstDef(item);
        break;
    }
  }

  // ========================================
  // Module Definition
  // ========================================

  private printModDef(node: ModDef): void {
    this.printAttributes(node.attributes);
    this.printVisibility(node.visibility);
    this.write('mod ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    if (node.whereClause) {
      this.printWhereClause(node.whereClause);
    }
    this.write('(');
    if (node.ports.length > 0) {
      this.newline();
      this.indent();
      for (let i = 0; i < node.ports.length; i++) {
        this.printPortDecl(node.ports[i]!);
        if (i < node.ports.length - 1) {
          this.write(',');
        } else if (this.style.trailingComma !== 'none') {
          this.write(',');
        }
        this.newline();
      }
      this.dedent();
    }
    this.write(') {');
    this.newline();
    if (node.items.length > 0) {
      this.indent();
      for (let i = 0; i < node.items.length; i++) {
        if (i > 0) {
          this.newline();
        }
        this.printModItem(node.items[i]!);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printPortDecl(node: PortDecl): void {
    this.write(node.direction);
    this.write(' ');
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
  }

  private printModItem(item: ModItem): void {
    switch (item.kind) {
      case 'LetDecl':
        this.printLetDecl(item);
        this.write(';');
        break;
      case 'VarDecl':
        this.printVarDecl(item);
        this.write(';');
        break;
      case 'ConstDecl':
        this.printConstDecl(item);
        break;
      case 'TypeAlias':
        this.printTypeAlias(item);
        break;
      case 'CombBlock':
        this.printCombBlock(item);
        break;
      case 'SyncBlock':
        this.printSyncBlock(item);
        break;
      case 'FsmBlock':
        this.printFsmBlock(item);
        break;
      case 'InstDecl':
        this.printInstDecl(item);
        break;
      case 'MemDecl':
        this.printMemDecl(item);
        break;
    }
  }

  // ========================================
  // Generic Parameters
  // ========================================

  private printGenericParams(node: GenericParams): void {
    this.write('[');
    for (let i = 0; i < node.params.length; i++) {
      if (i > 0) {
        this.write(', ');
      }
      this.printGenericParam(node.params[i]!);
    }
    this.write(']');
  }

  private printGenericParam(node: GenericParam): void {
    this.printIdentifier(node.name);
    this.write(': ');
    this.printGenericBound(node.bound);
    if (node.defaultValue) {
      this.write(' = ');
      this.printExpr(node.defaultValue);
    }
  }

  private printGenericBound(bound: GenericParam['bound']): void {
    switch (bound.kind) {
      case 'TypeBound':
        this.write('type');
        break;
      case 'UintBound':
        this.write('uint');
        break;
      case 'IntBound':
        this.write('int');
        break;
      case 'BoolBound':
        this.write('bool');
        break;
      case 'TypeExprBound':
        this.printTypeExpr(bound.typeExpr);
        break;
    }
  }

  private printWhereClause(node: WhereClause): void {
    this.write(' where ');
    for (let i = 0; i < node.constraints.length; i++) {
      if (i > 0) {
        this.write(', ');
      }
      this.printConstraint(node.constraints[i]!);
    }
  }

  private printConstraint(node: Constraint): void {
    this.printIdentifier(node.name);
    this.write(' ');
    this.write(node.constraintKind);
    this.write(' ');
    this.printExpr(node.value);
  }

  // ========================================
  // Function Definition
  // ========================================

  private printFnDef(node: FnDef): void {
    this.printVisibility(node.visibility);
    this.write('fn ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    this.write('(');
    for (let i = 0; i < node.params.length; i++) {
      if (i > 0) {
        this.write(', ');
      }
      this.printFnParam(node.params[i]!);
    }
    this.write(')');
    if (node.returnType) {
      this.write(' -> ');
      this.printTypeExpr(node.returnType);
    }
    this.write(' {');
    if (node.body.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.body) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printFnParam(node: FnParam): void {
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
  }

  // ========================================
  // Type Definitions
  // ========================================

  private printEnumDef(node: EnumDef): void {
    this.printVisibility(node.visibility);
    this.write('enum ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    this.write(' {');
    if (node.variants.length > 0) {
      this.newline();
      this.indent();
      for (let i = 0; i < node.variants.length; i++) {
        this.printEnumVariant(node.variants[i]!);
        this.write(',');
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printEnumVariant(node: EnumVariant): void {
    this.printIdentifier(node.name);
    if (node.value) {
      this.write(' = ');
      this.printExpr(node.value);
    }
  }

  private printStructDef(node: StructDef): void {
    this.printVisibility(node.visibility);
    this.write('struct ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    this.write(' {');
    if (node.fields.length > 0) {
      this.newline();
      this.indent();
      for (let i = 0; i < node.fields.length; i++) {
        this.printStructField(node.fields[i]!);
        this.write(',');
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printStructField(node: StructField): void {
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
  }

  private printTypeAlias(node: TypeAlias): void {
    this.printVisibility(node.visibility);
    this.write('type ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    this.write(' = ');
    this.printTypeExpr(node.typeExpr);
    this.write(';');
  }

  // ========================================
  // Interface Definition
  // ========================================

  private printInterfaceDef(node: InterfaceDef): void {
    this.printVisibility(node.visibility);
    this.write('interface ');
    this.printIdentifier(node.name);
    if (node.genericParams) {
      this.printGenericParams(node.genericParams);
    }
    this.write(' {');
    this.newline();
    this.indent();
    for (const signal of node.signals) {
      this.printInterfaceSignal(signal);
      this.newline();
    }
    for (const view of node.views) {
      this.newline();
      this.printViewDef(view);
      this.newline();
    }
    this.dedent();
    this.write('}');
  }

  private printInterfaceSignal(node: InterfaceSignal): void {
    if (node.isLogic) {
      this.write('logic ');
    }
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
    this.write(';');
  }

  private printViewDef(node: ViewDef): void {
    this.write('view ');
    this.printIdentifier(node.name);
    this.write(' {');
    if (node.signals.length > 0) {
      this.newline();
      this.indent();
      for (const signal of node.signals) {
        this.printViewSignal(signal);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printViewSignal(node: ViewSignal): void {
    this.write(node.direction);
    this.write(' ');
    this.printIdentifier(node.name);
    this.write(';');
  }

  // ========================================
  // Package and Import
  // ========================================

  private printPackageDecl(node: PackageDecl): void {
    this.write('package ');
    this.printPath(node.path);
    this.write(' {');
    if (node.items.length > 0) {
      this.newline();
      this.indent();
      for (let i = 0; i < node.items.length; i++) {
        if (i > 0) {
          this.newline();
          this.newline();
        }
        this.printItem(node.items[i]!);
      }
      this.newline();
      this.dedent();
    }
    this.write('}');
  }

  private printImportDecl(node: ImportDecl): void {
    this.write('import ');
    this.printImportPath(node.path);
    if (node.alias) {
      this.write(' as ');
      this.printIdentifier(node.alias);
    }
    this.write(';');
  }

  private printImportPath(path: ImportDecl['path']): void {
    switch (path.kind) {
      case 'Simple':
        this.printPath(path.path);
        break;
      case 'Glob':
        this.printPath(path.path);
        this.write('::*');
        break;
      case 'List':
        this.printPath(path.path);
        this.write('::{');
        for (let i = 0; i < path.items.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printIdentifier(path.items[i]!.name);
          if (path.items[i]!.alias) {
            this.write(' as ');
            this.printIdentifier(path.items[i]!.alias!);
          }
        }
        this.write('}');
        break;
    }
  }

  // ========================================
  // Test Definition
  // ========================================

  private printTestDef(node: TestDef): void {
    for (const attr of node.attributes) {
      this.printTestAttribute(attr);
      this.newline();
    }
    this.write('#[test]');
    this.newline();
    this.write('fn ');
    this.printIdentifier(node.name);
    this.write('() {');
    if (node.body.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.body) {
        this.printTestStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printTestAttribute(node: TestAttribute): void {
    this.write('#[');
    this.write(node.name);
    if (node.params && node.params.length > 0) {
      this.write('(');
      for (let i = 0; i < node.params.length; i++) {
        if (i > 0) {
          this.write(', ');
        }
        this.write(node.params[i]!.name);
        this.write(' = ');
        this.printExpr(node.params[i]!.value);
      }
      this.write(')');
    }
    this.write(']');
  }

  private printTestStmt(stmt: TestStmt): void {
    switch (stmt.kind) {
      case 'AssertStmt':
        this.printAssertStmt(stmt);
        break;
      case 'WaitStmt':
        this.printWaitStmt(stmt);
        break;
      case 'DriveStmt':
        this.printDriveStmt(stmt);
        break;
      case 'SampleStmt':
        this.printSampleStmt(stmt);
        break;
      default:
        this.printStmt(stmt as Stmt);
    }
  }

  private printAssertStmt(node: AssertStmt): void {
    this.write('assert ');
    this.printExpr(node.condition);
    if (node.message) {
      this.write(', "');
      this.write(node.message);
      this.write('"');
    }
    this.write(';');
  }

  private printWaitStmt(node: WaitStmt): void {
    this.write('wait ');
    switch (node.condition.kind) {
      case 'ExprWait':
        this.printExpr(node.condition.expr);
        break;
      case 'DurationWait':
        this.write(String(node.condition.value));
        this.write(node.condition.unit);
        break;
      case 'ClockWait':
        this.printExpr(node.condition.clock.signal);
        this.write('.');
        this.write(node.condition.clock.edge);
        break;
    }
    this.write(';');
  }

  private printDriveStmt(node: DriveStmt): void {
    this.printIdentifier(node.target);
    this.write(' <= ');
    this.printExpr(node.value);
    this.write(';');
  }

  private printSampleStmt(node: SampleStmt): void {
    this.write('sample ');
    this.printIdentifier(node.name);
    this.write(' = ');
    this.printExpr(node.expr);
    this.write(';');
  }

  // ========================================
  // Const Definition
  // ========================================

  private printConstDef(node: ConstDef): void {
    this.printVisibility(node.visibility);
    this.write('const ');
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
    this.write(' = ');
    this.printExpr(node.init);
    this.write(';');
  }

  // ========================================
  // Logic Blocks
  // ========================================

  private printCombBlock(node: CombBlock): void {
    this.write('comb {');
    if (node.stmts.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.stmts) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printSyncBlock(node: SyncBlock): void {
    this.write('sync(');
    this.printExpr(node.clock.signal);
    this.write('.');
    this.write(node.clock.edge);
    if (node.reset) {
      this.write(', ');
      this.printExpr(node.reset.signal);
      this.write('.');
      this.write(node.reset.mode);
    }
    this.write(') {');
    if (node.stmts.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.stmts) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printFsmBlock(node: FsmBlock): void {
    this.write('fsm ');
    this.printIdentifier(node.name);
    this.write('(');
    this.printExpr(node.clock.signal);
    this.write('.');
    this.write(node.clock.edge);
    if (node.reset) {
      this.write(', ');
      this.printExpr(node.reset.signal);
      this.write('.');
      this.write(node.reset.mode);
    }
    this.write(') {');
    this.newline();
    this.indent();

    // State enum
    this.printStateEnum(node.stateEnum);
    this.newline();
    this.newline();

    // Transitions
    this.printTransitionsBlock(node.transitions);
    this.newline();

    // Output blocks
    for (const output of node.outputs) {
      this.newline();
      this.printOutputBlock(output);
      this.newline();
    }

    this.dedent();
    this.write('}');
  }

  private printStateEnum(node: StateEnum): void {
    this.write('state {');
    this.newline();
    this.indent();
    for (const state of node.states) {
      this.printStateItem(state);
      this.newline();
    }
    this.dedent();
    this.write('}');
  }

  private printStateItem(node: StateItem): void {
    this.printIdentifier(node.name);
    if (node.mooreOutputs && node.mooreOutputs.length > 0) {
      this.write(' {');
      this.newline();
      this.indent();
      for (const output of node.mooreOutputs) {
        this.printOutputAssign(output);
        this.newline();
      }
      this.dedent();
      this.write('}');
    } else {
      this.write(',');
    }
  }

  private printOutputAssign(node: OutputAssign): void {
    this.printIdentifier(node.name);
    this.write(' = ');
    this.printExpr(node.value);
    this.write(';');
  }

  private printTransitionsBlock(node: TransitionsBlock): void {
    this.write('transitions {');
    this.newline();
    this.indent();
    for (const item of node.items) {
      this.printTransitionItem(item);
      this.newline();
    }
    this.dedent();
    this.write('}');
  }

  private printTransitionItem(node: TransitionItem): void {
    if (node.fromState === '_') {
      this.write('_');
    } else {
      this.printIdentifier(node.fromState);
    }
    this.write(' {');
    this.newline();
    this.indent();
    for (const when of node.whenClauses) {
      this.printWhenClause(when);
      this.newline();
    }
    this.dedent();
    this.write('}');
  }

  private printWhenClause(node: WhenClause): void {
    this.write('when ');
    this.printExpr(node.condition);
    this.write(' => ');
    if (node.actions.length === 1) {
      this.printTransitionAction(node.actions[0]!);
    } else {
      this.write('{');
      this.newline();
      this.indent();
      for (const action of node.actions) {
        this.printTransitionAction(action);
        this.newline();
      }
      this.dedent();
      this.write('}');
    }
  }

  private printTransitionAction(action: TransitionAction): void {
    switch (action.kind) {
      case 'Goto':
        this.write('goto ');
        this.printIdentifier(action.target);
        this.write(';');
        break;
      case 'Stmt':
        this.printStmt(action.stmt);
        break;
    }
  }

  private printOutputBlock(node: OutputBlock): void {
    this.write('output ');
    this.printIdentifier(node.name);
    this.write(' {');
    this.newline();
    this.indent();
    for (const case_ of node.cases) {
      this.printOutputCase(case_);
      this.newline();
    }
    this.dedent();
    this.write('}');
  }

  private printOutputCase(node: OutputCase): void {
    this.printIdentifier(node.state);
    this.write(' => ');
    this.printExpr(node.value);
    this.write(';');
  }

  // ========================================
  // Instance and Memory
  // ========================================

  private printInstDecl(node: InstDecl): void {
    this.printIdentifier(node.name);
    this.write(': ');
    this.printPath(node.modulePath);
    if (node.genericArgs && node.genericArgs.length > 0) {
      this.write('<');
      for (let i = 0; i < node.genericArgs.length; i++) {
        if (i > 0) {
          this.write(', ');
        }
        const arg = node.genericArgs[i]!;
        if (arg.name) {
          this.printIdentifier(arg.name);
          this.write(' = ');
        }
        if ('kind' in arg.value && typeof arg.value.kind === 'string') {
          if (this.isTypeExpr(arg.value)) {
            this.printTypeExpr(arg.value as TypeExpr);
          } else {
            this.printExpr(arg.value as Expr);
          }
        }
      }
      this.write('>');
    }
    this.write('(');
    if (node.connections.length > 0) {
      this.newline();
      this.indent();
      for (let i = 0; i < node.connections.length; i++) {
        this.printConnection(node.connections[i]!);
        if (i < node.connections.length - 1) {
          this.write(',');
        }
        this.newline();
      }
      this.dedent();
    }
    this.write(');');
  }

  private printConnection(node: Connection): void {
    this.write('.');
    this.printIdentifier(node.port);
    this.write('(');
    this.printExpr(node.expr);
    this.write(')');
  }

  private printMemDecl(node: MemDecl): void {
    this.write('mem ');
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.elementType);
    this.write('[');
    this.printExpr(node.depth);
    this.write(']');
    if (node.config) {
      this.write(' {');
      this.newline();
      this.indent();
      for (const item of node.config.items) {
        this.write(item.key);
        this.write(': ');
        if ('kind' in item.value && item.value.kind === 'Identifier') {
          this.printIdentifier(item.value as Identifier);
        } else {
          this.printLiteral(item.value as Literal);
        }
        this.write(',');
        this.newline();
      }
      this.dedent();
      this.write('}');
    }
    if (node.init) {
      this.write(' = ');
      this.printExpr(node.init);
    }
    this.write(';');
  }

  // ========================================
  // Statements
  // ========================================

  private printStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'LetDecl':
        this.printLetDecl(stmt);
        this.write(';');
        break;
      case 'VarDecl':
        this.printVarDecl(stmt);
        this.write(';');
        break;
      case 'AssignStmt':
        this.printAssignStmt(stmt);
        break;
      case 'IfStmt':
        this.printIfStmt(stmt);
        break;
      case 'MatchStmt':
        this.printMatchStmt(stmt);
        break;
      case 'ForStmt':
        this.printForStmt(stmt);
        break;
      case 'WhileStmt':
        this.printWhileStmt(stmt);
        break;
      case 'ReturnStmt':
        this.printReturnStmt(stmt);
        break;
      case 'BlockStmt':
        this.printBlockStmt(stmt);
        break;
      case 'ExprStmt':
        this.printExprStmt(stmt);
        break;
    }
  }

  private printLetDecl(node: LetDecl): void {
    this.write('let ');
    if (node.mutable) {
      this.write('mut ');
    }
    this.printIdentifier(node.name);
    if (node.typeExpr) {
      this.write(': ');
      this.printTypeExpr(node.typeExpr);
    }
    if (node.init) {
      this.write(' = ');
      this.printExpr(node.init);
    }
  }

  private printVarDecl(node: VarDecl): void {
    this.write('var ');
    this.printIdentifier(node.name);
    if (node.typeExpr) {
      this.write(': ');
      this.printTypeExpr(node.typeExpr);
    }
    if (node.init) {
      this.write(' = ');
      this.printExpr(node.init);
    }
  }

  private printConstDecl(node: ConstDecl): void {
    this.printVisibility(node.visibility);
    this.write('const ');
    this.printIdentifier(node.name);
    this.write(': ');
    this.printTypeExpr(node.typeExpr);
    this.write(' = ');
    this.printExpr(node.init);
    this.write(';');
  }

  private printAssignStmt(node: AssignStmt): void {
    this.printLValue(node.lvalue);
    this.write(' = ');
    this.printExpr(node.value);
    this.write(';');
  }

  private printLValue(lvalue: LValue): void {
    switch (lvalue.kind) {
      case 'IdentLValue':
        this.printIdentifier(lvalue.name);
        break;
      case 'IndexLValue':
        this.printLValue(lvalue.base);
        this.write('[');
        this.printExpr(lvalue.index);
        this.write(']');
        break;
      case 'FieldLValue':
        this.printLValue(lvalue.base);
        this.write('.');
        this.printIdentifier(lvalue.field);
        break;
      case 'ConcatLValue':
        this.write('{');
        for (let i = 0; i < lvalue.elements.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printLValue(lvalue.elements[i]!);
        }
        this.write('}');
        break;
    }
  }

  private printIfStmt(node: IfStmt): void {
    this.write('if ');
    this.printExpr(node.condition);
    this.write(' {');
    if (node.thenBlock.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.thenBlock) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
    if (node.elseBlock) {
      this.write(' else ');
      if (Array.isArray(node.elseBlock)) {
        this.write('{');
        if (node.elseBlock.length > 0) {
          this.newline();
          this.indent();
          for (const stmt of node.elseBlock) {
            this.printStmt(stmt);
            this.newline();
          }
          this.dedent();
        }
        this.write('}');
      } else {
        this.printIfStmt(node.elseBlock);
      }
    }
  }

  private printMatchStmt(node: MatchStmt): void {
    this.write('match ');
    this.printExpr(node.scrutinee);
    this.write(' {');
    if (node.arms.length > 0) {
      this.newline();
      this.indent();
      for (const arm of node.arms) {
        this.printMatchArm(arm);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printMatchArm(node: MatchArm): void {
    this.printPattern(node.pattern);
    this.write(' => ');
    if (node.body.kind === 'BlockStmt') {
      this.printBlockStmt(node.body);
    } else {
      this.printExpr(node.body as Expr);
      this.write(',');
    }
  }

  private printForStmt(node: ForStmt): void {
    this.write('for ');
    this.printIdentifier(node.variable);
    this.write(' in ');
    this.printExpr(node.range.start);
    this.write(node.range.inclusive ? '..=' : '..');
    this.printExpr(node.range.end);
    this.write(' {');
    if (node.body.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.body) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printWhileStmt(node: WhileStmt): void {
    this.write('while ');
    this.printExpr(node.condition);
    this.write(' {');
    if (node.body.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.body) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printReturnStmt(node: ReturnStmt): void {
    this.write('return');
    if (node.value) {
      this.write(' ');
      this.printExpr(node.value);
    }
    this.write(';');
  }

  private printBlockStmt(node: BlockStmt): void {
    this.write('{');
    if (node.stmts.length > 0) {
      this.newline();
      this.indent();
      for (const stmt of node.stmts) {
        this.printStmt(stmt);
        this.newline();
      }
      this.dedent();
    }
    this.write('}');
  }

  private printExprStmt(node: ExprStmt): void {
    this.printExpr(node.expr);
    this.write(';');
  }

  // ========================================
  // Patterns
  // ========================================

  private printPattern(pattern: Pattern): void {
    switch (pattern.kind) {
      case 'LiteralPattern':
        this.printLiteral(pattern.value);
        break;
      case 'IdentPattern':
        this.printIdentifier(pattern.name);
        break;
      case 'WildcardPattern':
        this.write('_');
        break;
      case 'PathPattern':
        this.printPath(pattern.path);
        break;
      case 'RangePattern':
        this.printExpr(pattern.start);
        this.write(pattern.inclusive ? '..=' : '..');
        this.printExpr(pattern.end);
        break;
      case 'TuplePattern':
        this.write('(');
        for (let i = 0; i < pattern.elements.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printPattern(pattern.elements[i]!);
        }
        this.write(')');
        break;
      case 'StructPattern':
        this.printPath(pattern.path);
        this.write(' { ');
        for (let i = 0; i < pattern.fields.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printIdentifier(pattern.fields[i]!.name);
          if (pattern.fields[i]!.pattern) {
            this.write(': ');
            this.printPattern(pattern.fields[i]!.pattern!);
          }
        }
        this.write(' }');
        break;
    }
  }

  // ========================================
  // Expressions
  // ========================================

  private printExpr(expr: Expr): void {
    switch (expr.kind) {
      case 'LiteralExpr':
        this.printLiteral(expr.value);
        break;
      case 'IdentExpr':
        this.printIdentifier(expr.name);
        break;
      case 'PathExpr':
        this.printPath(expr.path);
        break;
      case 'UnaryExpr':
        this.write(expr.op);
        this.printExpr(expr.operand);
        break;
      case 'BinaryExpr':
        this.printExpr(expr.left);
        this.write(' ');
        this.write(expr.op);
        this.write(' ');
        this.printExpr(expr.right);
        break;
      case 'CallExpr':
        this.printExpr(expr.callee);
        this.write('(');
        for (let i = 0; i < expr.args.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printExpr(expr.args[i]!);
        }
        this.write(')');
        break;
      case 'IndexExpr':
        this.printExpr(expr.base);
        this.write('[');
        this.printExpr(expr.index);
        if (expr.rangeEnd) {
          this.write(':');
          this.printExpr(expr.rangeEnd);
        }
        this.write(']');
        break;
      case 'FieldExpr':
        this.printExpr(expr.base);
        this.write('.');
        this.printIdentifier(expr.field);
        break;
      case 'CastExpr':
        this.printExpr(expr.expr);
        this.write(' as ');
        this.printTypeExpr(expr.targetType);
        break;
      case 'IfExpr':
        this.write('if ');
        this.printExpr(expr.condition);
        this.write(' { ');
        this.printExpr(expr.thenExpr);
        this.write(' } else { ');
        this.printExpr(expr.elseExpr);
        this.write(' }');
        break;
      case 'MatchExpr':
        this.write('match ');
        this.printExpr(expr.scrutinee);
        this.write(' {');
        this.newline();
        this.indent();
        for (const arm of expr.arms) {
          this.printMatchArm(arm);
          this.newline();
        }
        this.dedent();
        this.write('}');
        break;
      case 'ConcatExpr':
        this.write('{');
        for (let i = 0; i < expr.elements.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printExpr(expr.elements[i]!);
        }
        this.write('}');
        break;
      case 'RepeatExpr':
        this.write('{');
        this.printExpr(expr.expr);
        this.write(' ; ');
        this.printExpr(expr.count);
        this.write('}');
        break;
      case 'ParenExpr':
        this.write('(');
        this.printExpr(expr.inner);
        this.write(')');
        break;
    }
  }

  private printLiteral(lit: Literal): void {
    switch (lit.kind) {
      case 'Int':
        if (lit.width !== undefined) {
          this.write(String(lit.width));
          this.write("'");
          if (lit.base) {
            this.write(lit.base);
          }
        }
        this.write(lit.value);
        break;
      case 'Bool':
        this.write(lit.value ? 'true' : 'false');
        break;
      case 'String':
        this.write('"');
        this.write(lit.value);
        this.write('"');
        break;
    }
  }

  // ========================================
  // Type Expressions
  // ========================================

  private printTypeExpr(typeExpr: TypeExpr): void {
    switch (typeExpr.kind) {
      case 'PrimitiveType':
        this.write(typeExpr.name);
        if (typeExpr.width) {
          this.write('<');
          this.printExpr(typeExpr.width);
          this.write('>');
        }
        break;
      case 'ArrayType':
        this.printTypeExpr(typeExpr.elementType);
        this.write('[');
        this.printExpr(typeExpr.size);
        this.write(']');
        break;
      case 'TupleType':
        this.write('(');
        for (let i = 0; i < typeExpr.elements.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          this.printTypeExpr(typeExpr.elements[i]!);
        }
        this.write(')');
        break;
      case 'UserType':
        this.printPath(typeExpr.path);
        break;
      case 'GenericType':
        this.printPath(typeExpr.path);
        this.write('<');
        for (let i = 0; i < typeExpr.args.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          const arg = typeExpr.args[i]!;
          if (arg.name) {
            this.printIdentifier(arg.name);
            this.write(' = ');
          }
          if (this.isTypeExpr(arg.value)) {
            this.printTypeExpr(arg.value as TypeExpr);
          } else {
            this.printExpr(arg.value as Expr);
          }
        }
        this.write('>');
        break;
    }
  }

  // ========================================
  // Common
  // ========================================

  private printIdentifier(node: Identifier): void {
    this.write(node.name);
  }

  private printPath(node: Path): void {
    for (let i = 0; i < node.segments.length; i++) {
      if (i > 0) {
        this.write('::');
      }
      this.printIdentifier(node.segments[i]!);
    }
  }

  private printVisibility(visibility: 'pub' | 'private'): void {
    if (visibility === 'pub') {
      this.write('pub ');
    }
  }

  private printAttributes(attributes: Attribute[]): void {
    for (const attr of attributes) {
      this.write('#[');
      this.printPath(attr.path);
      if (attr.args && attr.args.length > 0) {
        this.write('(');
        for (let i = 0; i < attr.args.length; i++) {
          if (i > 0) {
            this.write(', ');
          }
          const arg = attr.args[i]!;
          if (arg.name) {
            this.printIdentifier(arg.name);
            this.write(' = ');
          }
          this.printLiteral(arg.value);
        }
        this.write(')');
      }
      this.write(']');
      this.newline();
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  private isTypeExpr(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const kind = (value as { kind?: string }).kind;
    return (
      kind === 'PrimitiveType' ||
      kind === 'ArrayType' ||
      kind === 'TupleType' ||
      kind === 'UserType' ||
      kind === 'GenericType'
    );
  }

  // ========================================
  // Output helpers
  // ========================================

  private write(text: string): void {
    if (this.atLineStart && text.trim() !== '') {
      this.writeIndent();
    }
    this.output.push(text);
    this.atLineStart = false;
  }

  private writeIndent(): void {
    const indent = this.style.useTabs
      ? '\t'.repeat(this.indentLevel)
      : ' '.repeat(this.indentLevel * this.style.indentWidth);
    this.output.push(indent);
  }

  private newline(): void {
    this.output.push('\n');
    this.atLineStart = true;
  }

  private indent(): void {
    this.indentLevel++;
  }

  private dedent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }
}
