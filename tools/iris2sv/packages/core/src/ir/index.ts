/**
 * HIR (High-level Intermediate Representation) Module
 *
 * Provides the intermediate representation between IRIS AST and SystemVerilog AST.
 */

// Data types
export {
  // Node base
  HirNode,

  // Width types
  HirWidth,
  HirConstWidth,
  HirParamWidth,
  HirExprWidth,

  // Data types
  HirDataType,
  HirLogicType,
  HirEnumType,
  HirEnumVariant,
  HirStructType,
  HirStructField,
  HirArrayType,
  HirTupleType,

  // Helper functions
  createLogicType,
  createParamLogicType,
  createBoolType,
  createEnumType,
  createStructType,
  createArrayType,
  createTupleType,
  getTypeWidth,
  typesEqual,
  typeToString,
} from './types.js';

// Expressions
export {
  // Base type
  HirExprBase,
  HirExpr,

  // Expression types
  HirIntegerLiteral,
  HirBoolLiteral,
  HirEnumLiteral,
  HirIdentifier,
  HirUnaryExpr,
  HirUnaryOp,
  HirBinaryExpr,
  HirBinaryOp,
  HirConditionalExpr,
  HirConcatExpr,
  HirRepeatExpr,
  HirIndexExpr,
  HirSliceExpr,
  HirFieldExpr,
  HirCallExpr,
  HirCastExpr,
  HirParenExpr,

  // Helper functions
  createIntegerLiteral,
  createBoolLiteral,
  createIdentifier as createHirIdentifier,
  createUnaryExpr,
  createBinaryExpr,
  createConditionalExpr,
  createConcatExpr,
  createRepeatExpr,
  createIndexExpr,
  createSliceExpr,
  createFieldExpr,
  createCallExpr,
  createCastExpr,
} from './expr.js';

// Statements
export {
  // Base type
  HirStmtBase,
  HirStmt,

  // LValue types
  HirLValue,
  HirIdentifierLValue,
  HirIndexLValue,
  HirSliceLValue,
  HirFieldLValue,
  HirConcatLValue,

  // Statement types
  HirAssignStmt,
  HirNonblockingAssignStmt,
  HirIfStmt,
  HirCaseStmt,
  HirCaseItem,
  HirDefaultCase,
  HirForStmt,
  HirBlockStmt,
  HirExprStmt,
  HirVarDeclStmt,

  // Helper functions
  createIdentifierLValue,
  createIndexLValue,
  createSliceLValue,
  createFieldLValue,
  createConcatLValue,
  createAssignStmt,
  createNonblockingAssignStmt,
  createIfStmt,
  createCaseStmt,
  createForStmt,
  createBlockStmt,
  createExprStmt,
  createVarDeclStmt,
} from './stmt.js';

// Module structures
export {
  // Parameters
  HirParameter,

  // Ports
  HirPortDirection,
  HirPort,

  // Signals
  HirSignal,

  // Clock/Reset
  HirClockEdge,
  HirClockSpec,
  HirResetMode,
  HirResetSpec,

  // Logic blocks
  HirCombBlock,
  HirSeqBlock,
  HirInitialBlock,
  HirTestSeqBlock,
  HirTestSeqStmt,
  HirDelayStmt,
  HirAwaitStmt,
  HirAssertStmt,

  // FSM
  HirFsmState,
  HirFsmOutput,
  HirTransitionCondition,
  HirTransition,
  HirMealyOutput,
  HirFsm,

  // Instances
  HirConnection,
  HirInstance,

  // Functions
  HirFunctionParam,
  HirFunction,

  // Type definitions
  HirTypeDef,
  HirEnumDef,
  HirStructDef,
  HirUnionDef,
  HirInterface,
  HirModport,
  HirModportSignal,
  HirStructFieldDef,

  // Module
  HirModule,

  // Source file
  HirSourceFile,

  // Helper functions
  createParameter,
  createPort,
  createSignal,
  createClockSpec,
  createResetSpec,
  createCombBlock,
  createSeqBlock,
  createInitialBlock,
  createTestSeqBlock,
  createDelayStmt,
  createAwaitStmt,
  createAssertStmt,
  createFsm,
  createInstance,
  createFunction,
  createModule,
  createSourceFile as createHirSourceFile,
} from './module.js';
