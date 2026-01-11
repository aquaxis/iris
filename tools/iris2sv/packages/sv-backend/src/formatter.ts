/**
 * SystemVerilog Code Formatter
 *
 * Provides formatting and beautification for generated SystemVerilog code.
 */

/**
 * Formatter options
 */
export interface FormatterOptions {
  /** Indentation string (default: 2 spaces) */
  indent: string;
  /** Maximum line length before wrapping (default: 80) */
  maxLineLength: number;
  /** Align port declarations */
  alignPorts: boolean;
  /** Align signal declarations */
  alignSignals: boolean;
  /** Align assignment operators */
  alignAssignments: boolean;
  /** Add blank lines between module sections */
  sectionSpacing: boolean;
  /** Trailing newline at end of file */
  trailingNewline: boolean;
}

/**
 * Default formatter options
 */
export const defaultFormatterOptions: FormatterOptions = {
  indent: '  ',
  maxLineLength: 80,
  alignPorts: true,
  alignSignals: true,
  alignAssignments: false,
  sectionSpacing: true,
  trailingNewline: true,
};

/**
 * SystemVerilog Code Formatter
 */
export class SvFormatter {
  private readonly options: FormatterOptions;

  constructor(options?: Partial<FormatterOptions>) {
    this.options = { ...defaultFormatterOptions, ...options };
  }

  /**
   * Format SystemVerilog source code
   */
  format(source: string): string {
    let result = source;

    // Normalize line endings
    result = this.normalizeLineEndings(result);

    // Format indentation
    result = this.formatIndentation(result);

    // Add section spacing if enabled
    if (this.options.sectionSpacing) {
      result = this.addSectionSpacing(result);
    }

    // Ensure trailing newline
    if (this.options.trailingNewline && !result.endsWith('\n')) {
      result += '\n';
    }

    return result;
  }

  /**
   * Normalize line endings to \n
   */
  private normalizeLineEndings(source: string): string {
    return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * Format indentation
   */
  private formatIndentation(source: string): string {
    const lines = source.split('\n');
    const result: string[] = [];
    let indentLevel = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (trimmed === '') {
        result.push('');
        continue;
      }

      // Decrease indent before closing braces/end keywords
      if (this.isClosingLine(trimmed)) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Apply indentation
      const indented = this.options.indent.repeat(indentLevel) + trimmed;
      result.push(indented);

      // Increase indent after opening braces/begin keywords
      if (this.isOpeningLine(trimmed)) {
        indentLevel++;
      }
    }

    return result.join('\n');
  }

  /**
   * Check if line opens a new block
   */
  private isOpeningLine(line: string): boolean {
    // Opening patterns
    const patterns = [
      /\bbegin\s*$/,
      /\bbegin\s*:/,
      /{\s*$/,
      /\bmodule\b.*\(/,
      /\bfunction\b/,
      /\btask\b/,
      /\bgenerate\b/,
      /\bcase\b.*\)/,
      /\bcasex\b.*\)/,
      /\bcasez\b.*\)/,
    ];

    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if line closes a block
   */
  private isClosingLine(line: string): boolean {
    const patterns = [
      /^\s*end\b/,
      /^\s*endmodule\b/,
      /^\s*endfunction\b/,
      /^\s*endtask\b/,
      /^\s*endgenerate\b/,
      /^\s*endcase\b/,
      /^\s*}\s*;?\s*$/,
      /^\s*\);\s*$/,
    ];

    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add blank lines between module sections
   */
  private addSectionSpacing(source: string): string {
    const lines = source.split('\n');
    const result: string[] = [];

    const sectionStarters = [
      /^\s*\/\/ Parameters/,
      /^\s*\/\/ Ports/,
      /^\s*\/\/ Signals/,
      /^\s*\/\/ Logic/,
      /^\s*always_comb\b/,
      /^\s*always_ff\b/,
      /^\s*always\s*@/,
      /^\s*assign\b/,
      /^\s*typedef\b/,
    ];

    let prevWasContent = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check if this is a section starter
      let isSectionStart = false;
      for (const pattern of sectionStarters) {
        if (pattern.test(trimmed)) {
          isSectionStart = true;
          break;
        }
      }

      // Add blank line before section starters (if not already blank)
      if (isSectionStart && prevWasContent && result.length > 0) {
        const lastLine = result[result.length - 1];
        if (lastLine !== undefined && lastLine.trim() !== '') {
          result.push('');
        }
      }

      result.push(line);
      prevWasContent = trimmed !== '';
    }

    return result.join('\n');
  }

  /**
   * Align a group of similar lines (e.g., port declarations)
   */
  alignLines(lines: string[], separators: string[]): string[] {
    if (lines.length === 0) {
      return lines;
    }

    // Find column positions for each separator
    const columnWidths: number[] = [];

    for (const line of lines) {
      let pos = 0;
      for (let i = 0; i < separators.length; i++) {
        const sep = separators[i]!;
        const idx = line.indexOf(sep, pos);
        if (idx >= 0) {
          const width = idx - pos;
          const currentWidth = columnWidths[i];
          if (currentWidth === undefined || width > currentWidth) {
            columnWidths[i] = width;
          }
          pos = idx + sep.length;
        }
      }
    }

    // Apply alignment
    const result: string[] = [];
    for (const line of lines) {
      let aligned = '';
      let pos = 0;

      for (let i = 0; i < separators.length; i++) {
        const sep = separators[i]!;
        const idx = line.indexOf(sep, pos);
        if (idx >= 0) {
          const segment = line.substring(pos, idx);
          const width = columnWidths[i];
          if (width !== undefined) {
            aligned += segment.padEnd(width) + sep;
          } else {
            aligned += segment + sep;
          }
          pos = idx + sep.length;
        }
      }

      aligned += line.substring(pos);
      result.push(aligned);
    }

    return result;
  }

  /**
   * Wrap a long line at the specified max length
   */
  wrapLine(line: string, maxLength?: number): string[] {
    const max = maxLength ?? this.options.maxLineLength;

    if (line.length <= max) {
      return [line];
    }

    const result: string[] = [];
    const indent = (/^\s*/.exec(line))?.[0] ?? '';
    const continuationIndent = indent + this.options.indent;
    let remaining = line;

    while (remaining.length > max) {
      // Find a good break point
      let breakPoint = this.findBreakPoint(remaining, max);

      if (breakPoint <= 0) {
        // No good break point, force break at max
        breakPoint = max;
      }

      result.push(remaining.substring(0, breakPoint).trimEnd());
      remaining = continuationIndent + remaining.substring(breakPoint).trimStart();
    }

    if (remaining.trim()) {
      result.push(remaining);
    }

    return result;
  }

  /**
   * Find a good break point in a line
   */
  private findBreakPoint(line: string, maxPos: number): number {
    // Prefer breaking after these characters
    const breakChars = [',', '(', ')', '+', '-', '|', '&', '^'];

    let bestBreak = -1;

    for (let i = maxPos; i > 0; i--) {
      const char = line[i];
      if (char && breakChars.includes(char)) {
        bestBreak = i + 1;
        break;
      }
      if (char === ' ') {
        bestBreak = i;
        break;
      }
    }

    return bestBreak;
  }
}

/**
 * Create a formatter with the given options
 */
export function createFormatter(options?: Partial<FormatterOptions>): SvFormatter {
  return new SvFormatter(options);
}

/**
 * Format SystemVerilog source code with default options
 */
export function formatSv(source: string, options?: Partial<FormatterOptions>): string {
  const formatter = new SvFormatter(options);
  return formatter.format(source);
}
