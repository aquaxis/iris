/**
 * Semantic Analysis Module
 *
 * Provides semantic analysis infrastructure for IRIS.
 */

// Diagnostics
export {
  DiagnosticCode,
  createDiagnostic,
  getDefaultSeverity,
  formatDiagnostic,
} from './diagnostics.js';

export type {
  Severity,
  SemanticDiagnostic,
} from './diagnostics.js';

// Signal Analyzer
export {
  SignalAnalyzer,
  createSignalAnalyzer,
} from './signal-analyzer.js';

export type {
  SignalUsage,
  PortDirection as SignalPortDirection,
} from './signal-analyzer.js';

// Semantic Analyzer
export {
  SemanticAnalyzer,
  createSemanticAnalyzer,
  analyzeSemantics,
} from './semantic-analyzer.js';

export type {
  SemanticAnalysisOptions,
  SemanticAnalysisResult,
} from './semantic-analyzer.js';

// Signal Usage Collector
export {
  SignalUsageCollector,
  collectSignalUsage,
} from './signal-usage-collector.js';
