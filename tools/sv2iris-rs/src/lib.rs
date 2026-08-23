//! sv2iris: convert a subset of SystemVerilog to IRIS.
//!
//! This is the Rust port of the TypeScript sv2iris (stage A4 of the app
//! integration). It reads a subset of SystemVerilog — module headers,
//! continuous and procedural assignments, expressions, and file-level enum
//! declarations — and emits IRIS source. Anything outside the subset is refused
//! with a line number, never dropped.

pub mod ast;
pub mod emit;
pub mod lexer;
pub mod parser;

use ast::*;
use std::collections::HashMap;

/// Convert SystemVerilog (enums and one or more modules) to IRIS source text.
pub fn transpile(source: &str) -> Result<String, String> {
    let tokens = lexer::lex(source)?;
    let mut parser = parser::Parser::new(tokens);
    let design = parser.parse_design()?;

    // A folded reset value needs an internal declaration to live on; a reset
    // that targets a port has nowhere to hold it, which IRIS cannot express.
    for m in &design.modules {
        check_reset_targets(m)?;
    }

    // A bare enum member (`Add`) is written qualified in IRIS (`Op::Add`), so
    // build a member -> enum-name map and rewrite expressions with it.
    let members = member_map(&design.decls);
    let modules: Vec<Module> = design
        .modules
        .iter()
        .map(|m| qualify_module(m, &members))
        .collect();

    let mut out = String::new();
    for ty in &design.decls {
        match ty {
            FileDecl::Enum(e) => out.push_str(&emit::emit_enum(e)),
            FileDecl::Struct(s) => out.push_str(&emit::emit_struct(s)),
            FileDecl::Function(f) => out.push_str(&emit::emit_function(f, &members)),
            FileDecl::Interface(i) => out.push_str(&emit::emit_interface(i)),
        }
        out.push('\n');
    }
    let rendered: Vec<String> = modules.iter().map(emit::emit_module).collect();
    out.push_str(&rendered.join("\n"));
    Ok(out)
}

use std::collections::HashSet;

