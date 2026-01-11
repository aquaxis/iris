/**
 * SystemVerilog to IRIS Transformer
 * Transforms SystemVerilog AST to IRIS AST
 */

import type { SourceLocation } from '../utils/source-location.js';
import { TransformError, TransformErrorCodes } from '../errors/error.js';
import { ErrorReporter } from '../errors/reporter.js';
import type {
    SvSourceFile,
    SvModuleDecl,
    SvModuleItem,
    SvParameterDecl,
    SvPortDecl,
    SvDataType,
    SvVariableDecl,
    SvNetDecl,
    SvAlwaysStmt,
    SvContinuousAssign,
    SvBlockStmt,
    SvBlockingAssign,
    SvNonBlockingAssign,
    SvIfStmt,
    SvCaseStmt,
    SvCaseItem,
    SvForStmt,
    SvWhileStmt,
    SvSensitivityList,
    SvModuleInst,
    SvExpr,
    SvStmt,
    SvTypedefDecl,
    SvGenerateBlock,
    SvGenerateIf,
    SvGenerateFor,
    SvGenerateItem,
} from '../ast/sv-ast.js';
import type {
    IrSourceFile,
    IrModDef,
    IrModItem,
    IrGenericParam,
    IrPortDecl,
    IrPortDirection,
    IrTypeExpr,
    IrExpr,
    IrStmt,
    IrCombBlock,
    IrSyncBlock,
    IrClockSpec,
    IrResetSpec,
    IrLetDecl,
    IrInstDecl,
    IrConnection,
    IrMatchArm,
    IrPattern,
    IrItem} from '../ast/iris-ast.js';
import {
    createIrSourceFile,
    createIrModDef,
    createIrPortDecl,
    createIrTypeExpr,
    createIrIdentifier,
    createIrLiteral,
    createIrBinaryExpr,
    createIrUnaryExpr,
    createIrIfExpr,
    createIrConcatExpr,
    createIrRepeatExpr,
    createIrLetDecl,
    createIrAssignStmt,
    createIrIfStmt,
    createIrCombBlock,
    createIrSyncBlock,
    createIrInstDecl,
    createIrMatchStmt,
    createIrMatchArm,
    createIrForStmt,
    createIrIndexExpr,
    createIrGenericParam,
} from '../ast/iris-ast.js';

/**
 * Transformer options
 */
export interface TransformerOptions {
    autoOutputWire?: boolean;
}

/**
 * Main Transformer class
 */
export class Transformer {
    private readonly reporter: ErrorReporter;
    private readonly options: TransformerOptions;

    // Track continuous assignments by variable name (for merging with wire declarations)
    private continuousAssigns: Map<string, SvContinuousAssign> = new Map();
    // Track declared variables (to avoid duplicate let declarations)
    private declaredVariables: Set<string> = new Set();
    // Track port names (to handle assign to ports correctly)
    private portNames: Set<string> = new Set();
    // Track output port names (for auto-output-wire feature)
    private outputPortNames: Set<string> = new Set();
    // Track output ports that are read internally
    private outputPortsWithReads: Set<string> = new Set();
    // Track all declared signal names (for name collision avoidance)
    private allSignalNames: Set<string> = new Set();

    constructor(reporter?: ErrorReporter, options?: TransformerOptions) {
        this.reporter = reporter ?? new ErrorReporter();
        this.options = options ?? {};
    }

    /**
     * Transforms a SystemVerilog source file to IRIS
     */
    transform(svFile: SvSourceFile): IrSourceFile {
        const items: IrItem[] = [];

        for (const module of svFile.modules) {
            items.push(this.transformModule(module));
        }

        return createIrSourceFile(items, svFile.location);
    }

    /**
     * Gets the error reporter
     */
    getReporter(): ErrorReporter {
        return this.reporter;
    }

    // ========== Module Transformation ==========

    /**
     * Transforms a module declaration
     */
    private transformModule(module: SvModuleDecl): IrModDef {
        // Reset per-module state
        this.continuousAssigns.clear();
        this.declaredVariables.clear();
        this.portNames.clear();
        this.outputPortNames.clear();
        this.outputPortsWithReads.clear();
        this.allSignalNames.clear();

        // Collect port names for later reference
        for (const port of module.ports) {
            this.portNames.add(port.name);
            this.allSignalNames.add(port.name);
            if (port.direction === 'output') {
                this.outputPortNames.add(port.name);
            }
        }

        // Collect all declared signal names
        this.collectAllSignalNames(module.items);

        // Pre-scan to collect continuous assigns (including from generate blocks)
        this.collectContinuousAssigns(module.items);

        // If auto-output-wire is enabled, detect output ports that are read internally
        if (this.options.autoOutputWire) {
            this.detectOutputPortReads(module.items);
        }

        const generics = module.parameters.map((p) => this.transformParameter(p));
        const ports = module.ports.map((p) => this.transformPort(p));
        let items = this.transformModuleItems(module.items);

        // If auto-output-wire is enabled and there are output ports with reads,
        // add internal wire declarations and output assignments
        if (this.options.autoOutputWire && this.outputPortsWithReads.size > 0) {
            items = this.addOutputWireTransforms(items, module);
        }

        return createIrModDef(module.name, generics, ports, items, module.location);
    }

    /**
     * Collects all signal names from module items
     */
    private collectAllSignalNames(items: SvModuleItem[]): void {
        for (const item of items) {
            if (item.kind === 'VariableDecl') {
                for (const name of item.names) {
                    this.allSignalNames.add(name);
                }
            } else if (item.kind === 'NetDecl') {
                for (const name of item.names) {
                    this.allSignalNames.add(name);
                }
            } else if (item.kind === 'GenerateBlock') {
                this.collectAllSignalNamesFromGenerate(item.items);
            }
        }
    }

