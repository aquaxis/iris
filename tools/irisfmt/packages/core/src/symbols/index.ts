/**
 * Symbol table for IRIS
 *
 * Formatting and hover need only tokens. Going to a definition, finding
 * references and renaming need to know what a name *is*: that
 * `inst rf = RegFile { ... }` binds `rf` to the module `RegFile`, and that
 * `rf.rdata1` reaches into it.
 *
 * Hierarchical names are what set IRIS apart from a language of flat scopes.
 * `core.rf.regs` is three levels, and resolving it means walking the chain of
 * instances back to a module that declares the name.
 */

import type {
  SourceFile,
  Item,
  ModDef,
  ModItem,
  TestModDef,
  TestModItem,
  Identifier,
} from '../ast/index.js';
import type { SourceSpan } from '../lexer/index.js';

/** What a name refers to */
export type SymbolKind =
  | 'module'
  | 'port'
  | 'signal'
  | 'memory'
  | 'instance'
  | 'parameter';

/** A declared name, and where it was declared */
export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** The span of the name itself, which is where "go to definition" lands */
  span: SourceSpan;
  /** The module this was declared in; undefined for a module itself */
  owner?: string | undefined;
  /**
   * For an instance, the module it instantiates. Resolving `rf.rdata1` means
   * following this to `RegFile` and looking the port up there.
   */
  moduleName?: string | undefined;
}

/** Somewhere a name is used */
export interface SymbolRef {
  name: string;
  span: SourceSpan;
  /** The module the reference appears in */
  owner?: string | undefined;
}

export interface SymbolTable {
  /** Every declaration, keyed by `owner.name` for module members, `name` for modules */
  definitions: SymbolDef[];
  references: SymbolRef[];
}

/**
 * Collect every declaration and reference in a source file
 */
export function buildSymbolTable(file: SourceFile): SymbolTable {
  const table: SymbolTable = { definitions: [], references: [] };

  for (const item of file.items) {
    collectItem(table, item);
  }

  return table;
}

function collectItem(table: SymbolTable, item: Item): void {
  switch (item.kind) {
    case 'ModDef':
      collectModDef(table, item);
      break;
    case 'TestModDef':
      collectTestModDef(table, item);
      break;
    default:
      break;
  }
}

function define(
  table: SymbolTable,
  name: Identifier,
  kind: SymbolKind,
  owner?: string,
  moduleName?: string
): void {
  table.definitions.push({
    name: name.name,
    kind,
    span: name.span,
    owner,
    moduleName,
  });
}

function collectModDef(table: SymbolTable, mod: ModDef): void {
  const owner = mod.name.name;
  define(table, mod.name, 'module');

  if (mod.genericParams) {
    for (const param of mod.genericParams.params) {
      define(table, param.name, 'parameter', owner);
    }
  }

  for (const port of mod.ports) {
    define(table, port.name, 'port', owner);
  }

  for (const modItem of mod.items) {
    collectModItem(table, modItem, owner);
  }
}

function collectModItem(table: SymbolTable, item: ModItem, owner: string): void {
  switch (item.kind) {
    case 'LetDecl':
    case 'VarDecl':
    case 'ConstDecl':
      define(table, item.name, 'signal', owner);
      break;
    case 'MemDecl':
      define(table, item.name, 'memory', owner);
      break;
    case 'InstDecl':
      // An instance carries the module it instantiates, so that `u.port`
      // can be followed to the port's declaration
      define(table, item.name, 'instance', owner, pathName(item.modulePath));
      table.references.push({
        name: pathName(item.modulePath),
        span: item.modulePath.span,
        owner,
      });
      break;
    default:
      break;
  }
}

function collectTestModDef(table: SymbolTable, testMod: TestModDef): void {
  const owner = testMod.name.name;
  define(table, testMod.name, 'module');

  for (const item of testMod.items) {
    collectTestModItem(table, item, owner);
  }
}

function collectTestModItem(
  table: SymbolTable,
  item: TestModItem,
  owner: string
): void {
  switch (item.kind) {
    case 'LetDecl':
    case 'VarDecl':
    case 'ConstDecl':
      define(table, item.name, 'signal', owner);
      break;
    case 'InstDecl':
      define(table, item.name, 'instance', owner, pathName(item.modulePath));
      table.references.push({
        name: pathName(item.modulePath),
        span: item.modulePath.span,
        owner,
      });
      break;
    default:
      break;
  }
}

function pathName(path: { segments: Identifier[] }): string {
  return path.segments.map((s) => s.name).join('::');
}

/**
 * Find what a name refers to
 *
 * A bare name is looked up in the module it appears in, then among the
 * modules. A dotted name walks the chain: `rf.rdata1` finds the instance `rf`,
 * follows it to the module it instantiates, and looks `rdata1` up there.
 */
export function resolve(
  table: SymbolTable,
  name: string,
  owner?: string
): SymbolDef | undefined {
  const parts = name.split('.');

  if (parts.length === 1) {
    return (
      table.definitions.find((d) => d.name === name && d.owner === owner) ??
      table.definitions.find((d) => d.name === name && d.kind === 'module')
    );
  }

  // Walk the chain of instances to the module that declares the last part
  let currentModule = owner;
  for (let i = 0; i < parts.length - 1; i++) {
    const instance = table.definitions.find(
      (d) => d.name === parts[i] && d.kind === 'instance' && d.owner === currentModule
    );
    if (!instance?.moduleName) {
      return undefined;
    }
    currentModule = instance.moduleName;
  }

  const last = parts[parts.length - 1];
  return table.definitions.find((d) => d.name === last && d.owner === currentModule);
}
