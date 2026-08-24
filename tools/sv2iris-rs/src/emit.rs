//! Render an SV module as IRIS source text.
//!
//! Beyond the pure text, this does the transformations the TypeScript sv2iris
//! does: it infers which ports are clocks and resets from the `always_ff`
//! sensitivity lists, folds a reset branch into a register's initial value, and
//! maps `always_ff`/`always_comb` to `sync`/`comb`. The shape matches the
//! TypeScript tool so the two are interchangeable.

use crate::ast::*;
use std::collections::{HashMap, HashSet};

/// Render an enum declaration. Members keep their explicit values; each line
/// ends with a comma, matching the TypeScript tool.
pub fn emit_enum(decl: &EnumDecl) -> String {
    let mut out = format!("enum {} {{\n", decl.name);
    for (name, value) in &decl.members {
        match value {
            Some(v) => out.push_str(&format!("    {} = {},\n", name, emit_expr(v))),
            None => out.push_str(&format!("    {},\n", name)),
        }
    }
    out.push_str("}\n");
    out
}

/// Render a struct or union declaration. Each field is `name: type,`.
pub fn emit_struct(decl: &StructDecl) -> String {
    let kind = if decl.is_union { "union" } else { "struct" };
    let mut out = format!("{} {} {{\n", kind, decl.name);
    for f in &decl.fields {
        let ty = match &f.user_type {
            Some(t) => t.clone(),
            None => scalar_ty(&f.width, f.signed),
        };
        out.push_str(&format!("    {}: {},\n", f.name, ty));
    }
    out.push_str("}\n");
    out
}

pub fn emit_module(module: &Module) -> String {
    let info = analyse(module);

    let mut out = String::new();
    // The header: `mod Name`, then generic parameters in `[...]` with a
    // `where` block constraining each to be at least one, then the ports.
    out.push_str(&format!("mod {}", module.name));
    if !module.params.is_empty() {
        let params: Vec<String> = module
            .params
            .iter()
            .map(|p| match &p.default {
                Some(d) => format!("{}: uint = {}", p.name, emit_expr(d)),
                None => format!("{}: uint", p.name),
            })
            .collect();
        out.push_str(&format!("[{}]", params.join(", ")));
        // Only `logic`-vector parameters carry a `>= 1` constraint. With a
        // constraint the `where` block goes on its own lines before the ports;
        // without one, the ports open on the same line as the parameters.
        let constrained: Vec<&str> = module
            .params
            .iter()
            .filter(|p| p.constrained)
            .map(|p| p.name.as_str())
            .collect();
        if constrained.is_empty() {
            out.push_str("(\n");
        } else {
            out.push_str("\nwhere\n");
            for (i, name) in constrained.iter().enumerate() {
                let comma = if i + 1 < constrained.len() { "," } else { "" };
                out.push_str(&format!("    {} >= 1{}\n", name, comma));
            }
            out.push_str("(\n");
        }
    } else {
        out.push_str("(\n");
    }
    for (i, port) in module.ports.iter().enumerate() {
        let comma = if i + 1 < module.ports.len() { "," } else { "" };
        out.push_str(&format!("    {}{}\n", emit_port(port, &info), comma));
    }
    out.push_str(") {\n");

    // Internal declarations, in source order. A register with a reset value is
    // a `var` holding that value; a declaration with an initialiser is a `let`
    // holding it; anything else is a bare `let`. A memory becomes `mem`.
    for item in &module.items {
        match item {
            Item::NetDecl { width, signed, user_type, float, name, init } => {
                let ty = match (user_type, float) {
                    (Some(t), _) => t.clone(),
                    (None, Some(bits)) => format!("f{bits}"),
                    (None, None) => scalar_ty(width, *signed),
                };
                if let Some(reset) = info.reset_inits.get(name) {
                    out.push_str(&format!("    var {}: {} = {};\n", name, ty, reset));
                } else if let Some(init) = init {
                    out.push_str(&format!("    let {}: {} = {};\n", name, ty, emit_expr(init)));
                } else {
                    out.push_str(&format!("    let {}: {};\n", name, ty));
                }
            }
            Item::MemDecl { element_width, signed, depth, name } => {
                let ty = scalar_ty(element_width, *signed);
                out.push_str(&format!("    mem {}: {}[{}];\n", name, ty, emit_expr(depth)));
            }
            _ => {}
        }
    }

    // `always_ff` -> `sync`, `always_comb` -> `comb`, in source order.
    for item in &module.items {
        match item {
            Item::AlwaysFf { edges, body } => {
                let clause = sync_clause(edges);
                let sync_body = strip_reset(body, &info.reset_signals);
                out.push_str(&format!("    sync({}) {{\n", clause));
                emit_stmts(&mut out, &sync_body, 2);
                out.push_str("    }\n");
            }
            Item::AlwaysComb { body } => {
                out.push_str("    comb {\n");
                emit_stmts(&mut out, body, 2);
                out.push_str("    }\n");
            }
            Item::Instance { module: m, name, connections } => {
                out.push_str(&format!("    inst {} = {} {{\n", name, m));
                for (port, expr) in connections {
                    out.push_str(&format!("        {}: {},\n", port, emit_expr(expr)));
                }
                out.push_str("    };\n");
            }
            _ => {}
        }
    }

    // Continuous assignments become one `comb` block.
    let assigns: Vec<(&String, &Expr)> = module
        .items
        .iter()
        .filter_map(|it| match it {
            Item::ContinuousAssign { target, expr } => Some((target, expr)),
            _ => None,
        })
        .collect();
    if !assigns.is_empty() {
        out.push_str("    comb {\n");
        for (target, expr) in assigns {
            out.push_str(&format!("        {} = {};\n", target, emit_expr(expr)));
        }
        out.push_str("    }\n");
    }

    out.push_str("}\n");
    out
}

