/**
 * Configuration file loader for IRISFMT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IrisfmtConfig, FormatStyleConfig, LintConfig } from './types.js';
import { DEFAULT_FORMAT_STYLE, DEFAULT_LINT_CONFIG } from './types.js';

/**
 * Configuration file names to search for (in order of priority)
 */
const CONFIG_FILE_NAMES = [
  '.irisfmtrc.json',
  '.irisfmtrc',
  'irisfmt.config.json',
];

/**
 * Result of loading configuration
 */
export interface LoadConfigResult {
  /** The loaded configuration (merged with defaults) */
  config: Required<IrisfmtConfig>;
  /** Path to the config file that was loaded (null if defaults were used) */
  configPath: string | null;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse JSON configuration file
 */
async function parseJsonConfig(filePath: string): Promise<IrisfmtConfig> {
  const content = await fs.readFile(filePath, 'utf-8');
  try {
    return JSON.parse(content) as IrisfmtConfig;
  } catch (e) {
    throw new Error(`Failed to parse config file ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Validate format configuration
 */
function validateFormatConfig(config: unknown): FormatStyleConfig {
  if (typeof config !== 'object' || config === null) {
    return {};
  }

  const result: FormatStyleConfig = {};
  const c = config as Record<string, unknown>;

  if (typeof c['indentWidth'] === 'number' && c['indentWidth'] > 0) {
    result.indentWidth = c['indentWidth'];
  }

  if (typeof c['useTabs'] === 'boolean') {
    result.useTabs = c['useTabs'];
  }

  if (typeof c['maxLineLength'] === 'number' && c['maxLineLength'] > 0) {
    result.maxLineLength = c['maxLineLength'];
  }

  if (c['braceStyle'] === 'same-line' || c['braceStyle'] === 'new-line') {
    result.braceStyle = c['braceStyle'];
  }

  if (c['trailingComma'] === 'none' || c['trailingComma'] === 'all' || c['trailingComma'] === 'multi-line') {
    result.trailingComma = c['trailingComma'];
  }

  return result;
}

/**
 * Validate lint configuration
 */
function validateLintConfig(config: unknown): LintConfig {
  if (typeof config !== 'object' || config === null) {
    return {};
  }

  const result: LintConfig = {};
  const c = config as Record<string, unknown>;

  if (typeof c['rules'] === 'object' && c['rules'] !== null) {
    result.rules = c['rules'] as Record<string, LintConfig['rules'] extends Record<string, infer T> ? T : never>;
  }

  if (Array.isArray(c['ignore'])) {
    result.ignore = c['ignore'].filter((item): item is string => typeof item === 'string');
  }

  return result;
}

/**
 * Validate and normalize configuration
 */
function validateConfig(config: unknown): IrisfmtConfig {
  if (typeof config !== 'object' || config === null) {
    return {};
  }

  const c = config as Record<string, unknown>;
  const result: IrisfmtConfig = {};

  if (c['format'] !== undefined) {
    result.format = validateFormatConfig(c['format']);
  }

  if (c['lint'] !== undefined) {
    result.lint = validateLintConfig(c['lint']);
  }

  return result;
}

/**
 * Merge configuration with defaults
 */
function mergeWithDefaults(config: IrisfmtConfig): Required<IrisfmtConfig> {
  return {
    format: {
      ...DEFAULT_FORMAT_STYLE,
      ...config.format,
    },
    lint: {
      ...DEFAULT_LINT_CONFIG,
      ...config.lint,
      rules: {
        ...DEFAULT_LINT_CONFIG.rules,
        ...config.lint?.rules,
      },
    },
  };
}

/**
 * Find configuration file starting from the given directory and walking up
 */
async function findConfigFile(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const rootDir = path.parse(currentDir).root;

  while (currentDir !== rootDir) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const configPath = path.join(currentDir, fileName);
      if (await fileExists(configPath)) {
        return configPath;
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Load configuration from a specific file
 */
export async function loadConfigFromFile(filePath: string): Promise<LoadConfigResult> {
  const rawConfig = await parseJsonConfig(filePath);
  const validatedConfig = validateConfig(rawConfig);
  const mergedConfig = mergeWithDefaults(validatedConfig);

  return {
    config: mergedConfig,
    configPath: filePath,
  };
}

/**
 * Load configuration, searching from the specified directory upward
 */
export async function loadConfig(startDir: string = process.cwd()): Promise<LoadConfigResult> {
  const configPath = await findConfigFile(startDir);

  if (configPath) {
    return loadConfigFromFile(configPath);
  }

  // No config file found, use defaults
  return {
    config: mergeWithDefaults({}),
    configPath: null,
  };
}

/**
 * Load configuration with a fallback to provided options
 */
export async function loadConfigWithOverrides(
  startDir: string,
  overrides?: Partial<IrisfmtConfig>
): Promise<Required<IrisfmtConfig>> {
  const { config } = await loadConfig(startDir);

  if (!overrides) {
    return config;
  }

  return {
    format: {
      ...config.format,
      ...overrides.format,
    },
    lint: {
      ...config.lint,
      ...overrides.lint,
      rules: {
        ...config.lint.rules,
        ...overrides.lint?.rules,
      },
    },
  };
}
