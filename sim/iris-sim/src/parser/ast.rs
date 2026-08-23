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
    /// Declared `pub`, so other packages may import it
    pub is_public: bool,
    /// Declared `extern`: implemented outside IRIS, so it drives nothing here
    pub is_extern: bool,
    pub generics: Vec<GenericParam>,
    /// Constraints on the generic parameters, from a `where` clause
    pub where_constraints: Vec<Constraint>,
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
    /// Constraints on this module's random variables
    pub constraints: Vec<ConstraintBlock>,
}

/// A constraint on a generic parameter, such as `Depth <= 65536`
#[derive(Clone, Debug)]
pub enum Constraint {
    /// `identifier operator const_expr`, such as `Depth >= 4`
    Compare {
        param: String,
        op: BinOp,
        bound: Expression,
        span: Option<Span>,
    },
    /// `identifier : type_expr`, such as `Depth : uint`
    TypeBound {
        param: String,
        ty: Type,
        span: Option<Span>,
    },
    /// `expr . identifier ( args )`, such as `Depth.is_power_of_two()`
    Predicate {
        subject: Expression,
        method: String,
        args: Vec<Expression>,
        span: Option<Span>,
    },
}

impl Constraint {
    /// Where the constraint was written
    pub fn span(&self) -> Option<Span> {
        match self {
            Constraint::Compare { span, .. }
            | Constraint::TypeBound { span, .. }
            | Constraint::Predicate { span, .. } => span.clone(),
        }
    }
}

impl fmt::Display for Constraint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Constraint::Compare {
                param, op, bound, ..
            } => write!(f, "{} {} {}", param, op, bound),
            Constraint::TypeBound { param, ty, .. } => write!(f, "{}: {}", param, ty),
            Constraint::Predicate {
                subject,
                method,
                args,
                ..
            } => {
                let rendered: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "{}.{}({})", subject, method, rendered.join(", "))
            }
        }
    }
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
    /// Integer: `int[N]`/`iN` (signed) or `uint[N]`/`uN` (unsigned).
    /// Signedness is recorded but arithmetic is evaluated unsigned.
    Int { width: usize, signed: bool },
    /// Boolean, one bit
    Bool,
    /// Floating point (spec 03): `f32` (bits = 32) or `f64` (bits = 64).
    /// Parsed and carried, but evaluation is not implemented yet; the checker
    /// refuses a float-typed declaration rather than simulating it wrongly.
    Float { bits: usize },
    /// Bit vector whose width is a constant expression (may mention generic
    /// parameters or `$clog2`), resolved at elaboration
    BitVecExpr { expr: Box<Expression> },
    /// A user-defined enumeration, resolved from `Type::Named` at elaboration
    Enum { name: String, width: usize },
    /// Named type (for generics or user-defined types)
    Named(String),
}

/// A user-defined enumeration (spec 3.2.1)
#[derive(Clone, Debug)]
pub struct EnumDecl {
    pub name: String,
    /// Declared `pub`, so other packages may import it
    pub is_public: bool,
    /// The declared underlying type, if one was given
    pub underlying: Option<Type>,
    /// Variants in declaration order, with any explicit value
    pub variants: Vec<EnumVariant>,
    pub span: Option<Span>,
}

/// A named group of constraints on random variables (spec 11.4.2)
#[derive(Clone, Debug)]
pub struct ConstraintBlock {
    pub name: String,
    /// Every expression here must hold after a draw
    pub conditions: Vec<Expression>,
    pub span: Option<Span>,
}

/// A user-defined function (spec 12.1)
#[derive(Clone, Debug)]
pub struct FnDecl {
    pub name: String,
    /// Declared `pub`, so other packages may import it
    pub is_public: bool,
    /// Parameters in order, with their types
    pub params: Vec<(String, Type)>,
    /// The declared return type, if one was given
    pub return_type: Option<Type>,
    /// Bindings the returned expression may use, in order
    pub bindings: Vec<(String, Expression)>,
    /// What the function returns
    pub body: Expression,
    pub span: Option<Span>,
}

/// A structure or a union (spec 3.2.2, 3.2.3)
#[derive(Clone, Debug)]
pub struct StructDecl {
    pub name: String,
    /// Declared `pub`, so other packages may import it
    pub is_public: bool,
    /// Fields in declaration order
    pub fields: Vec<(String, Type)>,
    /// A union's fields share their bits; a structure's sit side by side
    pub is_union: bool,
    pub span: Option<Span>,
}

