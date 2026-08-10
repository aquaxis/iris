/**
 * SystemVerilog Code Emitter
 *
 * Converts SV AST nodes to SystemVerilog source code.
 */

import type {
  SvDataType,
  SvWidth,
  SvLogicType,
  SvRegType,
  SvWireType,
  SvArrayType,
  SvPackedArrayType,
} from './types.js';

import type {
  SvExpr,
  SvLiteral,
  SvIntLiteral,
  SvUnaryExpr,
  SvBinaryExpr,
} from './expr.js';

import type {
  SvStmt,
  SvCaseItem,
  SvBlockStmt,
} from './stmt.js';

import type {
  SvModule,
  SvModuleItem,
  SvParameter,
  SvPort,
  SvSignal,
  SvAlwaysBlock,
  SvInitialBlock,
  SvAssign,
  SvInstance,
  SvEnumDef,
  SvStructDef,
  SvUnionDef,
  SvInterface,
  SvTypeDef,
  SvFunction,
  SvTask,
  SvGenerateFor,
  SvGenerateIf,
  SvSensitivity,
  SvFunctionArg,
  SvSourceFile,
} from './module.js';

/**
 * Emitter options
 */
export interface EmitterOptions {
  /** Indentation string (default: 2 spaces) */
  indent: string;
  /** Line ending (default: '\n') */
  lineEnding: string;
  /** Align port declarations */
  alignPorts: boolean;
  /** Align signal declarations */
  alignSignals: boolean;
  /** Use SystemVerilog-2012 syntax */
  sv2012: boolean;
}

/**
 * Default emitter options
 */
export const defaultEmitterOptions: EmitterOptions = {
  indent: '  ',
  lineEnding: '\n',
  alignPorts: true,
  alignSignals: true,
  sv2012: true,
};

/**
 * SystemVerilog Code Emitter
 */
export class SvEmitter {
  private readonly options: EmitterOptions;
  private output: string[];
  private indentLevel: number;

  constructor(options?: Partial<EmitterOptions>) {
    this.options = { ...defaultEmitterOptions, ...options };
    this.output = [];
    this.indentLevel = 0;
  }

  // ==================== Main Entry Points ====================

  /**
   * Emit a source file
   */
  emitSourceFile(sourceFile: SvSourceFile): string {
    this.reset();

    // Timescale
    if (sourceFile.timescale) {
      this.writeLine(`\`timescale ${sourceFile.timescale}`);
      this.writeLine('');
    }

    // Top-level type definitions
    for (const typeDef of sourceFile.typeDefs) {
      this.emitTypeDef(typeDef);
      this.writeLine('');
    }

    // Modules
    for (let i = 0; i < sourceFile.modules.length; i++) {
      if (i > 0) this.writeLine('');
      this.emitModule(sourceFile.modules[i]!);
    }

    return this.getOutput();
  }

  /** `interface Name; ... endinterface` */
  emitInterfaceStandalone(iface: SvInterface): string {
    this.reset();
    this.writeIndent();
    this.write('interface ');
    this.write(iface.name);
    this.writeLine(';');
    this.indentLevel++;

    for (const signal of iface.signals) {
      this.emitSignal(signal);
    }

    for (const modport of iface.modports) {
      this.writeLine('');
      this.writeIndent();
      this.write('modport ');
      this.write(modport.name);
      this.write(' (');
      this.write(
        modport.signals.map((s) => `${s.direction} ${s.name}`).join(', ')
      );
      this.writeLine(');');
    }

    this.indentLevel--;
    this.writeIndent();
    this.writeLine('endinterface');
    return this.getOutput();
  }

  /**
   * Emit one module item on its own, for a declaration that sits outside any
   * module.
   */
  emitModuleItemStandalone(item: SvModuleItem): string {
    this.reset();
    this.emitModuleItem(item);
    return this.getOutput();
  }

  /**
   * Emit a module
   */
  emitModule(module: SvModule): string {
    this.reset();
    this.emitModuleInternal(module);
    return this.getOutput();
  }

  /**
   * Emit an expression
   */
  emitExpr(expr: SvExpr): string {
    return this.emitExprInternal(expr);
  }

  /**
   * Emit a statement
   */
  emitStmt(stmt: SvStmt): string {
    this.reset();
    this.emitStmtInternal(stmt);
    return this.getOutput();
  }

  /**
   * Emit a data type
   */
  emitDataType(dataType: SvDataType): string {
    return this.emitDataTypeInternal(dataType);
  }

  // ==================== Module Emission ====================

