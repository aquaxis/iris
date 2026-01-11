/**
 * IRIS Lexer Module
 *
 * Exports all lexer-related types and functions.
 */

export {
  TokenKind,
  Token,
  SourceSpan,
  KEYWORDS,
  isKeyword,
  isOperator,
  isDelimiter,
  isTrivia,
  createSpan,
  createToken,
} from './token.js';

export {
  Lexer,
  LexerError,
  LexerResult,
  tokenize,
  tokenizeWithoutTrivia,
} from './lexer.js';
