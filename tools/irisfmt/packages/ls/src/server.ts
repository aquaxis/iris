#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  CodeActionKind,
  CompletionItemKind,
} from 'vscode-languageserver/node.js';
import type {
  InitializeParams,
  InitializeResult,
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  CodeActionParams,
  CodeAction,
  TextEdit,
  Diagnostic,
  Range,
  HoverParams,
  Hover,
  CompletionParams,
  CompletionItem,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { format } from '@irisfmt/format';
import { lint } from '@irisfmt/lint';
import type { Diagnostic as LintDiagnostic, Fix } from '@irisfmt/lint';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Store lint diagnostics with fixes for code actions
const documentDiagnostics = new Map<string, LintDiagnostic[]>();

// Document cache for incremental analysis
interface DocumentCache {
  version: number;
  content: string;
  diagnostics: LintDiagnostic[];
  lastValidation: number;
}

const documentCache = new Map<string, DocumentCache>();

// Debounce configuration
const DEBOUNCE_DELAY_MS = 150; // Delay before validation
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: ['.', ':', '<'],
        resolveProvider: false,
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('IRIS Language Server initialized');
});

// IRIS keyword documentation for hover
const KEYWORD_DOCS: Record<string, string> = {
  // Module-related
  mod: '**mod** - Module definition\n\nDefines a hardware module with ports and internal logic.\n\n```iris\nmod Counter(in clk: clock, out count: bit<8>) {\n  // module body\n}\n```',
  pub: '**pub** - Public visibility\n\nMarks an item as publicly visible outside the current module.',

  // Variables and signals
  let: '**let** - Immutable binding\n\nDeclares an immutable variable or wire signal.\n\n```iris\nlet x: bit<8> = 42;\n```',
  var: '**var** - Mutable signal\n\nDeclares a mutable register signal (only valid in sync blocks).\n\n```iris\nvar counter: bit<8> = 0;\n```',
  const: '**const** - Constant definition\n\nDeclares a compile-time constant value.\n\n```iris\nconst WIDTH: uint = 8;\n```',

  // Types
  type: '**type** - Type alias\n\nDefines a type alias.\n\n```iris\ntype Word = bit<32>;\n```',
  struct: '**struct** - Structure type\n\nDefines a composite data type with named fields.\n\n```iris\nstruct Point {\n  x: int<32>,\n  y: int<32>,\n}\n```',
  enum: '**enum** - Enumeration type\n\nDefines an enumeration with named variants.\n\n```iris\nenum State {\n  Idle,\n  Running,\n  Done,\n}\n```',
  interface: '**interface** - Interface definition\n\nDefines a reusable port bundle.\n\n```iris\ninterface AXI4Lite {\n  logic awvalid: bit,\n  logic awready: bit,\n  // ...\n}\n```',

  // Primitive types
  bit: '**bit** - Bit vector type\n\nFixed-width unsigned bit vector.\n\n```iris\nlet x: bit<8> = 0xFF;\n```',
  int: '**int** - Signed integer type\n\nFixed-width signed integer.\n\n```iris\nlet x: int<32> = -42;\n```',
  uint: '**uint** - Unsigned integer type\n\nFixed-width unsigned integer.\n\n```iris\nlet x: uint<16> = 1000;\n```',
  bool: '**bool** - Boolean type\n\nBoolean value (true or false).',
  clock: '**clock** - Clock signal type\n\nRepresents a clock signal.',
  reset: '**reset** - Reset signal type\n\nRepresents a reset signal.',
  string: '**string** - String type\n\nText string (mainly for simulation/testing).',

  // Port directions
  in: '**in** - Input port direction\n\nDeclares an input port.\n\n```iris\nmod Foo(in data: bit<8>) { }\n```',
  out: '**out** - Output port direction\n\nDeclares an output port.\n\n```iris\nmod Foo(out result: bit<8>) { }\n```',
  inout: '**inout** - Bidirectional port\n\nDeclares a bidirectional port.',

  // Control flow
  if: '**if** - Conditional statement\n\nConditional execution based on a boolean expression.\n\n```iris\nif condition {\n  // then block\n} else {\n  // else block\n}\n```',
  else: '**else** - Else clause\n\nAlternative branch for if statements.',
  match: '**match** - Pattern matching\n\nPattern matching expression or statement.\n\n```iris\nmatch state {\n  State::Idle => { ... }\n  State::Running => { ... }\n  _ => { ... }\n}\n```',
  for: '**for** - For loop\n\nIterates over a range.\n\n```iris\nfor i in 0..8 {\n  // loop body\n}\n```',
  while: '**while** - While loop\n\nRepeats while condition is true.\n\n```iris\nwhile condition {\n  // loop body\n}\n```',
  return: '**return** - Return statement\n\nReturns a value from a function.',

  // Logic blocks
  comb: '**comb** - Combinational logic block\n\nDefines combinational (asynchronous) logic.\n\n```iris\ncomb {\n  out = a & b;\n}\n```',
  sync: '**sync** - Synchronous logic block\n\nDefines sequential (clocked) logic.\n\n```iris\nsync(clk.posedge) {\n  counter = counter + 1;\n}\n```',

  // FSM
  fsm: '**fsm** - Finite State Machine\n\nDefines a finite state machine.\n\n```iris\nfsm my_fsm(clk.posedge) {\n  state { Idle, Running, Done }\n  transitions { ... }\n}\n```',
  state: '**state** - FSM state definition\n\nDefines states in an FSM.',
  transitions: '**transitions** - FSM transitions\n\nDefines state transitions in an FSM.',
  when: '**when** - Transition condition\n\nSpecifies a condition for state transition.',
  goto: '**goto** - State transition\n\nTransitions to another state in an FSM.',

  // Memory
  mem: '**mem** - Memory declaration\n\nDeclares a memory array.\n\n```iris\nmem ram: bit<32>[1024];\n```',

  // Functions
  fn: '**fn** - Function definition\n\nDefines a function.\n\n```iris\nfn add(a: int<32>, b: int<32>) -> int<32> {\n  return a + b;\n}\n```',

  // Import/Package
  import: '**import** - Import declaration\n\nImports items from another module.\n\n```iris\nimport std::math::*;\n```',
  package: '**package** - Package declaration\n\nDeclares a package namespace.',
  as: '**as** - Alias/Cast\n\nCreates an alias for imports or casts types.',

  // Generic constraints
  where: '**where** - Generic constraint\n\nSpecifies constraints on generic parameters.',

  // Boolean literals
  true: '**true** - Boolean literal\n\nBoolean true value.',
  false: '**false** - Boolean literal\n\nBoolean false value.',

  // Test
  test: '**test** - Test definition\n\nDefines a test case.\n\n```iris\n#[test]\ntest my_test {\n  // test body\n}\n```',
};