/// A folded (active-low) reset value must land on an internal declaration. If it
/// targets a port, there is nowhere to keep the initial value — the TypeScript
/// tool refuses this too, telling the author to declare an internal signal.
fn check_reset_targets(m: &Module) -> Result<(), String> {
    let internal: HashSet<&str> = m
        .items
        .iter()
        .filter_map(|it| match it {
            Item::NetDecl { name, .. } => Some(name.as_str()),
            Item::MemDecl { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    for it in &m.items {
        if let Item::AlwaysFf { edges, body } = it {
            let resets: HashSet<&str> = edges
                .iter()
                .skip(1)
                .filter(|e| e.negedge)
                .map(|e| e.signal.as_str())
                .collect();
            if resets.is_empty() {
                continue;
            }
            if let [Stmt::If { cond, then, .. }] = body.as_slice() {
                if expr_mentions(cond, &resets) {
                    for stmt in then {
                        if let Stmt::Assign { target: Expr::Ident(name), .. } = stmt {
                            if !internal.contains(name.as_str()) {
                                return Err(format!(
                                    "unsupported: the reset value for '{}' has no declaration to hold it; declare an internal signal and drive the port from it (not converted)",
                                    name
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn expr_mentions(expr: &Expr, set: &HashSet<&str>) -> bool {
    match expr {
        Expr::Ident(n) => set.contains(n.as_str()),
        Expr::Unary { expr, .. } => expr_mentions(expr, set),
        Expr::Binary { lhs, rhs, .. } => expr_mentions(lhs, set) || expr_mentions(rhs, set),
        Expr::Paren(i) => expr_mentions(i, set),
        _ => false,
    }
}

fn member_map(types: &[FileDecl]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for ty in types {
        if let FileDecl::Enum(e) = ty {
            for (member, _) in &e.members {
                map.insert(member.clone(), e.name.clone());
            }
        }
    }
    map
}

fn qualify_module(m: &Module, map: &HashMap<String, String>) -> Module {
    Module {
        name: m.name.clone(),
        params: m.params.clone(),
        ports: m.ports.clone(),
        items: m.items.iter().map(|it| qualify_item(it, map)).collect(),
    }
}

fn qualify_item(item: &Item, map: &HashMap<String, String>) -> Item {
    match item {
        Item::ContinuousAssign { target, expr } => Item::ContinuousAssign {
            target: target.clone(),
            expr: qe(expr, map),
        },
        Item::NetDecl { width, signed, user_type, float, name, init } => Item::NetDecl {
            width: width.clone(),
            signed: *signed,
            user_type: user_type.clone(),
            float: *float,
            name: name.clone(),
            init: init.as_ref().map(|e| qe(e, map)),
        },
        Item::MemDecl { element_width, signed, depth, name } => Item::MemDecl {
            element_width: element_width.clone(),
            signed: *signed,
            depth: qe(depth, map),
            name: name.clone(),
        },
        Item::AlwaysFf { edges, body } => Item::AlwaysFf {
            edges: edges.clone(),
            body: body.iter().map(|s| qs(s, map)).collect(),
        },
        Item::AlwaysComb { body } => Item::AlwaysComb {
            body: body.iter().map(|s| qs(s, map)).collect(),
        },
        Item::Instance { module, name, connections } => Item::Instance {
            module: module.clone(),
            name: name.clone(),
            connections: connections.iter().map(|(p, e)| (p.clone(), qe(e, map))).collect(),
        },
    }
}

fn qs(stmt: &Stmt, map: &HashMap<String, String>) -> Stmt {
    match stmt {
        Stmt::Assign { target, expr } => Stmt::Assign {
            target: qe(target, map),
            expr: qe(expr, map),
        },
        Stmt::If { cond, then, els } => Stmt::If {
            cond: qe(cond, map),
            then: then.iter().map(|s| qs(s, map)).collect(),
            els: els.as_ref().map(|b| b.iter().map(|s| qs(s, map)).collect()),
        },
        Stmt::Case { scrutinee, arms } => Stmt::Case {
            scrutinee: qe(scrutinee, map),
            arms: arms
                .iter()
                .map(|a| CaseArm {
                    label: a.label.as_ref().map(|l| qe(l, map)),
                    body: a.body.iter().map(|s| qs(s, map)).collect(),
                })
                .collect(),
        },
        Stmt::Return(e) => Stmt::Return(qe(e, map)),
    }
}

/// Rewrite a bare enum member `Add` to `Op::Add`; recurse otherwise.
fn qe(expr: &Expr, map: &HashMap<String, String>) -> Expr {
    match expr {
        Expr::Ident(name) => match map.get(name) {
            Some(enum_name) => Expr::Ident(format!("{}::{}", enum_name, name)),
            None => Expr::Ident(name.clone()),
        },
        Expr::Number(_) => expr.clone(),
        Expr::Unary { op, expr } => Expr::Unary {
            op: op.clone(),
            expr: Box::new(qe(expr, map)),
        },
        Expr::Binary { op, lhs, rhs } => Expr::Binary {
            op: op.clone(),
            lhs: Box::new(qe(lhs, map)),
            rhs: Box::new(qe(rhs, map)),
        },
        Expr::Ternary { cond, then, els } => Expr::Ternary {
            cond: Box::new(qe(cond, map)),
            then: Box::new(qe(then, map)),
            els: Box::new(qe(els, map)),
        },
        Expr::Paren(inner) => Expr::Paren(Box::new(qe(inner, map))),
        Expr::Bit { base, index } => Expr::Bit {
            base: Box::new(qe(base, map)),
            index: Box::new(qe(index, map)),
        },
        Expr::Part { base, hi, lo } => Expr::Part {
            base: Box::new(qe(base, map)),
            hi: Box::new(qe(hi, map)),
            lo: Box::new(qe(lo, map)),
        },
        Expr::IndexPart { base, index, width, up } => Expr::IndexPart {
            base: Box::new(qe(base, map)),
            index: Box::new(qe(index, map)),
            width: Box::new(qe(width, map)),
            up: *up,
        },
        Expr::Cast { width, expr } => Expr::Cast {
            width: Box::new(qe(width, map)),
            expr: Box::new(qe(expr, map)),
        },
        Expr::SysCall { name, arg } => Expr::SysCall {
            name: name.clone(),
            arg: Box::new(qe(arg, map)),
        },
        Expr::Concat(parts) => Expr::Concat(parts.iter().map(|p| qe(p, map)).collect()),
        Expr::Call { name, args } => Expr::Call {
            name: name.clone(),
            args: args.iter().map(|a| qe(a, map)).collect(),
        },
        Expr::Member { base, field } => Expr::Member {
            base: Box::new(qe(base, map)),
            field: field.clone(),
        },
    }
}