/// One variant of an enumeration
#[derive(Clone, Debug)]
pub struct EnumVariant {
    pub name: String,
    /// The value written after `=`, if any
    pub value: Option<Expression>,
    /// The type this variant carries, for a tagged union
    pub payload: Option<Type>,
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
            Type::Int { width, .. } => Some(*width),
            Type::Bool => Some(1),
            Type::Float { bits } => Some(*bits),
            Type::BitVecExpr { .. } => None,
            Type::Enum { width, .. } => Some(*width),
            Type::Named(_) => None,
        }
    }
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Bit => write!(f, "bit"),
            Type::BitVec { width } => write!(f, "bit[{}]", width),
            Type::BitVecExpr { expr } => write!(f, "bit[{}]", expr),
            Type::Int { width, signed } => {
                write!(f, "{}[{}]", if *signed { "int" } else { "uint" }, width)
            }
            Type::Bool => write!(f, "bool"),
            Type::Float { bits } => write!(f, "f{}", bits),
            Type::Clock => write!(f, "clock"),
            Type::Reset { active_low } => {
                if *active_low {
                    write!(f, "reset(active_low)")
                } else {
                    write!(f, "reset")
                }
            }
            Type::Array { element, size } => write!(f, "{}[{}]", element, size),
            Type::Enum { name, .. } => write!(f, "{}", name),
            Type::Named(name) => write!(f, "{}", name),
        }
    }
}

/// Clock configuration for test modules
#[derive(Clone, Debug, Default)]
pub struct ClockConfig {
    /// Clock period (e.g., 10ns)
    pub period: Option<Duration>,
    /// Duty cycle in percent (default: 50)
    pub duty_cycle: Option<u8>,
    /// Initial value (default: false/0)
    pub initial_value: Option<bool>,
}

/// Reset configuration for test modules
#[derive(Clone, Debug)]
pub struct ResetConfig {
    /// Active low reset (default: false, meaning active high)
    pub active_low: bool,
    /// Number of cycles to assert reset at start (default: 5)
    pub assert_cycles: Option<u64>,
    /// Time duration to assert reset at start (alternative to assert_cycles)
    pub assert_time: Option<Duration>,
}

impl Default for ResetConfig {
    fn default() -> Self {
        Self {
            active_low: false,
            assert_cycles: None,
            assert_time: None,
        }
    }
}

/// Signal declaration
#[derive(Clone, Debug)]
pub struct Signal {
    pub name: String,
    /// Was a type written? `let sum = a + b;` has none, so its width comes
    /// from the initialiser rather than defaulting to one bit.
    pub has_explicit_type: bool,
    /// Declared `rand`: `$randomize` draws a new value for it
    pub is_rand: bool,
    pub ty: Type,
    pub init_value: Option<Expression>,
    pub is_mutable: bool,
    pub is_var: bool,
    /// Clock configuration (only for clock type signals in test modules)
    pub clock_config: Option<ClockConfig>,
    /// Reset configuration (only for reset type signals in test modules)
    pub reset_config: Option<ResetConfig>,
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
    /// State named by `initial:`; the first state when absent
    pub initial_state: Option<String>,
    /// Signals declared inside the FSM body (spec 7.1 fsm_locals)
    pub locals: Vec<Signal>,
    /// State transitions
    pub transitions: Vec<FsmTransition>,
    /// Output mappings (Mealy-style)
    pub outputs: Vec<FsmOutput>,
    /// How the state register is encoded, from `output encoding: onehot`.
    ///
    /// The clause is in spec 7 and in `tools/iris.ebnf`, and nothing accepted
    /// it. The simulator holds states as integers whatever this says, so the
    /// setting is carried for the tools that emit hardware rather than acted on
    /// here.
    pub encoding: FsmEncoding,
}

/// State encoding of an FSM (spec 7, `output encoding`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FsmEncoding {
    #[default]
    Binary,
    OneHot,
    Gray,
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
    /// Conditional actions inside a `when` clause
    If {
        condition: Expression,
        then_branch: Vec<FsmAction>,
        else_branch: Option<Vec<FsmAction>>,
    },
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
    /// Depth (number of elements); resolved from `depth_param` at elaboration
    pub depth: usize,
    /// Constant expression giving the depth, when it is not a literal
    pub depth_expr: Option<Expression>,
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
    /// Declared `pub`, so other packages may import it
    pub is_public: bool,
    /// The interface this one extends, if any (spec 8.5.1)
    pub extends: Option<String>,
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
    /// System call used as a statement, such as `$display(...)` or `$finish`
    SysCall(Expression),
    /// Leave the innermost loop
    Break,
    /// Start the innermost loop's next iteration
    Continue,
    /// Coverage point
    Cover(CoverStmt),
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
    /// How a violation should be reported
    pub severity: AssertSeverity,
    /// Which of `assert`, `expect` or `assume` was written
    pub kind: AssertKind,
    /// Source location for error reporting
    pub span: Option<Span>,
}

