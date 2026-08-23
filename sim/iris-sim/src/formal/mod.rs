//! Emit a structural SystemVerilog model of an IRIS design
//!
//! This is the reference side of the formal equivalence flow. `iris2sv` emits
//! the model under test; this emits the one it is proven against.
//!
//! The two *lowerings* must be independent. `iris2sv` was ported to Rust and
//! now reuses `iris-sim`'s parser, so the reference and the design under test
//! share the front end (lexer, parser, AST, the same `Project`). What they do
//! not share is the lowering to SystemVerilog: this emitter is deliberately
//! blunt, while `iris2sv` emits idiomatic SV through a separate code path. A
//! lowering bug in either is therefore visible to the other, which is the whole
//! point: a reference built from `iris2sv`'s own lowered IR would make the miter
//! satisfied by construction and the proof a tautology. A bug in the shared
//! front end is not caught here — it corrupts both sides identically; the
//! interpreter, the round-trip conformance checks, and Verilator's own
//! SystemVerilog front end cover that class instead.
//!
//! What comes out is deliberately blunt:
//!
//!   * one `always_ff` per `sync` block, with the reset branch written out
//!   * `always_comb` with plain `if`/`else`, never a chain of `?:`
//!   * every literal carries its width
//!   * an instance output read as `alu.y` becomes a wire and a port connection
//!   * no size casts, no hierarchical references
//!
//! `iris2sv` produces the opposite: nested ternaries, `32'(...)` casts, inlined
//! logic. For a yosys front-end bug to hide a real difference it would have to
//! corrupt both of those in the same direction, which is a far weaker
//! assumption than sharing a lowering.
//!
//! Anything this cannot express is an error, never a silent omission. A model
//! that quietly drops a construct proves the wrong thing and looks the same
//! doing it.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use crate::parser::ast::{
    BinOp, ClockEdge, Expression, Literal, LogicBlock, MatchArm, MatchExprArm,
    MemDecl, Module, Pattern, Port, PortDirection, ResetMode, Statement, Type, UnaryOp,
};
use crate::project::Project;

/// A construct the reference model cannot express
#[derive(Debug)]
pub struct FormalError {
    pub module: String,
    pub message: String,
}

impl std::fmt::Display for FormalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.module, self.message)
    }
}

impl std::error::Error for FormalError {}

/// Emit every synthesisable module in the project
///
/// Test modules are skipped: they have no ports to compare and drive their own
/// clock, so there is nothing an equivalence check could say about them.
pub fn emit_project(project: &Project) -> Result<String, FormalError> {
    let mut names: Vec<&String> = project
        .modules
        .iter()
        .filter(|(_, m)| !m.is_test && !m.is_extern)
        .map(|(n, _)| n)
        .collect();
    names.sort();

    let mut out = String::new();
    out.push_str("// Reference model for formal equivalence checking\n");
    out.push_str("// Emitted from the IRIS source by iris-formal\n");

    for name in names {
        let module = &project.modules[name];
        out.push('\n');
        out.push_str(&emit_module(module, project)?);
    }
    Ok(out)
}

/// Widths of every module's ports, for wiring instance reads
fn port_widths(project: &Project) -> BTreeMap<String, BTreeMap<String, (usize, bool)>> {
    let mut map = BTreeMap::new();
    for (name, module) in &project.modules {
        let mut ports = BTreeMap::new();
        for port in &module.ports {
            if let Some(width) = port.ty.width() {
                ports.insert(port.name.clone(), (width, is_signed(&port.ty)));
            }
        }
        map.insert(name.clone(), ports);
    }
    map
}

fn is_signed(ty: &Type) -> bool {
    matches!(ty, Type::Int { signed: true, .. })
}

