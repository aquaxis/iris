import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  ImportDecl,
  SourceSpan,
} from '@irisfmt/core';

interface ImportEntry {
  path: string;
  span: SourceSpan;
}

/**
 * Lint rule that detects duplicate imports.
 * Reports when the same module path is imported multiple times.
 */
export const duplicateImportRule: LintRule = {
  name: 'duplicate-import',
  description: 'Disallow duplicate imports',
  category: 'correctness',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    const imports = collectImportPaths(ctx.ast);
    const seen = new Map<string, SourceSpan>();

    for (const imp of imports) {
      const existing = seen.get(imp.path);
      if (existing) {
        ctx.report({
          rule: 'duplicate-import',
          message: `Duplicate import of '${imp.path}'`,
          span: imp.span,
          severity: ctx.getConfig().severity,
          fix: {
            description: `Remove duplicate import of '${imp.path}'`,
            changes: [{
              span: imp.span,
              newText: '',
            }],
          },
        });
      } else {
        seen.set(imp.path, imp.span);
      }
    }
  },
};

function collectImportPaths(file: SourceFile): ImportEntry[] {
  const imports: ImportEntry[] = [];

  for (const item of file.items) {
    if (item.kind === 'ImportDecl') {
      collectFromImportDecl(item, imports);
    } else if (item.kind === 'PackageDecl') {
      for (const pkgItem of item.items) {
        if (pkgItem.kind === 'ImportDecl') {
          collectFromImportDecl(pkgItem, imports);
        }
      }
    }
  }

  return imports;
}

function collectFromImportDecl(decl: ImportDecl, imports: ImportEntry[]): void {
  switch (decl.path.kind) {
    case 'Simple': {
      const pathStr = decl.path.path.segments.map(s => s.name).join('::');
      imports.push({
        path: pathStr,
        span: decl.span,
      });
      break;
    }
    case 'Glob': {
      // import foo::* - use the base path
      const pathStr = decl.path.path.segments.map(s => s.name).join('::') + '::*';
      imports.push({
        path: pathStr,
        span: decl.span,
      });
      break;
    }
    case 'List': {
      // import foo::{bar, baz} - track each item separately
      const basePath = decl.path.path.segments.map(s => s.name).join('::');
      for (const item of decl.path.items) {
        const fullPath = basePath ? `${basePath}::${item.name.name}` : item.name.name;
        imports.push({
          path: fullPath,
          span: item.span,
        });
      }
      break;
    }
  }
}
