//! Walk the IRIS AST (from `iris-sim`) and write SystemVerilog.
//!
//! Covers module headers with ANSI ports, internal signals, and `comb` blocks
//! of assignments over the full expression grammar. `sync`, memories, and FSMs
//! arrive in later slices.

use std::cell::RefCell;
use std::collections::HashMap;

use iris_sim::parser::{
    BinOp, Expression, Literal, LogicBlock, MatchExprArm, Module, Pattern, PortDirection, Signal,
    Statement, Type, UnaryOp,
};

fn unsupported(what: &str) -> String {
    format!("iris2sv: '{}' is not supported and was not converted", what)
}

thread_local! {
    /// While a module is being emitted: instance name -> (output port -> wire).
    /// A member access `inst.port` on a wired output becomes the wire name.
    static WIRES: RefCell<HashMap<String, HashMap<String, String>>> = RefCell::new(HashMap::new());
}

/// The generated wire for `inst.port`, if that output was wired.
fn wire_for(inst: &str, port: &str) -> Option<String> {
    WIRES.with(|w| w.borrow().get(inst).and_then(|m| m.get(port)).cloned())
}

/// `typedef enum <base> { A = 0, ... } Name;`
pub fn enum_decl_to_sv(e: &iris_sim::parser::EnumDecl) -> String {
    // Without a declared base, the width is inferred from the variant count.
    let base = match &e.underlying {
        Some(t) => type_to_sv(t).unwrap_or_else(|_| "logic".to_string()),
        None => {
            let bits = clog2(e.variants.len());
            if bits <= 1 {
                "logic".to_string()
            } else {
                format!("logic [{}:0]", bits - 1)
            }
        }
    };
    let mut out = format!("typedef enum {} {{\n", base);
    for (i, v) in e.variants.iter().enumerate() {
        let comma = if i + 1 < e.variants.len() { "," } else { "" };
        // Variants are numbered explicitly, using their value or their index.
        let value = match &v.value {
            Some(val) => emit_expr(val),
            None => i.to_string(),
        };
        out.push_str(&format!("  {} = {}{}\n", v.name, value, comma));
    }
    out.push_str(&format!("}} {};", e.name));
    out
}

/// Bits needed to index `n` values: `clog2(n)`.
fn clog2(n: usize) -> usize {
    if n <= 1 {
        1
    } else {
        (usize::BITS - (n - 1).leading_zeros()) as usize
    }
}

/// `typedef struct|union packed { <type> <name>; ... } Name;`
pub fn struct_decl_to_sv(s: &iris_sim::parser::StructDecl) -> Result<String, String> {
    let kind = if s.is_union { "union" } else { "struct" };
    let mut out = format!("typedef {} packed {{\n", kind);
    for (name, ty) in &s.fields {
        out.push_str(&format!("  {} {};\n", type_to_sv(ty)?, name));
    }
    out.push_str(&format!("}} {};", s.name));
    Ok(out)
}

/// `interface Name; <signals> <modports> endinterface`
pub fn interface_decl_to_sv(iface: &iris_sim::parser::Interface) -> Result<String, String> {
    let mut out = format!("interface {};\n", iface.name);
    for sig in &iface.signals {
        out.push_str(&format!("  {} {};\n", type_to_sv(&sig.ty)?, sig.name));
    }
    for view in &iface.views {
        out.push('\n');
        let sigs: Vec<String> = view
            .signals
            .iter()
            .map(|vs| {
                let dir = match vs.direction {
                    iris_sim::parser::ViewDirection::In => "input",
                    iris_sim::parser::ViewDirection::Out => "output",
                    iris_sim::parser::ViewDirection::InOut => "inout",
                };
                format!("{} {}", dir, vs.name)
            })
            .collect();
        out.push_str(&format!("  modport {} ({});\n", view.name, sigs.join(", ")));
    }
    out.push_str("endinterface");
    Ok(out)
}