/// `logic [7:0]`, `logic signed [31:0]`, `logic`
///
/// `env` carries the module's generic parameters at their declared defaults.
/// `bit[PtrWidth]` in a top module keeps its width as an expression, because
/// generic substitution only reaches modules that something instantiates, so
/// the expression is evaluated here rather than refused.
fn decl_type_in(ty: &Type, env: &std::collections::HashMap<String, i64>) -> Result<String, String> {
    match ty {
        Type::Bit | Type::Bool | Type::Clock | Type::Reset { .. } => Ok("logic".to_string()),
        Type::BitVec { width } | Type::Enum { width, .. } => {
            Ok(format!("logic [{}:0]", width.saturating_sub(1)))
        }
        Type::Int { width, signed } => Ok(if *signed {
            format!("logic signed [{}:0]", width.saturating_sub(1))
        } else {
            format!("logic [{}:0]", width.saturating_sub(1))
        }),
        Type::Array { element, size } => {
            let inner = decl_type_in(element, env)?;
            Ok(format!("{} [{}:0]", inner, size.saturating_sub(1)))
        }
        Type::BitVecExpr { expr } => match Project::const_value(expr, env) {
            Some(w) if w > 0 => Ok(format!("logic [{}:0]", w - 1)),
            _ => Err("a width that does not resolve to a number".to_string()),
        },
        // The equivalence flow proves designs bit-for-bit with yosys, which
        // reasons in two-valued logic. IEEE-754 reals are not bit-blastable
        // there (yosys `miter`/`equiv`/`sat` have no `real`), so there is no
        // formal model to emit. This is a deliberate boundary, not a stub:
        // the interpreter and compiled backends evaluate floats, but formal
        // equivalence over them is outside what the flow can prove.
        Type::Float { bits } => Err(format!(
            "floating point (f{}) has no formal model: the equivalence flow proves \
             designs bit-for-bit with yosys, and IEEE-754 reals are not bit-blastable there",
            bits
        )),
        Type::Named(n) => Err(format!("the unresolved type '{}'", n)),
    }
}

struct Emitter<'a> {
    module: &'a Module,
    project: &'a Project,
    widths: BTreeMap<String, BTreeMap<String, (usize, bool)>>,
    /// `<instance>.<port>` -> wire name
    reads: BTreeMap<String, String>,
    /// Wires created for instance reads, in declaration order
    read_wires: Vec<(String, usize, bool)>,
    /// True while emitting a `sync` block
    ///
    /// IRIS writes one assignment operator and gives it sequential meaning
    /// inside `sync` (README, "統一代入演算子"). SystemVerilog does not, so a
    /// `sync` assignment has to come out as `<=`.
    ///
    /// Emitting `=` here was wrong twice over. It changes the meaning, because
    /// a later statement in the same block would read the new value rather than
    /// the old one. And it stops yosys inferring a memory from
    /// `dmem[addr] = word`, so a 1024-word array became 32,768 registers
    /// addressed by a 32-bit decoder and `proc` alone ran past two minutes.
    sequential: bool,
    errors: Vec<String>,
}

fn emit_module(module: &Module, project: &Project) -> Result<String, FormalError> {
    let mut em = Emitter {
        module,
        project,
        widths: port_widths(project),
        reads: BTreeMap::new(),
        read_wires: Vec::new(),
        sequential: false,
        errors: Vec::new(),
    };

    em.collect_instance_reads();

    let body = em.body();

    if !em.errors.is_empty() {
        return Err(FormalError {
            module: module.name.clone(),
            message: em.errors.join("; "),
        });
    }

    let mut out = String::new();
    let _ = writeln!(out, "module {} (", module.name);
    let ports: Vec<String> = module
        .ports
        .iter()
        .map(|p| em.port_decl(p))
        .collect::<Result<_, _>>()
        .map_err(|message| FormalError {
            module: module.name.clone(),
            message,
        })?;
    out.push_str(&ports.join(",\n"));
    out.push_str("\n);\n");
    out.push_str(&body);
    out.push_str("endmodule\n");
    Ok(out)
}

impl<'a> Emitter<'a> {
    fn port_decl(&self, port: &Port) -> Result<String, String> {
        let dir = match port.direction {
            PortDirection::In => "input ",
            PortDirection::Out => "output",
            PortDirection::InOut => "inout ",
            other => return Err(format!("the port direction '{}'", other)),
        };
        Ok(format!("  {} {} {}", dir, decl_type_in(&port.ty, &self.generic_defaults())?, port.name))
    }

