/**
 * HIR Module and Top-level Structures
 *
 * Represents modules and their components in the intermediate representation.
 */

import type { HirDataType, HirEnumType } from './types.js';
import type { HirExpr } from './expr.js';
import type { HirStmt } from './stmt.js';

// ==================== Parameters ====================

/**
 * HIR Parameter (maps to SV parameter)
 */
export interface HirParameter {
  readonly kind: 'HirParameter';
  readonly name: string;
  readonly dataType: HirDataType;
  readonly defaultValue: HirExpr | undefined;
}

// ==================== Ports ====================

/**
 * Port direction
 */
export type HirPortDirection = 'input' | 'output' | 'inout';

/**
 * HIR Port
 */
export interface HirPort {
  readonly kind: 'HirPort';
  readonly name: string;
  readonly direction: HirPortDirection;
  readonly dataType: HirDataType;
  readonly isReg: boolean;  // output reg in SV
}

// ==================== Signals ====================

/**
 * HIR Signal (internal wire/reg)
 */
export interface HirSignal {
  readonly kind: 'HirSignal';
  readonly name: string;
  readonly dataType: HirDataType;
  readonly isReg: boolean;
  readonly initialValue: HirExpr | undefined;
}

// ==================== Clock/Reset Spec ====================

/**
 * Clock edge specification
 */
export type HirClockEdge = 'posedge' | 'negedge';

/**
 * Clock specification
 */
export interface HirClockSpec {
  readonly signal: string;
  readonly edge: HirClockEdge;
}

/**
 * Reset mode
 */
export type HirResetMode = 'sync' | 'async';

/**
 * Reset specification
 */
export interface HirResetSpec {
  readonly signal: string;
  readonly activeHigh: boolean;
  readonly mode: HirResetMode;
}

// ==================== Logic Blocks ====================

/**
 * Combinational logic block (maps to always_comb)
 */
export interface HirCombBlock {
  readonly kind: 'HirCombBlock';
  readonly statements: HirStmt[];
}

/**
 * Sequential logic block (maps to always_ff)
 */
export interface HirSeqBlock {
  readonly kind: 'HirSeqBlock';
  readonly clock: HirClockSpec;
  readonly reset: HirResetSpec | undefined;
  readonly statements: HirStmt[];
  readonly resetStatements: HirStmt[];  // Statements for reset condition
}

/**
 * Initial block (maps to initial begin/end in testbenches)
 */
export interface HirInitialBlock {
  readonly kind: 'HirInitialBlock';
  readonly statements: HirStmt[];
}

/**
 * Testbench sequential block (maps to initial block with time control)
 */
export interface HirTestSeqBlock {
  readonly kind: 'HirTestSeqBlock';
  readonly name: string | undefined;
  readonly statements: HirTestSeqStmt[];
}

/**
 * Testbench sequential statement
 */
export type HirTestSeqStmt =
  | HirDelayStmt
  | HirAwaitStmt
  | HirAssertStmt
  | HirStmt;

/**
 * Delay statement (#time)
 */
export interface HirDelayStmt {
  readonly kind: 'HirDelayStmt';
  readonly delay: number;
  readonly unit: 'ns' | 'us' | 'ms' | 's';
}

/**
 * Await statement (wait for clock edge, condition, etc.)
 */
export interface HirAwaitStmt {
  readonly kind: 'HirAwaitStmt';
  readonly awaitType: 'clock_edge' | 'until' | 'event';
  readonly signal: string | undefined;
  readonly edge: HirClockEdge | undefined;
  readonly cycles: number | undefined;
  readonly condition: HirExpr | undefined;
}

/**
 * Assert statement
 */
export interface HirAssertStmt {
  readonly kind: 'HirAssertStmt';
  readonly condition: HirExpr;
  readonly message: string | undefined;
}

// ==================== FSM ====================

/**
 * FSM state
 */
export interface HirFsmState {
  readonly name: string;
  readonly mooreOutputs: HirFsmOutput[];  // Outputs defined for this state
}

/**
 * FSM output assignment
 */
export interface HirFsmOutput {
  readonly signal: string;
  readonly value: HirExpr;
}

/**
 * FSM transition condition
 */
export interface HirTransitionCondition {
  readonly condition: HirExpr;
  readonly targetState: string;
  readonly actions: HirStmt[];
}