  private emitModuleInternal(module: SvModule): void {
    // Module header
    this.write('module ');
    this.write(module.name);

    // Parameters
    if (module.parameters.length > 0) {
      this.write(' #(');
      this.writeLine('');
      this.indentLevel++;
      this.emitParameters(module.parameters);
      this.indentLevel--;
      this.write(')');
    }

    // Ports
    if (module.ports.length > 0) {
      this.write(' (');
      this.writeLine('');
      this.indentLevel++;
      this.emitPorts(module.ports);
      this.indentLevel--;
      this.write(')');
    }

    this.writeLine(';');

    // Module items
    this.indentLevel++;

    // Group items by type for better organization
    const signals: SvSignal[] = [];
    const typeDefs: (SvEnumDef | SvStructDef | SvUnionDef | SvTypeDef)[] = [];
    const alwaysBlocks: SvAlwaysBlock[] = [];
    const initialBlocks: SvInitialBlock[] = [];
    const assigns: SvAssign[] = [];
    const instances: SvInstance[] = [];
    const functions: SvFunction[] = [];
    const tasks: SvTask[] = [];
    const generates: (SvGenerateFor | SvGenerateIf)[] = [];

    for (const item of module.items) {
      switch (item.kind) {
        case 'SvSignal':
          signals.push(item);
          break;
        case 'SvEnumDef':
        case 'SvStructDef':
        case 'SvUnionDef':
        case 'SvTypeDef':
          typeDefs.push(item);
          break;
        case 'SvAlwaysBlock':
          alwaysBlocks.push(item);
          break;
        case 'SvInitialBlock':
          initialBlocks.push(item);
          break;
        case 'SvAssign':
          assigns.push(item);
          break;
        case 'SvInstance':
          instances.push(item);
          break;
        case 'SvFunction':
          functions.push(item);
          break;
        case 'SvTask':
          tasks.push(item);
          break;
        case 'SvGenerateFor':
        case 'SvGenerateIf':
          generates.push(item);
          break;
        case 'SvParameter':
        case 'SvPort':
          // These are handled separately
          break;
        default: {
          const _exhaustive: never = item;
          throw new Error(`Unknown module item: ${(_exhaustive as SvModuleItem).kind}`);
        }
      }
    }

    // Emit type definitions
    if (typeDefs.length > 0) {
      this.writeLine('');
      this.writeLine('// Type definitions');
      for (const typeDef of typeDefs) {
        this.emitTypeDef(typeDef);
      }
    }

    // Emit signals
    if (signals.length > 0) {
      this.writeLine('');
      this.writeLine('// Internal signals');
      for (const sig of signals) {
        this.emitSignal(sig);
      }
    }

    // Emit functions
    if (functions.length > 0) {
      this.writeLine('');
      for (const fn of functions) {
        this.emitFunction(fn);
        this.writeLine('');
      }
    }

    // Emit tasks
    if (tasks.length > 0) {
      for (const task of tasks) {
        this.emitTask(task);
        this.writeLine('');
      }
    }

    // Emit continuous assignments
    if (assigns.length > 0) {
      this.writeLine('');
      this.writeLine('// Continuous assignments');
      for (const assign of assigns) {
        this.emitAssign(assign);
      }
    }

    // Emit always blocks
    if (alwaysBlocks.length > 0) {
      this.writeLine('');
      for (const block of alwaysBlocks) {
        this.emitAlwaysBlock(block);
        this.writeLine('');
      }
    }

    // Emit initial blocks
    if (initialBlocks.length > 0) {
      for (const block of initialBlocks) {
        this.emitInitialBlock(block);
        this.writeLine('');
      }
    }

    // Emit generate blocks
    if (generates.length > 0) {
      for (const gen of generates) {
        this.emitGenerate(gen);
        this.writeLine('');
      }
    }

    // Emit instances
    if (instances.length > 0) {
      this.writeLine('');
      this.writeLine('// Module instances');
      for (const inst of instances) {
        this.emitInstance(inst);
        this.writeLine('');
      }
    }

    this.indentLevel--;
    this.writeLine('endmodule');
  }

  // ==================== Parameters ====================

