import type { LintRule, LintContext } from '../rule.js';
import type {
  Item,
  ModDef,
  ModItem,
  Expr,
  Stmt,
  SourceSpan,
  LValue,
  PackageDecl,
} from '@irisfmt/core';

interface SignalInfo {
  name: string;
  span: SourceSpan;
  used: boolean;
  isPort: boolean;
}

/**
 * Lint rule that detects unused signals in modules.
 * Reports let/var declarations in modules that are never read or written.
 * Port signals are never reported as unused since they are part of the interface.
 */
export const unusedSignalRule: LintRule = {
  name: 'unused-signal',
  description: 'Disallow unused signals in modules',
  category: 'correctness',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    const checker = new UnusedSignalChecker(ctx);
    checker.check();
  },
};

class UnusedSignalChecker {
  private readonly ctx: LintContext;
  private readonly signals = new Map<string, SignalInfo>();

  constructor(ctx: LintContext) {
    this.ctx = ctx;
  }

  check(): void {
    for (const item of this.ctx.ast.items) {
      this.checkItem(item);
    }
  }

  private checkItem(item: Item): void {
    switch (item.kind) {
      case 'ModDef':
        this.checkModDef(item);
        break;
      case 'PackageDecl':
        this.checkPackageDecl(item);
        break;
    }
  }

  private checkPackageDecl(pkg: PackageDecl): void {
    for (const item of pkg.items) {
      this.checkItem(item);
    }
  }

  private checkModDef(mod: ModDef): void {
    // Reset signals for each module
    this.signals.clear();

    // Register ports as used (they are interface signals)
    for (const port of mod.ports) {
      this.signals.set(port.name.name, {
        name: port.name.name,
        span: port.name.span,
        used: true, // Ports are always considered used
        isPort: true,
      });
    }

    // First pass: collect all signal declarations
    for (const item of mod.items) {
      this.collectSignals(item);
    }

    // Second pass: check for usages
    for (const item of mod.items) {
      this.checkModItem(item);
    }

    // Report unused signals
    for (const [name, info] of this.signals) {
      if (!info.used && !info.isPort && !name.startsWith('_')) {
        this.ctx.report({
          rule: 'unused-signal',
          message: `Unused signal '${name}'`,
          span: info.span,
          severity: this.ctx.getConfig().severity,
        });
      }
    }
  }

  private collectSignals(item: ModItem): void {
    switch (item.kind) {
      case 'LetDecl':
      case 'VarDecl':
        this.signals.set(item.name.name, {
          name: item.name.name,
          span: item.name.span,
          used: false,
          isPort: false,
        });
        break;
    }
  }

  private checkModItem(item: ModItem): void {
    switch (item.kind) {
      case 'LetDecl':
      case 'VarDecl':
        // Check initializer for signal usages
        if (item.init) {
          this.checkExpr(item.init);
        }
        break;
      case 'ConstDecl':
        this.checkExpr(item.init);
        break;
      case 'CombBlock':
        for (const stmt of item.stmts) {
          this.checkStmt(stmt);
        }
        break;
      case 'SyncBlock':
        this.checkExpr(item.clock.signal);
        if (item.reset) {
          this.checkExpr(item.reset.signal);
        }
        for (const stmt of item.stmts) {
          this.checkStmt(stmt);
        }
        break;
      case 'FsmBlock':
        this.checkExpr(item.clock.signal);
        if (item.reset) {
          this.checkExpr(item.reset.signal);
        }
        // Check transitions
        for (const trans of item.transitions.items) {
          for (const when of trans.whenClauses) {
            this.checkExpr(when.condition);
            for (const action of when.actions) {
              if (action.kind === 'Stmt') {
                this.checkStmt(action.stmt);
              }
            }
          }
        }
        // Check outputs
        for (const output of item.outputs) {
          for (const c of output.cases) {
            this.checkExpr(c.value);
          }
        }
        break;
      case 'InstDecl':
        if (item.genericArgs) {
          for (const arg of item.genericArgs) {
            if ('kind' in arg.value && this.isExpr(arg.value)) {
              this.checkExpr(arg.value as Expr);
            }
          }
        }
        for (const conn of item.connections) {
          this.checkExpr(conn.expr);
        }
        break;
      case 'MemDecl':
        this.checkExpr(item.depth);
        if (item.init) {
          this.checkExpr(item.init);
        }
        break;
    }
  }

