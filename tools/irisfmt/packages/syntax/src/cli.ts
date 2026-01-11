#!/usr/bin/env node

import { parse, parseFile } from './parse.js';
import * as fs from 'node:fs/promises';
import * as process from 'node:process';

const VERSION = '0.1.0';

interface CliOptions {
  file?: string;
  output?: string;
  help: boolean;
  version: boolean;
}

function printHelp(): void {
  console.log(`
irisfmt-syntax - IRIS Syntax Analysis Tool

USAGE:
  irisfmt-syntax [OPTIONS] <FILE>
  cat source.iris | irisfmt-syntax

OPTIONS:
  -o, --output <FILE>  Write output to file instead of stdout
  -h, --help           Show this help message
  -v, --version        Show version information

EXAMPLES:
  irisfmt-syntax example.iris
  irisfmt-syntax example.iris -o output.json
  cat example.iris | irisfmt-syntax
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '-o' || arg === '--output') {
      i++;
      const outputArg = args[i];
      if (outputArg !== undefined) {
        options.output = outputArg;
      }
    } else if (!arg.startsWith('-')) {
      options.file = arg;
    }

    i++;
  }

  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    console.log(`irisfmt-syntax ${VERSION}`);
    process.exit(0);
  }

  let result;

  if (options.file) {
    result = await parseFile(options.file);
  } else if (!process.stdin.isTTY) {
    const source = await readStdin();
    result = parse(source);
  } else {
    printHelp();
    process.exit(1);
  }

  const output = JSON.stringify(result, null, 2);

  if (options.output) {
    await fs.writeFile(options.output, output, 'utf-8');
  } else {
    console.log(output);
  }

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
