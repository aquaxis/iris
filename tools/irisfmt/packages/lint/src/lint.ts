import { Lexer, Parser } from '@irisfmt/core';
import type { SourceFile } from '@irisfmt/core';
import type { LintRule, Diagnostic, LintContext, LintRuleConfig } from './rule.js';
import { noEmptyBlockRule, namingConventionRule, unusedImportRule, unusedVariableRule, unusedSignalRule, varContextRestrictionRule, duplicateImportRule, importOrderRule, deadCodeRule, complexityRule, seqMissingTimeoutRule } from './rules/index.js';
import * as fs from 'node:fs/promises';

export type { Diagnostic };
export type { Severity } from './rule.js';

export interface LintOptions {
  rules?: Record<string, 'error' | 'warning' | 'info' | 'off'>;
}

export interface LintResult {
  diagnostics: Diagnostic[];
  ast: SourceFile;
}

const defaultRules: LintRule[] = [
  noEmptyBlockRule,
  namingConventionRule,
  unusedImportRule,
  unusedVariableRule,
  unusedSignalRule,
  varContextRestrictionRule,
  duplicateImportRule,
  importOrderRule,
  deadCodeRule,
  complexityRule,
  seqMissingTimeoutRule,
];

/**
 * Lint IRIS source code
 */
export function lint(source: string, options?: LintOptions): LintResult {
  const lexer = new Lexer(source);
  const { tokens } = lexer.tokenize();

  const parser = new Parser(tokens);
  const { ast } = parser.parse();

  const diagnostics: Diagnostic[] = [];

  for (const rule of defaultRules) {
    const ruleConfig = options?.rules?.[rule.name];
    const severity = ruleConfig ?? rule.defaultSeverity;

    if (severity === 'off') {
      continue;
    }

    const ctx: LintContext = {
      ast,
      source,
      report(diagnostic: Diagnostic): void {
        diagnostics.push({
          ...diagnostic,
          severity,
        });
      },
      getConfig(): LintRuleConfig {
        return { severity };
      },
    };

    rule.check(ctx);
  }

  return { diagnostics, ast };
}

/**
 * Lint an IRIS source file
 */
export async function lintFile(
  filePath: string,
  options?: LintOptions
): Promise<LintResult> {
  const source = await fs.readFile(filePath, 'utf-8');
  return lint(source, options);
}
