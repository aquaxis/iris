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
  MatchStmt,
  Expr,
  BinaryExpr,
  SourceSpan,
} from '@irisfmt/core';

/**
 * Default threshold for cyclomatic complexity.
 * Functions with complexity above this value will trigger a warning.
 */
const DEFAULT_THRESHOLD = 15;

/**
 * Lint rule that warns about high cyclomatic complexity.
 * Cyclomatic complexity measures the number of independent paths through a function.
 * High complexity often indicates code that is hard to understand and maintain.
 */
export const complexityRule: LintRule = {
  name: 'complexity',
  description: 'Warn about high cyclomatic complexity in functions',
  category: 'suspicious',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    const threshold = getThreshold(ctx);
    visitSourceFile(ctx, ctx.ast, threshold);
  },
};

function getThreshold(ctx: LintContext): number {
  const config = ctx.getConfig();
  if (config.options && typeof config.options['threshold'] === 'number') {
    return config.options['threshold'];
  }
  return DEFAULT_THRESHOLD;
}

function visitSourceFile(ctx: LintContext, file: SourceFile, threshold: number): void {
  for (const item of file.items) {
    visitItem(ctx, item, threshold);
  }
}

function visitItem(ctx: LintContext, item: Item, threshold: number): void {
  switch (item.kind) {
    case 'ModDef':
      visitModDef(ctx, item, threshold);
      break;
    case 'FnDef':
      checkFunctionComplexity(ctx, item, threshold);
      break;
    case 'EnumDef':
    case 'StructDef':
    case 'TypeAlias':
    case 'InterfaceDef':
    case 'PackageDecl':
    case 'ImportDecl':
    case 'ConstDef':
    case 'TestDef':
      // These don't have executable code or are test definitions
      break;
  }
}

function visitModDef(ctx: LintContext, mod: ModDef, threshold: number): void {
  for (const item of mod.items) {
    visitModItem(ctx, item, threshold);
  }
}

function visitModItem(ctx: LintContext, item: ModItem, threshold: number): void {
  switch (item.kind) {
    case 'CombBlock':
      checkCombBlockComplexity(ctx, item, threshold);
      break;
    case 'SyncBlock':
      checkSyncBlockComplexity(ctx, item, threshold);
      break;
    case 'FsmBlock':
    case 'LetDecl':
    case 'VarDecl':
    case 'ConstDecl':
    case 'TypeAlias':
    case 'InstDecl':
    case 'MemDecl':
      // These don't have significant complexity to measure
      break;
  }
}

function checkFunctionComplexity(ctx: LintContext, fn: FnDef, threshold: number): void {
  const complexity = calculateComplexity(fn.body);
  if (complexity > threshold) {
    reportHighComplexity(ctx, fn.span, fn.name.name, 'Function', complexity, threshold);
  }
}

function checkCombBlockComplexity(ctx: LintContext, block: CombBlock, threshold: number): void {
  const complexity = calculateComplexity(block.stmts);
  if (complexity > threshold) {
    reportHighComplexity(ctx, block.span, 'comb', 'Combinational block', complexity, threshold);
  }
}

function checkSyncBlockComplexity(ctx: LintContext, block: SyncBlock, threshold: number): void {
  const complexity = calculateComplexity(block.stmts);
  if (complexity > threshold) {
    reportHighComplexity(ctx, block.span, 'sync', 'Synchronous block', complexity, threshold);
  }
}

/**
 * Calculate cyclomatic complexity for a list of statements.
 * Cyclomatic complexity starts at 1 and increases by 1 for each:
 * - if statement (each condition adds 1)
 * - for loop
 * - while loop
 * - match arm (each arm adds 1, minus 1 for the base match)
 * - && and || operators in conditions
 */
function calculateComplexity(stmts: Stmt[]): number {
  let complexity = 1; // Base complexity

  for (const stmt of stmts) {
    complexity += calculateStmtComplexity(stmt);
  }

  return complexity;
}