  private emitParameters(params: SvParameter[]): void {
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      this.writeIndent();
      this.write(param.isLocal ? 'localparam ' : 'parameter ');

      if (param.dataType) {
        this.write(this.emitDataTypeInternal(param.dataType));
        this.write(' ');
      }

      this.write(param.name);

      if (param.defaultValue) {
        this.write(' = ');
        this.write(this.emitExprInternal(param.defaultValue));
      }

      if (i < params.length - 1) {
        this.write(',');
      }
      this.writeLine('');
    }
  }

  // ==================== Ports ====================

  private emitPorts(ports: SvPort[]): void {
    // Calculate alignment widths if needed
    let maxDirLen = 0;
    let maxTypeLen = 0;

    if (this.options.alignPorts) {
      for (const port of ports) {
        const dirStr = port.direction + (port.isReg ? ' reg' : '');
        maxDirLen = Math.max(maxDirLen, dirStr.length);
        maxTypeLen = Math.max(maxTypeLen, this.emitDataTypeInternal(port.dataType).length);
      }
    }

    for (let i = 0; i < ports.length; i++) {
      const port = ports[i]!;
      this.writeIndent();

      const dirStr = port.direction + (port.isReg ? ' reg' : '');
      this.write(dirStr);

      if (this.options.alignPorts) {
        this.write(' '.repeat(maxDirLen - dirStr.length + 1));
      } else {
        this.write(' ');
      }

      const typeStr = this.emitDataTypeInternal(port.dataType);
      this.write(typeStr);

      if (this.options.alignPorts) {
        this.write(' '.repeat(maxTypeLen - typeStr.length + 1));
      } else {
        this.write(' ');
      }

      this.write(port.name);

      if (i < ports.length - 1) {
        this.write(',');
      }
      this.writeLine('');
    }
  }

  // ==================== Signals ====================

  private emitSignal(signal: SvSignal): void {
    this.writeIndent();

    if (signal.dataType.kind === 'SvArrayType') {
      // An unpacked array carries its dimensions after the name:
      //   logic [Width-1:0] storage [Depth];
      this.write(this.emitDataTypeInternal(signal.dataType.elementType));
      this.write(' ');
      this.write(signal.name);
      for (const dim of signal.dataType.dimensions) {
        this.write(` [${this.emitWidthValue(dim)}]`);
      }
    } else {
      this.write(this.emitDataTypeInternal(signal.dataType));
      this.write(' ');
      this.write(signal.name);
    }

    if (signal.initialValue) {
      this.write(' = ');
      this.write(this.emitExprInternal(signal.initialValue));
    }

    this.writeLine(';');
  }

  // ==================== Type Definitions ====================

  private emitTypeDef(typeDef: SvEnumDef | SvStructDef | SvUnionDef | SvTypeDef): void {
    switch (typeDef.kind) {
      case 'SvEnumDef':
        this.emitEnumDef(typeDef);
        break;
      case 'SvStructDef':
        this.emitStructDef(typeDef);
        break;
      case 'SvUnionDef':
        this.emitUnionDef(typeDef);
        break;
      case 'SvTypeDef':
        this.emitTypeAlias(typeDef);
        break;
    }
  }

  private emitUnionDef(unionDef: SvUnionDef): void {
    this.writeIndent();
    this.write('typedef union ');
    if (unionDef.isPacked) {
      this.write('packed ');
    }
    this.write('{');
    this.writeLine('');
    this.indentLevel++;

    for (const field of unionDef.fields) {
      this.writeIndent();
      this.write(this.emitDataTypeInternal(field.dataType));
      this.write(' ');
      this.write(field.name);
      this.writeLine(';');
    }

    this.indentLevel--;
    this.writeIndent();
    this.write('} ');
    this.write(unionDef.name);
    this.writeLine(';');
  }

  private emitEnumDef(enumDef: SvEnumDef): void {
    this.writeIndent();
    this.write('typedef enum ');

    if (enumDef.baseType) {
      this.write(this.emitDataTypeInternal(enumDef.baseType));
      this.write(' ');
    }

    this.write('{');
    this.writeLine('');
    this.indentLevel++;

    for (let i = 0; i < enumDef.members.length; i++) {
      const member = enumDef.members[i]!;
      this.writeIndent();
      this.write(member.name);

      if (member.value) {
        this.write(' = ');
        this.write(this.emitExprInternal(member.value));
      }

      if (i < enumDef.members.length - 1) {
        this.write(',');
      }
      this.writeLine('');
    }

    this.indentLevel--;
    this.writeIndent();
    this.write('} ');
    this.write(enumDef.name);
    this.writeLine(';');
  }

  private emitStructDef(structDef: SvStructDef): void {
    this.writeIndent();
    this.write('typedef struct ');
    if (structDef.isPacked) {
      this.write('packed ');
    }
    this.write('{');
    this.writeLine('');
    this.indentLevel++;

    for (const field of structDef.fields) {
      this.writeIndent();
      this.write(this.emitDataTypeInternal(field.dataType));
      this.write(' ');
      this.write(field.name);
      this.writeLine(';');
    }

    this.indentLevel--;
    this.writeIndent();
    this.write('} ');
    this.write(structDef.name);
    this.writeLine(';');
  }

  private emitTypeAlias(typeDef: SvTypeDef): void {
    this.writeIndent();
    this.write('typedef ');
    this.write(this.emitDataTypeInternal(typeDef.aliasedType));
    this.write(' ');
    this.write(typeDef.name);
    this.writeLine(';');
  }

  // ==================== Always Blocks ====================

  private emitAlwaysBlock(block: SvAlwaysBlock): void {
    this.writeIndent();

    switch (block.alwaysType) {
      case 'always_comb':
        this.write('always_comb');
        break;
      case 'always_ff':
        this.write('always_ff @(');
        this.write(this.emitSensitivityList(block.sensitivity));
        this.write(')');
        break;
      case 'always_latch':
        this.write('always_latch');
        break;
      case 'always':
        if (block.sensitivity.length > 0) {
          this.write('always @(');
          this.write(this.emitSensitivityList(block.sensitivity));
          this.write(')');
        } else {
          this.write('always');
        }
        break;
    }

    this.write(' ');
    this.emitStmtInline(block.body);
  }

  private emitSensitivityList(sensitivity: SvSensitivity[]): string {
    const parts: string[] = [];

    for (const item of sensitivity) {
      switch (item.kind) {
        case 'SvEdgeSensitivity':
          parts.push(`${item.edge} ${item.signal}`);
          break;
        case 'SvLevelSensitivity':
          parts.push(item.signal);
          break;
        case 'SvAllSensitivity':
          parts.push('*');
          break;
      }
    }

    return parts.join(' or ');
  }

  // ==================== Initial Block ====================

  private emitInitialBlock(block: SvInitialBlock): void {
    this.writeIndent();
    this.write('initial ');
    this.emitStmtInline(block.body);
  }

  // ==================== Continuous Assignment ====================

  private emitAssign(assign: SvAssign): void {
    this.writeIndent();
    this.write('assign ');

    if (assign.delay) {
      this.write('#(');
      this.write(this.emitExprInternal(assign.delay));
      this.write(') ');
    }

    this.write(this.emitExprInternal(assign.lhs));
    this.write(' = ');
    this.write(this.emitExprInternal(assign.rhs));
    this.writeLine(';');
  }

  // ==================== Instances ====================

  private emitInstance(instance: SvInstance): void {
    this.writeIndent();
    this.write(instance.moduleName);

    // Parameters
    if (instance.parameters.length > 0) {
      this.write(' #(');
      this.writeLine('');
      this.indentLevel++;

      for (let i = 0; i < instance.parameters.length; i++) {
        const param = instance.parameters[i]!;
        this.writeIndent();
        this.write('.');
        this.write(param.port);
        this.write('(');
        if (param.expr) {
          this.write(this.emitExprInternal(param.expr));
        }
        this.write(')');

        if (i < instance.parameters.length - 1) {
          this.write(',');
        }
        this.writeLine('');
      }

      this.indentLevel--;
      this.writeIndent();
      this.write(')');
    }

    this.write(' ');
    this.write(instance.instanceName);
    this.write(' (');
    this.writeLine('');
    this.indentLevel++;

    // Port connections
    for (let i = 0; i < instance.connections.length; i++) {
      const conn = instance.connections[i]!;
      this.writeIndent();
      this.write('.');
      this.write(conn.port);
      this.write('(');
      if (conn.expr) {
        this.write(this.emitExprInternal(conn.expr));
      }
      this.write(')');

      if (i < instance.connections.length - 1) {
        this.write(',');
      }
      this.writeLine('');
    }

    this.indentLevel--;
    this.writeIndent();
    this.writeLine(');');
  }

  // ==================== Functions and Tasks ====================

  private emitFunction(fn: SvFunction): void {
    this.writeIndent();
    this.write('function ');
    if (fn.isAutomatic) {
      this.write('automatic ');
    }
    this.write(this.emitDataTypeInternal(fn.returnType));
    this.write(' ');
    this.write(fn.name);
    this.write('(');

    for (let i = 0; i < fn.args.length; i++) {
      if (i > 0) this.write(', ');
      this.emitFunctionArg(fn.args[i]!);
    }

    this.write(')');
    this.writeLine(';');

    this.indentLevel++;
    this.emitStmtInternal(fn.body);
    this.indentLevel--;

    this.writeIndent();
    this.writeLine('endfunction');
  }

  private emitTask(task: SvTask): void {
    this.writeIndent();
    this.write('task ');
    if (task.isAutomatic) {
      this.write('automatic ');
    }
    this.write(task.name);
    this.write('(');

    for (let i = 0; i < task.args.length; i++) {
      if (i > 0) this.write(', ');
      this.emitFunctionArg(task.args[i]!);
    }

    this.write(')');
    this.writeLine(';');

    this.indentLevel++;
    this.emitStmtInternal(task.body);
    this.indentLevel--;

    this.writeIndent();
    this.writeLine('endtask');
  }

  private emitFunctionArg(arg: SvFunctionArg): void {
    this.write(arg.direction);
    this.write(' ');
    this.write(this.emitDataTypeInternal(arg.dataType));
    this.write(' ');
    this.write(arg.name);
  }

  // ==================== Generate Blocks ====================

  private emitGenerate(gen: SvGenerateFor | SvGenerateIf): void {
    switch (gen.kind) {
      case 'SvGenerateFor':
        this.emitGenerateFor(gen);
        break;
      case 'SvGenerateIf':
        this.emitGenerateIf(gen);
        break;
    }
  }

  private emitGenerateFor(gen: SvGenerateFor): void {
    this.writeIndent();
    this.write('for (genvar ');
    this.write(gen.genvar);
    this.write(' = ');
    this.write(this.emitExprInternal(gen.init));
    this.write('; ');
    this.write(this.emitExprInternal(gen.condition));
    this.write('; ');
    this.write(gen.genvar);
    this.write(' = ');
    this.write(this.emitExprInternal(gen.update));
    this.write(') begin : ');
    this.write(gen.label);
    this.writeLine('');

    this.indentLevel++;
    for (const item of gen.body) {
      this.emitModuleItem(item);
    }
    this.indentLevel--;

    this.writeIndent();
    this.writeLine('end');
  }

  private emitGenerateIf(gen: SvGenerateIf): void {
    this.writeIndent();
    this.write('if (');
    this.write(this.emitExprInternal(gen.condition));
    this.write(') begin');
    if (gen.label) {
      this.write(' : ');
      this.write(gen.label);
    }
    this.writeLine('');

    this.indentLevel++;
    for (const item of gen.thenItems) {
      this.emitModuleItem(item);
    }
    this.indentLevel--;

    if (gen.elseItems.length > 0) {
      this.writeIndent();
      this.writeLine('end else begin');
      this.indentLevel++;
      for (const item of gen.elseItems) {
        this.emitModuleItem(item);
      }
      this.indentLevel--;
    }

    this.writeIndent();
    this.writeLine('end');
  }

  private emitModuleItem(item: SvModuleItem): void {
    switch (item.kind) {
      case 'SvSignal':
        this.emitSignal(item);
        break;
      case 'SvAlwaysBlock':
        this.emitAlwaysBlock(item);
        break;
      case 'SvInitialBlock':
        this.emitInitialBlock(item);
        break;
      case 'SvAssign':
        this.emitAssign(item);
        break;
      case 'SvInstance':
        this.emitInstance(item);
        break;
      case 'SvEnumDef':
      case 'SvStructDef':
      case 'SvTypeDef':
        this.emitTypeDef(item);
        break;
      case 'SvFunction':
        this.emitFunction(item);
        break;
      case 'SvTask':
        this.emitTask(item);
        break;
      case 'SvGenerateFor':
      case 'SvGenerateIf':
        this.emitGenerate(item);
        break;
      case 'SvParameter':
      case 'SvPort':
        // Skip - these are handled in module header
        break;
    }
  }

  // ==================== Data Types ====================

  private emitDataTypeInternal(dataType: SvDataType): string {
    switch (dataType.kind) {
      case 'SvLogicType':
        return this.emitLogicType(dataType);
      case 'SvRegType':
        return this.emitRegType(dataType);
      case 'SvWireType':
        return this.emitWireType(dataType);
      case 'SvIntType':
        return dataType.unsigned ? 'int unsigned' : 'int';
      case 'SvIntegerType':
        return 'integer';
      case 'SvEnumType':
        return dataType.name;
      case 'SvStructType':
        return dataType.name;
      case 'SvArrayType':
        return this.emitArrayType(dataType);
      case 'SvPackedArrayType':
        return this.emitPackedArrayType(dataType);
      case 'SvUserDefinedType':
        return dataType.name;
      default: {
        const _exhaustive: never = dataType;
        throw new Error(`Unknown data type: ${(_exhaustive as SvDataType).kind}`);
      }
    }
  }

  private emitLogicType(dataType: SvLogicType): string {
    const signed = dataType.signed ? 'signed ' : '';
    const width = this.emitWidthBracket(dataType.width);
    return `logic ${signed}${width}`.trim();
  }

  private emitRegType(dataType: SvRegType): string {
    const signed = dataType.signed ? 'signed ' : '';
    const width = this.emitWidthBracket(dataType.width);
    return `reg ${signed}${width}`.trim();
  }

  private emitWireType(dataType: SvWireType): string {
    const signed = dataType.signed ? 'signed ' : '';
    const width = this.emitWidthBracket(dataType.width);
    return `wire ${signed}${width}`.trim();
  }

  private emitWidthBracket(width: SvWidth): string {
    if (width.kind === 'SvConstWidth' && width.value === 1) {
      return '';
    }

    switch (width.kind) {
      case 'SvConstWidth':
        return `[${width.value - 1}:0]`;
      case 'SvParamWidth':
        return `[${width.param}-1:0]`;
      case 'SvExprWidth':
        return `[${width.expr}-1:0]`;
    }
  }

  private emitArrayType(dataType: SvArrayType): string {
    let result = this.emitDataTypeInternal(dataType.elementType);
    for (const dim of dataType.dimensions) {
      result += ` [${this.emitWidthValue(dim)}]`;
    }
    return result;
  }

  private emitPackedArrayType(dataType: SvPackedArrayType): string {
    const element = this.emitDataTypeInternal(dataType.elementType);
    const width = this.emitWidthBracket(dataType.width);
    return `${element} ${width}`.trim();
  }

  private emitWidthValue(width: SvWidth): string {
    switch (width.kind) {
      case 'SvConstWidth':
        return String(width.value);
      case 'SvParamWidth':
        return width.param;
      case 'SvExprWidth':
        return width.expr;
    }
  }

  // ==================== Expressions ====================

  private emitExprInternal(expr: SvExpr): string {
    switch (expr.kind) {
      case 'SvLiteralExpr':
        return this.emitLiteral(expr.literal);
      case 'SvIdentifierExpr':
        return expr.name;
      case 'SvUnaryExpr':
        return this.emitUnaryExpr(expr);
      case 'SvBinaryExpr':
        return this.emitBinaryExpr(expr);
      case 'SvTernaryExpr':
        return `${this.emitExprInternal(expr.condition)} ? ${this.emitExprInternal(expr.thenExpr)} : ${this.emitExprInternal(expr.elseExpr)}`;
      case 'SvCallExpr':
        return `${expr.callee}(${expr.args.map(a => this.emitExprInternal(a)).join(', ')})`;
      case 'SvIndexExpr':
        return `${this.emitExprInternal(expr.base)}[${this.emitExprInternal(expr.index)}]`;
      case 'SvSliceExpr':
        // SystemVerilog writes a part select the same way IRIS does.
        return expr.partSelect
          ? `${this.emitExprInternal(expr.base)}[${this.emitExprInternal(expr.high)} ${expr.partSelect} ${this.emitExprInternal(expr.low)}]`
          : `${this.emitExprInternal(expr.base)}[${this.emitExprInternal(expr.high)}:${this.emitExprInternal(expr.low)}]`;
      case 'SvMemberExpr':
        return `${this.emitExprInternal(expr.base)}.${expr.member}`;
      case 'SvConcatExpr':
        return `{${expr.elements.map(e => this.emitExprInternal(e)).join(', ')}}`;
      case 'SvReplicateExpr':
        return `{${this.emitExprInternal(expr.count)}{${this.emitExprInternal(expr.expr)}}}`;
      case 'SvCastExpr':
        return `${this.emitDataTypeInternal(expr.targetType)}'(${this.emitExprInternal(expr.expr)})`;
      case 'SvSizeCastExpr':
        return `${this.emitWidthValue(expr.width)}'(${this.emitExprInternal(expr.expr)})`;
      case 'SvParenExpr':
        return `(${this.emitExprInternal(expr.expr)})`;
      default: {
        const _exhaustive: never = expr;
        throw new Error(`Unknown expression: ${(_exhaustive as SvExpr).kind}`);
      }
    }
  }

  private emitLiteral(literal: SvLiteral): string {
    switch (literal.kind) {
      case 'SvIntLiteral':
        return this.emitIntLiteral(literal);
      case 'SvRealLiteral':
        return String(literal.value);
      case 'SvStringLiteral':
        return `"${this.escapeString(literal.value)}"`;
      case 'SvTimeLiteral':
        return `${literal.value}${literal.unit}`;
      default: {
        const _exhaustive: never = literal;
        throw new Error(`Unknown literal: ${(_exhaustive as SvLiteral).kind}`);
      }
    }
  }

  private emitIntLiteral(literal: SvIntLiteral): string {
    const value = typeof literal.value === 'bigint' ? literal.value : BigInt(literal.value);
    const signed = literal.signed ? 's' : '';

    if (literal.width === undefined && literal.radix === undefined) {
      // Simple decimal
      return String(value);
    }

    const width = literal.width !== undefined ? String(literal.width) : '';
    const radix = literal.radix ?? 'd';

    let valueStr: string;
    switch (radix) {
      case 'b':
        valueStr = value.toString(2);
        break;
      case 'o':
        valueStr = value.toString(8);
        break;
      case 'd':
        valueStr = value.toString(10);
        break;
      case 'h':
        valueStr = value.toString(16);
        break;
    }

    return `${width}'${signed}${radix}${valueStr}`;
  }

  private emitUnaryExpr(expr: SvUnaryExpr): string {
    const operand = this.emitExprInternal(expr.operand);

    if (expr.prefix) {
      return `${expr.op}${operand}`;
    } else {
      return `${operand}${expr.op}`;
    }
  }

  /**
   * Binding strength of a SystemVerilog operator; smaller binds tighter.
   *
   * IRIS has no precedence at all: `expr = unary_expr ~ (bin_op ~ unary_expr)*`
   * folds strictly left to right, so `a ^ b >> 1` means `(a ^ b) >> 1` there and
   * `a ^ (b >> 1)` here. Emitting the operands unbracketed silently regrouped
   * every mixed expression.
   */
  private static readonly SV_PRECEDENCE: Record<string, number> = {
    '**': 1,
    '*': 2, '/': 2, '%': 2,
    '+': 3, '-': 3,
    '<<': 4, '>>': 4, '<<<': 4, '>>>': 4,
    '<': 5, '<=': 5, '>': 5, '>=': 5,
    '==': 6, '!=': 6, '===': 6, '!==': 6,
    '&': 7,
    '^': 8, '~^': 8, '^~': 8,
    '|': 9,
    '&&': 10,
    '||': 11,
  };

  private precedenceOf(expr: SvExpr): number {
    return expr.kind === 'SvBinaryExpr'
      ? (SvEmitter.SV_PRECEDENCE[expr.op] ?? 0)
      : 0;
  }

  private emitBinaryExpr(expr: SvBinaryExpr): string {
    const own = SvEmitter.SV_PRECEDENCE[expr.op] ?? 0;
    const leftPrec = this.precedenceOf(expr.left);
    const rightPrec = this.precedenceOf(expr.right);

    let left = this.emitExprInternal(expr.left);
    let right = this.emitExprInternal(expr.right);

    // Every operator here is left-associative, so an equal-strength operand on
    // the right also has to be bracketed to keep the tree it came from.
    if (leftPrec > own) {
      left = `(${left})`;
    }
    if (rightPrec >= own && rightPrec > 0) {
      right = `(${right})`;
    }

    return `${left} ${expr.op} ${right}`;
  }

  private escapeString(s: string): string {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
  }

  // ==================== Statements ====================

  private emitStmtInternal(stmt: SvStmt): void {
    switch (stmt.kind) {
      case 'SvExprStmt':
        this.writeIndent();
        this.write(this.emitExprInternal(stmt.expr));
        this.writeLine(';');
        break;

      case 'SvBlockingAssignStmt':
        this.writeIndent();
        this.write(this.emitExprInternal(stmt.lhs));
        this.write(' = ');
        this.write(this.emitExprInternal(stmt.rhs));
        this.writeLine(';');
        break;

      case 'SvNonBlockingAssignStmt':
        this.writeIndent();
        this.write(this.emitExprInternal(stmt.lhs));
        this.write(' <= ');
        this.write(this.emitExprInternal(stmt.rhs));
        this.writeLine(';');
        break;

      case 'SvContinuousAssignStmt':
        this.writeIndent();
        this.write('assign ');
        this.write(this.emitExprInternal(stmt.lhs));
        this.write(' = ');
        this.write(this.emitExprInternal(stmt.rhs));
        this.writeLine(';');
        break;

      case 'SvIfStmt':
        this.emitIfStmt(stmt);
        break;

      case 'SvCaseStmt':
        this.emitCaseStmt(stmt);
        break;

      case 'SvForStmt':
        this.emitForStmt(stmt);
        break;

      case 'SvWhileStmt':
        this.writeIndent();
        this.write('while (');
        this.write(this.emitExprInternal(stmt.condition));
        this.write(') ');
        this.emitStmtInline(stmt.body);
        break;

      case 'SvDoWhileStmt':
        this.writeIndent();
        this.write('do ');
        this.emitStmtInline(stmt.body);
        this.writeIndent();
        this.write('while (');
        this.write(this.emitExprInternal(stmt.condition));
        this.writeLine(');');
        break;

      case 'SvForeverStmt':
        this.writeIndent();
        this.write('forever ');
        this.emitStmtInline(stmt.body);
        break;

      case 'SvRepeatStmt':
        this.writeIndent();
        this.write('repeat (');
        this.write(this.emitExprInternal(stmt.count));
        this.write(') ');
        this.emitStmtInline(stmt.body);
        break;

      case 'SvReturnStmt':
        this.writeIndent();
        this.write('return');
        if (stmt.value) {
          this.write(' ');
          this.write(this.emitExprInternal(stmt.value));
        }
        this.writeLine(';');
        break;

      case 'SvBreakStmt':
        this.writeIndent();
        this.writeLine('break;');
        break;

      case 'SvContinueStmt':
        this.writeIndent();
        this.writeLine('continue;');
        break;

      case 'SvBlockStmt':
        this.emitBlockStmt(stmt);
        break;

      case 'SvVarDeclStmt':
        this.writeIndent();
        this.write(this.emitDataTypeInternal(stmt.dataType));
        this.write(' ');
        this.write(stmt.name);
        if (stmt.initialValue) {
          this.write(' = ');
          this.write(this.emitExprInternal(stmt.initialValue));
        }
        this.writeLine(';');
        break;

      case 'SvTaskCallStmt':
        this.writeIndent();
        this.write(stmt.taskName);
        this.write('(');
        this.write(stmt.args.map(a => this.emitExprInternal(a)).join(', '));
        this.writeLine(');');
        break;

      case 'SvAssertStmt':
        this.writeIndent();
        this.write('assert (');
        this.write(this.emitExprInternal(stmt.condition));
        this.write(')');
        if (stmt.message) {
          this.write(` else $error("${this.escapeString(stmt.message)}")`);
        }
        this.writeLine(';');
        break;

      case 'SvDisplayStmt':
        this.writeIndent();
        this.write(stmt.newline ? '$display' : '$write');
        this.write('("');
        this.write(this.escapeString(stmt.format));
        this.write('"');
        if (stmt.args.length > 0) {
          this.write(', ');
          this.write(stmt.args.map(a => this.emitExprInternal(a)).join(', '));
        }
        this.writeLine(');');
        break;

      case 'SvEmptyStmt':
        // Do nothing
        break;

      case 'SvCommentStmt':
        this.writeIndent();
        if (stmt.isBlock) {
          this.write('/* ');
          this.write(stmt.text);
          this.writeLine(' */');
        } else {
          this.write('// ');
          this.writeLine(stmt.text);
        }
        break;

      case 'SvDelayStmt':
        this.writeIndent();
        this.write('#');
        this.write(String(stmt.delay));
        this.write(stmt.unit);
        this.writeLine(';');
        break;

      case 'SvEventControlStmt':
        this.writeIndent();
        this.write('@(');
        if (stmt.edge) {
          this.write(stmt.edge);
          this.write(' ');
        }
        this.write(stmt.signal);
        this.writeLine(');');
        break;

      case 'SvWaitStmt':
        this.writeIndent();
        this.write('wait(');
        this.write(this.emitExprInternal(stmt.condition));
        this.writeLine(');');
        break;

      default: {
        const _exhaustive: never = stmt;
        throw new Error(`Unknown statement: ${(_exhaustive as SvStmt).kind}`);
      }
    }
  }

  private emitStmtInline(stmt: SvStmt): void {
    if (stmt.kind === 'SvBlockStmt') {
      this.emitBlockStmtInline(stmt);
    } else {
      this.writeLine('');
      this.indentLevel++;
      this.emitStmtInternal(stmt);
      this.indentLevel--;
    }
  }

  private emitBlockStmt(stmt: SvBlockStmt): void {
    this.writeIndent();
    this.emitBlockStmtInline(stmt);
  }

  private emitBlockStmtInline(stmt: SvBlockStmt): void {
    this.write('begin');
    if (stmt.label) {
      this.write(' : ');
      this.write(stmt.label);
    }
    this.writeLine('');

    this.indentLevel++;
    for (const s of stmt.statements) {
      this.emitStmtInternal(s);
    }
    this.indentLevel--;

    this.writeIndent();
    this.writeLine('end');
  }

  private emitIfStmt(stmt: { kind: 'SvIfStmt'; condition: SvExpr; thenBranch: SvStmt; elseBranch: SvStmt | undefined; isUnique: boolean; isPriority: boolean }): void {
    this.writeIndent();

    if (stmt.isUnique) {
      this.write('unique ');
    } else if (stmt.isPriority) {
      this.write('priority ');
    }

    this.write('if (');
    this.write(this.emitExprInternal(stmt.condition));
    this.write(') ');

    this.emitStmtInline(stmt.thenBranch);

    if (stmt.elseBranch) {
      this.writeIndent();
      this.write('else ');

      if (stmt.elseBranch.kind === 'SvIfStmt') {
        // else if chain - emit inline without extra indent
        this.write('if (');
        this.write(this.emitExprInternal(stmt.elseBranch.condition));
        this.write(') ');
        this.emitStmtInline(stmt.elseBranch.thenBranch);

        if (stmt.elseBranch.elseBranch) {
          this.writeIndent();
          this.write('else ');
          this.emitStmtInline(stmt.elseBranch.elseBranch);
        }
      } else {
        this.emitStmtInline(stmt.elseBranch);
      }
    }
  }

  private emitCaseStmt(stmt: { kind: 'SvCaseStmt'; expr: SvExpr; items: SvCaseItem[]; defaultCase: SvStmt | undefined; caseType: 'case' | 'casex' | 'casez'; isUnique: boolean; isPriority: boolean }): void {
    this.writeIndent();

    if (stmt.isUnique) {
      this.write('unique ');
    } else if (stmt.isPriority) {
      this.write('priority ');
    }

    this.write(stmt.caseType);
    this.write(' (');
    this.write(this.emitExprInternal(stmt.expr));
    this.writeLine(')');

    this.indentLevel++;

    for (const item of stmt.items) {
      this.emitCaseItem(item);
    }

    if (stmt.defaultCase) {
      this.writeIndent();
      this.write('default: ');
      if (stmt.defaultCase.kind === 'SvBlockStmt') {
        this.emitBlockStmtInline(stmt.defaultCase);
      } else {
        this.writeLine('');
        this.indentLevel++;
        this.emitStmtInternal(stmt.defaultCase);
        this.indentLevel--;
      }
    }

    this.indentLevel--;
    this.writeIndent();
    this.writeLine('endcase');
  }

  private emitCaseItem(item: SvCaseItem): void {
    this.writeIndent();
    this.write(item.patterns.map(p => this.emitExprInternal(p)).join(', '));
    this.write(': ');

    if (item.body.kind === 'SvBlockStmt') {
      this.emitBlockStmtInline(item.body);
    } else {
      this.writeLine('');
      this.indentLevel++;
      this.emitStmtInternal(item.body);
      this.indentLevel--;
    }
  }

  private emitForStmt(stmt: { kind: 'SvForStmt'; init: SvStmt | undefined; condition: SvExpr | undefined; update: SvStmt | undefined; body: SvStmt; loopVar: string | undefined; loopVarType: SvDataType | undefined }): void {
    this.writeIndent();
    this.write('for (');

    // Init
    if (stmt.init) {
      if (stmt.init.kind === 'SvVarDeclStmt') {
        this.write(this.emitDataTypeInternal(stmt.init.dataType));
        this.write(' ');
        this.write(stmt.init.name);
        if (stmt.init.initialValue) {
          this.write(' = ');
          this.write(this.emitExprInternal(stmt.init.initialValue));
        }
      } else if (stmt.init.kind === 'SvBlockingAssignStmt') {
        this.write(this.emitExprInternal(stmt.init.lhs));
        this.write(' = ');
        this.write(this.emitExprInternal(stmt.init.rhs));
      }
    }
    this.write('; ');

    // Condition
    if (stmt.condition) {
      this.write(this.emitExprInternal(stmt.condition));
    }
    this.write('; ');

    // Update
    if (stmt.update) {
      if (stmt.update.kind === 'SvBlockingAssignStmt') {
        this.write(this.emitExprInternal(stmt.update.lhs));
        this.write(' = ');
        this.write(this.emitExprInternal(stmt.update.rhs));
      }
    }

    this.write(') ');
    this.emitStmtInline(stmt.body);
  }

  // ==================== Output Helpers ====================

  private reset(): void {
    this.output = [];
    this.indentLevel = 0;
  }

  private write(text: string): void {
    this.output.push(text);
  }

  private writeLine(text: string): void {
    this.output.push(text);
    this.output.push(this.options.lineEnding);
  }

  private writeIndent(): void {
    for (let i = 0; i < this.indentLevel; i++) {
      this.output.push(this.options.indent);
    }
  }

  private getOutput(): string {
    return this.output.join('');
  }
}

