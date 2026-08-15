/**
 * Drawing, by JointJS.
 *
 * Boxes are placed where ELK put them and links follow the route ELK found,
 * so each link's own router is turned off. Dragging a box re-routes with
 * JointJS' manhattan router, which keeps the drop position exact.
 */

import { dia, shapes, util } from '@joint/core';
import type { DiagramGraph, DiagramNode } from '../model/types.js';
import { layout, type Layout } from './layout.js';

/** Colours by what the box stands for, so the three kinds read apart. */
const STYLE: Record<DiagramNode['kind'], { fill: string; stroke: string }> = {
  inst: { fill: '#eef4ff', stroke: '#3b6fb6' },
  io: { fill: '#fff6e5', stroke: '#c98a1b' },
  reg: { fill: '#f0f0f5', stroke: '#6b6b8a' },
};

export class Diagram {
  private readonly graph = new dia.Graph({}, { cellNamespace: shapes });
  private readonly paper: dia.Paper;
  private scale = 1;

  constructor(element: HTMLElement) {
    this.paper = new dia.Paper({
      el: element,
      model: this.graph,
      width: '100%',
      height: '100%',
      gridSize: 1,
      async: true,
      background: { color: '#ffffff' },
      cellViewNamespace: shapes,
      interactive: { linkMove: false },
    });

    // Dragging a box moves only that box; every link is then re-routed so no
    // segment is left crossing a body it used to avoid.
    this.paper.on('element:pointerup', () => this.rerouteAll());

    let panning = false;
    let origin = { x: 0, y: 0 };
    this.paper.on('blank:pointerdown', (event: any, x: number, y: number) => {
      panning = true;
      origin = { x: x * this.scale, y: y * this.scale };
    });
    this.paper.on('blank:pointermove', (event: any) => {
      if (!panning) return;
      const translate = this.paper.translate();
      this.paper.translate(
        translate.tx + event.originalEvent.movementX,
        translate.ty + event.originalEvent.movementY,
      );
    });
    this.paper.on('blank:pointerup', () => {
      panning = false;
      void origin;
    });
  }

  async show(diagram: DiagramGraph): Promise<Layout> {
    this.graph.clear();
    const placed = await layout(diagram);

    const byId = new Map<string, dia.Element>();
    for (const node of diagram.nodes) {
      const box = placed.nodes.get(node.id);
      if (!box) continue;
      const style = STYLE[node.kind];
      const label =
        node.kind === 'inst' ? `${node.label}\n${node.module ?? ''}` : node.label;

      const element = new shapes.standard.Rectangle({
        position: { x: box.x, y: box.y },
        size: { width: box.width, height: box.height },
        attrs: {
          body: {
            fill: style.fill,
            stroke: style.stroke,
            strokeWidth: 1.5,
            rx: node.kind === 'io' ? 12 : 3,
            ry: node.kind === 'io' ? 12 : 3,
          },
          label: {
            text: label,
            fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            fill: '#1b1b28',
          },
        },
      });
      element.addTo(this.graph);
      byId.set(node.id, element);
    }

    for (const edge of placed.edges) {
      const source = byId.get(edge.from);
      const target = byId.get(edge.to);
      if (!source || !target) continue;

      const link = new shapes.standard.Link({
        source: { id: source.id },
        target: { id: target.id },
        // ELK already routed this; drawing anything else would discard it.
        router: { name: 'normal' },
        vertices: edge.points.slice(1, -1),
        attrs: {
          line: {
            stroke: '#54608a',
            strokeWidth: 1.4,
            targetMarker: { type: 'path', d: 'M 8 -4 0 0 8 4 z', fill: '#54608a' },
          },
        },
        labels: edge.label
          ? [
              {
                position: 0.5,
                attrs: {
                  text: {
                    text: edge.label,
                    fontSize: 10,
                    fontFamily: 'ui-monospace, monospace',
                    fill: '#3d4668',
                  },
                  rect: { fill: '#ffffff', stroke: 'none' },
                },
              },
            ]
          : [],
      });
      link.addTo(this.graph);
    }

    // The paper renders asynchronously, so the cells are not on screen yet.
    // Fitting now would measure an empty canvas and leave the drawing in a
    // corner at whatever scale it started with.
    await this.rendered();
    this.fit();
    return placed;
  }

  /** Resolve once the paper has finished drawing the cells it was given. */
  private rendered(): Promise<void> {
    if (this.graph.getCells().length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      // A paper with nothing left to do may never emit the event, so the
      // wait is bounded rather than open ended.
      const timer = setTimeout(done, 2000);
      this.paper.once('render:done', done);
    });
  }

  private rerouteAll(): void {
    for (const link of this.graph.getLinks()) {
      link.set('vertices', []);
      link.set('router', { name: 'manhattan', args: { padding: 16 } });
    }
  }

  fit(): void {
    // Centre the drawing rather than leaving it in a corner. A design with
    // three boxes is small next to a window, and without an alignment it sits
    // at the top left with the rest of the canvas empty.
    this.paper.transformToFitContent({
      padding: 40,
      maxScale: 2.5,
      minScale: 0.1,
      horizontalAlign: 'middle',
      verticalAlign: 'middle',
    });
    this.scale = this.paper.scale().sx;
  }

  zoom(factor: number): void {
    this.scale = Math.min(4, Math.max(0.1, this.scale * factor));
    this.paper.scale(this.scale, this.scale);
  }

  /** The current arrangement, for saving. */
  toJSON(): unknown {
    return { version: '1.0', cells: this.graph.toJSON().cells };
  }

  fromJSON(saved: any): void {
    if (!saved?.cells) throw new Error('not a layout file');
    this.graph.fromJSON({ cells: saved.cells });
    this.fit();
  }
}

export { util };