    /**
     * Recursively collects signal names from generate items
     */
    private collectAllSignalNamesFromGenerate(items: SvGenerateItem[]): void {
        for (const item of items) {
            if (item.kind === 'VariableDecl') {
                for (const name of item.names) {
                    this.allSignalNames.add(name);
                }
            } else if (item.kind === 'NetDecl') {
                for (const name of item.names) {
                    this.allSignalNames.add(name);
                }
            } else if (item.kind === 'GenerateIf') {
                this.collectAllSignalNamesFromGenerate(item.thenBlock);
                if (item.elseBlock) {
                    this.collectAllSignalNamesFromGenerate(item.elseBlock);
                }
            } else if (item.kind === 'GenerateFor') {
                this.collectAllSignalNamesFromGenerate(item.body);
            }
        }
    }

    /**
     * Detects output ports that are read internally
     */
    private detectOutputPortReads(items: SvModuleItem[]): void {
        for (const item of items) {
            this.detectOutputPortReadsInItem(item);
        }
    }

    /**
     * Detects output port reads in a single module item
     */
    private detectOutputPortReadsInItem(item: SvModuleItem): void {
        switch (item.kind) {
            case 'ContinuousAssign':
                // Check the value expression for output port reads
                this.detectOutputPortReadsInExpr(item.value);
                break;
            case 'AlwaysStmt':
                this.detectOutputPortReadsInStmt(item.body);
                break;
            case 'VariableDecl':
                if (item.initialValue) {
                    this.detectOutputPortReadsInExpr(item.initialValue);
                }
                break;
            case 'NetDecl':
                if (item.initialValue) {
                    this.detectOutputPortReadsInExpr(item.initialValue);
                }
                break;
            case 'GenerateBlock':
                for (const genItem of item.items) {
                    this.detectOutputPortReadsInGenerateItem(genItem);
                }
                break;
            case 'ModuleInst':
                // Check module instantiation connections for output port reads
                for (const conn of item.connections) {
                    if (conn.expr) {
                        this.detectOutputPortReadsInExpr(conn.expr);
                    }
                }
                // Also check parameter assignments
                for (const param of item.parameters) {
                    this.detectOutputPortReadsInExpr(param.value);
                }
                break;
        }
    }

    /**
     * Detects output port reads in generate items
     */
    private detectOutputPortReadsInGenerateItem(item: SvGenerateItem): void {
        switch (item.kind) {
            case 'GenerateIf':
                this.detectOutputPortReadsInExpr(item.condition);
                for (const thenItem of item.thenBlock) {
                    this.detectOutputPortReadsInGenerateItem(thenItem);
                }
                if (item.elseBlock) {
                    for (const elseItem of item.elseBlock) {
                        this.detectOutputPortReadsInGenerateItem(elseItem);
                    }
                }
                break;
            case 'GenerateFor':
                for (const bodyItem of item.body) {
                    this.detectOutputPortReadsInGenerateItem(bodyItem);
                }
                break;
            default:
                this.detectOutputPortReadsInItem(item as SvModuleItem);
                break;
        }
    }

    /**
     * Detects output port reads in a statement
     */
    private detectOutputPortReadsInStmt(stmt: SvStmt): void {
        switch (stmt.kind) {
            case 'BlockStmt':
                for (const s of stmt.statements) {
                    this.detectOutputPortReadsInStmt(s);
                }
                break;
            case 'BlockingAssign':
            case 'NonBlockingAssign':
                this.detectOutputPortReadsInExpr(stmt.value);
                break;
            case 'IfStmt':
                this.detectOutputPortReadsInExpr(stmt.condition);
                this.detectOutputPortReadsInStmt(stmt.thenBranch);
                if (stmt.elseBranch) {
                    this.detectOutputPortReadsInStmt(stmt.elseBranch);
                }
                break;
            case 'CaseStmt':
                this.detectOutputPortReadsInExpr(stmt.expr);
                for (const item of stmt.items) {
                    for (const pattern of item.patterns) {
                        this.detectOutputPortReadsInExpr(pattern);
                    }
                    this.detectOutputPortReadsInStmt(item.body);
                }
                if (stmt.defaultItem) {
                    this.detectOutputPortReadsInStmt(stmt.defaultItem);
                }
                break;
            case 'ForStmt':
                if (stmt.condition) {
                    this.detectOutputPortReadsInExpr(stmt.condition);
                }
                this.detectOutputPortReadsInStmt(stmt.body);
                break;
            case 'WhileStmt':
                this.detectOutputPortReadsInExpr(stmt.condition);
                this.detectOutputPortReadsInStmt(stmt.body);
                break;
        }
    }

    /**
     * Detects output port reads in an expression
     */
    private detectOutputPortReadsInExpr(expr: SvExpr): void {
        switch (expr.kind) {
            case 'Identifier':
                if (this.outputPortNames.has(expr.name)) {
                    this.outputPortsWithReads.add(expr.name);
                }
                break;
            case 'BinaryExpr':
                this.detectOutputPortReadsInExpr(expr.left);
                this.detectOutputPortReadsInExpr(expr.right);
                break;
            case 'UnaryExpr':
                this.detectOutputPortReadsInExpr(expr.operand);
                break;
            case 'ConditionalExpr':
                this.detectOutputPortReadsInExpr(expr.condition);
                this.detectOutputPortReadsInExpr(expr.thenExpr);
                this.detectOutputPortReadsInExpr(expr.elseExpr);
                break;
            case 'ConcatExpr':
                for (const e of expr.elements) {
                    this.detectOutputPortReadsInExpr(e);
                }
                break;
            case 'ReplicateExpr':
                this.detectOutputPortReadsInExpr(expr.count);
                this.detectOutputPortReadsInExpr(expr.expr);
                break;
            case 'IndexExpr':
                this.detectOutputPortReadsInExpr(expr.base);
                this.detectOutputPortReadsInExpr(expr.index);
                break;
            case 'SliceExpr':
                this.detectOutputPortReadsInExpr(expr.base);
                this.detectOutputPortReadsInExpr(expr.msb);
                this.detectOutputPortReadsInExpr(expr.lsb);
                break;
            case 'MemberExpr':
                this.detectOutputPortReadsInExpr(expr.object);
                break;
            case 'CallExpr':
                this.detectOutputPortReadsInExpr(expr.callee);
                for (const arg of expr.args) {
                    this.detectOutputPortReadsInExpr(arg);
                }
                break;
            case 'ParenExpr':
                this.detectOutputPortReadsInExpr(expr.expr);
                break;
        }
    }