/**
 * Create an emitter with default options
 */
export function createEmitter(options?: Partial<EmitterOptions>): SvEmitter {
  return new SvEmitter(options);
}

/**
 * Emit a module to string
 */
export function emitInterface(
  iface: SvInterface,
  options?: Partial<EmitterOptions>
): string {
  const emitter = new SvEmitter(options);
  return emitter.emitInterfaceStandalone(iface);
}

export function emitTypeDef(
  typeDef: SvEnumDef | SvStructDef | SvUnionDef | SvTypeDef,
  options?: Partial<EmitterOptions>
): string {
  const emitter = new SvEmitter(options);
  return emitter.emitSourceFile({
    kind: 'SvSourceFile',
    timescale: undefined,
    modules: [],
    typeDefs: [typeDef],
  });
}

export function emitFunction(fn: SvFunction, options?: Partial<EmitterOptions>): string {
  const emitter = new SvEmitter(options);
  return emitter.emitModuleItemStandalone(fn);
}

export function emitModule(module: SvModule, options?: Partial<EmitterOptions>): string {
  return createEmitter(options).emitModule(module);
}

/**
 * Emit a source file to string
 */
export function emitSourceFile(sourceFile: SvSourceFile, options?: Partial<EmitterOptions>): string {
  return createEmitter(options).emitSourceFile(sourceFile);
}

/**
 * Emit an expression to string
 */
export function emitExpr(expr: SvExpr, options?: Partial<EmitterOptions>): string {
  return createEmitter(options).emitExpr(expr);
}

/**
 * Emit a statement to string
 */
export function emitStmt(stmt: SvStmt, options?: Partial<EmitterOptions>): string {
  return createEmitter(options).emitStmt(stmt);
}

/**
 * Emit a data type to string
 */
export function emitDataType(dataType: SvDataType, options?: Partial<EmitterOptions>): string {
  return createEmitter(options).emitDataType(dataType);
}
