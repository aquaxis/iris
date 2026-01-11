import type { LintRule, LintContext } from '../rule.js';
import type {
  SourceFile,
  Item,
  ModDef,
  ModItem,
  FnDef,
  EnumDef,
  StructDef,
  TypeAlias,
  InterfaceDef,
  ConstDef,
  ImportDecl,
  Expr,
  Stmt,
  TypeExpr,
  Pattern,
  SourceSpan,
  Path,
  TestDef,
} from '@irisfmt/core';

interface ImportInfo {
  name: string;
  span: SourceSpan;
  fullDeclSpan: SourceSpan;
  used: boolean;
}

/**
 * Lint rule that detects unused imports.
 * Reports imports that are declared but never used in the code.
 */
export const unusedImportRule: LintRule = {
  name: 'unused-import',
  description: 'Disallow unused imports',
  category: 'correctness',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    // Collect imports
    const imports = collectImports(ctx.ast);

    // Collect all used identifiers
    const usedNames = collectUsedNames(ctx.ast);

    // Mark used imports
    for (const imp of imports) {
      if (usedNames.has(imp.name)) {
        imp.used = true;
      }
    }

    // Report unused imports
    for (const imp of imports) {
      if (!imp.used) {
        ctx.report({
          rule: 'unused-import',
          message: `Unused import '${imp.name}'`,
          span: imp.span,
          severity: ctx.getConfig().severity,
          fix: {
            description: `Remove unused import '${imp.name}'`,
            changes: [{
              span: imp.fullDeclSpan,
              newText: '',
            }],
          },
        });
      }
    }
  },
};

function collectImports(file: SourceFile): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const item of file.items) {
    if (item.kind === 'ImportDecl') {
      collectImportDecl(item, imports);
    }
  }

  return imports;
}

function collectImportDecl(decl: ImportDecl, imports: ImportInfo[]): void {
  switch (decl.path.kind) {
    case 'Simple': {
      // import foo::bar -> name is 'bar' (or alias if present)
      const segments = decl.path.path.segments;
      if (segments.length === 0) break;
      const lastSegment = segments[segments.length - 1];
      if (!lastSegment) break;
      const lastName = lastSegment.name;
      const name = decl.alias?.name ?? lastName;
      imports.push({
        name,
        span: decl.span,
        fullDeclSpan: decl.span,
        used: false,
      });
      break;
    }
    case 'Glob':
      // import foo::* -> can't track usage, skip
      break;
    case 'List':
      // import foo::{bar, baz}
      // For list imports, we can only suggest removing individual items
      // Full removal would need more context
      for (const item of decl.path.items) {
        const name = item.alias?.name ?? item.name.name;
        imports.push({
          name,
          span: item.span,
          fullDeclSpan: decl.span, // Use full decl span for now
          used: false,
        });
      }
      break;
  }
}

function collectUsedNames(file: SourceFile): Set<string> {
  const names = new Set<string>();

  for (const item of file.items) {
    collectUsedNamesFromItem(item, names);
  }

  return names;
}

function collectUsedNamesFromItem(item: Item, names: Set<string>): void {
  switch (item.kind) {
    case 'ModDef':
      collectUsedNamesFromModDef(item, names);
      break;
    case 'FnDef':
      collectUsedNamesFromFnDef(item, names);
      break;
    case 'EnumDef':
      collectUsedNamesFromEnumDef(item, names);
      break;
    case 'StructDef':
      collectUsedNamesFromStructDef(item, names);
      break;
    case 'TypeAlias':
      collectUsedNamesFromTypeAlias(item, names);
      break;
    case 'InterfaceDef':
      collectUsedNamesFromInterfaceDef(item, names);
      break;
    case 'ConstDef':
      collectUsedNamesFromConstDef(item, names);
      break;
    case 'TestDef':
      collectUsedNamesFromTestDef(item, names);
      break;
    case 'PackageDecl':
      for (const pkgItem of item.items) {
        collectUsedNamesFromItem(pkgItem, names);
      }
      break;
    case 'ImportDecl':
      // Imports don't use other imports
      break;
  }
}