    /**
     * Generates a unique internal wire name for an output port
     */
    private generateInternalWireName(portName: string): string {
        let candidate = `${portName}_internal`;
        let suffix = 1;
        while (this.allSignalNames.has(candidate)) {
            candidate = `${portName}_internal_${suffix}`;
            suffix++;
        }
        this.allSignalNames.add(candidate);
        return candidate;
    }

    /**
     * Adds internal wire declarations and output assignments for output ports with reads
     */
    private addOutputWireTransforms(items: IrModItem[], module: SvModuleDecl): IrModItem[] {
        const result: IrModItem[] = [];
        const internalWireMap = new Map<string, string>();

        // Generate internal wire names and create declarations
        for (const portName of this.outputPortsWithReads) {
            const internalName = this.generateInternalWireName(portName);
            internalWireMap.set(portName, internalName);

            // Find the port to get its type
            const port = module.ports.find((p) => p.name === portName);
            if (port) {
                const typeExpr = this.transformType(port.dataType);
                const letDecl = createIrLetDecl(internalName, module.location, { typeExpr });
                result.push(letDecl);
            }
        }

        // Replace output port references with internal wire references in existing items
        for (const item of items) {
            result.push(this.replaceOutputPortRefs(item, internalWireMap));
        }

        // Add comb blocks to connect internal wires to output ports
        for (const [portName, internalName] of internalWireMap) {
            const assignStmt = createIrAssignStmt(
                createIrIdentifier(portName, module.location),
                createIrIdentifier(internalName, module.location),
                module.location
            );
            result.push(createIrCombBlock([assignStmt], module.location));
        }

        return result;
    }