    /// Find every `<instance>.<port>` the module reads
    fn collect_instance_reads(&mut self) {
        let instances: BTreeMap<&str, &str> = self
            .module
            .instances
            .iter()
            .map(|i| (i.name.as_str(), i.module_name.as_str()))
            .collect();
        if instances.is_empty() {
            return;
        }

        let mut found: BTreeSet<(String, String)> = BTreeSet::new();
        let mut visit = |expr: &Expression, found: &mut BTreeSet<(String, String)>| {
            walk_expr(expr, &mut |e| {
                if let Expression::MethodCall {
                    receiver,
                    method,
                    args,
                } = e
                {
                    if args.is_empty() {
                        if let Expression::Ident(inst) = receiver.as_ref() {
                            if instances.contains_key(inst.as_str()) {
                                found.insert((inst.clone(), method.clone()));
                            }
                        }
                    }
                }
            });
        };

        for block in &self.module.logic_blocks {
            let stmts = match block {
                LogicBlock::Comb(b) => &b.statements,
                LogicBlock::Sync(b) => &b.statements,
            };
            walk_stmts(stmts, &mut |e| visit(e, &mut found));
        }
        for inst in &self.module.instances {
            for (_, expr) in &inst.port_connections {
                visit(expr, &mut found);
            }
        }

        // Taken names, so a generated wire never shadows one
        let mut taken: BTreeSet<String> = BTreeSet::new();
        for p in &self.module.ports {
            taken.insert(p.name.clone());
        }
        for s in &self.module.signals {
            taken.insert(s.name.clone());
        }
        for m in &self.module.memories {
            taken.insert(m.name.clone());
        }

        for (inst, port) in found {
            let module_name = instances[inst.as_str()];
            let Some(&(width, signed)) = self
                .widths
                .get(module_name)
                .and_then(|ports| ports.get(&port))
            else {
                self.errors.push(format!(
                    "'{}.{}' names no port of module '{}'",
                    inst, port, module_name
                ));
                continue;
            };

            let mut wire = format!("{}_{}", inst, port);
            while taken.contains(&wire) {
                wire.push('_');
            }
            taken.insert(wire.clone());
            self.reads.insert(format!("{}.{}", inst, port), wire.clone());
            self.read_wires.push((wire, width, signed));
        }
    }

    fn body(&mut self) -> String {
        let mut out = String::new();

        for sig in &self.module.signals {
            if matches!(sig.ty, Type::Clock | Type::Reset { .. }) && sig.init_value.is_none() {
                continue;
            }
            // The declaration's initial value is part of the circuit, not a
            // convenience. Yosys carries it as the flop's `init` attribute and
            // a bounded check starts from it, so a reference that drops it is a
            // model of a different machine: BMC on the RV32I core reported a
            // difference at t=0 with pc=5, halted=1 in the reference against
            // pc=0, halted=0 in the implementation, which is the initial state
            // and nothing about the design.
            //
            // Induction did not catch this. It proves the step relation over
            // reachable states and never looks at t=0, so `counter` and
            // `regfile` came out proven with the initialisers missing.
            let init = match &sig.init_value {
                Some(expr) => format!(" = {}", self.expr(expr)),
                None => String::new(),
            };
            match decl_type_in(&sig.ty, &self.generic_defaults()) {
                Ok(ty) => {
                    let _ = writeln!(out, "  {} {}{};", ty, sig.name, init);
                }
                Err(why) => self
                    .errors
                    .push(format!("signal '{}' has {}", sig.name, why)),
            }
        }

        for mem in &self.module.memories {
            match self.mem_decl(mem) {
                Ok(line) => out.push_str(&line),
                Err(why) => self.errors.push(why),
            }
        }

        for (wire, width, signed) in &self.read_wires {
            let signed = if *signed { "signed " } else { "" };
            if *width == 1 {
                let _ = writeln!(out, "  logic {}{};", signed, wire);
            } else {
                let _ = writeln!(out, "  logic {}[{}:0] {};", signed, width - 1, wire);
            }
        }

        if !out.is_empty() {
            out.push('\n');
        }

        for block in &self.module.logic_blocks {
            match block {
                LogicBlock::Comb(b) => {
                    self.sequential = false;
                    out.push_str("  always_comb begin\n");
                    out.push_str(&self.stmts(&b.statements, 2));
                    out.push_str("  end\n\n");
                }
                LogicBlock::Sync(b) => {
                    self.sequential = true;
                    out.push_str(&self.sync(b));
                    self.sequential = false;
                    out.push('\n');
                }
            }
        }

        for inst in &self.module.instances {
            out.push_str(&self.instance(inst));
            out.push('\n');
        }

        out
    }