/**
 * FSM transition (from one state)
 */
export interface HirTransition {
  readonly fromState: string;
  readonly conditions: HirTransitionCondition[];
  readonly defaultTarget: string | undefined;  // If no condition matches
}

/**
 * FSM Mealy output (depends on state AND input)
 */
export interface HirMealyOutput {
  readonly state: string;
  readonly condition: HirExpr;
  readonly signal: string;
  readonly value: HirExpr;
}

/**
 * FSM block
 */
export interface HirFsm {
  readonly kind: 'HirFsm';
  readonly name: string;
  readonly clock: HirClockSpec;
  readonly reset: HirResetSpec | undefined;
  readonly stateType: HirEnumType;
  readonly initialState: string;
  readonly states: HirFsmState[];
  readonly transitions: HirTransition[];
  readonly mealyOutputs: HirMealyOutput[];
}

// ==================== Instances ====================

/**
 * Port connection
 */
export interface HirConnection {
  readonly port: string;
  readonly expr: HirExpr;
}

/**
 * Module instance
 */
export interface HirInstance {
  readonly kind: 'HirInstance';
  readonly name: string;
  readonly module: string;
  readonly parameters: HirConnection[];
  readonly connections: HirConnection[];
}

// ==================== Functions ====================

/**
 * Function parameter
 */
export interface HirFunctionParam {
  readonly name: string;
  readonly dataType: HirDataType;
}

/**
 * Function definition
 */
export interface HirFunction {
  readonly kind: 'HirFunction';
  readonly name: string;
  readonly params: HirFunctionParam[];
  readonly returnType: HirDataType;
  readonly body: HirStmt[];
}

// ==================== Type Definitions ====================

/**
 * Type definition (enum or struct)
 */
export type HirTypeDef = HirEnumDef | HirStructDef;

/**
 * Enum definition
 */
export interface HirEnumDef {
  readonly kind: 'HirEnumDef';
  readonly name: string;
  readonly type: HirEnumType;
}

/**
 * Struct definition
 */
export interface HirStructDef {
  readonly kind: 'HirStructDef';
  readonly name: string;
  readonly fields: HirStructFieldDef[];
}

/**
 * Struct field definition
 */
export interface HirStructFieldDef {
  readonly name: string;
  readonly type: HirDataType;
}

// ==================== Module ====================

/**
 * HIR Module
 */
export interface HirModule {
  readonly kind: 'HirModule';
  readonly name: string;
  readonly isPublic: boolean;
  readonly isTestbench: boolean;  // true for test mod (testbench)
  readonly parameters: HirParameter[];
  readonly ports: HirPort[];
  readonly typeDefs: HirTypeDef[];
  readonly signals: HirSignal[];
  readonly instances: HirInstance[];
  readonly combBlocks: HirCombBlock[];
  readonly seqBlocks: HirSeqBlock[];
  readonly initialBlocks: HirInitialBlock[];
  readonly testSeqBlocks: HirTestSeqBlock[];
  readonly fsms: HirFsm[];
  readonly functions: HirFunction[];
}

// ==================== Source File ====================

/**
 * HIR source file (collection of modules and type definitions)
 */
export interface HirSourceFile {
  readonly kind: 'HirSourceFile';
  readonly modules: HirModule[];
  readonly typeDefs: HirTypeDef[];
  readonly functions: HirFunction[];
}

// ==================== Helper Functions ====================

/**
 * Create a parameter
 */
export function createParameter(
  name: string,
  dataType: HirDataType,
  defaultValue?: HirExpr
): HirParameter {
  return {
    kind: 'HirParameter',
    name,
    dataType,
    defaultValue,
  };
}

/**
 * Create a port
 */
export function createPort(
  name: string,
  direction: HirPortDirection,
  dataType: HirDataType,
  isReg = false
): HirPort {
  return {
    kind: 'HirPort',
    name,
    direction,
    dataType,
    isReg,
  };
}

/**
 * Create a signal
 */
export function createSignal(
  name: string,
  dataType: HirDataType,
  isReg = false,
  initialValue?: HirExpr
): HirSignal {
  return {
    kind: 'HirSignal',
    name,
    dataType,
    isReg,
    initialValue,
  };
}

