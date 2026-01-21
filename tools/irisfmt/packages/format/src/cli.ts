#!/usr/bin/env node

import { formatFile, checkFile } from './format.js';
import type { FormatOptions } from './format.js';
import { loadConfig } from '@irisfmt/core';
import * as fs from 'node:fs/promises';
import * as process from 'node:process';
import * as path from 'node:path';
import { glob } from 'glob';

const VERSION = '0.1.0';

interface CliOptions {
  patterns: string[];
  write: boolean;
  check: boolean;
  help: boolean;
  version: boolean;
  config?: string;
}

function printHelp(): void {
  console.log(`
irisfmt-format - IRIS Code Formatter

USAGE:
  irisfmt-format [OPTIONS] <FILES|PATTERNS...>

OPTIONS:
  -w, --write              Write formatted output back to files
  -c, --check              Check if files are formatted (exit 1 if not)
  --config <path>          Path to config file (default: auto-detect)
  -h, --help               Show this help message
  -v, --version            Show version information

CONFIG:
  Configuration is loaded from .irisfmtrc.json or irisfmt.config.json
  in the current directory or any parent directory.

PATTERNS:
  Supports glob patterns for matching multiple files.

EXAMPLES:
  irisfmt-format example.iris              # Print formatted to stdout
  irisfmt-format -w example.iris           # Format in place
  irisfmt-format -c "src/**/*.{iris,irs}"  # Check all IRIS files in src/
  irisfmt-format -w "**/*.{iris,irs}"      # Format all IRIS files recursively
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    patterns: [],
    write: false,
    check: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '-w' || arg === '--write') {
      options.write = true;
    } else if (arg === '-c' || arg === '--check') {
      options.check = true;
    } else if (arg === '--config' && i + 1 < args.length) {
      const configVal = args[i + 1];
      if (configVal) {
        options.config = configVal;
        i++;
      }
    } else if (!arg.startsWith('-')) {
      options.patterns.push(arg);
    }
  }

  return options;
}

async function expandPatterns(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    files.push(...matches);
  }
  // Remove duplicates and sort
  return [...new Set(files)].sort();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    console.log(`irisfmt-format ${VERSION}`);
    process.exit(0);
  }

  if (options.patterns.length === 0) {
    printHelp();
    process.exit(1);
  }

  // Load configuration
  let formatOptions: FormatOptions | undefined;
  try {
    if (options.config) {
      const { loadConfigFromFile } = await import('@irisfmt/core');
      const { config, configPath } = await loadConfigFromFile(options.config);
      formatOptions = { style: config.format };
    } else {
      const { config, configPath } = await loadConfig(process.cwd());
      formatOptions = { style: config.format };
      if (configPath) {
        // Config file found - silently use it
      }
    }
  } catch (err) {
    console.error('Error loading config:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Expand glob patterns to file list
  const files = await expandPatterns(options.patterns);

  if (files.length === 0) {
    console.error('No files matched the given patterns');
    process.exit(1);
  }

  let hasUnformatted = false;
  let formattedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    try {
      if (options.check) {
        const isFormatted = await checkFile(file, formatOptions);
        if (!isFormatted) {
          console.log(`${file} needs formatting`);
          hasUnformatted = true;
        }
      } else if (options.write) {
        const formatted = await formatFile(file, formatOptions);
        await fs.writeFile(file, formatted, 'utf-8');
        formattedCount++;
      } else {
        const formatted = await formatFile(file, formatOptions);
        console.log(formatted);
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err instanceof Error ? err.message : err);
      errorCount++;
    }
  }

  // Print summary for multi-file operations
  if (files.length > 1) {
    if (options.write) {
      console.log(`\nFormatted ${formattedCount} file(s)`);
    } else if (options.check) {
      const formattedFiles = files.length - (hasUnformatted ? 1 : 0);
      if (!hasUnformatted) {
        console.log(`\nAll ${files.length} file(s) are formatted correctly`);
      }
    }
    if (errorCount > 0) {
      console.error(`${errorCount} file(s) had errors`);
    }
  }

  if (hasUnformatted || errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
