import { Lexer, Parser } from '@irisfmt/core';
import type { SourceFile, Token } from '@irisfmt/core';
import { Printer } from './printer.js';
import * as fs from 'node:fs/promises';

export interface FormatStyle {
  indentWidth: number;
  useTabs: boolean;
  maxLineLength: number;
  braceStyle: 'same-line' | 'new-line';
  trailingComma: 'none' | 'all' | 'multi-line';
}

export interface FormatOptions {
  style?: Partial<FormatStyle>;
}

export const DEFAULT_STYLE: FormatStyle = {
  indentWidth: 4,
  useTabs: false,
  maxLineLength: 100,
  braceStyle: 'same-line',
  trailingComma: 'multi-line',
};

/**
 * Format IRIS source code
 */
export function format(source: string, options?: FormatOptions): string {
  const lexer = new Lexer(source);
  const { tokens } = lexer.tokenize();

  const parser = new Parser(tokens);
  const { ast } = parser.parse();

  const style: FormatStyle = {
    ...DEFAULT_STYLE,
    ...options?.style,
  };

  const printer = new Printer(style, tokens);
  return printer.print(ast);
}

/**
 * Format an IRIS source file
 */
export async function formatFile(
  filePath: string,
  options?: FormatOptions
): Promise<string> {
  const source = await fs.readFile(filePath, 'utf-8');
  return format(source, options);
}

/**
 * Format and write back to file
 */
export async function formatFileInPlace(
  filePath: string,
  options?: FormatOptions
): Promise<void> {
  const formatted = await formatFile(filePath, options);
  await fs.writeFile(filePath, formatted, 'utf-8');
}

/**
 * Check if file is formatted correctly
 */
export async function checkFile(
  filePath: string,
  options?: FormatOptions
): Promise<boolean> {
  const source = await fs.readFile(filePath, 'utf-8');
  const formatted = format(source, options);
  return source === formatted;
}