  private checkStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'LetDecl':
      case 'VarDecl':
        if (stmt.init) {
          this.checkExpr(stmt.init);
        }
        break;
      case 'AssignStmt':
        this.checkLValue(stmt.lvalue);
        this.checkExpr(stmt.value);
        break;
      case 'IfStmt':
        this.checkExpr(stmt.condition);
        for (const s of stmt.thenBlock) {
          this.checkStmt(s);
        }
        if (stmt.elseBlock) {
          if (Array.isArray(stmt.elseBlock)) {
            for (const s of stmt.elseBlock) {
              this.checkStmt(s);
            }
          } else {
            this.checkStmt(stmt.elseBlock);
          }
        }
        break;
      case 'MatchStmt':
        this.checkExpr(stmt.scrutinee);
        for (const arm of stmt.arms) {
          if (arm.body.kind === 'BlockStmt') {
            for (const s of arm.body.stmts) {
              this.checkStmt(s);
            }
          } else {
            this.checkExpr(arm.body);
          }
        }
        break;
      case 'ForStmt':
        this.checkExpr(stmt.range.start);
        this.checkExpr(stmt.range.end);
        for (const s of stmt.body) {
          this.checkStmt(s);
        }
        break;
      case 'WhileStmt':
        this.checkExpr(stmt.condition);
        for (const s of stmt.body) {
          this.checkStmt(s);
        }
        break;
      case 'ReturnStmt':
        if (stmt.value) {
          this.checkExpr(stmt.value);
        }
        break;
      case 'BlockStmt':
        for (const s of stmt.stmts) {
          this.checkStmt(s);
        }
        break;
      case 'ExprStmt':
        this.checkExpr(stmt.expr);
        break;
    }
  }

  private checkExpr(expr: Expr): void {
    switch (expr.kind) {
      case 'LiteralExpr':
        break;
      case 'IdentExpr':
        this.useSignal(expr.name.name);
        break;
      case 'PathExpr':
        // Only the first segment could be a signal
        const firstSeg = expr.path.segments[0];
        if (firstSeg) {
          this.useSignal(firstSeg.name);
        }
        break;
      case 'UnaryExpr':
        this.checkExpr(expr.operand);
        break;
      case 'BinaryExpr':
        this.checkExpr(expr.left);
        this.checkExpr(expr.right);
        break;
      case 'CallExpr':
        this.checkExpr(expr.callee);
        for (const arg of expr.args) {
          this.checkExpr(arg);
        }
        break;
      case 'IndexExpr':
        this.checkExpr(expr.base);
        this.checkExpr(expr.index);
        if (expr.rangeEnd) {
          this.checkExpr(expr.rangeEnd);
        }
        break;
      case 'FieldExpr':
        this.checkExpr(expr.base);
        break;
      case 'CastExpr':
        this.checkExpr(expr.expr);
        break;
      case 'IfExpr':
        this.checkExpr(expr.condition);
        this.checkExpr(expr.thenExpr);
        this.checkExpr(expr.elseExpr);
        break;
      case 'MatchExpr':
        this.checkExpr(expr.scrutinee);
        for (const arm of expr.arms) {
          if (arm.body.kind === 'BlockStmt') {
            for (const s of arm.body.stmts) {
              this.checkStmt(s);
            }
          } else {
            this.checkExpr(arm.body);
          }
        }
        break;
      case 'ConcatExpr':
        for (const elem of expr.elements) {
          this.checkExpr(elem);
        }
        break;
      case 'RepeatExpr':
        this.checkExpr(expr.expr);
        this.checkExpr(expr.count);
        break;
      case 'ParenExpr':
        this.checkExpr(expr.inner);
        break;
    }
  }

  private checkLValue(lvalue: LValue): void {
    switch (lvalue.kind) {
      case 'IdentLValue':
        this.useSignal(lvalue.name.name);
        break;
      case 'IndexLValue':
        this.checkLValue(lvalue.base);
        this.checkExpr(lvalue.index);
        break;
      case 'FieldLValue':
        this.checkLValue(lvalue.base);
        break;
      case 'ConcatLValue':
        for (const elem of lvalue.elements) {
          this.checkLValue(elem);
        }
        break;
    }
  }

  private useSignal(name: string): void {
    const info = this.signals.get(name);
    if (info) {
      info.used = true;
    }
  }

  private isExpr(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const kind = (value as { kind?: string }).kind;
    return kind === 'LiteralExpr' ||
           kind === 'IdentExpr' ||
           kind === 'PathExpr' ||
           kind === 'UnaryExpr' ||
           kind === 'BinaryExpr' ||
           kind === 'CallExpr' ||
           kind === 'IndexExpr' ||
           kind === 'FieldExpr' ||
           kind === 'CastExpr' ||
           kind === 'IfExpr' ||
           kind === 'MatchExpr' ||
           kind === 'ConcatExpr' ||
           kind === 'RepeatExpr' ||
           kind === 'ParenExpr';
  }
}
