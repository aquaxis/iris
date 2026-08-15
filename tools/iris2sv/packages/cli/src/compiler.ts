/**
 * Compiler Pipeline
 *
 * Orchestrates the compilation from IRIS source to SystemVerilog output.
 */

import { parse } from '@iris2sv/core';
import type { SourceFile, ParseError, HirModule } from '@iris2sv/core';
import type { SvModule } from '@iris2sv/sv-backend';
import {
  SymbolTableBuilder,
  createSemanticAnalyzer,
  type SemanticAnalyzer,
} from '@iris2sv/analyzer';
import { emitModule, emitTypeDef, emitFunction, emitInterface } from '@iris2sv/sv-backend';
import {
  createLowering,
  createModuleTransformer,
  transformOutputWires,
  transformInstanceReads,
  transformTypeDef,
  transformFunction,
  transformInterface,
} from '@iris2sv/transform';
import type { Diagnostic} from './formatter.js';
import { fromSemanticDiagnostic } from './formatter.js';

/**
 * Compiler options
 */
export interface CompilerOptions {
  /** Treat warnings as errors */
  strict: boolean;
  /** Verbose output */
  verbose: boolean;
  /** Skip code generation (check only) */
  checkOnly: boolean;
  /** Target SystemVerilog version */
  target: 'sv2012' | 'sv2017';
  /** Auto-generate internal wires for output ports that are read */
  autoOutputWire: boolean;
}

/**
 * Default compiler options
 */
export const defaultCompilerOptions: CompilerOptions = {
  strict: false,
  verbose: false,
  checkOnly: false,
  target: 'sv2012',
  autoOutputWire: false,
};

/**
 * Compilation result
 */
export interface CompileResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** Parsed AST (if parsing succeeded) */
  ast: SourceFile | null;
  /** Generated SystemVerilog code (if generation succeeded) */
  output: string | null;
  /** Diagnostic messages */
  diagnostics: Diagnostic[];
  /** Parse errors (separate from semantic diagnostics) */
  parseErrors: ParseError[];
}

/**
 * Compiler class
 */
export class Compiler {
  private readonly options: CompilerOptions;

  /** module name -> port name -> type, accumulated across every file compiled */
  private readonly portTypes = new Map<
    string,
    Map<string, ReturnType<ReturnType<typeof createModuleTransformer>['typeMapper']['mapType']>>
  >();

  constructor(options?: Partial<CompilerOptions>) {
    this.options = { ...defaultCompilerOptions, ...options };
  }

  /**
   * Compile IRIS source to SystemVerilog
   */
  compile(source: string, filename = '<input>'): CompileResult {
    const result: CompileResult = {
      success: false,
      ast: null,
      output: null,
      diagnostics: [],
      parseErrors: [],
    };

    // Phase 1: Parsing (includes lexing)
    if (this.options.verbose) {
      console.log(`[iris2sv] Parsing ${filename}...`);
    }

    const parseResult = parse(source);
    result.ast = parseResult.ast;

    // Check for parse errors
    if (parseResult.errors.length > 0) {
      result.parseErrors = parseResult.errors;
      return result;
    }

    // Phase 2: Build symbol table
    if (this.options.verbose) {
      console.log(`[iris2sv] Building symbol table for ${filename}...`);
    }

    const builder = new SymbolTableBuilder();
    builder.build(parseResult.ast);
    const symbolTable = builder.getSymbolTable();

    // Phase 3: Semantic analysis
    if (this.options.verbose) {
      console.log(`[iris2sv] Analyzing ${filename}...`);
    }

    const analyzer = createSemanticAnalyzer(symbolTable, undefined, {
      strict: this.options.strict,
    });

    // Analyze the source file (includes signal usage collection)
    const analysisResult = analyzer.analyze(parseResult.ast);

    // Convert diagnostics
    result.diagnostics = analysisResult.diagnostics.map(fromSemanticDiagnostic);

    // Check for errors
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    const warnings = result.diagnostics.filter(d => d.severity === 'warning');

    if (errors.length > 0) {
      return result;
    }

    if (this.options.strict && warnings.length > 0) {
      return result;
    }

    // Phase 4: Skip code generation if check only
    if (this.options.checkOnly) {
      result.success = true;
      return result;
    }

    // Phase 5: Code generation
    if (this.options.verbose) {
      console.log(`[iris2sv] Generating ${filename}...`);
    }

    try {
      const svCode = this.generateCode(parseResult.ast, analyzer, result.diagnostics);
      result.output = svCode;
      // A construct the lowering could not convert is a failure, not a note:
      // the output would otherwise be a module that does less than the source.
      result.success = !result.diagnostics.some(d => d.severity === 'error');
    } catch (error) {
      result.parseErrors.push({
        message: `Code generation error: ${(error as Error).message}`,
        span: {
          start: 0,
          end: 0,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
        },
      });
    }

    return result;
  }

  /**
   * Record the ports of every module in a lowered file
   */
  private recordPortTypes(
    modules: readonly { name: string; ports: readonly { name: string; dataType: unknown }[] }[],
    transformer: ReturnType<typeof createModuleTransformer>
  ): void {
    for (const hirModule of modules) {
      const ports = new Map<string, ReturnType<typeof transformer.typeMapper.mapType>>();
      for (const port of hirModule.ports) {
        ports.set(
          port.name,
          transformer.typeMapper.mapType(port.dataType as Parameters<typeof transformer.typeMapper.mapType>[0])
        );
      }
      this.portTypes.set(hirModule.name, ports);
    }
  }