/// The three forms of check the specification gives (spec 11.2)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssertKind {
    /// `assert` — a violation fails the run
    Assert,
    /// `expect` — a soft check; the run continues
    Expect,
    /// `assume` — a premise; reported but the run continues
    Assume,
}

impl fmt::Display for AssertKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AssertKind::Assert => write!(f, "assert"),
            AssertKind::Expect => write!(f, "expect"),
            AssertKind::Assume => write!(f, "assume"),
        }
    }
}

/// A coverage point: how often its condition held
#[derive(Clone, Debug)]
pub struct CoverStmt {
    pub condition: Expression,
    /// The name reported for it
    pub name: Option<String>,
    pub span: Option<Span>,
}

/// Severity attached to a failing assertion
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum AssertSeverity {
    /// A violation fails the simulation (the default)
    #[default]
    Error,
    /// A violation is reported but the simulation still succeeds
    Warning,
    /// A violation fails the simulation and stops it immediately
    Fatal,
}

impl fmt::Display for AssertSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AssertSeverity::Error => write!(f, "error"),
            AssertSeverity::Warning => write!(f, "warning"),
            AssertSeverity::Fatal => write!(f, "fatal"),
        }
    }
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
    /// Memory write: mem[addr] = value
    MemWrite {
        mem_name: String,
        addr: Expression,
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
    /// Block-local declaration: let name: ty = value;
    LetLocal {
        name: String,
        ty: Option<Type>,
        value: Option<Expression>,
    },
    /// Assertion inside a logic block
    Assert(AssertStmt),
    /// System call used as a statement, such as `$display(...)` or `$finish`
    SysCall(Expression),
    /// Write to a bit field of a signal: `target[high:low] = value` or
    /// `target[index +: width] = value`. Both forms reduce to a start bit and
    /// a width; the width must be constant, the start need not be.
    SliceWrite {
        target: String,
        low: Expression,
        width: Expression,
        value: Expression,
    },
    /// Leave the innermost loop
    Break,
    /// Start the innermost loop's next iteration
    Continue,
    /// Coverage point
    Cover(CoverStmt),
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

/// Match arm whose body is a statement list
#[derive(Clone, Debug)]
pub struct MatchArm {
    pub pattern: Pattern,
    pub body: Vec<Statement>,
}

/// Match arm whose body is a single expression
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MatchExprArm {
    pub pattern: Pattern,
    pub value: Expression,
}

/// Pattern for matching
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Pattern {
    /// Literal value
    Literal(Literal),
    /// Identifier (enum variant, etc.)
    Ident(String),
    /// Wildcard (_)
    Wildcard,
    /// `Enum::Variant` or `Enum::Variant(binding)`, before elaboration
    Path {
        path: String,
        binding: Option<String>,
    },
    /// A variant of a tagged union, optionally binding its payload
    Variant {
        /// The value the tag bits must hold
        tag: u64,
        /// How many low bits hold the tag
        tag_width: usize,
        /// Name the payload is bound to inside the arm
        binding: Option<String>,
        /// How many bits the payload occupies
        payload_width: usize,
    },
}

/// Expression
#[derive(Clone, Debug, PartialEq, Eq)]
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
    /// Slice access: base[high:low]. Bounds are constant expressions.
    Slice {
        base: Box<Expression>,
        high: Box<Expression>,
        low: Box<Expression>,
    },
    /// Part select: base[index +: width] or base[index -: width].
    /// The index may vary at run time; the width is constant.
    PartSelect {
        base: Box<Expression>,
        index: Box<Expression>,
        width: Box<Expression>,
        /// True for `+:` (upward from index), false for `-:`
        upward: bool,
    },
    /// System function call such as `$clog2(Depth)` or `$display("x = %d", x)`
    SysFunc {
        name: String,
        args: Vec<SysFuncArg>,
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
    /// Replication: `{4{8'hAB}}` (spec 9.7.2)
    Replicate {
        count: Box<Expression>,
        value: Vec<Expression>,
    },
    /// Memory read: mem[addr]
    MemRead {
        mem_name: String,
        addr: Box<Expression>,
    },
    /// A call to a user-defined function, inlined at elaboration
    Call {
        name: String,
        args: Vec<Expression>,
    },
    /// Match expression: match scrutinee { pattern => value, ... }
    Match {
        scrutinee: Box<Expression>,
        arms: Vec<MatchExprArm>,
    },
}

/// Argument to a system function: either a value or a type
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SysFuncArg {
    Expr(Expression),
    Type(Type),
    Str(String),
}

/// Literal value
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Literal {
    /// Binary literal: 8'b10101010
    Binary { width: usize, value: u64 },
    /// Hexadecimal literal: 8'hFF
    Hex { width: usize, value: u64 },
    /// Decimal literal: 8'd255 or just 255
    Decimal { width: Option<usize>, value: i64 },
    /// Real literal: 1.5, 3.14e-2. Kept as its source text: a real literal has
    /// no format on its own (it takes f32/f64 from its operand or assignment
    /// target at evaluation), and the text preserves it exactly and keeps
    /// `Literal` comparable.
    Real { text: String },
}

impl Literal {
    /// Get the bit width of this literal
    pub fn width(&self) -> Option<usize> {
        match self {
            Literal::Binary { width, .. } => Some(*width),
            Literal::Hex { width, .. } => Some(*width),
            Literal::Decimal { width, .. } => *width,
            // A real literal's width is the float format it lands in, which is
            // not known here. Evaluation is unimplemented, so it never reaches
            // a point that needs a width.
            Literal::Real { .. } => None,
        }
    }

    /// Get the value as u64
    pub fn to_u64(&self) -> u64 {
        match self {
            Literal::Binary { value, .. } => *value,
            Literal::Hex { value, .. } => *value,
            Literal::Decimal { value, .. } => *value as u64,
            // Not an integer value. Evaluation is unimplemented and refuses a
            // real literal before this is reached.
            Literal::Real { .. } => 0,
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
    /// Arithmetic right shift (`>>>`), replicating the sign bit
    AShr,
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

impl BinOp {
    /// Binding strength from spec 9.8; a smaller number binds tighter.
    ///
    /// The grammar is `expr = unary_expr ~ (bin_op ~ unary_expr)*`, which says
    /// nothing about grouping, and the builder folded strictly left to right.
    /// That made `a + b * c` mean `(a + b) * c`, where 9.8 and its own worked
    /// example say `a + (b * c)`.
    pub fn precedence(self) -> u8 {
        match self {
            BinOp::Mul | BinOp::Div | BinOp::Mod => 4,
            BinOp::Add | BinOp::Sub => 5,
            BinOp::Shl | BinOp::Shr | BinOp::AShr => 6,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => 7,
            BinOp::Eq | BinOp::Ne => 8,
            BinOp::And => 9,
            BinOp::Xor => 10,
            BinOp::Or => 11,
            BinOp::LogicalAnd => 12,
            BinOp::LogicalOr => 13,
        }
    }
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
            BinOp::AShr => write!(f, ">>>"),
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
            Literal::Real { text } => write!(f, "{}", text),
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
            Expression::PartSelect {
                base,
                index,
                width,
                upward,
            } => write!(
                f,
                "{}[{} {}: {}]",
                base,
                index,
                if *upward { "+" } else { "-" },
                width
            ),
            Expression::SysFunc { name, args } => {
                write!(f, "${}(", name)?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    match arg {
                        SysFuncArg::Expr(e) => write!(f, "{}", e)?,
                        SysFuncArg::Type(t) => write!(f, "{}", t)?,
                        SysFuncArg::Str(t) => write!(f, "\"{}\"", t)?,
                    }
                }
                write!(f, ")")
            }
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
            Expression::Call { name, args } => {
                let rendered: Vec<String> = args.iter().map(|a| a.to_string()).collect();
                write!(f, "{}({})", name, rendered.join(", "))
            }
            Expression::Replicate { count, value } => {
                write!(f, "{{{}{{", count)?;
                for (i, expr) in value.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{}", expr)?;
                }
                write!(f, "}}}}")
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
            Expression::Match { scrutinee, arms } => {
                write!(f, "match {} {{ ", scrutinee)?;
                for arm in arms {
                    write!(f, "{} => {}, ", arm.pattern, arm.value)?;
                }
                write!(f, "}}")
            }
        }
    }
}

impl Pattern {
    /// The name a matched payload is bound to, and how to extract it
    pub fn payload_binding(&self) -> Option<(&str, usize, usize)> {
        match self {
            Pattern::Variant {
                binding: Some(name),
                tag_width,
                payload_width,
                ..
            } => Some((name, *tag_width, *payload_width)),
            _ => None,
        }
    }
}

impl fmt::Display for Pattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Pattern::Literal(lit) => write!(f, "{}", lit),
            Pattern::Ident(name) => write!(f, "{}", name),
            Pattern::Wildcard => write!(f, "_"),
            Pattern::Path { path, binding } => match binding {
                Some(binding) => write!(f, "{}({})", path, binding),
                None => write!(f, "{}", path),
            },
            Pattern::Variant { tag, binding, .. } => match binding {
                Some(binding) => write!(f, "tag {}({})", tag, binding),
                None => write!(f, "tag {}", tag),
            },
        }
    }
}