/// `function automatic <ret> name(<args>); return <body>; endfunction`
pub fn function_decl_to_sv(f: &iris_sim::parser::FnDecl) -> Result<String, String> {
    let ret = match &f.return_type {
        Some(t) => type_to_sv(t)?,
        None => "logic".to_string(),
    };
    let ret_w = f.return_type.as_ref().and_then(cast_width);
    let args: Vec<String> = f
        .params
        .iter()
        .map(|(name, ty)| Ok(format!("input {} {}", type_to_sv(ty)?, name)))
        .collect::<Result<_, String>>()?;
    let mut out = format!("function automatic {} {}({});\n", ret, f.name, args.join(", "));
    out.push_str(&format!("  return {};\n", emit_value(&f.body, ret_w.as_deref())));
    out.push_str("endfunction");
    Ok(out)
}

pub fn module_to_sv(module: &Module, modules: &HashMap<String, Module>) -> Result<String, String> {
    // An instance's unconnected output ports get generated wires, but only when
    // the instantiated module is known in this file (so its ports are visible).
    // A cross-file instance keeps `inst.port` as a hierarchical reference.
    let wires = wires_for_instances(module, modules);
    WIRES.with(|w| *w.borrow_mut() = wires.clone());

    // The size-cast width of every port and signal, as an expression (a literal
    // like `8` or a parameter like `PtrWidth`), so an assignment's right-hand
    // side can be cast to its target's width the way the TypeScript tool does.
    let mut widths: HashMap<String, String> = HashMap::new();
    for p in &module.ports {
        if let Some(w) = cast_width(&p.ty) {
            widths.insert(p.name.clone(), w);
        }
    }
    for s in &module.signals {
        if let Some(w) = cast_width(&s.ty) {
            widths.insert(s.name.clone(), w);
        }
    }
    for m in &module.memories {
        if let Some(w) = cast_width(&m.element_type) {
            widths.insert(m.name.clone(), w);
        }
    }

    // Port types are column-aligned: the type field is padded to the widest
    // type so the names line up.
    let port_types: Vec<String> = module
        .ports
        .iter()
        .map(|p| type_to_sv(&p.ty))
        .collect::<Result<_, _>>()?;
    let type_col = port_types.iter().map(|t| t.len()).max().unwrap_or(0);

    let mut out = if module.ports.is_empty() && module.generics.is_empty() {
        // A testbench module has no ports.
        format!("module {};\n\n", module.name)
    } else if module.generics.is_empty() {
        format!("module {} (\n", module.name)
    } else {
        let params: Vec<String> = module
            .generics
            .iter()
            .map(|g| {
                let ty = type_to_sv(&g.ty).unwrap_or_else(|_| "logic [31:0]".to_string());
                match &g.default_value {
                    Some(d) => format!("  parameter {} {} = {}", ty, g.name, param_default(d)),
                    None => format!("  parameter {} {}", ty, g.name),
                }
            })
            .collect();
        format!("module {} #(\n{}\n) (\n", module.name, params.join(",\n"))
    };
    let has_header_ports = !(module.ports.is_empty() && module.generics.is_empty());
    if has_header_ports {
        for (i, port) in module.ports.iter().enumerate() {
            let comma = if i + 1 < module.ports.len() { "," } else { "" };
            let dir = dir_to_sv(&port.direction)?;
            out.push_str(&format!(
                "  {:<6} {:<width$} {}{}\n",
                dir,
                port_types[i],
                port.name,
                comma,
                width = type_col
            ));
        }
        out.push_str(");\n\n");
    }

    let wire_decls = wire_declarations(module, modules, &wires);
    if !module.signals.is_empty() || !module.memories.is_empty() || !wire_decls.is_empty() {
        out.push_str("// Internal signals\n");
        for decl in &wire_decls {
            out.push_str(&format!("  {}\n", decl));
        }
        for s in &module.signals {
            out.push_str(&format!("  {}\n", signal_to_sv(s)?));
        }
        for m in &module.memories {
            let depth = match &m.depth_expr {
                Some(e) => emit_expr(e),
                None => m.depth.to_string(),
            };
            out.push_str(&format!("  {} {} [{}];\n", type_to_sv(&m.element_type)?, m.name, depth));
        }
        out.push('\n');
    }

    // Combinational blocks are emitted before sequential ones, matching the
    // TypeScript tool, regardless of their order in the source.
    for block in &module.logic_blocks {
        if let LogicBlock::Comb(comb) = block {
            out.push_str(&block_to_sv("always_comb", None, &comb.statements, false, &widths)?);
        }
    }
    for block in &module.logic_blocks {
        if let LogicBlock::Sync(sync) = block {
            let clause = sync_clause(module, sync)?;
            let stmts = reset_wrapped(module, sync).unwrap_or_else(|| sync.statements.clone());
            out.push_str(&block_to_sv("always_ff", Some(&clause), &stmts, true, &widths)?);
        }
    }

    out.push_str(&emit_clocks_resets(module));

    if !module.instances.is_empty() {
        out.push_str("// Module instances\n");
        for (i, inst) in module.instances.iter().enumerate() {
            out.push_str(&format!("  {} {} (\n", inst.module_name, inst.name));
            // A known target's ports are listed in its own order, filling in the
            // generated wires for unconnected outputs; a cross-file target keeps
            // the connections as written.
            let conns: Vec<(String, String)> = match modules.get(&inst.module_name) {
                Some(target) => target
                    .ports
                    .iter()
                    .filter_map(|p| {
                        if let Some((_, e)) =
                            inst.port_connections.iter().find(|(n, _)| n == &p.name)
                        {
                            Some((p.name.clone(), emit_expr(e)))
                        } else {
                            wires
                                .get(&inst.name)
                                .and_then(|m| m.get(&p.name))
                                .map(|w| (p.name.clone(), w.clone()))
                        }
                    })
                    .collect(),
                None => inst
                    .port_connections
                    .iter()
                    .map(|(n, e)| (n.clone(), emit_expr(e)))
                    .collect(),
            };
            for (j, (port, val)) in conns.iter().enumerate() {
                let comma = if j + 1 < conns.len() { "," } else { "" };
                out.push_str(&format!("    .{}({}){}\n", port, val, comma));
            }
            out.push_str("  );\n");
            if i + 1 < module.instances.len() {
                out.push('\n');
            }
        }
        out.push('\n');
    }

    out.push_str("endmodule\n");
    Ok(out)
}

