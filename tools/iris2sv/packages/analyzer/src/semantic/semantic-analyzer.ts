/**
 * Semantic Analyzer
 *
 * Main entry point for semantic analysis.
 * Coordinates various analysis passes.
 */

import type { SourceFile, SourceSpan } from '@iris2sv/core';
import { SignalUsageCollector } from './signal-usage-collector.js';
import type { SymbolTable } from '../symbol-table/index.js';
import type { TypeChecker } from '../type-checker/index.js';
import type {
  SemanticDiagnostic} from './diagnostics.js';
import {
  DiagnosticCode,
  createDiagnostic,
} from './diagnostics.js';
import type { SignalAnalyzer} from './signal-analyzer.js';
import { createSignalAnalyzer } from './signal-analyzer.js';

/**
 * Semantic analysis options
 */
export interface SemanticAnalysisOptions {
  /**
   * Report unused signals as warnings
   */
  reportUnusedSignals?: boolean;

  /**
   * Report unused ports as warnings
   */
  reportUnusedPorts?: boolean;

  /**
   * Report unused variables as warnings
   */
  reportUnusedVariables?: boolean;

  /**
   * Report shadowed variables
   */
  reportShadowing?: boolean;

  /**
   * Strict mode - treat warnings as errors
   */
  strict?: boolean;
}

const DEFAULT_OPTIONS: SemanticAnalysisOptions = {
  reportUnusedSignals: true,
  reportUnusedPorts: true,
  reportUnusedVariables: true,
  reportShadowing: true,
  strict: false,
};

/**
 * Semantic analysis result
 */
export interface SemanticAnalysisResult {
  readonly diagnostics: SemanticDiagnostic[];
  readonly hasErrors: boolean;
  readonly hasWarnings: boolean;
}

/**
 * Semantic Analyzer class
 */
export class SemanticAnalyzer {
  private readonly symbolTable: SymbolTable;
  private readonly _typeChecker: TypeChecker | undefined;
  private readonly options: SemanticAnalysisOptions;
  private diagnostics: SemanticDiagnostic[];
  private readonly signalAnalyzer: SignalAnalyzer;

  constructor(
    symbolTable: SymbolTable,
    typeChecker?: TypeChecker,
    options?: SemanticAnalysisOptions
  ) {
    this.symbolTable = symbolTable;
    this._typeChecker = typeChecker;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.diagnostics = [];
    this.signalAnalyzer = createSignalAnalyzer(symbolTable);
  }

  /**
   * Get the type checker (if provided)
   */
  get typeChecker(): TypeChecker | undefined {
    return this._typeChecker;
  }

  /**
   * Run semantic analysis
   *
   * @param sourceFile - The source file to analyze. If provided,
   *   signal usage will be collected from the AST.
   * @param skipSignalCollection - If true, skip signal usage collection
   *   (use when collectSignalUsage was called externally before analyze)
   */
  analyze(sourceFile?: SourceFile, skipSignalCollection = false): SemanticAnalysisResult {
    this.diagnostics = [];

    // Initialize signal analyzer
    this.signalAnalyzer.initializeFromSymbolTable();

    // Collect signal usage from AST (if source file provided)
    if (sourceFile && !skipSignalCollection) {
      this.collectSignalUsageFromAst(sourceFile);
    }

    // Check for undefined references
    this.checkUndefinedReferences();

    // Check for shadowed variables
    if (this.options.reportShadowing) {
      this.checkShadowing();
    }

    // Run signal usage analysis
    const signalDiagnostics = this.signalAnalyzer.analyze();

    // Filter based on options
    for (const diag of signalDiagnostics) {
      if (this.shouldReportDiagnostic(diag)) {
        this.diagnostics.push(diag);
      }
    }

    // Apply strict mode
    if (this.options.strict) {
      this.promoteWarningsToErrors();
    }

    return {
      diagnostics: [...this.diagnostics],
      hasErrors: this.diagnostics.some(d => d.severity === 'error'),
      hasWarnings: this.diagnostics.some(d => d.severity === 'warning'),
    };
  }

  /**
   * Collect signal usage from AST
   */
  private collectSignalUsageFromAst(sourceFile: SourceFile): void {
    const collector = new SignalUsageCollector(this, this.symbolTable);
    collector.collect(sourceFile);
  }

  /**
   * Record a signal read (for external use during AST traversal)
   */
  recordSignalRead(name: string, span: SourceSpan): void {
    this.signalAnalyzer.recordReadByName(name, span);
  }

  /**
   * Record a signal write (for external use during AST traversal)
   */
  recordSignalWrite(name: string, span: SourceSpan): void {
    this.signalAnalyzer.recordWriteByName(name, span);
  }

