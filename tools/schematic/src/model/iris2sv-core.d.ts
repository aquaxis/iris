/**
 * The IRIS parser ships as compiled JavaScript with its own declarations in
 * the iris2sv workspace, which this tool aliases rather than depends on. The
 * shape used here is the whole of the public surface this tool touches.
 */
declare module '@iris2sv/core' {
  export interface ParseError {
    message?: string;
  }
  export interface ParseOutput {
    ast: { items?: any[] } | undefined;
    errors?: ParseError[];
  }
  export function parse(source: string): ParseOutput;
}