/**
 * Create a clock specification
 */
export function createClockSpec(signal: string, edge: HirClockEdge = 'posedge'): HirClockSpec {
  return { signal, edge };
}

/**
 * Create a reset specification
 */
export function createResetSpec(
  signal: string,
  activeHigh = true,
  mode: HirResetMode = 'async'
): HirResetSpec {
  return { signal, activeHigh, mode };
}

/**
 * Create a combinational block
 */
export function createCombBlock(statements: HirStmt[]): HirCombBlock {
  return {
    kind: 'HirCombBlock',
    statements,
  };
}

/**
 * Create a sequential block
 */
export function createSeqBlock(
  clock: HirClockSpec,
  reset: HirResetSpec | undefined,
  statements: HirStmt[],
  resetStatements: HirStmt[] = []
): HirSeqBlock {
  return {
    kind: 'HirSeqBlock',
    clock,
    reset,
    statements,
    resetStatements,
  };
}

/**
 * Create an FSM
 */
export function createFsm(
  name: string,
  clock: HirClockSpec,
  reset: HirResetSpec | undefined,
  stateType: HirEnumType,
  initialState: string,
  states: HirFsmState[],
  transitions: HirTransition[],
  mealyOutputs: HirMealyOutput[] = []
): HirFsm {
  return {
    kind: 'HirFsm',
    name,
    clock,
    reset,
    stateType,
    initialState,
    states,
    transitions,
    mealyOutputs,
  };
}

/**
 * Create a module instance
 */
export function createInstance(
  name: string,
  module: string,
  connections: HirConnection[],
  parameters: HirConnection[] = []
): HirInstance {
  return {
    kind: 'HirInstance',
    name,
    module,
    parameters,
    connections,
  };
}

/**
 * Create a function
 */
export function createFunction(
  name: string,
  params: HirFunctionParam[],
  returnType: HirDataType,
  body: HirStmt[]
): HirFunction {
  return {
    kind: 'HirFunction',
    name,
    params,
    returnType,
    body,
  };
}

/**
 * Create an initial block
 */
export function createInitialBlock(statements: HirStmt[]): HirInitialBlock {
  return {
    kind: 'HirInitialBlock',
    statements,
  };
}

/**
 * Create a testbench sequential block
 */
export function createTestSeqBlock(
  name: string | undefined,
  statements: HirTestSeqStmt[]
): HirTestSeqBlock {
  return {
    kind: 'HirTestSeqBlock',
    name,
    statements,
  };
}

/**
 * Create a delay statement
 */
export function createDelayStmt(
  delay: number,
  unit: 'ns' | 'us' | 'ms' | 's' = 'ns'
): HirDelayStmt {
  return {
    kind: 'HirDelayStmt',
    delay,
    unit,
  };
}

/**
 * Create an await statement
 */
export function createAwaitStmt(
  awaitType: 'clock_edge' | 'until' | 'event',
  options: {
    signal?: string;
    edge?: HirClockEdge;
    cycles?: number;
    condition?: HirExpr;
  } = {}
): HirAwaitStmt {
  return {
    kind: 'HirAwaitStmt',
    awaitType,
    signal: options.signal,
    edge: options.edge,
    cycles: options.cycles,
    condition: options.condition,
  };
}

/**
 * Create an assert statement
 */
export function createAssertStmt(
  condition: HirExpr,
  message?: string
): HirAssertStmt {
  return {
    kind: 'HirAssertStmt',
    condition,
    message,
  };
}

/**
 * Create an empty module
 */
export function createModule(name: string, isPublic = false, isTestbench = false): HirModule {
  return {
    kind: 'HirModule',
    name,
    isPublic,
    isTestbench,
    parameters: [],
    ports: [],
    typeDefs: [],
    signals: [],
    instances: [],
    combBlocks: [],
    seqBlocks: [],
    initialBlocks: [],
    testSeqBlocks: [],
    fsms: [],
    functions: [],
  };
}

/**
 * Create a source file
 */
export function createSourceFile(
  modules: HirModule[] = [],
  typeDefs: HirTypeDef[] = [],
  functions: HirFunction[] = []
): HirSourceFile {
  return {
    kind: 'HirSourceFile',
    modules,
    typeDefs,
    functions,
  };
}