// Hover handler
connection.onHover((params: HoverParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Get the word at the cursor position
  const wordInfo = getWordAtPosition(text, offset);
  if (!wordInfo) {
    return null;
  }

  const { word, start, end } = wordInfo;

  // Check if it's a keyword
  const doc = KEYWORD_DOCS[word];
  if (doc) {
    return {
      contents: {
        kind: 'markdown',
        value: doc,
      },
      range: {
        start: document.positionAt(start),
        end: document.positionAt(end),
      },
    };
  }

  return null;
});

/**
 * Get the word at a given position in the text
 */
function getWordAtPosition(text: string, offset: number): { word: string; start: number; end: number } | null {
  // Find word boundaries
  let start = offset;
  let end = offset;

  // Move back to find word start
  while (start > 0 && isWordChar(text.charAt(start - 1))) {
    start--;
  }

  // Move forward to find word end
  while (end < text.length && isWordChar(text.charAt(end))) {
    end++;
  }

  if (start === end) {
    return null;
  }

  const word = text.substring(start, end);
  return { word, start, end };
}

/**
 * Check if a character is part of an identifier/keyword
 */
function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}

// Completion handler
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const context = getCompletionContext(text, offset);

  return getCompletionItems(context);
});

/**
 * Determine the completion context based on cursor position
 */
function getCompletionContext(text: string, offset: number): CompletionContext {
  // Get text before cursor
  const textBefore = text.substring(0, offset);
  const lineStart = textBefore.lastIndexOf('\n') + 1;
  const lineText = textBefore.substring(lineStart);

  // Check for specific contexts
  // After '::' - likely expecting a path segment (must check before ':')
  if (lineText.match(/::\s*$/)) {
    return { kind: 'path' };
  }

  // After ':' - likely expecting a type (but not '::')
  if (lineText.match(/[^:]:[ \t]*$/)) {
    return { kind: 'type' };
  }

  // Inside port list (after 'in ', 'out ', 'inout ')
  if (lineText.match(/\b(in|out|inout)\s+\w*$/)) {
    return { kind: 'identifier' };
  }

  // After 'in', 'out', 'inout' without space - complete directions
  if (lineText.match(/\b(i|in|o|ou|out|ino|inou|inout)$/)) {
    return { kind: 'port-direction' };
  }

  // After '<' - likely expecting a type parameter (width)
  if (lineText.match(/<\s*$/)) {
    return { kind: 'type-param' };
  }

  // Inside block contexts
  if (isInsideModuleBlock(text, offset)) {
    return { kind: 'module-body' };
  }

  if (isInsideFunctionBlock(text, offset)) {
    return { kind: 'function-body' };
  }

  // Default: top-level items
  return { kind: 'top-level' };
}

