/**
 * IRIS Code Generator
 * Converts IRIS AST to IRIS source code
 */

import type {
    IrSourceFile,
    IrItem,
    IrModDef,
    IrModItem,
    IrGenericParam,
    IrGenericBound,
    IrTypeExpr,
    IrLetDecl,
    IrVarDecl,
    IrConstDecl,
    IrInstDecl,
    IrMemDecl,
    IrCombBlock,
    IrSyncBlock,
    IrStmt,
    IrAssignStmt,
    IrIfStmt,
    IrMatchStmt,
    IrMatchArm,
    IrForStmt,
    IrWhileStmt,
    IrBlockStmt,
    IrExpr,
    IrIdentifier,
    IrLiteral,
    IrBinaryExpr,
    IrUnaryExpr,
    IrIfExpr,
    IrMatchExpr,
    IrCallExpr,
    IrIndexExpr,
    IrFieldExpr,
    IrCastExpr,
    IrConcatExpr,
    IrRepeatExpr,
    IrParenExpr,
    IrPattern,
    IrEnumDef,
    IrStructDef,
    IrTypeAlias,
} from '../ast/iris-ast.js';

/**
 * Generator options
 */
export interface GeneratorOptions {
    /** Indentation string (default: 4 spaces) */
    indent?: string;
    /** Use tabs instead of spaces */
    useTabs?: boolean;
    /** Add trailing newline at end of file */
    trailingNewline?: boolean;
}

/**
 * IRIS Code Generator
 */
export class Generator {
    private output: string[] = [];
    private indentLevel = 0;
    private readonly indentString: string;
    private readonly trailingNewline: boolean;

    constructor(options: GeneratorOptions = {}) {
        if (options.useTabs) {
            this.indentString = '\t';
        } else {
            this.indentString = options.indent ?? '    ';
        }
        this.trailingNewline = options.trailingNewline ?? true;
    }

    /**
     * Generate IRIS source code from AST
     */
    generate(sourceFile: IrSourceFile): string {
        this.output = [];
        this.indentLevel = 0;

        for (let i = 0; i < sourceFile.items.length; i++) {
            this.generateItem(sourceFile.items[i]);
            if (i < sourceFile.items.length - 1) {
                this.writeLine('');
            }
        }

        let result = this.output.join('\n');
        if (this.trailingNewline && result.length > 0) {
            result += '\n';
        }
        return result;
    }

    // =========================================================================
    // Item Generation
    // =========================================================================

    private generateItem(item: IrItem): void {
        switch (item.kind) {
            case 'ModDef':
                this.generateModule(item);
                break;
            case 'EnumDef':
                this.generateEnum(item);
                break;
            case 'StructDef':
                this.generateStruct(item);
                break;
            case 'TypeAlias':
                this.generateTypeAlias(item);
                break;
            case 'ConstDecl':
                this.generateConst(item);
                break;
        }
    }

    // =========================================================================
    // Module Generation
    // =========================================================================

