/**
 * Signal Usage Analyzer
 *
 * Analyzes signal and port usage in IRIS modules.
 * Detects issues like unused signals, write to input ports, etc.
 */

import type { SourceSpan } from '@iris2sv/core';
import type { SymbolTable, Symbol } from '../symbol-table/index.js';
import { SymbolKind } from '../symbol-table/index.js';
import type {
  SemanticDiagnostic} from './diagnostics.js';
import {
  DiagnosticCode,
  createDiagnostic,
} from './diagnostics.js';

/**
 * Signal usage flags
 */
export interface SignalUsage {
  readonly symbolId: number;
  readonly name: string;
  readonly kind: SymbolKind;
  isRead: boolean;
  isWritten: boolean;
  readonly readLocations: SourceSpan[];
  readonly writeLocations: SourceSpan[];
  readonly definitionSpan: SourceSpan | undefined;
}

/**
 * Port direction for analysis
 */
export type PortDirection = 'in' | 'out' | 'inout';

/**
 * Signal Analyzer class
 */
export class SignalAnalyzer {
  private readonly symbolTable: SymbolTable;
  private readonly usageMap: Map<number, SignalUsage>;
  private diagnostics: SemanticDiagnostic[];

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.usageMap = new Map();
    this.diagnostics = [];
  }

  /**
   * Initialize usage tracking for all signals and ports
   */
  initializeFromSymbolTable(): void {
    const symbols = this.symbolTable.getAllSymbols();

    for (const symbol of symbols) {
      if (
        symbol.kind === SymbolKind.Signal ||
        symbol.kind === SymbolKind.Port ||
        symbol.kind === SymbolKind.Variable
      ) {
        this.usageMap.set(symbol.id, {
          symbolId: symbol.id,
          name: symbol.name,
          kind: symbol.kind,
          isRead: false,
          isWritten: false,
          readLocations: [],
          writeLocations: [],
          definitionSpan: symbol.span,
        });
      }
    }
  }

  /**
   * Record a read access to a signal
   */
  recordRead(symbolId: number, span: SourceSpan): void {
    const usage = this.usageMap.get(symbolId);
    if (usage) {
      usage.isRead = true;
      usage.readLocations.push(span);
    }
  }

  /**
   * Record a write access to a signal
   */
  recordWrite(symbolId: number, span: SourceSpan): void {
    const usage = this.usageMap.get(symbolId);
    if (usage) {
      usage.isWritten = true;
      usage.writeLocations.push(span);
    }
  }

  /**
   * Record a read access by name
   *
   * Note: Uses global symbol search since the symbol table's scope
   * may not be positioned correctly during AST traversal.
   */
  recordReadByName(name: string, span: SourceSpan): void {
    const symbol = this.findSymbolByName(name);
    if (symbol) {
      this.recordRead(symbol.id, span);
    }
  }

  /**
   * Record a write access by name
   *
   * Note: Uses global symbol search since the symbol table's scope
   * may not be positioned correctly during AST traversal.
   */
  recordWriteByName(name: string, span: SourceSpan): void {
    const symbol = this.findSymbolByName(name);
    if (symbol) {
      this.recordWrite(symbol.id, span);
    }
  }

  /**
   * Find a symbol by name, searching all symbols
   */
  private findSymbolByName(name: string): Symbol | undefined {
    // First try normal lookup (handles scoped references correctly)
    const scoped = this.symbolTable.lookup(name);
    if (scoped) {
      return scoped;
    }

    // Fallback: search all symbols by name
    // This handles cases where the current scope doesn't include
    // the symbol (e.g., ports in module scope during external traversal)
    const symbols = this.symbolTable.getAllSymbols();
    return symbols.find(s => s.name === name);
  }

  /**
   * Get usage information for a symbol
   */
  getUsage(symbolId: number): SignalUsage | undefined {
    return this.usageMap.get(symbolId);
  }

  /**
   * Get all usage information
   */
  getAllUsage(): SignalUsage[] {
    return Array.from(this.usageMap.values());
  }

  /**
   * Analyze and generate diagnostics
   */
  analyze(): SemanticDiagnostic[] {
    this.diagnostics = [];

    for (const usage of this.usageMap.values()) {
      this.analyzeSignalUsage(usage);
    }

    return [...this.diagnostics];
  }

  /**
   * Get all diagnostics
   */
  getDiagnostics(): SemanticDiagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Check if there are any errors
   */
  hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  /**
   * Get output ports that are read (S104 candidates)
   * Returns a set of port names that are output ports being read internally
   */
  getOutputPortsWithReads(): Set<string> {
    const result = new Set<string>();

    for (const usage of this.usageMap.values()) {
      if (usage.kind === SymbolKind.Port && usage.isRead) {
        const symbol = this.symbolTable.getSymbol(usage.symbolId);
        if (symbol && this.getPortDirection(symbol) === 'out') {
          result.add(usage.name);
        }
      }
    }

    return result;
  }

  // ==================== Internal Analysis ====================

  private analyzeSignalUsage(usage: SignalUsage): void {
    const symbol = this.symbolTable.getSymbol(usage.symbolId);
    if (!symbol) return;

    switch (usage.kind) {
      case SymbolKind.Port:
        this.analyzePortUsage(usage, symbol);
        break;
      case SymbolKind.Signal:
        this.analyzeSignalOnly(usage);
        break;
      case SymbolKind.Variable:
        this.analyzeVariableUsage(usage);
        break;
    }
  }

  private analyzePortUsage(usage: SignalUsage, symbol: Symbol): void {
    // Get port direction from symbol
    const direction = this.getPortDirection(symbol);

    switch (direction) {
      case 'in':
        // Input port should be read, not written
        if (usage.isWritten) {
          const opts = usage.definitionSpan
            ? {
                relatedSpans: [usage.definitionSpan],
                suggestions: [
                  `Change port direction to 'out' or 'inout'`,
                  `Remove the write to this port`,
                ],
              }
            : {
                suggestions: [
                  `Change port direction to 'out' or 'inout'`,
                  `Remove the write to this port`,
                ],
              };
          this.diagnostics.push(
            createDiagnostic(
              DiagnosticCode.WriteToInputPort,
              'error',
              `Cannot write to input port '${usage.name}'`,
              usage.writeLocations[0],
              opts
            )
          );
        }
        if (!usage.isRead) {
          this.diagnostics.push(
            createDiagnostic(
              DiagnosticCode.UnusedPort,
              'warning',
              `Input port '${usage.name}' is never read`,
              usage.definitionSpan,
              {
                suggestions: [`Consider removing unused port '${usage.name}'`],
              }
            )
          );
        }
        break;

      case 'out':
        // Output port should be written, not read (in most cases)
        if (!usage.isWritten) {
          this.diagnostics.push(
            createDiagnostic(
              DiagnosticCode.UnconnectedPort,
              'warning',
              `Output port '${usage.name}' is never driven`,
              usage.definitionSpan,
              {
                suggestions: [`Add a driver for output port '${usage.name}'`],
              }
            )
          );
        }
        if (usage.isRead) {
          const readOpts = usage.definitionSpan
            ? { relatedSpans: [usage.definitionSpan] }
            : undefined;
          this.diagnostics.push(
            createDiagnostic(
              DiagnosticCode.ReadFromOutputPort,
              'info',
              `Reading from output port '${usage.name}' - consider using inout`,
              usage.readLocations[0],
              readOpts
            )
          );
        }
        break;

      case 'inout':
        // Inout can be both read and written
        if (!usage.isRead && !usage.isWritten) {
          this.diagnostics.push(
            createDiagnostic(
              DiagnosticCode.UnusedPort,
              'warning',
              `Inout port '${usage.name}' is never used`,
              usage.definitionSpan
            )
          );
        }
        break;
    }
  }

  private analyzeSignalOnly(usage: SignalUsage): void {
    // Check for unused signals
    if (!usage.isRead && !usage.isWritten) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UnusedSignal,
          'warning',
          `Signal '${usage.name}' is never used`,
          usage.definitionSpan,
          {
            suggestions: [`Consider removing unused signal '${usage.name}'`],
          }
        )
      );
    } else if (!usage.isRead) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UnusedSignal,
          'warning',
          `Signal '${usage.name}' is written but never read`,
          usage.definitionSpan
        )
      );
    } else if (!usage.isWritten) {
      const sigOpts = usage.definitionSpan
        ? { relatedSpans: [usage.definitionSpan] }
        : undefined;
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.ReadBeforeWrite,
          'warning',
          `Signal '${usage.name}' is read but never written`,
          usage.readLocations[0],
          sigOpts
        )
      );
    }

    // Check for multiple drivers (if write locations > 1 in comb context)
    // This is a simplified check - full analysis would need control flow
    if (usage.writeLocations.length > 1) {
      // Note: This is informational - multiple assignments may be intentional
      // in sequential blocks or different branches
    }
  }

  private analyzeVariableUsage(usage: SignalUsage): void {
    // Check for unused variables
    if (!usage.isRead && !usage.isWritten) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UnusedVariable,
          'warning',
          `Variable '${usage.name}' is never used`,
          usage.definitionSpan,
          {
            suggestions: [`Remove unused variable '${usage.name}'`],
          }
        )
      );
    } else if (!usage.isRead) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UnusedVariable,
          'warning',
          `Variable '${usage.name}' is assigned but never read`,
          usage.definitionSpan
        )
      );
    } else if (!usage.isWritten) {
      const varOpts = usage.definitionSpan
        ? { relatedSpans: [usage.definitionSpan] }
        : undefined;
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.UninitializedVariable,
          'info',
          `Variable '${usage.name}' may be used before initialization`,
          usage.readLocations[0],
          varOpts
        )
      );
    }
  }

  private getPortDirection(symbol: Symbol): PortDirection {
    if (symbol.kind === SymbolKind.Port && 'direction' in symbol) {
      return (symbol as { direction: PortDirection }).direction;
    }
    return 'inout'; // Default to inout if unknown
  }
}

/**
 * Create a signal analyzer
 */
export function createSignalAnalyzer(symbolTable: SymbolTable): SignalAnalyzer {
  return new SignalAnalyzer(symbolTable);
}