interface CompletionContext {
  kind: 'top-level' | 'type' | 'identifier' | 'port-direction' | 'type-param' | 'path' | 'module-body' | 'function-body';
}

/**
 * Check if offset is inside a module block
 */
function isInsideModuleBlock(text: string, offset: number): boolean {
  const textBefore = text.substring(0, offset);
  // Simple heuristic: check for 'mod' followed by balanced braces
  const modMatch = textBefore.match(/\bmod\s+\w+.*?\{/g);
  if (!modMatch) return false;

  // Count braces after last 'mod {'
  const lastModIndex = textBefore.lastIndexOf('mod ');
  if (lastModIndex === -1) return false;

  const afterMod = textBefore.substring(lastModIndex);
  let braceCount = 0;
  for (const ch of afterMod) {
    if (ch === '{') braceCount++;
    if (ch === '}') braceCount--;
  }
  return braceCount > 0;
}

/**
 * Check if offset is inside a function block
 */
function isInsideFunctionBlock(text: string, offset: number): boolean {
  const textBefore = text.substring(0, offset);
  const fnMatch = textBefore.match(/\bfn\s+\w+.*?\{/g);
  if (!fnMatch) return false;

  const lastFnIndex = textBefore.lastIndexOf('fn ');
  if (lastFnIndex === -1) return false;

  const afterFn = textBefore.substring(lastFnIndex);
  let braceCount = 0;
  for (const ch of afterFn) {
    if (ch === '{') braceCount++;
    if (ch === '}') braceCount--;
  }
  return braceCount > 0;
}

/**
 * Create a completion item with optional documentation
 */
function createCompletion(
  label: string,
  kind: typeof CompletionItemKind[keyof typeof CompletionItemKind],
  detail: string,
  keyword?: string
): CompletionItem {
  const item: CompletionItem = { label, kind, detail };
  const doc = keyword ? KEYWORD_DOCS[keyword] : undefined;
  if (doc) {
    item.documentation = doc;
  }
  return item;
}

/**
 * Get completion items based on context
 */
function getCompletionItems(context: CompletionContext): CompletionItem[] {
  const items: CompletionItem[] = [];

  switch (context.kind) {
    case 'type':
      // Primitive types
      items.push(...getPrimitiveTypeCompletions());
      break;

    case 'port-direction':
      items.push(
        createCompletion('in', CompletionItemKind.Keyword, 'Input port direction', 'in'),
        createCompletion('out', CompletionItemKind.Keyword, 'Output port direction', 'out'),
        createCompletion('inout', CompletionItemKind.Keyword, 'Bidirectional port', 'inout'),
      );
      break;

    case 'type-param':
      // Common bit widths
      items.push(
        createCompletion('8', CompletionItemKind.Value, '8-bit width'),
        createCompletion('16', CompletionItemKind.Value, '16-bit width'),
        createCompletion('32', CompletionItemKind.Value, '32-bit width'),
        createCompletion('64', CompletionItemKind.Value, '64-bit width'),
      );
      break;

    case 'module-body':
      // Module-specific keywords
      items.push(
        createCompletion('comb', CompletionItemKind.Keyword, 'Combinational logic block', 'comb'),
        createCompletion('sync', CompletionItemKind.Keyword, 'Synchronous logic block', 'sync'),
        createCompletion('fsm', CompletionItemKind.Keyword, 'Finite state machine', 'fsm'),
        createCompletion('var', CompletionItemKind.Keyword, 'Mutable signal', 'var'),
        createCompletion('let', CompletionItemKind.Keyword, 'Immutable binding', 'let'),
        createCompletion('mem', CompletionItemKind.Keyword, 'Memory declaration', 'mem'),
        createCompletion('if', CompletionItemKind.Keyword, 'Conditional statement', 'if'),
        createCompletion('match', CompletionItemKind.Keyword, 'Pattern matching', 'match'),
        createCompletion('for', CompletionItemKind.Keyword, 'For loop', 'for'),
      );
      break;

    case 'function-body':
      // Function body keywords
      items.push(
        createCompletion('let', CompletionItemKind.Keyword, 'Immutable binding', 'let'),
        createCompletion('return', CompletionItemKind.Keyword, 'Return statement', 'return'),
        createCompletion('if', CompletionItemKind.Keyword, 'Conditional statement', 'if'),
        createCompletion('match', CompletionItemKind.Keyword, 'Pattern matching', 'match'),
        createCompletion('for', CompletionItemKind.Keyword, 'For loop', 'for'),
        createCompletion('while', CompletionItemKind.Keyword, 'While loop', 'while'),
      );
      break;

    case 'top-level':
    default:
      // Top-level declarations
      items.push(
        createCompletion('mod', CompletionItemKind.Keyword, 'Module definition', 'mod'),
        createCompletion('fn', CompletionItemKind.Keyword, 'Function definition', 'fn'),
        createCompletion('struct', CompletionItemKind.Keyword, 'Structure type', 'struct'),
        createCompletion('enum', CompletionItemKind.Keyword, 'Enumeration type', 'enum'),
        createCompletion('type', CompletionItemKind.Keyword, 'Type alias', 'type'),
        createCompletion('interface', CompletionItemKind.Keyword, 'Interface definition', 'interface'),
        createCompletion('import', CompletionItemKind.Keyword, 'Import declaration', 'import'),
        createCompletion('package', CompletionItemKind.Keyword, 'Package declaration', 'package'),
        createCompletion('const', CompletionItemKind.Keyword, 'Constant definition', 'const'),
        createCompletion('pub', CompletionItemKind.Keyword, 'Public visibility', 'pub'),
        createCompletion('test', CompletionItemKind.Keyword, 'Test definition', 'test'),
      );
      break;
  }

  return items;
}

/**
 * Get primitive type completions
 */
function getPrimitiveTypeCompletions(): CompletionItem[] {
  return [
    createCompletion('bit', CompletionItemKind.TypeParameter, 'Bit vector type', 'bit'),
    createCompletion('int', CompletionItemKind.TypeParameter, 'Signed integer type', 'int'),
    createCompletion('uint', CompletionItemKind.TypeParameter, 'Unsigned integer type', 'uint'),
    createCompletion('bool', CompletionItemKind.TypeParameter, 'Boolean type', 'bool'),
    createCompletion('clock', CompletionItemKind.TypeParameter, 'Clock signal type', 'clock'),
    createCompletion('reset', CompletionItemKind.TypeParameter, 'Reset signal type', 'reset'),
    createCompletion('string', CompletionItemKind.TypeParameter, 'String type', 'string'),
  ];
}

// Document formatting
connection.onDocumentFormatting(
  (params: DocumentFormattingParams): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    try {
      const text = document.getText();
      const formatted = format(text);

      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: document.positionAt(text.length),
          },
          newText: formatted,
        },
      ];
    } catch (_error) {
      return [];
    }
  }
);

