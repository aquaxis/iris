/**
 * Output Wire Transform
 *
 * Transforms output ports that are read internally by generating
 * internal wires and connecting them to the output ports.
 *
 * When an output port is read within the module:
 * 1. Generate an internal signal: {port_name}_internal
 * 2. Replace all references to the port with the internal signal
 * 3. Generate: assign {port_name} = {port_name}_internal;
 */

import type {
  SvModule,
  SvModuleItem,
  SvSignal,
  SvAssign,
  SvAlwaysBlock,
  SvPort,
  SvExpr,
  SvStmt,
} from '@iris2sv/sv-backend';
import {
  signal,
  assign,
  identifier,
} from '@iris2sv/sv-backend';

/**
 * Output Wire Transform Options
 */
export interface OutputWireTransformOptions {
  /** Suffix to add to internal wire names (default: '_internal') */
  internalSuffix?: string;
}

const DEFAULT_OPTIONS: OutputWireTransformOptions = {
  internalSuffix: '_internal',
};

/**
 * Transform result
 */
export interface OutputWireTransformResult {
  /** Transformed module */
  module: SvModule;
  /** Names of ports that were transformed */
  transformedPorts: string[];
  /** Any errors that occurred */
  errors: string[];
}

/**
 * Output Wire Transform class
 */
export class OutputWireTransform {
  private readonly outputPortsWithReads: Set<string>;
  private readonly options: OutputWireTransformOptions;
  private readonly portTypeMap: Map<string, SvPort>;

  constructor(outputPortsWithReads: Set<string>, options?: OutputWireTransformOptions) {
    this.outputPortsWithReads = outputPortsWithReads;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.portTypeMap = new Map();
  }

  /**
   * Transform a module
   */
  transform(module: SvModule): OutputWireTransformResult {
    const errors: string[] = [];
    const transformedPorts: string[] = [];

    // If no ports to transform, return as-is
    if (this.outputPortsWithReads.size === 0) {
      return { module, transformedPorts, errors };
    }

    // Build port type map
    for (const port of module.ports) {
      if (this.outputPortsWithReads.has(port.name)) {
        this.portTypeMap.set(port.name, port);
      }
    }

    // Check for name collisions
    const existingNames = new Set<string>();
    for (const port of module.ports) {
      existingNames.add(port.name);
    }
    for (const item of module.items) {
      if (item.kind === 'SvSignal') {
        existingNames.add(item.name);
      }
    }

    for (const portName of this.outputPortsWithReads) {
      const internalName = this.getInternalName(portName);
      if (existingNames.has(internalName)) {
        errors.push(`Name collision: '${internalName}' already exists in module`);
      }
    }

    if (errors.length > 0) {
      return { module, transformedPorts, errors };
    }

    // Generate internal wires
    const internalWires = this.generateInternalWires();

    // Transform module items (replace references)
    const transformedItems = this.transformItems(module.items);

    // Generate assign statements
    const assignStatements = this.generateAssignStatements();

    // Record transformed ports
    for (const portName of this.outputPortsWithReads) {
      if (this.portTypeMap.has(portName)) {
        transformedPorts.push(portName);
      }
    }

    // Build new module
    const newModule: SvModule = {
      ...module,
      items: [...internalWires, ...transformedItems, ...assignStatements],
    };

    return { module: newModule, transformedPorts, errors };
  }

  /**
   * Get internal wire name for a port
   */
  private getInternalName(portName: string): string {
    return `${portName}${this.options.internalSuffix}`;
  }

  /**
   * Generate internal wire declarations
   */
  private generateInternalWires(): SvSignal[] {
    const wires: SvSignal[] = [];

    for (const portName of this.outputPortsWithReads) {
      const port = this.portTypeMap.get(portName);
      if (port) {
        const internalName = this.getInternalName(portName);
        wires.push(signal(internalName, port.dataType));
      }
    }

    return wires;
  }