    /// A memory declaration, with its depth resolved to a number
    ///
    /// `mem dmem: bit[32][DataWords]` leaves `depth` at its fallback and puts
    /// the expression in `depth_expr`, because elaboration only substitutes
    /// generics into a module something instantiates. `RiscvCore` is a top
    /// module, so nothing does, and taking `depth` at face value produced a
    /// one-word memory against the 1024 words `iris2sv` emits. The miter then
    /// reported 96 unproven cells on `dmem[0]` and nothing about the other 1023
    /// words, which is a difference between two models of different circuits
    /// rather than a finding about the design.
    fn mem_decl(&self, mem: &MemDecl) -> Result<String, String> {
        let ty = decl_type_in(&mem.element_type, &self.generic_defaults())
            .map_err(|why| format!("memory '{}' has {}", mem.name, why))?;

        let depth = match &mem.depth_expr {
            None => mem.depth,
            Some(expr) => {
                let env = self.generic_defaults();
                match Project::const_value(expr, &env) {
                    Some(n) if n > 0 => n as usize,
                    _ => {
                        return Err(format!(
                            "memory '{}' has a depth that does not resolve to a number",
                            mem.name
                        ))
                    }
                }
            }
        };

        Ok(format!(
            "  {} {} [0:{}];\n",
            ty,
            mem.name,
            depth.saturating_sub(1)
        ))
    }

    /// The module's generic parameters at their declared defaults
    fn generic_defaults(&self) -> std::collections::HashMap<String, i64> {
        let mut env = std::collections::HashMap::new();
        for param in &self.module.generics {
            if let Some(default) = &param.default_value {
                if let Some(value) = Project::const_value(default, &env) {
                    env.insert(param.name.clone(), value);
                }
            }
        }
        env
    }

    /// One `always_ff` per `sync` block, reset branch written out
    ///
    /// Specification 6.3.1: the reset value is the declaration's initial value.
    /// A block that names a reset and writes no reset branch of its own gets
    /// one built from those initialisers. A signal with no initial value keeps
    /// no reset assignment, and a block that resets nothing does not carry the
    /// reset edge in its sensitivity list: an edge that changes something
    /// without saying what it changes to is not a circuit.
    fn sync(&mut self, block: &crate::parser::ast::SyncBlock) -> String {
        let clk_edge = match block.clock.edge {
            ClockEdge::Posedge => "posedge",
            ClockEdge::Negedge => "negedge",
        };

        let mut assigned = BTreeSet::new();
        collect_assigned(&block.statements, &mut assigned);

        let reset_body: Vec<String> = match &block.reset {
            None => Vec::new(),
            Some(_) => self
                .module
                .signals
                .iter()
                .filter(|s| assigned.contains(&s.name))
                .filter_map(|s| {
                    s.init_value
                        .as_ref()
                        .map(|init| format!("      {} <= {};\n", s.name, self.expr(init)))
                })
                .collect(),
        };

        let mut out = String::new();
        match (&block.reset, reset_body.is_empty()) {
            (Some(reset), false) => {
                let active_low = reset_is_active_low(self.module, &reset.signal);
                let edge = if active_low { "negedge" } else { "posedge" };
                let cond = if active_low {
                    format!("!{}", reset.signal)
                } else {
                    reset.signal.clone()
                };
                if reset.mode == ResetMode::Async {
                    let _ = writeln!(
                        out,
                        "  always_ff @({} {} or {} {}) begin",
                        clk_edge, block.clock.signal, edge, reset.signal
                    );
                } else {
                    let _ = writeln!(
                        out,
                        "  always_ff @({} {}) begin",
                        clk_edge, block.clock.signal
                    );
                }
                let _ = writeln!(out, "    if ({}) begin", cond);
                for line in &reset_body {
                    out.push_str(line);
                }
                out.push_str("    end else begin\n");
                out.push_str(&self.stmts(&block.statements, 3));
                out.push_str("    end\n");
                out.push_str("  end\n");
            }
            _ => {
                let _ = writeln!(
                    out,
                    "  always_ff @({} {}) begin",
                    clk_edge, block.clock.signal
                );
                out.push_str(&self.stmts(&block.statements, 2));
                out.push_str("  end\n");
            }
        }
        out
    }