    private generateModule(mod: IrModDef): void {
        // Module header: pub mod name[generics](ports)
        let header = '';
        if (mod.isPublic) {
            header += 'pub ';
        }
        header += `mod ${mod.name}`;

        // Generics
        if (mod.generics.length > 0) {
            header += '[' + mod.generics.map((g) => this.generateGenericParam(g)).join(', ') + ']';
        }

        // Ports
        header += '(';
        this.writeLine(header);
        this.indent();
        for (let i = 0; i < mod.ports.length; i++) {
            const port = mod.ports[i];
            const comma = i < mod.ports.length - 1 ? ',' : '';
            this.writeLine(
                `${port.direction} ${port.name}: ${this.generateType(port.typeExpr)}${comma}`
            );
        }
        this.dedent();
        this.writeLine(') {');

        // Module body
        this.indent();
        for (const item of mod.items) {
            this.generateModItem(item);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateGenericParam(param: IrGenericParam): string {
        let result = param.name + ': ' + this.generateGenericBound(param.bound);
        if (param.defaultValue) {
            result += ' = ' + this.generateExpr(param.defaultValue);
        }
        return result;
    }

    private generateGenericBound(bound: IrGenericBound): string {
        if (typeof bound === 'string') {
            return bound;
        }
        return this.generateType(bound);
    }

    private generateModItem(item: IrModItem): void {
        switch (item.kind) {
            case 'LetDecl':
                this.generateLet(item);
                break;
            case 'VarDecl':
                this.generateVar(item);
                break;
            case 'ConstDecl':
                this.generateConst(item);
                break;
            case 'CombBlock':
                this.generateComb(item);
                break;
            case 'SyncBlock':
                this.generateSync(item);
                break;
            case 'InstDecl':
                this.generateInst(item);
                break;
            case 'MemDecl':
                this.generateMem(item);
                break;
            case 'TypeAlias':
                this.generateTypeAlias(item);
                break;
        }
    }

    // =========================================================================
    // Type Generation
    // =========================================================================

    private generateType(type: IrTypeExpr): string {
        switch (type.baseType) {
            case 'bit':
                if (type.width) {
                    return `bit[${this.generateExpr(type.width)}]`;
                }
                return 'bit';
            case 'int':
                if (type.width) {
                    return `int[${this.generateExpr(type.width)}]`;
                }
                return 'int';
            case 'uint':
                if (type.width) {
                    return `uint[${this.generateExpr(type.width)}]`;
                }
                return 'uint';
            case 'bool':
                return 'bool';
            case 'clock':
                return 'clock';
            case 'reset':
                return 'reset';
            case 'string':
                return 'string';
            case 'array':
                if (type.elementType && type.arraySize) {
                    return `${this.generateType(type.elementType)}[${this.generateExpr(type.arraySize)}]`;
                }
                return 'array';
            case 'tuple':
                if (type.tupleTypes) {
                    return '(' + type.tupleTypes.map((t) => this.generateType(t)).join(', ') + ')';
                }
                return '()';
            case 'user':
                let result = type.typeName ?? 'unknown';
                if (type.genericArgs && type.genericArgs.length > 0) {
                    result +=
                        '[' + type.genericArgs.map((a) => this.generateExpr(a)).join(', ') + ']';
                }
                return result;
        }
    }

    // =========================================================================
    // Declaration Generation
    // =========================================================================

    private generateLet(decl: IrLetDecl): void {
        let line = 'let ';
        if (decl.isMutable) {
            line = 'let mut ';
        }
        line += decl.name;
        if (decl.typeExpr) {
            line += ': ' + this.generateType(decl.typeExpr);
        }
        if (decl.initialValue) {
            line += ' = ' + this.generateExpr(decl.initialValue);
        }
        line += ';';
        this.writeLine(line);
    }

    private generateVar(decl: IrVarDecl): void {
        let line = 'var ' + decl.name;
        if (decl.typeExpr) {
            line += ': ' + this.generateType(decl.typeExpr);
        }
        if (decl.initialValue) {
            line += ' = ' + this.generateExpr(decl.initialValue);
        }
        line += ';';
        this.writeLine(line);
    }

    private generateConst(decl: IrConstDecl): void {
        let line = '';
        if (decl.isPublic) {
            line += 'pub ';
        }
        line += 'const ' + decl.name + ': ' + this.generateType(decl.typeExpr);
        line += ' = ' + this.generateExpr(decl.value) + ';';
        this.writeLine(line);
    }

    private generateInst(inst: IrInstDecl): void {
        // IRIS syntax: inst name: ModulePath[GenericArgs](.port(expr), ...);
        let line = 'inst ' + inst.name + ': ' + inst.modulePath;
        if (inst.genericArgs && inst.genericArgs.length > 0) {
            line += '[' + inst.genericArgs.map((a) => this.generateExpr(a)).join(', ') + ']';
        }
        line += '(';

        if (inst.connections.length === 0) {
            line += ');';
            this.writeLine(line);
        } else if (inst.connections.length <= 2) {
            // Short form: single line
            line += inst.connections
                .map((c) => `.${c.portName}(${this.generateExpr(c.expr)})`)
                .join(', ');
            line += ');';
            this.writeLine(line);
        } else {
            // Long form: multiple lines
            this.writeLine(line);
            this.indent();
            for (let i = 0; i < inst.connections.length; i++) {
                const conn = inst.connections[i];
                const comma = i < inst.connections.length - 1 ? ',' : '';
                this.writeLine(`.${conn.portName}(${this.generateExpr(conn.expr)})${comma}`);
            }
            this.dedent();
            this.writeLine(');');
        }
    }

    private generateMem(mem: IrMemDecl): void {
        let line = 'mem ' + mem.name + ': ' + this.generateType(mem.elementType);
        line += '[' + this.generateExpr(mem.depth) + ']';

        if (mem.config) {
            const configParts: string[] = [];
            if (mem.config.ports) {
                configParts.push(`ports: ${mem.config.ports}`);
            }
            if (mem.config.memType) {
                configParts.push(`type: ${mem.config.memType}`);
            }
            if (mem.config.readMode) {
                configParts.push(`read: ${mem.config.readMode}`);
            }
            if (mem.config.writeMode) {
                configParts.push(`write: ${mem.config.writeMode}`);
            }
            if (configParts.length > 0) {
                line += ' { ' + configParts.join(', ') + ' }';
            }
        }

        if (mem.initializer) {
            line += ' = ' + this.generateExpr(mem.initializer);
        }

        line += ';';
        this.writeLine(line);
    }

    // =========================================================================
    // Logic Block Generation
    // =========================================================================

    private generateComb(block: IrCombBlock): void {
        this.writeLine('comb {');
        this.indent();
        for (const stmt of block.statements) {
            this.generateStatement(stmt);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateSync(block: IrSyncBlock): void {
        let header = 'sync(' + this.generateExpr(block.clock.signal);
        header += '.' + block.clock.edge;

        if (block.reset) {
            header += ', ' + this.generateExpr(block.reset.signal);
            if (block.reset.mode === 'async') {
                header += '.async';
            }
        }

        header += ') {';
        this.writeLine(header);
        this.indent();
        for (const stmt of block.statements) {
            this.generateStatement(stmt);
        }
        this.dedent();
        this.writeLine('}');
    }

    // =========================================================================
    // Statement Generation
    // =========================================================================

    private generateStatement(stmt: IrStmt): void {
        switch (stmt.kind) {
            case 'AssignStmt':
                this.generateAssign(stmt);
                break;
            case 'IfStmt':
                this.generateIf(stmt);
                break;
            case 'MatchStmt':
                this.generateMatch(stmt);
                break;
            case 'ForStmt':
                this.generateFor(stmt);
                break;
            case 'WhileStmt':
                this.generateWhile(stmt);
                break;
            case 'BlockStmt':
                this.generateBlock(stmt);
                break;
            case 'LetDecl':
                this.generateLet(stmt);
                break;
            case 'VarDecl':
                this.generateVar(stmt);
                break;
        }
    }

    private generateAssign(stmt: IrAssignStmt): void {
        this.writeLine(`${this.generateExpr(stmt.target)} = ${this.generateExpr(stmt.value)};`);
    }

    private generateIf(stmt: IrIfStmt, isElseIf = false): void {
        const prefix = isElseIf ? '} else if' : 'if';
        this.writeLine(`${prefix} ${this.generateExpr(stmt.condition)} {`);
        this.indent();
        for (const s of stmt.thenBlock) {
            this.generateStatement(s);
        }
        this.dedent();

        if (stmt.elseBlock) {
            if (Array.isArray(stmt.elseBlock)) {
                this.writeLine('} else {');
                this.indent();
                for (const s of stmt.elseBlock) {
                    this.generateStatement(s);
                }
                this.dedent();
                this.writeLine('}');
            } else {
                // else if - pass true to indicate this is an else-if chain
                this.generateIf(stmt.elseBlock, true);
            }
        } else {
            this.writeLine('}');
        }
    }

    private generateMatch(stmt: IrMatchStmt): void {
        this.writeLine(`match ${this.generateExpr(stmt.expr)} {`);
        this.indent();
        for (const arm of stmt.arms) {
            this.generateMatchArm(arm);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateMatchArm(arm: IrMatchArm): void {
        const pattern = this.generatePattern(arm.pattern);

        if (Array.isArray(arm.body)) {
            // Statement body
            this.writeLine(`${pattern} => {`);
            this.indent();
            for (const s of arm.body) {
                this.generateStatement(s);
            }
            this.dedent();
            this.writeLine('}');
        } else {
            // Expression body
            this.writeLine(`${pattern} => ${this.generateExpr(arm.body)},`);
        }
    }

    private generatePattern(pattern: IrPattern): string {
        switch (pattern.kind) {
            case 'literal':
                return this.generateExpr(pattern.value);
            case 'identifier':
                return pattern.name;
            case 'wildcard':
                return '_';
            case 'range':
                const op = pattern.inclusive ? '..=' : '..';
                return `${this.generateExpr(pattern.start)}${op}${this.generateExpr(pattern.end)}`;
        }
    }

    private generateFor(stmt: IrForStmt): void {
        const op = stmt.inclusive ? '..=' : '..<';
        this.writeLine(
            `for ${stmt.variable} in ${this.generateExpr(stmt.start)}${op}${this.generateExpr(stmt.end)} {`
        );
        this.indent();
        for (const s of stmt.body) {
            this.generateStatement(s);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateWhile(stmt: IrWhileStmt): void {
        this.writeLine(`while ${this.generateExpr(stmt.condition)} {`);
        this.indent();
        for (const s of stmt.body) {
            this.generateStatement(s);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateBlock(stmt: IrBlockStmt): void {
        this.writeLine('{');
        this.indent();
        for (const s of stmt.statements) {
            this.generateStatement(s);
        }
        this.dedent();
        this.writeLine('}');
    }

    // =========================================================================
    // Expression Generation
    // =========================================================================

    generateExpr(expr: IrExpr): string {
        switch (expr.kind) {
            case 'Identifier':
                return this.generateIdentifier(expr);
            case 'Literal':
                return this.generateLiteral(expr);
            case 'BinaryExpr':
                return this.generateBinary(expr);
            case 'UnaryExpr':
                return this.generateUnary(expr);
            case 'IfExpr':
                return this.generateIfExpr(expr);
            case 'MatchExpr':
                return this.generateMatchExpr(expr);
            case 'CallExpr':
                return this.generateCall(expr);
            case 'IndexExpr':
                return this.generateIndex(expr);
            case 'FieldExpr':
                return this.generateField(expr);
            case 'CastExpr':
                return this.generateCast(expr);
            case 'ConcatExpr':
                return this.generateConcat(expr);
            case 'RepeatExpr':
                return this.generateRepeat(expr);
            case 'ParenExpr':
                return this.generateParen(expr);
        }
    }

    private generateIdentifier(expr: IrIdentifier): string {
        return expr.name;
    }

    private generateLiteral(expr: IrLiteral): string {
        switch (expr.literalKind) {
            case 'bool':
                return expr.value;
            case 'string':
                return `"${expr.value}"`;
            case 'integer':
                if (expr.width !== undefined && expr.base) {
                    // Sized literal: 8'hFF -> 8h_FF
                    return `${expr.width}${expr.base}_${expr.value}`;
                } else if (expr.base) {
                    // Unsized literal with base
                    return `0${expr.base}${expr.value}`;
                }
                return expr.value;
        }
    }

    private generateBinary(expr: IrBinaryExpr): string {
        const left = this.generateExpr(expr.left);
        const right = this.generateExpr(expr.right);
        return `${left} ${expr.operator} ${right}`;
    }

    private generateUnary(expr: IrUnaryExpr): string {
        const operand = this.generateExpr(expr.operand);
        return `${expr.operator}${operand}`;
    }

    private generateIfExpr(expr: IrIfExpr): string {
        const cond = this.generateExpr(expr.condition);
        const thenExpr = this.generateExpr(expr.thenExpr);
        const elseExpr = this.generateExpr(expr.elseExpr);
        return `if ${cond} { ${thenExpr} } else { ${elseExpr} }`;
    }

    private generateMatchExpr(expr: IrMatchExpr): string {
        const scrutinee = this.generateExpr(expr.expr);
        const arms = expr.arms.map((arm) => {
            const pattern = this.generatePattern(arm.pattern);
            if (Array.isArray(arm.body)) {
                // This shouldn't happen in a match expression
                return `${pattern} => { ... }`;
            }
            return `${pattern} => ${this.generateExpr(arm.body)}`;
        });
        return `match ${scrutinee} { ${arms.join(', ')} }`;
    }

    private generateCall(expr: IrCallExpr): string {
        const callee = this.generateExpr(expr.callee);
        const args = expr.args.map((a) => this.generateExpr(a)).join(', ');
        return `${callee}(${args})`;
    }

    private generateIndex(expr: IrIndexExpr): string {
        const base = this.generateExpr(expr.base);
        const index = this.generateExpr(expr.index);
        if (expr.endIndex) {
            const end = this.generateExpr(expr.endIndex);
            return `${base}[${index}:${end}]`;
        }
        return `${base}[${index}]`;
    }

    private generateField(expr: IrFieldExpr): string {
        const obj = this.generateExpr(expr.object);
        return `${obj}.${expr.field}`;
    }

    private generateCast(expr: IrCastExpr): string {
        const inner = this.generateExpr(expr.expr);
        const type = this.generateType(expr.targetType);
        return `${inner} as ${type}`;
    }

    private generateConcat(expr: IrConcatExpr): string {
        const elements = expr.elements.map((e) => this.generateExpr(e)).join(', ');
        return `{${elements}}`;
    }

    private generateRepeat(expr: IrRepeatExpr): string {
        // IRIS syntax: {count{expr}}
        const inner = this.generateExpr(expr.expr);
        const count = this.generateExpr(expr.count);
        return `{${count}{${inner}}}`;
    }

    private generateParen(expr: IrParenExpr): string {
        return `(${this.generateExpr(expr.expr)})`;
    }

    // =========================================================================
    // Enum/Struct/TypeAlias Generation
    // =========================================================================

    private generateEnum(enumDef: IrEnumDef): void {
        let header = '';
        if (enumDef.isPublic) {
            header += 'pub ';
        }
        header += `enum ${enumDef.name}`;
        if (enumDef.generics.length > 0) {
            header +=
                '[' + enumDef.generics.map((g) => this.generateGenericParam(g)).join(', ') + ']';
        }
        header += ' {';
        this.writeLine(header);
        this.indent();
        for (const variant of enumDef.variants) {
            if (variant.value) {
                this.writeLine(`${variant.name} = ${this.generateExpr(variant.value)},`);
            } else {
                this.writeLine(`${variant.name},`);
            }
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateStruct(structDef: IrStructDef): void {
        let header = '';
        if (structDef.isPublic) {
            header += 'pub ';
        }
        header += `struct ${structDef.name}`;
        if (structDef.generics.length > 0) {
            header +=
                '[' + structDef.generics.map((g) => this.generateGenericParam(g)).join(', ') + ']';
        }
        header += ' {';
        this.writeLine(header);
        this.indent();
        for (const field of structDef.fields) {
            this.writeLine(`${field.name}: ${this.generateType(field.typeExpr)},`);
        }
        this.dedent();
        this.writeLine('}');
    }

    private generateTypeAlias(alias: IrTypeAlias): void {
        let line = '';
        if (alias.isPublic) {
            line += 'pub ';
        }
        line += `type ${alias.name}`;
        if (alias.generics.length > 0) {
            line += '[' + alias.generics.map((g) => this.generateGenericParam(g)).join(', ') + ']';
        }
        line += ` = ${this.generateType(alias.targetType)};`;
        this.writeLine(line);
    }

    // =========================================================================
    // Output Helpers
    // =========================================================================

    private indent(): void {
        this.indentLevel++;
    }

    private dedent(): void {
        if (this.indentLevel > 0) {
            this.indentLevel--;
        }
    }

    private getIndent(): string {
        return this.indentString.repeat(this.indentLevel);
    }

    private writeLine(text: string): void {
        if (text === '') {
            this.output.push('');
        } else {
            this.output.push(this.getIndent() + text);
        }
    }
}