function collectUsedNamesFromModDef(mod: ModDef, names: Set<string>): void {
  // Ports
  for (const port of mod.ports) {
    collectUsedNamesFromTypeExpr(port.typeExpr, names);
  }

  // Generic params
  if (mod.genericParams) {
    for (const param of mod.genericParams.params) {
      if (param.defaultValue) {
        collectUsedNamesFromExpr(param.defaultValue, names);
      }
    }
  }

  // Module items
  for (const item of mod.items) {
    collectUsedNamesFromModItem(item, names);
  }
}

function collectUsedNamesFromModItem(item: ModItem, names: Set<string>): void {
  switch (item.kind) {
    case 'LetDecl':
    case 'VarDecl':
      if (item.typeExpr) {
        collectUsedNamesFromTypeExpr(item.typeExpr, names);
      }
      if (item.init) {
        collectUsedNamesFromExpr(item.init, names);
      }
      break;
    case 'ConstDecl':
      collectUsedNamesFromTypeExpr(item.typeExpr, names);
      collectUsedNamesFromExpr(item.init, names);
      break;
    case 'TypeAlias':
      collectUsedNamesFromTypeExpr(item.typeExpr, names);
      break;
    case 'CombBlock':
      for (const stmt of item.stmts) {
        collectUsedNamesFromStmt(stmt, names);
      }
      break;
    case 'SyncBlock':
      collectUsedNamesFromExpr(item.clock.signal, names);
      if (item.reset) {
        collectUsedNamesFromExpr(item.reset.signal, names);
      }
      for (const stmt of item.stmts) {
        collectUsedNamesFromStmt(stmt, names);
      }
      break;
    case 'FsmBlock':
      collectUsedNamesFromExpr(item.clock.signal, names);
      if (item.reset) {
        collectUsedNamesFromExpr(item.reset.signal, names);
      }
      // States, transitions, outputs
      for (const trans of item.transitions.items) {
        for (const when of trans.whenClauses) {
          collectUsedNamesFromExpr(when.condition, names);
          for (const action of when.actions) {
            if (action.kind === 'Stmt') {
              collectUsedNamesFromStmt(action.stmt, names);
            }
          }
        }
      }
      for (const output of item.outputs) {
        for (const c of output.cases) {
          collectUsedNamesFromExpr(c.value, names);
        }
      }
      break;
    case 'InstDecl':
      // Module path
      collectUsedNamesFromPath(item.modulePath, names);
      if (item.genericArgs) {
        for (const arg of item.genericArgs) {
          if ('kind' in arg.value) {
            if (isTypeExpr(arg.value)) {
              collectUsedNamesFromTypeExpr(arg.value, names);
            } else {
              collectUsedNamesFromExpr(arg.value as Expr, names);
            }
          }
        }
      }
      for (const conn of item.connections) {
        collectUsedNamesFromExpr(conn.expr, names);
      }
      break;
    case 'MemDecl':
      collectUsedNamesFromTypeExpr(item.elementType, names);
      collectUsedNamesFromExpr(item.depth, names);
      if (item.init) {
        collectUsedNamesFromExpr(item.init, names);
      }
      break;
  }
}

function collectUsedNamesFromFnDef(fn: FnDef, names: Set<string>): void {
  // Parameters
  for (const param of fn.params) {
    collectUsedNamesFromTypeExpr(param.typeExpr, names);
  }

  // Return type
  if (fn.returnType) {
    collectUsedNamesFromTypeExpr(fn.returnType, names);
  }

  // Body
  for (const stmt of fn.body) {
    collectUsedNamesFromStmt(stmt, names);
  }
}

function collectUsedNamesFromEnumDef(def: EnumDef, names: Set<string>): void {
  for (const variant of def.variants) {
    if (variant.value) {
      collectUsedNamesFromExpr(variant.value, names);
    }
  }
}

function collectUsedNamesFromStructDef(def: StructDef, names: Set<string>): void {
  for (const field of def.fields) {
    collectUsedNamesFromTypeExpr(field.typeExpr, names);
  }
}

function collectUsedNamesFromTypeAlias(alias: TypeAlias, names: Set<string>): void {
  collectUsedNamesFromTypeExpr(alias.typeExpr, names);
}

function collectUsedNamesFromInterfaceDef(def: InterfaceDef, names: Set<string>): void {
  for (const signal of def.signals) {
    collectUsedNamesFromTypeExpr(signal.typeExpr, names);
  }
}

