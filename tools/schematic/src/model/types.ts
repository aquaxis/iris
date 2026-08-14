/**
 * The diagram model: what a block diagram of an IRIS design is made of.
 *
 * This sits between the IRIS AST and the drawing. Keeping it separate means
 * the edge inference can be tested without a browser.
 */

/** What a box in the diagram stands for. */
export type NodeKind =
  /** An instantiated submodule. */
  | 'inst'
  /** A port on the boundary of the module being drawn. */
  | 'io'
  /** A signal assigned in `sync`, i.e. state. */
  | 'reg';

export interface DiagramNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Text shown in the box. */
  readonly label: string;
  /** For `io` nodes, which way the port faces. */
  readonly direction?: string;
  /** For `inst` nodes, the module being instantiated. */
  readonly module?: string;
}

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  /** The port or signal this edge arrives at. */
  readonly label: string;
  /**
   * Whether the edge was written in the source or found by tracing.
   *
   * `direct` edges come from a connection naming an instance output
   * (`waddr: dec.rd`). `traced` edges come from following a combinational
   * signal back to whatever drives it. Most edges are traced: a design
   * that assigns through intermediate signals states almost none of its
   * wiring directly.
   */
  readonly origin: 'direct' | 'traced';
}

export interface DiagramGraph {
  /** Name of the module or test module this graph describes. */
  readonly name: string;
  readonly isTest: boolean;
  readonly nodes: DiagramNode[];
  readonly edges: DiagramEdge[];
}

/** A source file that failed to parse, reported rather than dropped. */
export interface ParseFailure {
  readonly file: string;
  readonly message: string;
}

export interface BuildResult {
  readonly graphs: DiagramGraph[];
  readonly failures: ParseFailure[];
}