    /**
     * Replaces output port references with internal wire references in an item
     */
    private replaceOutputPortRefs(item: IrModItem, internalWireMap: Map<string, string>): IrModItem {
        switch (item.kind) {
            case 'LetDecl':
                if (item.initialValue) {
                    return {
                        ...item,
                        initialValue: this.replaceOutputPortRefsInExpr(item.initialValue, internalWireMap),
                    };
                }
                return item;
            case 'CombBlock':
                return {
                    ...item,
                    statements: item.statements.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap)),
                };
            case 'SyncBlock':
                return {
                    ...item,
                    statements: item.statements.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap)),
                };
            case 'InstDecl':
                return {
                    ...item,
                    connections: item.connections.map((conn) => ({
                        ...conn,
                        expr: this.replaceOutputPortRefsInExpr(conn.expr, internalWireMap),
                    })),
                    genericArgs: item.genericArgs?.map((arg) =>
                        this.replaceOutputPortRefsInExpr(arg, internalWireMap)
                    ),
                };
            default:
                return item;
        }
    }

    /**
     * Replaces output port references in a statement
     */
    private replaceOutputPortRefsInStmt(stmt: IrStmt, internalWireMap: Map<string, string>): IrStmt {
        switch (stmt.kind) {
            case 'AssignStmt': {
                const target = this.replaceOutputPortRefsInExpr(stmt.target, internalWireMap, true);
                const value = this.replaceOutputPortRefsInExpr(stmt.value, internalWireMap);
                return { ...stmt, target, value };
            }
            case 'IfStmt': {
                let elseBlock: IrStmt[] | IrStmt | undefined;
                if (stmt.elseBlock) {
                    if (Array.isArray(stmt.elseBlock)) {
                        elseBlock = stmt.elseBlock.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap));
                    } else {
                        // It's an IrIfStmt for else-if chains
                        elseBlock = this.replaceOutputPortRefsInStmt(stmt.elseBlock, internalWireMap) as IrStmt & { kind: 'IfStmt' };
                    }
                }
                return {
                    ...stmt,
                    condition: this.replaceOutputPortRefsInExpr(stmt.condition, internalWireMap),
                    thenBlock: stmt.thenBlock.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap)),
                    elseBlock,
                } as IrStmt;
            }
            case 'MatchStmt':
                return {
                    ...stmt,
                    expr: this.replaceOutputPortRefsInExpr(stmt.expr, internalWireMap),
                    arms: stmt.arms.map((arm) => ({
                        ...arm,
                        body: Array.isArray(arm.body)
                            ? arm.body.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap))
                            : this.replaceOutputPortRefsInExpr(arm.body, internalWireMap),
                    })),
                };
            case 'ForStmt':
                return {
                    ...stmt,
                    start: this.replaceOutputPortRefsInExpr(stmt.start, internalWireMap),
                    end: this.replaceOutputPortRefsInExpr(stmt.end, internalWireMap),
                    body: stmt.body.map((s) => this.replaceOutputPortRefsInStmt(s, internalWireMap)),
                };
            default:
                return stmt;
        }
    }

    /**
     * Replaces output port references in an expression
     * @param isAssignTarget If true, this is the target of an assignment (should be replaced)
     */
    private replaceOutputPortRefsInExpr(
        expr: IrExpr,
        internalWireMap: Map<string, string>,
        isAssignTarget = false
    ): IrExpr {
        switch (expr.kind) {
            case 'Identifier': {
                const internalName = internalWireMap.get(expr.name);
                if (internalName) {
                    return createIrIdentifier(internalName, expr.location);
                }
                return expr;
            }
            case 'BinaryExpr':
                return createIrBinaryExpr(
                    expr.operator,
                    this.replaceOutputPortRefsInExpr(expr.left, internalWireMap),
                    this.replaceOutputPortRefsInExpr(expr.right, internalWireMap),
                    expr.location
                );
            case 'UnaryExpr':
                return createIrUnaryExpr(
                    expr.operator,
                    this.replaceOutputPortRefsInExpr(expr.operand, internalWireMap),
                    expr.location
                );
            case 'IfExpr':
                return createIrIfExpr(
                    this.replaceOutputPortRefsInExpr(expr.condition, internalWireMap),
                    this.replaceOutputPortRefsInExpr(expr.thenExpr, internalWireMap),
                    this.replaceOutputPortRefsInExpr(expr.elseExpr, internalWireMap),
                    expr.location
                );
            case 'ConcatExpr':
                return createIrConcatExpr(
                    expr.elements.map((e) => this.replaceOutputPortRefsInExpr(e, internalWireMap)),
                    expr.location
                );
            case 'RepeatExpr':
                return createIrRepeatExpr(
                    this.replaceOutputPortRefsInExpr(expr.expr, internalWireMap),
                    this.replaceOutputPortRefsInExpr(expr.count, internalWireMap),
                    expr.location
                );
            case 'IndexExpr':
                return createIrIndexExpr(
                    this.replaceOutputPortRefsInExpr(expr.base, internalWireMap, isAssignTarget),
                    this.replaceOutputPortRefsInExpr(expr.index, internalWireMap),
                    expr.location,
                    expr.endIndex ? this.replaceOutputPortRefsInExpr(expr.endIndex, internalWireMap) : undefined
                );
            case 'FieldExpr':
                return {
                    ...expr,
                    object: this.replaceOutputPortRefsInExpr(expr.object, internalWireMap, isAssignTarget),
                };
            case 'CallExpr':
                return {
                    ...expr,
                    callee: this.replaceOutputPortRefsInExpr(expr.callee, internalWireMap),
                    args: expr.args.map((a) => this.replaceOutputPortRefsInExpr(a, internalWireMap)),
                };
            case 'ParenExpr':
                return {
                    ...expr,
                    expr: this.replaceOutputPortRefsInExpr(expr.expr, internalWireMap),
                };
            default:
                return expr;
        }
    }

    /**
     * Collects all continuous assigns from module items (including generate blocks)
     */
    private collectContinuousAssigns(items: SvModuleItem[]): void {
        for (const item of items) {
            if (item.kind === 'ContinuousAssign') {
                if (item.target.kind === 'Identifier') {
                    this.continuousAssigns.set(item.target.name, item);
                }
            } else if (item.kind === 'GenerateBlock') {
                this.collectContinuousAssignsFromGenerate(item.items);
            }
        }
    }

    /**
     * Recursively collects continuous assigns from generate items
     */
    private collectContinuousAssignsFromGenerate(items: SvGenerateItem[]): void {
        for (const item of items) {
            if (item.kind === 'ContinuousAssign') {
                if (item.target.kind === 'Identifier') {
                    this.continuousAssigns.set(item.target.name, item);
                }
            } else if (item.kind === 'GenerateIf') {
                this.collectContinuousAssignsFromGenerate(item.thenBlock);
                if (item.elseBlock) {
                    this.collectContinuousAssignsFromGenerate(item.elseBlock);
                }
            } else if (item.kind === 'GenerateFor') {
                this.collectContinuousAssignsFromGenerate(item.body);
            }
        }
    }

    /**
     * Transforms a parameter to a generic parameter
     */
    private transformParameter(param: SvParameterDecl): IrGenericParam {
        // Determine the bound type based on the data type
        let bound: 'uint' | 'int' | 'type' = 'uint';
        if (param.dataType) {
            if (param.dataType.signed) {
                bound = 'int';
            }
        }

        const defaultValue = param.defaultValue
            ? this.transformExpr(param.defaultValue)
            : undefined;

        return createIrGenericParam(param.name, bound, param.location, defaultValue);
    }

    /**
     * Transforms a port declaration
     */
    private transformPort(port: SvPortDecl): IrPortDecl {
        const direction = this.transformPortDirection(port.direction);
        const typeExpr = this.transformType(port.dataType);

        return createIrPortDecl(direction, port.name, typeExpr, port.location);
    }

    /**
     * Transforms port direction
     */
    private transformPortDirection(dir: 'input' | 'output' | 'inout'): IrPortDirection {
        switch (dir) {
            case 'input':
                return 'in';
            case 'output':
                return 'out';
            case 'inout':
                return 'inout';
        }
    }

    /**
     * Transforms module items
     */
    private transformModuleItems(items: SvModuleItem[]): IrModItem[] {
        const result: IrModItem[] = [];

        for (const item of items) {
            const transformed = this.transformModuleItem(item);
            if (transformed) {
                if (Array.isArray(transformed)) {
                    result.push(...transformed);
                } else {
                    result.push(transformed);
                }
            }
        }

        return result;
    }

    /**
     * Transforms a single module item
     */
    private transformModuleItem(item: SvModuleItem): IrModItem | IrModItem[] | null {
        switch (item.kind) {
            case 'VariableDecl':
                return this.transformVariableDecl(item); // Returns IrLetDecl[]
            case 'NetDecl':
                return this.transformNetDecl(item); // Returns IrLetDecl[]
            case 'AlwaysStmt':
                return this.transformAlways(item);
            case 'ContinuousAssign':
                return this.transformContinuousAssign(item);
            case 'ModuleInst':
                return this.transformModuleInst(item);
            case 'EnumDecl':
                // Enums are handled at module level in IRIS
                return null;
            case 'StructDecl':
                // Structs are handled at module level in IRIS
                return null;
            case 'TypedefDecl':
                return this.transformTypedef(item);
            case 'GenerateBlock':
                return this.transformGenerateBlock(item);
            default:
                this.reportError(
                    TransformErrorCodes.UNSUPPORTED_CONSTRUCT,
                    `Unsupported module item: ${(item as SvModuleItem).kind}`,
                    (item as SvModuleItem).location
                );
                return null;
        }
    }

    // ========== Type Transformation ==========

    /**
     * Transforms a SystemVerilog data type to IRIS type expression
     */
    private transformType(dataType: SvDataType): IrTypeExpr {
        const loc = dataType.location;

        switch (dataType.baseType) {
            case 'logic':
            case 'reg':
            case 'wire':
            case 'bit': {
                // Calculate width
                let width: IrExpr | undefined;
                if (dataType.msb && dataType.lsb) {
                    // [MSB:LSB] -> width = MSB - LSB + 1
                    // Simplified: assume [N-1:0] format, so width = MSB + 1
                    width = this.createWidthExpr(dataType.msb, dataType.lsb, loc);
                }
                return createIrTypeExpr('bit', loc, { width });
            }

            case 'integer':
                return createIrTypeExpr('int', loc, {
                    width: createIrLiteral('integer', '32', loc),
                });

            case 'int':
                return createIrTypeExpr('int', loc, {
                    width: createIrLiteral('integer', '32', loc),
                });

            case 'shortint':
                return createIrTypeExpr('int', loc, {
                    width: createIrLiteral('integer', '16', loc),
                });

            case 'longint':
                return createIrTypeExpr('int', loc, {
                    width: createIrLiteral('integer', '64', loc),
                });

            case 'byte':
                return createIrTypeExpr(dataType.signed ? 'int' : 'uint', loc, {
                    width: createIrLiteral('integer', '8', loc),
                });

            case 'real':
            case 'shortreal':
            case 'realtime':
                this.reportError(
                    TransformErrorCodes.UNSUPPORTED_CONSTRUCT,
                    'Real types are not supported in IRIS',
                    loc
                );
                return createIrTypeExpr('bit', loc);

            case 'time':
                return createIrTypeExpr('uint', loc, {
                    width: createIrLiteral('integer', '64', loc),
                });

            case 'string':
                return createIrTypeExpr('string', loc);

            case 'void':
                // IRIS doesn't have void, use unit type or empty
                return createIrTypeExpr('bit', loc);

            case 'user':
                return createIrTypeExpr('user', loc, {
                    typeName: dataType.typeName,
                });

            default:
                return createIrTypeExpr('bit', loc);
        }
    }

    /**
     * Creates a width expression from MSB and LSB
     */
    private createWidthExpr(msb: SvExpr, lsb: SvExpr, loc: SourceLocation): IrExpr {
        // For simple [N-1:0] patterns, width = N
        // For general [M:L], width = M - L + 1
        if (lsb.kind === 'NumberLiteral' && lsb.value === '0') {
            // [MSB:0] -> width = MSB + 1
            const msbExpr = this.transformExpr(msb);
            return createIrBinaryExpr('+', msbExpr, createIrLiteral('integer', '1', loc), loc);
        }

        // General case: MSB - LSB + 1
        const msbExpr = this.transformExpr(msb);
        const lsbExpr = this.transformExpr(lsb);
        return createIrBinaryExpr(
            '+',
            createIrBinaryExpr('-', msbExpr, lsbExpr, loc),
            createIrLiteral('integer', '1', loc),
            loc
        );
    }

    // ========== Declaration Transformation ==========

    /**
     * Transforms a variable declaration (supports multiple variable names)
     */
    private transformVariableDecl(decl: SvVariableDecl): IrLetDecl[] {
        const typeExpr = this.transformType(decl.dataType);

        // Create a let declaration for each variable name
        return decl.names.map((name) => {
            // Track that this variable has been declared
            this.declaredVariables.add(name);

            // Check if there's a corresponding assign statement to merge
            const assign = this.continuousAssigns.get(name);
            let initialValue: IrExpr | undefined;

            if (decl.initialValue) {
                // Use the variable's initial value if present
                initialValue = this.transformExpr(decl.initialValue);
            } else if (assign) {
                // Use the assign statement's value if available
                initialValue = this.transformExpr(assign.value);
            }

            return createIrLetDecl(name, decl.location, {
                typeExpr,
                initialValue,
            });
        });
    }

    /**
     * Transforms a net declaration (supports multiple variable names)
     */
    private transformNetDecl(decl: SvNetDecl): IrLetDecl[] {
        const typeExpr = this.transformType(decl.dataType);

        // Create a let declaration for each net name
        return decl.names.map((name) => {
            // Track that this variable has been declared
            this.declaredVariables.add(name);

            // Check if there's a corresponding assign statement to merge
            const assign = this.continuousAssigns.get(name);
            let initialValue: IrExpr | undefined;

            if (decl.initialValue) {
                // Use the wire's initial value if present
                initialValue = this.transformExpr(decl.initialValue);
            } else if (assign) {
                // Use the assign statement's value if available
                initialValue = this.transformExpr(assign.value);
            }

            return createIrLetDecl(name, decl.location, {
                typeExpr,
                initialValue,
            });
        });
    }

    /**
     * Transforms a typedef
     */
    private transformTypedef(typedef: SvTypedefDecl): IrModItem | null {
        // TypeAliases in IRIS
        if (typedef.targetType.kind === 'DataType') {
            const targetType = this.transformType(typedef.targetType);
            return {
                kind: 'TypeAlias',
                name: typedef.name,
                isPublic: false,
                generics: [],
                targetType,
                location: typedef.location,
            };
        }
        return null;
    }

    // ========== Always Block Transformation ==========

    /**
     * Transforms an always block
     */
    private transformAlways(always: SvAlwaysStmt): IrCombBlock | IrSyncBlock {
        const statements = this.transformStatement(always.body);

        switch (always.alwaysType) {
            case 'always_comb':
                return createIrCombBlock(statements, always.location);

            case 'always_ff':
            case 'always_latch':
            case 'always': {
                const clockSpec = this.extractClockSpec(always.sensitivity);
                const resetSpec = this.extractResetSpec(always.sensitivity);

                if (clockSpec) {
                    return createIrSyncBlock(clockSpec, statements, always.location, resetSpec);
                } else {
                    // Fallback to comb if no clock found
                    return createIrCombBlock(statements, always.location);
                }
            }
        }
    }

    /**
     * Extracts clock specification from sensitivity list
     */
    private extractClockSpec(sensitivity: SvSensitivityList | undefined): IrClockSpec | undefined {
        if (!sensitivity || sensitivity.isWildcard) {
            return undefined;
        }

        // Find first edge-triggered signal (posedge/negedge)
        for (const item of sensitivity.items) {
            if (item.edge !== 'none') {
                return {
                    signal: this.transformExpr(item.signal),
                    edge: item.edge,
                };
            }
        }

        return undefined;
    }

    /**
     * Extracts reset specification from sensitivity list
     */
    private extractResetSpec(sensitivity: SvSensitivityList | undefined): IrResetSpec | undefined {
        if (!sensitivity || sensitivity.isWildcard) {
            return undefined;
        }

        // Find second edge-triggered signal (usually reset)
        let foundFirst = false;
        for (const item of sensitivity.items) {
            if (item.edge !== 'none') {
                if (foundFirst) {
                    return {
                        signal: this.transformExpr(item.signal),
                        mode: 'async', // Async reset if in sensitivity list
                    };
                }
                foundFirst = true;
            }
        }

        return undefined;
    }

    /**
     * Transforms a continuous assign statement
     */
    private transformContinuousAssign(assign: SvContinuousAssign): IrModItem | null {
        const target = assign.target;
        const value = this.transformExpr(assign.value);

        if (target.kind === 'Identifier') {
            // Skip if this variable was already declared via wire/reg
            // The assign value was merged into the wire declaration
            if (this.declaredVariables.has(target.name)) {
                return null;
            }

            // If target is a port, generate comb block with assignment
            // instead of a let declaration (to avoid shadowing)
            if (this.portNames.has(target.name)) {
                const assignStmt = createIrAssignStmt(
                    createIrIdentifier(target.name, assign.location),
                    value,
                    assign.location
                );
                return createIrCombBlock([assignStmt], assign.location);
            }

            // Regular wire: generate let declaration
            return createIrLetDecl(target.name, assign.location, {
                initialValue: value,
            });
        }

        // For complex targets (array elements, etc.), create comb block with assignment
        const irTarget = this.transformExpr(target);
        const assignStmt = createIrAssignStmt(irTarget, value, assign.location);
        return createIrCombBlock([assignStmt], assign.location);
    }

    /**
     * Transforms a module instantiation
     */
    private transformModuleInst(inst: SvModuleInst): IrInstDecl {
        // Filter out empty port connections (e.g., .COMP() in SystemVerilog)
        // In IRIS, unconnected ports are simply omitted
        const connections: IrConnection[] = inst.connections
            .filter((conn) => conn.expr !== undefined && conn.expr !== null)
            .map((conn) => ({
                portName: conn.portName ?? '',
                expr: this.transformExpr(conn.expr!),
            }));

        const genericArgs = inst.parameters.map((p) => this.transformExpr(p.value));

        return createIrInstDecl(
            inst.instanceName,
            inst.moduleName,
            connections,
            inst.location,
            genericArgs.length > 0 ? genericArgs : undefined
        );
    }

    // ========== Statement Transformation ==========

    /**
     * Transforms a statement
     */
    private transformStatement(stmt: SvStmt): IrStmt[] {
        switch (stmt.kind) {
            case 'BlockStmt':
                return this.transformBlockStmt(stmt);
            case 'BlockingAssign':
            case 'NonBlockingAssign':
                return [this.transformAssignment(stmt)];
            case 'IfStmt':
                return [this.transformIfStmt(stmt)];
            case 'CaseStmt':
                return [this.transformCaseStmt(stmt)];
            case 'ForStmt':
                return [this.transformForStmt(stmt)];
            case 'WhileStmt':
                return [this.transformWhileStmt(stmt)];
            case 'VariableDecl':
                return this.transformVariableDecl(stmt);
            default:
                this.reportError(
                    TransformErrorCodes.INVALID_STATEMENT,
                    `Unsupported statement: ${(stmt as SvStmt).kind}`,
                    (stmt as SvStmt).location
                );
                return [];
        }
    }

    /**
     * Transforms a block statement
     */
    private transformBlockStmt(block: SvBlockStmt): IrStmt[] {
        const statements: IrStmt[] = [];
        for (const stmt of block.statements) {
            statements.push(...this.transformStatement(stmt));
        }
        return statements;
    }

    /**
     * Transforms an assignment statement
     */
    private transformAssignment(assign: SvBlockingAssign | SvNonBlockingAssign): IrStmt {
        const target = this.transformExpr(assign.target);
        const value = this.transformExpr(assign.value);
        return createIrAssignStmt(target, value, assign.location);
    }

    /**
     * Transforms an if statement
     */
    private transformIfStmt(ifStmt: SvIfStmt): IrStmt {
        const condition = this.transformExpr(ifStmt.condition);
        const thenBlock = this.transformStatement(ifStmt.thenBranch);
        const elseBlock = ifStmt.elseBranch
            ? this.transformStatement(ifStmt.elseBranch)
            : undefined;

        return createIrIfStmt(condition, thenBlock, ifStmt.location, elseBlock);
    }

    /**
     * Transforms a case statement to match statement
     */
    private transformCaseStmt(caseStmt: SvCaseStmt): IrStmt {
        const expr = this.transformExpr(caseStmt.expr);
        const arms: IrMatchArm[] = [];

        for (const item of caseStmt.items) {
            const arm = this.transformCaseItem(item);
            arms.push(arm);
        }

        // Add default arm if present
        if (caseStmt.defaultItem) {
            const defaultPattern: IrPattern = { kind: 'wildcard' };
            const defaultBody = this.transformStatement(caseStmt.defaultItem);
            arms.push(createIrMatchArm(defaultPattern, defaultBody, caseStmt.location));
        }

        return createIrMatchStmt(expr, arms, caseStmt.location);
    }

    /**
     * Transforms a case item to a match arm
     */
    private transformCaseItem(item: SvCaseItem): IrMatchArm {
        // Use first pattern (simplification)
        const pattern: IrPattern =
            item.patterns.length > 0
                ? { kind: 'literal', value: this.transformExpr(item.patterns[0]) }
                : { kind: 'wildcard' };

        const body = this.transformStatement(item.body);
        return createIrMatchArm(pattern, body, item.location);
    }

    /**
     * Transforms a for statement
     */
    private transformForStmt(forStmt: SvForStmt): IrStmt {
        // Extract loop variable, start, end from SV for loop
        // SV: for (i = 0; i < N; i = i + 1)
        // IRIS: for i in 0..N { }

        let variable = 'i';
        let start: IrExpr = createIrLiteral('integer', '0', forStmt.location);
        let end: IrExpr = createIrLiteral('integer', '0', forStmt.location);

        // Try to extract from init
        if (forStmt.init?.kind === 'VariableDecl') {
            variable = forStmt.init.names[0]; // Use first name
            if (forStmt.init.initialValue) {
                start = this.transformExpr(forStmt.init.initialValue);
            }
        } else if (forStmt.init?.kind === 'BlockingAssign') {
            if (forStmt.init.target.kind === 'Identifier') {
                variable = forStmt.init.target.name;
            }
            start = this.transformExpr(forStmt.init.value);
        }

        // Try to extract end from condition
        if (forStmt.condition?.kind === 'BinaryExpr') {
            const cond = forStmt.condition;
            if (cond.operator === '<' || cond.operator === '<=') {
                end = this.transformExpr(cond.right);
            }
        }

        const body = this.transformStatement(forStmt.body);

        return createIrForStmt(variable, start, end, body, forStmt.location);
    }

    /**
     * Transforms a while statement
     */
    private transformWhileStmt(whileStmt: SvWhileStmt): IrStmt {
        const condition = this.transformExpr(whileStmt.condition);
        const body = this.transformStatement(whileStmt.body);

        return {
            kind: 'WhileStmt',
            condition,
            body,
            location: whileStmt.location,
        };
    }

    // ========== Expression Transformation ==========

    /**
     * Transforms an expression
     */
    transformExpr(expr: SvExpr): IrExpr {
        switch (expr.kind) {
            case 'Identifier':
                return createIrIdentifier(expr.name, expr.location);

            case 'NumberLiteral':
                return this.transformNumberLiteral(expr);

            case 'StringLiteral':
                return createIrLiteral('string', expr.value, expr.location);

            case 'BinaryExpr':
                return this.transformBinaryExpr(expr);

            case 'UnaryExpr':
                return this.transformUnaryExpr(expr);

            case 'ConditionalExpr':
                return this.transformConditionalExpr(expr);

            case 'ConcatExpr':
                return this.transformConcatExpr(expr);

            case 'ReplicateExpr':
                return this.transformReplicateExpr(expr);

            case 'IndexExpr':
                return this.transformIndexExpr(expr);

            case 'SliceExpr':
                return this.transformSliceExpr(expr);

            case 'MemberExpr':
                return this.transformMemberExpr(expr);

            case 'CallExpr':
                return this.transformCallExpr(expr);

            case 'ParenExpr':
                return {
                    kind: 'ParenExpr',
                    expr: this.transformExpr(expr.expr),
                    location: expr.location,
                };

            default:
                this.reportError(
                    TransformErrorCodes.INVALID_EXPRESSION,
                    `Unsupported expression: ${(expr as SvExpr).kind}`,
                    (expr as SvExpr).location
                );
                return createIrIdentifier('__error__', (expr as SvExpr).location);
        }
    }

    /**
     * Transforms a number literal
     */
    private transformNumberLiteral(num: {
        value: string;
        size?: number;
        base?: 'b' | 'o' | 'd' | 'h';
        signed?: boolean;
        location: SourceLocation;
    }): IrExpr {
        return createIrLiteral('integer', num.value, num.location, {
            width: num.size,
            base: num.base,
        });
    }

    /**
     * Transforms a binary expression
     */
    private transformBinaryExpr(expr: {
        operator: string;
        left: SvExpr;
        right: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const left = this.transformExpr(expr.left);
        const right = this.transformExpr(expr.right);

        // Map SV operators to IRIS operators
        const op = this.mapBinaryOp(expr.operator);
        return createIrBinaryExpr(op, left, right, expr.location);
    }

    /**
     * Maps SystemVerilog binary operator to IRIS
     */
    private mapBinaryOp(
        op: string
    ):
        | '+'
        | '-'
        | '*'
        | '/'
        | '%'
        | '**'
        | '&'
        | '|'
        | '^'
        | '<<'
        | '>>'
        | '>>>'
        | '=='
        | '!='
        | '<'
        | '<='
        | '>'
        | '>='
        | '&&'
        | '||' {
        switch (op) {
            case '+':
                return '+';
            case '-':
                return '-';
            case '*':
                return '*';
            case '/':
                return '/';
            case '%':
                return '%';
            case '**':
                return '**';
            case '&':
                return '&';
            case '|':
                return '|';
            case '^':
                return '^';
            case '~^':
            case '^~':
                return '^'; // XNOR -> XOR (simplified)
            case '<<':
                return '<<';
            case '>>':
                return '>>';
            case '<<<':
                return '<<'; // Arithmetic shift (simplified)
            case '>>>':
                return '>>>';
            case '==':
                return '==';
            case '!=':
                return '!=';
            case '===':
                return '=='; // Case equality -> equality
            case '!==':
                return '!='; // Case inequality -> inequality
            case '<':
                return '<';
            case '<=':
                return '<=';
            case '>':
                return '>';
            case '>=':
                return '>=';
            case '&&':
                return '&&';
            case '||':
                return '||';
            default:
                return '+';
        }
    }

    /**
     * Transforms a unary expression
     */
    private transformUnaryExpr(expr: {
        operator: string;
        operand: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const operand = this.transformExpr(expr.operand);
        const op = this.mapUnaryOp(expr.operator);
        return createIrUnaryExpr(op, operand, expr.location);
    }

    /**
     * Maps SystemVerilog unary operator to IRIS
     */
    private mapUnaryOp(op: string): '!' | '~' | '-' | '&' | '|' | '^' {
        switch (op) {
            case '!':
                return '!';
            case '~':
                return '~';
            case '+':
                return '-'; // Unary plus (no-op, use minus as placeholder)
            case '-':
                return '-';
            case '&':
                return '&'; // Reduction AND
            case '~&':
                return '&'; // Reduction NAND (simplified)
            case '|':
                return '|'; // Reduction OR
            case '~|':
                return '|'; // Reduction NOR (simplified)
            case '^':
                return '^'; // Reduction XOR
            case '~^':
            case '^~':
                return '^'; // Reduction XNOR (simplified)
            default:
                return '!';
        }
    }

    /**
     * Transforms a conditional (ternary) expression to if expression
     */
    private transformConditionalExpr(expr: {
        condition: SvExpr;
        thenExpr: SvExpr;
        elseExpr: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const condition = this.transformExpr(expr.condition);
        const thenExpr = this.transformExpr(expr.thenExpr);
        const elseExpr = this.transformExpr(expr.elseExpr);

        return createIrIfExpr(condition, thenExpr, elseExpr, expr.location);
    }

    /**
     * Transforms a concatenation expression
     */
    private transformConcatExpr(expr: { elements: SvExpr[]; location: SourceLocation }): IrExpr {
        const elements = expr.elements.map((e) => this.transformExpr(e));
        return createIrConcatExpr(elements, expr.location);
    }

    /**
     * Transforms a replication expression
     */
    private transformReplicateExpr(expr: {
        count: SvExpr;
        expr: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const innerExpr = this.transformExpr(expr.expr);
        const count = this.transformExpr(expr.count);
        return createIrRepeatExpr(innerExpr, count, expr.location);
    }

    /**
     * Transforms an index expression
     */
    private transformIndexExpr(expr: {
        base: SvExpr;
        index: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const base = this.transformExpr(expr.base);
        const index = this.transformExpr(expr.index);
        return createIrIndexExpr(base, index, expr.location);
    }

    /**
     * Transforms a slice expression
     */
    private transformSliceExpr(expr: {
        base: SvExpr;
        msb: SvExpr;
        lsb: SvExpr;
        location: SourceLocation;
    }): IrExpr {
        const base = this.transformExpr(expr.base);
        const msb = this.transformExpr(expr.msb);
        const lsb = this.transformExpr(expr.lsb);
        return createIrIndexExpr(base, lsb, expr.location, msb);
    }

    /**
     * Transforms a member expression
     */
    private transformMemberExpr(expr: {
        object: SvExpr;
        member: string;
        location: SourceLocation;
    }): IrExpr {
        const object = this.transformExpr(expr.object);
        return {
            kind: 'FieldExpr',
            object,
            field: expr.member,
            location: expr.location,
        };
    }

    /**
     * Transforms a call expression
     */
    private transformCallExpr(expr: {
        callee: SvExpr;
        args: SvExpr[];
        location: SourceLocation;
    }): IrExpr {
        const callee = this.transformExpr(expr.callee);
        const args = expr.args.map((a) => this.transformExpr(a));
        return {
            kind: 'CallExpr',
            callee,
            args,
            location: expr.location,
        };
    }

    // ========== Generate Block Transformation ==========

    /**
     * Transforms a generate block
     * Generate blocks are flattened into regular module items
     */
    private transformGenerateBlock(block: SvGenerateBlock): IrModItem[] {
        const result: IrModItem[] = [];
        for (const item of block.items) {
            const transformed = this.transformGenerateItem(item);
            if (transformed) {
                if (Array.isArray(transformed)) {
                    result.push(...transformed);
                } else {
                    result.push(transformed);
                }
            }
        }
        return result;
    }

    /**
     * Transforms a generate item
     */
    private transformGenerateItem(item: SvGenerateItem): IrModItem | IrModItem[] | null {
        switch (item.kind) {
            case 'GenerateIf':
                return this.transformGenerateIf(item);
            case 'GenerateFor':
                return this.transformGenerateFor(item);
            default:
                // Regular module item
                return this.transformModuleItem(item);
        }
    }

    /**
     * Transforms a generate if statement
     * For now, we output a comment warning and include the then block
     * A more sophisticated approach would evaluate the condition if it's a constant
     */
    private transformGenerateIf(genIf: SvGenerateIf): IrModItem[] {
        const result: IrModItem[] = [];

        // Add a comment indicating this was a generate if
        // In a more complete implementation, we would evaluate the condition
        // For now, we include items from both branches (if they exist)

        // Transform then block items
        for (const item of genIf.thenBlock) {
            const transformed = this.transformGenerateItem(item);
            if (transformed) {
                if (Array.isArray(transformed)) {
                    result.push(...transformed);
                } else {
                    result.push(transformed);
                }
            }
        }

        // Transform else block items if present
        if (genIf.elseBlock) {
            for (const item of genIf.elseBlock) {
                const transformed = this.transformGenerateItem(item);
                if (transformed) {
                    if (Array.isArray(transformed)) {
                        result.push(...transformed);
                    } else {
                        result.push(transformed);
                    }
                }
            }
        }

        return result;
    }

    /**
     * Transforms a generate for statement
     * For now, we output the body once (as if N=1)
     * A more complete implementation would unroll the loop
     */
    private transformGenerateFor(genFor: SvGenerateFor): IrModItem[] {
        const result: IrModItem[] = [];

        // Transform body items
        for (const item of genFor.body) {
            const transformed = this.transformGenerateItem(item);
            if (transformed) {
                if (Array.isArray(transformed)) {
                    result.push(...transformed);
                } else {
                    result.push(transformed);
                }
            }
        }

        return result;
    }

    // ========== Error Reporting ==========

    /**
     * Reports a transformation error
     */
    private reportError(code: number, message: string, location: SourceLocation): void {
        const error = new TransformError(code, message, location);
        this.reporter.reportError(error);
    }
}
