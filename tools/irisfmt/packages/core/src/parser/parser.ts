import type { Token, SourceSpan, SourceLocation, Trivia } from '../lexer/token.js';
import { TokenKind } from '../lexer/token.js';
import type {
  SourceFile,
  Item,
  Identifier,
  Path,
  Visibility,
  Attribute,
  AttributeArg,
  GenericParams,
  GenericParam,
  GenericBound,
  WhereClause,
  Constraint,
  ConstraintKind,
  ModDef,
  ModItem,
  PortDecl,
  PortDirection,
  TypeExpr,
  PrimitiveType,
  TupleType,
  UserType,
  GenericType,
  GenericArg,
  Expr,
  Literal,
  BinaryOp,
  IfExpr,
  MatchExpr,
  MatchArm,
  Pattern,
  Stmt,
  LetDecl,
  VarDecl,
  ConstDecl,
  ConstDef,
  LValue,
  IfStmt,
  MatchStmt,
  ForStmt,
  RangeExpr,
  WhileStmt,
  ReturnStmt,
  BlockStmt,
  CombBlock,
  SyncBlock,
  ClockSpec,
  ResetSpec,
  FnDef,
  FnParam,
  EnumDef,
  EnumVariant,
  StructDef,
  UnionDef,
  ExternModDef,
  StructField,
  TypeAlias,
  InterfaceDef,
  InterfaceSignal,
  ViewDef,
  ViewSignal,
  ImportDecl,
  ImportPath,
  ImportItem,
  PackageDecl,
  InstDecl,
  Connection,
  TestDef,
  TestAttribute,
  TestParam,
  TestStmt,
  AssertStmt,
  AssertSeverity,
  TimeUnit,
  WaitStmt,
  WaitCondition,
  DriveStmt,
  SampleStmt,
  MemDecl,
  MemConfig,
  MemConfigItem,
  FsmBlock,
  StateEnum,
  StateItem,
  OutputAssign,
  TransitionsBlock,
  TransitionItem,
  WhenClause,
  TransitionAction,
  OutputBlock,
  OutputCase,
  TestModDef,
  TestModItem,
  InitialBlock,
  SeqBlock,
  SeqStatement,
  AwaitStmt,
  AwaitExpr,
  ClockEdgeAwait,
  UntilAwait,
  TypeAttr,
  EventAwait,
  AsyncCallAwait,
  DelayStmt,
  Duration,
  UseRustDecl,
  ExternRustBlock,
  RustFnDecl,
  RustParam,
} from '../ast/types.js';

/**
 * Parse error information
 */
export interface ParseError {
  message: string;
  span: SourceSpan;
  severity: 'error' | 'warning';
}

/**
 * Parser result
 */
export interface ParseResult {
  ast: SourceFile;
  errors: ParseError[];
}

/**
 * Operator precedence levels for Pratt parser
 */
const enum Precedence {
  None = 0,
  Assignment = 1,   // =
  Or = 2,           // ||
  And = 3,          // &&
  BitOr = 4,        // |
  BitXor = 5,       // ^
  BitAnd = 6,       // &
  Equality = 7,     // == !=
  Comparison = 8,   // < <= > >=
  Shift = 9,        // << >> >>>
  Term = 10,        // + -
  Factor = 11,      // * / %
  Power = 12,       // **
  Unary = 13,       // ! ~ -
  Call = 14,        // () [] .
  Primary = 15,
}

/**
 * Get binary operator precedence
 */
function getBinaryPrecedence(kind: TokenKind): Precedence {
  switch (kind) {
    case TokenKind.PipePipe:
      return Precedence.Or;
    case TokenKind.AmpAmp:
      return Precedence.And;
    case TokenKind.Pipe:
      return Precedence.BitOr;
    case TokenKind.Caret:
      return Precedence.BitXor;
    case TokenKind.Amp:
      return Precedence.BitAnd;
    case TokenKind.EqEq:
    case TokenKind.Ne:
      return Precedence.Equality;
    case TokenKind.Lt:
    case TokenKind.Le:
    case TokenKind.Gt:
    case TokenKind.Ge:
      return Precedence.Comparison;
    case TokenKind.Shl:
    case TokenKind.Shr:
    case TokenKind.Ashr:
      return Precedence.Shift;
    case TokenKind.Plus:
    case TokenKind.Minus:
      return Precedence.Term;
    case TokenKind.Star:
    case TokenKind.Slash:
    case TokenKind.Percent:
      return Precedence.Factor;
    case TokenKind.Power:
      return Precedence.Power;
    default:
      return Precedence.None;
  }
}

/**
 * Convert token kind to binary operator
 */
function tokenToBinaryOp(kind: TokenKind): BinaryOp | null {
  switch (kind) {
    case TokenKind.Plus: return '+';
    case TokenKind.Minus: return '-';
    case TokenKind.Star: return '*';
    case TokenKind.Slash: return '/';
    case TokenKind.Percent: return '%';
    case TokenKind.Power: return '**';
    case TokenKind.Amp: return '&';
    case TokenKind.Pipe: return '|';
    case TokenKind.Caret: return '^';
    case TokenKind.Shl: return '<<';
    case TokenKind.Shr: return '>>';
    case TokenKind.Ashr: return '>>>';
    case TokenKind.EqEq: return '==';
    case TokenKind.Ne: return '!=';
    case TokenKind.Lt: return '<';
    case TokenKind.Le: return '<=';
    case TokenKind.Gt: return '>';
    case TokenKind.Ge: return '>=';
    case TokenKind.AmpAmp: return '&&';
    case TokenKind.PipePipe: return '||';
    default: return null;
  }
}

/**
 * IRIS Language Parser
 * Converts tokens into an Abstract Syntax Tree
 */
