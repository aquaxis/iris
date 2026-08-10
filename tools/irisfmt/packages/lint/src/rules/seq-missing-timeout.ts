import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  Item,
  TestModDef,
  TestModItem,
  SeqBlock,
  SeqStatement,
  SourceSpan,
} from '@irisfmt/core';

/**
 * Lint rule that finds waits inside a `seq` block that can never end.
 *
 * `await until(condition)` takes an optional timeout. Without one, a condition
 * that never becomes true stops the sequence for the rest of the run — and a
 * testbench that stops waiting reports nothing at all. That failure looks
 * exactly like a test which had nothing to say, which is the worst way for a
 * test to fail.
 *
 * ```
 * await until(done);          // warned about
 * await until(done, 1us);     // fine
 * ```
 */
export const seqMissingTimeoutRule: LintRule = {
  name: 'seq-missing-timeout',
  description: 'Require a timeout on an unbounded await inside a seq block',
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
  // A `seq` block only appears among a test module's items
  if (item.kind === 'TestModDef') {
    visitTestModDef(ctx, item);
  }
}

function visitTestModDef(ctx: LintContext, testMod: TestModDef): void {
  for (const item of testMod.items) {
    visitTestModItem(ctx, item);
  }
}

function visitTestModItem(ctx: LintContext, item: TestModItem): void {
  if (item.kind === 'SeqBlock') {
    visitSeqBlock(ctx, item);
  }
}

function visitSeqBlock(ctx: LintContext, block: SeqBlock): void {
  for (const stmt of block.body) {
    visitSeqStatement(ctx, stmt);
  }
}

function visitSeqStatement(ctx: LintContext, stmt: SeqStatement): void {
  if (stmt.kind !== 'AwaitStmt') {
    return;
  }

  const await_ = stmt.awaitExpr;
  if (await_.kind === 'UntilAwait' && await_.timeout === undefined) {
    report(
      ctx,
      stmt.span,
      'await until(...) has no timeout; if the condition never holds the sequence stops for the rest of the run'
    );
  }
}

function report(ctx: LintContext, span: SourceSpan, message: string): void {
  ctx.report({
    rule: 'seq-missing-timeout',
    message,
    span,
    severity: ctx.getConfig().severity,
  });
}