/// What analysing the module found: which signals are clocks and resets, the
/// reset value of each register, and the internal declarations.
struct Info {
    clocks: HashSet<String>,
    /// Reset signal -> active_low
    resets: HashMap<String, bool>,
    reset_signals: HashSet<String>,
    reset_inits: HashMap<String, String>,
}

fn analyse(module: &Module) -> Info {
    let mut clocks = HashSet::new();
    let mut resets = HashMap::new();
    let mut reset_inits = HashMap::new();

    for item in &module.items {
        if let Item::AlwaysFf { edges, body } = item {
            // The first edge clocks the block; the rest are resets. A negedge
            // reset is active-low.
            if let Some(clock) = edges.first() {
                clocks.insert(clock.signal.clone());
            }
            // Only an active-low (negedge) reset is folded into the register's
            // initial value and typed `reset`. An active-high (posedge) reset is
            // kept in the body as a synchronous-looking branch and its port
            // stays a plain bit, matching the TypeScript tool. Both still appear
            // as `.async` in the sync clause (see `sync_clause`).
            for reset in edges.iter().skip(1) {
                if reset.negedge {
                    resets.insert(reset.signal.clone(), true);
                }
            }
            // A reset branch (a top `if` whose condition names a folded reset)
            // gives each assigned register its initial value.
            let reset_set: HashSet<String> =
                edges.iter().skip(1).filter(|e| e.negedge).map(|e| e.signal.clone()).collect();
            if let [Stmt::If { cond, then, .. }] = body.as_slice() {
                if idents_of(cond).iter().any(|id| reset_set.contains(id)) {
                    for stmt in then {
                        if let Stmt::Assign { target, expr } = stmt {
                            if let Some(name) = lvalue_name(target) {
                                reset_inits.insert(name, emit_expr(expr));
                            }
                        }
                    }
                }
            }
        }
    }

    let reset_signals: HashSet<String> = resets.keys().cloned().collect();
    Info { clocks, resets, reset_signals, reset_inits }
}

/// An atomic expression needs no parentheses before a `.method()` call.
fn is_atomic(expr: &Expr) -> bool {
    matches!(
        expr,
        Expr::Ident(_)
            | Expr::Number(_)
            | Expr::Paren(_)
            | Expr::Bit { .. }
            | Expr::Part { .. }
            | Expr::IndexPart { .. }
            | Expr::SysCall { .. }
            | Expr::Concat(_)
            | Expr::Call { .. }
            | Expr::Member { .. }
    )
}

