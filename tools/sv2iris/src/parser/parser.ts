/**
 * SystemVerilog Parser
 * Parses tokens into an Abstract Syntax Tree
 */

import type { Token} from '../lexer/token.js';
import { TokenType, createToken } from '../lexer/token.js';
import { createLocation } from '../utils/source-location.js';
import { ParserError, ParserErrorCodes } from '../errors/error.js';
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
    SvIfStmt,
    SvCaseStmt,
    SvCaseItem,
    SvForStmt,
    SvWhileStmt,
    SvSensitivityList,
    SvSensitivityItem,
    SvModuleInst,
    SvExpr,
    SvStmt,
    SvEnumDecl,
    SvStructDecl,
    SvTypedefDecl,
    SvGenerateBlock,
    SvGenerateIf,
    SvGenerateFor,
    SvGenerateItem,
    PortDirection,
    BaseType,
    AlwaysType,
    EdgeType,
    CaseType} from '../ast/sv-ast.js';
import {
    createSourceFile,
    createIdentifier,
    createNumberLiteral,
    createBinaryExpr,
    createUnaryExpr,
    createConditionalExpr,
} from '../ast/sv-ast.js';
import {
    Precedence,
    getBinaryOpInfo,
    isUnaryPrefixOp,
    tokenTypeToBinaryOp,
    tokenTypeToUnaryOp,
} from './precedence.js';

/**
 * Parser class for SystemVerilog
 */
export class Parser {
    private readonly tokens: Token[];
    private pos = 0;
    private readonly reporter: ErrorReporter;

    constructor(tokens: Token[], reporter?: ErrorReporter) {
        this.tokens = tokens;
        this.reporter = reporter ?? new ErrorReporter();
    }

    /**
     * Parses the token stream into a source file AST
     */
    parse(): SvSourceFile {
        const modules: SvModuleDecl[] = [];
        const startPos = this.currentToken().location.start;

        while (!this.isAtEnd()) {
            if (this.check(TokenType.MODULE)) {
                modules.push(this.parseModule());
            } else if (this.check(TokenType.EOF)) {
                break;
            } else {
                this.reportError(
                    ParserErrorCodes.UNEXPECTED_TOKEN,
                    `Expected 'module', got '${this.currentToken().value}'`
                );
                this.advance(); // Skip unknown token
            }
        }

        const endPos = this.currentToken().location.end;
        return createSourceFile(
            modules,
            createLocation(startPos, endPos, this.currentToken().location.file)
        );
    }

    /**
     * Gets the error reporter
     */
    getReporter(): ErrorReporter {
        return this.reporter;
    }

    // ========== Module Parsing ==========