// Range formatting
connection.onDocumentRangeFormatting(
  (params: DocumentRangeFormattingParams): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    try {
      const text = document.getText();
      const formatted = format(text);

      // Get the range text positions
      const startOffset = document.offsetAt(params.range.start);
      const endOffset = document.offsetAt(params.range.end);

      // Find the formatted text that corresponds to the selected range
      // For simplicity, we format the entire document but only return the
      // edit for the selected range if the formatting changed it
      const originalRange = text.substring(startOffset, endOffset);

      // Format the entire document and extract the corresponding section
      // This is a simplified approach - a more sophisticated implementation
      // would parse and format only the relevant AST nodes
      if (formatted !== text) {
        // Return the full document edit, as partial formatting is complex
        // The editor will apply only what's needed
        return [
          {
            range: params.range,
            newText: formatted.substring(startOffset, startOffset + (formatted.length - text.length + originalRange.length)),
          },
        ];
      }

      return [];
    } catch (_error) {
      return [];
    }
  }
);

// Code actions (quick fixes)
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const actions: CodeAction[] = [];
  const lintDiags = documentDiagnostics.get(params.textDocument.uri) ?? [];

  // Find diagnostics that overlap with the requested range and have fixes
  for (const diag of lintDiags) {
    if (!diag.fix) continue;

    const diagRange = lintSpanToRange(diag.span);
    if (!rangesOverlap(diagRange, params.range)) continue;

    // Check if this diagnostic is in the context diagnostics
    const matchingContextDiag = params.context.diagnostics.find(
      (d) =>
        d.source === `irisfmt-lint:${diag.rule}` &&
        rangesEqual(d.range, diagRange)
    );

    if (matchingContextDiag) {
      const action = createQuickFixAction(document, diag, diag.fix, matchingContextDiag);
      actions.push(action);
    }
  }

  return actions;
});

