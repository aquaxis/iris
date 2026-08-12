/**
 * Instance Read Transform
 *
 * IRIS reads an instance's output by naming it: `rf.rdata1`, `alu.y`,
 * `dec.imm`. Emitting that verbatim produces a SystemVerilog hierarchical
 * reference, and leaves the port itself unconnected in the instantiation:
 *
 *   always_comb
 *     alu_a = dec.alu_a_pc ? pc : rf.rdata1;
 *
 *   RegFile rf ( .clk(clk), .we(wb_en) );        // rdata1 goes nowhere
 *
 * Verilator reads that. Yosys does not resolve it, and does not stop either:
 * it declares each name as an implicit wire, warns, and builds a model in
 * which the submodule's outputs are absent and those wires are undriven.
 * example/riscv/sv/riscv_core.sv produced 21 such wires. A proof against that
 * model is a proof about a core whose ALU inputs float, and it is
 * indistinguishable from a proof about the real one.
 *
 * This pass gives every read port a real wire and connects it:
 *
 *   logic [31:0] rf_rdata1;
 *   always_comb
 *     alu_a = dec_alu_a_pc ? pc : rf_rdata1;
 *
 *   RegFile rf ( .clk(clk), .we(wb_en), .rdata1(rf_rdata1) );
 *
 * A port the source already connected keeps that connection; the reference is
 * pointed at whatever it was connected to rather than a second wire being made
 * for the same signal.
 */

import type { SvModule, SvModuleItem, SvSignal, SvInstance } from '@iris2sv/sv-backend';
import type { SvDataType } from '@iris2sv/sv-backend';
import { signal } from '@iris2sv/sv-backend';

/** Port types of every module in the program: module name -> port name -> type */
export type PortTypeMap = ReadonlyMap<string, ReadonlyMap<string, SvDataType>>;

export interface InstanceReadTransformResult {
  module: SvModule;
  /** Wires created, as `instance.port` */
  wires: string[];
  /** Reads that could not be given a wire, with the reason */
  errors: string[];
}

interface Read {
  instance: string;
  port: string;
  /** The identifier the reference is rewritten to */
  wire: string;
  /** False when the port was already connected and no wire is needed */
  needsWire: boolean;
}

/**
 * Walk any node, replacing instance reads
 *
 * Structural rather than per-node-kind on purpose. The SystemVerilog
 * expression union has fourteen members and the statement union twenty-four; a
 * hand-written visitor over both is a place for one of them to be forgotten,
 * and a forgotten kind here means a hierarchical reference survives into the
 * output and yosys invents a wire for it again.
 */
function rewrite<T>(node: T, reads: ReadonlyMap<string, Read>): T {
  if (Array.isArray(node)) {
    return node.map(n => rewrite(n, reads)) as unknown as T;
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const obj = node as Record<string, unknown>;

  if (obj.kind === 'SvMemberExpr') {
    const base = obj.base as Record<string, unknown> | undefined;
    if (base?.kind === 'SvIdentifierExpr' && typeof base.name === 'string') {
      const read = reads.get(`${base.name}.${String(obj.member)}`);
      if (read) {
        return { kind: 'SvIdentifierExpr', name: read.wire } as unknown as T;
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = rewrite(value, reads);
  }
  return out as unknown as T;
}

/** Collect `<instance>.<port>` reads, skipping the instantiations themselves */
function collect(node: unknown, instances: ReadonlyMap<string, string>, out: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach(n => collect(n, instances, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  if (obj.kind === 'SvMemberExpr') {
    const base = obj.base as Record<string, unknown> | undefined;
    if (base?.kind === 'SvIdentifierExpr' && typeof base.name === 'string') {
      if (instances.has(base.name)) {
        out.add(`${base.name}.${String(obj.member)}`);
      }
    }
  }

  for (const value of Object.values(obj)) {
    collect(value, instances, out);
  }
}

export function transformInstanceReads(
  module: SvModule,
  portTypes: PortTypeMap
): InstanceReadTransformResult {
  const errors: string[] = [];
  const wires: string[] = [];

  const instances = new Map<string, string>();
  for (const item of module.items) {
    if (item.kind === 'SvInstance') {
      instances.set(item.instanceName, item.moduleName);
    }
  }
  if (instances.size === 0) {
    return { module, wires, errors };
  }

  const found = new Set<string>();
  collect(module.items, instances, found);
  if (found.size === 0) {
    return { module, wires, errors };
  }

  // Names already spoken for, so a generated wire never shadows one
  const taken = new Set<string>();
  for (const port of module.ports) taken.add(port.name);
  for (const item of module.items) {
    if (item.kind === 'SvSignal') taken.add(item.name);
  }

  const reads = new Map<string, Read>();
  const newWires: SvSignal[] = [];

  for (const key of found) {
    const [instName, portName] = key.split('.') as [string, string];
    const moduleName = instances.get(instName)!;

    // Already connected to a plain signal: point at that instead
    const inst = module.items.find(
      (i): i is SvInstance => i.kind === 'SvInstance' && i.instanceName === instName
    )!;
    const existing = inst.connections.find(c => c.port === portName);
    if (existing?.expr && (existing.expr as { kind?: string }).kind === 'SvIdentifierExpr') {
      reads.set(key, {
        instance: instName,
        port: portName,
        wire: (existing.expr as unknown as { name: string }).name,
        needsWire: false,
      });
      continue;
    }
    if (existing) {
      errors.push(
        `${key} is read and also connected to an expression; leave it as it is`
      );
      continue;
    }

    const dataType = portTypes.get(moduleName)?.get(portName);
    if (!dataType) {
      errors.push(
        `${key}: no port '${portName}' on module '${moduleName}', so no wire can be given a width`
      );
      continue;
    }

    let wire = `${instName}_${portName}`;
    while (taken.has(wire)) wire = `${wire}_`;
    taken.add(wire);

    reads.set(key, { instance: instName, port: portName, wire, needsWire: true });
    newWires.push(signal(wire, dataType));
    wires.push(key);
  }

  if (reads.size === 0) {
    return { module, wires, errors };
  }

  // Rewrite every reference, then connect the ports that gained a wire
  const rewritten = rewrite(module.items, reads) as SvModuleItem[];

  const items = rewritten.map((item): SvModuleItem => {
    if (item.kind !== 'SvInstance') return item;
    const added = [...reads.values()]
      .filter(r => r.needsWire && r.instance === item.instanceName)
      .map(r => ({ port: r.port, expr: { kind: 'SvIdentifierExpr' as const, name: r.wire } }));
    if (added.length === 0) return item;
    return { ...item, connections: [...item.connections, ...added] } as SvInstance;
  });

  return {
    module: { ...module, items: [...newWires, ...items] },
    wires,
    errors,
  };
}
