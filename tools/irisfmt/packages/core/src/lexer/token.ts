/**
 * Token kinds for IRIS language
 */
export enum TokenKind {
  // Keywords
  Mod = 'mod',
  Pub = 'pub',
  Let = 'let',
  Var = 'var',
  Const = 'const',
  Fn = 'fn',
  If = 'if',
  Else = 'else',
  Match = 'match',
  For = 'for',
  While = 'while',
  Return = 'return',
  Type = 'type',
  Struct = 'struct',
  Union = 'union',
  Enum = 'enum',
  Interface = 'interface',
  Import = 'import',
  Package = 'package',
  Comb = 'comb',
  Sync = 'sync',
  Fsm = 'fsm',
  State = 'state',
  Transitions = 'transitions',
  When = 'when',
  Goto = 'goto',
  Mem = 'mem',
  In = 'in',
  Out = 'out',
  Inout = 'inout',
  As = 'as',
  Where = 'where',
  True = 'true',
  False = 'false',
  Mut = 'mut',
  Logic = 'logic',
  View = 'view',
  Output = 'output',
  Test = 'test',
  Assert = 'assert',
  Wait = 'wait',
  Sample = 'sample',
  Timeout = 'timeout',
  ShouldFail = 'should_fail',
  Ignore = 'ignore',
  Parametric = 'parametric',
  Initiator = 'initiator',
  Target = 'target',
  Monitor = 'monitor',
  Initial = 'initial',
  Seq = 'seq',
  Await = 'await',
  Extern = 'extern',

  // Type keywords
  Bit = 'bit',
  Int = 'int',
  Uint = 'uint',
  Bool = 'bool',
  Clock = 'clock',
  Reset = 'reset',
  String = 'string',

  // Edge/timing keywords
  Posedge = 'posedge',
  Negedge = 'negedge',
  Async = 'async',
  SyncReset = 'sync_reset',

  // Delimiters
  LParen = '(',
  RParen = ')',
  LBrace = '{',
  RBrace = '}',
  LBracket = '[',
  RBracket = ']',
  Comma = ',',
  Semicolon = ';',
  Colon = ':',
  ColonColon = '::',
  Dot = '.',
  Arrow = '->',
  FatArrow = '=>',
  Underscore = '_',

  // Operators
  Plus = '+',
  /** `+:` of a part select, `a[i +: 8]` */
  PlusColon = '+:',
  /** `-:` of a part select, `a[i -: 8]` */
  MinusColon = '-:',
  Minus = '-',
  Star = '*',
  Slash = '/',
  Percent = '%',
  Power = '**',
  Amp = '&',
  Pipe = '|',
  Caret = '^',
  Tilde = '~',
  Bang = '!',
  Shl = '<<',
  Shr = '>>',
  Ashr = '>>>',
  Eq = '=',
  EqEq = '==',
  Ne = '!=',
  Lt = '<',
  Le = '<=',
  Gt = '>',
  Ge = '>=',
  AmpAmp = '&&',
  PipePipe = '||',
  DotDot = '..',
  DotDotEq = '..=',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values -- Intentionally same as Le; context determines meaning
  NonBlockingAssign = '<=',

  // Literals
  IntLiteral = 'int_literal',
  StringLiteral = 'string_literal',

  // Identifier
  Ident = 'ident',

  // Attribute
  Hash = '#',

  // Comments
  LineComment = 'line_comment',
  BlockComment = 'block_comment',

  // Special
  Newline = 'newline',
  Whitespace = 'whitespace',
  Eof = 'eof',
  Invalid = 'invalid',
}

/**
 * Source location (1-indexed line and column)
 */
export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

/**
 * Source span (start and end locations)
 */
export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

/**
 * Trivia - whitespace, newlines, and comments attached to tokens
 */
export interface Trivia {
  kind: 'whitespace' | 'newline' | 'line_comment' | 'block_comment';
  text: string;
  span: SourceSpan;
}

/**
 * Token with position information and trivia
 */
export interface Token {
  kind: TokenKind;
  text: string;
  span: SourceSpan;
  leadingTrivia: Trivia[];
  trailingTrivia: Trivia[];
}

/**
 * Create an empty source location
 */
export function emptyLocation(): SourceLocation {
  return { line: 1, column: 1, offset: 0 };
}

/**
 * Create an empty source span
 */
export function emptySpan(): SourceSpan {
  return { start: emptyLocation(), end: emptyLocation() };
}
