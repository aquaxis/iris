/**
 * Error Formatter
 *
 * Formats diagnostic messages with source location highlighting.
 */

import type { SemanticDiagnostic, Severity } from '@iris2sv/analyzer';
import type { SourceSpan } from '@iris2sv/core';

/**
 * ANSI color codes
 */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Diagnostic for formatter (unified interface)
 */
export interface Diagnostic {
  severity: Severity;
  message: string;
  span: SourceSpan | undefined;
  code: string | undefined;
}

/**
 * Convert SemanticDiagnostic to Diagnostic
 */
export function fromSemanticDiagnostic(diag: SemanticDiagnostic): Diagnostic {
  return {
    severity: diag.severity,
    message: diag.message,
    span: diag.span,
    code: diag.code,
  };
}

/**
 * Formatter options
 */
export interface FormatterOptions {
  /** Enable color output */
  color: boolean;
  /** Show source context */
  showContext: boolean;
  /** Number of context lines to show */
  contextLines: number;
  /** Show error codes */
  showCodes: boolean;
}

/**
 * Default formatter options
 */
export const defaultFormatterOptions: FormatterOptions = {
  color: true,
  showContext: true,
  contextLines: 2,
  showCodes: true,
};

/**
 * Error Formatter
 */
export class ErrorFormatter {
  private readonly options: FormatterOptions;
  private readonly sourceCache = new Map<string, string[]>();

  constructor(options?: Partial<FormatterOptions>) {
    this.options = { ...defaultFormatterOptions, ...options };
  }

  /**
   * Set source content for a file
   */
  setSource(filename: string, content: string): void {
    this.sourceCache.set(filename, content.split('\n'));
  }

  /**
   * Format a single diagnostic
   */
  formatDiagnostic(diagnostic: Diagnostic, filename = '<unknown>'): string {
    const lines: string[] = [];

    // Header line: filename:line:column: severity: message
    const location = this.formatLocation(filename, diagnostic);
    const severity = this.formatSeverity(diagnostic.severity);
    const message = diagnostic.message;
    const code = this.options.showCodes && diagnostic.code
      ? this.color('gray', ` [${diagnostic.code}]`)
      : '';

    lines.push(`${location}: ${severity}: ${message}${code}`);

    // Source context
    if (this.options.showContext && diagnostic.span) {
      const context = this.formatContext(filename, diagnostic);
      if (context) {
        lines.push(...context);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format multiple diagnostics
   */
  formatDiagnostics(diagnostics: Diagnostic[], filename = '<unknown>'): string {
    if (diagnostics.length === 0) {
      return '';
    }

    const formatted = diagnostics.map(d => this.formatDiagnostic(d, filename));
    return formatted.join('\n\n');
  }

  /**
   * Format a summary of diagnostics
   */
  formatSummary(diagnostics: Diagnostic[]): string {
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const warnings = diagnostics.filter(d => d.severity === 'warning').length;
    const infos = diagnostics.filter(d => d.severity === 'info').length;

    const parts: string[] = [];

    if (errors > 0) {
      parts.push(this.color('red', `${errors} error${errors > 1 ? 's' : ''}`));
    }
    if (warnings > 0) {
      parts.push(this.color('yellow', `${warnings} warning${warnings > 1 ? 's' : ''}`));
    }
    if (infos > 0) {
      parts.push(this.color('blue', `${infos} info${infos > 1 ? 's' : ''}`));
    }

    if (parts.length === 0) {
      return this.color('cyan', 'No issues found.');
    }

    return `Found ${parts.join(', ')}.`;
  }

  /**
   * Format location
   */
  private formatLocation(filename: string, diagnostic: Diagnostic): string {
    if (!diagnostic.span) {
      return this.color('bold', filename);
    }

    const { startLine, startColumn } = diagnostic.span;
    return this.color('bold', `${filename}:${startLine}:${startColumn}`);
  }

  /**
   * Format severity label
   */
  private formatSeverity(severity: Severity): string {
    switch (severity) {
      case 'error':
        return this.color('red', 'error');
      case 'warning':
        return this.color('yellow', 'warning');
      case 'info':
        return this.color('blue', 'info');
      case 'hint':
        return this.color('cyan', 'hint');
    }
  }

  /**
   * Format source context with underline
   */
  private formatContext(filename: string, diagnostic: Diagnostic): string[] | null {
    if (!diagnostic.span) {
      return null;
    }

    const sourceLines = this.sourceCache.get(filename);
    if (!sourceLines) {
      return null;
    }

    const lines: string[] = [];
    const { startLine, endLine, startColumn, endColumn } = diagnostic.span;
    const contextStartLine = Math.max(1, startLine - this.options.contextLines);
    const contextEndLine = Math.min(sourceLines.length, endLine + this.options.contextLines);

    // Calculate line number width
    const lineNumWidth = String(contextEndLine).length;

    for (let lineNum = contextStartLine; lineNum <= contextEndLine; lineNum++) {
      const sourceLine = sourceLines[lineNum - 1] ?? '';
      const lineNumStr = String(lineNum).padStart(lineNumWidth);

      // Is this an error line?
      const isErrorLine = lineNum >= startLine && lineNum <= endLine;

      if (isErrorLine) {
        // Error line with marker
        lines.push(this.color('cyan', `${lineNumStr} | `) + sourceLine);

        // Underline
        const underlineStart = lineNum === startLine ? startColumn - 1 : 0;
        const underlineEnd = lineNum === endLine
          ? endColumn - 1
          : sourceLine.length;

        const underline = ' '.repeat(underlineStart) +
          this.color('red', '^'.repeat(Math.max(1, underlineEnd - underlineStart)));

        lines.push(this.color('cyan', `${' '.repeat(lineNumWidth)} | `) + underline);
      } else {
        // Context line
        lines.push(this.color('gray', `${lineNumStr} | ${sourceLine}`));
      }
    }

    return lines;
  }

  /**
   * Apply color if enabled
   */
  private color(colorName: keyof typeof colors, text: string): string {
    if (!this.options.color) {
      return text;
    }
    return `${colors[colorName]}${text}${colors.reset}`;
  }
}

/**
 * Create formatter
 */
export function createFormatter(options?: Partial<FormatterOptions>): ErrorFormatter {
  return new ErrorFormatter(options);
}

/**
 * Format a single diagnostic
 */
export function formatDiagnostic(
  diagnostic: Diagnostic,
  filename?: string,
  source?: string,
  options?: Partial<FormatterOptions>
): string {
  const formatter = createFormatter(options);
  if (source && filename) {
    formatter.setSource(filename, source);
  }
  return formatter.formatDiagnostic(diagnostic, filename);
}

/**
 * Format multiple diagnostics
 */
export function formatDiagnostics(
  diagnostics: Diagnostic[],
  filename?: string,
  source?: string,
  options?: Partial<FormatterOptions>
): string {
  const formatter = createFormatter(options);
  if (source && filename) {
    formatter.setSource(filename, source);
  }
  return formatter.formatDiagnostics(diagnostics, filename);
}
