/**
 * Signal Usage Collector
 *
 * Traverses the AST to collect signal/port read and write locations.
 * This information is used by the semantic analyzer to report
 * unused signals/ports.
 */

import {
  BaseVisitor,
  type SourceFile,
  type ModDef,
  type CombBlock,
  type SyncBlock,
  type ClockSpec,
  type ResetSpec,
  type Expr,
  type Stmt,
  type AssignStmt,
  type IfStmt,
  type MatchStmt,
  type ForStmt,
  type WhileStmt,
  type BlockStmt,
  type LetStmt,
  type VarStmt,
  type LValue,
  type Connection,
  type InstDecl,
  type SignalDecl,
} from '@iris2sv/core';
import type { SemanticAnalyzer } from './semantic-analyzer.js';
import type { SymbolTable, ModuleSymbol, PortSymbol } from '../symbol-table/index.js';
import { SymbolKind } from '../symbol-table/index.js';

/**
 * Signal Usage Collector
 *
 * Visits AST nodes and records signal reads/writes to the semantic analyzer.
 */
export class SignalUsageCollector extends BaseVisitor<void> {
  private readonly analyzer: SemanticAnalyzer;
  private readonly symbolTable: SymbolTable;

  constructor(analyzer: SemanticAnalyzer, symbolTable: SymbolTable) {
    super();
    this.analyzer = analyzer;
    this.symbolTable = symbolTable;
  }

  /**
   * Collect signal usage from source file
   */
  collect(sourceFile: SourceFile): void {
    this.visitSourceFile(sourceFile);
  }

  // ==================== Module ====================

  override visitModDef(node: ModDef): void {
    // Visit ports (not needed for reads/writes tracking)

    // Visit module items
    for (const item of node.items) {
      this.visitModItem(item);
    }
  }

  // ==================== Module Items ====================

  override visitSignalDecl(node: SignalDecl): void {
    // If initialized, the signal is written and the init expression is read
    if (node.init) {
      this.analyzer.recordSignalWrite(node.name.name, node.name.span);
      this.recordExprRead(node.init);
    }
  }

  override visitCombBlock(node: CombBlock): void {
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
  }

  override visitSyncBlock(node: SyncBlock): void {
    // Clock is read
    this.visitClockSpec(node.clock);

    // Reset is read (if present)
    if (node.reset) {
      this.visitResetSpec(node.reset);
    }

    // Visit body statements
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
  }

  override visitClockSpec(node: ClockSpec): void {
    // Clock signal is read
    this.recordExprRead(node.signal);
  }

  override visitResetSpec(node: ResetSpec): void {
    // Reset signal is read
    this.recordExprRead(node.signal);
  }

  override visitInstDecl(node: InstDecl): void {
    // Get module name from path (last segment)
    const moduleName = node.module.segments[node.module.segments.length - 1]?.name ?? '';

    // Look up module definition in symbol table
    const moduleSymbol = this.symbolTable.lookupByKind(moduleName, SymbolKind.Module) as ModuleSymbol | undefined;

    // Visit connections with module context
    for (const conn of node.connections) {
      this.visitConnectionWithModule(conn, moduleSymbol);
    }
  }

  override visitConnection(node: Connection): void {
    // Fallback: treat as read (for backwards compatibility)
    this.recordExprRead(node.expr);
  }

  /**
   * Visit connection with module context to determine port direction
   */
  private visitConnectionWithModule(
    conn: Connection,
    moduleSymbol: ModuleSymbol | undefined
  ): void {
    // If module definition is not found (external module), treat as both read and write
    // This prevents false positives for external module output ports
    if (!moduleSymbol) {
      this.recordExprRead(conn.expr);
      this.recordExprWrite(conn.expr);
      return;
    }

    // Find port in module definition
    const portSymbol = this.findPortInModule(moduleSymbol, conn.port.name);

    if (!portSymbol) {
      // Port not found, treat as both read and write (fallback)
      this.recordExprRead(conn.expr);
      this.recordExprWrite(conn.expr);
      return;
    }

    // Handle based on port direction
    switch (portSymbol.direction) {
      case 'in':
        // Input port: connected signal is read
        this.recordExprRead(conn.expr);
        break;
      case 'out':
        // Output port: connected signal is written
        this.recordExprWrite(conn.expr);
        break;
      case 'inout':
        // Bidirectional port: both read and write
        this.recordExprRead(conn.expr);
        this.recordExprWrite(conn.expr);
        break;
    }
  }