function createQuickFixAction(
  document: TextDocument,
  diag: LintDiagnostic,
  fix: Fix,
  lspDiagnostic: Diagnostic
): CodeAction {
  const edits: TextEdit[] = fix.changes.map((change) => ({
    range: lintSpanToRange(change.span),
    newText: change.newText,
  }));

  return {
    title: fix.description,
    kind: CodeActionKind.QuickFix,
    diagnostics: [lspDiagnostic],
    edit: {
      changes: {
        [document.uri]: edits,
      },
    },
  };
}

function lintSpanToRange(span: { start: { line: number; column: number }; end: { line: number; column: number } }): Range {
  return {
    start: {
      line: span.start.line - 1,
      character: span.start.column - 1,
    },
    end: {
      line: span.end.line - 1,
      character: span.end.column - 1,
    },
  };
}

function rangesOverlap(a: Range, b: Range): boolean {
  // Check if ranges overlap
  if (a.end.line < b.start.line) return false;
  if (b.end.line < a.start.line) return false;
  if (a.end.line === b.start.line && a.end.character < b.start.character) return false;
  if (b.end.line === a.start.line && b.end.character < a.start.character) return false;
  return true;
}

function rangesEqual(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

// Validate documents with debouncing for incremental analysis
documents.onDidChangeContent((change) => {
  scheduleValidation(change.document);
});

/**
 * Schedule document validation with debouncing
 * This prevents excessive re-parsing during rapid typing
 */
function scheduleValidation(document: TextDocument): void {
  const uri = document.uri;

  // Cancel any pending validation for this document
  const existingTimer = debounceTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new validation
  const timer = setTimeout(() => {
    debounceTimers.delete(uri);
    validateDocumentIfNeeded(document);
  }, DEBOUNCE_DELAY_MS);

  debounceTimers.set(uri, timer);
}

/**
 * Validate document only if content has changed
 * Uses caching to avoid redundant parsing and linting
 */
function validateDocumentIfNeeded(document: TextDocument): void {
  const uri = document.uri;
  const version = document.version;
  const text = document.getText();
  const cached = documentCache.get(uri);

  // Check if we can use cached results
  if (cached && cached.version === version && cached.content === text) {
    // Content unchanged, use cached diagnostics
    sendDiagnostics(uri, cached.diagnostics);
    return;
  }

  // Content changed, need to re-lint
  const result = lint(text);

  // Update cache
  documentCache.set(uri, {
    version,
    content: text,
    diagnostics: result.diagnostics,
    lastValidation: Date.now(),
  });

  // Store lint diagnostics for code actions
  documentDiagnostics.set(uri, result.diagnostics);

  // Send diagnostics to client
  sendDiagnostics(uri, result.diagnostics);
}

/**
 * Convert lint diagnostics to LSP diagnostics and send to client
 */
function sendDiagnostics(uri: string, lintDiags: LintDiagnostic[]): void {
  const diagnostics: Diagnostic[] = lintDiags.map((d) => ({
    range: lintSpanToRange(d.span),
    message: d.message,
    severity:
      d.severity === 'error'
        ? DiagnosticSeverity.Error
        : d.severity === 'warning'
          ? DiagnosticSeverity.Warning
          : d.severity === 'info'
            ? DiagnosticSeverity.Information
            : DiagnosticSeverity.Hint,
    source: `irisfmt-lint:${d.rule}`,
  }));

  connection.sendDiagnostics({
    uri,
    diagnostics,
  });
}

// Clean up when document is closed
documents.onDidClose((e) => {
  const uri = e.document.uri;

  // Cancel any pending validation
  const timer = debounceTimers.get(uri);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(uri);
  }

  // Clear all caches for this document
  documentDiagnostics.delete(uri);
  documentCache.delete(uri);
});

documents.listen(connection);
connection.listen();

export function startServer(): void {
  // Server is started by connection.listen()
}
