/**
 * SystemVerilog Module and Top-level Structures
 *
 * Represents SystemVerilog modules and their components for code generation.
 */

import type { SvExpr } from './expr.js';
import type { SvStmt } from './stmt.js';
import type { SvDataType } from './types.js';

// ==================== Parameters ====================

/**
 * Module parameter
 */
export interface SvParameter {
  readonly kind: 'SvParameter';
  readonly name: string;
  readonly dataType: SvDataType | undefined;  // undefined for untyped
  readonly defaultValue: SvExpr | undefined;
  readonly isLocal: boolean;  // localparam
}

// ==================== Ports ====================

/**
 * Port direction
 */
export type SvPortDirection = 'input' | 'output' | 'inout';

/**
 * Module port
 */
export interface SvPort {
  readonly kind: 'SvPort';
  readonly name: string;
  readonly direction: SvPortDirection;
  readonly dataType: SvDataType;
  readonly isReg: boolean;  // output reg (for legacy Verilog)
}

// ==================== Signals ====================

/**
 * Signal/variable declaration
 */
export interface SvSignal {
  readonly kind: 'SvSignal';
  readonly name: string;
  readonly dataType: SvDataType;
  readonly initialValue: SvExpr | undefined;
}

// ==================== Always Blocks ====================

/**
 * Clock edge
 */
export type SvEdge = 'posedge' | 'negedge';

/**
 * Sensitivity item
 */
export type SvSensitivity =
  | SvEdgeSensitivity
  | SvLevelSensitivity
  | SvAllSensitivity;

/**
 * Edge-triggered sensitivity (posedge/negedge signal)
 */
export interface SvEdgeSensitivity {
  readonly kind: 'SvEdgeSensitivity';
  readonly edge: SvEdge;
  readonly signal: string;
}

/**
 * Level-sensitive (signal name only)
 */
export interface SvLevelSensitivity {
  readonly kind: 'SvLevelSensitivity';
  readonly signal: string;
}

/**
 * All sensitivity (*)
 */
export interface SvAllSensitivity {
  readonly kind: 'SvAllSensitivity';
}

/**
 * Always block type
 */
export type SvAlwaysType = 'always' | 'always_comb' | 'always_ff' | 'always_latch';

/**
 * Always block
 */
export interface SvAlwaysBlock {
  readonly kind: 'SvAlwaysBlock';
  readonly alwaysType: SvAlwaysType;
  readonly sensitivity: SvSensitivity[];
  readonly body: SvStmt;
}

// ==================== Initial Block ====================

/**
 * Initial block
 */
export interface SvInitialBlock {
  readonly kind: 'SvInitialBlock';
  readonly body: SvStmt;
}

// ==================== Continuous Assignment ====================

/**
 * Continuous assignment (assign)
 */
export interface SvAssign {
  readonly kind: 'SvAssign';
  readonly lhs: SvExpr;
  readonly rhs: SvExpr;
  readonly delay: SvExpr | undefined;
}

// ==================== Instances ====================

/**
 * Port connection
 */
export interface SvConnection {
  readonly port: string;
  readonly expr: SvExpr | undefined;  // undefined for implicit (.name)
}

/**
 * Module instance
 */
export interface SvInstance {
  readonly kind: 'SvInstance';
  readonly instanceName: string;
  readonly moduleName: string;
  readonly parameters: SvConnection[];
  readonly connections: SvConnection[];
}

// ==================== Type Definitions ====================

/**
 * Enum member
 */
export interface SvEnumMember {
  readonly name: string;
  readonly value: SvExpr | undefined;
}

/**
 * Enum definition (typedef enum)
 */
export interface SvEnumDef {
  readonly kind: 'SvEnumDef';
  readonly name: string;
  readonly baseType: SvDataType | undefined;  // logic [N-1:0]
  readonly members: SvEnumMember[];
}

/**
 * Struct field
 */
export interface SvStructField {
  readonly name: string;
  readonly dataType: SvDataType;
}

/**
 * Struct definition (typedef struct packed)
 */
export interface SvStructDef {
  readonly kind: 'SvStructDef';
  readonly name: string;
  readonly fields: SvStructField[];
  readonly isPacked: boolean;
}

/**
 * Type alias (typedef)
 */
export interface SvTypeDef {
  readonly kind: 'SvTypeDef';
  readonly name: string;
  readonly aliasedType: SvDataType;
}

// ==================== Functions and Tasks ====================

/**
 * Function/task argument
 */
export interface SvFunctionArg {
  readonly name: string;
  readonly dataType: SvDataType;
  readonly direction: 'input' | 'output' | 'inout' | 'ref';
}

/**
 * Function definition
 */
export interface SvFunction {
  readonly kind: 'SvFunction';
  readonly name: string;
  readonly returnType: SvDataType;
  readonly args: SvFunctionArg[];
  readonly body: SvStmt;
  readonly isAutomatic: boolean;
}

/**
 * Task definition
 */
export interface SvTask {
  readonly kind: 'SvTask';
  readonly name: string;
  readonly args: SvFunctionArg[];
  readonly body: SvStmt;
  readonly isAutomatic: boolean;
}

// ==================== Generate ====================

/**
 * Generate for block
 */
export interface SvGenerateFor {
  readonly kind: 'SvGenerateFor';
  readonly genvar: string;
  readonly init: SvExpr;
  readonly condition: SvExpr;
  readonly update: SvExpr;
  readonly label: string;
  readonly body: SvModuleItem[];
}

/**
 * Generate if block
 */
export interface SvGenerateIf {
  readonly kind: 'SvGenerateIf';
  readonly condition: SvExpr;
  readonly thenItems: SvModuleItem[];
  readonly elseItems: SvModuleItem[];
  readonly label: string | undefined;
}