    /**
     * Parses a module declaration
     */
    private parseModule(): SvModuleDecl {
        const startToken = this.consume(TokenType.MODULE, "Expected 'module'");
        const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected module name');
        const name = nameToken.value;

        let parameters: SvParameterDecl[] = [];
        let ports: SvPortDecl[] = [];

        // Parse parameter list #(...)
        if (this.check(TokenType.HASH)) {
            this.advance();
            this.consume(TokenType.LPAREN, "Expected '(' after '#'");
            parameters = this.parseParameterList();
            this.consume(TokenType.RPAREN, "Expected ')' after parameters");
        }

        // Parse port list (...)
        if (this.check(TokenType.LPAREN)) {
            this.advance();
            if (!this.check(TokenType.RPAREN)) {
                ports = this.parsePortList();
            }
            this.consume(TokenType.RPAREN, "Expected ')' after ports");
        }

        this.consume(TokenType.SEMICOLON, "Expected ';' after module header");

        // Parse module items
        const items: SvModuleItem[] = [];
        while (!this.check(TokenType.ENDMODULE) && !this.isAtEnd()) {
            const item = this.parseModuleItem();
            if (item) {
                items.push(item);
            }
        }

        const endToken = this.consume(TokenType.ENDMODULE, "Expected 'endmodule'");

        return {
            kind: 'ModuleDecl',
            name,
            parameters,
            ports,
            items,
            location: createLocation(
                startToken.location.start,
                endToken.location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses parameter list
     */
    private parseParameterList(): SvParameterDecl[] {
        const params: SvParameterDecl[] = [];

        do {
            if (this.check(TokenType.RPAREN)) break;
            params.push(this.parseParameter());
        } while (this.match(TokenType.COMMA));

        return params;
    }

    /**
     * Parses a single parameter
     */
    private parseParameter(): SvParameterDecl {
        const startToken = this.currentToken();
        let isLocal = false;

        if (this.match(TokenType.PARAMETER)) {
            isLocal = false;
        } else if (this.match(TokenType.LOCALPARAM)) {
            isLocal = true;
        }

        let dataType: SvDataType | undefined;
        if (this.isDataType()) {
            dataType = this.parseDataType();
        }

        const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected parameter name');
        let defaultValue: SvExpr | undefined;

        if (this.match(TokenType.EQ)) {
            defaultValue = this.parseExpression();
        }

        return {
            kind: 'ParameterDecl',
            name: nameToken.value,
            dataType,
            defaultValue,
            isLocal,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses port list
     */
    private parsePortList(): SvPortDecl[] {
        const ports: SvPortDecl[] = [];
        let currentDirection: PortDirection = 'input';
        let currentType: SvDataType | undefined;

        do {
            if (this.check(TokenType.RPAREN)) break;

            // Check for direction
            if (
                this.check(TokenType.INPUT) ||
                this.check(TokenType.OUTPUT) ||
                this.check(TokenType.INOUT)
            ) {
                currentDirection = this.advance().value as PortDirection;
                currentType = undefined; // Reset type when direction changes
            }

            // Check for data type
            if (this.isDataType()) {
                currentType = this.parseDataType();
            } else {
                // Default type is logic
                currentType ??= this.createDefaultLogicType();
            }

            const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected port name');

            // Check for array dimensions after port name
            let portType = { ...currentType };
            if (this.check(TokenType.LBRACKET)) {
                portType = this.parseArrayDimensions(portType);
            }

            ports.push({
                kind: 'PortDecl',
                direction: currentDirection,
                name: nameToken.value,
                dataType: portType,
                location: createLocation(
                    nameToken.location.start,
                    this.previousToken().location.end,
                    nameToken.location.file
                ),
            });
        } while (this.match(TokenType.COMMA));

        return ports;
    }

    /**
     * Creates a default logic type
     */
    private createDefaultLogicType(): SvDataType {
        const loc = this.currentToken().location;
        return {
            kind: 'DataType',
            baseType: 'logic',
            location: loc,
        };
    }

    /**
     * Parses a module item
     */
    private parseModuleItem(): SvModuleItem | null {
        // Variable/Net declarations
        if (this.check(TokenType.LOGIC) || this.check(TokenType.REG) || this.check(TokenType.BIT)) {
            return this.parseVariableDecl();
        }
        if (this.check(TokenType.WIRE) || this.check(TokenType.TRI)) {
            return this.parseNetDecl();
        }
        if (this.check(TokenType.INTEGER) || this.check(TokenType.INT)) {
            return this.parseVariableDecl();
        }

        // Always blocks
        if (
            this.check(TokenType.ALWAYS) ||
            this.check(TokenType.ALWAYS_FF) ||
            this.check(TokenType.ALWAYS_COMB) ||
            this.check(TokenType.ALWAYS_LATCH)
        ) {
            return this.parseAlways();
        }

        // Continuous assignment
        if (this.check(TokenType.ASSIGN)) {
            return this.parseContinuousAssign();
        }

        // Parameter/localparam declarations in module body
        if (this.check(TokenType.PARAMETER) || this.check(TokenType.LOCALPARAM)) {
            return this.parseParameterDecl();
        }

        // Generate block
        if (this.check(TokenType.GENERATE)) {
            return this.parseGenerateBlock();
        }

        // Typedef
        if (this.check(TokenType.TYPEDEF)) {
            return this.parseTypedef();
        }

        // Enum (standalone)
        if (this.check(TokenType.ENUM)) {
            return this.parseEnumDecl();
        }

        // Struct (standalone)
        if (this.check(TokenType.STRUCT)) {
            return this.parseStructDecl();
        }

        // Module instantiation
        if (this.check(TokenType.IDENTIFIER)) {
            return this.parseModuleInst();
        }

        // Unknown - skip with error
        this.reportError(
            ParserErrorCodes.UNEXPECTED_TOKEN,
            `Unexpected token '${this.currentToken().value}' in module body`
        );
        this.advance();
        return null;
    }

    // ========== Declaration Parsing ==========

    /**
     * Parses a variable declaration (supports multiple variable names)
     */
    private parseVariableDecl(): SvVariableDecl {
        const startToken = this.currentToken();
        const dataType = this.parseDataType();

        // Parse multiple variable names separated by commas
        const names: string[] = [];
        do {
            const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected variable name');
            names.push(nameToken.value);
        } while (this.match(TokenType.COMMA));

        // Parse array dimensions after last name (applies to all vars)
        let finalType = dataType;
        if (this.check(TokenType.LBRACKET)) {
            finalType = this.parseArrayDimensions(dataType);
        }

        let initialValue: SvExpr | undefined;
        if (this.match(TokenType.EQ)) {
            initialValue = this.parseExpression();
        }

        this.consume(TokenType.SEMICOLON, "Expected ';' after variable declaration");

        return {
            kind: 'VariableDecl',
            names,
            dataType: finalType,
            initialValue,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a net declaration (supports multiple variable names)
     */
    private parseNetDecl(): SvNetDecl {
        const startToken = this.currentToken();
        const netType = this.advance().value as 'wire' | 'tri';

        let dataType: SvDataType;
        if (this.isDataType() || this.check(TokenType.LBRACKET)) {
            dataType = this.parseDataType();
        } else {
            dataType = this.createDefaultLogicType();
        }

        // Parse multiple variable names separated by commas
        const names: string[] = [];
        do {
            const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected net name');
            names.push(nameToken.value);
        } while (this.match(TokenType.COMMA));

        // Parse array dimensions after last name (applies to all nets)
        let finalType = dataType;
        if (this.check(TokenType.LBRACKET)) {
            finalType = this.parseArrayDimensions(dataType);
        }

        let initialValue: SvExpr | undefined;
        if (this.match(TokenType.EQ)) {
            initialValue = this.parseExpression();
        }

        this.consume(TokenType.SEMICOLON, "Expected ';' after net declaration");

        return {
            kind: 'NetDecl',
            names,
            netType,
            dataType: finalType,
            initialValue,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a parameter declaration in module body
     */
    private parseParameterDecl(): SvModuleItem {
        const param = this.parseParameter();
        this.consume(TokenType.SEMICOLON, "Expected ';' after parameter");
        return param as unknown as SvModuleItem;
    }

    // ========== Type Parsing ==========

    /**
     * Checks if current token starts a data type
     */
    private isDataType(): boolean {
        return (
            this.check(TokenType.LOGIC) ||
            this.check(TokenType.REG) ||
            this.check(TokenType.WIRE) ||
            this.check(TokenType.BIT) ||
            this.check(TokenType.INTEGER) ||
            this.check(TokenType.INT) ||
            this.check(TokenType.SHORTINT) ||
            this.check(TokenType.LONGINT) ||
            this.check(TokenType.BYTE) ||
            this.check(TokenType.REAL) ||
            this.check(TokenType.SHORTREAL) ||
            this.check(TokenType.TIME) ||
            this.check(TokenType.STRING_TYPE) ||
            this.check(TokenType.VOID) ||
            this.check(TokenType.SIGNED) ||
            this.check(TokenType.UNSIGNED) ||
            this.check(TokenType.LBRACKET)
        );
    }

    /**
     * Parses a data type
     */
    private parseDataType(): SvDataType {
        const startToken = this.currentToken();
        let baseType: BaseType = 'logic';
        let signed: boolean | undefined;
        let msb: SvExpr | undefined;
        let lsb: SvExpr | undefined;

        // Check for signed/unsigned first
        if (this.match(TokenType.SIGNED)) {
            signed = true;
        } else if (this.match(TokenType.UNSIGNED)) {
            signed = false;
        }

        // Parse base type
        if (this.check(TokenType.LOGIC)) {
            this.advance();
            baseType = 'logic';
        } else if (this.check(TokenType.REG)) {
            this.advance();
            baseType = 'reg';
        } else if (this.check(TokenType.WIRE)) {
            this.advance();
            baseType = 'wire';
        } else if (this.check(TokenType.BIT)) {
            this.advance();
            baseType = 'bit';
        } else if (this.check(TokenType.INTEGER)) {
            this.advance();
            baseType = 'integer';
        } else if (this.check(TokenType.INT)) {
            this.advance();
            baseType = 'int';
        } else if (this.check(TokenType.SHORTINT)) {
            this.advance();
            baseType = 'shortint';
        } else if (this.check(TokenType.LONGINT)) {
            this.advance();
            baseType = 'longint';
        } else if (this.check(TokenType.BYTE)) {
            this.advance();
            baseType = 'byte';
        } else if (this.check(TokenType.REAL)) {
            this.advance();
            baseType = 'real';
        } else if (this.check(TokenType.SHORTREAL)) {
            this.advance();
            baseType = 'shortreal';
        } else if (this.check(TokenType.TIME)) {
            this.advance();
            baseType = 'time';
        } else if (this.check(TokenType.STRING_TYPE)) {
            this.advance();
            baseType = 'string';
        } else if (this.check(TokenType.VOID)) {
            this.advance();
            baseType = 'void';
        }

        // Check for signed/unsigned after type
        if (signed === undefined) {
            if (this.match(TokenType.SIGNED)) {
                signed = true;
            } else if (this.match(TokenType.UNSIGNED)) {
                signed = false;
            }
        }

        // Parse packed dimensions [msb:lsb]
        if (this.check(TokenType.LBRACKET)) {
            this.advance();
            msb = this.parseExpression();
            this.consume(TokenType.COLON, "Expected ':' in range");
            lsb = this.parseExpression();
            this.consume(TokenType.RBRACKET, "Expected ']' after range");
        }

        return {
            kind: 'DataType',
            baseType,
            signed,
            msb,
            lsb,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses array dimensions after a declaration
     */
    private parseArrayDimensions(baseType: SvDataType): SvDataType {
        const dimensions: SvExpr[] = [];

        while (this.check(TokenType.LBRACKET)) {
            this.advance();
            const expr = this.parseExpression();

            // Check if it's a range [msb:lsb] or size [n]
            if (this.check(TokenType.COLON)) {
                this.advance();
                const lsb = this.parseExpression();
                dimensions.push(expr); // This case needs more sophisticated handling
                dimensions.push(lsb);
            } else {
                dimensions.push(expr);
            }

            this.consume(TokenType.RBRACKET, "Expected ']'");
        }

        return {
            ...baseType,
            dimensions: dimensions.length > 0 ? dimensions : undefined,
        };
    }

    /**
     * Parses a typedef declaration
     */
    private parseTypedef(): SvTypedefDecl {
        const startToken = this.consume(TokenType.TYPEDEF, "Expected 'typedef'");

        let targetType: SvDataType | SvEnumDecl | SvStructDecl;

        if (this.check(TokenType.ENUM)) {
            targetType = this.parseEnumDecl(true);
        } else if (this.check(TokenType.STRUCT)) {
            targetType = this.parseStructDecl(true);
        } else {
            targetType = this.parseDataType();
        }

        const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected typedef name');
        this.consume(TokenType.SEMICOLON, "Expected ';' after typedef");

        return {
            kind: 'TypedefDecl',
            name: nameToken.value,
            targetType,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses an enum declaration
     */
    private parseEnumDecl(isInTypedef = false): SvEnumDecl {
        const startToken = this.consume(TokenType.ENUM, "Expected 'enum'");

        let baseType: SvDataType | undefined;
        if (this.isDataType()) {
            baseType = this.parseDataType();
        }

        this.consume(TokenType.LBRACE, "Expected '{' in enum");

        const members: { name: string; value?: SvExpr }[] = [];
        do {
            const memberName = this.consume(TokenType.IDENTIFIER, 'Expected enum member name');
            let value: SvExpr | undefined;
            if (this.match(TokenType.EQ)) {
                value = this.parseExpression();
            }
            members.push({ name: memberName.value, value });
        } while (this.match(TokenType.COMMA));

        this.consume(TokenType.RBRACE, "Expected '}' after enum members");

        let name: string | undefined;
        if (!isInTypedef && this.check(TokenType.IDENTIFIER)) {
            name = this.advance().value;
            this.consume(TokenType.SEMICOLON, "Expected ';' after enum");
        } else if (!isInTypedef) {
            this.consume(TokenType.SEMICOLON, "Expected ';' after enum");
        }

        return {
            kind: 'EnumDecl',
            name,
            baseType,
            members,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a struct declaration
     */
    private parseStructDecl(isInTypedef = false): SvStructDecl {
        const startToken = this.consume(TokenType.STRUCT, "Expected 'struct'");

        let packed: boolean | undefined;
        if (this.match(TokenType.PACKED)) {
            packed = true;
        }

        this.consume(TokenType.LBRACE, "Expected '{' in struct");

        const members: { name: string; dataType: SvDataType }[] = [];
        while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
            const dataType = this.parseDataType();
            const memberName = this.consume(TokenType.IDENTIFIER, 'Expected struct member name');
            this.consume(TokenType.SEMICOLON, "Expected ';' after struct member");
            members.push({ name: memberName.value, dataType });
        }

        this.consume(TokenType.RBRACE, "Expected '}' after struct members");

        let name: string | undefined;
        if (!isInTypedef && this.check(TokenType.IDENTIFIER)) {
            name = this.advance().value;
            this.consume(TokenType.SEMICOLON, "Expected ';' after struct");
        } else if (!isInTypedef) {
            this.consume(TokenType.SEMICOLON, "Expected ';' after struct");
        }

        return {
            kind: 'StructDecl',
            name,
            packed,
            members,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    // ========== Statement Parsing ==========

    /**
     * Parses an always block
     */
    private parseAlways(): SvAlwaysStmt {
        const startToken = this.currentToken();
        let alwaysType: AlwaysType;

        if (this.match(TokenType.ALWAYS)) {
            alwaysType = 'always';
        } else if (this.match(TokenType.ALWAYS_FF)) {
            alwaysType = 'always_ff';
        } else if (this.match(TokenType.ALWAYS_COMB)) {
            alwaysType = 'always_comb';
        } else if (this.match(TokenType.ALWAYS_LATCH)) {
            alwaysType = 'always_latch';
        } else {
            throw new Error('Expected always keyword');
        }

        let sensitivity: SvSensitivityList | undefined;
        if (this.match(TokenType.AT)) {
            sensitivity = this.parseSensitivityList();
        }

        const body = this.parseStatement();

        return {
            kind: 'AlwaysStmt',
            alwaysType,
            sensitivity,
            body,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a sensitivity list
     */
    private parseSensitivityList(): SvSensitivityList {
        const startToken = this.currentToken();

        if (this.match(TokenType.STAR)) {
            return {
                kind: 'SensitivityList',
                items: [],
                isWildcard: true,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        }

        this.consume(TokenType.LPAREN, "Expected '(' or '*' after '@'");

        // Check for (*)
        if (this.match(TokenType.STAR)) {
            this.consume(TokenType.RPAREN, "Expected ')' after '*'");
            return {
                kind: 'SensitivityList',
                items: [],
                isWildcard: true,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        }

        const items: SvSensitivityItem[] = [];
        do {
            items.push(this.parseSensitivityItem());
        } while (this.match(TokenType.OR) || this.match(TokenType.COMMA));

        this.consume(TokenType.RPAREN, "Expected ')' after sensitivity list");

        return {
            kind: 'SensitivityList',
            items,
            isWildcard: false,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a sensitivity item
     */
    private parseSensitivityItem(): SvSensitivityItem {
        const startToken = this.currentToken();
        let edge: EdgeType = 'none';

        if (this.match(TokenType.POSEDGE)) {
            edge = 'posedge';
        } else if (this.match(TokenType.NEGEDGE)) {
            edge = 'negedge';
        }

        const signal = this.parseExpression();

        return {
            kind: 'SensitivityItem',
            edge,
            signal,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a continuous assign statement
     */
    private parseContinuousAssign(): SvContinuousAssign {
        const startToken = this.consume(TokenType.ASSIGN, "Expected 'assign'");
        const target = this.parseExpression();
        this.consume(TokenType.EQ, "Expected '=' in assign");
        const value = this.parseExpression();
        this.consume(TokenType.SEMICOLON, "Expected ';' after assign");

        return {
            kind: 'ContinuousAssign',
            target,
            value,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a statement
     */
    private parseStatement(): SvStmt {
        // Block statement
        if (this.check(TokenType.BEGIN)) {
            return this.parseBlockStmt();
        }

        // If statement
        if (this.check(TokenType.IF)) {
            return this.parseIfStmt();
        }

        // Case statement
        if (
            this.check(TokenType.CASE) ||
            this.check(TokenType.CASEZ) ||
            this.check(TokenType.CASEX)
        ) {
            return this.parseCaseStmt();
        }

        // For statement
        if (this.check(TokenType.FOR)) {
            return this.parseForStmt();
        }

        // While statement
        if (this.check(TokenType.WHILE)) {
            return this.parseWhileStmt();
        }

        // Variable declaration in procedural block
        if (this.isDataType()) {
            return this.parseVariableDecl();
        }

        // Assignment or expression statement
        return this.parseAssignment();
    }

    /**
     * Parses a block statement (begin...end)
     */
    private parseBlockStmt(): SvBlockStmt {
        const startToken = this.consume(TokenType.BEGIN, "Expected 'begin'");

        let label: string | undefined;
        if (this.match(TokenType.COLON)) {
            label = this.consume(TokenType.IDENTIFIER, 'Expected block label').value;
        }

        const statements: SvStmt[] = [];
        while (!this.check(TokenType.END) && !this.isAtEnd()) {
            statements.push(this.parseStatement());
        }

        this.consume(TokenType.END, "Expected 'end'");

        // Optional end label
        if (this.match(TokenType.COLON)) {
            this.consume(TokenType.IDENTIFIER, 'Expected end label');
        }

        return {
            kind: 'BlockStmt',
            label,
            statements,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses an if statement
     */
    private parseIfStmt(): SvIfStmt {
        const startToken = this.consume(TokenType.IF, "Expected 'if'");
        this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
        const condition = this.parseExpression();
        this.consume(TokenType.RPAREN, "Expected ')' after condition");

        const thenBranch = this.parseStatement();

        let elseBranch: SvStmt | undefined;
        if (this.match(TokenType.ELSE)) {
            elseBranch = this.parseStatement();
        }

        return {
            kind: 'IfStmt',
            condition,
            thenBranch,
            elseBranch,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a case statement
     */
    private parseCaseStmt(): SvCaseStmt {
        const startToken = this.currentToken();
        let caseType: CaseType;

        if (this.match(TokenType.CASE)) {
            caseType = 'case';
        } else if (this.match(TokenType.CASEZ)) {
            caseType = 'casez';
        } else if (this.match(TokenType.CASEX)) {
            caseType = 'casex';
        } else {
            throw new Error('Expected case keyword');
        }

        this.consume(TokenType.LPAREN, "Expected '(' after case");
        const expr = this.parseExpression();
        this.consume(TokenType.RPAREN, "Expected ')' after case expression");

        const items: SvCaseItem[] = [];
        let defaultItem: SvStmt | undefined;

        while (!this.check(TokenType.ENDCASE) && !this.isAtEnd()) {
            if (this.match(TokenType.DEFAULT)) {
                this.consume(TokenType.COLON, "Expected ':' after default");
                defaultItem = this.parseStatement();
            } else {
                items.push(this.parseCaseItem());
            }
        }

        this.consume(TokenType.ENDCASE, "Expected 'endcase'");

        return {
            kind: 'CaseStmt',
            caseType,
            expr,
            items,
            defaultItem,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a case item
     */
    private parseCaseItem(): SvCaseItem {
        const startToken = this.currentToken();
        const patterns: SvExpr[] = [];

        do {
            patterns.push(this.parseExpression());
        } while (this.match(TokenType.COMMA));

        this.consume(TokenType.COLON, "Expected ':' after case patterns");
        const body = this.parseStatement();

        return {
            kind: 'CaseItem',
            patterns,
            body,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a for statement
     */
    private parseForStmt(): SvForStmt {
        const startToken = this.consume(TokenType.FOR, "Expected 'for'");
        this.consume(TokenType.LPAREN, "Expected '(' after 'for'");

        // Init
        let init: SvStmt | undefined;
        if (!this.check(TokenType.SEMICOLON)) {
            if (this.isDataType()) {
                init = this.parseVariableDecl();
            } else {
                init = this.parseAssignment();
            }
        } else {
            this.advance();
        }

        // Condition
        let condition: SvExpr | undefined;
        if (!this.check(TokenType.SEMICOLON)) {
            condition = this.parseExpression();
        }
        this.consume(TokenType.SEMICOLON, "Expected ';' after for condition");

        // Update
        let update: SvStmt | undefined;
        if (!this.check(TokenType.RPAREN)) {
            update = this.parseAssignmentNoSemicolon();
        }

        this.consume(TokenType.RPAREN, "Expected ')' after for clauses");

        const body = this.parseStatement();

        return {
            kind: 'ForStmt',
            init,
            condition,
            update,
            body,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a while statement
     */
    private parseWhileStmt(): SvWhileStmt {
        const startToken = this.consume(TokenType.WHILE, "Expected 'while'");
        this.consume(TokenType.LPAREN, "Expected '(' after 'while'");
        const condition = this.parseExpression();
        this.consume(TokenType.RPAREN, "Expected ')' after condition");

        const body = this.parseStatement();

        return {
            kind: 'WhileStmt',
            condition,
            body,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses an assignment statement
     */
    private parseAssignment(): SvStmt {
        const startToken = this.currentToken();

        // First, parse only the lvalue (prefix expression: unary + postfix)
        // This stops before binary operators like <=
        let left = this.parsePrefix();

        // Check for assignment operators immediately after lvalue
        if (this.match(TokenType.EQ)) {
            const value = this.parseExpression();
            this.consume(TokenType.SEMICOLON, "Expected ';' after assignment");
            return {
                kind: 'BlockingAssign',
                target: left,
                value,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        } else if (this.match(TokenType.LT_EQ)) {
            const value = this.parseExpression();
            this.consume(TokenType.SEMICOLON, "Expected ';' after assignment");
            return {
                kind: 'NonBlockingAssign',
                target: left,
                value,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        }

        // Not an assignment - continue parsing as full expression
        // Continue parsing binary operators from where we left off
        left = this.continueParsingBinary(left);

        // Expression statement (like function call)
        this.consume(TokenType.SEMICOLON, "Expected ';' after expression");
        return {
            kind: 'BlockingAssign',
            target: left,
            value: left, // Expression as statement
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Continues parsing binary operators from an existing left operand
     */
    private continueParsingBinary(left: SvExpr): SvExpr {
        while (true) {
            const opInfo = getBinaryOpInfo(this.currentToken().type);
            if (!opInfo || opInfo.precedence < Precedence.CONDITIONAL) {
                break;
            }

            // Handle ternary conditional operator
            if (this.currentToken().type === TokenType.QUESTION) {
                left = this.parseConditional(left);
                continue;
            }

            const opToken = this.advance();
            const op = tokenTypeToBinaryOp(opToken.type);
            if (!op) {
                break;
            }

            // For left-associative, use precedence + 1; for right-associative, use same precedence
            const nextPrecedence = opInfo.precedence + 1;
            const right = this.parsePrecedence(nextPrecedence);

            left = createBinaryExpr(
                op,
                left,
                right,
                createLocation(left.location.start, right.location.end, left.location.file)
            );
        }

        return left;
    }

    /**
     * Parses an assignment without consuming semicolon (for for-loop update)
     */
    private parseAssignmentNoSemicolon(): SvStmt {
        const startToken = this.currentToken();
        const target = this.parseExpression();

        if (this.match(TokenType.EQ)) {
            const value = this.parseExpression();
            return {
                kind: 'BlockingAssign',
                target,
                value,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        } else if (this.match(TokenType.LT_EQ)) {
            const value = this.parseExpression();
            return {
                kind: 'NonBlockingAssign',
                target,
                value,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        }

        // Just expression
        return {
            kind: 'BlockingAssign',
            target,
            value: target,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    // ========== Module Instantiation ==========

    /**
     * Parses a module instantiation
     */
    private parseModuleInst(): SvModuleInst {
        const startToken = this.currentToken();
        const moduleName = this.consume(TokenType.IDENTIFIER, 'Expected module name').value;

        // Parse parameter overrides #(...)
        const parameters: { name?: string; value: SvExpr }[] = [];
        if (this.match(TokenType.HASH)) {
            this.consume(TokenType.LPAREN, "Expected '(' after '#'");
            if (!this.check(TokenType.RPAREN)) {
                do {
                    if (this.match(TokenType.DOT)) {
                        const name = this.consume(
                            TokenType.IDENTIFIER,
                            'Expected parameter name'
                        ).value;
                        this.consume(TokenType.LPAREN, "Expected '(' after parameter name");
                        const value = this.parseExpression();
                        this.consume(TokenType.RPAREN, "Expected ')' after parameter value");
                        parameters.push({ name, value });
                    } else {
                        const value = this.parseExpression();
                        parameters.push({ value });
                    }
                } while (this.match(TokenType.COMMA));
            }
            this.consume(TokenType.RPAREN, "Expected ')' after parameters");
        }

        const instanceName = this.consume(TokenType.IDENTIFIER, 'Expected instance name').value;

        // Parse port connections (...)
        const connections: { portName?: string; expr?: SvExpr }[] = [];
        this.consume(TokenType.LPAREN, "Expected '(' for port connections");
        if (!this.check(TokenType.RPAREN)) {
            do {
                if (this.match(TokenType.DOT)) {
                    const portName = this.consume(TokenType.IDENTIFIER, 'Expected port name').value;
                    this.consume(TokenType.LPAREN, "Expected '(' after port name");
                    let expr: SvExpr | undefined;
                    if (!this.check(TokenType.RPAREN)) {
                        expr = this.parseExpression();
                    }
                    this.consume(TokenType.RPAREN, "Expected ')' after port connection");
                    connections.push({ portName, expr });
                } else if (!this.check(TokenType.RPAREN) && !this.check(TokenType.COMMA)) {
                    const expr = this.parseExpression();
                    connections.push({ expr });
                }
            } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RPAREN, "Expected ')' after port connections");
        this.consume(TokenType.SEMICOLON, "Expected ';' after instance");

        return {
            kind: 'ModuleInst',
            moduleName,
            instanceName,
            parameters,
            connections,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    // ========== Generate Block Parsing ==========

    /**
     * Parses a generate block
     */
    private parseGenerateBlock(): SvGenerateBlock {
        const startToken = this.consume(TokenType.GENERATE, "Expected 'generate'");
        const items: SvGenerateItem[] = [];

        while (!this.check(TokenType.ENDGENERATE) && !this.isAtEnd()) {
            const item = this.parseGenerateItem();
            if (item) {
                items.push(item);
            }
        }

        const endToken = this.consume(TokenType.ENDGENERATE, "Expected 'endgenerate'");

        return {
            kind: 'GenerateBlock',
            items,
            location: createLocation(
                startToken.location.start,
                endToken.location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a generate item (if, for, or regular module item)
     */
    private parseGenerateItem(): SvGenerateItem | null {
        // Generate if
        if (this.check(TokenType.IF)) {
            return this.parseGenerateIf();
        }

        // Generate for
        if (this.check(TokenType.FOR)) {
            return this.parseGenerateFor();
        }

        // Regular module items are also valid in generate blocks
        return this.parseModuleItem();
    }

    /**
     * Parses a generate if statement
     */
    private parseGenerateIf(): SvGenerateIf {
        const startToken = this.consume(TokenType.IF, "Expected 'if'");
        this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
        const condition = this.parseExpression();
        this.consume(TokenType.RPAREN, "Expected ')' after condition");

        // Parse then block
        const thenBlock = this.parseGenerateBody();

        // Parse else block if present
        let elseBlock: SvGenerateItem[] | undefined;
        if (this.match(TokenType.ELSE)) {
            elseBlock = this.parseGenerateBody();
        }

        return {
            kind: 'GenerateIf',
            condition,
            thenBlock,
            elseBlock,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses a generate for statement
     */
    private parseGenerateFor(): SvGenerateFor {
        const startToken = this.consume(TokenType.FOR, "Expected 'for'");
        this.consume(TokenType.LPAREN, "Expected '(' after 'for'");

        // Parse genvar declaration or assignment
        let init: SvStmt;
        if (this.match(TokenType.GENVAR)) {
            // genvar i = 0
            const nameToken = this.consume(TokenType.IDENTIFIER, 'Expected genvar name');
            this.consume(TokenType.EQ, "Expected '=' in genvar initialization");
            const initValue = this.parseExpression();
            init = {
                kind: 'BlockingAssign',
                target: createIdentifier(nameToken.value, nameToken.location),
                value: initValue,
                location: createLocation(
                    nameToken.location.start,
                    this.previousToken().location.end,
                    nameToken.location.file
                ),
            };
        } else {
            init = this.parseAssignmentNoSemicolon();
        }
        this.consume(TokenType.SEMICOLON, "Expected ';' after for init");

        // Condition
        const condition = this.parseExpression();
        this.consume(TokenType.SEMICOLON, "Expected ';' after for condition");

        // Update
        const update = this.parseAssignmentNoSemicolon();
        this.consume(TokenType.RPAREN, "Expected ')' after for clauses");

        // Parse body
        let label: string | undefined;
        const body = this.parseGenerateBody();

        // Check for optional label after begin
        // Note: label is typically at the end of 'begin : label_name'

        return {
            kind: 'GenerateFor',
            init,
            condition,
            update,
            label,
            body,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses the body of a generate if/for (begin...end block or single item)
     */
    private parseGenerateBody(): SvGenerateItem[] {
        const items: SvGenerateItem[] = [];

        if (this.match(TokenType.BEGIN)) {
            // Optional label after begin
            if (this.match(TokenType.COLON)) {
                this.consume(TokenType.IDENTIFIER, 'Expected block label');
            }

            while (!this.check(TokenType.END) && !this.isAtEnd()) {
                const item = this.parseGenerateItem();
                if (item) {
                    items.push(item);
                }
            }
            this.consume(TokenType.END, "Expected 'end'");

            // Optional end label
            if (this.match(TokenType.COLON)) {
                this.consume(TokenType.IDENTIFIER, 'Expected end label');
            }
        } else {
            // Single item without begin...end
            const item = this.parseGenerateItem();
            if (item) {
                items.push(item);
            }
        }

        return items;
    }

    // ========== Expression Parsing (Pratt Parser) ==========

    /**
     * Parses an expression using Pratt parsing
     */
    parseExpression(): SvExpr {
        return this.parsePrecedence(Precedence.CONDITIONAL);
    }

    /**
     * Parses with given precedence level
     */
    private parsePrecedence(minPrecedence: Precedence): SvExpr {
        let left = this.parsePrefix();

        while (true) {
            const opInfo = getBinaryOpInfo(this.currentToken().type);
            if (!opInfo || opInfo.precedence < minPrecedence) {
                break;
            }

            // Handle ternary conditional operator
            if (this.currentToken().type === TokenType.QUESTION) {
                left = this.parseConditional(left);
                continue;
            }

            const opToken = this.advance();
            const op = tokenTypeToBinaryOp(opToken.type);
            if (!op) {
                break;
            }

            // For left-associative, use precedence + 1; for right-associative, use same precedence
            const nextPrecedence = opInfo.precedence + 1;
            const right = this.parsePrecedence(nextPrecedence);

            left = createBinaryExpr(
                op,
                left,
                right,
                createLocation(left.location.start, right.location.end, left.location.file)
            );
        }

        return left;
    }

    /**
     * Parses prefix expressions (unary, primary)
     */
    private parsePrefix(): SvExpr {
        // Unary operators
        if (isUnaryPrefixOp(this.currentToken().type)) {
            const opToken = this.advance();
            const op = tokenTypeToUnaryOp(opToken.type);
            if (op) {
                const operand = this.parsePrefix();
                return createUnaryExpr(
                    op,
                    operand,
                    createLocation(
                        opToken.location.start,
                        operand.location.end,
                        opToken.location.file
                    )
                );
            }
        }

        return this.parsePostfix();
    }

    /**
     * Parses postfix expressions (index, member, call)
     */
    private parsePostfix(): SvExpr {
        let expr = this.parsePrimary();

        while (true) {
            if (this.check(TokenType.LBRACKET)) {
                expr = this.parseIndexOrSlice(expr);
            } else if (this.check(TokenType.DOT)) {
                this.advance();
                const member = this.consume(TokenType.IDENTIFIER, 'Expected member name').value;
                expr = {
                    kind: 'MemberExpr',
                    object: expr,
                    member,
                    location: createLocation(
                        expr.location.start,
                        this.previousToken().location.end,
                        expr.location.file
                    ),
                };
            } else if (this.check(TokenType.LPAREN) && expr.kind === 'Identifier') {
                // Function call
                this.advance();
                const args: SvExpr[] = [];
                if (!this.check(TokenType.RPAREN)) {
                    do {
                        args.push(this.parseExpression());
                    } while (this.match(TokenType.COMMA));
                }
                this.consume(TokenType.RPAREN, "Expected ')' after arguments");
                expr = {
                    kind: 'CallExpr',
                    callee: expr,
                    args,
                    location: createLocation(
                        expr.location.start,
                        this.previousToken().location.end,
                        expr.location.file
                    ),
                };
            } else {
                break;
            }
        }

        return expr;
    }

    /**
     * Parses index or slice expression
     */
    private parseIndexOrSlice(base: SvExpr): SvExpr {
        this.consume(TokenType.LBRACKET, "Expected '['");
        const index = this.parseExpression();

        if (this.match(TokenType.COLON)) {
            // Slice: base[msb:lsb]
            const lsb = this.parseExpression();
            this.consume(TokenType.RBRACKET, "Expected ']'");
            return {
                kind: 'SliceExpr',
                base,
                msb: index,
                lsb,
                location: createLocation(
                    base.location.start,
                    this.previousToken().location.end,
                    base.location.file
                ),
            };
        }

        this.consume(TokenType.RBRACKET, "Expected ']'");
        return {
            kind: 'IndexExpr',
            base,
            index,
            location: createLocation(
                base.location.start,
                this.previousToken().location.end,
                base.location.file
            ),
        };
    }

    /**
     * Parses primary expressions
     */
    private parsePrimary(): SvExpr {
        const token = this.currentToken();

        // Number literal
        if (this.check(TokenType.NUMBER)) {
            this.advance();
            return this.parseNumberLiteral(token);
        }

        // String literal
        if (this.check(TokenType.STRING)) {
            this.advance();
            return {
                kind: 'StringLiteral',
                value: token.value.slice(1, -1), // Remove quotes
                location: token.location,
            };
        }

        // Identifier
        if (this.check(TokenType.IDENTIFIER)) {
            this.advance();
            return createIdentifier(token.value, token.location);
        }

        // System identifier
        if (this.check(TokenType.SYSTEM_IDENTIFIER)) {
            this.advance();
            return createIdentifier(token.value, token.location);
        }

        // Parenthesized expression
        if (this.match(TokenType.LPAREN)) {
            const expr = this.parseExpression();
            this.consume(TokenType.RPAREN, "Expected ')'");
            return {
                kind: 'ParenExpr',
                expr,
                location: createLocation(
                    token.location.start,
                    this.previousToken().location.end,
                    token.location.file
                ),
            };
        }

        // Concatenation {a, b, c}
        if (this.match(TokenType.LBRACE)) {
            return this.parseConcatOrReplicate(token);
        }

        // Error: unexpected token
        this.reportError(
            ParserErrorCodes.UNEXPECTED_TOKEN,
            `Unexpected token '${token.value}' in expression`
        );
        this.advance();
        return createIdentifier('__error__', token.location);
    }

    /**
     * Parses a number literal from token
     */
    private parseNumberLiteral(token: Token): SvExpr {
        const value = token.value;
        let size: number | undefined;
        let base: 'b' | 'o' | 'd' | 'h' | undefined;
        let signed: boolean | undefined;
        let digits = value;

        // Parse sized number (e.g., 8'hFF)
        const sizedMatch = /^(\d+)'([sS])?([bBoOdDhH])(.*)$/.exec(value);
        if (sizedMatch) {
            size = parseInt(sizedMatch[1], 10);
            signed = sizedMatch[2] !== undefined;
            base = sizedMatch[3].toLowerCase() as 'b' | 'o' | 'd' | 'h';
            digits = sizedMatch[4];
        } else {
            // Unsized based number (e.g., 'hFF)
            const unsizedMatch = /^'([sS])?([bBoOdDhH])(.*)$/.exec(value);
            if (unsizedMatch) {
                signed = unsizedMatch[1] !== undefined;
                base = unsizedMatch[2].toLowerCase() as 'b' | 'o' | 'd' | 'h';
                digits = unsizedMatch[3];
            }
        }

        return createNumberLiteral(digits.replace(/_/g, ''), token.location, {
            size,
            base,
            signed,
        });
    }

    /**
     * Parses concatenation or replication expression
     */
    private parseConcatOrReplicate(startToken: Token): SvExpr {
        const first = this.parseExpression();

        // Check for replication {n{expr}}
        if (this.check(TokenType.LBRACE)) {
            this.advance();
            const expr = this.parseExpression();
            this.consume(TokenType.RBRACE, "Expected '}' in replication");
            this.consume(TokenType.RBRACE, "Expected '}' after replication");
            return {
                kind: 'ReplicateExpr',
                count: first,
                expr,
                location: createLocation(
                    startToken.location.start,
                    this.previousToken().location.end,
                    startToken.location.file
                ),
            };
        }

        // Concatenation {a, b, c, ...}
        const elements: SvExpr[] = [first];
        while (this.match(TokenType.COMMA)) {
            elements.push(this.parseExpression());
        }
        this.consume(TokenType.RBRACE, "Expected '}' after concatenation");

        return {
            kind: 'ConcatExpr',
            elements,
            location: createLocation(
                startToken.location.start,
                this.previousToken().location.end,
                startToken.location.file
            ),
        };
    }

    /**
     * Parses conditional (ternary) expression
     */
    private parseConditional(condition: SvExpr): SvExpr {
        this.consume(TokenType.QUESTION, "Expected '?'");
        const thenExpr = this.parseExpression();
        this.consume(TokenType.COLON, "Expected ':' in conditional");
        const elseExpr = this.parsePrecedence(Precedence.CONDITIONAL);

        return createConditionalExpr(
            condition,
            thenExpr,
            elseExpr,
            createLocation(condition.location.start, elseExpr.location.end, condition.location.file)
        );
    }

    // ========== Token Utilities ==========

    /**
     * Returns current token
     */
    private currentToken(): Token {
        if (this.pos >= this.tokens.length) {
            return this.tokens[this.tokens.length - 1]; // EOF token
        }
        return this.tokens[this.pos];
    }

    /**
     * Returns previous token
     */
    private previousToken(): Token {
        if (this.pos === 0) {
            return this.tokens[0];
        }
        return this.tokens[this.pos - 1];
    }

    /**
     * Checks if at end of tokens
     */
    private isAtEnd(): boolean {
        return this.currentToken().type === TokenType.EOF;
    }

    /**
     * Checks if current token matches type
     */
    private check(type: TokenType): boolean {
        return this.currentToken().type === type;
    }

    /**
     * Advances and returns current token
     */
    private advance(): Token {
        if (!this.isAtEnd()) {
            this.pos++;
        }
        return this.previousToken();
    }

    /**
     * Consumes token if it matches, otherwise throws error
     */
    private consume(type: TokenType, message: string): Token {
        if (this.check(type)) {
            return this.advance();
        }
        this.reportError(ParserErrorCodes.UNEXPECTED_TOKEN, message);
        // Return a dummy token to continue parsing
        return createToken(type, '', this.currentToken().location);
    }

    /**
     * Consumes token if it matches current type
     */
    private match(type: TokenType): boolean {
        if (this.check(type)) {
            this.advance();
            return true;
        }
        return false;
    }

    /**
     * Reports a parser error
     */
    private reportError(code: number, message: string): void {
        const error = new ParserError(code, message, this.currentToken().location);
        this.reporter.reportError(error);
    }
}
