/**
 * Error Reporter
 * Collects and reports errors/warnings during compilation
 */

import type { Sv2IrisError, Sv2IrisWarning, ErrorSeverity } from './error.js';

/**
 * Diagnostic message structure
 */
export interface Diagnostic {
    severity: ErrorSeverity;
    code: string;
    message: string;
    file?: string;
    line?: number;
    column?: number;
}

/**
 * Error reporter configuration
 */
export interface ReporterConfig {
    /** Maximum number of errors before stopping */
    maxErrors: number;
    /** Whether to treat warnings as errors */
    warningsAsErrors: boolean;
    /** Whether to suppress warnings */
    suppressWarnings: boolean;
}

/**
 * Default reporter configuration
 */
const defaultConfig: ReporterConfig = {
    maxErrors: 100,
    warningsAsErrors: false,
    suppressWarnings: false,
};

/**
 * Error reporter class
 * Collects errors and warnings, provides formatted output
 */
export class ErrorReporter {
    private errors: Sv2IrisError[] = [];
    private warnings: Sv2IrisWarning[] = [];
    private readonly config: ReporterConfig;

    constructor(config: Partial<ReporterConfig> = {}) {
        this.config = { ...defaultConfig, ...config };
    }

    /**
     * Reports an error
     */
    reportError(error: Sv2IrisError): void {
        this.errors.push(error);
    }

    /**
     * Reports a warning
     */
    reportWarning(warning: Sv2IrisWarning): void {
        if (!this.config.suppressWarnings) {
            if (this.config.warningsAsErrors) {
                this.errors.push(warning);
            } else {
                this.warnings.push(warning);
            }
        }
    }

    /**
     * Returns true if any errors have been reported
     */
    hasErrors(): boolean {
        return this.errors.length > 0;
    }

    /**
     * Returns true if maximum error count has been reached
     */
    hasMaxErrors(): boolean {
        return this.errors.length >= this.config.maxErrors;
    }

    /**
     * Returns true if any warnings have been reported
     */
    hasWarnings(): boolean {
        return this.warnings.length > 0;
    }

    /**
     * Gets the number of errors
     */
    getErrorCount(): number {
        return this.errors.length;
    }

    /**
     * Gets the number of warnings
     */
    getWarningCount(): number {
        return this.warnings.length;
    }

    /**
     * Gets all errors
     */
    getErrors(): readonly Sv2IrisError[] {
        return this.errors;
    }

    /**
     * Gets all warnings
     */
    getWarnings(): readonly Sv2IrisWarning[] {
        return this.warnings;
    }

    /**
     * Converts all errors and warnings to diagnostics
     */
    getDiagnostics(): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];

        for (const error of this.errors) {
            diagnostics.push({
                severity: error.severity,
                code: error.code,
                message: error.message,
                file: error.location?.file,
                line: error.location?.start.line,
                column: error.location?.start.column,
            });
        }

        for (const warning of this.warnings) {
            diagnostics.push({
                severity: warning.severity,
                code: warning.code,
                message: warning.message,
                file: warning.location?.file,
                line: warning.location?.start.line,
                column: warning.location?.start.column,
            });
        }

        return diagnostics;
    }

    /**
     * Formats all errors and warnings for console output
     */
    formatAll(): string {
        const lines: string[] = [];

        for (const error of this.errors) {
            lines.push(error.format());
        }

        for (const warning of this.warnings) {
            lines.push(warning.format());
        }

        return lines.join('\n');
    }

    /**
     * Formats a summary of errors and warnings
     */
    formatSummary(): string {
        const errorCount = this.errors.length;
        const warningCount = this.warnings.length;

        const parts: string[] = [];

        if (errorCount > 0) {
            parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
        }

        if (warningCount > 0) {
            parts.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
        }

        if (parts.length === 0) {
            return 'No errors or warnings';
        }

        return parts.join(', ');
    }

    /**
     * Clears all errors and warnings
     */
    clear(): void {
        this.errors = [];
        this.warnings = [];
    }
}
