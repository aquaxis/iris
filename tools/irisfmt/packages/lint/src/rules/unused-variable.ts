import type { LintRule, LintContext } from '../rule.js';
import type {
  Item,
  ModDef,
  ModItem,
  FnDef,
  Expr,
  Stmt,
  Pattern,
  SourceSpan,
  TestDef,
  ConstDef,
  PackageDecl,
  LValue,
} from '@irisfmt/core';

interface VariableInfo {
  name: string;
  span: SourceSpan;
  used: boolean;
}

interface Scope {
  variables: Map<string, VariableInfo>;
  parent: Scope | null;
}

/**
 * Lint rule that detects unused variables.
 * Reports let/var declarations that are never used.
 */
export const unusedVariableRule: LintRule = {
  name: 'unused-variable',
  description: 'Disallow unused variables',
  category: 'correctness',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    const checker = new UnusedVariableChecker(ctx);
    checker.check();
  },
};

class UnusedVariableChecker {
  private readonly ctx: LintContext;
  private currentScope: Scope;

  constructor(ctx: LintContext) {
    this.ctx = ctx;
    this.currentScope = { variables: new Map(), parent: null };
  }

  check(): void {
    for (const item of this.ctx.ast.items) {
      this.checkItem(item);
    }
  }

  private pushScope(): void {
    this.currentScope = { variables: new Map(), parent: this.currentScope };
  }

  private popScope(): void {
    // Report unused variables in current scope before popping
    for (const [name, info] of this.currentScope.variables) {
      if (!info.used && !name.startsWith('_')) {
        this.ctx.report({
          rule: 'unused-variable',
          message: `Unused variable '${name}'`,
          span: info.span,
          severity: this.ctx.getConfig().severity,
        });
      }
    }
    this.currentScope = this.currentScope.parent ?? this.currentScope;
  }

  private declareVariable(name: string, span: SourceSpan): void {
    this.currentScope.variables.set(name, { name, span, used: false });
  }

  private useVariable(name: string): void {
    // Search up the scope chain
    let scope: Scope | null = this.currentScope;
    while (scope !== null) {
      const info = scope.variables.get(name);
      if (info) {
        info.used = true;
        return;
      }
      scope = scope.parent;
    }
  }

  private checkItem(item: Item): void {
    switch (item.kind) {
      case 'ModDef':
        this.checkModDef(item);
        break;
      case 'FnDef':
        this.checkFnDef(item);
        break;
      case 'TestDef':
        this.checkTestDef(item);
        break;
      case 'ConstDef':
        this.checkConstDef(item);
        break;
      case 'PackageDecl':
        this.checkPackageDecl(item);
        break;
      // Other items don't have variable scopes
    }
  }

  private checkModDef(mod: ModDef): void {
    this.pushScope();

    // Module-level items
    for (const item of mod.items) {
      this.checkModItem(item);
    }

    this.popScope();
  }

