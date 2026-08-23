//! The SystemVerilog syntax this port understands.
//!
//! It is a subset: ANSI module headers, continuous assignments, and
//! expressions. It grows as more of the language is ported.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Dir {
    In,
    Out,
    Inout,
}

/// A packed width from `[msb:lsb]`. A literal range is reduced to a bit count;
/// a parametric range keeps its bounds so the width can be written as an
/// expression (`[DataWidth-1:0]` -> `DataWidth - 1 + 1`).
#[derive(Debug, Clone)]
pub enum Width {
    Bits(usize),
    Range { hi: Expr, lo: Expr },
}

#[derive(Debug, Clone)]
pub struct Port {
    pub dir: Dir,
    /// Width; `None` means one bit (no `[msb:lsb]`).
    pub width: Option<Width>,
    /// `true` for `logic signed`, so the bits are read as two's complement.
    pub signed: bool,
    /// IEEE-754 float bit count for `shortreal` (32) / `real` (64), else `None`.
    pub float: Option<usize>,
    pub name: String,
}

/// One entry in an `always_ff` sensitivity list, e.g. `posedge clk`.
#[derive(Debug, Clone)]
pub struct Edge {
    pub signal: String,
    /// `true` for `negedge`, `false` for `posedge`.
    pub negedge: bool,
}

#[derive(Debug, Clone)]
pub enum Stmt {
    /// `target = expr;` (blocking) or `target <= expr;` (non-blocking). IRIS
    /// does not distinguish the two inside a block, so the flag is dropped. The
    /// target is an expression so a memory write (`regs[a] <= d`) can be one.
    Assign { target: Expr, expr: Expr },
    /// `if (cond) then [else els]`
    If {
        cond: Expr,
        then: Vec<Stmt>,
        els: Option<Vec<Stmt>>,
    },
    /// `case (scrutinee) label: body ... [default: body] endcase`
    Case {
        scrutinee: Expr,
        arms: Vec<CaseArm>,
    },
    /// `return expr;`
    Return(Expr),
}

#[derive(Debug, Clone)]
pub struct CaseArm {
    /// The label value, or `None` for `default`.
    pub label: Option<Expr>,
    pub body: Vec<Stmt>,
}

#[derive(Debug, Clone)]
pub enum Item {
    /// `assign target = expr;`
    ContinuousAssign { target: String, expr: Expr },
    /// An internal declaration: `logic [signed] [w] name [= init];`, or a
    /// user-typed one (`Op op = Add;`) where `user_type` is the type name.
    NetDecl {
        width: Option<Width>,
        signed: bool,
        user_type: Option<String>,
        /// IEEE-754 float bit count for `shortreal` (32) / `real` (64).
        float: Option<usize>,
        name: String,
        init: Option<Expr>,
    },
    /// A memory (unpacked array): `logic [w] name [depth];`. The depth may be a
    /// parameter expression, so it is kept as an expression.
    MemDecl {
        element_width: Option<Width>,
        signed: bool,
        depth: Expr,
        name: String,
    },
    /// A module instance: `Module name ( .port(expr), ... );`
    Instance {
        module: String,
        name: String,
        connections: Vec<(String, Expr)>,
    },
    /// `always_ff @(edges) body`
    AlwaysFf { edges: Vec<Edge>, body: Vec<Stmt> },
    /// `always_comb body`
    AlwaysComb { body: Vec<Stmt> },
}

#[derive(Debug, Clone)]
pub struct Param {
    pub name: String,
    pub default: Option<Expr>,
    /// A `logic`-vector parameter is constrained to be at least one bit wide; an
    /// `int` parameter is not.
    pub constrained: bool,
}

#[derive(Debug, Clone)]
pub struct EnumDecl {
    pub name: String,
    pub width: Option<Width>,
    /// Members with their optional explicit value.
    pub members: Vec<(String, Option<Expr>)>,
}

/// A field of a struct or union: `logic [w] name;`.
#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    pub width: Option<Width>,
    pub signed: bool,
    pub user_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StructDecl {
    pub name: String,
    pub is_union: bool,
    pub fields: Vec<Field>,
}

/// A function argument: `input logic [w] name`.
#[derive(Debug, Clone)]
pub struct FnArg {
    pub name: String,
    pub width: Option<Width>,
    pub signed: bool,
}

#[derive(Debug, Clone)]
pub struct FnDecl {
    pub name: String,
    pub args: Vec<FnArg>,
    pub ret_width: Option<Width>,
    pub ret_signed: bool,
    pub body: Vec<Stmt>,
}

/// A `modport`: a name and its per-signal directions.
#[derive(Debug, Clone)]
pub struct Modport {
    pub name: String,
    /// (direction, signal); direction is In/Out/Inout.
    pub signals: Vec<(Dir, String)>,
}

#[derive(Debug, Clone)]
pub struct InterfaceDecl {
    pub name: String,
    pub fields: Vec<Field>,
    pub modports: Vec<Modport>,
}

/// A file-level declaration, kept in source order.
#[derive(Debug, Clone)]
pub enum FileDecl {
    Enum(EnumDecl),
    Struct(StructDecl),
    Function(FnDecl),
    Interface(InterfaceDecl),
}

#[derive(Debug, Clone)]
pub struct Module {
    pub name: String,
    pub params: Vec<Param>,
    pub ports: Vec<Port>,
    pub items: Vec<Item>,
}

/// A whole file: the file-level type declarations (in source order) and the
/// modules.
#[derive(Debug, Clone)]
pub struct Design {
    pub decls: Vec<FileDecl>,
    pub modules: Vec<Module>,
}

#[derive(Debug, Clone)]
pub enum Expr {
    /// A numeric literal, source text kept verbatim
    Number(String),
    Ident(String),
    Unary { op: String, expr: Box<Expr> },
    Binary { op: String, lhs: Box<Expr>, rhs: Box<Expr> },
    /// `cond ? a : b`
    Ternary { cond: Box<Expr>, then: Box<Expr>, els: Box<Expr> },
    /// A parenthesised expression, kept so the emitted IRIS reads the same
    Paren(Box<Expr>),
    /// A bit select, `base[index]`
    Bit { base: Box<Expr>, index: Box<Expr> },
    /// A part select, `base[hi:lo]`
    Part { base: Box<Expr>, hi: Box<Expr>, lo: Box<Expr> },
    /// An indexed part select, `base[index +: width]` (up) or `-:` (down).
    IndexPart { base: Box<Expr>, index: Box<Expr>, width: Box<Expr>, up: bool },
    /// A size cast, `W'(expr)`, truncating/extending to `W` bits. `W` may be a
    /// literal or a parameter, so it is an expression.
    Cast { width: Box<Expr>, expr: Box<Expr> },
    /// A system-function call, `$signed(expr)`.
    SysCall { name: String, arg: Box<Expr> },
    /// A concatenation, `{a, b, ...}`.
    Concat(Vec<Expr>),
    /// A function call, `name(args)`.
    Call { name: String, args: Vec<Expr> },
    /// A member access, `base.field` (an instance output or interface signal).
    Member { base: Box<Expr>, field: String },
}