/// For each instance of a known module, the output ports that are not connected
/// explicitly get a generated wire `{inst}_{port}` (suffixed to avoid clashes).
fn wires_for_instances(
    module: &Module,
    modules: &HashMap<String, Module>,
) -> HashMap<String, HashMap<String, String>> {
    let mut taken: std::collections::HashSet<String> = module
        .ports
        .iter()
        .map(|p| p.name.clone())
        .chain(module.signals.iter().map(|s| s.name.clone()))
        .chain(module.memories.iter().map(|m| m.name.clone()))
        .collect();
    let mut wires = HashMap::new();
    for inst in &module.instances {
        let Some(target) = modules.get(&inst.module_name) else {
            continue;
        };
        let mut for_this = HashMap::new();
        for port in &target.ports {
            if port.direction != PortDirection::Out {
                continue;
            }
            if inst.port_connections.iter().any(|(name, _)| name == &port.name) {
                continue;
            }
            let mut name = format!("{}_{}", inst.name, port.name);
            while taken.contains(&name) {
                name.push('_');
            }
            taken.insert(name.clone());
            for_this.insert(port.name.clone(), name);
        }
        if !for_this.is_empty() {
            wires.insert(inst.name.clone(), for_this);
        }
    }
    wires
}

/// The declarations for generated instance-output wires, in instance then port
/// order, each `logic [w] wire;`.
fn wire_declarations(
    module: &Module,
    modules: &HashMap<String, Module>,
    wires: &HashMap<String, HashMap<String, String>>,
) -> Vec<String> {
    let mut decls = Vec::new();
    for inst in &module.instances {
        let (Some(ports), Some(target)) = (wires.get(&inst.name), modules.get(&inst.module_name))
        else {
            continue;
        };
        for port in &target.ports {
            if let Some(wire) = ports.get(&port.name) {
                let ty = type_to_sv(&port.ty).unwrap_or_else(|_| "logic".to_string());
                decls.push(format!("{} {};", ty, wire));
            }
        }
    }
    decls
}

