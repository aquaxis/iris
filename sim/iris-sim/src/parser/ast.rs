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
}

impl fmt::Display for PortDirection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PortDirection::In => write!(f, "in"),
            PortDirection::Out => write!(f, "out"),
            PortDirection::InOut => write!(f, "inout"),
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
