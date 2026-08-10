/**
 * The server is tested over the protocol, not by calling its internals.
 *
 * A language server is a process that answers requests on a pipe. A test that
 * calls a handler directly proves the handler works; it does not prove the
 * server answers. These spawn the built server and speak LSP to it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', '..', 'dist', 'server.js');

let server: ChildProcessWithoutNullStreams;
let nextId = 1;
// `Content-Length` counts bytes, and IRIS sources carry Japanese comments, so
// the frame has to be measured as bytes throughout. Slicing the stream as a
// string loses the two ends against each other and the reply never completes.
let buffer = Buffer.alloc(0);
const pending = new Map<number, (value: unknown) => void>();

function send(message: object): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.stdin.write(body);
}

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as (value: unknown) => void);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method: string, params: unknown): void {
  send({ jsonrpc: '2.0', method, params });
}

function onData(chunk: Buffer): void {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const lengthMatch = /Content-Length: (\d+)/.exec(header);
    if (!lengthMatch) return;
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.subarray(bodyStart + length);
    const message = JSON.parse(body);
    if (message.method === 'textDocument/publishDiagnostics') {
      diagnostics.set(message.params.uri, message.params.diagnostics);
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      pending.get(message.id)!(message);
      pending.delete(message.id);
    }
  }
}

/** Diagnostics arrive as notifications, keyed by the document they describe */
const diagnostics = new Map<string, any[]>();

const URI = 'file:///design.iris';

const SOURCE = `mod RegFile(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    in  raddr1: bit[5],
    out rdata1: bit[32],
) {
    mem regs: bit[32][32];
    comb { rdata1 = regs[raddr1]; }
}

mod Core(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    out y: bit[32],
) {
    inst rf = RegFile { clk: clk, rst_n: rst_n, raddr1: 5'd1 };
    comb { y = rf.rdata1; }
}
`;

/** Position of the nth occurrence of `text` in the source */
function positionOf(text: string, occurrence = 1): { line: number; character: number } {
  let index = -1;
  for (let i = 0; i < occurrence; i++) {
    index = SOURCE.indexOf(text, index + 1);
  }
  const before = SOURCE.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

beforeAll(async () => {
  server = spawn('node', [serverPath, '--stdio'], { stdio: 'pipe' });
  server.stdout.on('data', onData);

  await request('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
  });
  notify('initialized', {});
  notify('textDocument/didOpen', {
    textDocument: { uri: URI, languageId: 'iris', version: 1, text: SOURCE },
  });
  // Let the server settle after the open notification
  await new Promise((r) => setTimeout(r, 400));
}, 30000);

afterAll(() => {
  server?.kill();
});