  /**
   * Check for undefined variable references
   */
  checkReference(name: string, span: SourceSpan): boolean {
    const symbol = this.symbolTable.lookup(name);
    if (!symbol) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UndefinedVariable,
          'error',
          `Undefined reference to '${name}'`,
          span,
          {
            suggestions: this.getSimilarNames(name),
          }
        )
      );
      return false;
    }
    return true;
  }

  /**
   * Get all diagnostics
   */
  getDiagnostics(): SemanticDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Check if there are errors
   */
  hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  /**
   * Get output ports that are read internally (S104 candidates)
   * Must be called after analyze() to get accurate results
   */
  getOutputPortsWithReads(): Set<string> {
    return this.signalAnalyzer.getOutputPortsWithReads();
  }

  // ==================== Internal Methods ====================

  private checkUndefinedReferences(): void {
    // This would normally traverse the AST to find all identifier references
    // For now, we rely on external calls to checkReference()
  }

  private checkShadowing(): void {
    const symbols = this.symbolTable.getAllSymbols();
    const nameMap = new Map<string, number[]>();

    // Group symbols by name
    for (const symbol of symbols) {
      const ids = nameMap.get(symbol.name) ?? [];
      ids.push(symbol.id);
      nameMap.set(symbol.name, ids);
    }

    // Check for shadowing
    for (const [name, ids] of nameMap) {
      if (ids.length > 1) {
        // Multiple symbols with same name - check if they're in nested scopes
        const sortedSymbols = ids
          .map(id => this.symbolTable.getSymbol(id))
          .filter((s): s is NonNullable<typeof s> => s !== undefined)
          .sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));

        // Check consecutive pairs
        for (let i = 1; i < sortedSymbols.length; i++) {
          const prev = sortedSymbols[i - 1];
          const curr = sortedSymbols[i];
          if (prev && curr) {
            // Report shadowing when same name appears in different scopes
            // Simplified: report if they're different kinds or appear at different positions
            if (prev.kind !== curr.kind) {
              const shadowOpts = prev.span
                ? { relatedSpans: [prev.span] }
                : undefined;
              this.diagnostics.push(
                createDiagnostic(
                  DiagnosticCode.ShadowedVariable,
                  'info',
                  `'${name}' shadows a previous definition`,
                  curr.span,
                  shadowOpts
                )
              );
            }
          }
        }
      }
    }
  }

  private shouldReportDiagnostic(diag: SemanticDiagnostic): boolean {
    switch (diag.code) {
      case DiagnosticCode.UnusedSignal:
        return this.options.reportUnusedSignals ?? true;
      case DiagnosticCode.UnusedPort:
        return this.options.reportUnusedPorts ?? true;
      case DiagnosticCode.UnusedVariable:
        return this.options.reportUnusedVariables ?? true;
      case DiagnosticCode.ShadowedVariable:
        return this.options.reportShadowing ?? true;
      default:
        return true;
    }
  }

  private promoteWarningsToErrors(): void {
    this.diagnostics = this.diagnostics.map(d => {
      if (d.severity === 'warning') {
        return { ...d, severity: 'error' as const };
      }
      return d;
    });
  }

  private getSimilarNames(name: string): string[] {
    const suggestions: string[] = [];
    const symbols = this.symbolTable.getAllSymbols();

    for (const symbol of symbols) {
      if (this.isSimilar(name, symbol.name)) {
        suggestions.push(`Did you mean '${symbol.name}'?`);
      }
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  private isSimilar(a: string, b: string): boolean {
    if (a === b) return false;

    // Simple similarity check: case-insensitive match or edit distance <= 2
    if (a.toLowerCase() === b.toLowerCase()) return true;

    // Levenshtein distance check
    return this.levenshteinDistance(a, b) <= 2;
  }

  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      const row = matrix[0];
      if (row) row[j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const row = matrix[i];
        const prevRow = matrix[i - 1];
        if (row && prevRow) {
          const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
          row[j] = Math.min(
            (prevRow[j] ?? 0) + 1,
            (row[j - 1] ?? 0) + 1,
            (prevRow[j - 1] ?? 0) + cost
          );
        }
      }
    }

    const lastRow = matrix[b.length];
    return lastRow?.[a.length] ?? 0;
  }
}

/**
 * Create a semantic analyzer
 */
export function createSemanticAnalyzer(
  symbolTable: SymbolTable,
  typeChecker?: TypeChecker,
  options?: SemanticAnalysisOptions
): SemanticAnalyzer {
  return new SemanticAnalyzer(symbolTable, typeChecker, options);
}

/**
 * Run semantic analysis (convenience function)
 */
export function analyzeSemantics(
  symbolTable: SymbolTable,
  sourceFile?: SourceFile,
  options?: SemanticAnalysisOptions
): SemanticAnalysisResult {
  const analyzer = createSemanticAnalyzer(symbolTable, undefined, options);
  return analyzer.analyze(sourceFile);
}