  /**
   * Record a file's module ports without generating anything
   *
   * Called for every input before any of them is compiled. Without it, a module
   * that instantiates one declared in a file named later would find no port
   * widths, and its `inst.port` reads would stay hierarchical.
   */
  registerPortTypes(source: string): void {
    const parseResult = parse(source);
    if (parseResult.errors.length > 0) return;

    const lowering = createLowering();
    const loweringResult = lowering.lower(parseResult.ast);
    this.recordPortTypes(loweringResult.hir.modules, createModuleTransformer());
  }

  /**
   * Generate SystemVerilog code from AST
   *
   * Uses the transform package to convert AST → HIR → SV AST → SystemVerilog.
   */
  private generateCode(ast: SourceFile, analyzer?: SemanticAnalyzer, diagnostics?: Diagnostic[]): string {
    const outputs: string[] = [];

    // Add header
    outputs.push('// Generated by iris2sv');
    outputs.push('// Do not edit manually');
    outputs.push('');

    // Step 1: Lower AST to HIR
    const lowering = createLowering();
    const loweringResult = lowering.lower(ast);

    // Report lowering warnings
    for (const warning of loweringResult.warnings) {
      diagnostics?.push({
        severity: 'warning',
        message: warning.message,
        span: undefined,
        code: undefined,
      });
      if (this.options.verbose) {
        console.log(`[iris2sv] Warning: ${warning.message}`);
      }
    }

    // Report lowering errors
    for (const error of loweringResult.errors) {
      diagnostics?.push({
        severity: 'error',
        message: error.message,
        span: undefined,
        code: undefined,
      });
      if (this.options.verbose) {
        console.log(`[iris2sv] Error: ${error.message}`);
      }
    }

    // Get output ports with reads (for auto-output-wire feature)
    const outputPortsWithReads = analyzer?.getOutputPortsWithReads() ?? new Set<string>();

    // Step 2: Transform each HIR module to SV AST and emit
    const moduleTransformer = createModuleTransformer();

    // Top-level `enum`, `struct` and `fn` become typedefs and functions that sit
    // outside any module, so they are emitted before the modules that use them.
    for (const typeDef of loweringResult.hir.typeDefs) {
      const svTypeDef = transformTypeDef(typeDef, moduleTransformer);
      if (svTypeDef) {
        outputs.push(emitTypeDef(svTypeDef));
        outputs.push('');
      }
    }
    // An interface sits outside any module in SystemVerilog too.
    for (const iface of loweringResult.hir.interfaces) {
      outputs.push(emitInterface(transformInterface(iface, moduleTransformer)));
      outputs.push('');
    }

    for (const fn of loweringResult.hir.functions) {
      outputs.push(emitFunction(transformFunction(fn, moduleTransformer)));
      outputs.push('');
    }

    // Port types of every module seen so far, so that a wire made for
    // `inst.port` can be given the width the port actually has.
    //
    // A design is usually several files and iris2sv compiles them one at a
    // time, so a module's ports are recorded on the compiler rather than on
    // this call. registerPortTypes() fills the registry ahead of the first
    // compile, which is what makes the order the files are named in stop
    // mattering.
    this.recordPortTypes(loweringResult.hir.modules, moduleTransformer);
    const portTypes = this.portTypes;

    for (const hirModule of loweringResult.hir.modules) {
      let svModule = this.transformModule(hirModule, moduleTransformer);

      // `rf.rdata1` is a hierarchical reference in SystemVerilog and leaves the
      // port unconnected. Give it a wire.
      {
        const instanceReads = transformInstanceReads(svModule, portTypes);
        svModule = instanceReads.module;
        if (this.options.verbose && instanceReads.wires.length > 0) {
          console.log(`[iris2sv] Wired instance reads: ${instanceReads.wires.join(', ')}`);
        }
        for (const error of instanceReads.errors) {
          if (this.options.verbose) {
            console.log(`[iris2sv] Instance read: ${error}`);
          }
        }
      }

      // Apply output wire transform if enabled
      if (this.options.autoOutputWire && outputPortsWithReads.size > 0) {
        const transformResult = transformOutputWires(svModule, outputPortsWithReads);

        if (transformResult.errors.length > 0) {
          for (const error of transformResult.errors) {
            if (this.options.verbose) {
              console.log(`[iris2sv] Output wire transform error: ${error}`);
            }
          }
        } else {
          svModule = transformResult.module;

          if (this.options.verbose && transformResult.transformedPorts.length > 0) {
            console.log(`[iris2sv] Auto-generated internal wires for: ${transformResult.transformedPorts.join(', ')}`);
          }
        }
      }

      outputs.push(emitModule(svModule));
      outputs.push('');
    }

    return outputs.join('\n');
  }

  /**
   * Transform HIR module to SV module and emit code
   */
  private transformModule(
    hirModule: HirModule,
    transformer: ReturnType<typeof createModuleTransformer>
  ): SvModule {
    return transformer.transform(hirModule);
  }
}

/**
 * Create a compiler
 */
export function createCompiler(options?: Partial<CompilerOptions>): Compiler {
  return new Compiler(options);
}

/**
 * Compile source to SystemVerilog
 */
export function compile(
  source: string,
  filename?: string,
  options?: Partial<CompilerOptions>
): CompileResult {
  return createCompiler(options).compile(source, filename);
}