/// When an `always_ff` has an async reset and the module has registers with
/// initial values, iris2sv prepends a reset branch that restores each register,
/// with the original body as the `else`.
fn reset_wrapped(module: &Module, sync: &iris_sim::parser::SyncBlock) -> Option<Vec<Statement>> {
    let reset = sync.reset.as_ref()?;
    // Only registers actually written in this block are reset; combinational
    // intermediates declared `var` but driven elsewhere are not.
    let mut written = std::collections::HashSet::new();
    for stmt in &sync.statements {
        collect_assigned(stmt, &mut written);
    }
    let regs: Vec<&Signal> = module
        .signals
        .iter()
        .filter(|s| s.is_var && s.init_value.is_some() && written.contains(&s.name))
        .collect();
    if regs.is_empty() {
        return None;
    }
    let condition = if reset_active_low(module, &reset.signal) {
        Expression::UnaryOp {
            op: UnaryOp::LogNot,
            expr: Box::new(Expression::Ident(reset.signal.clone())),
        }
    } else {
        Expression::Ident(reset.signal.clone())
    };
    let then_branch = regs
        .iter()
        .map(|s| Statement::Assign {
            target: s.name.clone(),
            value: s.init_value.clone().unwrap(),
        })
        .collect();
    Some(vec![Statement::If {
        condition,
        then_branch,
        else_branch: Some(sync.statements.clone()),
    }])
}

/// Collect the names assigned by a statement, recursing into `if` branches.
fn collect_assigned(stmt: &Statement, out: &mut std::collections::HashSet<String>) {
    match stmt {
        Statement::Assign { target, .. } => {
            out.insert(target.clone());
        }
        Statement::If { then_branch, else_branch, .. } => {
            for s in then_branch {
                collect_assigned(s, out);
            }
            if let Some(els) = else_branch {
                for s in els {
                    collect_assigned(s, out);
                }
            }
        }
        _ => {}
    }
}

fn time_unit(u: iris_sim::parser::TimeUnit) -> &'static str {
    use iris_sim::parser::TimeUnit::*;
    match u {
        Ps => "ps",
        Ns => "ns",
        Us => "us",
        Ms => "ms",
        S => "s",
    }
}

/// Clock generation (a toggling `always` and an initial value) and reset
/// stimulus (`initial` asserting then releasing), for a test module's clock and
/// reset signals.
fn emit_clocks_resets(module: &Module) -> String {
    let mut out = String::new();
    // The clock period drives the reset hold time.
    let period = module
        .signals
        .iter()
        .find_map(|s| s.clock_config.as_ref().and_then(|c| c.period.as_ref()));

    for s in &module.signals {
        if !matches!(s.ty, Type::Clock) {
            continue;
        }
        let cfg = s.clock_config.as_ref();
        if let Some(p) = cfg.and_then(|c| c.period.as_ref()) {
            out.push_str(&format!(
                "  always begin\n    #{}{};\n    {} = ~{};\n  end\n\n",
                p.value / 2,
                time_unit(p.unit),
                s.name,
                s.name
            ));
        }
        let init = cfg.and_then(|c| c.initial_value).unwrap_or(false) as u8;
        out.push_str(&format!("  initial \n    {} = 1'd{};\n\n", s.name, init));
    }

    for s in &module.signals {
        if !matches!(s.ty, Type::Reset { .. }) && s.reset_config.is_none() {
            continue;
        }
        if !matches!(s.ty, Type::Reset { .. }) {
            continue;
        }
        let active_low = reset_active_low(module, &s.name);
        let assert = if active_low { 0 } else { 1 };
        let cfg = s.reset_config.as_ref();
        let hold = match cfg.and_then(|c| c.assert_time.as_ref()) {
            Some(d) => format!("{}{}", d.value, time_unit(d.unit)),
            None => {
                let cycles = cfg.and_then(|c| c.assert_cycles).unwrap_or(2);
                match period {
                    Some(p) => format!("{}{}", cycles * p.value, time_unit(p.unit)),
                    None => format!("{}", cycles),
                }
            }
        };
        out.push_str(&format!(
            "  initial begin\n    {} = 1'd{};\n    #{};\n    {} = 1'd{};\n  end\n\n",
            s.name,
            assert,
            hold,
            s.name,
            1 - assert
        ));
    }
    out
}

/// Whether a reset (a port or a test-module signal) is active-low.
fn reset_active_low(module: &Module, name: &str) -> bool {
    for p in &module.ports {
        if p.name == name {
            if let Type::Reset { active_low } = p.ty {
                return active_low;
            }
        }
    }
    for s in &module.signals {
        if s.name == name {
            if let Type::Reset { active_low } = s.ty {
                if active_low {
                    return true;
                }
            }
            if let Some(rc) = &s.reset_config {
                return rc.active_low;
            }
        }
    }
    false
}

