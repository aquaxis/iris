/**
 * IRIS Lexer - Token Types
 *
 * This module defines all token types for the IRIS language lexer.
 * Based on the IRIS EBNF grammar specification.
 */

/**
 * Source location information
 */
export interface SourceSpan {
  /** Start position (byte offset) */
  start: number;
  /** End position (byte offset) */
  end: number;
  /** Start line number (1-based) */
  startLine: number;
  /** Start column number (1-based) */
  startColumn: number;
  /** End line number (1-based) */
  endLine: number;
  /** End column number (1-based) */
  endColumn: number;
}

/**
 * Token kinds for the IRIS language
 */
export enum TokenKind {
  // === Literals ===
  /** Integer literal (e.g., 42, 8'hFF, 32'b1010) */
  IntegerLiteral = 'IntegerLiteral',
  /** String literal (e.g., "hello") */
  StringLiteral = 'StringLiteral',
  /** Boolean true */
  True = 'True',
  /** Boolean false */
  False = 'False',

  // === Identifiers ===
  /** Identifier (e.g., foo, bar_baz) */
  Identifier = 'Identifier',

  // === Keywords - Module & Structure ===
  /** mod keyword */
  Mod = 'Mod',
  /** pub keyword */
  Pub = 'Pub',
  /** fn keyword */
  Fn = 'Fn',
  /** interface keyword */
  Interface = 'Interface',
  /** package keyword */
  Package = 'Package',
  /** import keyword */
  Import = 'Import',
  /** test keyword */
  Test = 'Test',

  // === Keywords - Types ===
  /** type keyword */
  Type = 'Type',
  /** struct keyword */
  Struct = 'Struct',
  /** enum keyword */
  Enum = 'Enum',
  /** bit keyword */
  Bit = 'Bit',
  /** int keyword */
  Int = 'Int',
  /** uint keyword */
  Uint = 'Uint',
  /** bool keyword */
  Bool = 'Bool',
  /** clock keyword */
  Clock = 'Clock',
  /** reset keyword */
  Reset = 'Reset',
  /** string keyword */
  String = 'String',

  // === Keywords - Declarations ===
  /** let keyword */
  Let = 'Let',
  /** var keyword */
  Var = 'Var',
  /** mut keyword */
  Mut = 'Mut',
  /** const keyword */
  Const = 'Const',

  // === Keywords - Control Flow ===
  /** if keyword */
  If = 'If',
  /** else keyword */
  Else = 'Else',
  /** match keyword */
  Match = 'Match',
  /** for keyword */
  For = 'For',
  /** while keyword */
  While = 'While',
  /** return keyword */
  Return = 'Return',
  /** in keyword */
  In = 'In',

  // === Keywords - Logic Blocks ===
  /** comb keyword */
  Comb = 'Comb',
  /** sync keyword */
  Sync = 'Sync',
  /** fsm keyword */
  Fsm = 'Fsm',
  /** state keyword */
  State = 'State',
  /** transitions keyword */
  Transitions = 'Transitions',
  /** when keyword */
  When = 'When',
  /** goto keyword */
  Goto = 'Goto',
  /** output keyword */
  Output = 'Output',

  // === Keywords - Clock/Reset ===
  /** posedge keyword */
  Posedge = 'Posedge',
  /** negedge keyword */
  Negedge = 'Negedge',
  /** async keyword */
  Async = 'Async',

  // === Keywords - Port Direction ===
  /** out keyword (port direction) */
  Out = 'Out',
  /** inout keyword (port direction) */
  Inout = 'Inout',
  /** initiator keyword (port direction) */
  Initiator = 'Initiator',
  /** target keyword (port direction) */
  Target = 'Target',
  /** monitor keyword (port direction) */
  Monitor = 'Monitor',

  // === Keywords - Memory ===
  /** mem keyword */
  Mem = 'Mem',
  /** inst keyword (instance declaration) */
  Inst = 'Inst',