/// The name of a simple lvalue (`x`), or `None` for an indexed one (`x[i]`).
fn lvalue_name(expr: &Expr) -> Option<String> {
    match expr {
        Expr::Ident(name) => Some(name.clone()),
        _ => None,
    }
}

/// The `sync(...)` clause: the clock edge, then each reset as `.async`.
fn sync_clause(edges: &[Edge]) -> String {
    let mut parts = Vec::new();
    if let Some(clock) = edges.first() {
        let edge = if clock.negedge { "negedge" } else { "posedge" };
        parts.push(format!("{}.{}", clock.signal, edge));
    }
    for reset in edges.iter().skip(1) {
        parts.push(format!("{}.async", reset.signal));
    }
    parts.join(", ")
}

/// The statements a `sync` block runs: the body with any reset branch removed,
/// since the reset value now lives on the declaration.
fn strip_reset(body: &[Stmt], reset_signals: &HashSet<String>) -> Vec<Stmt> {
    if let [Stmt::If { cond, els, .. }] = body {
        if idents_of(cond).iter().any(|id| reset_signals.contains(id)) {
            return els.clone().unwrap_or_default();
        }
    }
    body.to_vec()
}

fn emit_stmts(out: &mut String, stmts: &[Stmt], depth: usize) {
    let pad = "    ".repeat(depth);
    for stmt in stmts {
        match stmt {
            Stmt::Assign { target, expr } => {
                out.push_str(&format!("{}{} = {};\n", pad, emit_expr(target), emit_expr(expr)));
            }
            Stmt::If { cond, then, els } => {
                out.push_str(&format!("{}if {} {{\n", pad, emit_expr(cond)));
                emit_stmts(out, then, depth + 1);
                if let Some(els) = els {
                    out.push_str(&format!("{}}} else {{\n", pad));
                    emit_stmts(out, els, depth + 1);
                }
                out.push_str(&format!("{}}}\n", pad));
            }
            Stmt::Case { scrutinee, arms } => {
                out.push_str(&format!("{}match {} {{\n", pad, emit_expr(scrutinee)));
                let arm_pad = "    ".repeat(depth + 1);
                for arm in arms {
                    let label = match &arm.label {
                        Some(v) => emit_expr(v),
                        None => "_".to_string(),
                    };
                    out.push_str(&format!("{}{} => {{\n", arm_pad, label));
                    emit_stmts(out, &arm.body, depth + 2);
                    out.push_str(&format!("{}}}\n", arm_pad));
                }
                // IRIS `match` must be exhaustive; add an empty catch-all when
                // the case had no `default`.
                if !arms.iter().any(|a| a.label.is_none()) {
                    out.push_str(&format!("{}_ => {{\n", arm_pad));
                    out.push_str(&format!("{}}}\n", arm_pad));
                }
                out.push_str(&format!("{}}}\n", pad));
            }
            Stmt::Return(e) => {
                out.push_str(&format!("{}return {};\n", pad, emit_expr(e)));
            }
        }
    }
}

/// Render a function declaration.
pub fn emit_function(f: &FnDecl, _members: &std::collections::HashMap<String, String>) -> String {
    let args: Vec<String> = f
        .args
        .iter()
        .map(|a| format!("{}: {}", a.name, scalar_ty(&a.width, a.signed)))
        .collect();
    let ret = scalar_ty(&f.ret_width, f.ret_signed);
    let mut out = format!("fn {}({}) -> {} {{\n", f.name, args.join(", "), ret);
    emit_stmts(&mut out, &f.body, 1);
    out.push_str("}\n");
    out
}

