import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  ImportDecl,
  SourceSpan,
} from '@irisfmt/core';

interface ImportEntry {
  path: string;
  span: SourceSpan;
  group: ImportGroup;
}

enum ImportGroup {
  Std = 0,      // std:: imports
  External = 1, // other external packages
  Local = 2,    // local/relative imports
}

/**
 * Lint rule that checks import ordering.
 * Imports should be grouped and sorted:
 * 1. std:: imports (standard library)
 * 2. External package imports (alphabetically)
 * 3. Local imports (alphabetically)
 *
 * Within each group, imports should be sorted alphabetically.
 */
export const importOrderRule: LintRule = {
  name: 'import-order',
  description: 'Enforce consistent import ordering',
  category: 'style',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    const imports = collectImports(ctx.ast);

    if (imports.length <= 1) {
      return;
    }

    // Check ordering
    for (let i = 1; i < imports.length; i++) {
      const prev = imports[i - 1]!;
      const curr = imports[i]!;

      if (!isCorrectOrder(prev, curr)) {
        ctx.report({
          rule: 'import-order',
          message: `Import '${curr.path}' should be placed before '${prev.path}'`,
          span: curr.span,
          severity: ctx.getConfig().severity,
        });
      }
    }
  },
};

function collectImports(file: SourceFile): ImportEntry[] {
  const imports: ImportEntry[] = [];

  for (const item of file.items) {
    if (item.kind === 'ImportDecl') {
      collectFromImportDecl(item, imports);
    }
  }

  return imports;
}

function collectFromImportDecl(decl: ImportDecl, imports: ImportEntry[]): void {
  let path: string;

  switch (decl.path.kind) {
    case 'Simple':
      path = decl.path.path.segments.map(s => s.name).join('::');
      break;
    case 'Glob':
      path = decl.path.path.segments.map(s => s.name).join('::') + '::*';
      break;
    case 'List':
      // For list imports, use the base path for ordering
      path = decl.path.path.segments.map(s => s.name).join('::');
      break;
  }

  imports.push({
    path,
    span: decl.span,
    group: getImportGroup(path),
  });
}

function getImportGroup(path: string): ImportGroup {
  if (path.startsWith('std::') || path === 'std') {
    return ImportGroup.Std;
  }
  // Could add more heuristics here for external vs local
  // For now, treat everything non-std as external
  return ImportGroup.External;
}

function isCorrectOrder(prev: ImportEntry, curr: ImportEntry): boolean {
  // Different groups: check group order
  if (prev.group !== curr.group) {
    return prev.group < curr.group;
  }

  // Same group: check alphabetical order
  return prev.path.localeCompare(curr.path) <= 0;
}
