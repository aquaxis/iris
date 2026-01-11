/**
 * IRIS Parser
 *
 * Recursive descent parser for the IRIS language.
 */

import type {
  Token,
  SourceSpan} from '../lexer/index.js';
import {
  TokenKind,
  createSpan,
  tokenizeWithoutTrivia,
} from '../lexer/index.js';

import type {
  // Base types
  Identifier,
  Path,
  Visibility,
  GenericParam,
  GenericParams,
  GenericArg,
  GenericArgs,
  GenericBound,
  Constraint,
  WhereClause,
  Attribute,
  AttrArg,

  // Type expressions
  TypeExpr,

  // Expressions
  Expr,
  Literal,
  IntegerLiteral,
  UnaryOp,
  BinaryOp,
  IfExpr,
  MatchArm,
  MatchExpr,

  // Patterns
  Pattern,
  FieldPattern,

  // Statements
  Stmt,
  LetStmt,
  VarStmt,
  IfStmt,
  MatchStmt,
  ForStmt,
  WhileStmt,
  ReturnStmt,
  LValue,
} from '../ast/index.js';

import {
  createIdentifier,
  createPath,
} from '../ast/index.js';

import type {
  // Items
  SourceFile,
  Item,
  PortDirection,
  PortDecl,
  ModItem,
  ClockSpec,
  ResetSpec,
  SyncBlock,
  Connection,
  InstDecl,
  MemDecl,
  MemConfigItem,
  FsmStateItem,
  FsmStateEnum,
  TransitionAction,
  WhenClause,
  TransitionItem,
  TransitionsBlock,
  OutputCase,
  OutputBlock,
  FsmBlock,
  ModDef,
  EnumVariant,
  EnumDef,
  StructField,
  StructDef,
  TypeAliasDef,
  ConstDef,
  FnParam,
  FnDef,
  InterfaceSignal,
  ViewSignal,
  ViewDef,
  InterfaceDef,
  PackageDecl,
  ImportItem,
  ImportDecl,
  TestParam,
  TestStmt,
  TestDef,
} from '../ast/index.js';

/**
 * Parser error information
 */
export interface ParseError {
  message: string;
  span: SourceSpan;
}

/**
 * Parser result
 */
export interface ParseResult {
  ast: SourceFile;
  errors: ParseError[];
}

/**
 * Binary operator precedence (higher = tighter binding)
 */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '<=': 7,
  '>': 7,
  '>=': 7,
  '<<': 8,
  '>>': 8,
  '>>>': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
  '**': 11,
};

/**
 * Token kind to binary operator mapping
 */
const TOKEN_TO_BINARY_OP: Partial<Record<TokenKind, BinaryOp>> = {
  [TokenKind.Plus]: '+',
  [TokenKind.Minus]: '-',
  [TokenKind.Star]: '*',
  [TokenKind.Slash]: '/',
  [TokenKind.Percent]: '%',
  [TokenKind.StarStar]: '**',
  [TokenKind.Amp]: '&',
  [TokenKind.Pipe]: '|',
  [TokenKind.Caret]: '^',
  [TokenKind.LtLt]: '<<',
  [TokenKind.GtGt]: '>>',
  [TokenKind.GtGtGt]: '>>>',
  [TokenKind.EqEq]: '==',
  [TokenKind.BangEq]: '!=',
  [TokenKind.Lt]: '<',
  [TokenKind.LtEq]: '<=',
  [TokenKind.Gt]: '>',
  [TokenKind.GtEq]: '>=',
  [TokenKind.AmpAmp]: '&&',
  [TokenKind.PipePipe]: '||',
};

/**
 * Token kind to unary operator mapping
 */
const TOKEN_TO_UNARY_OP: Partial<Record<TokenKind, UnaryOp>> = {
  [TokenKind.Bang]: '!',
  [TokenKind.Tilde]: '~',
  [TokenKind.Minus]: '-',
  [TokenKind.Amp]: '&',
  [TokenKind.Pipe]: '|',
  [TokenKind.Caret]: '^',
};

/**
 * IRIS Language Parser
 */