  /**
   * Transform module items (replace port references with internal wire references)
   */
  private transformItems(items: SvModuleItem[]): SvModuleItem[] {
    return items.map(item => this.transformItem(item));
  }

  /**
   * Transform a single module item
   */
  private transformItem(item: SvModuleItem): SvModuleItem {
    switch (item.kind) {
      case 'SvSignal':
        return this.transformSignal(item);
      case 'SvAlwaysBlock':
        return this.transformAlwaysBlock(item);
      case 'SvAssign':
        return this.transformAssign(item);
      case 'SvInstance':
        // Instance connections need special handling
        return {
          ...item,
          connections: item.connections.map(c => ({
            ...c,
            expr: c.expr ? this.transformExpr(c.expr) : undefined,
          })),
        };
      default:
        return item;
    }
  }

  /**
   * Transform signal declaration (initial value)
   */
  private transformSignal(sig: SvSignal): SvSignal {
    if (!sig.initialValue) {
      return sig;
    }
    return {
      ...sig,
      initialValue: this.transformExpr(sig.initialValue),
    };
  }

  /**
   * Transform always block
   */
  private transformAlwaysBlock(block: SvAlwaysBlock): SvAlwaysBlock {
    return {
      ...block,
      body: this.transformStmt(block.body),
    };
  }

  /**
   * Transform continuous assignment
   */
  private transformAssign(assignItem: SvAssign): SvAssign {
    return {
      ...assignItem,
      lhs: this.transformExpr(assignItem.lhs),
      rhs: this.transformExpr(assignItem.rhs),
    };
  }

  /**
   * Transform statement
   */
  private transformStmt(stmt: SvStmt): SvStmt {
    switch (stmt.kind) {
      case 'SvBlockStmt':
        return {
          ...stmt,
          statements: stmt.statements.map(s => this.transformStmt(s)),
        };
      case 'SvIfStmt':
        return {
          ...stmt,
          condition: this.transformExpr(stmt.condition),
          thenBranch: this.transformStmt(stmt.thenBranch),
          elseBranch: stmt.elseBranch ? this.transformStmt(stmt.elseBranch) : undefined,
        };
      case 'SvCaseStmt':
        return {
          ...stmt,
          expr: this.transformExpr(stmt.expr),
          items: stmt.items.map(item => ({
            ...item,
            patterns: item.patterns.map(p => this.transformExpr(p)),
            body: this.transformStmt(item.body),
          })),
          defaultCase: stmt.defaultCase ? this.transformStmt(stmt.defaultCase) : undefined,
        };
      case 'SvForStmt':
        return {
          ...stmt,
          init: stmt.init ? this.transformStmt(stmt.init) : undefined,
          condition: stmt.condition ? this.transformExpr(stmt.condition) : undefined,
          update: stmt.update ? this.transformStmt(stmt.update) : undefined,
          body: this.transformStmt(stmt.body),
        };
      case 'SvWhileStmt':
        return {
          ...stmt,
          condition: this.transformExpr(stmt.condition),
          body: this.transformStmt(stmt.body),
        };
      case 'SvDoWhileStmt':
        return {
          ...stmt,
          condition: this.transformExpr(stmt.condition),
          body: this.transformStmt(stmt.body),
        };
      case 'SvBlockingAssignStmt':
      case 'SvNonBlockingAssignStmt':
        return {
          ...stmt,
          lhs: this.transformExpr(stmt.lhs),
          rhs: this.transformExpr(stmt.rhs),
        };
      case 'SvReturnStmt':
        return {
          ...stmt,
          value: stmt.value ? this.transformExpr(stmt.value) : undefined,
        };
      case 'SvVarDeclStmt':
        return {
          ...stmt,
          initialValue: stmt.initialValue ? this.transformExpr(stmt.initialValue) : undefined,
        };
      case 'SvTaskCallStmt':
        return {
          ...stmt,
          args: stmt.args.map(a => this.transformExpr(a)),
        };
      case 'SvAssertStmt':
        return {
          ...stmt,
          condition: this.transformExpr(stmt.condition),
        };
      case 'SvDisplayStmt':
        return {
          ...stmt,
          args: stmt.args.map(a => this.transformExpr(a)),
        };
      case 'SvRepeatStmt':
        return {
          ...stmt,
          count: this.transformExpr(stmt.count),
          body: this.transformStmt(stmt.body),
        };
      case 'SvForeverStmt':
        return {
          ...stmt,
          body: this.transformStmt(stmt.body),
        };
      default:
        // SvBreakStmt, SvContinueStmt, SvEmptyStmt, SvCommentStmt, SvContinuousAssignStmt
        return stmt;
    }
  }

