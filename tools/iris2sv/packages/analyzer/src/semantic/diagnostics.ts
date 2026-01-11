/**
 * Semantic Analysis Diagnostics
 *
 * Defines diagnostic codes and messages for semantic analysis.
 */

import type { SourceSpan } from '@iris2sv/core';

/**
 * Diagnostic severity levels
 */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Diagnostic codes for semantic analysis
 */
export enum DiagnosticCode {
  // Signal usage diagnostics (S1xx)
  UnusedSignal = 'S101',
  UnusedPort = 'S102',
  WriteToInputPort = 'S103',
  ReadFromOutputPort = 'S104',
  ReadBeforeWrite = 'S105',
  MultipleDrivers = 'S106',
  UnconnectedPort = 'S107',

  // Variable diagnostics (V1xx)
  UndefinedVariable = 'V101',
  UnusedVariable = 'V102',
  UninitializedVariable = 'V103',
  ShadowedVariable = 'V104',

  // FSM diagnostics (F1xx)
  UnreachableState = 'F101',
  DeadEndState = 'F102',
  UndefinedStateReference = 'F103',
  DuplicateState = 'F104',
  MissingDefaultTransition = 'F105',
  NoInitialState = 'F106',

  // Dependency diagnostics (D1xx)
  CyclicTypeDefinition = 'D101',
  CyclicModuleInstantiation = 'D102',
  CombinatorialLoop = 'D103',

  // Module diagnostics (M1xx)
  UnusedInstance = 'M101',
  MissingPortConnection = 'M102',
  DuplicatePortConnection = 'M103',

  // Type diagnostics (T1xx)
  TypeMismatch = 'T101',
  WidthMismatch = 'T102',
  SignMismatch = 'T103',
}

/**
 * Semantic diagnostic
 */
export interface SemanticDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly span: SourceSpan | undefined;
  readonly relatedSpans?: SourceSpan[];
  readonly suggestions?: string[];
}

/**
 * Create a diagnostic
 */
export function createDiagnostic(
  code: DiagnosticCode,
  severity: Severity,
  message: string,
  span: SourceSpan | undefined,
  options?: {
    relatedSpans?: SourceSpan[];
    suggestions?: string[];
  }
): SemanticDiagnostic {
  if (options?.relatedSpans !== undefined && options?.suggestions !== undefined) {
    return {
      code,
      severity,
      message,
      span,
      relatedSpans: options.relatedSpans,
      suggestions: options.suggestions,
    };
  } else if (options?.relatedSpans !== undefined) {
    return {
      code,
      severity,
      message,
      span,
      relatedSpans: options.relatedSpans,
    };
  } else if (options?.suggestions !== undefined) {
    return {
      code,
      severity,
      message,
      span,
      suggestions: options.suggestions,
    };
  } else {
    return {
      code,
      severity,
      message,
      span,
    };
  }
}

/**
 * Get default severity for a diagnostic code
 */
export function getDefaultSeverity(code: DiagnosticCode): Severity {
  switch (code) {
    // Errors
    case DiagnosticCode.WriteToInputPort:
    case DiagnosticCode.UndefinedVariable:
    case DiagnosticCode.UndefinedStateReference:
    case DiagnosticCode.CyclicTypeDefinition:
    case DiagnosticCode.CyclicModuleInstantiation:
    case DiagnosticCode.CombinatorialLoop:
    case DiagnosticCode.TypeMismatch:
    case DiagnosticCode.NoInitialState:
    case DiagnosticCode.MissingPortConnection:
      return 'error';

    // Warnings
    case DiagnosticCode.UnusedSignal:
    case DiagnosticCode.UnusedPort:
    case DiagnosticCode.UnusedVariable:
    case DiagnosticCode.ReadBeforeWrite:
    case DiagnosticCode.MultipleDrivers:
    case DiagnosticCode.UnreachableState:
    case DiagnosticCode.DeadEndState:
    case DiagnosticCode.MissingDefaultTransition:
    case DiagnosticCode.WidthMismatch:
    case DiagnosticCode.SignMismatch:
    case DiagnosticCode.UnusedInstance:
    case DiagnosticCode.DuplicatePortConnection:
      return 'warning';

    // Info/Hints
    case DiagnosticCode.ShadowedVariable:
    case DiagnosticCode.DuplicateState:
    case DiagnosticCode.ReadFromOutputPort:
    case DiagnosticCode.UninitializedVariable:
    case DiagnosticCode.UnconnectedPort:
      return 'info';

    default:
      return 'warning';
  }
}

/**
 * Format a diagnostic for display
 */
export function formatDiagnostic(diagnostic: SemanticDiagnostic): string {
  const prefix = `[${diagnostic.code}]`;
  const severityTag = diagnostic.severity.toUpperCase();
  let result = `${prefix} ${severityTag}: ${diagnostic.message}`;

  if (diagnostic.span) {
    result += ` at line ${diagnostic.span.startLine}:${diagnostic.span.startColumn}`;
  }

  if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
    result += '\n  Suggestions:';
    for (const suggestion of diagnostic.suggestions) {
      result += `\n    - ${suggestion}`;
    }
  }

  return result;
}