export class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /**
   * Parse the token stream into an AST
   */
  parse(): ParseResult {
    const ast = this.parseSourceFile();
    return { ast, errors: this.errors };
  }

  // ========================================
  // Top-level parsing
  // ========================================

  private parseSourceFile(): SourceFile {
    const items: Item[] = [];
    const startSpan = this.current().span;

    while (!this.isEof()) {
      const mark = this.pos;
      const item = this.parseItem();
      if (item) {
        items.push(item);
      }
      this.ensureProgress(mark);
    }

    return {
      kind: 'SourceFile',
      items,
      span: this.makeSpan(startSpan.start, this.current().span.end),
    };
  }

  private parseItem(): Item | null {
    // Skip invalid tokens
    while (!this.isEof() && this.current().kind === TokenKind.Invalid) {
      this.advance();
    }

    if (this.isEof()) {
      return null;
    }

    const start = this.current().span.start;

    // Parse attributes
    const attributes = this.parseAttributes();

    // Parse visibility
    const visibility = this.parseVisibility();

    // Parse item based on keyword
    if (this.check(TokenKind.Test)) {
      // `test Name { ... }` is a test module; `test name() { ... }` is a test
      // function. The older form spelled the module `test mod Name`.
      if (this.peek().kind === TokenKind.Mod) {
        return this.parseTestModDef(start, visibility);
      }
      if (this.peek().kind === TokenKind.Ident && this.peek(2).kind === TokenKind.LParen) {
        return this.parseTestFnDef(start, attributes);
      }
      return this.parseTestModDef(start, visibility);
    }
    if (this.check(TokenKind.Mod)) {
      return this.parseModDef(start, visibility, attributes);
    }
    if (this.check(TokenKind.Fn)) {
      // Check if this is a test function (has #[test] attribute)
      const hasTestAttr = attributes.some(
        attr => attr.path.segments.length === 1 && attr.path.segments[0]?.name === 'test'
      );
      if (hasTestAttr) {
        return this.parseTestDef(start, attributes);
      }
      return this.parseFnDef(start, visibility);
    }
    if (this.check(TokenKind.Struct)) {
      return this.parseStructDef(start, visibility);
    }
    if (this.check(TokenKind.Union)) {
      return this.parseUnionDef(start, visibility);
    }
    if (this.check(TokenKind.Extern)) {
      return this.parseExternModDef(start, visibility);
    }
    if (this.check(TokenKind.Enum)) {
      return this.parseEnumDef(start, visibility);
    }
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAlias(start, visibility);
    }
    if (this.check(TokenKind.Const)) {
      return this.parseConstDef(start, visibility);
    }
    if (this.check(TokenKind.Interface)) {
      return this.parseInterfaceDef(start, visibility);
    }
    if (this.check(TokenKind.Import)) {
      return this.parseImportDecl(start);
    }
    if (this.check(TokenKind.Package)) {
      return this.parsePackageDecl(start);
    }

    // Unknown token - skip and report error
    this.reportError(`Unexpected token: ${this.current().text}`);
    this.advance();
    return null;
  }

  // ========================================
  // Attributes
  // ========================================

  private parseAttributes(): Attribute[] {
    const attrs: Attribute[] = [];
    while (this.check(TokenKind.Hash)) {
      const attr = this.parseAttribute();
      if (attr) {
        attrs.push(attr);
      }
    }
    return attrs;
  }

  private parseAttribute(): Attribute | null {
    const start = this.current().span.start;
    this.expect(TokenKind.Hash, 'Expected #');
    if (!this.expect(TokenKind.LBracket, 'Expected [')) {
      return null;
    }

    const path = this.parsePath();
    if (!path) {
      return null;
    }

    let args: AttributeArg[] | undefined;
    if (this.match(TokenKind.LParen)) {
      args = this.parseAttributeArgs();
      this.expect(TokenKind.RParen, 'Expected )');
    }

    this.expect(TokenKind.RBracket, 'Expected ]');

    return {
      kind: 'Attribute',
      path,
      args,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseAttributeArgs(): AttributeArg[] {
    const args: AttributeArg[] = [];
    if (this.check(TokenKind.RParen)) {
      return args;
    }

    do {
      const arg = this.parseAttributeArg();
      if (arg) {
        args.push(arg);
      }
    } while (this.match(TokenKind.Comma));

    return args;
  }

  private parseAttributeArg(): AttributeArg | null {
    const start = this.current().span.start;
    let name: Identifier | undefined;

    // Check for named argument: name = value
    if (this.check(TokenKind.Ident) && this.peek().kind === TokenKind.Eq) {
      const nameToken = this.advance();
      name = this.makeIdentifier(nameToken);
      this.advance(); // consume =
    }

    const literal = this.parseLiteral();
    if (!literal) {
      return null;
    }

    return {
      kind: 'AttributeArg',
      name,
      value: literal,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Visibility
  // ========================================

  private parseVisibility(): Visibility {
    if (this.match(TokenKind.Pub)) {
      return 'pub';
    }
    return 'private';
  }

  // ========================================
  // Module Definition
  // ========================================

  private parseModDef(
    start: SourceLocation,
    visibility: Visibility,
    attributes: Attribute[]
  ): ModDef | null {
    this.expect(TokenKind.Mod, 'Expected mod');

    const nameToken = this.expect(TokenKind.Ident, 'Expected module name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    // Optional generic parameters
    const genericParams = this.check(TokenKind.LBracket)
      ? this.parseGenericParams() ?? undefined
      : undefined;

    // Optional where clause
    const whereClause = this.check(TokenKind.Where)
      ? this.parseWhereClause() ?? undefined
      : undefined;

    // Port list
    if (!this.expect(TokenKind.LParen, 'Expected (')) {
      return null;
    }
    const ports = this.parsePortList();
    this.expect(TokenKind.RParen, 'Expected )');

    // Module body
    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }
    const items = this.parseModItems();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'ModDef',
      visibility,
      attributes,
      name,
      genericParams,
      whereClause,
      ports,
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parsePortList(): PortDecl[] {
    const ports: PortDecl[] = [];
    while (!this.check(TokenKind.RParen) && !this.isEof()) {
      const port = this.parsePortDecl();
      if (port) {
        ports.push(port);
      } else {
        // Skip to next comma or end of list
        while (!this.check(TokenKind.Comma) && !this.check(TokenKind.RParen) && !this.isEof()) {
          this.advance();
        }
      }
      this.match(TokenKind.Comma); // optional trailing comma
    }
    return ports;
  }

  private parsePortDecl(): PortDecl | null {
    const start = this.current().span.start;
    const direction = this.parsePortDirection();
    if (!direction) {
      return null;
    }

    const nameToken = this.expect(TokenKind.Ident, 'Expected port name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) {
      return null;
    }

    return {
      kind: 'PortDecl',
      direction,
      name,
      typeExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parsePortDirection(): PortDirection | null {
    if (this.match(TokenKind.In)) return 'in';
    if (this.match(TokenKind.Out)) return 'out';
    if (this.match(TokenKind.Inout)) return 'inout';
    if (this.match(TokenKind.Initiator)) return 'initiator';
    if (this.match(TokenKind.Target)) return 'target';
    if (this.match(TokenKind.Monitor)) return 'monitor';
    this.reportError('Expected port direction (in, out, inout, initiator, target, monitor)');
    return null;
  }

  private parseModItems(): ModItem[] {
    const items: ModItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const item = this.parseModItem();
      if (item) {
        items.push(item);
      }
      this.ensureProgress(mark);
    }
    return items;
  }

  private parseModItem(): ModItem | null {
    const start = this.current().span.start;

    if (this.check(TokenKind.Let)) {
      return this.parseLetDecl(start);
    }
    if (this.check(TokenKind.Var)) {
      return this.parseVarDecl(start);
    }
    if (this.check(TokenKind.Const)) {
      return this.parseConstDecl(start, 'private');
    }
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAlias(start, 'private');
    }
    if (this.check(TokenKind.Comb)) {
      return this.parseCombBlock(start);
    }
    if (this.check(TokenKind.Sync)) {
      return this.parseSyncBlock(start);
    }
    if (this.check(TokenKind.Mem)) {
      return this.parseMemDecl(start);
    }
    if (this.check(TokenKind.Fsm)) {
      return this.parseFsmBlock(start);
    }
    // `inst` is not a keyword in this lexer, so it arrives as an identifier
    if (this.check(TokenKind.Ident) && this.current().text === 'inst') {
      return this.parseInstDecl(start);
    }
    if (this.check(TokenKind.Ident)) {
      // The older form: name: ModulePath(...)
      if (this.peek().kind === TokenKind.Colon) {
        return this.parseInstDecl(start);
      }
    }

    this.reportError(`Unexpected token in module body: ${this.current().text}`);
    this.advance();
    return null;
  }

  // ========================================
  // Generic Parameters
  // ========================================

  private parseGenericParams(): GenericParams | null {
    const start = this.current().span.start;
    if (!this.expect(TokenKind.LBracket, 'Expected [')) {
      return null;
    }

    const params: GenericParam[] = [];
    if (!this.check(TokenKind.RBracket)) {
      do {
        // A trailing comma before `]` is allowed
        if (this.check(TokenKind.RBracket)) break;
        const param = this.parseGenericParam();
        if (param) {
          params.push(param);
        }
      } while (this.match(TokenKind.Comma));
    }

    this.expect(TokenKind.RBracket, 'Expected ]');

    return {
      kind: 'GenericParams',
      params,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseGenericParam(): GenericParam | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected parameter name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const bound = this.parseGenericBound();

    let defaultValue: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      defaultValue = this.parseExpr() ?? undefined;
    }

    return {
      kind: 'GenericParam',
      name,
      bound,
      defaultValue,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseGenericBound(): GenericBound {
    if (this.match(TokenKind.Type)) {
      return { kind: 'TypeBound' };
    }
    if (this.match(TokenKind.Uint)) {
      return { kind: 'UintBound' };
    }
    if (this.match(TokenKind.Int)) {
      return { kind: 'IntBound' };
    }
    if (this.match(TokenKind.Bool)) {
      return { kind: 'BoolBound' };
    }
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) {
      throw new Error('Expected type expression for type bound');
    }
    return { kind: 'TypeExprBound', typeExpr };
  }

  // ========================================
  // Where Clause
  // ========================================

  private parseWhereClause(): WhereClause | null {
    const start = this.current().span.start;
    this.expect(TokenKind.Where, 'Expected where');

    const constraints: Constraint[] = [];
    do {
      // A trailing comma before the port list is allowed
      if (this.check(TokenKind.LParen)) break;
      const constraint = this.parseConstraint();
      if (constraint) {
        constraints.push(constraint);
      }
    } while (this.match(TokenKind.Comma));

    return {
      kind: 'WhereClause',
      constraints,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseConstraint(): Constraint | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected identifier');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    let constraintKind: ConstraintKind;
    if (this.match(TokenKind.Colon)) {
      constraintKind = ':';
    } else if (this.match(TokenKind.EqEq)) {
      constraintKind = '==';
    } else if (this.match(TokenKind.Ne)) {
      constraintKind = '!=';
    } else if (this.match(TokenKind.Lt)) {
      constraintKind = '<';
    } else if (this.match(TokenKind.Le)) {
      constraintKind = '<=';
    } else if (this.match(TokenKind.Gt)) {
      constraintKind = '>';
    } else if (this.match(TokenKind.Ge)) {
      constraintKind = '>=';
    } else {
      this.reportError('Expected constraint operator');
      return null;
    }

    const value = this.parseExpr();
    if (!value) {
      return null;
    }

    return {
      kind: 'Constraint',
      name,
      constraintKind,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Type Expressions
  // ========================================

  private parseTypeExpr(): TypeExpr | null {
    const start = this.current().span.start;
    let typeExpr = this.parsePrimaryType();
    if (!typeExpr) {
      return null;
    }

    // Check for array type suffix: T[N]
    while (this.check(TokenKind.LBracket)) {
      this.advance();
      const size = this.parseExpr();
      if (!size) {
        return null;
      }
      this.expect(TokenKind.RBracket, 'Expected ]');

      typeExpr = {
        kind: 'ArrayType',
        elementType: typeExpr,
        size,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    return typeExpr;
  }

  private parsePrimaryType(): TypeExpr | null {
    const start = this.current().span.start;

    // Primitive types
    if (this.check(TokenKind.Bit)) {
      return this.parseBitType(start);
    }
    if (this.check(TokenKind.Int)) {
      return this.parseIntType(start, 'int');
    }
    if (this.check(TokenKind.Uint)) {
      return this.parseIntType(start, 'uint');
    }
    if (this.match(TokenKind.Bool)) {
      return { kind: 'PrimitiveType', name: 'bool', span: this.makeSpan(start, this.previous().span.end) };
    }
    if (this.match(TokenKind.Clock)) {
      const attrs = this.parseTypeAttrs();
      return { kind: 'PrimitiveType', name: 'clock', attrs, span: this.makeSpan(start, this.previous().span.end) };
    }
    if (this.match(TokenKind.Reset)) {
      const attrs = this.parseTypeAttrs();
      return { kind: 'PrimitiveType', name: 'reset', attrs, span: this.makeSpan(start, this.previous().span.end) };
    }
    if (this.match(TokenKind.String)) {
      return { kind: 'PrimitiveType', name: 'string', span: this.makeSpan(start, this.previous().span.end) };
    }

    // Tuple type: (T1, T2, ...)
    if (this.check(TokenKind.LParen)) {
      return this.parseTupleType(start);
    }

    // User type or generic type: Path or Path[T, N]
    if (this.check(TokenKind.Ident)) {
      return this.parseUserOrGenericType(start);
    }

    this.reportError('Expected type');
    return null;
  }

  private parseBitType(start: SourceLocation): PrimitiveType {
    this.advance(); // consume 'bit'
    let width: Expr | undefined;

    if (this.match(TokenKind.Lt)) {
      // Parse width expression without comparison operators
      width = this.parseTypeWidthExpr() ?? undefined;
      this.expect(TokenKind.Gt, 'Expected >');
    }

    return {
      kind: 'PrimitiveType',
      name: 'bit',
      width,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }


  /**
   * Parse the attribute list of a clock or reset type
   *
   * `clock(period: 10ns)`, `reset(active_low: true)`. Specification §2.7.
   * Absent when there is no `(`, which is the bare `clock` / `reset` form.
   */
  private parseTypeAttrs(): TypeAttr[] | undefined {
    if (!this.match(TokenKind.LParen)) {
      return undefined;
    }

    const attrs: TypeAttr[] = [];
    while (!this.check(TokenKind.RParen) && !this.isEof()) {
      const attrStart = this.current().span.start;
      const nameToken = this.expect(TokenKind.Ident, 'Expected attribute name');
      if (!nameToken) {
        break;
      }
      const name = this.makeIdentifier(nameToken);
      if (!this.expect(TokenKind.Colon, 'Expected : after attribute name')) {
        break;
      }
      const value = this.parseExpr();
      if (!value) {
        break;
      }
      // A duration such as `10ns` lexes as an integer followed by the unit,
      // so the unit is still sitting there after the expression.
      const unit = this.matchTimeUnit();
      attrs.push({
        kind: 'TypeAttr',
        name,
        value,
        unit,
        span: this.makeSpan(attrStart, this.previous().span.end),
      });
      if (!this.match(TokenKind.Comma)) {
        break;
      }
    }

    this.expect(TokenKind.RParen, 'Expected ) after type attributes');
    return attrs;
  }
  /**
   * Consume a trailing time unit if one is there. The units are not keywords,
   * so they reach the parser as identifiers.
   */
  private matchTimeUnit(): TimeUnit | undefined {
    if (!this.check(TokenKind.Ident)) {
      return undefined;
    }
    const text = this.current().text;
    if (text === 'ps' || text === 'ns' || text === 'us' || text === 'ms' || text === 's') {
      this.advance();
      return text;
    }
    return undefined;
  }

  private parseIntType(start: SourceLocation, name: 'int' | 'uint'): PrimitiveType {
    this.advance(); // consume 'int' or 'uint'
    // `int[N]` is the current syntax; `int<N>` is the older one and is still
    // accepted so that existing sources keep parsing.
    const bracketed = this.check(TokenKind.LBracket);
    this.expect(bracketed ? TokenKind.LBracket : TokenKind.Lt, 'Expected [');
    const width = this.parseTypeWidthExpr();
    this.expect(bracketed ? TokenKind.RBracket : TokenKind.Gt, 'Expected ]');

    return {
      kind: 'PrimitiveType',
      name,
      width: width ?? undefined,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  /**
   * Parse expression for type width (e.g., bit<8>, int<N*2>)
   * Excludes comparison operators to avoid ambiguity with >
   */
  private parseTypeWidthExpr(): Expr | null {
    return this.parsePrecedenceExpr(Precedence.Comparison);
  }

  private parseTupleType(start: SourceLocation): TupleType | null {
    this.expect(TokenKind.LParen, 'Expected (');
    const elements: TypeExpr[] = [];

    if (!this.check(TokenKind.RParen)) {
      do {
        const elem = this.parseTypeExpr();
        if (elem) {
          elements.push(elem);
        }
      } while (this.match(TokenKind.Comma));
    }

    this.expect(TokenKind.RParen, 'Expected )');

    return {
      kind: 'TupleType',
      elements,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseUserOrGenericType(start: SourceLocation): UserType | GenericType | null {
    const path = this.parsePath();
    if (!path) {
      return null;
    }

    // Check for generic arguments
    if (this.check(TokenKind.LBracket)) {
      const args = this.parseGenericArgs();
      return {
        kind: 'GenericType',
        path,
        args,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    return {
      kind: 'UserType',
      path,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseGenericArgs(): GenericArg[] {
    const args: GenericArg[] = [];
    this.expect(TokenKind.LBracket, 'Expected [');

    if (!this.check(TokenKind.RBracket)) {
      do {
        const arg = this.parseGenericArg();
        if (arg) {
          args.push(arg);
        }
      } while (this.match(TokenKind.Comma));
    }

    this.expect(TokenKind.RBracket, 'Expected ]');
    return args;
  }

  private parseGenericArg(): GenericArg | null {
    const start = this.current().span.start;
    let name: Identifier | undefined;

    // Check for named argument
    if (this.check(TokenKind.Ident) && this.peek().kind === TokenKind.Colon) {
      const nameToken = this.advance();
      name = this.makeIdentifier(nameToken);
      this.advance(); // consume :
    }

    // A generic argument is an expression in the reference grammar
    // (`generic_arg = identifier ~ ":" ~ expr`), but a type is accepted here so
    // that generic type application keeps working. Both attempts are
    // speculative, so the one that fails leaves no diagnostic behind.
    const value = this.speculate(() => this.parseTypeExpr()) ?? this.parseExpr();
    if (!value) {
      return null;
    }

    return {
      kind: 'GenericArg',
      name,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Expressions (Pratt Parser)
  // ========================================

  private parseExpr(): Expr | null {
    return this.parsePrecedenceExpr(Precedence.None);
  }

  private parsePrecedenceExpr(minPrecedence: Precedence): Expr | null {
    let left = this.parseUnaryExpr();
    if (!left) {
      return null;
    }

    while (true) {
      const precedence = getBinaryPrecedence(this.current().kind);
      if (precedence <= minPrecedence) {
        break;
      }

      const opToken = this.advance();
      const op = tokenToBinaryOp(opToken.kind);
      if (!op) {
        break;
      }

      // Right-associative for power operator
      const nextPrecedence = op === '**' ? precedence - 1 : precedence;
      const right = this.parsePrecedenceExpr(nextPrecedence);
      if (!right) {
        return null;
      }

      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.makeSpan(left.span.start, right.span.end),
      };
    }

    return left;
  }

  private parseUnaryExpr(): Expr | null {
    const start = this.current().span.start;

    // Unary operators: ! ~ - & | ^
    if (this.check(TokenKind.Bang)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '!', operand, span: this.makeSpan(start, operand.span.end) };
    }
    if (this.check(TokenKind.Tilde)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '~', operand, span: this.makeSpan(start, operand.span.end) };
    }
    if (this.check(TokenKind.Minus)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '-', operand, span: this.makeSpan(start, operand.span.end) };
    }
    if (this.check(TokenKind.Amp)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '&', operand, span: this.makeSpan(start, operand.span.end) };
    }
    if (this.check(TokenKind.Pipe)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '|', operand, span: this.makeSpan(start, operand.span.end) };
    }
    if (this.check(TokenKind.Caret)) {
      this.advance();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return { kind: 'UnaryExpr', op: '^', operand, span: this.makeSpan(start, operand.span.end) };
    }

    return this.parsePostfixExpr();
  }

  private parsePostfixExpr(): Expr | null {
    let expr = this.parsePrimaryExpr();
    if (!expr) {
      return null;
    }

    while (true) {
      const start: SourceLocation = expr.span.start;

      // Function call: expr(args)
      if (this.match(TokenKind.LParen)) {
        const args = this.parseExprList();
        this.expect(TokenKind.RParen, 'Expected )');
        expr = {
          kind: 'CallExpr',
          callee: expr,
          args,
          span: this.makeSpan(start, this.previous().span.end),
        };
        continue;
      }

      // Index: expr[index] or expr[start:end]
      if (this.match(TokenKind.LBracket)) {
        const index = this.parseExpr();
        if (!index) return null;

        let rangeEnd: Expr | undefined;
        let partSelect: '+:' | '-:' | undefined;
        if (this.match(TokenKind.Colon)) {
          rangeEnd = this.parseExpr() ?? undefined;
        } else if (this.checkPartSelectOp()) {
          partSelect = this.current().text as '+:' | '-:';
          this.advance();
          rangeEnd = this.parseExpr() ?? undefined;
        }

        this.expect(TokenKind.RBracket, 'Expected ]');
        expr = {
          kind: 'IndexExpr',
          base: expr,
          index,
          rangeEnd,
          partSelect,
          span: this.makeSpan(start, this.previous().span.end),
        };
        continue;
      }

      // Field access: expr.field
      // But not for clock/reset specifiers like clk.posedge, rst.async
      if (this.check(TokenKind.Dot)) {
        const nextKind = this.peek().kind;
        if (nextKind === TokenKind.Posedge || nextKind === TokenKind.Negedge ||
            nextKind === TokenKind.Async || nextKind === TokenKind.Sync) {
          // This is a clock/reset specifier, don't treat as field access
          break;
        }
        this.advance(); // consume the dot
        const fieldToken = this.expect(TokenKind.Ident, 'Expected field name');
        if (!fieldToken) return null;
        expr = {
          kind: 'FieldExpr',
          base: expr,
          field: this.makeIdentifier(fieldToken),
          span: this.makeSpan(start, this.previous().span.end),
        };
        continue;
      }

      // Cast: expr as Type
      if (this.match(TokenKind.As)) {
        const targetType = this.parseTypeExpr();
        if (!targetType) return null;
        expr = {
          kind: 'CastExpr',
          expr,
          targetType,
          span: this.makeSpan(start, this.previous().span.end),
        };
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimaryExpr(): Expr | null {
    const start = this.current().span.start;

    // Literals
    if (this.check(TokenKind.IntLiteral) || this.check(TokenKind.StringLiteral) ||
        this.check(TokenKind.True) || this.check(TokenKind.False)) {
      const literal = this.parseLiteral();
      if (!literal) return null;
      return {
        kind: 'LiteralExpr',
        value: literal,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // Parenthesized expression or tuple
    if (this.match(TokenKind.LParen)) {
      const inner = this.parseExpr();
      if (!inner) return null;
      this.expect(TokenKind.RParen, 'Expected )');
      return {
        kind: 'ParenExpr',
        inner,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // Concatenation: { expr, expr, ... } or Repeat: { expr; count }
    if (this.match(TokenKind.LBrace)) {
      const first = this.parseExpr();
      if (!first) return null;

      // Repeat expression: { expr; count }
      if (this.match(TokenKind.Semicolon)) {
        const count = this.parseExpr();
        if (!count) return null;
        this.expect(TokenKind.RBrace, 'Expected }');
        return {
          kind: 'RepeatExpr',
          expr: first,
          count,
          span: this.makeSpan(start, this.previous().span.end),
        };
      }

      // Concatenation: { expr, expr, ... }
      const elements: Expr[] = [first];
      while (this.match(TokenKind.Comma)) {
        const elem = this.parseExpr();
        if (elem) {
          elements.push(elem);
        }
      }
      this.expect(TokenKind.RBrace, 'Expected }');
      return {
        kind: 'ConcatExpr',
        elements,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // If expression
    if (this.check(TokenKind.If)) {
      return this.parseIfExpr(start);
    }

    // Match expression
    if (this.check(TokenKind.Match)) {
      return this.parseMatchExpr(start);
    }

    // Identifier or path
    if (this.check(TokenKind.Ident)) {
      const path = this.parsePath();
      if (!path) return null;

      if (path.segments.length === 1) {
        return {
          kind: 'IdentExpr',
          name: path.segments[0]!,
          span: this.makeSpan(start, this.previous().span.end),
        };
      }
      return {
        kind: 'PathExpr',
        path,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    this.reportError('Expected expression');
    return null;
  }

  private parseIfExpr(start: SourceLocation): IfExpr | null {
    this.expect(TokenKind.If, 'Expected if');
    const condition = this.parseExpr();
    if (!condition) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const thenExpr = this.parseExpr();
    if (!thenExpr) return null;
    this.expect(TokenKind.RBrace, 'Expected }');

    this.expect(TokenKind.Else, 'Expected else');
    this.expect(TokenKind.LBrace, 'Expected {');
    const elseExpr = this.parseExpr();
    if (!elseExpr) return null;
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'IfExpr',
      condition,
      thenExpr,
      elseExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMatchExpr(start: SourceLocation): MatchExpr | null {
    this.expect(TokenKind.Match, 'Expected match');
    const scrutinee = this.parseExpr();
    if (!scrutinee) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const arms = this.parseMatchArms();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'MatchExpr',
      scrutinee,
      arms,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMatchArms(): MatchArm[] {
    const arms: MatchArm[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const before = this.pos;
      const arm = this.parseMatchArm();
      if (arm) {
        arms.push(arm);
      }
      // An arm that consumed nothing would spin here forever. This runs inside
      // an editor, so a hang is worse than a wrong parse: skip a token and let
      // the error surface.
      if (this.pos === before) {
        this.advance();
      }
    }
    return arms;
  }


  /**
   * Does the `{` at the cursor open a concatenation rather than a block?
   *
   * After `=>` both are possible:
   *
   *   2'd0 => { a[7:0], b[7:0] },     // concatenation
   *   2'd0 => { x = 1; }              // block
   *
   * They are told apart by what appears first at the top level of the braces:
   * a comma means a concatenation, a semicolon means a block.
   */
  private braceStartsConcat(): boolean {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const kind = this.tokens[i]!.kind;
      if (kind === TokenKind.LBrace || kind === TokenKind.LBracket || kind === TokenKind.LParen) {
        depth++;
        continue;
      }
      if (kind === TokenKind.RBrace || kind === TokenKind.RBracket || kind === TokenKind.RParen) {
        depth--;
        if (depth === 0) return false;
        continue;
      }
      if (depth === 1) {
        if (kind === TokenKind.Comma) return true;
        if (kind === TokenKind.Semicolon) return false;
      }
    }
    return false;
  }
  private parseMatchArm(): MatchArm | null {
    const start = this.current().span.start;
    const pattern = this.parsePattern();
    if (!pattern) return null;

    this.expect(TokenKind.FatArrow, 'Expected =>');

    // Arm body can be expression with comma, or block
    let body: Expr | BlockStmt;
    if (this.check(TokenKind.LBrace) && !this.braceStartsConcat()) {
      const blockStart = this.current().span.start;
      this.advance();
      const stmts = this.parseStatements();
      this.expect(TokenKind.RBrace, 'Expected }');
      body = {
        kind: 'BlockStmt',
        stmts,
        span: this.makeSpan(blockStart, this.previous().span.end),
      };
    } else {
      const expr = this.parseExpr();
      if (!expr) return null;
      body = expr;
      this.match(TokenKind.Comma);
    }

    return {
      kind: 'MatchArm',
      pattern,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseExprList(): Expr[] {
    const exprs: Expr[] = [];
    if (this.check(TokenKind.RParen)) {
      return exprs;
    }

    do {
      const expr = this.parseExpr();
      if (expr) {
        exprs.push(expr);
      }
    } while (this.match(TokenKind.Comma));

    return exprs;
  }

  // ========================================
  // Patterns
  // ========================================

  private parsePattern(): Pattern | null {
    const start = this.current().span.start;

    // Wildcard pattern: _
    if (this.match(TokenKind.Underscore)) {
      return { kind: 'WildcardPattern', span: this.makeSpan(start, this.previous().span.end) };
    }

    // Literal patterns
    if (this.check(TokenKind.IntLiteral) || this.check(TokenKind.True) || this.check(TokenKind.False)) {
      const literal = this.parseLiteral();
      if (!literal) return null;

      // Check for range pattern
      if (this.match(TokenKind.DotDot) || this.match(TokenKind.DotDotEq)) {
        const inclusive = this.previous().kind === TokenKind.DotDotEq;
        const endExpr = this.parseExpr();
        if (!endExpr) return null;

        const startExpr: Expr = {
          kind: 'LiteralExpr',
          value: literal,
          span: this.makeSpan(start, this.previous().span.end),
        };

        return {
          kind: 'RangePattern',
          start: startExpr,
          end: endExpr,
          inclusive,
          span: this.makeSpan(start, this.previous().span.end),
        };
      }

      return {
        kind: 'LiteralPattern',
        value: literal,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // Tuple pattern: (p1, p2, ...)
    if (this.match(TokenKind.LParen)) {
      const elements: Pattern[] = [];
      if (!this.check(TokenKind.RParen)) {
        do {
          const elem = this.parsePattern();
          if (elem) {
            elements.push(elem);
          }
        } while (this.match(TokenKind.Comma));
      }
      this.expect(TokenKind.RParen, 'Expected )');
      return {
        kind: 'TuplePattern',
        elements,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // Identifier or path pattern
    if (this.check(TokenKind.Ident)) {
      const path = this.parsePath();
      if (!path) return null;

      // Check for struct pattern
      if (this.check(TokenKind.LBrace)) {
        return this.parseStructPattern(start, path);
      }

      if (path.segments.length === 1) {
        return {
          kind: 'IdentPattern',
          name: path.segments[0]!,
          span: this.makeSpan(start, this.previous().span.end),
        };
      }

      return {
        kind: 'PathPattern',
        path,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    this.reportError('Expected pattern');
    return null;
  }

  private parseStructPattern(start: SourceLocation, path: Path): Pattern {
    this.expect(TokenKind.LBrace, 'Expected {');
    const fields: { kind: 'FieldPattern'; name: Identifier; pattern?: Pattern; span: SourceSpan }[] = [];

    if (!this.check(TokenKind.RBrace)) {
      do {
        const fieldStart = this.current().span.start;
        const nameToken = this.expect(TokenKind.Ident, 'Expected field name');
        if (!nameToken) break;
        const name = this.makeIdentifier(nameToken);

        let pattern: Pattern | undefined;
        if (this.match(TokenKind.Colon)) {
          pattern = this.parsePattern() ?? undefined;
        }

        const fieldSpan = this.makeSpan(fieldStart, this.previous().span.end);
        if (pattern !== undefined) {
          fields.push({
            kind: 'FieldPattern',
            name,
            pattern,
            span: fieldSpan,
          });
        } else {
          fields.push({
            kind: 'FieldPattern',
            name,
            span: fieldSpan,
          });
        }
      } while (this.match(TokenKind.Comma));
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'StructPattern',
      path,
      fields,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Statements
  // ========================================

  private parseStatements(): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const stmt = this.parseStatement();
      if (stmt) {
        stmts.push(stmt);
      }
      this.ensureProgress(mark);
    }
    return stmts;
  }

  /**
   * A parse that consumes nothing leaves the enclosing loop where it started,
   * and the parser spins. This runs inside an editor, so a spin freezes the
   * window on a file that is merely half-typed. Report once and step over the
   * token instead.
   */
  /** Whether a part-select operator sits at the cursor. */
  private checkPartSelectOp(): boolean {
    return (
      this.check(TokenKind.PlusColon) || this.check(TokenKind.MinusColon)
    );
  }

  private ensureProgress(mark: number): void {
    if (this.pos !== mark || this.isEof()) {
      return;
    }
    this.reportError(`Unexpected token: ${this.current().text}`);
    this.advance();
  }

  private parseStatement(): Stmt | null {
    const start = this.current().span.start;

    if (this.check(TokenKind.Let)) {
      return this.parseLetDecl(start);
    }
    if (this.check(TokenKind.Var)) {
      return this.parseVarDecl(start);
    }
    if (this.check(TokenKind.If)) {
      return this.parseIfStmt(start);
    }
    if (this.check(TokenKind.Match)) {
      return this.parseMatchStmt(start);
    }
    if (this.check(TokenKind.For)) {
      return this.parseForStmt(start);
    }
    if (this.check(TokenKind.While)) {
      return this.parseWhileStmt(start);
    }
    if (this.check(TokenKind.Return)) {
      return this.parseReturnStmt(start);
    }
    if (this.check(TokenKind.LBrace)) {
      return this.parseBlockStmt(start);
    }
    // A check may stand wherever a statement does: inside sync, initial and
    // seq blocks as well as directly in a test module.
    if (this.check(TokenKind.Assert)) {
      return this.parseAssertStmt(start);
    }

    // Assignment or expression statement
    return this.parseAssignOrExprStmt(start);
  }

  private parseLetDecl(start: SourceLocation): LetDecl | null {
    this.expect(TokenKind.Let, 'Expected let');
    const mutable = this.match(TokenKind.Mut);

    const nameToken = this.expect(TokenKind.Ident, 'Expected variable name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let typeExpr: TypeExpr | undefined;
    if (this.match(TokenKind.Colon)) {
      typeExpr = this.parseTypeExpr() ?? undefined;
    }

    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseExpr() ?? undefined;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'LetDecl',
      mutable,
      name,
      typeExpr,
      init,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseVarDecl(start: SourceLocation): VarDecl | null {
    this.expect(TokenKind.Var, 'Expected var');

    const nameToken = this.expect(TokenKind.Ident, 'Expected variable name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let typeExpr: TypeExpr | undefined;
    if (this.match(TokenKind.Colon)) {
      typeExpr = this.parseTypeExpr() ?? undefined;
    }

    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseExpr() ?? undefined;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'VarDecl',
      name,
      typeExpr,
      init,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseIfStmt(start: SourceLocation): IfStmt | null {
    this.expect(TokenKind.If, 'Expected if');
    const condition = this.parseExpr();
    if (!condition) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const thenBlock = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    let elseBlock: Stmt[] | IfStmt | undefined;
    if (this.match(TokenKind.Else)) {
      if (this.check(TokenKind.If)) {
        elseBlock = this.parseIfStmt(this.current().span.start) ?? undefined;
      } else {
        this.expect(TokenKind.LBrace, 'Expected {');
        elseBlock = this.parseStatements();
        this.expect(TokenKind.RBrace, 'Expected }');
      }
    }

    return {
      kind: 'IfStmt',
      condition,
      thenBlock,
      elseBlock,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMatchStmt(start: SourceLocation): MatchStmt | null {
    this.expect(TokenKind.Match, 'Expected match');
    const scrutinee = this.parseExpr();
    if (!scrutinee) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const arms = this.parseMatchArms();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'MatchStmt',
      scrutinee,
      arms,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseForStmt(start: SourceLocation): ForStmt | null {
    this.expect(TokenKind.For, 'Expected for');

    const varToken = this.expect(TokenKind.Ident, 'Expected variable name');
    if (!varToken) return null;
    const variable = this.makeIdentifier(varToken);

    this.expect(TokenKind.In, 'Expected in');
    const range = this.parseRangeExpr();
    if (!range) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const body = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'ForStmt',
      variable,
      range,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseRangeExpr(): RangeExpr | null {
    const start = this.current().span.start;
    const startExpr = this.parseExpr();
    if (!startExpr) return null;

    let inclusive = false;
    if (this.match(TokenKind.DotDotEq)) {
      inclusive = true;
    } else if (!this.match(TokenKind.DotDot)) {
      this.reportError('Expected .. or ..=');
      return null;
    }

    const endExpr = this.parseExpr();
    if (!endExpr) return null;

    return {
      kind: 'RangeExpr',
      start: startExpr,
      end: endExpr,
      inclusive,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseWhileStmt(start: SourceLocation): WhileStmt | null {
    this.expect(TokenKind.While, 'Expected while');
    const condition = this.parseExpr();
    if (!condition) return null;

    this.expect(TokenKind.LBrace, 'Expected {');
    const body = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'WhileStmt',
      condition,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseReturnStmt(start: SourceLocation): ReturnStmt | null {
    this.expect(TokenKind.Return, 'Expected return');

    let value: Expr | undefined;
    if (!this.check(TokenKind.Semicolon)) {
      value = this.parseExpr() ?? undefined;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ReturnStmt',
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseBlockStmt(start: SourceLocation): BlockStmt | null {
    this.expect(TokenKind.LBrace, 'Expected {');
    const stmts = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'BlockStmt',
      stmts,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseAssignOrExprStmt(start: SourceLocation): Stmt | null {
    const expr = this.parseExpr();
    if (!expr) return null;

    // Check for assignment
    if (this.match(TokenKind.Eq)) {
      const lvalue = this.exprToLValue(expr);
      if (!lvalue) {
        this.reportError('Invalid left-hand side of assignment');
        return null;
      }

      const value = this.parseExpr();
      if (!value) return null;

      this.expect(TokenKind.Semicolon, 'Expected ;');

      return {
        kind: 'AssignStmt',
        lvalue,
        value,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ExprStmt',
      expr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private exprToLValue(expr: Expr): LValue | null {
    switch (expr.kind) {
      case 'IdentExpr':
        return { kind: 'IdentLValue', name: expr.name };
      case 'IndexExpr':
        const base = this.exprToLValue(expr.base);
        if (!base) return null;
        return { kind: 'IndexLValue', base, index: expr.index };
      case 'FieldExpr':
        const fieldBase = this.exprToLValue(expr.base);
        if (!fieldBase) return null;
        return { kind: 'FieldLValue', base: fieldBase, field: expr.field };
      case 'ConcatExpr':
        const elements: LValue[] = [];
        for (const elem of expr.elements) {
          const lv = this.exprToLValue(elem);
          if (!lv) return null;
          elements.push(lv);
        }
        return { kind: 'ConcatLValue', elements };
      default:
        return null;
    }
  }

  // ========================================
  // Logic Blocks
  // ========================================

  private parseCombBlock(start: SourceLocation): CombBlock | null {
    this.expect(TokenKind.Comb, 'Expected comb');
    this.expect(TokenKind.LBrace, 'Expected {');
    const stmts = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'CombBlock',
      stmts,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseSyncBlock(start: SourceLocation): SyncBlock | null {
    this.expect(TokenKind.Sync, 'Expected sync');
    this.expect(TokenKind.LParen, 'Expected (');

    const clock = this.parseClockSpec();
    if (!clock) return null;

    let reset: ResetSpec | undefined;
    if (this.match(TokenKind.Comma)) {
      reset = this.parseResetSpec() ?? undefined;
    }

    this.expect(TokenKind.RParen, 'Expected )');
    this.expect(TokenKind.LBrace, 'Expected {');
    const stmts = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'SyncBlock',
      clock,
      reset,
      stmts,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseClockSpec(): ClockSpec | null {
    const start = this.current().span.start;
    const signal = this.parseExpr();
    if (!signal) return null;

    this.expect(TokenKind.Dot, 'Expected .');

    let edge: 'posedge' | 'negedge';
    if (this.match(TokenKind.Posedge)) {
      edge = 'posedge';
    } else if (this.match(TokenKind.Negedge)) {
      edge = 'negedge';
    } else {
      this.reportError('Expected posedge or negedge');
      return null;
    }

    return {
      kind: 'ClockSpec',
      signal,
      edge,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseResetSpec(): ResetSpec | null {
    const start = this.current().span.start;
    const signal = this.parseExpr();
    if (!signal) return null;

    this.expect(TokenKind.Dot, 'Expected .');

    let mode: 'async' | 'sync';
    if (this.match(TokenKind.Async)) {
      mode = 'async';
    } else if (this.match(TokenKind.Sync)) {
      mode = 'sync';
    } else {
      this.reportError('Expected async or sync');
      return null;
    }

    return {
      kind: 'ResetSpec',
      signal,
      mode,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Instance Declaration
  // ========================================

  private parseInstDecl(start: SourceLocation): InstDecl | null {
    // Current syntax: `inst name = Module { port: expr, ... };`
    // Older syntax:   `name: Module(port: expr, ...);`
    const isCurrent = this.check(TokenKind.Ident) && this.current().text === 'inst';
    if (isCurrent) {
      this.advance();
    }

    const nameToken = this.expect(TokenKind.Ident, 'Expected instance name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(isCurrent ? TokenKind.Eq : TokenKind.Colon, isCurrent ? 'Expected =' : 'Expected :');

    const modulePath = this.parsePath();
    if (!modulePath) return null;

    let genericArgs: GenericArg[] | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericArgs = this.parseGenericArgs();
    }

    this.expect(isCurrent ? TokenKind.LBrace : TokenKind.LParen, 'Expected {');
    const connections = this.parseConnections();
    this.expect(isCurrent ? TokenKind.RBrace : TokenKind.RParen, 'Expected }');
    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'InstDecl',
      name,
      modulePath,
      genericArgs,
      connections,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseConnections(): Connection[] {
    const connections: Connection[] = [];
    if (this.check(TokenKind.RParen) || this.check(TokenKind.RBrace)) {
      return connections;
    }

    do {
      // A trailing comma before the closing brace or paren is allowed
      if (this.check(TokenKind.RParen) || this.check(TokenKind.RBrace)) break;
      const conn = this.parseConnection();
      if (conn) {
        connections.push(conn);
      }
    } while (this.match(TokenKind.Comma));

    return connections;
  }

  private parseConnection(): Connection | null {
    const start = this.current().span.start;

    // Current syntax: `port: expr`
    // Older syntax:   `.port(expr)`
    const isOld = this.match(TokenKind.Dot);

    const portToken = this.expect(TokenKind.Ident, 'Expected port name');
    if (!portToken) return null;
    const port = this.makeIdentifier(portToken);

    if (isOld) {
      this.expect(TokenKind.LParen, 'Expected (');
    } else {
      this.expect(TokenKind.Colon, 'Expected :');
    }
    const expr = this.parseExpr();
    if (!expr) return null;
    if (isOld) {
      this.expect(TokenKind.RParen, 'Expected )');
    }

    return {
      kind: 'Connection',
      port,
      expr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Memory Declaration
  // ========================================

  private parseMemDecl(start: SourceLocation): MemDecl | null {
    this.expect(TokenKind.Mem, 'Expected mem');

    const nameToken = this.expect(TokenKind.Ident, 'Expected memory name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');

    // Parse mem_type: element_type[depth]
    const elementType = this.parseTypeExpr();
    if (!elementType) return null;

    // The array type already handles [depth], but mem_type expects element_type[depth]
    // So we need to verify it's an array type
    if (elementType.kind !== 'ArrayType') {
      this.reportError('Memory type must be element_type[depth]');
      return null;
    }

    const depth = elementType.size;
    const actualElementType = elementType.elementType;

    // Parse optional mem_config
    let config: MemConfig | undefined;
    if (this.check(TokenKind.LBrace) && !this.isFollowedByEquals()) {
      config = this.parseMemConfig() ?? undefined;
    }

    // Parse optional initializer
    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseMemInitializer() ?? undefined;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'MemDecl',
      name,
      elementType: actualElementType,
      depth,
      config,
      init,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private isFollowedByEquals(): boolean {
    // Check if the brace is followed by an equals sign (initializer) or config
    // mem x: T[N] { ... } vs mem x: T[N] = { ... }
    // This is a heuristic to distinguish config from initializer
    return false; // Config uses { key: value } format, not simple brace
  }

  private parseMemConfig(): MemConfig | null {
    const start = this.current().span.start;
    this.expect(TokenKind.LBrace, 'Expected {');

    const items: MemConfigItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const item = this.parseMemConfigItem();
      if (item) {
        items.push(item);
      }
      this.match(TokenKind.Comma);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'MemConfig',
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMemConfigItem(): MemConfigItem | null {
    const start = this.current().span.start;

    // config_key: ports | type | read_mode | write_mode | init_file
    const keyToken = this.expect(TokenKind.Ident, 'Expected config key');
    if (!keyToken) return null;
    const key = keyToken.text;

    this.expect(TokenKind.Colon, 'Expected :');

    // config_value: literal | identifier
    let value: Literal | Identifier;
    if (this.check(TokenKind.IntLiteral) || this.check(TokenKind.StringLiteral) ||
        this.check(TokenKind.True) || this.check(TokenKind.False)) {
      const literal = this.parseLiteral();
      if (!literal) return null;
      value = literal;
    } else if (this.check(TokenKind.Ident)) {
      const identToken = this.advance();
      value = this.makeIdentifier(identToken);
    } else {
      this.reportError('Expected literal or identifier');
      return null;
    }

    return {
      kind: 'MemConfigItem',
      key,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMemInitializer(): Expr | null {
    // initializer = "{" [ init_item { "," init_item } ] "}" | string_literal
    if (this.check(TokenKind.StringLiteral)) {
      const token = this.advance();
      return {
        kind: 'LiteralExpr',
        value: { kind: 'String', value: token.text.slice(1, -1) },
        span: token.span,
      };
    }

    // Array initializer
    if (this.check(TokenKind.LBrace)) {
      return this.parseConcatOrInitExpr();
    }

    this.reportError('Expected initializer');
    return null;
  }

  private parseConcatOrInitExpr(): Expr | null {
    const start = this.current().span.start;
    this.expect(TokenKind.LBrace, 'Expected {');

    if (this.check(TokenKind.RBrace)) {
      // Empty initializer
      this.advance();
      return {
        kind: 'ConcatExpr',
        elements: [],
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    const elements: Expr[] = [];
    do {
      if (this.check(TokenKind.LBrace)) {
        // Nested initializer
        const nested = this.parseConcatOrInitExpr();
        if (nested) elements.push(nested);
      } else {
        const expr = this.parseExpr();
        if (expr) elements.push(expr);
      }
    } while (this.match(TokenKind.Comma) && !this.check(TokenKind.RBrace));

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'ConcatExpr',
      elements,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // FSM Block
  // ========================================

  private parseFsmBlock(start: SourceLocation): FsmBlock | null {
    this.expect(TokenKind.Fsm, 'Expected fsm');

    const nameToken = this.expect(TokenKind.Ident, 'Expected FSM name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LParen, 'Expected (');

    const clock = this.parseClockSpec();
    if (!clock) return null;

    let reset: ResetSpec | undefined;
    if (this.match(TokenKind.Comma)) {
      reset = this.parseResetSpec() ?? undefined;
    }

    this.expect(TokenKind.RParen, 'Expected )');
    this.expect(TokenKind.LBrace, 'Expected {');

    // Parse state_enum
    const stateEnum = this.parseStateEnum();
    if (!stateEnum) return null;

    // Optional `initial: StateName`
    let initialState: Identifier | undefined;
    if (this.check(TokenKind.Initial)) {
      this.advance();
      this.expect(TokenKind.Colon, 'Expected : after initial');
      const stateToken = this.expect(TokenKind.Ident, 'Expected initial state name');
      if (stateToken) initialState = this.makeIdentifier(stateToken);
    }

    // Signals declared inside the machine, before `transitions`
    const signals: ModItem[] = [];
    while (this.check(TokenKind.Let) || this.check(TokenKind.Var)) {
      const mark = this.pos;
      const decl = this.parseModItem();
      if (decl) signals.push(decl);
      this.ensureProgress(mark);
    }

    // Parse transitions_block
    const transitions = this.parseTransitionsBlock();
    if (!transitions) return null;

    // Parse optional output_blocks, and the encoding clause that shares their
    // keyword: `output encoding: onehot` against `output y { ... }`.
    const outputs: OutputBlock[] = [];
    let encoding: 'binary' | 'onehot' | 'gray' | undefined;
    while (this.check(TokenKind.Output)) {
      const mark = this.pos;
      if (this.peek().kind === TokenKind.Ident && this.peek().text === 'encoding') {
        this.advance();  // output
        this.advance();  // encoding
        this.expect(TokenKind.Colon, 'Expected : after encoding');
        const nameToken = this.expect(TokenKind.Ident, 'Expected binary, onehot or gray');
        const name = nameToken?.text;
        if (name === 'binary' || name === 'onehot' || name === 'gray') {
          encoding = name;
        }
        this.ensureProgress(mark);
        continue;
      }
      const output = this.parseOutputBlock();
      if (output) outputs.push(output);
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'FsmBlock',
      name,
      clock,
      reset,
      stateEnum,
      initialState,
      signals,
      transitions,
      outputs,
      encoding,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseStateEnum(): StateEnum | null {
    const start = this.current().span.start;
    this.expect(TokenKind.State, 'Expected state');
    this.expect(TokenKind.Enum, 'Expected enum');
    this.expect(TokenKind.LBrace, 'Expected {');

    const states: StateItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const state = this.parseStateItem();
      if (state) states.push(state);
      this.match(TokenKind.Comma);
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'StateEnum',
      states,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseStateItem(): StateItem | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected state name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    // Optional moore outputs: [output = value, ...]
    let mooreOutputs: OutputAssign[] | undefined;
    if (this.match(TokenKind.LBracket)) {
      mooreOutputs = this.parseMooreOutputs();
      this.expect(TokenKind.RBracket, 'Expected ]');
    }

    return {
      kind: 'StateItem',
      name,
      mooreOutputs,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseMooreOutputs(): OutputAssign[] {
    const outputs: OutputAssign[] = [];
    if (this.check(TokenKind.RBracket)) {
      return outputs;
    }

    do {
      const output = this.parseOutputAssign();
      if (output) outputs.push(output);
    } while (this.match(TokenKind.Comma));

    return outputs;
  }

  private parseOutputAssign(): OutputAssign | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected output name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Eq, 'Expected =');
    const value = this.parseExpr();
    if (!value) return null;

    return {
      kind: 'OutputAssign',
      name,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseTransitionsBlock(): TransitionsBlock | null {
    const start = this.current().span.start;
    this.expect(TokenKind.Transitions, 'Expected transitions');
    this.expect(TokenKind.LBrace, 'Expected {');

    const items: TransitionItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const item = this.parseTransitionItem();
      if (item) items.push(item);
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'TransitionsBlock',
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseTransitionItem(): TransitionItem | null {
    const start = this.current().span.start;

    // Parse state name or wildcard
    let fromState: Identifier | '_';
    if (this.match(TokenKind.Underscore)) {
      fromState = '_';
    } else {
      const stateToken = this.expect(TokenKind.Ident, 'Expected state name or _');
      if (!stateToken) return null;
      fromState = this.makeIdentifier(stateToken);
    }

    this.expect(TokenKind.FatArrow, 'Expected =>');
    this.expect(TokenKind.LBrace, 'Expected {');

    // Parse when clauses or statements
    const whenClauses: WhenClause[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      if (this.check(TokenKind.When)) {
        const clause = this.parseWhenClause();
        if (clause) whenClauses.push(clause);
      } else {
        // For wildcard transitions, parse statements directly
        const stmt = this.parseStatement();
        if (stmt && fromState === '_') {
          // Wrap statement in a when clause with true condition
          whenClauses.push({
            kind: 'WhenClause',
            condition: {
              kind: 'LiteralExpr',
              value: { kind: 'Bool', value: true },
              span: stmt.span,
            },
            actions: [{ kind: 'Stmt', stmt }],
            span: stmt.span,
          });
        }
      }
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'TransitionItem',
      fromState,
      whenClauses,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseWhenClause(): WhenClause | null {
    const start = this.current().span.start;
    this.expect(TokenKind.When, 'Expected when');

    const condition = this.parseExpr();
    if (!condition) return null;

    this.expect(TokenKind.LBrace, 'Expected {');

    const actions: TransitionAction[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const action = this.parseTransitionAction();
      if (action) actions.push(action);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'WhenClause',
      condition,
      actions,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseTransitionAction(): TransitionAction | null {
    // goto identifier ;
    if (this.match(TokenKind.Goto)) {
      const targetToken = this.expect(TokenKind.Ident, 'Expected state name');
      if (!targetToken) return null;
      const target = this.makeIdentifier(targetToken);
      this.expect(TokenKind.Semicolon, 'Expected ;');
      return { kind: 'Goto', target };
    }

    // Regular statement
    const stmt = this.parseStatement();
    if (!stmt) return null;
    return { kind: 'Stmt', stmt };
  }

  private parseOutputBlock(): OutputBlock | null {
    const start = this.current().span.start;
    this.expect(TokenKind.Output, 'Expected output');

    const nameToken = this.expect(TokenKind.Ident, 'Expected output name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LBrace, 'Expected {');

    const cases: OutputCase[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const outputCase = this.parseOutputCase();
      if (outputCase) cases.push(outputCase);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'OutputBlock',
      name,
      cases,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseOutputCase(): OutputCase | null {
    const start = this.current().span.start;
    const stateToken = this.expect(TokenKind.Ident, 'Expected state name');
    if (!stateToken) return null;
    const state = this.makeIdentifier(stateToken);

    this.expect(TokenKind.FatArrow, 'Expected =>');
    const value = this.parseExpr();
    if (!value) return null;
    this.expect(TokenKind.Comma, 'Expected ,');

    return {
      kind: 'OutputCase',
      state,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Function Definition
  // ========================================

  private parseFnDef(start: SourceLocation, visibility: Visibility): FnDef | null {
    this.expect(TokenKind.Fn, 'Expected fn');

    const nameToken = this.expect(TokenKind.Ident, 'Expected function name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    this.expect(TokenKind.LParen, 'Expected (');
    const params = this.parseFnParams();
    this.expect(TokenKind.RParen, 'Expected )');

    let returnType: TypeExpr | undefined;
    if (this.match(TokenKind.Arrow)) {
      returnType = this.parseTypeExpr() ?? undefined;
    }

    this.expect(TokenKind.LBrace, 'Expected {');
    const body = this.parseStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'FnDef',
      visibility,
      name,
      genericParams,
      params,
      returnType,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseFnParams(): FnParam[] {
    const params: FnParam[] = [];
    if (this.check(TokenKind.RParen)) {
      return params;
    }

    do {
      const param = this.parseFnParam();
      if (param) {
        params.push(param);
      }
    } while (this.match(TokenKind.Comma));

    return params;
  }

  private parseFnParam(): FnParam | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected parameter name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    return {
      kind: 'FnParam',
      name,
      typeExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Type Definitions
  // ========================================

  /** `union U { a: bit[8], b: bit[8], }` — the same body as a struct. */
  private parseUnionDef(start: SourceLocation, visibility: Visibility): UnionDef | null {
    this.expect(TokenKind.Union, 'Expected union');

    const nameToken = this.expect(TokenKind.Ident, 'Expected union name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LBrace, 'Expected {');
    const fields = this.parseStructFields();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'UnionDef',
      visibility,
      name,
      fields,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  /** `extern mod Name(ports);` — ports but no body. */
  private parseExternModDef(start: SourceLocation, visibility: Visibility): ExternModDef | null {
    this.expect(TokenKind.Extern, 'Expected extern');
    this.expect(TokenKind.Mod, 'Expected mod');

    const nameToken = this.expect(TokenKind.Ident, 'Expected module name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    this.expect(TokenKind.LParen, 'Expected (');
    const ports = this.parsePortList();
    this.expect(TokenKind.RParen, 'Expected )');
    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ExternModDef',
      visibility,
      name,
      genericParams,
      ports,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseStructDef(start: SourceLocation, visibility: Visibility): StructDef | null {
    this.expect(TokenKind.Struct, 'Expected struct');

    const nameToken = this.expect(TokenKind.Ident, 'Expected struct name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    this.expect(TokenKind.LBrace, 'Expected {');
    const fields = this.parseStructFields();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'StructDef',
      visibility,
      name,
      genericParams,
      fields,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseStructFields(): StructField[] {
    const fields: StructField[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const field = this.parseStructField();
      if (field) {
        fields.push(field);
      }
      this.match(TokenKind.Comma);
    }
    return fields;
  }

  private parseStructField(): StructField | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected field name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    return {
      kind: 'StructField',
      name,
      typeExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseEnumDef(start: SourceLocation, visibility: Visibility): EnumDef | null {
    this.expect(TokenKind.Enum, 'Expected enum');

    const nameToken = this.expect(TokenKind.Ident, 'Expected enum name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    this.expect(TokenKind.LBrace, 'Expected {');
    const variants = this.parseEnumVariants();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'EnumDef',
      visibility,
      name,
      genericParams,
      variants,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseEnumVariants(): EnumVariant[] {
    const variants: EnumVariant[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const variant = this.parseEnumVariant();
      if (variant) {
        variants.push(variant);
      }
      this.match(TokenKind.Comma);
    }
    return variants;
  }

  private parseEnumVariant(): EnumVariant | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected variant name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let value: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      value = this.parseExpr() ?? undefined;
    }

    return {
      kind: 'EnumVariant',
      name,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseTypeAlias(start: SourceLocation, visibility: Visibility): TypeAlias | null {
    this.expect(TokenKind.Type, 'Expected type');

    const nameToken = this.expect(TokenKind.Ident, 'Expected type name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    this.expect(TokenKind.Eq, 'Expected =');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'TypeAlias',
      visibility,
      name,
      genericParams,
      typeExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseConstDef(start: SourceLocation, visibility: Visibility): ConstDef | null {
    this.expect(TokenKind.Const, 'Expected const');

    const nameToken = this.expect(TokenKind.Ident, 'Expected constant name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    this.expect(TokenKind.Eq, 'Expected =');
    const init = this.parseExpr();
    if (!init) return null;

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ConstDef',
      visibility,
      name,
      typeExpr,
      init,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseConstDecl(start: SourceLocation, visibility: Visibility): ConstDecl | null {
    this.expect(TokenKind.Const, 'Expected const');

    const nameToken = this.expect(TokenKind.Ident, 'Expected constant name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    this.expect(TokenKind.Eq, 'Expected =');
    const init = this.parseExpr();
    if (!init) return null;

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ConstDecl',
      visibility,
      name,
      typeExpr,
      init,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Interface Definition
  // ========================================

  private parseInterfaceDef(start: SourceLocation, visibility: Visibility): InterfaceDef | null {
    this.expect(TokenKind.Interface, 'Expected interface');

    const nameToken = this.expect(TokenKind.Ident, 'Expected interface name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let genericParams: GenericParams | undefined;
    if (this.check(TokenKind.LBracket)) {
      genericParams = this.parseGenericParams() ?? undefined;
    }

    // interface_decl = ... ("extends" ~ identifier)? ~ "{" ~ interface_body ~ "}"
    let extendsName: Identifier | undefined;
    if (this.check(TokenKind.Ident) && this.current().text === 'extends') {
      this.advance();
      const baseToken = this.expect(TokenKind.Ident, 'Expected interface name after extends');
      if (baseToken) extendsName = this.makeIdentifier(baseToken);
    }

    this.expect(TokenKind.LBrace, 'Expected {');

    const signals: InterfaceSignal[] = [];
    const views: ViewDef[] = [];

    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      if (this.check(TokenKind.View)) {
        const view = this.parseViewDef();
        if (view) views.push(view);
      } else {
        const signal = this.parseInterfaceSignal();
        if (signal) signals.push(signal);
      }
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'InterfaceDef',
      visibility,
      name,
      genericParams,
      extends: extendsName,
      signals,
      views,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseInterfaceSignal(): InterfaceSignal | null {
    const start = this.current().span.start;
    const isLogic = this.match(TokenKind.Logic);

    const nameToken = this.expect(TokenKind.Ident, 'Expected signal name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');
    const typeExpr = this.parseTypeExpr();
    if (!typeExpr) return null;

    // interface_signal = identifier ~ ":" ~ type_expr ~ ","?
    // Demanding a semicolon left the comma unconsumed, and the next round of
    // the loop could not start on it, so the parser spun until it ran out of
    // memory. A semicolon is accepted too rather than made an error.
    if (!this.match(TokenKind.Comma)) {
      this.match(TokenKind.Semicolon);
    }

    return {
      kind: 'InterfaceSignal',
      isLogic,
      name,
      typeExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseViewDef(): ViewDef | null {
    const start = this.current().span.start;
    this.expect(TokenKind.View, 'Expected view');

    // view_name = "initiator" | "target" | "monitor" | identifier
    // The three standard names are keywords in this lexer, so asking for an
    // identifier rejected every view the specification actually shows.
    let nameToken;
    if (
      this.check(TokenKind.Initiator) ||
      this.check(TokenKind.Target) ||
      this.check(TokenKind.Monitor)
    ) {
      nameToken = this.advance();
    } else {
      nameToken = this.expect(TokenKind.Ident, 'Expected view name');
    }
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LBrace, 'Expected {');
    const signals = this.parseViewSignals();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'ViewDef',
      name,
      signals,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseViewSignals(): ViewSignal[] {
    const signals: ViewSignal[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      signals.push(...this.parseViewDirectionList());
      this.ensureProgress(mark);
    }
    return signals;
  }

  /**
   * One direction and the signals that take it.
   *
   * `direction_list = view_direction ~ ":" ~ signal_list`, and
   * `signal_list = identifier ~ ("," ~ identifier)* ~ ","?`. This was read as
   * `in name;`, one signal per line with a semicolon, which matches nothing the
   * language accepts.
   */
  private parseViewDirectionList(): ViewSignal[] {
    const start = this.current().span.start;

    let direction: 'in' | 'out' | 'inout';
    if (this.match(TokenKind.In)) {
      direction = 'in';
    } else if (this.match(TokenKind.Out)) {
      direction = 'out';
    } else if (this.match(TokenKind.Inout)) {
      direction = 'inout';
    } else {
      this.reportError('Expected in, out, or inout');
      return [];
    }

    this.expect(TokenKind.Colon, 'Expected :');

    const signals: ViewSignal[] = [];
    do {
      // A trailing comma ends the list. What follows is either the closing
      // brace or the next direction, and neither is a signal name.
      if (
        this.check(TokenKind.RBrace) ||
        this.check(TokenKind.In) ||
        this.check(TokenKind.Out) ||
        this.check(TokenKind.Inout)
      ) {
        break;
      }
      const nameToken = this.expect(TokenKind.Ident, 'Expected signal name');
      if (!nameToken) break;
      signals.push({
        kind: 'ViewSignal',
        direction,
        name: this.makeIdentifier(nameToken),
        span: this.makeSpan(start, this.previous().span.end),
      });
    } while (this.match(TokenKind.Comma));

    return signals;
  }

  // ========================================
  // Import Declaration
  // ========================================

  private parseImportDecl(start: SourceLocation): ImportDecl | null {
    this.expect(TokenKind.Import, 'Expected import');

    const importPath = this.parseImportPath();
    if (!importPath) return null;

    let alias: Identifier | undefined;
    if (this.match(TokenKind.As)) {
      const aliasToken = this.expect(TokenKind.Ident, 'Expected alias name');
      if (aliasToken) {
        alias = this.makeIdentifier(aliasToken);
      }
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'ImportDecl',
      path: importPath,
      alias,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseImportPath(): ImportPath | null {
    const path = this.parsePath();
    if (!path) return null;

    // Check for glob import: path::*
    if (this.match(TokenKind.ColonColon)) {
      if (this.match(TokenKind.Star)) {
        return { kind: 'Glob', path };
      }

      // Check for list import: path::{a, b, c}
      if (this.match(TokenKind.LBrace)) {
        const items = this.parseImportItems();
        this.expect(TokenKind.RBrace, 'Expected }');
        return { kind: 'List', path, items };
      }
    }

    return { kind: 'Simple', path };
  }

  private parseImportItems(): ImportItem[] {
    const items: ImportItem[] = [];
    if (this.check(TokenKind.RBrace)) {
      return items;
    }

    do {
      const item = this.parseImportItem();
      if (item) {
        items.push(item);
      }
    } while (this.match(TokenKind.Comma));

    return items;
  }

  private parseImportItem(): ImportItem | null {
    const start = this.current().span.start;
    const nameToken = this.expect(TokenKind.Ident, 'Expected import name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    let alias: Identifier | undefined;
    if (this.match(TokenKind.As)) {
      const aliasToken = this.expect(TokenKind.Ident, 'Expected alias name');
      if (aliasToken) {
        alias = this.makeIdentifier(aliasToken);
      }
    }

    return {
      kind: 'ImportItem',
      name,
      alias,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Package Declaration
  // ========================================

  private parsePackageDecl(start: SourceLocation): PackageDecl | null {
    this.expect(TokenKind.Package, 'Expected package');

    const path = this.parsePath();
    if (!path) return null;

    this.expect(TokenKind.Semicolon, 'Expected ;');

    // Parse package items
    const items: Item[] = [];
    while (!this.isEof()) {
      // Check if we've reached another top-level package declaration
      if (this.check(TokenKind.Package)) {
        break;
      }

      const item = this.parsePackageItem();
      if (item) {
        items.push(item);
      } else {
        // Skip invalid tokens
        if (!this.isEof() && !this.check(TokenKind.Package)) {
          this.advance();
        }
      }
    }

    return {
      kind: 'PackageDecl',
      path,
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parsePackageItem(): Item | null {
    // Skip invalid tokens
    while (!this.isEof() && this.current().kind === TokenKind.Invalid) {
      this.advance();
    }

    if (this.isEof() || this.check(TokenKind.Package)) {
      return null;
    }

    const start = this.current().span.start;

    // Parse attributes
    const attributes = this.parseAttributes();

    // Parse visibility
    const visibility = this.parseVisibility();

    // Parse item based on keyword (package_item allows subset of items)
    if (this.check(TokenKind.Mod)) {
      return this.parseModDef(start, visibility, attributes);
    }
    if (this.check(TokenKind.Fn)) {
      return this.parseFnDef(start, visibility);
    }
    if (this.check(TokenKind.Struct)) {
      return this.parseStructDef(start, visibility);
    }
    if (this.check(TokenKind.Enum)) {
      return this.parseEnumDef(start, visibility);
    }
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAlias(start, visibility);
    }
    if (this.check(TokenKind.Const)) {
      return this.parseConstDef(start, visibility);
    }
    if (this.check(TokenKind.Interface)) {
      return this.parseInterfaceDef(start, visibility);
    }
    // This list is a second copy of the one in `parseItem`, and it fell behind:
    // `union`, `extern mod` and `test` were added there and not here, so a file
    // that opened with `package` could not contain them.
    if (this.check(TokenKind.Union)) {
      return this.parseUnionDef(start, visibility);
    }
    if (this.check(TokenKind.Extern)) {
      return this.parseExternModDef(start, visibility);
    }
    if (this.check(TokenKind.Test)) {
      return this.parseTestModDef(start, visibility);
    }
    if (this.check(TokenKind.Import)) {
      return this.parseImportDecl(start);
    }

    // Unknown token in package
    this.reportError(`Unexpected token in package: ${this.current().text}`);
    return null;
  }

  // ========================================
  // Test Definition
  // ========================================

  private parseTestDef(start: SourceLocation, attributes: Attribute[]): TestDef | null {
    // Convert attributes to TestAttribute format
    const testAttributes: TestAttribute[] = [];
    for (const attr of attributes) {
      if (attr.path.segments.length === 1 && attr.path.segments[0]?.name === 'test') {
        const testAttr = this.convertToTestAttribute(attr);
        testAttributes.push(testAttr);
      }
    }

    this.expect(TokenKind.Fn, 'Expected fn');

    const nameToken = this.expect(TokenKind.Ident, 'Expected test function name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LParen, 'Expected (');
    this.expect(TokenKind.RParen, 'Expected )');

    this.expect(TokenKind.LBrace, 'Expected {');
    const body = this.parseTestStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'TestDef',
      attributes: testAttributes,
      name,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  /**
   * `test name() { ... }` — a test function written without `fn`, as
   * specification chapter 11 spells it. The `#[test]` attribute is optional
   * here because the `test` keyword already says what this is.
   */
  private parseTestFnDef(start: SourceLocation, attributes: Attribute[]): TestDef | null {
    const testAttributes: TestAttribute[] = [];
    for (const attr of attributes) {
      if (attr.path.segments.length === 1 && attr.path.segments[0]?.name === 'test') {
        testAttributes.push(this.convertToTestAttribute(attr));
      }
    }

    this.expect(TokenKind.Test, 'Expected test');

    const nameToken = this.expect(TokenKind.Ident, 'Expected test function name');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.LParen, 'Expected (');
    // Fixture parameters are consumed but not modelled yet.
    while (!this.check(TokenKind.RParen) && !this.isEof()) {
      this.advance();
    }
    this.expect(TokenKind.RParen, 'Expected )');

    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }
    const body = this.parseTestStatements();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'TestDef',
      attributes: testAttributes,
      name,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private convertToTestAttribute(attr: Attribute): TestAttribute {
    const params: TestParam[] = [];

    if (attr.args) {
      for (const arg of attr.args) {
        const param = this.convertToTestParam(arg);
        if (param) {
          params.push(param);
        }
      }
    }

    return {
      kind: 'TestAttribute',
      name: 'test',
      params: params.length > 0 ? params : undefined,
      span: attr.span,
    };
  }

  private convertToTestParam(arg: AttributeArg): TestParam | null {
    // Handle named parameters like timeout = 100ns
    if (arg.name) {
      return {
        kind: 'TestParam',
        name: arg.name.name,
        value: {
          kind: 'LiteralExpr',
          value: arg.value,
          span: arg.span,
        },
        span: arg.span,
      };
    }

    // Handle flag-like parameters (should_fail, ignore)
    if (arg.value.kind === 'String') {
      return {
        kind: 'TestParam',
        name: arg.value.value,
        value: {
          kind: 'LiteralExpr',
          value: { kind: 'Bool', value: true },
          span: arg.span,
        },
        span: arg.span,
      };
    }

    return null;
  }

  private parseTestStatements(): TestStmt[] {
    const stmts: TestStmt[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const stmt = this.parseTestStatement();
      if (stmt) {
        stmts.push(stmt);
      }
      this.ensureProgress(mark);
    }
    return stmts;
  }

  private parseTestStatement(): TestStmt | null {
    const start = this.current().span.start;

    // assert statement: assert expr [, string_literal] ;
    if (this.check(TokenKind.Assert)) {
      return this.parseAssertStmt(start);
    }

    // wait statement: wait ( wait_condition ) ;
    if (this.check(TokenKind.Wait)) {
      return this.parseWaitStmt(start);
    }

    // sample statement: let identifier = sample ( expr ) ;
    // This needs to be checked before regular let to handle sample
    if (this.check(TokenKind.Let)) {
      // Look ahead to see if this is a sample statement
      const saved = this.pos;
      this.advance(); // consume 'let'
      if (this.check(TokenKind.Ident)) {
        this.advance(); // consume identifier
        if (this.check(TokenKind.Eq)) {
          this.advance(); // consume '='
          if (this.check(TokenKind.Sample)) {
            // Restore position and parse as sample statement
            this.pos = saved;
            return this.parseSampleStmt(start);
          }
        }
      }
      // Restore position and parse as regular let
      this.pos = saved;
      return this.parseLetDecl(start);
    }

    // drive statement: identifier <= expr ;
    if (this.check(TokenKind.Ident)) {
      // Look ahead to see if this is a drive statement (identifier <= expr)
      if (this.peek().kind === TokenKind.Le) {
        return this.parseDriveStmt(start);
      }
    }

    // Regular statements
    return this.parseStatement();
  }

  private parseAssertStmt(start: SourceLocation): AssertStmt | null {
    this.expect(TokenKind.Assert, 'Expected assert');

    const condition = this.parseExpr();
    if (!condition) return null;

    let message: string | undefined;
    let severity: AssertSeverity | undefined;

    if (this.match(TokenKind.Comma)) {
      const msgToken = this.expect(TokenKind.StringLiteral, 'Expected string literal');
      if (msgToken) {
        message = msgToken.text.slice(1, -1); // Remove quotes
      }
    } else if (this.match(TokenKind.Else)) {
      // `else error("...")` — the severity names are not keywords, so they
      // arrive as identifiers.
      const sevToken = this.expect(TokenKind.Ident, 'Expected error, warning or fatal');
      if (sevToken) {
        if (sevToken.text === 'error' || sevToken.text === 'warning' || sevToken.text === 'fatal') {
          severity = sevToken.text;
        } else {
          this.reportError(`Expected error, warning or fatal, found ${sevToken.text}`);
        }
      }
      if (this.match(TokenKind.LParen)) {
        if (this.check(TokenKind.StringLiteral)) {
          message = this.advance().text.slice(1, -1);
        }
        this.expect(TokenKind.RParen, 'Expected )');
      }
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'AssertStmt',
      condition,
      message,
      severity,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseWaitStmt(start: SourceLocation): WaitStmt | null {
    this.expect(TokenKind.Wait, 'Expected wait');
    this.expect(TokenKind.LParen, 'Expected (');

    const condition = this.parseWaitCondition();
    if (!condition) return null;

    this.expect(TokenKind.RParen, 'Expected )');
    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'WaitStmt',
      condition,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseWaitCondition(): WaitCondition | null {
    // Try to parse as duration (integer literal followed by time unit)
    if (this.check(TokenKind.IntLiteral)) {
      const literal = this.advance();
      const value = parseInt(literal.text, 10);

      // Check for time unit
      if (this.check(TokenKind.Ident)) {
        const unit = this.current().text;
        if (unit === 'ns' || unit === 'us' || unit === 'ms' || unit === 's') {
          this.advance();
          return { kind: 'DurationWait', value, unit };
        }
      }

      // Not a duration, backtrack and parse as expression
      this.pos--;
    }

    // Try to parse as clock spec (expr.posedge or expr.negedge)
    const expr = this.parseExpr();
    if (!expr) return null;

    // Check if this is a clock spec
    if (expr.kind === 'FieldExpr') {
      const fieldName = expr.field.name;
      if (fieldName === 'posedge' || fieldName === 'negedge') {
        return {
          kind: 'ClockWait',
          clock: {
            kind: 'ClockSpec',
            signal: expr.base,
            edge: fieldName,
            span: expr.span,
          },
        };
      }
    }

    // Regular expression wait
    return { kind: 'ExprWait', expr };
  }

  private parseDriveStmt(start: SourceLocation): DriveStmt | null {
    const targetToken = this.expect(TokenKind.Ident, 'Expected identifier');
    if (!targetToken) return null;
    const target = this.makeIdentifier(targetToken);

    this.expect(TokenKind.Le, 'Expected <=');

    const value = this.parseExpr();
    if (!value) return null;

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'DriveStmt',
      target,
      value,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseSampleStmt(start: SourceLocation): SampleStmt | null {
    this.expect(TokenKind.Let, 'Expected let');

    const nameToken = this.expect(TokenKind.Ident, 'Expected identifier');
    if (!nameToken) return null;
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Eq, 'Expected =');
    this.expect(TokenKind.Sample, 'Expected sample');
    this.expect(TokenKind.LParen, 'Expected (');

    const expr = this.parseExpr();
    if (!expr) return null;

    this.expect(TokenKind.RParen, 'Expected )');
    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'SampleStmt',
      name,
      expr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Literals
  // ========================================

  private parseLiteral(): Literal | null {
    if (this.check(TokenKind.IntLiteral)) {
      const token = this.advance();
      return this.parseIntLiteral(token.text);
    }

    if (this.check(TokenKind.StringLiteral)) {
      const token = this.advance();
      // Remove quotes
      const value = token.text.slice(1, -1);
      return { kind: 'String', value };
    }

    if (this.match(TokenKind.True)) {
      return { kind: 'Bool', value: true };
    }

    if (this.match(TokenKind.False)) {
      return { kind: 'Bool', value: false };
    }

    return null;
  }

  private parseIntLiteral(text: string): Literal {
    // Parse format: [size]'[base]digits
    // Examples: 8'hFF, 32'd100, 1'b1, 100
    let width: number | undefined;
    let base: 'b' | 'o' | 'd' | 'h' | undefined;
    let value = text;

    const quoteIdx = text.indexOf("'");
    if (quoteIdx !== -1) {
      width = parseInt(text.slice(0, quoteIdx), 10);
      const baseChar = text[quoteIdx + 1]?.toLowerCase();
      if (baseChar === 'b' || baseChar === 'o' || baseChar === 'd' || baseChar === 'h') {
        base = baseChar;
      }
      value = text.slice(quoteIdx + (base ? 2 : 1));
    }

    return { kind: 'Int', value, width, base };
  }

  // ========================================
  // Path
  // ========================================

  private parsePath(): Path | null {
    const start = this.current().span.start;
    const segments: Identifier[] = [];

    const firstToken = this.expect(TokenKind.Ident, 'Expected identifier');
    if (!firstToken) return null;
    segments.push(this.makeIdentifier(firstToken));

    while (this.check(TokenKind.ColonColon) && this.peek().kind === TokenKind.Ident) {
      this.advance(); // consume ::
      const token = this.advance(); // consume identifier
      segments.push(this.makeIdentifier(token));
    }

    return {
      kind: 'Path',
      segments,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Helper methods
  // ========================================

  private isEof(): boolean {
    return this.current().kind === TokenKind.Eof;
  }

  private current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.tokens[0]!;
  }

  private peek(offset = 1): Token {
    const idx = this.pos + offset;
    return this.tokens[idx] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const token = this.current();
    if (!this.isEof()) {
      this.pos++;
    }
    return token;
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(kind: TokenKind, message: string): Token | null {
    if (this.check(kind)) {
      return this.advance();
    }
    this.reportError(message);
    return null;
  }

  private reportError(message: string): void {
    this.errors.push({
      message,
      span: this.current().span,
      severity: 'error',
    });
  }

  /**
   * Try a parse, and undo it completely if it does not succeed.
   *
   * Rewinding the position alone is not enough: a failed attempt leaves its
   * diagnostics behind, so a construct that the second alternative parses
   * cleanly still reports the first alternative's complaint. That is how
   * `inst f = Fifo[Depth: 16] {}` came to fail with `Expected type` even though
   * the fallback expression parse succeeded.
   */
  private speculate<T>(attempt: () => T | null): T | null {
    const pos = this.pos;
    const errorCount = this.errors.length;
    const result = attempt();
    if (result !== null && this.errors.length === errorCount) {
      return result;
    }
    this.pos = pos;
    this.errors.length = errorCount;
    return null;
  }

  private makeIdentifier(token: Token): Identifier {
    return {
      kind: 'Identifier',
      name: token.text,
      span: token.span,
      leadingTrivia: token.leadingTrivia,
      trailingTrivia: token.trailingTrivia,
    };
  }

  private makeSpan(start: SourceLocation, end: SourceLocation): SourceSpan {
    return { start, end };
  }

  /**
   * Get leading trivia from the current token (comments before the token)
   */
  private getLeadingTrivia(): Trivia[] {
    return this.current().leadingTrivia;
  }

  /**
   * Get trailing trivia from the previous token (comments after the token)
   */
  private getTrailingTrivia(): Trivia[] {
    return this.previous().trailingTrivia;
  }

  /**
   * Collect only comment trivia (excluding whitespace and newlines)
   */
  private getCommentTrivia(trivia: Trivia[]): Trivia[] {
    return trivia.filter(t => t.kind === 'line_comment' || t.kind === 'block_comment');
  }

  // ========================================
  // Test Module Definition (test mod)
  // ========================================

  private parseTestModDef(start: SourceLocation, visibility: Visibility): TestModDef | null {
    this.expect(TokenKind.Test, 'Expected test');
    // The older form wrote `test mod Name`; the current grammar is `test Name`.
    this.match(TokenKind.Mod);

    const nameToken = this.expect(TokenKind.Ident, 'Expected module name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }
    const items = this.parseTestModItems();
    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'TestModDef',
      visibility,
      name,
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseTestModItems(): TestModItem[] {
    const items: TestModItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const item = this.parseTestModItem();
      if (item) {
        items.push(item);
      }
      this.ensureProgress(mark);
    }
    return items;
  }

  private parseTestModItem(): TestModItem | null {
    const start = this.current().span.start;

    // Signal declarations (let/var)
    if (this.check(TokenKind.Let)) {
      return this.parseLetDecl(start);
    }
    if (this.check(TokenKind.Var)) {
      return this.parseVarDecl(start);
    }

    // Constant declarations
    if (this.check(TokenKind.Const)) {
      return this.parseConstDecl(start, 'private');
    }

    // Type aliases
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAlias(start, 'private');
    }

    // Memories
    if (this.check(TokenKind.Mem)) {
      return this.parseMemDecl(start);
    }

    // State machines
    if (this.check(TokenKind.Fsm)) {
      return this.parseFsmBlock(start);
    }

    // Instance declarations. `inst` is not a keyword in this lexer, so it
    // arrives as an identifier, the same as in a module body.
    if (this.check(TokenKind.Ident) && this.current().text === 'inst') {
      return this.parseInstDecl(start);
    }
    if (
      this.check(TokenKind.Ident) &&
      (this.peek().kind === TokenKind.ColonColon || this.peek().kind === TokenKind.Colon)
    ) {
      // The older forms: `u :: Module` and `u: Module(...)`
      return this.parseInstDecl(start);
    }

    // Combinational blocks
    if (this.check(TokenKind.Comb)) {
      return this.parseCombBlock(start);
    }

    // Sequential blocks (sync)
    if (this.check(TokenKind.Sync)) {
      return this.parseSyncBlock(start);
    }

    // Initial blocks
    if (this.check(TokenKind.Initial)) {
      return this.parseInitialBlock(start);
    }

    // Seq blocks
    if (this.check(TokenKind.Seq)) {
      return this.parseSeqBlock(start);
    }

    // Use rust:: declarations
    if (this.check(TokenKind.Import) && this.peek().kind === TokenKind.Ident) {
      const nextToken = this.tokens[this.pos + 1];
      if (nextToken && nextToken.text === 'rust') {
        return this.parseUseRustDecl(start);
      }
    }

    // Extern rust blocks
    if (this.check(TokenKind.Extern)) {
      return this.parseExternRustBlock(start);
    }

    // Assert statements (for backward compatibility)
    if (this.check(TokenKind.Assert)) {
      return this.parseAssertStmt(start);
    }

    return null;
  }

  // ========================================
  // Initial Block
  // ========================================

  private parseInitialBlock(start: SourceLocation): InitialBlock | null {
    this.expect(TokenKind.Initial, 'Expected initial');

    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }

    const stmts: Stmt[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const stmt = this.parseStatement();
      if (stmt) {
        stmts.push(stmt);
      }
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'InitialBlock',
      stmts,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Seq Block
  // ========================================

  private parseSeqBlock(start: SourceLocation): SeqBlock | null {
    this.expect(TokenKind.Seq, 'Expected seq');

    // Optional name
    let name: Identifier | undefined;
    if (this.check(TokenKind.Ident)) {
      const nameToken = this.advance();
      name = this.makeIdentifier(nameToken);
    }

    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }

    const body: SeqStatement[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const mark = this.pos;
      const stmt = this.parseSeqStatement();
      if (stmt) {
        body.push(stmt);
      }
      this.ensureProgress(mark);
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'SeqBlock',
      name,
      body,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseSeqStatement(): SeqStatement | null {
    const start = this.current().span.start;

    // Await statement
    if (this.check(TokenKind.Await)) {
      return this.parseAwaitStmt(start);
    }

    // Delay statement (#10ns;)
    if (this.check(TokenKind.Hash)) {
      return this.parseDelayStmt(start);
    }

    // Assert statement
    if (this.check(TokenKind.Assert)) {
      return this.parseAssertStmt(start);
    }

    // Try to parse as a general statement (for Rust-like code)
    // Skip to the next statement boundary (semicolon or closing brace)
    const stmtStart = this.pos;
    let code = '';
    while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.RBrace) && !this.isEof()) {
      code += this.current().text;
      this.advance();
    }
    if (this.match(TokenKind.Semicolon)) {
      code += ';';
    }

    // If we consumed any tokens, return as RustStatement
    if (this.pos > stmtStart) {
      return {
        kind: 'RustStatement',
        code: code.trim(),
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    return null;
  }

  // ========================================
  // Await Statement
  // ========================================

  private parseAwaitStmt(start: SourceLocation): AwaitStmt | null {
    this.expect(TokenKind.Await, 'Expected await');

    const awaitExpr = this.parseAwaitExpr(start);
    if (!awaitExpr) {
      return null;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'AwaitStmt',
      awaitExpr,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseAwaitExpr(start: SourceLocation): AwaitExpr | null {
    // await until(condition) or await until(condition, timeout)
    if (this.check(TokenKind.Ident) && this.current().text === 'until') {
      this.advance();
      if (!this.expect(TokenKind.LParen, 'Expected (')) {
        return null;
      }
      const condition = this.parseExpr();
      if (!condition) {
        return null;
      }

      // Check for optional timeout
      let timeout: Duration | undefined;
      if (this.match(TokenKind.Comma)) {
        // Parse duration: number followed by unit (ns, us, ms, s)
        const timeoutStart = this.current().span.start;
        const valueToken = this.expect(TokenKind.IntLiteral, 'Expected timeout value');
        if (valueToken) {
          const value = parseInt(valueToken.text, 10);
          // Expect time unit identifier
          const unitToken = this.current();
          if (unitToken.kind === TokenKind.Ident) {
            const unit = unitToken.text as 'ns' | 'us' | 'ms' | 's';
            if (unit === 'ns' || unit === 'us' || unit === 'ms' || unit === 's') {
              this.advance();
              timeout = {
                kind: 'Duration',
                value,
                unit,
                span: this.makeSpan(timeoutStart, this.previous().span.end),
              };
            }
          }
        }
      }

      this.expect(TokenKind.RParen, 'Expected )');

      return {
        kind: 'UntilAwait',
        condition,
        timeout,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // await event(signal)
    if (this.check(TokenKind.Ident) && this.current().text === 'event') {
      this.advance();
      if (!this.expect(TokenKind.LParen, 'Expected (')) {
        return null;
      }
      const signal = this.parseExpr();
      if (!signal) {
        return null;
      }
      this.expect(TokenKind.RParen, 'Expected )');

      return {
        kind: 'EventAwait',
        signal,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // await clk.posedge or await clk.posedge(5)
    const signal = this.parseExpr();
    if (!signal) {
      return null;
    }

    // Check for .posedge or .negedge
    if (this.check(TokenKind.Dot)) {
      this.advance();
      const edgeToken = this.current();
      if (edgeToken.kind !== TokenKind.Posedge && edgeToken.kind !== TokenKind.Negedge) {
        this.reportError('Expected posedge or negedge');
        return null;
      }
      const edge: 'posedge' | 'negedge' = edgeToken.kind === TokenKind.Posedge ? 'posedge' : 'negedge';
      this.advance();

      // Optional cycle count
      let cycles: Expr | undefined;
      if (this.match(TokenKind.LParen)) {
        cycles = this.parseExpr() ?? undefined;
        this.expect(TokenKind.RParen, 'Expected )');
      }

      return {
        kind: 'ClockEdgeAwait',
        signal,
        edge,
        cycles,
        span: this.makeSpan(start, this.previous().span.end),
      };
    }

    // expr.await (async call await)
    return {
      kind: 'AsyncCallAwait',
      expr: signal,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Delay Statement
  // ========================================

  private parseDelayStmt(start: SourceLocation): DelayStmt | null {
    this.expect(TokenKind.Hash, 'Expected #');

    // Parse number and optional unit
    const numToken = this.expect(TokenKind.IntLiteral, 'Expected delay value');
    if (!numToken) {
      return null;
    }

    const value = parseInt(numToken.text, 10);

    // Check for time unit identifier
    let unit: 'ns' | 'us' | 'ms' | 's' = 'ns';
    if (this.check(TokenKind.Ident)) {
      const unitText = this.current().text;
      if (unitText === 'ns' || unitText === 'us' || unitText === 'ms' || unitText === 's') {
        unit = unitText as 'ns' | 'us' | 'ms' | 's';
        this.advance();
      }
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'DelayStmt',
      delay: {
        kind: 'Duration',
        value,
        unit,
        span: this.makeSpan(start, this.previous().span.end),
      },
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Use Rust Declaration
  // ========================================

  private parseUseRustDecl(start: SourceLocation): UseRustDecl | null {
    this.expect(TokenKind.Import, 'Expected use');

    // Expect 'rust'
    if (!this.check(TokenKind.Ident) || this.current().text !== 'rust') {
      this.reportError('Expected rust');
      return null;
    }
    this.advance();

    this.expect(TokenKind.ColonColon, 'Expected ::');

    // Parse path
    const path: string[] = [];
    while (this.check(TokenKind.Ident)) {
      path.push(this.current().text);
      this.advance();
      if (!this.match(TokenKind.ColonColon)) {
        break;
      }
    }

    // Optional import items { item1, item2 } or *
    let items: string[] | '*' | undefined;
    if (this.match(TokenKind.LBrace)) {
      if (this.match(TokenKind.Star)) {
        items = '*';
      } else {
        items = [];
        while (!this.check(TokenKind.RBrace) && !this.isEof()) {
          if (this.check(TokenKind.Ident)) {
            items.push(this.current().text);
            this.advance();
          }
          if (!this.match(TokenKind.Comma)) {
            break;
          }
        }
      }
      this.expect(TokenKind.RBrace, 'Expected }');
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'UseRustDecl',
      path,
      items,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  // ========================================
  // Extern Rust Block
  // ========================================

  private parseExternRustBlock(start: SourceLocation): ExternRustBlock | null {
    this.expect(TokenKind.Extern, 'Expected extern');

    // Expect 'rust'
    if (!this.check(TokenKind.Ident) || this.current().text !== 'rust') {
      this.reportError('Expected rust');
      return null;
    }
    this.advance();

    // Module name string
    const moduleNameToken = this.expect(TokenKind.StringLiteral, 'Expected module name string');
    if (!moduleNameToken) {
      return null;
    }
    const moduleName = moduleNameToken.text.slice(1, -1); // Remove quotes

    if (!this.expect(TokenKind.LBrace, 'Expected {')) {
      return null;
    }

    const functions: RustFnDecl[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isEof()) {
      const fn = this.parseRustFnDecl();
      if (fn) {
        functions.push(fn);
      } else {
        // Skip unknown token
        if (!this.check(TokenKind.RBrace) && !this.isEof()) {
          this.advance();
        }
      }
    }

    this.expect(TokenKind.RBrace, 'Expected }');

    return {
      kind: 'ExternRustBlock',
      moduleName,
      functions,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseRustFnDecl(): RustFnDecl | null {
    const start = this.current().span.start;

    // Optional async
    const isAsync = this.match(TokenKind.Async);

    // Expect fn
    if (!this.expect(TokenKind.Fn, 'Expected fn')) {
      return null;
    }

    // Function name
    const nameToken = this.expect(TokenKind.Ident, 'Expected function name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    // Parameters
    if (!this.expect(TokenKind.LParen, 'Expected (')) {
      return null;
    }

    const params: RustParam[] = [];
    while (!this.check(TokenKind.RParen) && !this.isEof()) {
      const param = this.parseRustParam();
      if (param) {
        params.push(param);
      }
      if (!this.match(TokenKind.Comma)) {
        break;
      }
    }

    this.expect(TokenKind.RParen, 'Expected )');

    // Optional return type
    let returnType: string | undefined;
    if (this.match(TokenKind.Arrow)) {
      // Collect return type as string until semicolon
      let typeStr = '';
      while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.RBrace) && !this.isEof()) {
        typeStr += this.current().text;
        this.advance();
      }
      returnType = typeStr.trim() || undefined;
    }

    this.expect(TokenKind.Semicolon, 'Expected ;');

    return {
      kind: 'RustFnDecl',
      isAsync,
      name,
      params,
      returnType,
      span: this.makeSpan(start, this.previous().span.end),
    };
  }

  private parseRustParam(): RustParam | null {
    const start = this.current().span.start;

    const nameToken = this.expect(TokenKind.Ident, 'Expected parameter name');
    if (!nameToken) {
      return null;
    }
    const name = this.makeIdentifier(nameToken);

    this.expect(TokenKind.Colon, 'Expected :');

    // Collect type as string until comma or )
    let typeStr = '';
    while (!this.check(TokenKind.Comma) && !this.check(TokenKind.RParen) && !this.isEof()) {
      typeStr += this.current().text;
      this.advance();
    }

    return {
      kind: 'RustParam',
      name,
      typeStr: typeStr.trim(),
      span: this.makeSpan(start, this.previous().span.end),
    };
  }
}
