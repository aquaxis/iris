/**
 * IRIS block diagram viewer.
 *
 * Everything runs in the browser. The IRIS parser is TypeScript already, so
 * there is no server to start and no binary to install: the page reads the
 * files the user picks and draws the design.
 */

import { buildDiagrams } from './model/build.js';
import type { BuildResult, DiagramGraph } from './model/types.js';
import { Diagram } from './diagram/render.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
};

let diagram: Diagram;
let current: BuildResult = { graphs: [], failures: [] };
let shown: DiagramGraph | undefined;

function setStatus(text: string, tone: 'plain' | 'warn' = 'plain'): void {
  const status = $('status');
  status.textContent = text;
  status.className = tone;
}

function renderList(): void {
  const list = $('modules');
  list.innerHTML = '';
  for (const graph of current.graphs) {
    const item = document.createElement('button');
    item.className = 'module' + (graph === shown ? ' selected' : '');
    const instances = graph.nodes.filter((n) => n.kind === 'inst').length;
    item.innerHTML =
      `<span class="name">${graph.name}</span>` +
      `<span class="meta">${graph.isTest ? 'test · ' : ''}${instances} inst · ${graph.edges.length} edges</span>`;
    item.addEventListener('click', () => void show(graph));
    list.appendChild(item);
  }

  const errors = $('errors');
  errors.innerHTML = '';
  if (current.failures.length) {
    const heading = document.createElement('div');
    heading.className = 'errors-heading';
    heading.textContent = `${current.failures.length} file(s) did not parse`;
    errors.appendChild(heading);
    for (const failure of current.failures) {
      const row = document.createElement('div');
      row.className = 'error';
      row.textContent = `${failure.file}: ${failure.message}`;
      errors.appendChild(row);
    }
  }
}

async function show(graph: DiagramGraph): Promise<void> {
  shown = graph;
  renderList();
  const placed = await diagram.show(graph);
  const direct = graph.edges.filter((e) => e.origin === 'direct').length;
  const traced = graph.edges.length - direct;
  setStatus(
    `${graph.name}: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
      `(${direct} written in the source, ${traced} traced through comb/sync) · ` +
      `${Math.round(placed.width)}×${Math.round(placed.height)}`,
  );
}

async function load(files: File[]): Promise<void> {
  const iris = files.filter((f) => f.name.endsWith('.iris'));
  if (!iris.length) {
    setStatus('No .iris files in that selection.', 'warn');
    return;
  }
  setStatus(`Parsing ${iris.length} file(s)…`);
  const sources = await Promise.all(
    iris.map(async (file) => ({ file: file.name, text: await file.text() })),
  );

  current = buildDiagrams(sources);
  shown = current.graphs[0];
  renderList();

  if (!current.graphs.length) {
    setStatus(
      current.failures.length
        ? `Nothing to draw. ${current.failures.length} file(s) did not parse.`
        : 'Nothing to draw: no module in these files instantiates another.',
      'warn',
    );
    return;
  }
  await show(shown!);
}

function main(): void {
  diagram = new Diagram($('paper'));

  $('pick').addEventListener('click', () => $('file-input').click());
  $<HTMLInputElement>('file-input').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    void load(Array.from(input.files ?? []));
  });

  $('fit').addEventListener('click', () => diagram.fit());
  $('zoom-in').addEventListener('click', () => diagram.zoom(1.2));
  $('zoom-out').addEventListener('click', () => diagram.zoom(1 / 1.2));

  $('save').addEventListener('click', () => {
    if (!shown) return;
    const blob = new Blob([JSON.stringify(diagram.toJSON(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${shown.name}.layout.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  $('load').addEventListener('click', () => $('layout-input').click());
  $<HTMLInputElement>('layout-input').addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      diagram.fromJSON(JSON.parse(await file.text()));
      setStatus(`Layout restored from ${file.name}.`);
    } catch (error) {
      setStatus(`Could not read that layout: ${(error as Error).message}`, 'warn');
    }
  });

  const paper = $('paper');
  paper.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    diagram.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  });

  setStatus('Pick .iris files to draw. Nothing leaves the browser.');
}

main();
