#!/usr/bin/env node
/**
 * IRIS to SystemVerilog CLI
 *
 * Command-line interface for compiling IRIS source files to SystemVerilog.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

import { VERSION } from './index.js';
import { Compiler, type CompilerOptions } from './compiler.js';
import { ErrorFormatter } from './formatter.js';

/**
 * CLI options
 */
interface CliOptions {
  output?: string;
  watch?: boolean;
  verbose?: boolean;
  strict?: boolean;
  check?: boolean;
  noColor?: boolean;
  dryRun?: boolean;
  autoOutputWire?: boolean;
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('iris2sv')
    .description('IRIS to SystemVerilog transpiler')
    .version(VERSION)
    .argument('[files...]', 'IRIS source files to compile (supports glob patterns)')
    .option('-o, --output <dir>', 'Output directory for generated files')
    .option('-w, --watch', 'Watch mode - recompile on file changes')
    .option('-v, --verbose', 'Verbose output')
    .option('--strict', 'Treat warnings as errors')
    .option('--check', 'Check only, do not generate output')
    .option('--no-color', 'Disable colored output')
    .option('--dry-run', 'Show what would be done without writing files')
    .option('-a, --auto-output-wire', 'Auto-generate internal wires for output ports that are read')
    .action(async (files: string[], options: CliOptions) => {
      await runCompilation(files, options);
    });

  await program.parseAsync();
}

/**
 * Run the compilation
 */
async function runCompilation(filePatterns: string[], options: CliOptions): Promise<void> {
  // Resolve file patterns
  const files = await resolveFiles(filePatterns);

  if (files.length === 0) {
    if (filePatterns.length === 0) {
      console.log('Usage: iris2sv [options] <files...>');
      console.log('Run `iris2sv --help` for more information.');
    } else {
      console.error('Error: No matching files found.');
    }
    process.exit(1);
  }

  // Setup compiler
  const compilerOptions: Partial<CompilerOptions> = {
    strict: options.strict ?? false,
    verbose: options.verbose ?? false,
    checkOnly: options.check ?? false,
    autoOutputWire: options.autoOutputWire ?? false,
  };

  const compiler = new Compiler(compilerOptions);
  const formatter = new ErrorFormatter({
    color: options.noColor !== true && process.stdout.isTTY,
  });

  // Compile each file
  let hasErrors = false;
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesProcessed = 0;

  for (const file of files) {
    const result = await compileFile(file, compiler, formatter, options);

    if (!result.success) {
      hasErrors = true;
    }

    totalErrors += result.errors;
    totalWarnings += result.warnings;
    filesProcessed++;
  }

  // Print summary
  console.log('');
  if (hasErrors) {
    console.log(`Compilation failed: ${totalErrors} error(s), ${totalWarnings} warning(s) in ${filesProcessed} file(s).`);
    process.exit(1);
  } else {
    if (options.check) {
      console.log(`Check passed: ${filesProcessed} file(s) checked, ${totalWarnings} warning(s).`);
    } else if (options.dryRun) {
      console.log(`Dry run: ${filesProcessed} file(s) would be compiled.`);
    } else {
      console.log(`Compilation succeeded: ${filesProcessed} file(s) compiled, ${totalWarnings} warning(s).`);
    }
  }
}

/**
 * Compile a single file
 */
async function compileFile(
  inputFile: string,
  compiler: Compiler,
  formatter: ErrorFormatter,
  options: CliOptions
): Promise<{ success: boolean; errors: number; warnings: number }> {
  const absolutePath = path.resolve(inputFile);

  if (options.verbose) {
    console.log(`Compiling: ${inputFile}`);
  }

  // Read source file
  let source: string;
  try {
    source = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading file: ${inputFile}`);
    console.error(`  ${(error as Error).message}`);
    return { success: false, errors: 1, warnings: 0 };
  }

  // Set source for error formatting
  formatter.setSource(inputFile, source);

  // Compile
  const result = compiler.compile(source, inputFile);

  // Report parse errors
  //
  // These went through `console.error(error)`, which prints the object: a brace,
  // a message, and eight lines of span. The same run reports every other
  // diagnostic through the formatter, with the file, the line and a caret. One
  // class of error was unreadable for no reason other than the path it took.
  if (result.parseErrors.length > 0) {
    console.error(
      formatter.formatDiagnostics(
        result.parseErrors.map((error) => ({
          severity: 'error' as const,
          message: error.message,
          span: error.span,
          code: undefined,
        })),
        inputFile
      )
    );
    return { success: false, errors: result.parseErrors.length, warnings: 0 };
  }

  // Report diagnostics
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  const warnings = result.diagnostics.filter(d => d.severity === 'warning');

  if (result.diagnostics.length > 0) {
    console.log(formatter.formatDiagnostics(result.diagnostics, inputFile));
  }

  // Write output
  if (result.success && result.output && !options.check && !options.dryRun) {
    const outputPath = getOutputPath(inputFile, options.output);

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Write file
      await fs.promises.writeFile(outputPath, result.output, 'utf-8');

      if (options.verbose) {
        console.log(`  -> ${outputPath}`);
      }
    } catch (error) {
      console.error(`Error writing file: ${outputPath}`);
      console.error(`  ${(error as Error).message}`);
      return { success: false, errors: 1, warnings: warnings.length };
    }
  } else if (result.success && options.dryRun) {
    const outputPath = getOutputPath(inputFile, options.output);
    console.log(`  Would write: ${outputPath}`);
  }

  return {
    success: result.success,
    errors: errors.length,
    warnings: warnings.length,
  };
}

/**
 * Resolve file patterns to actual file paths
 */
async function resolveFiles(patterns: string[]): Promise<string[]> {
  if (patterns.length === 0) {
    return [];
  }

  const files: string[] = [];

  for (const pattern of patterns) {
    // Check if it's a glob pattern
    if (pattern.includes('*') || pattern.includes('?')) {
      const matches = await glob(pattern, { nodir: true });
      files.push(...matches);
    } else {
      // Check if file exists
      try {
        const stat = await fs.promises.stat(pattern);
        if (stat.isFile()) {
          files.push(pattern);
        } else if (stat.isDirectory()) {
          // Find all .iris and .irs files in directory
          const dirFiles = await glob(path.join(pattern, '**/*.{iris,irs}'), { nodir: true });
          files.push(...dirFiles);
        }
      } catch {
        // File doesn't exist, but might be a typo
        console.warn(`Warning: File not found: ${pattern}`);
      }
    }
  }

  // Remove duplicates
  return [...new Set(files)];
}

/**
 * Get output file path
 */
function getOutputPath(inputFile: string, outputDir?: string): string {
  const parsed = path.parse(inputFile);
  const svFilename = `${parsed.name}.sv`;

  if (outputDir) {
    return path.join(outputDir, svFilename);
  } else {
    return path.join(parsed.dir, svFilename);
  }
}

// Run main
main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
