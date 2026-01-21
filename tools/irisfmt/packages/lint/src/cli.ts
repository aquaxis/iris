#!/usr/bin/env node

import { lintFile } from './lint.js';
import type { LintResult } from './lint.js';
import { loadConfig } from '@irisfmt/core';
import * as process from 'node:process';
import { glob } from 'glob';
import { minimatch } from 'minimatch';

const VERSION = '0.1.0';

interface CliOptions {
  patterns: string[];
  fix: boolean;
  help: boolean;
  version: boolean;
  config?: string;
  ignore: string[];
}

function printHelp(): void {
  console.log(`
irisfmt-lint - IRIS Style Linter

USAGE:
  irisfmt-lint [OPTIONS] <FILES|PATTERNS...>

OPTIONS:
  --fix                Automatically fix problems (not yet implemented)
  --config <path>      Path to config file (default: auto-detect)
  --ignore <pattern>   Glob pattern to ignore (can be used multiple times)
  -h, --help           Show this help message
  -v, --version        Show version information

CONFIG:
  Configuration is loaded from .irisfmtrc.json or irisfmt.config.json
  in the current directory or any parent directory.

  Ignore patterns can be specified in the config file:
    {
      "lint": {
        "ignore": ["**/vendor/**", "**/generated/**"]
      }
    }

PATTERNS:
  Supports glob patterns for matching multiple files.

EXAMPLES:
  irisfmt-lint example.iris
  irisfmt-lint "src/**/*.{iris,irs}"
  irisfmt-lint --ignore "**/test/**" "src/**/*.{iris,irs}"
  irisfmt-lint --fix example.iris
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    patterns: [],
    fix: false,
    help: false,
    version: false,
    ignore: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--fix') {
      options.fix = true;
    } else if (arg === '--config' && i + 1 < args.length) {
      const configVal = args[i + 1];
      if (configVal) {
        options.config = configVal;
        i++;
      }
    } else if (arg === '--ignore' && i + 1 < args.length) {
      const ignoreVal = args[i + 1];
      if (ignoreVal) {
        options.ignore.push(ignoreVal);
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

/**
 * Filter files based on ignore patterns
 */
function filterIgnoredFiles(files: string[], ignorePatterns: string[]): string[] {
  if (ignorePatterns.length === 0) {
    return files;
  }

  return files.filter(file => {
    for (const pattern of ignorePatterns) {
      if (minimatch(file, pattern, { dot: true })) {
        return false;
      }
    }
    return true;
  });
}

interface LintSummary {
  filesChecked: number;
  totalErrors: number;
  totalWarnings: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    console.log(`irisfmt-lint ${VERSION}`);
    process.exit(0);
  }

  if (options.patterns.length === 0) {
    printHelp();
    process.exit(1);
  }

  // Load configuration
  let lintConfig: Record<string, unknown> = {};
  let ignorePatterns: string[] = [...options.ignore];
  try {
    if (options.config) {
      const { loadConfigFromFile } = await import('@irisfmt/core');
      const { config } = await loadConfigFromFile(options.config);
      lintConfig = { rules: config.lint.rules };
      // Merge ignore patterns from config
      if (config.lint.ignore && config.lint.ignore.length > 0) {
        ignorePatterns = [...ignorePatterns, ...config.lint.ignore];
      }
    } else {
      const { config } = await loadConfig(process.cwd());
      lintConfig = { rules: config.lint.rules };
      // Merge ignore patterns from config
      if (config.lint.ignore && config.lint.ignore.length > 0) {
        ignorePatterns = [...ignorePatterns, ...config.lint.ignore];
      }
    }
  } catch (err) {
    console.error('Error loading config:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Expand glob patterns to file list
  let files = await expandPatterns(options.patterns);

  // Filter out ignored files
  files = filterIgnoredFiles(files, ignorePatterns);

  if (files.length === 0) {
    console.error('No files matched the given patterns (or all files were ignored)');
    process.exit(1);
  }

  const summary: LintSummary = {
    filesChecked: 0,
    totalErrors: 0,
    totalWarnings: 0,
  };

  for (const file of files) {
    try {
      const result = await lintFile(file, lintConfig);
      summary.filesChecked++;

      for (const diagnostic of result.diagnostics) {
        const { span, rule, message, severity } = diagnostic;
        const loc = `${file}:${span.start.line}:${span.start.column}`;
        console.log(`${loc} ${severity} [${rule}] ${message}`);

        if (severity === 'error') {
          summary.totalErrors++;
        } else if (severity === 'warning') {
          summary.totalWarnings++;
        }
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err instanceof Error ? err.message : err);
      summary.totalErrors++;
    }
  }

  // Print summary for multi-file operations
  if (files.length > 1) {
    console.log('');
    console.log(`Checked ${summary.filesChecked} file(s)`);
    if (summary.totalErrors > 0 || summary.totalWarnings > 0) {
      console.log(`Found ${summary.totalErrors} error(s) and ${summary.totalWarnings} warning(s)`);
    } else {
      console.log('No problems found');
    }
  }

  if (summary.totalErrors > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