/// The `@(...)` sensitivity list of an `always_ff`: the clock edge, and a reset
/// edge whose direction follows the reset's active level.
fn sync_clause(module: &Module, sync: &iris_sim::parser::SyncBlock) -> Result<String, String> {
    let clk_edge = match sync.clock.edge {
        iris_sim::parser::ClockEdge::Posedge => "posedge",
        iris_sim::parser::ClockEdge::Negedge => "negedge",
    };
    let mut parts = format!("{} {}", clk_edge, sync.clock.signal);
    // The reset appears in the sensitivity list only when it actually resets
    // something — a registered signal with an initial value. A reset that drives
    // nothing (as in a register file whose store has no reset value) is dropped,
    // matching the TypeScript tool.
    let resets_something = module.signals.iter().any(|s| s.is_var && s.init_value.is_some());
    if let Some(reset) = &sync.reset {
        if resets_something {
            // An active-low reset is edge-triggered on its falling edge.
            let edge = if reset_active_low(module, &reset.signal) { "negedge" } else { "posedge" };
            parts.push_str(&format!(" or {} {}", edge, reset.signal));
        }
    }
    Ok(format!("@({})", parts))
}

fn dir_to_sv(d: &PortDirection) -> Result<&'static str, String> {
    match d {
        PortDirection::In => Ok("input"),
        PortDirection::Out => Ok("output"),
        PortDirection::InOut => Ok("inout"),
        _ => Err(unsupported("interface port")),
    }
}

/// A parameter default. A literal is written as an unsized hexadecimal, the way
/// the TypeScript tool emits generic defaults (`1024` -> `'h400`).
fn param_default(expr: &Expression) -> String {
    // A small literal is decimal; a large one (>= 256) is an unsized hex; a
    // computed default (`$clog2(Depth) + 1`) is emitted as an expression.
    let lit_value = match expr {
        Expression::Literal(Literal::Decimal { value, .. }) => Some(*value as u64),
        Expression::Literal(Literal::Hex { value, .. }) => Some(*value),
        Expression::Literal(Literal::Binary { value, .. }) => Some(*value),
        _ => None,
    };
    match lit_value {
        Some(v) if v < 256 => format!("{}", v),
        Some(v) => format!("'h{:x}", v),
        None => emit_expr(expr),
    }
}

fn signal_to_sv(s: &Signal) -> Result<String, String> {
    let ty = type_to_sv(&s.ty)?;
    match &s.init_value {
        Some(init) => Ok(format!("{} {} = {};", ty, s.name, emit_expr(init))),
        None => Ok(format!("{} {};", ty, s.name)),
    }
}

/// A SystemVerilog type. A one-bit signal is `logic`; a vector is
/// `logic [w-1:0]`; a signed integer adds `signed`.
fn type_to_sv(ty: &Type) -> Result<String, String> {
    Ok(match ty {
        Type::Bit | Type::Bool | Type::Clock | Type::Reset { .. } => "logic".to_string(),
        Type::BitVec { width } => format!("logic [{}:0]", width - 1),
        Type::Int { width, signed: true } => format!("logic signed [{}:0]", width - 1),
        Type::Int { width, signed: false } => format!("logic [{}:0]", width - 1),
        // A user-defined type (enum/struct/union) is referred to by its name.
        Type::Named(name) => name.clone(),
        // A parametric width: `bit[DataWidth]` -> `logic [DataWidth-1:0]`.
        Type::BitVecExpr { expr } => format!("logic [{}-1:0]", emit_expr(expr)),
        // IEEE-754 floats map to SystemVerilog's real types.
        Type::Float { bits: 32 } => "shortreal".to_string(),
        Type::Float { bits: 64 } => "real".to_string(),
        other => return Err(unsupported(&format!("{:?}", other))),
    })
}

fn width_of(ty: &Type) -> Option<usize> {
    match ty {
        Type::Bit | Type::Bool | Type::Clock | Type::Reset { .. } => Some(1),
        Type::BitVec { width } => Some(*width),
        Type::Int { width, .. } => Some(*width),
        _ => None,
    }
}