  /**
   * Find port symbol in module definition
   */
  private findPortInModule(
    moduleSymbol: ModuleSymbol,
    portName: string
  ): PortSymbol | undefined {
    for (const portId of moduleSymbol.ports) {
      const port = this.symbolTable.getSymbol(portId);
      if (port && port.kind === SymbolKind.Port && port.name === portName) {
        return port as PortSymbol;
      }
    }
    return undefined;
  }

  /**
   * Record expression as write (skips input ports to avoid false positives)
   */
  private recordExprWrite(expr: Expr): void {
    if (expr.kind === 'IdentifierExpr') {
      // Check if this is an input port - don't record write to input ports
      if (this.isInputPort(expr.name.name)) {
        // Don't record write to input port
        return;
      }
      this.analyzer.recordSignalWrite(expr.name.name, expr.span);
    } else if (expr.kind === 'IndexExpr') {
      // For indexed expressions, the base is written
      this.recordExprWrite(expr.base);
    } else if (expr.kind === 'FieldExpr') {
      // For field expressions, the base is written
      this.recordExprWrite(expr.base);
    }
    // Other expression types are not valid write targets
  }

  /**
   * Check if a name refers to an input port
   */
  private isInputPort(name: string): boolean {
    // Search all symbols for a port with this name
    const allSymbols = this.symbolTable.getAllSymbols();
    for (const symbol of allSymbols) {
      if (symbol.kind === SymbolKind.Port && symbol.name === name) {
        const portSymbol = symbol as PortSymbol;
        return portSymbol.direction === 'in';
      }
    }
    return false;
  }

  // ==================== Statements ====================

  override visitStmt(node: Stmt): void {
    switch (node.kind) {
      case 'AssignStmt':
        this.visitAssignStmt(node);
        break;
      case 'LetStmt':
        this.visitLetStmt(node);
        break;
      case 'VarStmt':
        this.visitVarStmt(node);
        break;
      case 'IfStmt':
        this.visitIfStmt(node);
        break;
      case 'MatchStmt':
        this.visitMatchStmt(node);
        break;
      case 'ForStmt':
        this.visitForStmt(node);
        break;
      case 'WhileStmt':
        this.visitWhileStmt(node);
        break;
      case 'BlockStmt':
        this.visitBlockStmt(node);
        break;
      case 'ExprStmt':
        // Expression statements are reads
        this.recordExprRead(node.expr);
        break;
      default:
        super.visitStmt(node);
    }
  }

  override visitAssignStmt(node: AssignStmt): void {
    // Left side is a write
    this.recordLValueWrite(node.lvalue);

    // Right side is a read
    this.recordExprRead(node.value);
  }

  override visitLetStmt(node: LetStmt): void {
    // If initialized, the variable is written
    if (node.init) {
      this.analyzer.recordSignalWrite(node.name.name, node.name.span);
      this.recordExprRead(node.init);
    }
  }

  override visitVarStmt(node: VarStmt): void {
    // If initialized, the variable is written
    if (node.init) {
      this.analyzer.recordSignalWrite(node.name.name, node.name.span);
      this.recordExprRead(node.init);
    }
  }

  override visitIfStmt(node: IfStmt): void {
    // Condition is a read
    this.recordExprRead(node.condition);

    // Then branch
    for (const stmt of node.thenBranch) {
      this.visitStmt(stmt);
    }

    // Else branch
    if (node.elseBranch) {
      if (Array.isArray(node.elseBranch)) {
        for (const stmt of node.elseBranch) {
          this.visitStmt(stmt);
        }
      } else {
        this.visitIfStmt(node.elseBranch);
      }
    }
  }