function collectUsedNamesFromConstDef(def: ConstDef, names: Set<string>): void {
  collectUsedNamesFromTypeExpr(def.typeExpr, names);
  collectUsedNamesFromExpr(def.init, names);
}

function collectUsedNamesFromTestDef(test: TestDef, names: Set<string>): void {
  for (const stmt of test.body) {
    if ('kind' in stmt) {
      switch (stmt.kind) {
        case 'AssertStmt':
          collectUsedNamesFromExpr(stmt.condition, names);
          break;
        case 'WaitStmt':
          if (stmt.condition.kind === 'ExprWait') {
            collectUsedNamesFromExpr(stmt.condition.expr, names);
          } else if (stmt.condition.kind === 'ClockWait') {
            collectUsedNamesFromExpr(stmt.condition.clock.signal, names);
          }
          break;
        case 'DriveStmt':
          collectUsedNamesFromExpr(stmt.value, names);
          break;
        case 'SampleStmt':
          collectUsedNamesFromExpr(stmt.expr, names);
          break;
        default:
          collectUsedNamesFromStmt(stmt, names);
      }
    }
  }
}

function collectUsedNamesFromStmt(stmt: Stmt, names: Set<string>): void {
  switch (stmt.kind) {
    case 'LetDecl':
    case 'VarDecl':
      if (stmt.typeExpr) {
        collectUsedNamesFromTypeExpr(stmt.typeExpr, names);
      }
      if (stmt.init) {
        collectUsedNamesFromExpr(stmt.init, names);
      }
      break;
    case 'AssignStmt':
      collectUsedNamesFromExpr(stmt.value, names);
      break;
    case 'IfStmt':
      collectUsedNamesFromExpr(stmt.condition, names);
      for (const s of stmt.thenBlock) {
        collectUsedNamesFromStmt(s, names);
      }
      if (stmt.elseBlock) {
        if (Array.isArray(stmt.elseBlock)) {
          for (const s of stmt.elseBlock) {
            collectUsedNamesFromStmt(s, names);
          }
        } else {
          collectUsedNamesFromStmt(stmt.elseBlock, names);
        }
      }
      break;
    case 'MatchStmt':
      collectUsedNamesFromExpr(stmt.scrutinee, names);
      for (const arm of stmt.arms) {
        collectUsedNamesFromPattern(arm.pattern, names);
        if (arm.body.kind === 'BlockStmt') {
          for (const s of arm.body.stmts) {
            collectUsedNamesFromStmt(s, names);
          }
        } else {
          collectUsedNamesFromExpr(arm.body, names);
        }
      }
      break;
    case 'ForStmt':
      collectUsedNamesFromExpr(stmt.range.start, names);
      collectUsedNamesFromExpr(stmt.range.end, names);
      for (const s of stmt.body) {
        collectUsedNamesFromStmt(s, names);
      }
      break;
    case 'WhileStmt':
      collectUsedNamesFromExpr(stmt.condition, names);
      for (const s of stmt.body) {
        collectUsedNamesFromStmt(s, names);
      }
      break;
    case 'ReturnStmt':
      if (stmt.value) {
        collectUsedNamesFromExpr(stmt.value, names);
      }
      break;
    case 'BlockStmt':
      for (const s of stmt.stmts) {
        collectUsedNamesFromStmt(s, names);
      }
      break;
    case 'ExprStmt':
      collectUsedNamesFromExpr(stmt.expr, names);
      break;
  }
}