/// The width used to size-cast a value assigned to this type, as an expression:
/// a literal count, or a parameter name for a parametric width.
fn cast_width(ty: &Type) -> Option<String> {
    match ty {
        Type::Bit | Type::Bool | Type::Clock | Type::Reset { .. } => Some("1".to_string()),
        Type::BitVec { width } => Some(width.to_string()),
        Type::Int { width, .. } => Some(width.to_string()),
        Type::BitVecExpr { expr } => Some(emit_expr(expr)),
        _ => None,
    }
}

/// Emit an `always_comb`/`always_ff` block. A single statement follows the
/// keyword directly; several are wrapped in `begin`/`end`. `nb` selects the
/// non-blocking assignment (`<=`) used inside `always_ff`.
fn block_to_sv(
    kw: &str,
    clause: Option<&str>,
    stmts: &[Statement],
    nb: bool,
    widths: &HashMap<String, String>,
) -> Result<String, String> {
    let head = match clause {
        Some(c) => format!("  {} {} ", kw, c),
        None => format!("  {} ", kw),
    };
    let mut out = String::new();
    if stmts.len() == 1 {
        out.push_str(&head);
        out.push('\n');
        out.push_str(&emit_stmt(&stmts[0], 4, nb, widths)?);
        out.push('\n');
    } else {
        out.push_str(head.trim_end());
        out.push_str(" begin\n");
        for stmt in stmts {
            out.push_str(&emit_stmt(stmt, 4, nb, widths)?);
            out.push('\n');
        }
        out.push_str("  end\n");
    }
    out.push('\n');
    Ok(out)
}

/// Emit one statement at the given indent. Nested single-statement branches omit
/// `begin`/`end`; multi-statement branches use them.
fn emit_stmt(
    stmt: &Statement,
    indent: usize,
    nb: bool,
    widths: &HashMap<String, String>,
) -> Result<String, String> {
    let pad = " ".repeat(indent);
    let op = if nb { "<=" } else { "=" };
    match stmt {
        Statement::Assign { target, value } => {
            let tw = widths.get(target).map(|s| s.as_str());
            Ok(format!("{}{} {} {};", pad, target, op, emit_value(value, tw)))
        }
        Statement::MemWrite { mem_name, addr, value } => {
            let tw = widths.get(mem_name).map(|s| s.as_str());
            Ok(format!(
                "{}{}[{}] {} {};",
                pad,
                mem_name,
                emit_expr(addr),
                op,
                emit_value(value, tw)
            ))
        }
        Statement::If { condition, then_branch, else_branch } => {
            let mut s = format!("{}if ({}) ", pad, emit_expr(condition));
            s.push_str(&emit_branch(then_branch, indent, nb, widths)?);
            if let Some(els) = else_branch {
                // `else if` chains onto the same line when the else branch is a
                // single `if`.
                if let [inner @ Statement::If { .. }] = els.as_slice() {
                    let chained = emit_stmt(inner, indent, nb, widths)?;
                    let chained = chained.trim_start_matches(' ');
                    s.push_str(&format!("\n{}else {}", pad, chained));
                } else {
                    s.push_str(&format!("\n{}else ", pad));
                    s.push_str(&emit_branch(els, indent, nb, widths)?);
                }
            }
            Ok(s)
        }
        Statement::SysCall(expr) => Ok(format!("{}{};", pad, emit_expr(expr))),
        Statement::Assert(a) => {
            let sev = match a.severity {
                iris_sim::parser::AssertSeverity::Error => "error",
                iris_sim::parser::AssertSeverity::Warning => "warning",
                iris_sim::parser::AssertSeverity::Fatal => "fatal",
            };
            let msg = a.message.clone().unwrap_or_default();
            Ok(format!(
                "{}assert ({}) else ${}(\"{}\");",
                pad,
                emit_expr(&a.condition),
                sev,
                msg
            ))
        }
        _ => Err(unsupported("statement")),
    }
}