/// Render an interface declaration with its modports as `view` blocks.
pub fn emit_interface(iface: &InterfaceDecl) -> String {
    let mut out = format!("interface {} {{\n", iface.name);
    for field in &iface.fields {
        let ty = scalar_ty(&field.width, field.signed);
        out.push_str(&format!("    {}: {},\n", field.name, ty));
    }
    for mp in &iface.modports {
        out.push('\n');
        out.push_str(&format!("    view {} {{\n", mp.name));
        // Group by direction, in the order each direction first appears.
        let mut order: Vec<Dir> = Vec::new();
        for (d, _) in &mp.signals {
            if !order.contains(d) {
                order.push(d.clone());
            }
        }
        for dir in &order {
            let kw = match dir {
                Dir::Out => "out",
                Dir::In => "in",
                Dir::Inout => "inout",
            };
            let sigs: Vec<&str> = mp
                .signals
                .iter()
                .filter(|(d, _)| d == dir)
                .map(|(_, s)| s.as_str())
                .collect();
            out.push_str(&format!("        {}: {},\n", kw, sigs.join(", ")));
        }
        out.push_str("    }\n");
    }
    out.push_str("}\n");
    out
}

fn emit_port(port: &Port, info: &Info) -> String {
    let dir = match port.dir {
        Dir::In => "in",
        Dir::Out => "out",
        Dir::Inout => "inout",
    };
    let ty = if info.clocks.contains(&port.name) {
        "clock".to_string()
    } else if let Some(active_low) = info.resets.get(&port.name) {
        if *active_low {
            "reset(active_low: true)".to_string()
        } else {
            "reset".to_string()
        }
    } else if let Some(bits) = port.float {
        format!("f{bits}")
    } else {
        scalar_ty(&port.width, port.signed)
    };
    format!("{} {}: {}", dir, port.name, ty)
}

/// A scalar IRIS type: `int[N]` when signed, `bit[N]` otherwise; a missing
/// width is one bit. A parametric width is written as an expression, matching
/// the TypeScript tool (`[DataWidth-1:0]` -> `bit[DataWidth - 1 + 1]`).
fn scalar_ty(width: &Option<Width>, signed: bool) -> String {
    let base = if signed { "int" } else { "bit" };
    match width {
        None => {
            if signed {
                "int[1]".to_string()
            } else {
                "bit".to_string()
            }
        }
        Some(Width::Bits(w)) => format!("{}[{}]", base, w),
        Some(Width::Range { hi, lo }) => {
            let w = if is_literal_zero(lo) {
                format!("{} + 1", emit_expr(hi))
            } else {
                format!("{} - {} + 1", emit_expr(hi), emit_expr(lo))
            };
            format!("{}[{}]", base, w)
        }
    }
}

fn is_literal_zero(expr: &Expr) -> bool {
    matches!(expr, Expr::Number(t) if t == "0")
}

