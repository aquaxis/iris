import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  Item,
  ModDef,
  ModItem,
  Stmt,
  SourceSpan,
  CombBlock,
  FnDef,
  TestDef,
  PackageDecl,
  InterfaceDef,
} from '@irisfmt/core';

/**
 * Lint rule that enforces var declaration context restrictions.
 *
 * According to IRIS specification (2026-01-06 update):
 * - `var` declarations can ONLY be used in sync/fsm blocks (sequential logic only)
 * - `var` declarations are NOT allowed in:
 *   - Direct module-level declarations (outside any logic block)
 *   - comb blocks (combinational logic)
 *   - function bodies
 *   - test bodies
 *
 * This rule detects var declarations used outside sync/fsm blocks.
 */
export const varContextRestrictionRule: LintRule = {
  name: 'var-context-restriction',
  description: 'Disallow var declarations outside sync/fsm blocks',
  category: 'correctness',
  defaultSeverity: 'error',

  check(ctx: LintContext): void {
    visitSourceFile(ctx, ctx.ast);
  },
};

type VarContext = 'module' | 'sync' | 'fsm' | 'comb' | 'function' | 'test';

function visitSourceFile(ctx: LintContext, file: SourceFile): void {
  for (const item of file.items) {
    visitItem(ctx, item);
  }
}

function visitItem(ctx: LintContext, item: Item): void {
  switch (item.kind) {
    case 'ModDef':
      visitModDef(ctx, item);
      break;
    case 'FnDef':
      visitFnDef(ctx, item);
      break;
    case 'TestDef':
      visitTestDef(ctx, item);
      break;
    case 'PackageDecl':
      visitPackageDecl(ctx, item);
      break;
    case 'InterfaceDef':
      visitInterfaceDef(ctx, item);
      break;
    // Other items don't contain var declarations
  }
}

function visitModDef(ctx: LintContext, mod: ModDef): void {
  for (const item of mod.items) {
    visitModItem(ctx, item, 'module');
  }
}

function visitModItem(ctx: LintContext, item: ModItem, context: VarContext): void {
  switch (item.kind) {
    case 'VarDecl':
      // var at module level (outside any block) is NOT allowed
      if (context === 'module') {
        reportVarInInvalidContext(ctx, item.name.span, 'module level', item.name.name);
      }
      // Note: var inside sync/fsm is allowed, var inside comb is not
      if (context === 'comb') {
        reportVarInInvalidContext(ctx, item.name.span, 'comb block', item.name.name);
      }
      break;
    case 'CombBlock':
      visitCombBlock(ctx, item);
      break;
    case 'SyncBlock':
      // var is allowed inside sync blocks - check statements
      visitStmtsInContext(ctx, item.stmts, 'sync');
      break;
    case 'FsmBlock':
      // var is allowed inside fsm blocks - check transition actions
      for (const trans of item.transitions.items) {
        for (const when of trans.whenClauses) {
          for (const action of when.actions) {
            if (action.kind === 'Stmt') {
              visitStmtInContext(ctx, action.stmt, 'fsm');
            }
          }
        }
      }
      break;
    case 'LetDecl':
    case 'ConstDecl':
    case 'TypeAlias':
    case 'InstDecl':
    case 'MemDecl':
      // These don't contain var declarations directly
      break;
  }
}

function visitCombBlock(ctx: LintContext, block: CombBlock): void {
  visitStmtsInContext(ctx, block.stmts, 'comb');
}

function visitStmtsInContext(ctx: LintContext, stmts: Stmt[], context: VarContext): void {
  for (const stmt of stmts) {
    visitStmtInContext(ctx, stmt, context);
  }
}

function visitStmtInContext(ctx: LintContext, stmt: Stmt, context: VarContext): void {
  switch (stmt.kind) {
    case 'VarDecl':
      // Check if var is in invalid context
      if (context === 'comb') {
        reportVarInInvalidContext(ctx, stmt.name.span, 'comb block', stmt.name.name);
      }
      if (context === 'function') {
        reportVarInInvalidContext(ctx, stmt.name.span, 'function body', stmt.name.name);
      }
      if (context === 'test') {
        reportVarInInvalidContext(ctx, stmt.name.span, 'test body', stmt.name.name);
      }
      // var in sync/fsm context is OK
      break;
    case 'IfStmt':
      visitStmtsInContext(ctx, stmt.thenBlock, context);
      if (stmt.elseBlock) {
        if (Array.isArray(stmt.elseBlock)) {
          visitStmtsInContext(ctx, stmt.elseBlock, context);
        } else {
          visitStmtInContext(ctx, stmt.elseBlock, context);
        }
      }
      break;
    case 'ForStmt':
      visitStmtsInContext(ctx, stmt.body, context);
      break;
    case 'WhileStmt':
      visitStmtsInContext(ctx, stmt.body, context);
      break;
    case 'BlockStmt':
      visitStmtsInContext(ctx, stmt.stmts, context);
      break;
    case 'MatchStmt':
      for (const arm of stmt.arms) {
        if (arm.body.kind === 'BlockStmt') {
          visitStmtsInContext(ctx, arm.body.stmts, context);
        }
      }
      break;
    // Other statement kinds don't contain var declarations
  }
}

function visitFnDef(ctx: LintContext, fn: FnDef): void {
  // Function bodies cannot contain var declarations
  visitStmtsInContext(ctx, fn.body, 'function');
}

function visitTestDef(ctx: LintContext, test: TestDef): void {
  // Test bodies cannot contain var declarations
  for (const stmt of test.body) {
    if ('kind' in stmt) {
      // Cast to Stmt since TestStmt is a union type
      const s = stmt as unknown as Stmt;
      if (s.kind === 'VarDecl') {
        reportVarInInvalidContext(ctx, s.name.span, 'test body', s.name.name);
      }
      // Also check nested statements
      visitStmtInContext(ctx, s, 'test');
    }
  }
}

function visitPackageDecl(ctx: LintContext, pkg: PackageDecl): void {
  for (const item of pkg.items) {
    visitItem(ctx, item);
  }
}

function visitInterfaceDef(_ctx: LintContext, _iface: InterfaceDef): void {
  // Interfaces don't contain var declarations
  // Just a placeholder for completeness
}

function reportVarInInvalidContext(
  ctx: LintContext,
  span: SourceSpan,
  context: string,
  varName: string
): void {
  ctx.report({
    rule: 'var-context-restriction',
    message: `'var ${varName}' is not allowed in ${context}. 'var' declarations can only be used inside sync/fsm blocks (sequential logic only).`,
    span,
    severity: ctx.getConfig().severity,
  });
}