/// A branch of an `if`: a single statement on the next line, or a `begin`/`end`
/// block for several.
fn emit_branch(
    stmts: &[Statement],
    indent: usize,
    nb: bool,
    widths: &HashMap<String, String>,
) -> Result<String, String> {
    let pad = " ".repeat(indent);
    if stmts.len() == 1 {
        Ok(format!("\n{}", emit_stmt(&stmts[0], indent + 2, nb, widths)?))
    } else {
        let mut s = String::from("begin\n");
        for stmt in stmts {
            s.push_str(&emit_stmt(stmt, indent + 2, nb, widths)?);
            s.push('\n');
        }
        s.push_str(&format!("{}end", pad));
        Ok(s)
    }
}

/// Whether an operator can grow the operand width, so its result is size-cast
/// to the assignment target (`a + b` -> `w'(a + b)`).
fn is_growing(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Shl)
}

/// Emit an expression in a value position, size-casting a growing operation to
/// the target width and carrying that context into `match`/`if` branches.
fn emit_value(expr: &Expression, tw: Option<&str>) -> String {
    match expr {
        Expression::Match { scrutinee, arms } => match_to_ternary(scrutinee, arms, tw),
        Expression::If { condition, then_expr, else_expr } => format!(
            "{} ? {} : {}",
            emit_expr(condition),
            emit_value(then_expr, tw),
            emit_value(else_expr, tw)
        ),
        Expression::BinOp { op, .. } if is_growing(*op) => match tw {
            Some(w) => format!("{}'({})", w, emit_expr(expr)),
            None => emit_expr(expr),
        },
        // A non-growing operator keeps the cast context flowing into its
        // operands, so a growing operation nested inside is still cast.
        Expression::BinOp { op, lhs, rhs } => {
            format!("{} {} {}", emit_value(lhs, tw), binop_to_sv(*op), emit_value(rhs, tw))
        }
        _ => emit_expr(expr),
    }
}

/// A `match` value becomes a chain of ternaries: `s == p0 ? v0 : ... : default`.
fn match_to_ternary(scrutinee: &Expression, arms: &[MatchExprArm], tw: Option<&str>) -> String {
    let s = emit_expr(scrutinee);
    let has_wildcard = arms.iter().any(|a| matches!(a.pattern, Pattern::Wildcard));
    let last = arms.len().saturating_sub(1);
    let mut out = String::new();
    let mut default = String::from("0");
    for (i, arm) in arms.iter().enumerate() {
        match &arm.pattern {
            Pattern::Wildcard => default = emit_value(&arm.value, tw),
            // With no wildcard the match is exhaustive, so the last arm's value
            // is the final `else`, not another guarded branch.
            other if !has_wildcard && i == last => default = emit_value(&arm.value, tw),
            other => {
                out.push_str(&format!(
                    "{} == {} ? {} : ",
                    s,
                    pattern_to_sv(other),
                    emit_value(&arm.value, tw)
                ));
            }
        }
    }
    format!("{}{}", out, default)
}

fn pattern_to_sv(p: &Pattern) -> String {
    match p {
        Pattern::Literal(lit) => literal_to_sv(lit),
        Pattern::Ident(name) => strip_enum_qualifier(name),
        Pattern::Path { path, .. } => strip_enum_qualifier(path),
        _ => format!("/* pattern {:?} */", p),
    }
}

/// `Op::Add` -> `Add`; a name without `::` is unchanged.
fn strip_enum_qualifier(name: &str) -> String {
    match name.rsplit_once("::") {
        Some((_, member)) => member.to_string(),
        None => name.to_string(),
    }
}