// ==================== Module Items ====================

/**
 * Module item (things that go inside a module)
 */
export type SvModuleItem =
  | SvParameter
  | SvPort
  | SvSignal
  | SvAlwaysBlock
  | SvInitialBlock
  | SvAssign
  | SvInstance
  | SvEnumDef
  | SvStructDef
  | SvTypeDef
  | SvFunction
  | SvTask
  | SvGenerateFor
  | SvGenerateIf;

// ==================== Module ====================

/**
 * SystemVerilog module
 */
export interface SvModule {
  readonly kind: 'SvModule';
  readonly name: string;
  readonly parameters: SvParameter[];
  readonly ports: SvPort[];
  readonly items: SvModuleItem[];
}

// ==================== Source File ====================

/**
 * SystemVerilog source file
 */
export interface SvSourceFile {
  readonly kind: 'SvSourceFile';
  readonly timescale: string | undefined;  // e.g., "1ns/1ps"
  readonly modules: SvModule[];
  readonly typeDefs: (SvEnumDef | SvStructDef | SvTypeDef)[];  // Top-level typedefs
}

// ==================== Helper Functions ====================

/**
 * Create a parameter
 */
export function parameter(
  name: string,
  defaultValue?: SvExpr,
  dataType?: SvDataType,
  isLocal = false
): SvParameter {
  return {
    kind: 'SvParameter',
    name,
    dataType,
    defaultValue,
    isLocal,
  };
}

/**
 * Create a localparam
 */
export function localparam(name: string, value: SvExpr, dataType?: SvDataType): SvParameter {
  return parameter(name, value, dataType, true);
}

/**
 * Create a port
 */
export function port(
  name: string,
  direction: SvPortDirection,
  dataType: SvDataType,
  isReg = false
): SvPort {
  return {
    kind: 'SvPort',
    name,
    direction,
    dataType,
    isReg,
  };
}

/**
 * Create a signal
 */
export function signal(
  name: string,
  dataType: SvDataType,
  initialValue?: SvExpr
): SvSignal {
  return {
    kind: 'SvSignal',
    name,
    dataType,
    initialValue,
  };
}

/**
 * Create an edge sensitivity
 */
export function edgeSensitivity(edge: SvEdge, signalName: string): SvEdgeSensitivity {
  return { kind: 'SvEdgeSensitivity', edge, signal: signalName };
}

/**
 * Create an always_comb block
 */
export function alwaysComb(body: SvStmt): SvAlwaysBlock {
  return {
    kind: 'SvAlwaysBlock',
    alwaysType: 'always_comb',
    sensitivity: [],
    body,
  };
}

/**
 * Create an always_ff block
 */
export function alwaysFf(sensitivity: SvSensitivity[], body: SvStmt): SvAlwaysBlock {
  return {
    kind: 'SvAlwaysBlock',
    alwaysType: 'always_ff',
    sensitivity,
    body,
  };
}

/**
 * Create an always block
 */
export function always(sensitivity: SvSensitivity[], body: SvStmt): SvAlwaysBlock {
  return {
    kind: 'SvAlwaysBlock',
    alwaysType: 'always',
    sensitivity,
    body,
  };
}

/**
 * Create an initial block
 */
export function initial(body: SvStmt): SvInitialBlock {
  return { kind: 'SvInitialBlock', body };
}

/**
 * Create a continuous assignment
 */
export function assign(lhs: SvExpr, rhs: SvExpr, delay?: SvExpr): SvAssign {
  return { kind: 'SvAssign', lhs, rhs, delay };
}

/**
 * Create a port connection
 */
export function connection(portName: string, expr?: SvExpr): SvConnection {
  return { port: portName, expr };
}

/**
 * Create a module instance
 */
export function instance(
  instanceName: string,
  moduleName: string,
  connections: SvConnection[],
  parameters: SvConnection[] = []
): SvInstance {
  return {
    kind: 'SvInstance',
    instanceName,
    moduleName,
    parameters,
    connections,
  };
}

/**
 * Create an enum definition
 */
export function enumDef(
  name: string,
  members: (string | { name: string; value: SvExpr })[],
  baseType?: SvDataType
): SvEnumDef {
  return {
    kind: 'SvEnumDef',
    name,
    baseType,
    members: members.map(m =>
      typeof m === 'string'
        ? { name: m, value: undefined }
        : { name: m.name, value: m.value }
    ),
  };
}

/**
 * Create a struct definition
 */
export function structDef(
  name: string,
  fields: { name: string; dataType: SvDataType }[],
  isPacked = true
): SvStructDef {
  return {
    kind: 'SvStructDef',
    name,
    fields,
    isPacked,
  };
}

/**
 * Create a function definition
 */
export function functionDef(
  name: string,
  returnType: SvDataType,
  args: SvFunctionArg[],
  body: SvStmt,
  isAutomatic = true
): SvFunction {
  return {
    kind: 'SvFunction',
    name,
    returnType,
    args,
    body,
    isAutomatic,
  };
}

/**
 * Create a module
 */
export function svModule(
  name: string,
  parameters: SvParameter[] = [],
  ports: SvPort[] = [],
  items: SvModuleItem[] = []
): SvModule {
  return {
    kind: 'SvModule',
    name,
    parameters,
    ports,
    items,
  };
}

/**
 * Create a source file
 */
export function svSourceFile(
  modules: SvModule[],
  typeDefs: (SvEnumDef | SvStructDef | SvTypeDef)[] = [],
  timescale?: string
): SvSourceFile {
  return {
    kind: 'SvSourceFile',
    timescale,
    modules,
    typeDefs,
  };
}
