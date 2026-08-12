/**
 * IRIS to SystemVerilog Transformation Package
 *
 * Provides transformation from IRIS AST to HIR to SystemVerilog AST.
 */

export const VERSION = '0.1.0';

// AST to HIR lowering
export * from './lowering.js';

// Type mapping
export * from './type-mapper.js';

// Expression transformer
export * from './expr-transformer.js';

// Statement transformer
export * from './stmt-transformer.js';

// Module transformer
export * from './module-transformer.js';

// Output wire transform
export * from './output-wire-transform.js';

// Instance read transform
export * from './instance-read-transform.js';