fn emit_expr(expr: &Expr) -> String {
    match expr {
        Expr::Number(text) => normalize_number(text),
        Expr::Ident(name) => name.clone(),
        // The reduction operators have no prefix form in IRIS; they are methods.
        Expr::Unary { op, expr } if op == "^" => format!("{}.xor_reduce()", emit_expr(expr)),
        Expr::Unary { op, expr } if op == "&" => format!("{}.and_reduce()", emit_expr(expr)),
        Expr::Unary { op, expr } if op == "|" => format!("{}.or_reduce()", emit_expr(expr)),
        Expr::Unary { op, expr } => format!("{}{}", op, emit_expr(expr)),
        Expr::Binary { op, lhs, rhs } => {
            format!("{} {} {}", emit_expr(lhs), op, emit_expr(rhs))
        }
        Expr::Ternary { cond, then, els } => format!(
            "if {} {{ {} }} else {{ {} }}",
            emit_expr(cond),
            emit_expr(then),
            emit_expr(els)
        ),
        Expr::Paren(inner) => format!("({})", emit_expr(inner)),
        Expr::Bit { base, index } => format!("{}[{}]", emit_expr(base), emit_expr(index)),
        Expr::Part { base, hi, lo } => {
            format!("{}[{}:{}]", emit_expr(base), emit_expr(hi), emit_expr(lo))
        }
        Expr::IndexPart { base, index, width, up } => {
            let op = if *up { "+:" } else { "-:" };
            format!("{}[{} {} {}]", emit_expr(base), emit_expr(index), op, emit_expr(width))
        }
        Expr::Cast { width, expr } => {
            // A cast of a signed/unsigned system call is a sign/zero extend to
            // the width; any other cast truncates to it.
            let w = emit_expr(width);
            match expr.as_ref() {
                Expr::SysCall { name, arg } if name == "$signed" => {
                    format!("{}.sign_extend[{}]()", emit_expr(arg), w)
                }
                Expr::SysCall { name, arg } if name == "$unsigned" => {
                    format!("{}.zero_extend[{}]()", emit_expr(arg), w)
                }
                // A compound operand is parenthesised; a simple one is not.
                other => {
                    let inner = emit_expr(other);
                    if is_atomic(other) {
                        format!("{}.truncate[{}]()", inner, w)
                    } else {
                        format!("({}).truncate[{}]()", inner, w)
                    }
                }
            }
        }
        Expr::SysCall { name, arg } => match name.as_str() {
            "$signed" => format!("{}.signed()", emit_expr(arg)),
            "$unsigned" => format!("{}.unsigned()", emit_expr(arg)),
            other => format!("{}({})", other, emit_expr(arg)),
        },
        Expr::Concat(parts) => {
            let inner: Vec<String> = parts.iter().map(emit_expr).collect();
            format!("{{{}}}", inner.join(", "))
        }
        Expr::Call { name, args } => {
            let inner: Vec<String> = args.iter().map(emit_expr).collect();
            format!("{}({})", name, inner.join(", "))
        }
        Expr::Member { base, field } => format!("{}.{}", emit_expr(base), field),
    }
}

/// The identifiers an expression mentions.
fn idents_of(expr: &Expr) -> Vec<String> {
    let mut out = Vec::new();
    collect_idents(expr, &mut out);
    out
}

fn collect_idents(expr: &Expr, out: &mut Vec<String>) {
    match expr {
        Expr::Ident(name) => out.push(name.clone()),
        Expr::Unary { expr, .. } => collect_idents(expr, out),
        Expr::Binary { lhs, rhs, .. } => {
            collect_idents(lhs, out);
            collect_idents(rhs, out);
        }
        Expr::Ternary { cond, then, els } => {
            collect_idents(cond, out);
            collect_idents(then, out);
            collect_idents(els, out);
        }
        Expr::Paren(inner) => collect_idents(inner, out),
        Expr::Bit { base, index } => {
            collect_idents(base, out);
            collect_idents(index, out);
        }
        Expr::Part { base, hi, lo } => {
            collect_idents(base, out);
            collect_idents(hi, out);
            collect_idents(lo, out);
        }
        Expr::IndexPart { base, index, width, .. } => {
            collect_idents(base, out);
            collect_idents(index, out);
            collect_idents(width, out);
        }
        Expr::Cast { expr, .. } => collect_idents(expr, out),
        Expr::SysCall { arg, .. } => collect_idents(arg, out),
        Expr::Call { args, .. } => {
            for a in args {
                collect_idents(a, out);
            }
        }
        Expr::Member { base, .. } => collect_idents(base, out),
        Expr::Concat(parts) => {
            for part in parts {
                collect_idents(part, out);
            }
        }
        Expr::Number(_) => {}
    }
}

/// Normalise a SystemVerilog numeric literal to IRIS form. The base letter and
/// any hex digits are lowercased; a plain decimal is left as it is. An unsized
/// based literal (`'h400`) is given the width its digits imply, since IRIS
/// literals carry a width.
fn normalize_number(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix('\'') {
        // rest is `[s]<base><digits>`
        let rest = rest.strip_prefix('s').unwrap_or(rest);
        let mut chars = rest.chars();
        if let Some(base) = chars.next() {
            let digits: String = chars.filter(|c| *c != '_').collect();
            let per = match base {
                'h' => 4,
                'o' => 3,
                'b' => 1,
                _ => 0, // decimal or unknown: leave unsized
            };
            if per > 0 && !digits.is_empty() {
                let width = digits.len() * per;
                return format!("{}'{}{}", width, base, digits);
            }
        }
    }
    lower
}
