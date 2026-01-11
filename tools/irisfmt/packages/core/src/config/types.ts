/**
 * IRIS Formatter Configuration Types
 */

/**
 * Format style configuration
 */
export interface FormatStyleConfig {
  /** Number of spaces per indentation level (default: 4) */
  indentWidth?: number;
  /** Use tabs instead of spaces (default: false) */
  useTabs?: boolean;
  /** Maximum line length (default: 100) */
  maxLineLength?: number;
  /** Brace style: 'same-line' or 'new-line' (default: 'same-line') */
  braceStyle?: 'same-line' | 'new-line';
  /** Trailing comma style (default: 'multi-line') */
  trailingComma?: 'none' | 'all' | 'multi-line';
}

/**
 * Lint rule severity
 */
export type LintSeverity = 'error' | 'warning' | 'info' | 'off';

/**
 * Lint rule configuration - can be just a severity or severity with options
 */
export type LintRuleConfig = LintSeverity | [LintSeverity, Record<string, unknown>];

/**
 * Lint configuration
 */
export interface LintConfig {
  /** Rule configurations */
  rules?: Record<string, LintRuleConfig>;
  /** Glob patterns to ignore */
  ignore?: string[];
}

/**
 * Complete IRISFMT configuration
 */
export interface IrisfmtConfig {
  /** Format style configuration */
  format?: FormatStyleConfig;
  /** Lint configuration */
  lint?: LintConfig;
}

/**
 * Default format style
 */
export const DEFAULT_FORMAT_STYLE: Required<FormatStyleConfig> = {
  indentWidth: 4,
  useTabs: false,
  maxLineLength: 100,
  braceStyle: 'same-line',
  trailingComma: 'multi-line',
};

/**
 * Default lint configuration
 */
export const DEFAULT_LINT_CONFIG: Required<LintConfig> = {
  rules: {},
  ignore: [],
};

/**
 * Default complete configuration
 */
export const DEFAULT_CONFIG: Required<IrisfmtConfig> = {
  format: DEFAULT_FORMAT_STYLE,
  lint: DEFAULT_LINT_CONFIG,
};