  private checkModItem(item: ModItem): void {
    switch (item.kind) {
      case 'LetDecl':
      case 'VarDecl':
        // These are signal declarations, not local variables
        // They are typically used for internal state/wires
        // We don't track them as they have different semantics
        if (item.init) {
          this.checkExpr(item.init);
        }
        break;
      case 'ConstDecl':
        this.checkExpr(item.init);
        break;
      case 'CombBlock':
        this.pushScope();
        for (const stmt of item.stmts) {
          this.checkStmt(stmt);
        }
        this.popScope();
        break;
      case 'SyncBlock':
        this.checkExpr(item.clock.signal);
        if (item.reset) {
          this.checkExpr(item.reset.signal);
        }
        this.pushScope();
        for (const stmt of item.stmts) {
          this.checkStmt(stmt);
        }
        this.popScope();
        break;
      case 'FsmBlock':
        this.checkExpr(item.clock.signal);
        if (item.reset) {
          this.checkExpr(item.reset.signal);
        }
        // Check transitions and outputs
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

  private checkFnDef(fn: FnDef): void {
    this.pushScope();

    // Declare parameters as variables
    for (const param of fn.params) {
      this.declareVariable(param.name.name, param.span);
    }

    // Check body
    for (const stmt of fn.body) {
      this.checkStmt(stmt);
    }

    this.popScope();
  }

  private checkTestDef(test: TestDef): void {
    this.pushScope();

    for (const stmt of test.body) {
      if ('kind' in stmt) {
        switch (stmt.kind) {
          case 'AssertStmt':
            this.checkExpr(stmt.condition);
            break;
          case 'WaitStmt':
            if (stmt.condition.kind === 'ExprWait') {
              this.checkExpr(stmt.condition.expr);
            } else if (stmt.condition.kind === 'ClockWait') {
              this.checkExpr(stmt.condition.clock.signal);
            }
            break;
          case 'DriveStmt':
            this.checkExpr(stmt.value);
            break;
          case 'SampleStmt':
            this.checkExpr(stmt.expr);
            break;
          default:
            this.checkStmt(stmt);
        }
      }
    }

    this.popScope();
  }

  private checkConstDef(def: ConstDef): void {
    this.checkExpr(def.init);
  }

  private checkPackageDecl(pkg: PackageDecl): void {
    for (const item of pkg.items) {
      this.checkItem(item);
    }
  }

  private checkStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'LetDecl':
      case 'VarDecl':
        // Check the initializer first (uses variables before declaring new ones)
        if (stmt.init) {
          this.checkExpr(stmt.init);
        }
        // Declare the variable
        this.declareVariable(stmt.name.name, stmt.name.span);
        break;
      case 'AssignStmt':
        // Assignment target uses the variable
        this.checkLValue(stmt.lvalue);
        this.checkExpr(stmt.value);
        break;
      case 'IfStmt':
        this.checkExpr(stmt.condition);
        this.pushScope();
        for (const s of stmt.thenBlock) {
          this.checkStmt(s);
        }
        this.popScope();
        if (stmt.elseBlock) {
          this.pushScope();
          if (Array.isArray(stmt.elseBlock)) {
            for (const s of stmt.elseBlock) {
              this.checkStmt(s);
            }
          } else {
            this.checkStmt(stmt.elseBlock);
          }
          this.popScope();
        }
        break;
      case 'MatchStmt':
        this.checkExpr(stmt.scrutinee);
        for (const arm of stmt.arms) {
          this.pushScope();
          this.declareFromPattern(arm.pattern);
          if (arm.body.kind === 'BlockStmt') {
            for (const s of arm.body.stmts) {
              this.checkStmt(s);
            }
          } else {
            this.checkExpr(arm.body);
          }
          this.popScope();
        }
        break;
      case 'ForStmt':
        this.pushScope();
        // Loop variable
        this.declareVariable(stmt.variable.name, stmt.variable.span);
        this.checkExpr(stmt.range.start);
        this.checkExpr(stmt.range.end);
        for (const s of stmt.body) {
          this.checkStmt(s);
        }
        this.popScope();
        break;
      case 'WhileStmt':
        this.checkExpr(stmt.condition);
        this.pushScope();
        for (const s of stmt.body) {
          this.checkStmt(s);
        }
        this.popScope();
        break;
      case 'ReturnStmt':
        if (stmt.value) {
          this.checkExpr(stmt.value);
        }
        break;
      case 'BlockStmt':
        this.pushScope();
        for (const s of stmt.stmts) {
          this.checkStmt(s);
        }
        this.popScope();
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
        this.useVariable(expr.name.name);
        break;
      case 'PathExpr':
        // Only the first segment could be a local variable
        const firstSeg = expr.path.segments[0];
        if (firstSeg) {
          this.useVariable(firstSeg.name);
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
          this.pushScope();
          this.declareFromPattern(arm.pattern);
          if (arm.body.kind === 'BlockStmt') {
            for (const s of arm.body.stmts) {
              this.checkStmt(s);
            }
          } else {
            this.checkExpr(arm.body);
          }
          this.popScope();
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
        this.useVariable(lvalue.name.name);
        break;
      case 'IndexLValue':
        this.checkLValue(lvalue.base);
        this.checkExpr(lvalue.index);
        break;
      case 'FieldLValue':
        this.checkLValue(lvalue.base);
        break;
    }
  }

  private declareFromPattern(pattern: Pattern): void {
    switch (pattern.kind) {
      case 'IdentPattern':
        this.declareVariable(pattern.name.name, pattern.span);
        break;
      case 'TuplePattern':
        for (const elem of pattern.elements) {
          this.declareFromPattern(elem);
        }
        break;
      case 'StructPattern':
        for (const field of pattern.fields) {
          if (field.pattern) {
            this.declareFromPattern(field.pattern);
          } else {
            // Shorthand: field name is used as variable name
            this.declareVariable(field.name.name, field.span);
          }
        }
        break;
      // LiteralPattern, WildcardPattern, PathPattern, RangePattern don't declare variables
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