  /**
   * Transform expression (replace port references with internal wire references)
   */
  private transformExpr(expr: SvExpr): SvExpr {
    switch (expr.kind) {
      case 'SvIdentifierExpr':
        // Check if this is an output port that needs to be replaced
        if (this.outputPortsWithReads.has(expr.name)) {
          return identifier(this.getInternalName(expr.name));
        }
        return expr;

      case 'SvBinaryExpr':
        return {
          ...expr,
          left: this.transformExpr(expr.left),
          right: this.transformExpr(expr.right),
        };

      case 'SvUnaryExpr':
        return {
          ...expr,
          operand: this.transformExpr(expr.operand),
        };

      case 'SvTernaryExpr':
        return {
          ...expr,
          condition: this.transformExpr(expr.condition),
          thenExpr: this.transformExpr(expr.thenExpr),
          elseExpr: this.transformExpr(expr.elseExpr),
        };

      case 'SvIndexExpr':
        return {
          ...expr,
          base: this.transformExpr(expr.base),
          index: this.transformExpr(expr.index),
        };

      case 'SvSliceExpr':
        return {
          ...expr,
          base: this.transformExpr(expr.base),
          high: this.transformExpr(expr.high),
          low: this.transformExpr(expr.low),
        };

      case 'SvMemberExpr':
        return {
          ...expr,
          base: this.transformExpr(expr.base),
        };

      case 'SvCallExpr':
        return {
          ...expr,
          args: expr.args.map(a => this.transformExpr(a)),
        };

      case 'SvConcatExpr':
        return {
          ...expr,
          elements: expr.elements.map(e => this.transformExpr(e)),
        };

      case 'SvReplicateExpr':
        return {
          ...expr,
          expr: this.transformExpr(expr.expr),
          count: this.transformExpr(expr.count),
        };

      case 'SvCastExpr':
        return {
          ...expr,
          expr: this.transformExpr(expr.expr),
        };

      case 'SvParenExpr':
        return {
          ...expr,
          expr: this.transformExpr(expr.expr),
        };

      default:
        // SvLiteralExpr - doesn't contain references
        return expr;
    }
  }

  /**
   * Generate assign statements to connect internal wires to output ports
   */
  private generateAssignStatements(): SvAssign[] {
    const assigns: SvAssign[] = [];

    for (const portName of this.outputPortsWithReads) {
      if (this.portTypeMap.has(portName)) {
        const internalName = this.getInternalName(portName);
        assigns.push(assign(identifier(portName), identifier(internalName)));
      }
    }

    return assigns;
  }
}

/**
 * Create an output wire transform
 */
export function createOutputWireTransform(
  outputPortsWithReads: Set<string>,
  options?: OutputWireTransformOptions
): OutputWireTransform {
  return new OutputWireTransform(outputPortsWithReads, options);
}

/**
 * Transform a module with output wire handling
 */
export function transformOutputWires(
  module: SvModule,
  outputPortsWithReads: Set<string>,
  options?: OutputWireTransformOptions
): OutputWireTransformResult {
  const transform = createOutputWireTransform(outputPortsWithReads, options);
  return transform.transform(module);
}
