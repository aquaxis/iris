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
  GenericParam,
  Stmt,
  TestDef,
  Identifier,
  SourceSpan,
} from '@irisfmt/core';

/**
 * Lint rule that checks naming conventions:
 * - Modules, Types (struct, enum, interface): PascalCase
 * - Functions, variables, signals, ports: snake_case
 * - Constants: SCREAMING_SNAKE_CASE
 */
export const namingConventionRule: LintRule = {
  name: 'naming-convention',
  description: 'Enforce consistent naming conventions',
  category: 'style',
  defaultSeverity: 'warning',

  check(ctx: LintContext): void {
    visitSourceFile(ctx, ctx.ast);
  },
};

// Naming pattern matchers
function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function isSnakeCase(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

function isScreamingSnakeCase(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

function reportNamingViolation(
  ctx: LintContext,
  span: SourceSpan,
  entityType: string,
  name: string,
  expectedStyle: string
): void {
  ctx.report({
    rule: 'naming-convention',
    message: `${entityType} '${name}' should be ${expectedStyle}`,
    span,
    severity: ctx.getConfig().severity,
  });
}

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
    case 'EnumDef':
      visitEnumDef(ctx, item);
      break;
    case 'StructDef':
      visitStructDef(ctx, item);
      break;
    case 'TypeAlias':
      visitTypeAlias(ctx, item);
      break;
    case 'InterfaceDef':
      visitInterfaceDef(ctx, item);
      break;
    case 'ConstDef':
      visitConstDef(ctx, item);
      break;
    case 'TestDef':
      visitTestDef(ctx, item);
      break;
    case 'PackageDecl':
    case 'ImportDecl':
      // No naming checks needed
      break;
  }
}

function visitModDef(ctx: LintContext, mod: ModDef): void {
  // Module names should be PascalCase
  checkPascalCase(ctx, mod.name, 'Module');

  // Check generic parameters
  if (mod.genericParams) {
    for (const param of mod.genericParams.params) {
      checkGenericParam(ctx, param);
    }
  }

  // Check ports
  for (const port of mod.ports) {
    checkSnakeCase(ctx, port.name, 'Port');
  }

  // Visit module items
  for (const item of mod.items) {
    visitModItem(ctx, item);
  }
}

function visitModItem(ctx: LintContext, item: ModItem): void {
  switch (item.kind) {
    case 'LetDecl':
      checkSnakeCase(ctx, item.name, 'Signal');
      break;
    case 'VarDecl':
      checkSnakeCase(ctx, item.name, 'Variable');
      break;
    case 'ConstDecl':
      checkScreamingSnakeCase(ctx, item.name, 'Constant');
      break;
    case 'TypeAlias':
      checkPascalCase(ctx, item.name, 'Type alias');
      break;
    case 'CombBlock':
      for (const stmt of item.stmts) {
        visitStmt(ctx, stmt);
      }
      break;
    case 'SyncBlock':
      for (const stmt of item.stmts) {
        visitStmt(ctx, stmt);
      }
      break;
    case 'FsmBlock':
      checkSnakeCase(ctx, item.name, 'FSM');
      break;
    case 'InstDecl':
      checkSnakeCase(ctx, item.name, 'Instance');
      break;
    case 'MemDecl':
      checkSnakeCase(ctx, item.name, 'Memory');
      break;
  }
}

function visitFnDef(ctx: LintContext, fn: FnDef): void {
  // Function names should be snake_case
  checkSnakeCase(ctx, fn.name, 'Function');

  // Check generic parameters
  if (fn.genericParams) {
    for (const param of fn.genericParams.params) {
      checkGenericParam(ctx, param);
    }
  }

  // Check function parameters
  for (const param of fn.params) {
    checkSnakeCase(ctx, param.name, 'Parameter');
  }

  // Visit function body
  for (const stmt of fn.body) {
    visitStmt(ctx, stmt);
  }
}

