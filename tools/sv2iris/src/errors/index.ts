/**
 * Errors Module - Public API
 */

export {
    ErrorSeverity,
    ErrorCategory,
    WarningCategory,
    Sv2IrisError,
    LexerError,
    ParserError,
    TransformError,
    GeneratorError,
    Sv2IrisWarning,
    LexerErrorCodes,
    ParserErrorCodes,
    TransformErrorCodes,
    WarningCodes,
} from './error.js';

export { ErrorReporter, Diagnostic, ReporterConfig } from './reporter.js';