  override visitMatchStmt(node: MatchStmt): void {
    // Scrutinee is a read
    this.recordExprRead(node.scrutinee);

    // Visit arms
    for (const arm of node.arms) {
      if (Array.isArray(arm.body)) {
        for (const stmt of arm.body) {
          this.visitStmt(stmt);
        }
      } else {
        this.recordExprRead(arm.body);
      }
    }
  }

  override visitForStmt(node: ForStmt): void {
    // Range expressions are reads
    this.recordExprRead(node.start);
    this.recordExprRead(node.end);

    // Visit body
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
  }

  override visitWhileStmt(node: WhileStmt): void {
    // Condition is a read
    this.recordExprRead(node.condition);

    // Visit body
    for (const stmt of node.body) {
      this.visitStmt(stmt);
    }
  }

  override visitBlockStmt(node: BlockStmt): void {
    for (const stmt of node.statements) {
      this.visitStmt(stmt);
    }
  }

  // ==================== LValue Recording ====================

  private recordLValueWrite(lvalue: LValue): void {
    switch (lvalue.kind) {
      case 'IdentifierLValue':
        // This is a write to the identifier
        this.analyzer.recordSignalWrite(lvalue.name.name, lvalue.name.span);
        break;

      case 'IndexLValue':
        // The base is a write (partial write to array element)
        this.recordLValueWrite(lvalue.base);
        // Index expression is a read
        this.recordExprRead(lvalue.index);
        if (lvalue.endIndex) {
          this.recordExprRead(lvalue.endIndex);
        }
        break;

      case 'FieldLValue':
        // The base is a write (partial write to struct field)
        this.recordLValueWrite(lvalue.base);
        break;

      case 'ConcatLValue':
        // All elements are writes
        for (const elem of lvalue.elements) {
          this.recordLValueWrite(elem);
        }
        break;
    }
  }

  // ==================== Expression Recording ====================

  private recordExprRead(expr: Expr): void {
    switch (expr.kind) {
      case 'IdentifierExpr':
        this.analyzer.recordSignalRead(expr.name.name, expr.span);
        break;

      case 'PathExpr':
        // Path expressions are module/enum references, not signal reads
        break;

      case 'UnaryExpr':
        this.recordExprRead(expr.operand);
        break;

      case 'BinaryExpr':
        this.recordExprRead(expr.left);
        this.recordExprRead(expr.right);
        break;

      case 'IndexExpr':
        this.recordExprRead(expr.base);
        this.recordExprRead(expr.index);
        if (expr.endIndex) {
          this.recordExprRead(expr.endIndex);
        }
        break;

      case 'FieldExpr':
        this.recordExprRead(expr.base);
        break;

      case 'CallExpr':
        this.recordExprRead(expr.callee);
        for (const arg of expr.args) {
          this.recordExprRead(arg);
        }
        break;

      case 'CastExpr':
        this.recordExprRead(expr.expr);
        break;

      case 'IfExpr':
        this.recordExprRead(expr.condition);
        this.recordExprRead(expr.thenExpr);
        this.recordExprRead(expr.elseExpr);
        break;

      case 'MatchExpr':
        this.recordExprRead(expr.scrutinee);
        for (const arm of expr.arms) {
          if (Array.isArray(arm.body)) {
            for (const stmt of arm.body) {
              this.visitStmt(stmt);
            }
          } else {
            this.recordExprRead(arm.body);
          }
        }
        break;

      case 'ConcatExpr':
        for (const elem of expr.elements) {
          this.recordExprRead(elem);
        }
        break;

      case 'RepeatExpr':
        this.recordExprRead(expr.expr);
        this.recordExprRead(expr.count);
        break;

      case 'ParenExpr':
        this.recordExprRead(expr.expr);
        break;

      // Literals don't have signal reads
      case 'IntegerLiteral':
      case 'StringLiteral':
      case 'BoolLiteral':
        break;
    }
  }
}

/**
 * Collect signal usage from a source file
 */
export function collectSignalUsage(
  sourceFile: SourceFile,
  analyzer: SemanticAnalyzer,
  symbolTable: SymbolTable
): void {
  const collector = new SignalUsageCollector(analyzer, symbolTable);
  collector.collect(sourceFile);
}
