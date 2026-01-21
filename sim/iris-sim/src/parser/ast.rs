//! Abstract Syntax Tree definitions for IRIS
//!
//! This module defines the AST nodes that represent parsed IRIS source code.

use std::fmt;

/// Source location for error reporting
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

impl Span {
    pub fn new(start_line: usize, start_col: usize, end_line: usize, end_col: usize) -> Self {
        Self {
            start_line,
            start_col,
            end_line,
            end_col,
        }
    }
}

/// Module definition
#[derive(Clone, Debug)]
pub struct Module {
    pub name: String,
    pub generics: Vec<GenericParam>,
    pub ports: Vec<Port>,
    pub signals: Vec<Signal>,
    pub logic_blocks: Vec<LogicBlock>,
    pub instances: Vec<Instance>,
    pub span: Option<Span>,
    /// True if this is a test module (declared with `test` keyword)
    pub is_test: bool,
    /// Sequential blocks (for procedural testbench code)
    pub seq_blocks: Vec<SeqBlock>,
    /// Initial blocks (executed once at simulation start)
    pub initial_blocks: Vec<InitialBlock>,
    /// Finite State Machines
    pub fsm_blocks: Vec<FsmBlock>,
    /// Memory declarations
    pub memories: Vec<MemDecl>,
}

/// Generic parameter
#[derive(Clone, Debug)]
pub struct GenericParam {
    pub name: String,
    pub ty: Type,
    pub default_value: Option<Expression>,
}

/// Port definition
#[derive(Clone, Debug)]
pub struct Port {
    pub name: String,
    pub direction: PortDirection,
    pub ty: Type,
}

/// Port direction
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortDirection {
    In,
    Out,
    InOut,
    /// Interface initiator (master)
    Initiator,
    /// Interface target (slave)
    Target,
    /// Interface monitor (passive observer)
    Monitor,
}

impl fmt::Display for PortDirection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PortDirection::In => write!(f, "in"),
            PortDirection::Out => write!(f, "out"),
            PortDirection::InOut => write!(f, "inout"),
            PortDirection::Initiator => write!(f, "initiator"),
            PortDirection::Target => write!(f, "target"),
            PortDirection::Monitor => write!(f, "monitor"),
        }
    }
}

/// Type definition
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Type {
    /// Single bit
    Bit,
    /// Bit vector with width
    BitVec { width: usize },
    /// Clock signal
    Clock,
    /// Reset signal
    Reset { active_low: bool },
    /// Array type
    Array { element: Box<Type>, size: usize },
    /// Named type (for generics or user-defined types)
    Named(String),
}

impl Type {
    /// Get the bit width of this type
    pub fn width(&self) -> Option<usize> {
        match self {
            Type::Bit => Some(1),
            Type::BitVec { width } => Some(*width),
            Type::Clock => Some(1),
            Type::Reset { .. } => Some(1),
            Type::Array { element, size } => element.width().map(|w| w * size),
            Type::Named(_) => None,
        }
    }
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Bit => write!(f, "bit"),
            Type::BitVec { width } => write!(f, "bit[{}]", width),
            Type::Clock => write!(f, "clock"),
            Type::Reset { active_low } => {
                if *active_low {
                    write!(f, "reset(active_low)")
                } else {
                    write!(f, "reset")
                }
            }
            Type::Array { element, size } => write!(f, "{}[{}]", element, size),
            Type::Named(name) => write!(f, "{}", name),
        }
    }
}

/// Signal declaration
#[derive(Clone, Debug)]
pub struct Signal {
    pub name: String,
    pub ty: Type,
    pub init_value: Option<Expression>,
    pub is_mutable: bool,
    pub is_var: bool,
}

/// Logic block
#[derive(Clone, Debug)]
pub enum LogicBlock {
    Comb(CombBlock),
    Sync(SyncBlock),
}

