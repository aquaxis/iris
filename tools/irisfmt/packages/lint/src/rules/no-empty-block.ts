import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  Item,
  ModDef,
  ModItem,
  FnDef,
  CombBlock,
  SyncBlock,
  FsmBlock,
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
 * Lint rule that detects empty blocks.
 * Empty blocks are usually a sign of incomplete code or a mistake.
 */
export const noEmptyBlockRule: LintRule = {
  name: 'no-empty-block',
  description: 'Disallow empty blocks',
  category: 'suspicious',
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
      // These don't have blocks to check
      break;
  }
}

function visitModDef(ctx: LintContext, mod: ModDef): void {
  // Visit module items (we don't warn about empty module bodies - that's a different concern)
  for (const item of mod.items) {
    visitModItem(ctx, item);
  }
}

function visitModItem(ctx: LintContext, item: ModItem): void {
  switch (item.kind) {
    case 'CombBlock':
      visitCombBlock(ctx, item);
      break;
    case 'SyncBlock':
      visitSyncBlock(ctx, item);
      break;
    case 'FsmBlock':
      visitFsmBlock(ctx, item);
      break;
    case 'LetDecl':
    case 'VarDecl':
    case 'ConstDecl':
    case 'TypeAlias':
    case 'InstDecl':
    case 'MemDecl':
      // These don't have blocks to check
      break;
  }
}

function visitCombBlock(ctx: LintContext, block: CombBlock): void {
  if (block.stmts.length === 0) {
    reportEmptyBlock(ctx, block.span, 'comb block');
  } else {
    visitStmts(ctx, block.stmts);
  }
}

function visitSyncBlock(ctx: LintContext, block: SyncBlock): void {
  if (block.stmts.length === 0) {
    reportEmptyBlock(ctx, block.span, 'sync block');
  } else {
    visitStmts(ctx, block.stmts);
  }
}

function visitFsmBlock(ctx: LintContext, block: FsmBlock): void {
  // FSM blocks must have state definitions and transitions
  // Check if transitions block is empty
  if (block.transitions.items.length === 0) {
    reportEmptyBlock(ctx, block.transitions.span, 'transitions block');
  }
}

function visitFnDef(ctx: LintContext, fn: FnDef): void {
  if (fn.body.length === 0) {
    reportEmptyBlock(ctx, fn.span, 'function body');
  } else {
    visitStmts(ctx, fn.body);
  }
}

function visitTestDef(ctx: LintContext, test: TestDef): void {
  if (test.body.length === 0) {
    reportEmptyBlock(ctx, test.span, 'test body');
  }
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
      // These don't have blocks to check
      break;
  }
}

function visitIfStmt(ctx: LintContext, stmt: IfStmt): void {
  if (stmt.thenBlock.length === 0) {
    reportEmptyBlock(ctx, stmt.span, 'if block');
  } else {
    visitStmts(ctx, stmt.thenBlock);
  }

  if (stmt.elseBlock !== undefined) {
    if (Array.isArray(stmt.elseBlock)) {
      if (stmt.elseBlock.length === 0) {
        reportEmptyBlock(ctx, stmt.span, 'else block');
      } else {
        visitStmts(ctx, stmt.elseBlock);
      }
    } else {
      // else if
      visitIfStmt(ctx, stmt.elseBlock);
    }
  }
}

function visitForStmt(ctx: LintContext, stmt: ForStmt): void {
  if (stmt.body.length === 0) {
    reportEmptyBlock(ctx, stmt.span, 'for loop body');
  } else {
    visitStmts(ctx, stmt.body);
  }
}

function visitWhileStmt(ctx: LintContext, stmt: WhileStmt): void {
  if (stmt.body.length === 0) {
    reportEmptyBlock(ctx, stmt.span, 'while loop body');
  } else {
    visitStmts(ctx, stmt.body);
  }
}

function visitBlockStmt(ctx: LintContext, stmt: BlockStmt): void {
  if (stmt.stmts.length === 0) {
    reportEmptyBlock(ctx, stmt.span, 'block');
  } else {
    visitStmts(ctx, stmt.stmts);
  }
}

function visitMatchArm(ctx: LintContext, arm: MatchArm): void {
  if (arm.body.kind === 'BlockStmt') {
    visitBlockStmt(ctx, arm.body);
  }
}

function reportEmptyBlock(ctx: LintContext, span: SourceSpan, blockType: string): void {
  ctx.report({
    rule: 'no-empty-block',
    message: `Empty ${blockType}`,
    span,
    severity: ctx.getConfig().severity,
  });
}
