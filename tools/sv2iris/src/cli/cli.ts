/**
 * SV2IRIS CLI
 * Command-line interface for SystemVerilog to IRIS conversion
 */

import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from '../lexer/index.js';
import { Parser } from '../parser/index.js';
import { Transformer } from '../transformer/index.js';
import type { GeneratorOptions } from '../generator/index.js';
import { Generator } from '../generator/index.js';
import { ErrorReporter } from '../errors/index.js';

/**
 * CLI options parsed from command line arguments
 */
export interface CLIOptions {
    inputFiles: string[];
    outputFile?: string;
    outputDir?: string;
    indent: number;
    useTabs: boolean;
    help: boolean;
    version: boolean;
    autoOutputWire: boolean;
}

/**
 * CLI result
 */
export interface CLIResult {
    success: boolean;
    errors: string[];
    warnings: string[];
    outputFiles: string[];
}

/**
 * Package version
 */
const VERSION = '0.1.0';

/**
 * Help message
 */
const HELP_MESSAGE = `
sv2iris - SystemVerilog to IRIS Converter

Usage:
  sv2iris <input.sv> [options]
  sv2iris <input1.sv> <input2.sv> ... -o <output_dir/> [options]

Options:
  -o, --output <file|dir>   Output file or directory
                            If omitted, outputs to stdout
                            Use trailing '/' for directory output
  -h, --help                Show this help message
  -v, --version             Show version information
  --indent <n>              Indentation width (default: 4)
  --tabs                    Use tabs for indentation
  -a, --auto-output-wire    Auto-generate internal wires for output ports
                            that are read internally

Examples:
  sv2iris counter.sv                      # Output to stdout
  sv2iris counter.sv -o counter.iris      # Output to file
  sv2iris src/*.sv -o dist/               # Convert multiple files
  sv2iris counter.sv -a                   # With auto-output-wire

`.trim();

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): CLIOptions {
    const options: CLIOptions = {
        inputFiles: [],
        indent: 4,
        useTabs: false,
        help: false,
        version: false,
        autoOutputWire: false,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        if (arg === '-h' || arg === '--help') {
            options.help = true;
            i++;
        } else if (arg === '-v' || arg === '--version') {
            options.version = true;
            i++;
        } else if (arg === '-o' || arg === '--output') {
            i++;
            if (i >= args.length) {
                throw new Error('Missing argument for -o/--output');
            }
            const output = args[i];
            if (output.endsWith('/') || output.endsWith(path.sep)) {
                options.outputDir = output;
            } else {
                options.outputFile = output;
            }
            i++;
        } else if (arg === '--indent') {
            i++;
            if (i >= args.length) {
                throw new Error('Missing argument for --indent');
            }
            const indent = parseInt(args[i], 10);
            if (isNaN(indent) || indent < 0) {
                throw new Error('Invalid indent value: must be a non-negative integer');
            }
            options.indent = indent;
            i++;
        } else if (arg === '--tabs') {
            options.useTabs = true;
            i++;
        } else if (arg === '-a' || arg === '--auto-output-wire') {
            options.autoOutputWire = true;
            i++;
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            options.inputFiles.push(arg);
            i++;
        }
    }

    return options;
}

/**
 * Format error message with source location
 */
export function formatError(
    filename: string,
    line: number,
    column: number,
    message: string,
    source?: string
): string {
    let result = `${filename}:${line}:${column}: error: ${message}`;

    if (source) {
        const lines = source.split('\n');
        if (line > 0 && line <= lines.length) {
            const sourceLine = lines[line - 1];
            result += '\n' + sourceLine;
            result += '\n' + ' '.repeat(column - 1) + '^';
        }
    }

    return result;
}

/**
 * Transformer options
 */
export interface TransformerOptions {
    autoOutputWire?: boolean;
}

/**
 * Convert a single file
 */
