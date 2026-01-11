import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  Item,
  ModDef,
  ModItem,
  FnDef,
  CombBlock,
  SyncBlock,
  Stmt,
  IfStmt,
  ForStmt,
  WhileStmt,
  BlockStmt,
  MatchArm,
  TestDef,
  SourceSpan,
} from '@irisfmt/core';

/**
 * Lint rule that detects unreachable code (dead code).
 * Code after return statements or at the end of blocks after unconditional returns
 * is unreachable and likely a mistake.
 */
export const deadCodeRule: LintRule = {
  name: 'dead-code',
  description: 'Detect unreachable code after return statements',
  category: 'correctness',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    visitSourceFile(ctx, ctx.ast);
  },
};

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
    case 'EnumDef':
    case 'StructDef':
    case 'TypeAlias':
    case 'InterfaceDef':
    case 'PackageDecl':
    case 'ImportDecl':
    case 'ConstDef':
      // These don't have executable code
      break;
  }
}

function visitModDef(ctx: LintContext, mod: ModDef): void {
  for (const item of mod.items) {
    visitModItem(ctx, item);
  }
}

function visitModItem(ctx: LintContext, item: ModItem): void {
  switch (item.kind) {
    case 'CombBlock':
      checkStmtsForDeadCode(ctx, item.stmts);
      visitCombBlock(ctx, item);
      break;
    case 'SyncBlock':
      checkStmtsForDeadCode(ctx, item.stmts);
      visitSyncBlock(ctx, item);
      break;
    case 'FsmBlock':
      // FSM blocks have special control flow through state transitions
      break;
    case 'LetDecl':
    case 'VarDecl':
    case 'ConstDecl':
    case 'TypeAlias':
    case 'InstDecl':
    case 'MemDecl':
      // These don't have executable code
      break;
  }
}

function visitCombBlock(ctx: LintContext, block: CombBlock): void {
  visitStmts(ctx, block.stmts);
}

function visitSyncBlock(ctx: LintContext, block: SyncBlock): void {
  visitStmts(ctx, block.stmts);
}

function visitFnDef(ctx: LintContext, fn: FnDef): void {
  checkStmtsForDeadCode(ctx, fn.body);
  visitStmts(ctx, fn.body);
}

function visitTestDef(ctx: LintContext, test: TestDef): void {
  // TestDef has TestStmt[] which includes Stmt
  // For simplicity, we handle basic statements
  const stmts = test.body.filter(
    (s): s is Stmt =>
      s.kind === 'LetDecl' ||
      s.kind === 'VarDecl' ||
      s.kind === 'AssignStmt' ||
      s.kind === 'IfStmt' ||
      s.kind === 'MatchStmt' ||
      s.kind === 'ForStmt' ||
      s.kind === 'WhileStmt' ||
      s.kind === 'ReturnStmt' ||
      s.kind === 'BlockStmt' ||
      s.kind === 'ExprStmt'
  );
  checkStmtsForDeadCode(ctx, stmts);
  visitStmts(ctx, stmts);
}

function visitStmts(ctx: LintContext, stmts: Stmt[]): void {
  for (const stmt of stmts) {
    visitStmt(ctx, stmt);
  }
}

function visitStmt(ctx: LintContext, stmt: Stmt): void {
  switch (stmt.kind) {
    case 'IfStmt':
      visitIfStmt(ctx, stmt);
      break;
    case 'ForStmt':
      visitForStmt(ctx, stmt);
      break;
    case 'WhileStmt':
      visitWhileStmt(ctx, stmt);
      break;
    case 'BlockStmt':
      visitBlockStmt(ctx, stmt);
      break;
    case 'MatchStmt':
      for (const arm of stmt.arms) {
        visitMatchArm(ctx, arm);
      }
      break;
    case 'LetDecl':
    case 'VarDecl':
    case 'AssignStmt':
    case 'ReturnStmt':
    case 'ExprStmt':
      // These don't have nested blocks to check
      break;
  }
}

function visitIfStmt(ctx: LintContext, stmt: IfStmt): void {
  checkStmtsForDeadCode(ctx, stmt.thenBlock);
  visitStmts(ctx, stmt.thenBlock);

  if (stmt.elseBlock !== undefined) {
    if (Array.isArray(stmt.elseBlock)) {
      checkStmtsForDeadCode(ctx, stmt.elseBlock);
      visitStmts(ctx, stmt.elseBlock);
    } else {
      // else if
      visitIfStmt(ctx, stmt.elseBlock);
    }
  }
}

function visitForStmt(ctx: LintContext, stmt: ForStmt): void {
  checkStmtsForDeadCode(ctx, stmt.body);
  visitStmts(ctx, stmt.body);
}

function visitWhileStmt(ctx: LintContext, stmt: WhileStmt): void {
  checkStmtsForDeadCode(ctx, stmt.body);
  visitStmts(ctx, stmt.body);
}

function visitBlockStmt(ctx: LintContext, stmt: BlockStmt): void {
  checkStmtsForDeadCode(ctx, stmt.stmts);
  visitStmts(ctx, stmt.stmts);
}

function visitMatchArm(ctx: LintContext, arm: MatchArm): void {
  if (arm.body.kind === 'BlockStmt') {
    visitBlockStmt(ctx, arm.body);
  }
}

/**
 * Check a list of statements for unreachable code.
 * Reports all statements that follow a return statement as dead code.
 */
function checkStmtsForDeadCode(ctx: LintContext, stmts: Stmt[]): void {
  let foundReturn = false;
  let returnSpan: SourceSpan | null = null;

  for (const stmt of stmts) {
    if (foundReturn && returnSpan !== null) {
      // All statements after return are unreachable
      reportDeadCode(ctx, stmt.span, returnSpan);
    }

    if (stmt.kind === 'ReturnStmt') {
      foundReturn = true;
      returnSpan = stmt.span;
    }
  }
}

function reportDeadCode(
  ctx: LintContext,
  span: SourceSpan,
  _returnSpan: SourceSpan
): void {
  ctx.report({
    rule: 'dead-code',
    message: 'Unreachable code detected after return statement',
    span,
    severity: ctx.getConfig().severity,
  });
}
