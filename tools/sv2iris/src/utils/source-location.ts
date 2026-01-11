/**
 * Source Location Types
 * Represents positions and ranges within source files
 */

/**
 * Represents a single position in source code
 */
export interface SourcePosition {
    /** Line number (1-based) */
    line: number;
    /** Column number (1-based) */
    column: number;
    /** Absolute offset from beginning of file (0-based) */
    offset: number;
}

/**
 * Represents a range in source code (start to end position)
 */
export interface SourceLocation {
    /** Start position of the range */
    start: SourcePosition;
    /** End position of the range */
    end: SourcePosition;
    /** Source file path (optional) */
    file?: string;
}

/**
 * Creates a new SourcePosition
 */
export function createPosition(line: number, column: number, offset: number): SourcePosition {
    return { line, column, offset };
}

/**
 * Creates a new SourceLocation from start and end positions
 */
export function createLocation(
    start: SourcePosition,
    end: SourcePosition,
    file?: string
): SourceLocation {
    return { start, end, file };
}

/**
 * Creates a SourceLocation for a single position (zero-width)
 */
export function createPointLocation(pos: SourcePosition, file?: string): SourceLocation {
    return { start: pos, end: pos, file };
}

/**
 * Merges two SourceLocations into one spanning both
 */
export function mergeLocations(loc1: SourceLocation, loc2: SourceLocation): SourceLocation {
    const start = loc1.start.offset <= loc2.start.offset ? loc1.start : loc2.start;
    const end = loc1.end.offset >= loc2.end.offset ? loc1.end : loc2.end;
    return { start, end, file: loc1.file ?? loc2.file };
}

/**
 * Formats a SourceLocation for display in error messages
 */
export function formatLocation(loc: SourceLocation): string {
    const file = loc.file ?? '<unknown>';
    return `${file}:${loc.start.line}:${loc.start.column}`;
}

/**
 * Formats a SourcePosition for display
 */
export function formatPosition(pos: SourcePosition): string {
    return `${pos.line}:${pos.column}`;
}