describe('the server answers over the protocol', () => {
  it('declares the navigation capabilities', async () => {
    const response = await request('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    const caps = response.result.capabilities;
    expect(caps.definitionProvider).toBe(true);
    expect(caps.referencesProvider).toBe(true);
    expect(caps.documentSymbolProvider).toBe(true);
    expect(caps.renameProvider).toBe(true);
  });

  it('goes from an instance to the module it instantiates', async () => {
    // The `RegFile` in `inst rf = RegFile { ... }`
    const response = await request('textDocument/definition', {
      textDocument: { uri: URI },
      position: positionOf('RegFile', 2),
    });
    expect(response.result).not.toBeNull();
    expect(response.result.range.start.line).toBe(0);
  });

  it('resolves a hierarchical name to the port it names', async () => {
    // `rf.rdata1` reaches into RegFile, so the answer is rdata1's declaration
    const response = await request('textDocument/definition', {
      textDocument: { uri: URI },
      position: positionOf('rdata1', 3),
    });
    expect(response.result).not.toBeNull();
    expect(response.result.range.start.line).toBe(4);
  });

  it('lists modules with their members nested', async () => {
    const response = await request('textDocument/documentSymbol', {
      textDocument: { uri: URI },
    });
    const symbols = response.result;
    expect(symbols.map((s: any) => s.name)).toEqual(['RegFile', 'Core']);

    const kinds = symbols[0].children.map((c: any) => c.detail);
    expect(kinds).toContain('port');
    expect(kinds).toContain('memory');

    expect(symbols[1].children.map((c: any) => c.detail)).toContain('instance');
  });

  it('finds every use of a name', async () => {
    const response = await request('textDocument/references', {
      textDocument: { uri: URI },
      position: positionOf('raddr1'),
      context: { includeDeclaration: true },
    });
    // Declared once, used twice more
    expect(response.result.length).toBeGreaterThanOrEqual(3);
  });

  it('renames a signal across its uses', async () => {
    const response = await request('textDocument/rename', {
      textDocument: { uri: URI },
      position: positionOf('raddr1'),
      newName: 'read_addr',
    });
    const edits = response.result.changes[URI];
    expect(edits.length).toBeGreaterThanOrEqual(3);
    expect(edits.every((e: any) => e.newText === 'read_addr')).toBe(true);
  });

  it('refuses to rename a signal to a reserved word', async () => {
    // Renaming to `inst` would produce a file that does not parse
    const response = await request('textDocument/rename', {
      textDocument: { uri: URI },
      position: positionOf('raddr1'),
      newName: 'inst',
    });
    expect(response.error).toBeTruthy();
  });
});

/**
 * The same requests against the largest IRIS design available.
 *
 * A feature that only works on a fixture is not done. `example/riscv` is four
 * modules, an instance hierarchy three deep, generics and memories.
 */
describe('the server handles the RV32I core', () => {
  const RISCV_URI = 'file:///riscv.iris';
  let riscvSource = '';

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const root = join(here, '..', '..', '..', '..', '..', '..', 'example', 'riscv', 'src');
    riscvSource = ['regfile.iris', 'alu.iris', 'decoder.iris', 'riscv_core.iris']
      .map((f) => readFileSync(join(root, f), 'utf8'))
      .join('\n');

    notify('textDocument/didOpen', {
      textDocument: { uri: RISCV_URI, languageId: 'iris', version: 1, text: riscvSource },
    });
    await new Promise((r) => setTimeout(r, 600));
  }, 30000);

  function riscvPositionOf(text: string, occurrence = 1): { line: number; character: number } {
    let index = -1;
    for (let i = 0; i < occurrence; i++) {
      index = riscvSource.indexOf(text, index + 1);
    }
    const before = riscvSource.slice(0, index);
    const lines = before.split('\n');
    return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
  }

  it('lists every module in the core', async () => {
    const response = await request('textDocument/documentSymbol', {
      textDocument: { uri: RISCV_URI },
    });
    const names = response.result.map((s: any) => s.name);
    expect(names).toContain('RegFile');
    expect(names).toContain('Alu');
    expect(names).toContain('Decoder');
    expect(names).toContain('RiscvCore');
  });

  it('finds the register file behind a hierarchical name', async () => {
    // `rf.rdata1` in RiscvCore reaches into RegFile
    const response = await request('textDocument/definition', {
      textDocument: { uri: RISCV_URI },
      position: riscvPositionOf('rf.rdata1'),
    });
    expect(response.result).not.toBeNull();
  });

  it('reports the memory of the register file as a symbol', async () => {
    const response = await request('textDocument/documentSymbol', {
      textDocument: { uri: RISCV_URI },
    });
    const regFile = response.result.find((s: any) => s.name === 'RegFile');
    const memories = regFile.children.filter((c: any) => c.detail === 'memory');
    expect(memories.map((m: any) => m.name)).toContain('regs');
  });
});

/**
 * A testbench is an IRIS file the reader opens as often as a design.
 *
 * `test Name { ... }` was gated on an older spelling, so every testbench in
 * `example/` arrived as a wall of errors, and one construct inside them made
 * the parser spin. Opening one is the check that matters.
 */
describe('the server handles a testbench', () => {
  const TB_URI = 'file:///testbench.iris';
  let tbSource = '';

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const root = join(here, '..', '..', '..', '..', '..', '..', 'example', 'riscv', 'src');
    tbSource = readFileSync(join(root, 'test_addi.iris'), 'utf8');

    notify('textDocument/didOpen', {
      textDocument: { uri: TB_URI, languageId: 'iris', version: 1, text: tbSource },
    });
    await new Promise((r) => setTimeout(r, 600));
  }, 30000);

  it('reports no errors on a testbench that the simulator accepts', () => {
    const reported = diagnostics.get(TB_URI) ?? [];
    const errors = reported.filter((d) => d.severity === 1);
    expect(errors.map((d) => `${d.range.start.line}: ${d.message}`)).toEqual([]);
  });

  it('lists the test module and what it holds', async () => {
    const response = await request('textDocument/documentSymbol', {
      textDocument: { uri: TB_URI },
    });
    const names = response.result.map((s: any) => s.name);
    expect(names).toContain('TestAddi');

    const testMod = response.result.find((s: any) => s.name === 'TestAddi');
    expect(testMod.children.map((c: any) => c.detail)).toContain('instance');
  });

  it('goes from a signal used in a testbench to its declaration', async () => {
    // `idx` is declared in the test module and read further down. The modules
    // the testbench instantiates live in other files, so a name reaching into
    // one of those is out of reach of a single document by design.
    const index = tbSource.lastIndexOf('idx');
    const before = tbSource.slice(0, index);
    const lines = before.split('\n');
    const response = await request('textDocument/definition', {
      textDocument: { uri: TB_URI },
      position: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
    });
    expect(response.result).not.toBeNull();
  });

  it('formats a testbench without dropping what the author wrote', async () => {
    const response = await request('textDocument/formatting', {
      textDocument: { uri: TB_URI },
      options: { tabSize: 4, insertSpaces: true },
    });
    const text = response.result[0].newText;
    expect(text).toContain('period: 10ns');
    expect(text).toContain('else error(');
  });
});