/// Sequential block (for procedural testbench code)
#[derive(Clone, Debug)]
pub struct SeqBlock {
    pub name: Option<String>,
    pub statements: Vec<SeqStatement>,
}

/// Initial block (executed once at simulation start)
#[derive(Clone, Debug)]
pub struct InitialBlock {
    pub statements: Vec<SeqStatement>,
}

/// Finite State Machine block
#[derive(Clone, Debug)]
pub struct FsmBlock {
    /// FSM name
    pub name: String,
    /// Clock specification
    pub clock: ClockSpec,
    /// Reset specification (optional)
    pub reset: Option<ResetSpec>,
    /// State enumeration
    pub states: Vec<FsmState>,
    /// State transitions
    pub transitions: Vec<FsmTransition>,
    /// Output mappings (Mealy-style)
    pub outputs: Vec<FsmOutput>,
}

/// FSM state definition
#[derive(Clone, Debug)]
pub struct FsmState {
    /// State name
    pub name: String,
    /// Moore outputs (output values in this state)
    pub moore_outputs: Vec<(String, Expression)>,
}

/// FSM transition definition
#[derive(Clone, Debug)]
pub struct FsmTransition {
    /// Source state name ("_" for default/wildcard)
    pub from_state: String,
    /// Conditional transitions
    pub when_clauses: Vec<FsmWhenClause>,
}

/// FSM when clause (conditional transition)
#[derive(Clone, Debug)]
pub struct FsmWhenClause {
    /// Condition for this transition
    pub condition: Expression,
    /// Actions to take (assignments and goto)
    pub actions: Vec<FsmAction>,
}

/// FSM action (within a when clause)
#[derive(Clone, Debug)]
pub enum FsmAction {
    /// Go to another state
    Goto(String),
    /// Assignment
    Assign { target: String, value: Expression },
}

/// FSM output mapping (Mealy-style)
#[derive(Clone, Debug)]
pub struct FsmOutput {
    /// Output signal name
    pub signal: String,
    /// State to value mappings
    pub mappings: Vec<(String, Expression)>,
}

/// Memory declaration
#[derive(Clone, Debug)]
pub struct MemDecl {
    /// Memory name
    pub name: String,
    /// Element type
    pub element_type: Type,
    /// Depth (number of elements)
    pub depth: usize,
    /// Configuration options
    pub config: MemConfig,
    /// Initial values (if any)
    pub init: Option<MemInit>,
}

/// Memory configuration
#[derive(Clone, Debug, Default)]
pub struct MemConfig {
    /// Number of ports (default: 1)
    pub ports: Option<usize>,
    /// Memory type (ram or rom)
    pub mem_type: Option<MemType>,
    /// Read mode (sync or async)
    pub read_mode: Option<MemReadMode>,
    /// Write mode (sync)
    pub write_mode: Option<MemWriteMode>,
    /// Initialization file path
    pub init_file: Option<String>,
}

/// Memory type
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemType {
    Ram,
    Rom,
}

/// Memory read mode
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemReadMode {
    Sync,
    Async,
}

/// Memory write mode
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemWriteMode {
    Sync,
}

/// Memory initialization
#[derive(Clone, Debug)]
pub enum MemInit {
    /// Array of values
    Values(Vec<Expression>),
    /// File path for hex/bin file
    File(String),
}

/// Interface definition
#[derive(Clone, Debug)]
pub struct Interface {
    /// Interface name
    pub name: String,
    /// Generic parameters
    pub generics: Vec<GenericParam>,
    /// Interface signals
    pub signals: Vec<InterfaceSignal>,
    /// View definitions
    pub views: Vec<ViewDef>,
}

/// Interface signal definition
#[derive(Clone, Debug)]
pub struct InterfaceSignal {
    /// Signal name
    pub name: String,
    /// Signal type
    pub ty: Type,
    /// Is logic type (optional prefix)
    pub is_logic: bool,
}