    fn instance(&mut self, inst: &crate::parser::ast::Instance) -> String {
        let mut conns: Vec<String> = inst
            .port_connections
            .iter()
            .map(|(port, expr)| format!("    .{}({})", port, self.expr(expr)))
            .collect();

        for (key, wire) in &self.reads {
            let Some((owner, port)) = key.split_once('.') else {
                continue;
            };
            if owner != inst.name {
                continue;
            }
            if inst.port_connections.iter().any(|(p, _)| p == port) {
                continue;
            }
            conns.push(format!("    .{}({})", port, wire));
        }

        format!(
            "  {} {} (\n{}\n  );\n",
            inst.module_name,
            inst.name,
            conns.join(",\n")
        )
    }

    fn assign_op(&self) -> &'static str {
        if self.sequential {
            "<="
        } else {
            "="
        }
    }

    fn stmts(&mut self, stmts: &[Statement], depth: usize) -> String {
        let mut out = String::new();
        for stmt in stmts {
            out.push_str(&self.stmt(stmt, depth));
        }
        out
    }

    fn stmt(&mut self, stmt: &Statement, depth: usize) -> String {
        let pad = "  ".repeat(depth);
        match stmt {
            Statement::Assign { target, value } => {
                let op = self.assign_op();
                format!("{}{} {} {};\n", pad, target, op, self.expr(value))
            }
            Statement::MemWrite {
                mem_name,
                addr,
                value,
            } => {
                let op = self.assign_op();
                format!(
                    "{}{}[{}] {} {};\n",
                    pad,
                    mem_name,
                    self.expr(addr),
                    op,
                    self.expr(value)
                )
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let mut out = format!("{}if ({}) begin\n", pad, self.expr(condition));
                out.push_str(&self.stmts(then_branch, depth + 1));
                match else_branch {
                    Some(els) if !els.is_empty() => {
                        let _ = write!(out, "{}end else begin\n", pad);
                        out.push_str(&self.stmts(els, depth + 1));
                        let _ = write!(out, "{}end\n", pad);
                    }
                    _ => {
                        let _ = write!(out, "{}end\n", pad);
                    }
                }
                out
            }
            Statement::Match { expr, arms } => self.match_stmt(expr, arms, depth),
            other => {
                self.errors
                    .push(format!("the statement {:?} has no structural form", other));
                String::new()
            }
        }
    }

    /// A `match` becomes a `case`, never a chain of ternaries
    fn match_stmt(&mut self, scrutinee: &Expression, arms: &[MatchArm], depth: usize) -> String {
        let pad = "  ".repeat(depth);
        let mut out = format!("{}case ({})\n", pad, self.expr(scrutinee));
        for arm in arms {
            let labels = self.pattern(&arm.pattern);
            let _ = write!(out, "{}  {}: begin\n", pad, labels);
            out.push_str(&self.stmts(&arm.body, depth + 2));
            let _ = write!(out, "{}  end\n", pad);
        }
        let _ = write!(out, "{}endcase\n", pad);
        out
    }

    /// A case label, or `default` for the wildcard
    fn pattern(&mut self, pattern: &Pattern) -> String {
        match pattern {
            Pattern::Wildcard => "default".to_string(),
            Pattern::Literal(lit) => literal(lit),
            Pattern::Ident(name) => name.clone(),
            other => {
                self.errors
                    .push(format!("the pattern {:?} has no structural form", other));
                "default".to_string()
            }
        }
    }

    /// The comparison a pattern stands for, when a case is not available
    fn pattern_test(&mut self, subject: &str, pattern: &Pattern) -> Option<String> {
        match pattern {
            Pattern::Wildcard => None,
            Pattern::Literal(lit) => Some(format!("({} == {})", subject, literal(lit))),
            Pattern::Ident(name) => Some(format!("({} == {})", subject, name)),
            other => {
                self.errors
                    .push(format!("the pattern {:?} has no structural form", other));
                None
            }
        }
    }

    /// The declared width of a name, if it has one
    fn name_width(&self, name: &str) -> Option<usize> {
        let env = self.generic_defaults();
        let resolve = |ty: &Type| -> Option<usize> {
            match ty {
                Type::BitVecExpr { expr } => {
                    Project::const_value(expr, &env).and_then(|w| usize::try_from(w).ok())
                }
                other => other.width(),
            }
        };
        for port in &self.module.ports {
            if port.name == name {
                return resolve(&port.ty);
            }
        }
        for sig in &self.module.signals {
            if sig.name == name {
                return resolve(&sig.ty);
            }
        }
        for mem in &self.module.memories {
            if mem.name == name {
                return resolve(&mem.element_type);
            }
        }
        self.read_wires
            .iter()
            .find(|(w, _, _)| w == name)
            .map(|(_, w, _)| *w)
    }

    /// How wide an expression is in IRIS
    ///
    /// IRIS is width-safe: adding two `bit[5]` values gives a `bit[5]`, and the
    /// carry is dropped. SystemVerilog promotes the same expression to at least
    /// 32 bits, so `(wr_ptr + 1) >> 1` shifts a value IRIS would already have
    /// truncated. In the async FIFO that is the difference between a gray-code
    /// pointer that wraps and one that does not, and the prover found it as two
    /// unproven cells on bit 4 of `wr_ptr_gray`.
    ///
    /// Only what is needed to place the truncation is inferred. An expression
    /// whose width cannot be determined is emitted without a cast, which leaves
    /// SystemVerilog's own rule in force rather than inventing a width.
    fn expr_width(&self, expr: &Expression) -> Option<usize> {
        match expr {
            Expression::Literal(lit) => lit.width(),
            Expression::Ident(name) => {
                if self.generic_defaults().contains_key(name) {
                    None
                } else {
                    self.name_width(name)
                }
            }
            Expression::BinOp { op, lhs, rhs } => match op {
                BinOp::Eq
                | BinOp::Ne
                | BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::LogicalAnd
                | BinOp::LogicalOr => Some(1),
                _ => match (self.expr_width(lhs), self.expr_width(rhs)) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                },
            },
            Expression::UnaryOp { expr, .. } => self.expr_width(expr),
            Expression::Index { .. } => Some(1),
            Expression::Slice { high, low, .. } => {
                let env = self.generic_defaults();
                let h = Project::const_value(high, &env)?;
                let l = Project::const_value(low, &env)?;
                usize::try_from(h - l + 1).ok()
            }
            Expression::MemRead { mem_name, .. } => self.name_width(mem_name),
            Expression::If {
                then_expr,
                else_expr,
                ..
            } => match (self.expr_width(then_expr), self.expr_width(else_expr)) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            },
            Expression::MethodCall {
                receiver,
                method,
                args,
            } if args.is_empty() => {
                if let Expression::Ident(inst) = receiver.as_ref() {
                    let key = format!("{}.{}", inst, method);
                    if let Some(wire) = self.reads.get(&key) {
                        return self.name_width(wire);
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// Arithmetic that can overflow its operands, and therefore needs the cast
    fn wraps(op: BinOp) -> bool {
        matches!(
            op,
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Shl
        )
    }

    fn expr(&mut self, expr: &Expression) -> String {
        match expr {
            Expression::Literal(lit) => literal(lit),
            // A generic parameter is not a signal. The reference model emits no
            // module parameters, so `bit[AddrWidth]` and `wr_ptr[AddrWidth-1:0]`
            // would name something that does not exist; the value is
            // substituted instead.
            Expression::Ident(name) => match self.generic_defaults().get(name) {
                Some(value) => format!("{}", value),
                None => name.clone(),
            },
            Expression::BinOp { op, lhs, rhs } => {
                let body = format!("({} {} {})", self.expr(lhs), binop(*op), self.expr(rhs));
                match (Self::wraps(*op), self.expr_width(expr)) {
                    (true, Some(w)) if w > 0 => format!("{}'{}", w, body),
                    _ => body,
                }
            }
            Expression::UnaryOp { op, expr } => {
                format!("({}{})", unaryop(*op), self.expr(expr))
            }
            Expression::Index { base, index } => {
                format!("{}[{}]", self.expr(base), self.expr(index))
            }
            Expression::Slice { base, high, low } => {
                format!("{}[{}:{}]", self.expr(base), self.expr(high), self.expr(low))
            }
            Expression::PartSelect {
                base,
                index,
                width,
                upward,
            } => format!(
                "{}[{} {}: {}]",
                self.expr(base),
                self.expr(index),
                if *upward { "+" } else { "-" },
                self.expr(width)
            ),
            Expression::Concat(parts) => {
                let parts: Vec<String> = parts.iter().map(|p| self.expr(p)).collect();
                format!("{{{}}}", parts.join(", "))
            }
            Expression::Replicate { count, value } => {
                let parts: Vec<String> = value.iter().map(|p| self.expr(p)).collect();
                format!("{{{}{{{}}}}}", self.expr(count), parts.join(", "))
            }
            Expression::MemRead { mem_name, addr } => {
                format!("{}[{}]", mem_name, self.expr(addr))
            }
            // `if c { a } else { b }` inside an expression has nowhere to go but
            // a ternary. Statement position is handled above and does not reach
            // here, so what is left is a genuine expression conditional.
            Expression::If {
                condition,
                then_expr,
                else_expr,
            } => format!(
                "({} ? {} : {})",
                self.expr(condition),
                self.expr(then_expr),
                self.expr(else_expr)
            ),
            Expression::Match { scrutinee, arms } => self.match_expr(scrutinee, arms),
            Expression::MethodCall {
                receiver,
                method,
                args,
            } => self.method(receiver, method, args),
            other => {
                self.errors
                    .push(format!("the expression {:?} has no structural form", other));
                "1'b0".to_string()
            }
        }
    }

    /// A `match` used as a value
    ///
    /// SystemVerilog has no case expression, so this is the one place a chain
    /// appears. It is written with every arm's comparison spelled out against
    /// the scrutinee rather than nested inside the previous arm's else, so the
    /// structure stays flat enough to read against the source.
    fn match_expr(&mut self, scrutinee: &Expression, arms: &[MatchExprArm]) -> String {
        let subject = self.expr(scrutinee);
        let mut result = String::new();
        let mut open = 0;
        let mut default = "1'b0".to_string();

        for arm in arms {
            if matches!(arm.pattern, Pattern::Wildcard) {
                default = self.expr(&arm.value);
                continue;
            }
            let Some(test) = self.pattern_test(&subject, &arm.pattern) else {
                continue;
            };
            let value = self.expr(&arm.value);
            let _ = write!(result, "({} ? {} : ", test, value);
            open += 1;
        }

        result.push_str(&default);
        for _ in 0..open {
            result.push(')');
        }
        result
    }

    fn method(&mut self, receiver: &Expression, method: &str, args: &[Expression]) -> String {
        // An instance read: `alu.y` became a wire in collect_instance_reads
        if args.is_empty() {
            if let Expression::Ident(inst) = receiver {
                if let Some(wire) = self.reads.get(&format!("{}.{}", inst, method)) {
                    return wire.clone();
                }
            }
        }

        // `alu.y[1:0]` parses as a call carrying the index
        if args.len() == 1 {
            if let Expression::Ident(inst) = receiver {
                if let Some(wire) = self.reads.get(&format!("{}.{}", inst, method)).cloned() {
                    return format!("{}[{}]", wire, self.expr(&args[0]));
                }
            }
        }

        // Reinterpretation and width methods, specification 3.4.2
        //
        // These are written with SystemVerilog's own casts rather than by
        // padding and slicing by hand. `iris2sv` emits the same three casts, so
        // this is one of the few places the two models are bound to agree in
        // form; the alternative is to reimplement sign extension here and prove
        // that reimplementation instead of the design.
        match method {
            "signed" => {
                let value = self.expr(receiver);
                return format!("$signed({})", value);
            }
            "unsigned" => {
                let value = self.expr(receiver);
                return format!("$unsigned({})", value);
            }
            "sign_extend" | "extend" | "truncate" | "resize" if args.len() == 1 => {
                let value = self.expr(receiver);
                let width = self.expr(&args[0]);
                return match method {
                    // Replicating the sign bit is what $signed inside the cast does
                    "sign_extend" => format!("{}'($signed({}))", width, value),
                    // The rest are a plain resize; SystemVerilog truncates or
                    // zero-pads to the cast width in the same way
                    _ => format!("{}'({})", width, value),
                };
            }
            _ => {}
        }

        self.errors.push(format!(
            "'{}' is a method call the reference model does not implement",
            method
        ));
        "1'b0".to_string()
    }
}

fn reset_is_active_low(module: &Module, signal: &str) -> bool {
    for port in &module.ports {
        if port.name == signal {
            if let Type::Reset { active_low } = port.ty {
                return active_low;
            }
        }
    }
    for sig in &module.signals {
        if sig.name == signal {
            if let Type::Reset { active_low } = sig.ty {
                return active_low;
            }
        }
    }
    // The naming convention is the last resort, and it is what `iris2sv` uses
    signal.ends_with("_n")
}

fn literal(lit: &Literal) -> String {
    match lit {
        Literal::Binary { width, value } => format!("{}'b{:b}", width, value),
        Literal::Hex { width, value } => format!("{}'h{:x}", width, value),
        Literal::Decimal { width, value } => match width {
            Some(w) => format!("{}'d{}", w, value),
            None => format!("{}", value),
        },
        // Unreachable in practice: a float type is refused earlier
        // (decl_type_in), so no real literal reaches formal emission.
        Literal::Real { text } => text.clone(),
    }
}

fn binop(op: BinOp) -> &'static str {
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

fn unaryop(op: UnaryOp) -> &'static str {
    match op {
        UnaryOp::Not => "~",
        UnaryOp::Neg => "-",
        UnaryOp::LogNot => "!",
    }
}

fn collect_assigned(stmts: &[Statement], out: &mut BTreeSet<String>) {
    for stmt in stmts {
        match stmt {
            Statement::Assign { target, .. } => {
                out.insert(target.clone());
            }
            Statement::MemWrite { .. } => {}
            Statement::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_assigned(then_branch, out);
                if let Some(els) = else_branch {
                    collect_assigned(els, out);
                }
            }
            Statement::Match { arms, .. } => {
                for arm in arms {
                    collect_assigned(&arm.body, out);
                }
            }
            _ => {}
        }
    }
}

