import type { SourceFile, SourceSpan } from '@irisfmt/core';

export type Severity = 'error' | 'warning' | 'info' | 'off';

export interface Diagnostic {
  rule: string;
  message: string;
  span: SourceSpan;
  severity: Severity;
  fix?: Fix;
}

export interface Fix {
  description: string;
  changes: TextChange[];
}

export interface TextChange {
  span: SourceSpan;
  newText: string;
}

export interface LintContext {
  ast: SourceFile;
  source: string;
  report(diagnostic: Diagnostic): void;
  getConfig(): LintRuleConfig;
}

export interface LintRuleConfig {
  severity: Severity;
  options?: Record<string, unknown>;
}

export interface LintRule {
  name: string;
  description: string;
  category: 'style' | 'correctness' | 'performance' | 'suspicious';
  defaultSeverity: Severity;
  check(ctx: LintContext): void;
}