/// View definition within an interface
#[derive(Clone, Debug)]
pub struct ViewDef {
    /// View name
    pub name: String,
    /// Signal directions in this view
    pub signals: Vec<ViewSignal>,
}

/// Signal direction in a view
#[derive(Clone, Debug)]
pub struct ViewSignal {
    /// Signal name (must reference an interface signal)
    pub name: String,
    /// Direction in this view
    pub direction: ViewDirection,
}

/// Direction within a view
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewDirection {
    In,
    Out,
    InOut,
}

impl fmt::Display for ViewDirection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ViewDirection::In => write!(f, "in"),
            ViewDirection::Out => write!(f, "out"),
            ViewDirection::InOut => write!(f, "inout"),
        }
    }
}

/// Sequential statement (for seq_block / initial_block)
#[derive(Clone, Debug)]
pub enum SeqStatement {
    /// Await expression (await clk.posedge, await clk.cycles(N))
    Await(AwaitExpr),
    /// Delay statement (#10ns)
    Delay(Duration),
    /// Signal write (signal.set(expr))
    SignalWrite {
        path: SignalPath,
        value: Expression,
    },
    /// Assignment (target = value)
    Assign {
        target: String,
        value: Expression,
    },
    /// If statement
    If {
        condition: Expression,
        then_branch: Vec<SeqStatement>,
        else_branch: Option<Vec<SeqStatement>>,
    },
    /// Assert statement
    Assert(AssertStmt),
    /// Memory write (mem[addr] = value)
    MemWrite {
        mem_name: String,
        addr: Expression,
        value: Expression,
    },
    /// For loop: for i in start..end { body }
    For {
        var: String,
        range: RangeExpr,
        body: Vec<SeqStatement>,
    },
    /// While loop: while condition { body }
    While {
        condition: Expression,
        body: Vec<SeqStatement>,
    },
}

/// Await expression
#[derive(Clone, Debug)]
pub enum AwaitExpr {
    /// Clock edge (clk.posedge / clk.negedge)
    ClockEdge {
        signal: String,
        edge: ClockEdge,
    },
    /// Clock cycles (clk.cycles(N))
    ClockCycles {
        signal: String,
        count: Expression,
    },
    /// Until condition with optional timeout
    Until {
        condition: Expression,
        timeout: Option<Duration>,
    },
}

/// Signal path (e.g., dut.counter, dut.sub.signal)
#[derive(Clone, Debug)]
pub struct SignalPath {
    pub segments: Vec<String>,
}

impl SignalPath {
    pub fn to_string(&self) -> String {
        self.segments.join(".")
    }
}

/// Duration with time unit
#[derive(Clone, Debug)]
pub struct Duration {
    pub value: u64,
    pub unit: TimeUnit,
}

impl Duration {
    /// Convert to picoseconds
    pub fn to_picoseconds(&self) -> u64 {
        match self.unit {
            TimeUnit::Ps => self.value,
            TimeUnit::Ns => self.value * 1_000,
            TimeUnit::Us => self.value * 1_000_000,
            TimeUnit::Ms => self.value * 1_000_000_000,
            TimeUnit::S => self.value * 1_000_000_000_000,
        }
    }
}

/// Time unit
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeUnit {
    Ps,  // picoseconds
    Ns,  // nanoseconds
    Us,  // microseconds
    Ms,  // milliseconds
    S,   // seconds
}

impl Default for TimeUnit {
    fn default() -> Self {
        TimeUnit::Ns
    }
}

/// Assert statement
#[derive(Clone, Debug)]
pub struct AssertStmt {
    pub condition: Expression,
    pub message: Option<String>,
    /// Source location for error reporting
    pub span: Option<Span>,
}

/// Combinational logic block
#[derive(Clone, Debug)]
pub struct CombBlock {
    pub statements: Vec<Statement>,
}

/// Sequential logic block
#[derive(Clone, Debug)]
pub struct SyncBlock {
    pub clock: ClockSpec,
    pub reset: Option<ResetSpec>,
    pub statements: Vec<Statement>,
}

