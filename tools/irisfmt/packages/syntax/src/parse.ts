import { Lexer, Parser } from '@irisfmt/core';
import type { SourceFile, ParseError, LexerError } from '@irisfmt/core';
import * as fs from 'node:fs/promises';

export interface ParseOptions {
  includeTrivia?: boolean;
}

export interface ParseOutput {
  ast: SourceFile;
  errors: Array<ParseError | LexerError>;
}

/**
 * Parse IRIS source code into an AST
 */
export function parse(source: string, _options?: ParseOptions): ParseOutput {
  const lexer = new Lexer(source);
  const { tokens, errors: lexerErrors } = lexer.tokenize();

  const parser = new Parser(tokens);
  const { ast, errors: parseErrors } = parser.parse();

  return {
    ast,
    errors: [...lexerErrors, ...parseErrors],
  };
}

/**
 * Parse an IRIS source file
 */
export async function parseFile(
  filePath: string,
  options?: ParseOptions
): Promise<ParseOutput> {
  const source = await fs.readFile(filePath, 'utf-8');
  return parse(source, options);
}