function calculateStmtComplexity(stmt: Stmt): number {
  let complexity = 0;

  switch (stmt.kind) {
    case 'IfStmt':
      complexity += calculateIfComplexity(stmt);
      break;
    case 'ForStmt':
      complexity += calculateForComplexity(stmt);
      break;
    case 'WhileStmt':
      complexity += calculateWhileComplexity(stmt);
      break;
    case 'MatchStmt':
      complexity += calculateMatchComplexity(stmt);
      break;
    case 'BlockStmt':
      complexity += calculateBlockComplexity(stmt);
      break;
    case 'LetDecl':
    case 'VarDecl':
    case 'AssignStmt':
    case 'ReturnStmt':
    case 'ExprStmt':
      // These don't add to complexity
      break;
  }

  return complexity;
}

function calculateIfComplexity(stmt: IfStmt): number {
  // +1 for the if branch
  let complexity = 1;

  // Add complexity from logical operators in condition
  complexity += countLogicalOperators(stmt.condition);

  // Add complexity from then block
  for (const s of stmt.thenBlock) {
    complexity += calculateStmtComplexity(s);
  }

  // Add complexity from else block
  if (stmt.elseBlock !== undefined) {
    if (Array.isArray(stmt.elseBlock)) {
      for (const s of stmt.elseBlock) {
        complexity += calculateStmtComplexity(s);
      }
    } else {
      // else if - recursively count
      complexity += calculateIfComplexity(stmt.elseBlock);
    }
  }

  return complexity;
}

function calculateForComplexity(stmt: ForStmt): number {
  // +1 for the loop
  let complexity = 1;

  // Add complexity from body
  for (const s of stmt.body) {
    complexity += calculateStmtComplexity(s);
  }

  return complexity;
}

function calculateWhileComplexity(stmt: WhileStmt): number {
  // +1 for the loop
  let complexity = 1;

  // Add complexity from logical operators in condition
  complexity += countLogicalOperators(stmt.condition);

  // Add complexity from body
  for (const s of stmt.body) {
    complexity += calculateStmtComplexity(s);
  }

  return complexity;
}

function calculateMatchComplexity(stmt: MatchStmt): number {
  // Each arm adds 1 to complexity (like a series of if-else-if)
  // But we subtract 1 because the first arm is like the initial path
  let complexity = Math.max(0, stmt.arms.length - 1);

  // Add complexity from arm bodies
  for (const arm of stmt.arms) {
    if (arm.body.kind === 'BlockStmt') {
      complexity += calculateBlockComplexity(arm.body);
    }
  }

  return complexity;
}

function calculateBlockComplexity(stmt: BlockStmt): number {
  let complexity = 0;

  for (const s of stmt.stmts) {
    complexity += calculateStmtComplexity(s);
  }

  return complexity;
}

/**
 * Count the number of && and || operators in an expression.
 * These add to complexity as they create additional decision points.
 */
function countLogicalOperators(expr: Expr): number {
  let count = 0;

  if (expr.kind === 'BinaryExpr') {
    const binExpr = expr as unknown as BinaryExpr;
    if (binExpr.op === '&&' || binExpr.op === '||') {
      count += 1;
    }
    count += countLogicalOperators(binExpr.left);
    count += countLogicalOperators(binExpr.right);
  } else if (expr.kind === 'ParenExpr') {
    count += countLogicalOperators(expr.inner);
  }

  return count;
}

function reportHighComplexity(
  ctx: LintContext,
  span: SourceSpan,
  name: string,
  kind: string,
  complexity: number,
  threshold: number
): void {
  ctx.report({
    rule: 'complexity',
    message: `${kind} '${name}' has a cyclomatic complexity of ${String(complexity)} (threshold: ${String(threshold)})`,
    span,
    severity: ctx.getConfig().severity,
  });
}