/// Clock specification
#[derive(Clone, Debug)]
pub struct ClockSpec {
    pub signal: String,
    pub edge: ClockEdge,
}

/// Clock edge
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockEdge {
    Posedge,
    Negedge,
}

impl fmt::Display for ClockEdge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClockEdge::Posedge => write!(f, "posedge"),
            ClockEdge::Negedge => write!(f, "negedge"),
        }
    }
}

/// Reset specification
#[derive(Clone, Debug)]
pub struct ResetSpec {
    pub signal: String,
    pub mode: ResetMode,
}

/// Reset mode
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResetMode {
    Sync,
    Async,
}

impl fmt::Display for ResetMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ResetMode::Sync => write!(f, "sync"),
            ResetMode::Async => write!(f, "async"),
        }
    }
}

/// Module instance
#[derive(Clone, Debug)]
pub struct Instance {
    pub name: String,
    pub module_name: String,
    pub generic_args: Vec<(String, Expression)>,
    pub port_connections: Vec<(String, Expression)>,
    pub array_size: Option<usize>,
}

/// Statement
#[derive(Clone, Debug)]
pub enum Statement {
    /// Assignment: target = value
    Assign {
        target: String,
        value: Expression,
    },
    /// If statement
    If {
        condition: Expression,
        then_branch: Vec<Statement>,
        else_branch: Option<Vec<Statement>>,
    },
    /// Match statement
    Match {
        expr: Expression,
        arms: Vec<MatchArm>,
    },
    /// For loop: for i in start..end { body }
    For {
        var: String,
        range: RangeExpr,
        body: Vec<Statement>,
    },
    /// While loop: while condition { body }
    While {
        condition: Expression,
        body: Vec<Statement>,
    },
}

/// Range expression for for loops
#[derive(Clone, Debug)]
pub struct RangeExpr {
    /// Start value (inclusive)
    pub start: Expression,
    /// End value
    pub end: Expression,
    /// True if end is inclusive (..=)
    pub inclusive: bool,
}

/// Match arm
#[derive(Clone, Debug)]
pub struct MatchArm {
    pub pattern: Pattern,
    pub body: Vec<Statement>,
}

/// Pattern for matching
#[derive(Clone, Debug)]
pub enum Pattern {
    /// Literal value
    Literal(Literal),
    /// Identifier (enum variant, etc.)
    Ident(String),
    /// Wildcard (_)
    Wildcard,
}

/// Expression
#[derive(Clone, Debug)]
pub enum Expression {
    /// Literal value
    Literal(Literal),
    /// Identifier
    Ident(String),
    /// Binary operation
    BinOp {
        op: BinOp,
        lhs: Box<Expression>,
        rhs: Box<Expression>,
    },
    /// Unary operation
    UnaryOp {
        op: UnaryOp,
        expr: Box<Expression>,
    },
    /// Index access: base[index]
    Index {
        base: Box<Expression>,
        index: Box<Expression>,
    },
    /// Slice access: base[high:low]
    Slice {
        base: Box<Expression>,
        high: usize,
        low: usize,
    },
    /// Method call: receiver.method(args)
    MethodCall {
        receiver: Box<Expression>,
        method: String,
        args: Vec<Expression>,
    },
    /// If expression: if cond { then } else { else }
    If {
        condition: Box<Expression>,
        then_expr: Box<Expression>,
        else_expr: Box<Expression>,
    },
    /// Concatenation: {a, b, c}
    Concat(Vec<Expression>),
    /// Memory read: mem[addr]
    MemRead {
        mem_name: String,
        addr: Box<Expression>,
    },
}

/// Literal value
#[derive(Clone, Debug)]
pub enum Literal {
    /// Binary literal: 8'b10101010
    Binary { width: usize, value: u64 },
    /// Hexadecimal literal: 8'hFF
    Hex { width: usize, value: u64 },
    /// Decimal literal: 8'd255 or just 255
    Decimal { width: Option<usize>, value: i64 },
}