export class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /**
   * Parse the source file
   */
  parse(): ParseResult {
    const items: Item[] = [];
    const startSpan = this.currentSpan();

    while (!this.isAtEnd()) {
      try {
        const item = this.parseItem();
        if (item) {
          items.push(item);
        }
      } catch {
        this.synchronize();
      }
    }

    const endSpan = this.previousSpan();
    const span = this.mergeSpans(startSpan, endSpan);

    return {
      ast: { kind: 'SourceFile', items, span },
      errors: this.errors,
    };
  }

  // ==================== Utility Methods ====================

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.Eof;
  }

  private peek(): Token {
    const token = this.tokens[this.pos];
    if (token) return token;
    const last = this.tokens[this.tokens.length - 1];
    if (last) return last;
    throw new Error('No tokens available');
  }

  private peekNext(): Token {
    const token = this.tokens[this.pos + 1];
    if (token) return token;
    const last = this.tokens[this.tokens.length - 1];
    if (last) return last;
    throw new Error('No tokens available');
  }

  private previous(): Token {
    const token = this.tokens[this.pos - 1];
    if (token) return token;
    const first = this.tokens[0];
    if (first) return first;
    throw new Error('No tokens available');
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.previous();
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private checkAny(...kinds: TokenKind[]): boolean {
    return kinds.some((k) => this.check(k));
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private expect(kind: TokenKind, message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    throw this.error(message);
  }

  private currentSpan(): SourceSpan {
    return this.peek().span;
  }

  private previousSpan(): SourceSpan {
    return this.previous().span;
  }

  private mergeSpans(start: SourceSpan, end: SourceSpan): SourceSpan {
    return createSpan(
      start.start,
      end.end,
      start.startLine,
      start.startColumn,
      end.endLine,
      end.endColumn
    );
  }

  private error(message: string): ParseError {
    const err: ParseError = {
      message,
      span: this.currentSpan(),
    };
    this.errors.push(err);
    return err;
  }

  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().kind === TokenKind.Semi) return;

      switch (this.peek().kind) {
        case TokenKind.Mod:
        case TokenKind.Pub:
        case TokenKind.Fn:
        case TokenKind.Type:
        case TokenKind.Struct:
        case TokenKind.Enum:
        case TokenKind.Interface:
        case TokenKind.Package:
        case TokenKind.Import:
        case TokenKind.Const:
        case TokenKind.HashLBracket:
          return;
      }

      this.advance();
    }
  }

  // ==================== Top-level Parsing ====================

  private parseItem(): Item | null {
    const attributes: Attribute[] = [];
    while (this.check(TokenKind.HashLBracket)) {
      attributes.push(this.parseAttribute());
    }

    const visibility = this.parseVisibility();

    if (this.check(TokenKind.Mod)) {
      return this.parseModDef(visibility, attributes.length > 0 ? attributes : undefined);
    }
    if (this.check(TokenKind.Fn)) {
      if (attributes.some((a) => a.path.segments.some((s) => s.name === 'test'))) {
        return this.parseTestDef(visibility, attributes);
      }
      return this.parseFnDef(visibility);
    }
    if (this.check(TokenKind.Type)) {
      return this.parseTypeAliasDef(visibility);
    }
    if (this.check(TokenKind.Struct)) {
      return this.parseStructDef(visibility);
    }
    if (this.check(TokenKind.Enum)) {
      return this.parseEnumDef(visibility);
    }
    if (this.check(TokenKind.Interface)) {
      return this.parseInterfaceDef(visibility);
    }
    if (this.check(TokenKind.Package)) {
      return this.parsePackageDecl(visibility);
    }
    if (this.check(TokenKind.Import)) {
      return this.parseImportDecl(visibility);
    }
    if (this.check(TokenKind.Const)) {
      return this.parseConstDef(visibility);
    }

    throw this.error(`Expected item, found ${this.peek().kind}`);
  }

  private parseVisibility(): Visibility {
    if (this.match(TokenKind.Pub)) {
      return 'public';
    }
    return 'private';
  }

  private parseAttribute(): Attribute {
    const start = this.expect(TokenKind.HashLBracket, "Expected '#['").span;
    const path = this.parsePath();
    let args: AttrArg[] | undefined;

    if (this.match(TokenKind.LParen)) {
      args = [];
      if (!this.check(TokenKind.RParen)) {
        do {
          args.push(this.parseAttrArg());
        } while (this.match(TokenKind.Comma));
      }
      this.expect(TokenKind.RParen, "Expected ')'");
    }

    const end = this.expect(TokenKind.RBracket, "Expected ']'").span;

    return {
      kind: 'Attribute',
      path,
      args,
      span: this.mergeSpans(start, end),
    };
  }

  private parseAttrArg(): AttrArg {
    const start = this.currentSpan();
    let name: Identifier | undefined;

    if (this.check(TokenKind.Identifier) && this.peekNext().kind === TokenKind.Eq) {
      name = this.parseIdentifier();
      this.expect(TokenKind.Eq, "Expected '='");
    }

    const value = this.parseLiteral();
    const end = this.previousSpan();

    return {
      kind: 'AttrArg',
      name,
      value,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Identifier and Path ====================

  private parseIdentifier(): Identifier {
    // Some keywords can be used as identifiers (e.g., 'test', 'state')
    const token = this.peek();
    if (token.kind === TokenKind.Identifier || this.isContextualKeyword(token.kind)) {
      this.advance();
      return createIdentifier(token.text, token.span);
    }
    throw this.error('Expected identifier');
  }

  private isContextualKeyword(kind: TokenKind): boolean {
    // Keywords that can also be used as identifiers
    return kind === TokenKind.Test ||
           kind === TokenKind.State ||
           kind === TokenKind.Assert ||
           kind === TokenKind.Wait ||
           kind === TokenKind.Sample ||
           kind === TokenKind.View ||
           kind === TokenKind.Logic ||
           kind === TokenKind.Output ||
           kind === TokenKind.Transitions ||
           kind === TokenKind.When ||
           kind === TokenKind.Goto;
  }

  private parsePath(): Path {
    const start = this.currentSpan();
    const segments: Identifier[] = [this.parseIdentifier()];

    while (this.match(TokenKind.ColonColon)) {
      segments.push(this.parseIdentifier());
    }

    const end = this.previousSpan();
    return createPath(segments, this.mergeSpans(start, end));
  }

  // ==================== Generic Parameters ====================

  private parseGenericParams(): GenericParams | undefined {
    if (!this.match(TokenKind.LBracket)) {
      return undefined;
    }

    const start = this.previousSpan();
    const params: GenericParam[] = [];

    if (!this.check(TokenKind.RBracket)) {
      do {
        params.push(this.parseGenericParam());
      } while (this.match(TokenKind.Comma));
    }

    const end = this.expect(TokenKind.RBracket, "Expected ']'").span;

    return {
      kind: 'GenericParams',
      params,
      span: this.mergeSpans(start, end),
    };
  }

  private parseGenericParam(): GenericParam {
    const start = this.currentSpan();
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const bound = this.parseGenericBound();

    let defaultValue: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      defaultValue = this.parseExpr();
    }

    const end = this.previousSpan();

    return {
      kind: 'GenericParam',
      name,
      bound,
      defaultValue,
      span: this.mergeSpans(start, end),
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

    const type = this.parseTypeExpr();
    return { kind: 'TypeExprBound', type };
  }

  private parseGenericArgs(): GenericArgs | undefined {
    if (!this.match(TokenKind.LBracket)) {
      return undefined;
    }

    const start = this.previousSpan();
    const args: GenericArg[] = [];

    if (!this.check(TokenKind.RBracket)) {
      do {
        args.push(this.parseGenericArg());
      } while (this.match(TokenKind.Comma));
    }

    const end = this.expect(TokenKind.RBracket, "Expected ']'").span;

    return {
      kind: 'GenericArgs',
      args,
      span: this.mergeSpans(start, end),
    };
  }

  private parseGenericArg(): GenericArg {
    const start = this.currentSpan();
    let name: Identifier | undefined;

    if (this.check(TokenKind.Identifier) && this.peekNext().kind === TokenKind.Colon) {
      name = this.parseIdentifier();
      this.expect(TokenKind.Colon, "Expected ':'");
    }

    const value = this.parseTypeOrExpr();
    const end = this.previousSpan();

    return {
      kind: 'GenericArg',
      name,
      value,
      span: this.mergeSpans(start, end),
    };
  }

  private parseTypeOrExpr(): TypeExpr | Expr {
    if (this.checkAny(TokenKind.Bit, TokenKind.Int, TokenKind.Uint, TokenKind.Bool,
      TokenKind.Clock, TokenKind.Reset, TokenKind.String)) {
      return this.parseTypeExpr();
    }
    return this.parseExpr();
  }

  // ==================== Where Clause ====================

  private parseWhereClause(): WhereClause | undefined {
    if (!this.match(TokenKind.Where)) {
      return undefined;
    }

    const start = this.previousSpan();
    const constraints: Constraint[] = [];

    do {
      constraints.push(this.parseConstraint());
    } while (this.match(TokenKind.Comma));

    const end = this.previousSpan();

    return {
      kind: 'WhereClause',
      constraints,
      span: this.mergeSpans(start, end),
    };
  }

  private parseConstraint(): Constraint {
    const name = this.parseIdentifier();

    if (this.match(TokenKind.Colon)) {
      const type = this.parseTypeExpr();
      return { kind: 'TypeConstraint', name, type };
    }

    const op = this.parseComparisonOp();
    const value = this.parseExpr();
    return { kind: 'ValueConstraint', name, op, value };
  }

  private parseComparisonOp(): '==' | '!=' | '<' | '<=' | '>' | '>=' {
    if (this.match(TokenKind.EqEq)) return '==';
    if (this.match(TokenKind.BangEq)) return '!=';
    if (this.match(TokenKind.Lt)) return '<';
    if (this.match(TokenKind.LtEq)) return '<=';
    if (this.match(TokenKind.Gt)) return '>';
    if (this.match(TokenKind.GtEq)) return '>=';
    throw this.error('Expected comparison operator');
  }

  // ==================== Type Expressions ====================

  parseTypeExpr(): TypeExpr {
    let type = this.parsePrimaryType();

    while (this.match(TokenKind.LBracket)) {
      const size = this.parseExpr();
      const end = this.expect(TokenKind.RBracket, "Expected ']'").span;

      type = {
        kind: 'ArrayType',
        elementType: type,
        size,
        span: this.mergeSpans(type.span, end),
      };
    }

    return type;
  }

  private parsePrimaryType(): TypeExpr {
    const start = this.currentSpan();

    if (this.match(TokenKind.Bit)) {
      let width: Expr | undefined;
      if (this.match(TokenKind.LBracket)) {
        width = this.parseExpr();
        this.expect(TokenKind.RBracket, "Expected ']'");
      }
      return {
        kind: 'PrimitiveType',
        type: 'bit',
        width,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.Int)) {
      this.expect(TokenKind.LBracket, "Expected '[' for int type");
      const width = this.parseExpr();
      this.expect(TokenKind.RBracket, "Expected ']'");
      return {
        kind: 'PrimitiveType',
        type: 'int',
        width,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.Uint)) {
      this.expect(TokenKind.LBracket, "Expected '[' for uint type");
      const width = this.parseExpr();
      this.expect(TokenKind.RBracket, "Expected ']'");
      return {
        kind: 'PrimitiveType',
        type: 'uint',
        width,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.Bool)) {
      return {
        kind: 'PrimitiveType',
        type: 'bool',
        width: undefined,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.Clock)) {
      return {
        kind: 'PrimitiveType',
        type: 'clock',
        width: undefined,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.Reset)) {
      return {
        kind: 'PrimitiveType',
        type: 'reset',
        width: undefined,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.String)) {
      return {
        kind: 'PrimitiveType',
        type: 'string',
        width: undefined,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    if (this.match(TokenKind.LParen)) {
      const elements: TypeExpr[] = [];
      if (!this.check(TokenKind.RParen)) {
        do {
          elements.push(this.parseTypeExpr());
        } while (this.match(TokenKind.Comma));
      }
      const end = this.expect(TokenKind.RParen, "Expected ')'").span;
      return {
        kind: 'TupleType',
        elements,
        span: this.mergeSpans(start, end),
      };
    }

    // Array type: [Type; Size]
    if (this.match(TokenKind.LBracket)) {
      const elementType = this.parseTypeExpr();
      this.expect(TokenKind.Semi, "Expected ';'");
      const size = this.parseExpr();
      const end = this.expect(TokenKind.RBracket, "Expected ']'").span;
      return {
        kind: 'ArrayType',
        elementType,
        size,
        span: this.mergeSpans(start, end),
      };
    }

    const path = this.parsePath();
    const genericArgs = this.parseGenericArgs();

    if (genericArgs) {
      return {
        kind: 'GenericType',
        path,
        args: genericArgs,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    return {
      kind: 'UserType',
      path,
      span: this.mergeSpans(start, this.previousSpan()),
    };
  }

  // ==================== Expressions ====================

  parseExpr(): Expr {
    return this.parseBinaryExpr(0);
  }

  private parseBinaryExpr(minPrec: number): Expr {
    let left = this.parseUnaryExpr();

    while (true) {
      const op = TOKEN_TO_BINARY_OP[this.peek().kind];
      if (!op) break;

      const prec = PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;

      this.advance();
      const right = this.parseBinaryExpr(prec + 1);

      left = {
        kind: 'BinaryExpr',
        op,
        left,
        right,
        span: this.mergeSpans(left.span, right.span),
      };
    }

    return left;
  }

  private parseUnaryExpr(): Expr {
    const op = TOKEN_TO_UNARY_OP[this.peek().kind];
    if (op) {
      const start = this.advance().span;
      const operand = this.parseUnaryExpr();
      return {
        kind: 'UnaryExpr',
        op,
        operand,
        span: this.mergeSpans(start, operand.span),
      };
    }

    return this.parsePostfixExpr();
  }

  private parsePostfixExpr(): Expr {
    let expr = this.parsePrimaryExpr();

    while (true) {
      if (this.match(TokenKind.LParen)) {
        const args: Expr[] = [];
        if (!this.check(TokenKind.RParen)) {
          do {
            args.push(this.parseExpr());
          } while (this.match(TokenKind.Comma));
        }
        const end = this.expect(TokenKind.RParen, "Expected ')'").span;
        expr = {
          kind: 'CallExpr',
          callee: expr,
          args,
          span: this.mergeSpans(expr.span, end),
        };
      } else if (this.match(TokenKind.LBracket)) {
        const index = this.parseExpr();
        let endIndex: Expr | undefined;
        if (this.match(TokenKind.Colon)) {
          endIndex = this.parseExpr();
        }
        const end = this.expect(TokenKind.RBracket, "Expected ']'").span;
        expr = {
          kind: 'IndexExpr',
          base: expr,
          index,
          endIndex,
          span: this.mergeSpans(expr.span, end),
        };
      } else if (this.match(TokenKind.Dot)) {
        const field = this.parseIdentifier();
        expr = {
          kind: 'FieldExpr',
          base: expr,
          field,
          span: this.mergeSpans(expr.span, field.span),
        };
      } else if (this.match(TokenKind.As)) {
        const targetType = this.parseTypeExpr();
        expr = {
          kind: 'CastExpr',
          expr,
          targetType,
          span: this.mergeSpans(expr.span, targetType.span),
        };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimaryExpr(): Expr {
    const start = this.currentSpan();

    if (this.match(TokenKind.LParen)) {
      const expr = this.parseExpr();
      const end = this.expect(TokenKind.RParen, "Expected ')'").span;
      return {
        kind: 'ParenExpr',
        expr,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.LBrace)) {
      return this.parseConcatOrRepeat(start);
    }

    if (this.match(TokenKind.If)) {
      return this.parseIfExpr(start);
    }

    if (this.match(TokenKind.Match)) {
      return this.parseMatchExpr(start);
    }

    if (this.checkAny(TokenKind.IntegerLiteral, TokenKind.StringLiteral,
      TokenKind.True, TokenKind.False)) {
      return this.parseLiteral();
    }

    if (this.check(TokenKind.Identifier)) {
      const path = this.parsePath();
      if (path.segments.length === 1) {
        const seg = path.segments[0];
        if (seg) {
          return {
            kind: 'IdentifierExpr',
            name: seg,
            span: path.span,
          };
        }
      }
      return {
        kind: 'PathExpr',
        path,
        span: path.span,
      };
    }

    throw this.error('Expected expression');
  }

  private parseConcatOrRepeat(start: SourceSpan): Expr {
    // Check for repeat expression: {count{expr}}
    // After {, if we see expr followed by {, it's a repeat
    const first = this.parseExpr();

    if (this.match(TokenKind.LBrace)) {
      // Repeat expression: {count{expr}}
      const expr = this.parseExpr();
      this.expect(TokenKind.RBrace, "Expected '}'");
      const end = this.expect(TokenKind.RBrace, "Expected '}'").span;
      return {
        kind: 'RepeatExpr',
        expr,
        count: first,
        span: this.mergeSpans(start, end),
      };
    }

    const elements: Expr[] = [first];
    while (this.match(TokenKind.Comma)) {
      elements.push(this.parseExpr());
    }
    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'ConcatExpr',
      elements,
      span: this.mergeSpans(start, end),
    };
  }

  private parseIfExpr(start: SourceSpan): IfExpr {
    const condition = this.parseExpr();
    this.expect(TokenKind.LBrace, "Expected '{'");
    const thenExpr = this.parseExpr();
    this.expect(TokenKind.RBrace, "Expected '}'");
    this.expect(TokenKind.Else, "Expected 'else'");
    this.expect(TokenKind.LBrace, "Expected '{'");
    const elseExpr = this.parseExpr();
    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'IfExpr',
      condition,
      thenExpr,
      elseExpr,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMatchExpr(start: SourceSpan): MatchExpr {
    const scrutinee = this.parseExpr();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const arms: MatchArm[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      arms.push(this.parseMatchArm());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'MatchExpr',
      scrutinee,
      arms,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMatchArm(): MatchArm {
    const start = this.currentSpan();
    const pattern = this.parsePattern();
    this.expect(TokenKind.FatArrow, "Expected '=>'");

    let body: Expr | Stmt[];
    if (this.check(TokenKind.LBrace)) {
      body = this.parseBlock();
      // Optional comma after block
      this.match(TokenKind.Comma);
    } else {
      // Parse as assignment or expression (without trailing semicolon)
      const stmt = this.parseMatchArmStmt();
      body = [stmt];
      // Comma is optional for last arm
      if (!this.check(TokenKind.RBrace)) {
        this.expect(TokenKind.Comma, "Expected ','");
      } else {
        this.match(TokenKind.Comma);
      }
    }

    const end = this.previousSpan();

    return {
      kind: 'MatchArm',
      pattern,
      body,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMatchArmStmt(): Stmt {
    const start = this.currentSpan();
    const expr = this.parseExpr();

    if (this.match(TokenKind.Eq)) {
      const lvalue = this.exprToLValue(expr);
      const value = this.parseExpr();

      return {
        kind: 'AssignStmt',
        lvalue,
        value,
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    return {
      kind: 'ExprStmt',
      expr,
      span: this.mergeSpans(start, this.previousSpan()),
    };
  }

  parseLiteral(): Literal {
    if (this.match(TokenKind.IntegerLiteral)) {
      return this.parseIntegerLiteral(this.previous());
    }

    if (this.match(TokenKind.StringLiteral)) {
      const token = this.previous();
      const raw = token.text;
      const value = raw.slice(1, -1).replace(/\\(.)/g, (_, c: string) => {
        switch (c) {
          case 'n': return '\n';
          case 'r': return '\r';
          case 't': return '\t';
          case '\\': return '\\';
          case '"': return '"';
          case '0': return '\0';
          default: return c;
        }
      });
      return {
        kind: 'StringLiteral',
        value,
        raw,
        span: token.span,
      };
    }

    if (this.match(TokenKind.True)) {
      return {
        kind: 'BoolLiteral',
        value: true,
        span: this.previousSpan(),
      };
    }

    if (this.match(TokenKind.False)) {
      return {
        kind: 'BoolLiteral',
        value: false,
        span: this.previousSpan(),
      };
    }

    throw this.error('Expected literal');
  }

  private parseIntegerLiteral(token: Token): IntegerLiteral {
    const raw = token.text;
    let value: bigint;
    let width: number | undefined;
    let base: 'b' | 'o' | 'd' | 'h' | undefined;

    // Match format with quote: 32'h00000000
    const sizedMatchWithQuote = /^(\d+)'([bodh])(.+)$/i.exec(raw);
    // Match format without quote: 32h00000000, 32h_00000000
    const sizedMatchWithoutQuote = /^(\d+)([bodh])(.+)$/i.exec(raw);

    if (sizedMatchWithQuote) {
      width = parseInt(sizedMatchWithQuote[1] ?? '0', 10);
      base = (sizedMatchWithQuote[2] ?? 'd').toLowerCase() as 'b' | 'o' | 'd' | 'h';
      const digits = (sizedMatchWithQuote[3] ?? '0').replace(/_/g, '');

      const radix = { b: 2, o: 8, d: 10, h: 16 }[base];
      value = BigInt(parseInt(digits, radix));
    } else if (sizedMatchWithoutQuote) {
      width = parseInt(sizedMatchWithoutQuote[1] ?? '0', 10);
      base = (sizedMatchWithoutQuote[2] ?? 'd').toLowerCase() as 'b' | 'o' | 'd' | 'h';
      const digits = (sizedMatchWithoutQuote[3] ?? '0').replace(/_/g, '');

      const radix = { b: 2, o: 8, d: 10, h: 16 }[base];
      value = BigInt(parseInt(digits, radix));
    } else {
      value = BigInt(raw.replace(/_/g, ''));
    }

    return {
      kind: 'IntegerLiteral',
      value,
      width,
      base,
      raw,
      span: token.span,
    };
  }

  // ==================== Patterns ====================

  parsePattern(): Pattern {
    const start = this.currentSpan();

    if (this.match(TokenKind.Underscore)) {
      return {
        kind: 'WildcardPattern',
        span: this.previousSpan(),
      };
    }

    if (this.match(TokenKind.LParen)) {
      const elements: Pattern[] = [];
      if (!this.check(TokenKind.RParen)) {
        do {
          elements.push(this.parsePattern());
        } while (this.match(TokenKind.Comma));
      }
      const end = this.expect(TokenKind.RParen, "Expected ')'").span;
      return {
        kind: 'TuplePattern',
        elements,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.checkAny(TokenKind.IntegerLiteral, TokenKind.StringLiteral,
      TokenKind.True, TokenKind.False)) {
      const literal = this.parseLiteral();

      if (this.match(TokenKind.DotDot)) {
        const inclusive = this.match(TokenKind.Eq);
        const endExpr = this.parseExpr();
        return {
          kind: 'RangePattern',
          start: literal,
          end: endExpr,
          inclusive,
          span: this.mergeSpans(start, this.previousSpan()),
        };
      }

      return {
        kind: 'LiteralPattern',
        literal,
        span: literal.span,
      };
    }

    if (this.check(TokenKind.Identifier)) {
      const path = this.parsePath();

      if (this.match(TokenKind.LBrace)) {
        const fields: FieldPattern[] = [];
        if (!this.check(TokenKind.RBrace)) {
          do {
            fields.push(this.parseFieldPattern());
          } while (this.match(TokenKind.Comma));
        }
        const end = this.expect(TokenKind.RBrace, "Expected '}'").span;
        return {
          kind: 'StructPattern',
          path,
          fields,
          span: this.mergeSpans(start, end),
        };
      }

      if (path.segments.length === 1) {
        const seg = path.segments[0];
        if (seg) {
          return {
            kind: 'IdentifierPattern',
            name: seg,
            span: path.span,
          };
        }
      }

      return {
        kind: 'PathPattern',
        path,
        span: path.span,
      };
    }

    throw this.error('Expected pattern');
  }

  private parseFieldPattern(): FieldPattern {
    const start = this.currentSpan();
    const name = this.parseIdentifier();

    let pattern: Pattern | undefined;
    if (this.match(TokenKind.Colon)) {
      pattern = this.parsePattern();
    }

    const end = this.previousSpan();

    return {
      kind: 'FieldPattern',
      name,
      pattern,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Statements ====================

  parseStmt(): Stmt {
    const start = this.currentSpan();

    if (this.match(TokenKind.Let)) {
      return this.parseLetStmt(start);
    }

    if (this.match(TokenKind.Var)) {
      return this.parseVarStmt(start);
    }

    if (this.match(TokenKind.If)) {
      return this.parseIfStmt(start);
    }

    if (this.match(TokenKind.Match)) {
      return this.parseMatchStmt(start);
    }

    if (this.match(TokenKind.For)) {
      return this.parseForStmt(start);
    }

    if (this.match(TokenKind.While)) {
      return this.parseWhileStmt(start);
    }

    if (this.match(TokenKind.Return)) {
      return this.parseReturnStmt(start);
    }

    if (this.check(TokenKind.LBrace)) {
      return {
        kind: 'BlockStmt',
        statements: this.parseBlock(),
        span: this.mergeSpans(start, this.previousSpan()),
      };
    }

    return this.parseAssignOrExprStmt(start);
  }

  private parseLetStmt(start: SourceSpan): LetStmt {
    const mutable = this.match(TokenKind.Mut);
    const name = this.parseIdentifier();

    let type: TypeExpr | undefined;
    if (this.match(TokenKind.Colon)) {
      type = this.parseTypeExpr();
    }

    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseExpr();
    }

    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'LetStmt',
      mutable,
      name,
      type,
      init,
      span: this.mergeSpans(start, end),
    };
  }

  private parseVarStmt(start: SourceSpan): VarStmt {
    const name = this.parseIdentifier();

    let type: TypeExpr | undefined;
    if (this.match(TokenKind.Colon)) {
      type = this.parseTypeExpr();
    }

    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseExpr();
    }

    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'VarStmt',
      name,
      type,
      init,
      span: this.mergeSpans(start, end),
    };
  }

  private parseIfStmt(start: SourceSpan): IfStmt {
    const condition = this.parseExpr();
    const thenBranch = this.parseBlock();

    let elseBranch: Stmt[] | IfStmt | undefined;
    if (this.match(TokenKind.Else)) {
      if (this.match(TokenKind.If)) {
        elseBranch = this.parseIfStmt(this.previousSpan());
      } else {
        elseBranch = this.parseBlock();
      }
    }

    const end = this.previousSpan();

    return {
      kind: 'IfStmt',
      condition,
      thenBranch,
      elseBranch,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMatchStmt(start: SourceSpan): MatchStmt {
    const scrutinee = this.parseExpr();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const arms: MatchArm[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      arms.push(this.parseMatchArm());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'MatchStmt',
      scrutinee,
      arms,
      span: this.mergeSpans(start, end),
    };
  }

  private parseForStmt(start: SourceSpan): ForStmt {
    const variable = this.parseIdentifier();
    this.expect(TokenKind.In, "Expected 'in'");

    const startExpr = this.parseExpr();

    let inclusive = false;
    if (this.match(TokenKind.DotDotEq)) {
      inclusive = true;
    } else {
      this.expect(TokenKind.DotDot, "Expected '..' or '..='");
    }

    const endExpr = this.parseExpr();
    const body = this.parseBlock();
    const end = this.previousSpan();

    return {
      kind: 'ForStmt',
      variable,
      start: startExpr,
      end: endExpr,
      inclusive,
      body,
      span: this.mergeSpans(start, end),
    };
  }

  private parseWhileStmt(start: SourceSpan): WhileStmt {
    const condition = this.parseExpr();
    const body = this.parseBlock();
    const end = this.previousSpan();

    return {
      kind: 'WhileStmt',
      condition,
      body,
      span: this.mergeSpans(start, end),
    };
  }

  private parseReturnStmt(start: SourceSpan): ReturnStmt {
    let value: Expr | undefined;
    if (!this.check(TokenKind.Semi)) {
      value = this.parseExpr();
    }
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'ReturnStmt',
      value,
      span: this.mergeSpans(start, end),
    };
  }

  private parseAssignOrExprStmt(start: SourceSpan): Stmt {
    const expr = this.parseExpr();

    if (this.match(TokenKind.Eq)) {
      const lvalue = this.exprToLValue(expr);
      const value = this.parseExpr();
      const end = this.expect(TokenKind.Semi, "Expected ';'").span;

      return {
        kind: 'AssignStmt',
        lvalue,
        value,
        span: this.mergeSpans(start, end),
      };
    }

    const end = this.expect(TokenKind.Semi, "Expected ';'").span;
    return {
      kind: 'ExprStmt',
      expr,
      span: this.mergeSpans(start, end),
    };
  }

  private exprToLValue(expr: Expr): LValue {
    switch (expr.kind) {
      case 'IdentifierExpr':
        return { kind: 'IdentifierLValue', name: expr.name };
      case 'IndexExpr':
        return {
          kind: 'IndexLValue',
          base: this.exprToLValue(expr.base),
          index: expr.index,
          endIndex: expr.endIndex,
        };
      case 'FieldExpr':
        return {
          kind: 'FieldLValue',
          base: this.exprToLValue(expr.base),
          field: expr.field,
        };
      case 'ConcatExpr':
        return {
          kind: 'ConcatLValue',
          elements: expr.elements.map((e) => this.exprToLValue(e)),
        };
      default:
        throw this.error('Invalid left-hand side of assignment');
    }
  }

  private parseBlock(): Stmt[] {
    this.expect(TokenKind.LBrace, "Expected '{'");
    const statements: Stmt[] = [];

    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      statements.push(this.parseStmt());
    }

    this.expect(TokenKind.RBrace, "Expected '}'");
    return statements;
  }

  // ==================== Module Definition ====================

  private parseModDef(visibility: Visibility, attributes?: Attribute[]): ModDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Mod, "Expected 'mod'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();
    const whereClause = this.parseWhereClause();

    this.expect(TokenKind.LParen, "Expected '('");
    const ports: PortDecl[] = [];
    if (!this.check(TokenKind.RParen)) {
      do {
        ports.push(this.parsePortDecl());
      } while (this.match(TokenKind.Comma));
    }
    this.expect(TokenKind.RParen, "Expected ')'");

    this.expect(TokenKind.LBrace, "Expected '{'");
    const items: ModItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      items.push(this.parseModItem());
    }
    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'ModDef',
      visibility,
      attributes,
      name,
      genericParams,
      whereClause,
      ports,
      items,
      span: this.mergeSpans(start, end),
    };
  }

  private parsePortDecl(): PortDecl {
    const start = this.currentSpan();
    const direction = this.parsePortDirection();
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const type = this.parseTypeExpr();
    const end = this.previousSpan();

    return {
      kind: 'PortDecl',
      direction,
      name,
      type,
      span: this.mergeSpans(start, end),
    };
  }

  private parsePortDirection(): PortDirection {
    if (this.match(TokenKind.In)) return 'in';
    if (this.match(TokenKind.Out)) return 'out';
    if (this.match(TokenKind.Inout)) return 'inout';
    if (this.match(TokenKind.Initiator)) return 'initiator';
    if (this.match(TokenKind.Target)) return 'target';
    if (this.match(TokenKind.Monitor)) return 'monitor';
    throw this.error('Expected port direction');
  }

  private parseModItem(): ModItem {
    const start = this.currentSpan();

    if (this.match(TokenKind.Let)) {
      const mutable = this.match(TokenKind.Mut);
      const name = this.parseIdentifier();
      let type: TypeExpr | undefined;
      if (this.match(TokenKind.Colon)) {
        type = this.parseTypeExpr();
      }
      let init: Expr | undefined;
      if (this.match(TokenKind.Eq)) {
        init = this.parseExpr();
      }
      const end = this.expect(TokenKind.Semi, "Expected ';'").span;

      return {
        kind: 'SignalDecl',
        declKind: 'let',
        mutable,
        name,
        type,
        init,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.Var)) {
      const name = this.parseIdentifier();
      let type: TypeExpr | undefined;
      if (this.match(TokenKind.Colon)) {
        type = this.parseTypeExpr();
      }
      let init: Expr | undefined;
      if (this.match(TokenKind.Eq)) {
        init = this.parseExpr();
      }
      const end = this.expect(TokenKind.Semi, "Expected ';'").span;

      return {
        kind: 'SignalDecl',
        declKind: 'var',
        mutable: false,
        name,
        type,
        init,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.Const)) {
      const name = this.parseIdentifier();
      this.expect(TokenKind.Colon, "Expected ':'");
      const type = this.parseTypeExpr();
      this.expect(TokenKind.Eq, "Expected '='");
      const init = this.parseExpr();
      const end = this.expect(TokenKind.Semi, "Expected ';'").span;

      return {
        kind: 'ConstDecl',
        name,
        type,
        init,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.Type)) {
      const name = this.parseIdentifier();
      const genericParams = this.parseGenericParams();
      this.expect(TokenKind.Eq, "Expected '='");
      const type = this.parseTypeExpr();
      const end = this.expect(TokenKind.Semi, "Expected ';'").span;

      return {
        kind: 'TypeAlias',
        name,
        genericParams,
        type,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.Comb)) {
      const body = this.parseBlock();
      const end = this.previousSpan();

      return {
        kind: 'CombBlock',
        body,
        span: this.mergeSpans(start, end),
      };
    }

    if (this.match(TokenKind.Sync)) {
      return this.parseSyncBlock(start);
    }

    if (this.match(TokenKind.Fsm)) {
      return this.parseFsmBlock(start);
    }

    if (this.match(TokenKind.Mem)) {
      return this.parseMemDecl(start);
    }

    if (this.match(TokenKind.Inst)) {
      return this.parseInstDecl(start);
    }

    throw this.error('Expected module item');
  }

  private parseSyncBlock(start: SourceSpan): SyncBlock {
    this.expect(TokenKind.LParen, "Expected '('");
    const clock = this.parseClockSpec();

    let reset: ResetSpec | undefined;
    if (this.match(TokenKind.Comma)) {
      reset = this.parseResetSpec();
    }

    this.expect(TokenKind.RParen, "Expected ')'");
    const body = this.parseBlock();
    const end = this.previousSpan();

    return {
      kind: 'SyncBlock',
      clock,
      reset,
      body,
      span: this.mergeSpans(start, end),
    };
  }

  private parseClockSpec(): ClockSpec {
    const start = this.currentSpan();
    // Parse signal (identifier or path), then .posedge or .negedge
    const signal = this.parsePrimaryExpr();
    this.expect(TokenKind.Dot, "Expected '.'");

    let edge: 'posedge' | 'negedge';
    if (this.match(TokenKind.Posedge)) {
      edge = 'posedge';
    } else if (this.match(TokenKind.Negedge)) {
      edge = 'negedge';
    } else {
      throw this.error("Expected 'posedge' or 'negedge'");
    }

    const end = this.previousSpan();

    return {
      kind: 'ClockSpec',
      signal,
      edge,
      span: this.mergeSpans(start, end),
    };
  }

  private parseResetSpec(): ResetSpec {
    const start = this.currentSpan();
    // Parse signal (identifier or path), then .async or .sync
    const signal = this.parsePrimaryExpr();
    this.expect(TokenKind.Dot, "Expected '.'");

    let mode: 'async' | 'sync';
    if (this.match(TokenKind.Async)) {
      mode = 'async';
    } else if (this.match(TokenKind.Sync)) {
      mode = 'sync';
    } else {
      throw this.error("Expected 'async' or 'sync'");
    }

    const end = this.previousSpan();

    return {
      kind: 'ResetSpec',
      signal,
      mode,
      span: this.mergeSpans(start, end),
    };
  }

  private parseFsmBlock(start: SourceSpan): FsmBlock {
    const name = this.parseIdentifier();
    this.expect(TokenKind.LParen, "Expected '('");
    const clock = this.parseClockSpec();

    let reset: ResetSpec | undefined;
    if (this.match(TokenKind.Comma)) {
      reset = this.parseResetSpec();
    }

    this.expect(TokenKind.RParen, "Expected ')'");
    this.expect(TokenKind.LBrace, "Expected '{'");

    this.expect(TokenKind.State, "Expected 'state'");
    this.expect(TokenKind.Enum, "Expected 'enum'");
    const states = this.parseFsmStateEnum();

    this.expect(TokenKind.Transitions, "Expected 'transitions'");
    const transitions = this.parseTransitionsBlock();

    const outputs: OutputBlock[] = [];
    while (this.match(TokenKind.Output)) {
      outputs.push(this.parseOutputBlock());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'FsmBlock',
      name,
      clock,
      reset,
      states,
      transitions,
      outputs,
      span: this.mergeSpans(start, end),
    };
  }

  private parseFsmStateEnum(): FsmStateEnum {
    const start = this.currentSpan();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const states: FsmStateItem[] = [];
    if (!this.check(TokenKind.RBrace)) {
      do {
        states.push(this.parseFsmStateItem());
      } while (this.match(TokenKind.Comma));
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'FsmStateEnum',
      states,
      span: this.mergeSpans(start, end),
    };
  }

  private parseFsmStateItem(): FsmStateItem {
    const start = this.currentSpan();
    const name = this.parseIdentifier();

    let outputs: { name: Identifier; value: Expr }[] | undefined;
    if (this.match(TokenKind.LBracket)) {
      outputs = [];
      if (!this.check(TokenKind.RBracket)) {
        do {
          const outName = this.parseIdentifier();
          this.expect(TokenKind.Eq, "Expected '='");
          const outValue = this.parseExpr();
          outputs.push({ name: outName, value: outValue });
        } while (this.match(TokenKind.Comma));
      }
      this.expect(TokenKind.RBracket, "Expected ']'");
    }

    const end = this.previousSpan();

    return {
      kind: 'FsmStateItem',
      name,
      outputs,
      span: this.mergeSpans(start, end),
    };
  }

  private parseTransitionsBlock(): TransitionsBlock {
    const start = this.currentSpan();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const items: TransitionItem[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      items.push(this.parseTransitionItem());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'TransitionsBlock',
      items,
      span: this.mergeSpans(start, end),
    };
  }

  private parseTransitionItem(): TransitionItem {
    const start = this.currentSpan();

    let state: Identifier | '_';
    if (this.match(TokenKind.Underscore)) {
      state = '_';
    } else {
      state = this.parseIdentifier();
    }

    this.expect(TokenKind.FatArrow, "Expected '=>'");
    this.expect(TokenKind.LBrace, "Expected '{'");

    const clauses: WhenClause[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      clauses.push(this.parseWhenClause());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'TransitionItem',
      state,
      clauses,
      span: this.mergeSpans(start, end),
    };
  }

  private parseWhenClause(): WhenClause {
    const start = this.currentSpan();
    this.expect(TokenKind.When, "Expected 'when'");
    const condition = this.parseExpr();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const actions: TransitionAction[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      if (this.match(TokenKind.Goto)) {
        const target = this.parseIdentifier();
        this.expect(TokenKind.Semi, "Expected ';'");
        actions.push({ kind: 'GotoAction', target, span: this.mergeSpans(start, this.previousSpan()) });
      } else {
        const stmt = this.parseStmt();
        actions.push({ kind: 'StmtAction', stmt });
      }
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'WhenClause',
      condition,
      actions,
      span: this.mergeSpans(start, end),
    };
  }

  private parseOutputBlock(): OutputBlock {
    const start = this.currentSpan();
    const signal = this.parseIdentifier();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const cases: OutputCase[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      const state = this.parseIdentifier();
      this.expect(TokenKind.FatArrow, "Expected '=>'");
      const value = this.parseExpr();
      this.expect(TokenKind.Comma, "Expected ','");
      cases.push({
        kind: 'OutputCase',
        state,
        value,
        span: this.mergeSpans(state.span, this.previousSpan()),
      });
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'OutputBlock',
      signal,
      cases,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMemDecl(start: SourceSpan): MemDecl {
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const elementType = this.parseTypeExpr();
    this.expect(TokenKind.LBracket, "Expected '['");
    const depth = this.parseExpr();
    this.expect(TokenKind.RBracket, "Expected ']'");

    let config: MemConfigItem[] | undefined;
    if (this.match(TokenKind.LBrace)) {
      config = [];
      while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
        config.push(this.parseMemConfigItem());
      }
      this.expect(TokenKind.RBrace, "Expected '}'");
    }

    let init: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      init = this.parseExpr();
    }

    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'MemDecl',
      name,
      elementType,
      depth,
      config,
      init,
      span: this.mergeSpans(start, end),
    };
  }

  private parseMemConfigItem(): MemConfigItem {
    const start = this.currentSpan();
    const keyToken = this.expect(TokenKind.Identifier, 'Expected config key');
    const key = keyToken.text as 'ports' | 'type' | 'read_mode' | 'write_mode' | 'init_file';
    this.expect(TokenKind.Colon, "Expected ':'");
    const value = this.parseExpr();
    this.match(TokenKind.Comma);
    const end = this.previousSpan();

    return {
      kind: 'MemConfigItem',
      key,
      value,
      span: this.mergeSpans(start, end),
    };
  }

  private parseInstDecl(start: SourceSpan): InstDecl {
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const module = this.parsePath();
    const genericArgs = this.parseGenericArgs();

    this.expect(TokenKind.LParen, "Expected '('");
    const connections: Connection[] = [];
    if (!this.check(TokenKind.RParen)) {
      do {
        connections.push(this.parseConnection());
      } while (this.match(TokenKind.Comma));
    }
    this.expect(TokenKind.RParen, "Expected ')'");
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'InstDecl',
      name,
      module,
      genericArgs,
      connections,
      span: this.mergeSpans(start, end),
    };
  }

  private parseConnection(): Connection {
    const start = this.currentSpan();
    this.expect(TokenKind.Dot, "Expected '.'");
    const port = this.parseIdentifier();
    this.expect(TokenKind.LParen, "Expected '('");
    const expr = this.parseExpr();
    const end = this.expect(TokenKind.RParen, "Expected ')'").span;

    return {
      kind: 'Connection',
      port,
      expr,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Type Definitions ====================

  private parseEnumDef(visibility: Visibility): EnumDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Enum, "Expected 'enum'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();

    this.expect(TokenKind.LBrace, "Expected '{'");
    const variants: EnumVariant[] = [];
    if (!this.check(TokenKind.RBrace)) {
      do {
        variants.push(this.parseEnumVariant());
      } while (this.match(TokenKind.Comma));
    }
    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'EnumDef',
      visibility,
      name,
      genericParams,
      variants,
      span: this.mergeSpans(start, end),
    };
  }

  private parseEnumVariant(): EnumVariant {
    const start = this.currentSpan();
    const name = this.parseIdentifier();

    let value: Expr | undefined;
    if (this.match(TokenKind.Eq)) {
      value = this.parseExpr();
    }

    const end = this.previousSpan();

    return {
      kind: 'EnumVariant',
      name,
      value,
      span: this.mergeSpans(start, end),
    };
  }

  private parseStructDef(visibility: Visibility): StructDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Struct, "Expected 'struct'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();

    this.expect(TokenKind.LBrace, "Expected '{'");
    const fields: StructField[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      fields.push(this.parseStructField());
    }
    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'StructDef',
      visibility,
      name,
      genericParams,
      fields,
      span: this.mergeSpans(start, end),
    };
  }

  private parseStructField(): StructField {
    const start = this.currentSpan();
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const type = this.parseTypeExpr();
    this.match(TokenKind.Comma);
    const end = this.previousSpan();

    return {
      kind: 'StructField',
      name,
      type,
      span: this.mergeSpans(start, end),
    };
  }

  private parseTypeAliasDef(visibility: Visibility): TypeAliasDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Type, "Expected 'type'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();
    this.expect(TokenKind.Eq, "Expected '='");
    const type = this.parseTypeExpr();
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'TypeAliasDef',
      visibility,
      name,
      genericParams,
      type,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Const Definition ====================

  private parseConstDef(visibility: Visibility): ConstDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Const, "Expected 'const'");
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const type = this.parseTypeExpr();
    this.expect(TokenKind.Eq, "Expected '='");
    const init = this.parseExpr();
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'ConstDef',
      visibility,
      name,
      type,
      init,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Function Definition ====================

  private parseFnDef(visibility: Visibility): FnDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Fn, "Expected 'fn'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();

    this.expect(TokenKind.LParen, "Expected '('");
    const params: FnParam[] = [];
    if (!this.check(TokenKind.RParen)) {
      do {
        params.push(this.parseFnParam());
      } while (this.match(TokenKind.Comma));
    }
    this.expect(TokenKind.RParen, "Expected ')'");

    let returnType: TypeExpr | undefined;
    if (this.match(TokenKind.Arrow)) {
      returnType = this.parseTypeExpr();
    }

    const body = this.parseBlock();
    const end = this.previousSpan();

    return {
      kind: 'FnDef',
      visibility,
      name,
      genericParams,
      params,
      returnType,
      body,
      span: this.mergeSpans(start, end),
    };
  }

  private parseFnParam(): FnParam {
    const start = this.currentSpan();
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const type = this.parseTypeExpr();
    const end = this.previousSpan();

    return {
      kind: 'FnParam',
      name,
      type,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Interface Definition ====================

  private parseInterfaceDef(visibility: Visibility): InterfaceDef {
    const start = this.currentSpan();
    this.expect(TokenKind.Interface, "Expected 'interface'");
    const name = this.parseIdentifier();
    const genericParams = this.parseGenericParams();

    this.expect(TokenKind.LBrace, "Expected '{'");
    const signals: InterfaceSignal[] = [];
    const views: ViewDef[] = [];

    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      if (this.check(TokenKind.View)) {
        views.push(this.parseViewDef());
      } else {
        signals.push(this.parseInterfaceSignal());
      }
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'InterfaceDef',
      visibility,
      name,
      genericParams,
      signals,
      views,
      span: this.mergeSpans(start, end),
    };
  }

  private parseInterfaceSignal(): InterfaceSignal {
    const start = this.currentSpan();
    const isLogic = this.match(TokenKind.Logic);
    const name = this.parseIdentifier();
    this.expect(TokenKind.Colon, "Expected ':'");
    const type = this.parseTypeExpr();
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'InterfaceSignal',
      isLogic,
      name,
      type,
      span: this.mergeSpans(start, end),
    };
  }

  private parseViewDef(): ViewDef {
    const start = this.currentSpan();
    this.expect(TokenKind.View, "Expected 'view'");
    const name = this.parseIdentifier();
    this.expect(TokenKind.LBrace, "Expected '{'");

    const signals: ViewSignal[] = [];
    while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
      signals.push(this.parseViewSignal());
    }

    const end = this.expect(TokenKind.RBrace, "Expected '}'").span;

    return {
      kind: 'ViewDef',
      name,
      signals,
      span: this.mergeSpans(start, end),
    };
  }

  private parseViewSignal(): ViewSignal {
    const start = this.currentSpan();
    const direction = this.parseViewDirection();
    const name = this.parseIdentifier();
    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'ViewSignal',
      direction,
      name,
      span: this.mergeSpans(start, end),
    };
  }

  private parseViewDirection(): 'in' | 'out' | 'inout' {
    if (this.match(TokenKind.In)) return 'in';
    if (this.match(TokenKind.Out)) return 'out';
    if (this.match(TokenKind.Inout)) return 'inout';
    throw this.error('Expected view direction');
  }

  // ==================== Package and Import ====================

  private parsePackageDecl(visibility: Visibility): PackageDecl {
    const start = this.currentSpan();
    this.expect(TokenKind.Package, "Expected 'package'");
    const path = this.parsePath();
    this.expect(TokenKind.Semi, "Expected ';'");

    const items: Item[] = [];
    while (!this.isAtEnd() && !this.check(TokenKind.Package)) {
      const item = this.parseItem();
      if (item) {
        items.push(item);
      }
    }

    const end = this.previousSpan();

    return {
      kind: 'PackageDecl',
      visibility,
      path,
      items,
      span: this.mergeSpans(start, end),
    };
  }

  private parseImportDecl(visibility: Visibility): ImportDecl {
    const start = this.currentSpan();
    this.expect(TokenKind.Import, "Expected 'import'");
    const path = this.parsePath();

    let items: ImportItem[] | '*' | undefined;
    let alias: Identifier | undefined;

    if (this.match(TokenKind.ColonColon)) {
      if (this.match(TokenKind.Star)) {
        items = '*';
      } else if (this.match(TokenKind.LBrace)) {
        items = [];
        if (!this.check(TokenKind.RBrace)) {
          do {
            items.push(this.parseImportItem());
          } while (this.match(TokenKind.Comma));
        }
        this.expect(TokenKind.RBrace, "Expected '}'");
      }
    }

    if (this.match(TokenKind.As)) {
      alias = this.parseIdentifier();
    }

    const end = this.expect(TokenKind.Semi, "Expected ';'").span;

    return {
      kind: 'ImportDecl',
      visibility,
      path,
      items,
      alias,
      span: this.mergeSpans(start, end),
    };
  }

  private parseImportItem(): ImportItem {
    const start = this.currentSpan();
    const name = this.parseIdentifier();

    let alias: Identifier | undefined;
    if (this.match(TokenKind.As)) {
      alias = this.parseIdentifier();
    }

    const end = this.previousSpan();

    return {
      kind: 'ImportItem',
      name,
      alias,
      span: this.mergeSpans(start, end),
    };
  }

  // ==================== Test Definition ====================

  private parseTestDef(visibility: Visibility, attributes: Attribute[]): TestDef {
    const start = attributes[0]?.span ?? this.currentSpan();
    this.expect(TokenKind.Fn, "Expected 'fn'");
    const name = this.parseIdentifier();
    this.expect(TokenKind.LParen, "Expected '('");
    this.expect(TokenKind.RParen, "Expected ')'");

    const params: TestParam[] = [];
    for (const attr of attributes) {
      if (attr.path.segments.some((s) => s.name === 'test') && attr.args) {
        for (const arg of attr.args) {
          if (arg.name?.name === 'timeout' && arg.value.kind === 'IntegerLiteral') {
            params.push({
              kind: 'TimeoutParam',
              value: Number(arg.value.value),
              unit: 'ns',
            });
          }
        }
      }
    }

    const bodyStmts = this.parseBlock();
    const body: TestStmt[] = bodyStmts;

    const end = this.previousSpan();

    return {
      kind: 'TestDef',
      visibility,
      name,
      params: params.length > 0 ? params : undefined,
      body,
      span: this.mergeSpans(start, end),
    };
  }
}

/**
 * Parse IRIS source code
 */
export function parse(source: string): ParseResult {
  const lexerResult = tokenizeWithoutTrivia(source);
  const parser = new Parser(lexerResult.tokens);
  const result = parser.parse();

  for (const err of lexerResult.errors) {
    result.errors.unshift({
      message: err.message,
      span: err.span,
    });
  }

  return result;
}

/**
 * Parse IRIS source code from tokens
 */
export function parseTokens(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  return parser.parse();
}