export function convertFile(
    inputPath: string,
    source: string,
    generatorOptions: GeneratorOptions,
    transformerOptions?: TransformerOptions
): { output: string; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Create error reporter
    const errorReporter = new ErrorReporter();

    // Lexer
    const lexer = new Lexer(source, inputPath, errorReporter);
    const tokens = lexer.tokenize();

    // Check for lexer errors
    if (errorReporter.hasErrors()) {
        for (const error of errorReporter.getErrors()) {
            if (error.location) {
                errors.push(
                    formatError(
                        inputPath,
                        error.location.start.line,
                        error.location.start.column,
                        error.message,
                        source
                    )
                );
            } else {
                errors.push(`${inputPath}: error: ${error.message}`);
            }
        }
        return { output: '', errors, warnings };
    }

    // Parser
    const parser = new Parser(tokens, errorReporter);
    const svAst = parser.parse();

    // Check for parser errors
    if (errorReporter.hasErrors()) {
        for (const error of errorReporter.getErrors()) {
            if (error.location) {
                errors.push(
                    formatError(
                        inputPath,
                        error.location.start.line,
                        error.location.start.column,
                        error.message,
                        source
                    )
                );
            } else {
                errors.push(`${inputPath}: error: ${error.message}`);
            }
        }
        return { output: '', errors, warnings };
    }

    // Transformer
    //
    // The reporter has to be the shared one. Handing the transformer its own
    // meant every diagnostic it raised went into an object nobody read, so a
    // construct it could not convert was dropped and the run still reported
    // success. That is how a reset branch disappeared without a word.
    const transformer = new Transformer(errorReporter, {
        autoOutputWire: transformerOptions?.autoOutputWire ?? false,
    });
    const irisAst = transformer.transform(svAst);

    // Check for transformer errors
    if (errorReporter.hasErrors()) {
        for (const error of errorReporter.getErrors()) {
            if (error.location) {
                errors.push(
                    formatError(
                        inputPath,
                        error.location.start.line,
                        error.location.start.column,
                        error.message,
                        source
                    )
                );
            } else {
                errors.push(`${inputPath}: error: ${error.message}`);
            }
        }
        return { output: '', errors, warnings };
    }

    // Generator
    const generator = new Generator(generatorOptions);
    const output = generator.generate(irisAst);

    return { output, errors, warnings };
}

/**
 * Run the CLI
 */
export function run(args: string[]): CLIResult {
    const result: CLIResult = {
        success: true,
        errors: [],
        warnings: [],
        outputFiles: [],
    };

    try {
        const options = parseArgs(args);

        // Handle help
        if (options.help) {
            console.log(HELP_MESSAGE);
            return result;
        }

        // Handle version
        if (options.version) {
            console.log(`sv2iris version ${VERSION}`);
            return result;
        }

        // Validate input
        if (options.inputFiles.length === 0) {
            result.success = false;
            result.errors.push('No input files specified. Use -h for help.');
            return result;
        }

        // Multiple files require output directory
        if (options.inputFiles.length > 1 && options.outputFile) {
            result.success = false;
            result.errors.push(
                'Cannot use single output file with multiple input files. Use -o <dir>/ instead.'
            );
            return result;
        }

        // Generator options
        const generatorOptions: GeneratorOptions = {
            indent: ' '.repeat(options.indent),
            useTabs: options.useTabs,
            trailingNewline: true,
        };

        // Process each input file
        for (const inputFile of options.inputFiles) {
            // Check if file exists
            if (!fs.existsSync(inputFile)) {
                result.success = false;
                result.errors.push(`File not found: ${inputFile}`);
                continue;
            }

            // Read input file
            const source = fs.readFileSync(inputFile, 'utf-8');

            // Convert
            const conversionResult = convertFile(inputFile, source, generatorOptions, {
                autoOutputWire: options.autoOutputWire,
            });

            // Collect errors and warnings
            result.errors.push(...conversionResult.errors);
            result.warnings.push(...conversionResult.warnings);

            if (conversionResult.errors.length > 0) {
                result.success = false;
                continue;
            }

            // Determine output
            if (options.outputDir) {
                // Create output directory if needed
                if (!fs.existsSync(options.outputDir)) {
                    fs.mkdirSync(options.outputDir, { recursive: true });
                }

                // Generate output filename
                const baseName = path.basename(inputFile, path.extname(inputFile));
                const outputPath = path.join(options.outputDir, baseName + '.iris');

                fs.writeFileSync(outputPath, conversionResult.output);
                result.outputFiles.push(outputPath);
            } else if (options.outputFile) {
                fs.writeFileSync(options.outputFile, conversionResult.output);
                result.outputFiles.push(options.outputFile);
            } else {
                // Output to stdout
                process.stdout.write(conversionResult.output);
            }
        }
    } catch (err) {
        result.success = false;
        result.errors.push((err as Error).message);
    }

    return result;
}

/**
 * Main entry point
 */
export function main(): void {
    const args = process.argv.slice(2);
    const result = run(args);

    // Print errors to stderr
    for (const error of result.errors) {
        console.error(error);
    }

    // Print warnings to stderr
    for (const warning of result.warnings) {
        console.error(`warning: ${warning}`);
    }

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
}