impl Literal {
    /// Get the bit width of this literal
    pub fn width(&self) -> Option<usize> {
        match self {
            Literal::Binary { width, .. } => Some(*width),
            Literal::Hex { width, .. } => Some(*width),
            Literal::Decimal { width, .. } => *width,
        }
    }

    /// Get the value as u64
    pub fn to_u64(&self) -> u64 {
        match self {
            Literal::Binary { value, .. } => *value,
            Literal::Hex { value, .. } => *value,
            Literal::Decimal { value, .. } => *value as u64,
        }
    }
}

/// Binary operator
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    // Arithmetic
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    // Bitwise
    And,
    Or,
    Xor,
    Shl,
    Shr,
    // Comparison
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    // Logical
    LogicalAnd,
    LogicalOr,
}

impl fmt::Display for BinOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BinOp::Add => write!(f, "+"),
            BinOp::Sub => write!(f, "-"),
            BinOp::Mul => write!(f, "*"),
            BinOp::Div => write!(f, "/"),
            BinOp::Mod => write!(f, "%"),
            BinOp::And => write!(f, "&"),
            BinOp::Or => write!(f, "|"),
            BinOp::Xor => write!(f, "^"),
            BinOp::Shl => write!(f, "<<"),
            BinOp::Shr => write!(f, ">>"),
            BinOp::Eq => write!(f, "=="),
            BinOp::Ne => write!(f, "!="),
            BinOp::Lt => write!(f, "<"),
            BinOp::Le => write!(f, "<="),
            BinOp::Gt => write!(f, ">"),
            BinOp::Ge => write!(f, ">="),
            BinOp::LogicalAnd => write!(f, "&&"),
            BinOp::LogicalOr => write!(f, "||"),
        }
    }
}

/// Unary operator
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    /// Bitwise NOT (~)
    Not,
    /// Arithmetic negation (-)
    Neg,
    /// Logical NOT (!)
    LogNot,
}

impl fmt::Display for UnaryOp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UnaryOp::Not => write!(f, "~"),
            UnaryOp::Neg => write!(f, "-"),
            UnaryOp::LogNot => write!(f, "!"),
        }
    }
}

impl fmt::Display for Literal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Literal::Binary { width, value } => write!(f, "{}'b{:b}", width, value),
            Literal::Hex { width, value } => write!(f, "{}'h{:x}", width, value),
            Literal::Decimal { width: Some(w), value } => write!(f, "{}'d{}", w, value),
            Literal::Decimal { width: None, value } => write!(f, "{}", value),
        }
    }
}

impl fmt::Display for Expression {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expression::Literal(lit) => write!(f, "{}", lit),
            Expression::Ident(name) => write!(f, "{}", name),
            Expression::BinOp { op, lhs, rhs } => write!(f, "{} {} {}", lhs, op, rhs),
            Expression::UnaryOp { op, expr } => write!(f, "{}{}", op, expr),
            Expression::Index { base, index } => write!(f, "{}[{}]", base, index),
            Expression::Slice { base, high, low } => write!(f, "{}[{}:{}]", base, high, low),
            Expression::MethodCall { receiver, method, args } => {
                write!(f, "{}.{}(", receiver, method)?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{}", arg)?;
                }
                write!(f, ")")
            }
            Expression::If { condition, then_expr, else_expr } => {
                write!(f, "if {} {{ {} }} else {{ {} }}", condition, then_expr, else_expr)
            }
            Expression::Concat(exprs) => {
                write!(f, "{{")?;
                for (i, expr) in exprs.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{}", expr)?;
                }
                write!(f, "}}")
            }
            Expression::MemRead { mem_name, addr } => {
                write!(f, "{}[{}]", mem_name, addr)
            }
        }
    }
}