  // === Keywords - Interface ===
  /** logic keyword */
  Logic = 'Logic',
  /** view keyword */
  View = 'View',

  // === Keywords - Test ===
  /** assert keyword */
  Assert = 'Assert',
  /** wait keyword */
  Wait = 'Wait',
  /** sample keyword */
  Sample = 'Sample',
  /** initial keyword */
  Initial = 'Initial',
  /** seq keyword (sequential processing block) */
  Seq = 'Seq',
  /** await keyword */
  Await = 'Await',
  /** extern keyword */
  Extern = 'Extern',

  // === Keywords - Misc ===
  /** as keyword (cast) */
  As = 'As',
  /** where keyword (constraints) */
  Where = 'Where',

  // === Operators - Arithmetic ===
  /** + */
  Plus = 'Plus',
  /** - */
  Minus = 'Minus',
  /** * */
  Star = 'Star',
  /** / */
  Slash = 'Slash',
  /** % */
  Percent = 'Percent',
  /** ** */
  StarStar = 'StarStar',

  // === Operators - Bitwise ===
  /** & */
  Amp = 'Amp',
  /** | */
  Pipe = 'Pipe',
  /** ^ */
  Caret = 'Caret',
  /** ~ */
  Tilde = 'Tilde',
  /** << */
  LtLt = 'LtLt',
  /** >> */
  GtGt = 'GtGt',
  /** >>> */
  GtGtGt = 'GtGtGt',

  // === Operators - Comparison ===
  /** == */
  EqEq = 'EqEq',
  /** != */
  BangEq = 'BangEq',
  /** < */
  Lt = 'Lt',
  /** <= */
  LtEq = 'LtEq',
  /** > */
  Gt = 'Gt',
  /** >= */
  GtEq = 'GtEq',

  // === Operators - Logical ===
  /** && */
  AmpAmp = 'AmpAmp',
  /** || */
  PipePipe = 'PipePipe',
  /** ! */
  Bang = 'Bang',

  // === Operators - Assignment ===
  /** = */
  Eq = 'Eq',
  /** <= (non-blocking assignment in tests) */
  LtEqNonBlocking = 'LtEqNonBlocking',

  // === Delimiters - Brackets ===
  /** ( */
  LParen = 'LParen',
  /** ) */
  RParen = 'RParen',
  /** [ */
  LBracket = 'LBracket',
  /** ] */
  RBracket = 'RBracket',
  /** { */
  LBrace = 'LBrace',
  /** } */
  RBrace = 'RBrace',

  // === Delimiters - Punctuation ===
  /** : */
  Colon = 'Colon',
  /** ; */
  Semi = 'Semi',
  /** , */
  Comma = 'Comma',
  /** . */
  Dot = 'Dot',
  /** :: */
  ColonColon = 'ColonColon',
  /** => */
  FatArrow = 'FatArrow',
  /** -> */
  Arrow = 'Arrow',
  /** .. */
  DotDot = 'DotDot',
  /** ..= */
  DotDotEq = 'DotDotEq',
  /** #[ */
  HashLBracket = 'HashLBracket',
  /** # (for delay) */
  Hash = 'Hash',
  /** ' (for base specifier like 8'h) */
  Quote = 'Quote',
  /** _ (wildcard pattern) */
  Underscore = 'Underscore',

  // === Special Tokens ===
  /** End of file */
  Eof = 'Eof',
  /** Error token for recovery */
  Error = 'Error',
  /** Line comment (// ...) */
  LineComment = 'LineComment',
  /** Block comment (/* ... *\/) */
  BlockComment = 'BlockComment',
  /** Whitespace (spaces, tabs, newlines) */
  Whitespace = 'Whitespace',
}

/**
 * A single token produced by the lexer
 */
export interface Token {
  /** The kind of token */
  kind: TokenKind;
  /** The source text of the token */
  text: string;
  /** The source location of the token */
  span: SourceSpan;
}

/**
 * Keyword map for fast lookup
 */