fn emit_expr(expr: &Expression) -> String {
    match expr {
        Expression::Literal(lit) => literal_to_sv(lit),
        // A qualified enum member (`Op::Add`) is written unqualified in
        // SystemVerilog (`Add`); a plain identifier is unchanged.
        Expression::Ident(name) => strip_enum_qualifier(name),
        Expression::BinOp { op, lhs, rhs } => {
            format!("{} {} {}", emit_expr(lhs), binop_to_sv(*op), emit_expr(rhs))
        }
        Expression::UnaryOp { op, expr } => format!("{}{}", unop_to_sv(*op), emit_expr(expr)),
        Expression::Index { base, index } => {
            format!("{}[{}]", emit_expr(base), emit_expr(index))
        }
        Expression::Slice { base, high, low } => {
            format!("{}[{}:{}]", emit_expr(base), slice_bound(high), slice_bound(low))
        }
        Expression::PartSelect { base, index, width, upward } => {
            let op = if *upward { "+:" } else { "-:" };
            format!("{}[{} {} {}]", emit_expr(base), emit_expr(index), op, emit_expr(width))
        }
        Expression::Concat(parts) => {
            let inner: Vec<String> = parts.iter().map(emit_expr).collect();
            format!("{{{}}}", inner.join(", "))
        }
        Expression::If { condition, then_expr, else_expr } => format!(
            "{} ? {} : {}",
            emit_expr(condition),
            emit_expr(then_expr),
            emit_expr(else_expr)
        ),
        Expression::Match { scrutinee, arms } => match_to_ternary(scrutinee, arms, None),
        Expression::MethodCall { receiver, method, args } => method_to_sv(receiver, method, args),
        Expression::Call { name, args } => {
            let inner: Vec<String> = args.iter().map(emit_expr).collect();
            format!("{}({})", name, inner.join(", "))
        }
        Expression::SysFunc { name, args } => {
            let inner: Vec<String> = args
                .iter()
                .map(|a| match a {
                    iris_sim::parser::SysFuncArg::Expr(e) => emit_expr(e),
                    iris_sim::parser::SysFuncArg::Str(s) => format!("\"{}\"", s),
                    iris_sim::parser::SysFuncArg::Type(t) => type_to_sv(t).unwrap_or_default(),
                })
                .collect();
            format!("${}({})", name, inner.join(", "))
        }
        // These arrive in later slices.
        other => format!("/* unsupported: {:?} */", other),
    }
}

/// A method call. Width-changing methods become SystemVerilog size casts, and
/// the sign methods become `$signed`/`$unsigned`.
fn method_to_sv(receiver: &Expression, method: &str, args: &[Expression]) -> String {
    let r = emit_expr(receiver);
    let width = || args.first().map(emit_expr).unwrap_or_default();
    match method {
        "sign_extend" => format!("{}'($signed({}))", width(), r),
        "zero_extend" => format!("{}'($unsigned({}))", width(), r),
        "extend" | "truncate" => format!("{}'({})", width(), r),
        "signed" => format!("$signed({})", r),
        "unsigned" => format!("$unsigned({})", r),
        // A no-argument call is a member access: an instance output or an
        // interface signal. A wired instance output becomes its wire name; a
        // cross-file one stays a hierarchical reference (`rf.rdata1`).
        _ if args.is_empty() => {
            if let Expression::Ident(inst) = receiver {
                if let Some(wire) = wire_for(inst, method) {
                    return wire;
                }
            }
            format!("{}.{}", r, method)
        }
        other => format!("/* unsupported method: {} */{}", other, r),
    }
}

/// A literal. A sized literal of width up to eight bits is written in decimal;
/// a wider one in hexadecimal, matching the TypeScript tool.
fn literal_to_sv(lit: &Literal) -> String {
    match lit {
        Literal::Decimal { width: None, value } => format!("{}", value),
        Literal::Decimal { width: Some(w), value } => sized(*w, *value as u64),
        Literal::Hex { width, value } => sized(*width, *value),
        Literal::Binary { width, value } => sized(*width, *value),
        Literal::Real { text } => text.clone(),
    }
}

fn sized(width: usize, value: u64) -> String {
    if width <= 8 {
        format!("{}'d{}", width, value)
    } else {
        format!("{}'h{:x}", width, value)
    }
}

/// A slice bound. A computed bound is cast to 32 bits (`32'(AddrWidth - 1)`);
/// a literal is left as it is.
fn slice_bound(e: &Expression) -> String {
    match e {
        Expression::BinOp { .. } => format!("32'({})", emit_expr(e)),
        _ => emit_expr(e),
    }
}

fn binop_to_sv(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Mod => "%",
        BinOp::And => "&",
        BinOp::Or => "|",
        BinOp::Xor => "^",
        BinOp::Shl => "<<",
        BinOp::Shr => ">>",
        BinOp::AShr => ">>>",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::LogicalAnd => "&&",
        BinOp::LogicalOr => "||",
    }
}

fn unop_to_sv(op: UnaryOp) -> &'static str {
    match op {
        UnaryOp::Not => "~",
        UnaryOp::Neg => "-",
        UnaryOp::LogNot => "!",
    }
}