function collectUsedNamesFromExpr(expr: Expr, names: Set<string>): void {
  switch (expr.kind) {
    case 'LiteralExpr':
      // No names
      break;
    case 'IdentExpr':
      names.add(expr.name.name);
      break;
    case 'PathExpr':
      collectUsedNamesFromPath(expr.path, names);
      break;
    case 'UnaryExpr':
      collectUsedNamesFromExpr(expr.operand, names);
      break;
    case 'BinaryExpr':
      collectUsedNamesFromExpr(expr.left, names);
      collectUsedNamesFromExpr(expr.right, names);
      break;
    case 'CallExpr':
      collectUsedNamesFromExpr(expr.callee, names);
      for (const arg of expr.args) {
        collectUsedNamesFromExpr(arg, names);
      }
      break;
    case 'IndexExpr':
      collectUsedNamesFromExpr(expr.base, names);
      collectUsedNamesFromExpr(expr.index, names);
      if (expr.rangeEnd) {
        collectUsedNamesFromExpr(expr.rangeEnd, names);
      }
      break;
    case 'FieldExpr':
      collectUsedNamesFromExpr(expr.base, names);
      break;
    case 'CastExpr':
      collectUsedNamesFromExpr(expr.expr, names);
      collectUsedNamesFromTypeExpr(expr.targetType, names);
      break;
    case 'IfExpr':
      collectUsedNamesFromExpr(expr.condition, names);
      collectUsedNamesFromExpr(expr.thenExpr, names);
      collectUsedNamesFromExpr(expr.elseExpr, names);
      break;
    case 'MatchExpr':
      collectUsedNamesFromExpr(expr.scrutinee, names);
      for (const arm of expr.arms) {
        collectUsedNamesFromPattern(arm.pattern, names);
        if (arm.body.kind === 'BlockStmt') {
          for (const s of arm.body.stmts) {
            collectUsedNamesFromStmt(s, names);
          }
        } else {
          collectUsedNamesFromExpr(arm.body, names);
        }
      }
      break;
    case 'ConcatExpr':
      for (const elem of expr.elements) {
        collectUsedNamesFromExpr(elem, names);
      }
      break;
    case 'RepeatExpr':
      collectUsedNamesFromExpr(expr.expr, names);
      collectUsedNamesFromExpr(expr.count, names);
      break;
    case 'ParenExpr':
      collectUsedNamesFromExpr(expr.inner, names);
      break;
  }
}

function collectUsedNamesFromTypeExpr(typeExpr: TypeExpr, names: Set<string>): void {
  switch (typeExpr.kind) {
    case 'PrimitiveType':
      if (typeExpr.width) {
        collectUsedNamesFromExpr(typeExpr.width, names);
      }
      break;
    case 'ArrayType':
      collectUsedNamesFromTypeExpr(typeExpr.elementType, names);
      collectUsedNamesFromExpr(typeExpr.size, names);
      break;
    case 'TupleType':
      for (const elem of typeExpr.elements) {
        collectUsedNamesFromTypeExpr(elem, names);
      }
      break;
    case 'UserType':
      collectUsedNamesFromPath(typeExpr.path, names);
      break;
    case 'GenericType':
      collectUsedNamesFromPath(typeExpr.path, names);
      for (const arg of typeExpr.args) {
        if (isTypeExpr(arg.value)) {
          collectUsedNamesFromTypeExpr(arg.value, names);
        } else {
          collectUsedNamesFromExpr(arg.value as Expr, names);
        }
      }
      break;
  }
}

function collectUsedNamesFromPattern(pattern: Pattern, names: Set<string>): void {
  switch (pattern.kind) {
    case 'LiteralPattern':
      break;
    case 'IdentPattern':
      // This is a binding, not a use
      break;
    case 'WildcardPattern':
      break;
    case 'PathPattern':
      collectUsedNamesFromPath(pattern.path, names);
      break;
    case 'RangePattern':
      collectUsedNamesFromExpr(pattern.start, names);
      collectUsedNamesFromExpr(pattern.end, names);
      break;
    case 'TuplePattern':
      for (const elem of pattern.elements) {
        collectUsedNamesFromPattern(elem, names);
      }
      break;
    case 'StructPattern':
      collectUsedNamesFromPath(pattern.path, names);
      for (const field of pattern.fields) {
        if (field.pattern) {
          collectUsedNamesFromPattern(field.pattern, names);
        }
      }
      break;
  }
}

function collectUsedNamesFromPath(path: Path, names: Set<string>): void {
  // The first segment of a path is what's actually imported
  const firstSegment = path.segments[0];
  if (firstSegment) {
    names.add(firstSegment.name);
  }
}

function isTypeExpr(value: TypeExpr | Expr): value is TypeExpr {
  return value.kind === 'PrimitiveType' ||
         value.kind === 'ArrayType' ||
         value.kind === 'TupleType' ||
         value.kind === 'UserType' ||
         value.kind === 'GenericType';
}