export const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  // Module & Structure
  ['mod', TokenKind.Mod],
  ['pub', TokenKind.Pub],
  ['fn', TokenKind.Fn],
  ['interface', TokenKind.Interface],
  ['package', TokenKind.Package],
  ['import', TokenKind.Import],
  ['test', TokenKind.Test],

  // Types
  ['type', TokenKind.Type],
  ['struct', TokenKind.Struct],
  ['enum', TokenKind.Enum],
  ['bit', TokenKind.Bit],
  ['int', TokenKind.Int],
  ['uint', TokenKind.Uint],
  ['bool', TokenKind.Bool],
  ['clock', TokenKind.Clock],
  ['reset', TokenKind.Reset],
  ['string', TokenKind.String],

  // Declarations
  ['let', TokenKind.Let],
  ['var', TokenKind.Var],
  ['mut', TokenKind.Mut],
  ['const', TokenKind.Const],

  // Control Flow
  ['if', TokenKind.If],
  ['else', TokenKind.Else],
  ['match', TokenKind.Match],
  ['for', TokenKind.For],
  ['while', TokenKind.While],
  ['return', TokenKind.Return],
  ['in', TokenKind.In],

  // Logic Blocks
  ['comb', TokenKind.Comb],
  ['sync', TokenKind.Sync],
  ['fsm', TokenKind.Fsm],
  ['state', TokenKind.State],
  ['transitions', TokenKind.Transitions],
  ['when', TokenKind.When],
  ['goto', TokenKind.Goto],
  ['output', TokenKind.Output],

  // Clock/Reset
  ['posedge', TokenKind.Posedge],
  ['negedge', TokenKind.Negedge],
  ['async', TokenKind.Async],

  // Port Direction
  ['out', TokenKind.Out],
  ['inout', TokenKind.Inout],
  ['initiator', TokenKind.Initiator],
  ['target', TokenKind.Target],
  ['monitor', TokenKind.Monitor],

  // Memory
  ['mem', TokenKind.Mem],
  ['inst', TokenKind.Inst],

  // Interface
  ['logic', TokenKind.Logic],
  ['view', TokenKind.View],

  // Test
  ['assert', TokenKind.Assert],
  ['wait', TokenKind.Wait],
  ['sample', TokenKind.Sample],
  ['initial', TokenKind.Initial],
  ['seq', TokenKind.Seq],
  ['await', TokenKind.Await],
  ['extern', TokenKind.Extern],

  // Misc
  ['as', TokenKind.As],
  ['where', TokenKind.Where],

  // Boolean literals
  ['true', TokenKind.True],
  ['false', TokenKind.False],
]);

/**
 * Check if a token kind is a keyword
 */
export function isKeyword(kind: TokenKind): boolean {
  return (
    kind >= TokenKind.Mod &&
    kind <= TokenKind.Where &&
    kind !== TokenKind.Identifier
  );
}

/**
 * Check if a token kind is an operator
 */
export function isOperator(kind: TokenKind): boolean {
  return kind >= TokenKind.Plus && kind <= TokenKind.Bang;
}

/**
 * Check if a token kind is a delimiter
 */
export function isDelimiter(kind: TokenKind): boolean {
  return kind >= TokenKind.LParen && kind <= TokenKind.Underscore;
}

/**
 * Check if a token kind is trivia (whitespace or comment)
 */
export function isTrivia(kind: TokenKind): boolean {
  return (
    kind === TokenKind.Whitespace ||
    kind === TokenKind.LineComment ||
    kind === TokenKind.BlockComment
  );
}

/**
 * Create a source span
 */
export function createSpan(
  start: number,
  end: number,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceSpan {
  return {
    start,
    end,
    startLine,
    startColumn,
    endLine,
    endColumn,
  };
}

/**
 * Create a token
 */
export function createToken(
  kind: TokenKind,
  text: string,
  span: SourceSpan
): Token {
  return { kind, text, span };
}