fn walk_stmts(stmts: &[Statement], f: &mut impl FnMut(&Expression)) {
    for stmt in stmts {
        match stmt {
            Statement::Assign { value, .. } => f(value),
            Statement::MemWrite { addr, value, .. } => {
                f(addr);
                f(value);
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                f(condition);
                walk_stmts(then_branch, f);
                if let Some(els) = else_branch {
                    walk_stmts(els, f);
                }
            }
            Statement::Match { expr, arms } => {
                f(expr);
                for arm in arms {
                    walk_stmts(&arm.body, f);
                }
            }
            _ => {}
        }
    }
}

fn walk_expr(expr: &Expression, f: &mut impl FnMut(&Expression)) {
    f(expr);
    match expr {
        Expression::BinOp { lhs, rhs, .. } => {
            walk_expr(lhs, f);
            walk_expr(rhs, f);
        }
        Expression::UnaryOp { expr, .. } => walk_expr(expr, f),
        Expression::Index { base, index } => {
            walk_expr(base, f);
            walk_expr(index, f);
        }
        Expression::Slice { base, high, low } => {
            walk_expr(base, f);
            walk_expr(high, f);
            walk_expr(low, f);
        }
        Expression::PartSelect {
            base, index, width, ..
        } => {
            walk_expr(base, f);
            walk_expr(index, f);
            walk_expr(width, f);
        }
        Expression::Concat(parts) => parts.iter().for_each(|p| walk_expr(p, f)),
        Expression::Replicate { count, value } => {
            walk_expr(count, f);
            value.iter().for_each(|p| walk_expr(p, f));
        }
        Expression::MemRead { addr, .. } => walk_expr(addr, f),
        Expression::If {
            condition,
            then_expr,
            else_expr,
        } => {
            walk_expr(condition, f);
            walk_expr(then_expr, f);
            walk_expr(else_expr, f);
        }
        Expression::Match { scrutinee, arms } => {
            walk_expr(scrutinee, f);
            for arm in arms {
                walk_expr(&arm.value, f);
            }
        }
        Expression::MethodCall { receiver, args, .. } => {
            walk_expr(receiver, f);
            args.iter().for_each(|a| walk_expr(a, f));
        }
        Expression::Call { args, .. } => args.iter().for_each(|a| walk_expr(a, f)),
        _ => {}
    }
}