function visitEnumDef(ctx: LintContext, def: EnumDef): void {
  // Enum names should be PascalCase
  checkPascalCase(ctx, def.name, 'Enum');

  // Enum variants should be PascalCase
  for (const variant of def.variants) {
    checkPascalCase(ctx, variant.name, 'Enum variant');
  }
}

function visitStructDef(ctx: LintContext, def: StructDef): void {
  // Struct names should be PascalCase
  checkPascalCase(ctx, def.name, 'Struct');

  // Struct fields should be snake_case
  for (const field of def.fields) {
    checkSnakeCase(ctx, field.name, 'Field');
  }
}

function visitTypeAlias(ctx: LintContext, alias: TypeAlias): void {
  // Type aliases should be PascalCase
  checkPascalCase(ctx, alias.name, 'Type alias');
}

function visitInterfaceDef(ctx: LintContext, def: InterfaceDef): void {
  // Interface names should be PascalCase
  checkPascalCase(ctx, def.name, 'Interface');

  // Interface signals should be snake_case
  for (const signal of def.signals) {
    checkSnakeCase(ctx, signal.name, 'Interface signal');
  }
}

function visitConstDef(ctx: LintContext, def: ConstDef): void {
  // Constants should be SCREAMING_SNAKE_CASE
  checkScreamingSnakeCase(ctx, def.name, 'Constant');
}

function visitTestDef(ctx: LintContext, test: TestDef): void {
  // Test names should be snake_case
  checkSnakeCase(ctx, test.name, 'Test');
}

function visitStmt(ctx: LintContext, stmt: Stmt): void {
  switch (stmt.kind) {
    case 'LetDecl':
      checkSnakeCase(ctx, stmt.name, 'Variable');
      break;
    case 'VarDecl':
      checkSnakeCase(ctx, stmt.name, 'Variable');
      break;
    case 'ForStmt':
      checkSnakeCase(ctx, stmt.variable, 'Loop variable');
      for (const s of stmt.body) {
        visitStmt(ctx, s);
      }
      break;
    case 'IfStmt':
      for (const s of stmt.thenBlock) {
        visitStmt(ctx, s);
      }
      if (stmt.elseBlock) {
        if (Array.isArray(stmt.elseBlock)) {
          for (const s of stmt.elseBlock) {
            visitStmt(ctx, s);
          }
        } else {
          visitStmt(ctx, stmt.elseBlock);
        }
      }
      break;
    case 'WhileStmt':
      for (const s of stmt.body) {
        visitStmt(ctx, s);
      }
      break;
    case 'BlockStmt':
      for (const s of stmt.stmts) {
        visitStmt(ctx, s);
      }
      break;
    case 'MatchStmt':
      for (const arm of stmt.arms) {
        if (arm.body.kind === 'BlockStmt') {
          visitStmt(ctx, arm.body);
        }
      }
      break;
    case 'AssignStmt':
    case 'ReturnStmt':
    case 'ExprStmt':
      // No naming checks needed
      break;
  }
}

function checkGenericParam(ctx: LintContext, param: GenericParam): void {
  // Generic type parameters should be single uppercase letter or PascalCase
  const name = param.name.name;
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
    reportNamingViolation(ctx, param.name.span, 'Generic parameter', name, 'PascalCase');
  }
}

function checkPascalCase(ctx: LintContext, ident: Identifier, entityType: string): void {
  if (!isPascalCase(ident.name)) {
    reportNamingViolation(ctx, ident.span, entityType, ident.name, 'PascalCase');
  }
}

function checkSnakeCase(ctx: LintContext, ident: Identifier, entityType: string): void {
  if (!isSnakeCase(ident.name)) {
    reportNamingViolation(ctx, ident.span, entityType, ident.name, 'snake_case');
  }
}

function checkScreamingSnakeCase(ctx: LintContext, ident: Identifier, entityType: string): void {
  if (!isScreamingSnakeCase(ident.name)) {
    reportNamingViolation(ctx, ident.span, entityType, ident.name, 'SCREAMING_SNAKE_CASE');
  }
}
