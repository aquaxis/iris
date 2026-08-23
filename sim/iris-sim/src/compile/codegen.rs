//! Rust code generator for IRIS designs
//!
//! The generator walks the elaborated instance tree once and gives every
//! hierarchical signal and memory a fixed slot. What the interpreter resolves
//! by name on every step — which module a signal belongs to, which clock drives
//! a `sync` block, whether a name is a memory or a register — is decided here,
//! and what comes out is straight-line Rust.
//!
//! The arithmetic itself is not reimplemented: the generated code calls the
//! same `iris_runtime::ops` functions the interpreter calls, so a design cannot
//! mean one thing interpreted and another compiled.

use std::collections::HashMap;

use thiserror::Error;

use crate::parser::{
    AssertSeverity, AssertStmt, AwaitExpr, Expression, FsmAction, FsmBlock, Literal, LogicBlock,
    MemInit, MemType, Module, Pattern, PortDirection, SeqStatement, Statement, SysFuncArg, Type,
};
use crate::project::Project;
use crate::sim::eval::Evaluator;
use crate::types::FloatFmt;

/// Code generation error
#[derive(Debug, Error)]
pub enum CodeGenError {
    #[error("{0}")]
    UnsupportedFeature(String),
    #[error("unknown signal '{0}'")]
    UnknownSignal(String),
    #[error("no top module")]
    NoTopModule,
}

/// One place in the instance tree: a module together with the path to it
#[derive(Clone, Debug)]
struct Scope {
    module: String,
    prefix: String,
    /// A scope searched before the module's, used for an FSM's own signals
    inner: Option<String>,
}

impl Scope {
    /// The same place, with an FSM's signals searched first
    fn within(&self, fsm_path: &str) -> Self {
        Self {
            module: self.module.clone(),
            prefix: self.prefix.clone(),
            inner: Some(fsm_path.to_string()),
        }
    }
}

/// A signal slot
struct Slot {
    name: String,
    width: Option<usize>,
    signed: bool,
    hidden: bool,
    /// The floating-point format of this slot, when it has one.
    float: Option<FloatFmt>,
}

/// A memory slot
struct Mem {
    name: String,
    element_width: usize,
    depth: usize,
    is_rom: bool,
    init: Vec<u64>,
    /// The floating-point format of an element, when it has one
    float: Option<FloatFmt>,
}

/// A clock the design drives itself
struct Clock {
    name: String,
    slot: usize,
    period: u64,
}

/// A reset the design drives itself
struct Reset {
    slot: usize,
    active_low: bool,
}

/// Join an instance path with a local name

/// Names a module assigns to, anywhere in its logic blocks.
///
/// A `let` that something assigns to is a register or a block-driven wire; its
/// initialiser is a reset value. A `let` nothing assigns to, declared with an
/// expression, is the continuously driven wire of spec 2.4.3.

/// Flatten a chain of zero-argument method calls into a dotted path
///
/// `core.rf.regs` parses as a method call whose receiver is itself a method
/// call. Reaching a memory two levels down means walking that chain back to
/// the instance name at its root.
fn dotted_path(expr: &Expression) -> Option<String> {
    match expr {
        Expression::Ident(name) => Some(name.clone()),
        Expression::MethodCall {
            receiver,
            method,
            args,
        } if args.is_empty() => {
            let base = dotted_path(receiver)?;
            Some(format!("{}.{}", base, method))
        }
        _ => None,
    }
}

fn assigned_names(module: &Module) -> std::collections::HashSet<String> {
    fn walk(stmts: &[Statement], out: &mut std::collections::HashSet<String>) {
        for stmt in stmts {
            match stmt {
                Statement::Assign { target, .. } => {
                    out.insert(target.clone());
                }
                Statement::SliceWrite { target, .. } => {
                    out.insert(target.clone());
                }
                Statement::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    walk(then_branch, out);
                    if let Some(e) = else_branch {
                        walk(e, out);
                    }
                }
                _ => {}
            }
        }
    }

    let mut out = std::collections::HashSet::new();
    for block in &module.logic_blocks {
        match block {
            LogicBlock::Comb(b) => walk(&b.statements, &mut out),
            LogicBlock::Sync(b) => walk(&b.statements, &mut out),
            _ => {}
        }
    }
    out
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{}.{}", prefix, name)
    }
}

/// Is this type read as two's complement?
fn is_signed(ty: &Type) -> bool {
    matches!(ty, Type::Int { signed: true, .. })
}

fn is_float(ty: &Type) -> bool {
    match ty {
        Type::Float { .. } => true,
        Type::Array { element, .. } => is_float(element),
        _ => false,
    }
}

/// The floating-point format of a type, when it has one.
fn float_fmt_of(ty: &Type) -> Option<FloatFmt> {
    match ty {
        Type::Float { bits: 64 } => Some(FloatFmt::F64),
        Type::Float { .. } => Some(FloatFmt::F32),
        _ => None,
    }
}

/// An arithmetic operator, which on floating-point operands yields a float.
fn is_arith_op(op: crate::parser::BinOp) -> bool {
    use crate::parser::BinOp::*;
    matches!(op, Add | Sub | Mul | Div)
}

/// An operator floating point defines: arithmetic (yields a float) or a
/// comparison (yields one bit).
fn is_float_op(op: crate::parser::BinOp) -> bool {
    use crate::parser::BinOp::*;
    is_arith_op(op) || matches!(op, Eq | Ne | Lt | Le | Gt | Ge)
}

/// The `iris_runtime::value::FloatFmt` path for generated code.
fn fmt_code(fmt: FloatFmt) -> String {
    format!("iris_runtime::value::FloatFmt::{:?}", fmt)
}

/// Generates a standalone Rust simulation from an elaborated project
pub struct SimGenerator {
    project: Project,
    top: String,
    slots: Vec<Slot>,
    slot_of: HashMap<String, usize>,
    mems: Vec<Mem>,
    mem_of: HashMap<String, usize>,
    /// Every scope, in the order the interpreter visits them
    scopes: Vec<Scope>,
    clocks: Vec<Clock>,
    resets: Vec<Reset>,
    is_test: bool,
    /// Cycles of reset at the start of a test
    reset_duration: u64,
    /// Whether reset starts out asserted
    reset_at_start: bool,
    /// Period of the primary clock, in picoseconds
    clock_period: u64,
    /// Clock signal used when the design has a single clock
    single_clock: Option<String>,
    /// Source file named when an assertion fails
    source: String,
    /// Coverage points, in the order they were first seen
    cover_points: Vec<String>,
    /// Counter for the scopes a match arm's binding lives in
    match_scopes: usize,
    out: String,
    indent: usize,
    /// Counter for generated temporaries
    tmp: usize,
    /// Set by `IRIS_NO_WORD_PATH` to force every expression onto the general
    /// path. The two paths must agree, and this is what makes that checkable:
    /// compile a design both ways and compare the waveforms.
    no_word_path: bool,
}

impl SimGenerator {
    /// Prepare a generator for an elaborated project
    pub fn new(project: Project) -> Result<Self, CodeGenError> {
        let top = project.top_module.clone().ok_or(CodeGenError::NoTopModule)?;
        let is_test = project.is_top_test_module();
        let mut gen = Self {
            project,
            top,
            slots: Vec::new(),
            slot_of: HashMap::new(),
            mems: Vec::new(),
            mem_of: HashMap::new(),
            scopes: Vec::new(),
            clocks: Vec::new(),
            resets: Vec::new(),
            is_test,
            reset_duration: 5,
            reset_at_start: false,
            clock_period: 10_000,
            single_clock: None,
            source: "<source>".to_string(),
            no_word_path: std::env::var("IRIS_NO_WORD_PATH").is_ok(),
            cover_points: Vec::new(),
            match_scopes: 0,
            out: String::new(),
            indent: 0,
            tmp: 0,
        };
        gen.collect()?;
        Ok(gen)
    }

    /// Name the source file that assertion reports point at
    pub fn with_source(mut self, path: &str) -> Self {
        self.source = path.to_string();
        self
    }

    /// Generate the whole program.
    ///
    /// The order matters. Emitting a statement can allocate a slot for a name
    /// that appears only as an assignment target, so the slot table is written
    /// after everything that might add to it.
    pub fn generate(mut self) -> Result<String, CodeGenError> {
        self.emit_apply_reset()?;
        self.emit_port_propagation()?;
        self.emit_comb()?;
        self.emit_sync()?;
        self.emit_fsms()?;
        self.emit_initial()?;
        self.emit_run_loop();
        self.emit_main();
        let body = std::mem::take(&mut self.out);

        self.indent = 1;
        self.emit_build_body()?;
        let build_body = std::mem::take(&mut self.out);

        self.indent = 0;
        self.emit_header();
        // `tracing` arrives here because the initial values are recorded inside
        // this function, before the caller gets the runtime back.
        self.open("fn build(tracing: bool) -> Runtime {");
        self.emit_slot_table();
        self.out.push_str(&build_body);
        self.line("rt");
        self.close("}");
        self.blank();
        self.out.push_str(&body);
        Ok(collapse_settle_when_acyclic(self.out))
    }

    /// A Cargo manifest for the generated program
    pub fn cargo_toml(name: &str, runtime_path: &str) -> String {
        format!(
            "[package]\nname = \"{}-sim\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n\
             [dependencies]\niris-runtime = {{ path = \"{}\" }}\n\n\
             [profile.release]\nopt-level = 3\nlto = \"fat\"\ncodegen-units = 1\npanic = \"abort\"\n",
            name.to_lowercase(),
            runtime_path
        )
    }

    // ---------------------------------------------------------------- collect

    fn module(&self, name: &str) -> Option<&Module> {
        self.project.get_module(name)
    }


    /// Width of an expression, as far as it can be told without running it
    ///
    /// Only needed for a `let` written without a type, whose slot has to be
    /// sized before anything executes. Returns `None` when the shape is not
    /// one this can size, and the caller falls back to the declaration.
    fn infer_width(&self, expr: &Expression, prefix: &str) -> Option<usize> {
        match expr {
            Expression::Ident(name) => {
                let key = join(prefix, name);
                self.slot_of
                    .get(&key)
                    .or_else(|| self.slot_of.get(name))
                    .and_then(|slot| self.slots.get(*slot))
                    .and_then(|s| s.width)
            }
            Expression::Literal(lit) => lit.width(),
            Expression::BinOp { lhs, rhs, .. } => {
                let l = self.infer_width(lhs, prefix);
                let r = self.infer_width(rhs, prefix);
                match (l, r) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                }
            }
            Expression::UnaryOp { expr, .. } => self.infer_width(expr, prefix),
            Expression::MethodCall { method, args, .. } => {
                if matches!(method.as_str(), "sign_extend" | "extend") {
                    args.first().and_then(|a| match a {
                        Expression::Literal(lit) => Some(lit.to_u64() as usize),
                        _ => None,
                    })
                } else {
                    None
                }
            }
            _ => None,
        }
    }
    fn add_slot(&mut self, name: String, width: Option<usize>, signed: bool, hidden: bool) -> usize {
        if let Some(&slot) = self.slot_of.get(&name) {
            return slot;
        }
        let slot = self.slots.len();
        self.slot_of.insert(name.clone(), slot);
        self.slots.push(Slot {
            name,
            width,
            signed,
            hidden,
            float: None,
        });
        slot
    }

    /// Walk the design and give every signal, memory, clock and reset a slot.
    ///
    /// The order matters: it is the order the waveform lists signals in, and it
    /// is chosen to match the interpreter so the two produce the same VCD.
    fn collect(&mut self) -> Result<(), CodeGenError> {
        let top = self
            .module(&self.top)
            .cloned()
            .ok_or(CodeGenError::NoTopModule)?;

        self.collect_module(&top, "")?;
        self.collect_fsms(&top, "")?;
        self.collect_memories(&top, "")?;

        if self.is_test {
            self.collect_test_clocks_and_resets(&top);
        } else {
            self.collect_port_resets(&top);
        }

        if self.clocks.len() <= 1 {
            self.single_clock = match self.clocks.first() {
                Some(clock) => Some(clock.name.clone()),
                None => top.ports.iter().find_map(|p| match p.ty {
                    Type::Clock => Some(p.name.clone()),
                    _ => None,
                }),
            };
        }

        Ok(())
    }

    fn collect_module(&mut self, module: &Module, prefix: &str) -> Result<(), CodeGenError> {
        // Float ports, signals and memories are handled. A float *array signal*
        // (as opposed to a memory) is not yet: its elements are not tagged, so
        // it is refused rather than read as integers.
        for signal in &module.signals {
            if is_float(&signal.ty) && matches!(signal.ty, Type::Array { .. }) {
                return Err(CodeGenError::UnsupportedFeature(format!(
                    "floating-point array (signal '{}'); use iris-sim",
                    signal.name
                )));
            }
        }

        self.scopes.push(Scope {
            module: module.name.clone(),
            prefix: prefix.to_string(),
            inner: None,
        });

        for port in &module.ports {
            let width = port.ty.width().unwrap_or(1);
            let slot = self.add_slot(join(prefix, &port.name), Some(width), is_signed(&port.ty), false);
            self.slots[slot].float = float_fmt_of(&port.ty);
        }
        for signal in &module.signals {
            // A `let` written without a type takes its width from the
            // initialiser. Slots are allocated before anything runs, so the
            // width is inferred from the expression rather than evaluated.
            let width = if signal.has_explicit_type {
                signal.ty.width().unwrap_or(1)
            } else {
                signal
                    .init_value
                    .as_ref()
                    .and_then(|e| self.infer_width(e, prefix))
                    .unwrap_or_else(|| signal.ty.width().unwrap_or(1))
            };
            let slot = self.add_slot(
                join(prefix, &signal.name),
                Some(width),
                is_signed(&signal.ty),
                false,
            );
            self.slots[slot].float = float_fmt_of(&signal.ty);
        }
        // A block-local `let` with an explicit type gets that width and appears
        // in the waveform; an untyped one takes the width of its expression.
        for block in &module.logic_blocks {
            let statements = match block {
                LogicBlock::Comb(comb) => &comb.statements,
                LogicBlock::Sync(sync) => &sync.statements,
            };
            let mut locals = Vec::new();
            collect_typed_let_locals(statements, &mut locals);
            for (name, width) in locals {
                self.add_slot(join(prefix, &name), Some(width), false, false);
            }
        }

        for inst in &module.instances {
            let inst_prefix = join(prefix, &inst.name);
            let inst_module = self
                .module(&inst.module_name)
                .cloned()
                .ok_or_else(|| CodeGenError::UnknownSignal(inst.module_name.clone()))?;
            self.collect_module(&inst_module, &inst_prefix)?;
        }
        Ok(())
    }

    fn collect_fsms(&mut self, module: &Module, prefix: &str) -> Result<(), CodeGenError> {
        for fsm in &module.fsm_blocks {
            if fsm_initial_state(fsm).is_none() {
                continue;
            }
            let path = join(prefix, &fsm.name);
            for local in &fsm.locals {
                // A signal declared in an FSM body belongs to that FSM
                let width = local.ty.width().unwrap_or(1);
                self.add_slot(format!("{}.{}", path, local.name), Some(width), false, false);
            }
            self.add_slot(format!("{}_state", path), Some(state_width(fsm)), false, false);
        }
        for inst in &module.instances {
            let inst_prefix = join(prefix, &inst.name);
            if let Some(inst_module) = self.module(&inst.module_name).cloned() {
                self.collect_fsms(&inst_module, &inst_prefix)?;
            }
        }
        Ok(())
    }

    fn collect_memories(&mut self, module: &Module, prefix: &str) -> Result<(), CodeGenError> {
        for mem in &module.memories {
            let path = join(prefix, &mem.name);
            let element_width = mem.element_type.width().unwrap_or(8);
            let is_rom = mem.config.mem_type == Some(MemType::Rom);
            let init = self.memory_init(mem.init.as_ref(), mem.depth, element_width);

            let float = float_fmt_of(&mem.element_type);
            self.mem_of.insert(path.clone(), self.mems.len());
            self.mems.push(Mem {
                name: path.clone(),
                element_width,
                depth: mem.depth,
                is_rom,
                init,
                float,
            });

            let rdata = self.add_slot(format!("{}_rdata", path), Some(element_width), false, false);
            self.slots[rdata].float = float;
        }
        for inst in &module.instances {
            let inst_prefix = join(prefix, &inst.name);
            if let Some(inst_module) = self.module(&inst.module_name).cloned() {
                self.collect_memories(&inst_module, &inst_prefix)?;
            }
        }
        Ok(())
    }

    /// The words a memory starts with
    fn memory_init(&self, init: Option<&MemInit>, depth: usize, width: usize) -> Vec<u64> {
        let mut data = Vec::new();
        match init {
            Some(MemInit::Values(values)) => {
                for expr in values.iter().take(depth) {
                    data.push(self.const_value(expr).map(|(v, _)| v).unwrap_or(0));
                }
            }
            Some(MemInit::File(path)) => {
                if let Ok(content) = std::fs::read_to_string(path) {
                    for line in content.lines() {
                        if data.len() >= depth {
                            break;
                        }
                        let line = line.trim();
                        if line.is_empty() || line.starts_with("//") {
                            continue;
                        }
                        let value = u64::from_str_radix(line, 16)
                            .or_else(|_| u64::from_str_radix(line, 2))
                            .unwrap_or(0);
                        data.push(value);
                    }
                }
            }
            None => {}
        }
        let mask = if width >= 64 {
            u64::MAX
        } else {
            (1u64 << width) - 1
        };
        data.iter_mut().for_each(|v| *v &= mask);
        data.resize(depth, 0);
        data
    }

    /// Clocks and resets a test module declares for itself
    fn collect_test_clocks_and_resets(&mut self, top: &Module) {
        for signal in &top.signals {
            match &signal.ty {
                Type::Clock => {
                    let period = signal
                        .clock_config
                        .as_ref()
                        .and_then(|c| c.period.as_ref())
                        .map(|p| p.to_picoseconds())
                        .unwrap_or(10_000);
                    if self.clocks.is_empty() {
                        self.clock_period = period;
                    }
                    let slot = self.slot_of[&signal.name];
                    self.clocks.push(Clock {
                        name: signal.name.clone(),
                        slot,
                        period,
                    });
                }
                Type::Reset { active_low } => {
                    let mut is_active_low = *active_low;
                    let mut assert_reset = true;
                    if let Some(config) = &signal.reset_config {
                        is_active_low = config.active_low;
                        // A time takes priority over a cycle count
                        if let Some(duration) = &config.assert_time {
                            let cycles = (duration.to_picoseconds() + self.clock_period - 1)
                                / self.clock_period;
                            self.reset_duration = cycles;
                            assert_reset = cycles != 0;
                        } else if let Some(cycles) = config.assert_cycles {
                            self.reset_duration = cycles;
                            assert_reset = cycles != 0;
                        }
                    }
                    // The `_n` suffix is a fallback for a plain `reset`
                    let is_active_low = is_active_low || signal.name.ends_with("_n");
                    let slot = self.slot_of[&signal.name];
                    self.resets.push(Reset {
                        slot,
                        active_low: is_active_low,
                    });
                    self.reset_at_start = assert_reset;
                }
                _ => {}
            }
        }
    }

    /// Reset ports of a design that is driven from outside
    fn collect_port_resets(&mut self, top: &Module) {
        for port in &top.ports {
            if let Type::Reset { active_low } = port.ty {
                let slot = self.slot_of[&port.name];
                self.resets.push(Reset {
                    slot,
                    active_low: active_low || port.name.ends_with("_n"),
                });
            }
        }
    }

    // ------------------------------------------------------------- resolution

    /// Resolve a name written in a scope to a slot, as the interpreter does:
    /// the instance's own name first, then the name as written.
    fn resolve(&self, scope: &Scope, name: &str) -> Option<usize> {
        // An FSM's own signals shadow the module's
        if let Some(inner) = &scope.inner {
            if let Some(&slot) = self.slot_of.get(&format!("{}.{}", inner, name)) {
                return Some(slot);
            }
        }
        if !scope.prefix.is_empty() {
            if let Some(&slot) = self.slot_of.get(&join(&scope.prefix, name)) {
                return Some(slot);
            }
        }
        self.slot_of.get(name).copied()
    }

    /// Resolve a memory name written in a scope
    fn resolve_mem(&self, scope: &Scope, name: &str) -> Option<usize> {
        if let Some(&mem) = self.mem_of.get(&join(&scope.prefix, name)) {
            return Some(mem);
        }
        self.mem_of.get(name).copied()
    }

    /// The slot a loop variable uses.
    ///
    /// The interpreter stores a loop variable straight into its signal table
    /// without recording it, so it must stay out of the waveform.
    fn loop_var_slot(&mut self, scope: &Scope, name: &str) -> usize {
        let full = join(&scope.prefix, name);
        if let Some(&slot) = self.slot_of.get(&full) {
            return slot;
        }
        self.add_slot(full, None, false, true)
    }

    /// The slot an assignment in this scope writes to.
    ///
    /// Assignment targets are not resolved by search: `count = ...` inside an
    /// instance always means that instance's `count`. A target that matches no
    /// declaration becomes a slot of its own, taking the width of the first
    /// value stored in it, which is what the interpreter does. Such a slot is
    /// still traced, because the interpreter traces it.
    fn target_slot(&mut self, scope: &Scope, name: &str) -> usize {
        // An assignment inside an FSM writes that FSM's signal when it has one
        if let Some(inner) = &scope.inner {
            if let Some(&slot) = self.slot_of.get(&format!("{}.{}", inner, name)) {
                return slot;
            }
        }
        let full = join(&scope.prefix, name);
        if let Some(&slot) = self.slot_of.get(&full) {
            return slot;
        }
        self.add_slot(full, None, false, false)
    }

    /// Value of an expression that does not depend on the design's state
    fn const_value(&self, expr: &Expression) -> Option<(u64, usize)> {
        let empty = HashMap::new();
        let evaluator = Evaluator::new(&empty);
        let value = evaluator.eval(expr).ok()?;
        Some((value.to_u64()?, value.width()))
    }

    /// Code for a constant, or zero when it cannot be folded
    fn const_code(&self, expr: Option<&Expression>, width: usize) -> String {
        match expr.and_then(|e| self.const_value(e)) {
            Some((value, w)) => format!("SignalValue::from_u64({}, {})", value, w),
            None => format!("SignalValue::new({})", width),
        }
    }

    // --------------------------------------------------------------- emitting

    fn line(&mut self, text: &str) {
        for _ in 0..self.indent {
            self.out.push_str("    ");
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn open(&mut self, text: &str) {
        self.line(text);
        self.indent += 1;
    }

    fn close(&mut self, text: &str) {
        self.indent -= 1;
        self.line(text);
    }

    fn blank(&mut self) {
        self.out.push('\n');
    }

    fn emit_header(&mut self) {
        let top = self.top.clone();
        self.line("//! Simulation generated from IRIS source.");
        self.line(&format!("//! Top module: {}", top));
        self.blank();
        self.line("#![allow(unused_imports, unused_mut, unused_variables, unused_parens)]");
        self.blank();
        self.line("use iris_runtime::engine::{");
        self.line("    Arg, ClockState, Memory, ResetState, Runtime, Severity, SlotDef, Wait, format_display,");
        self.line("};");
        self.line("use iris_runtime::ops::{self, BinOp, UnaryOp};");
        self.line("use iris_runtime::SignalValue;");
        self.blank();
        self.line(&format!(
            "/// Period of the primary clock, in picoseconds"
        ));
        self.line(&format!("const CLOCK_PERIOD: u64 = {};", self.clock_period));
        self.blank();
    }

    /// The slot table. Emitted last, because emitting the body can still
    /// discover a name that only ever appears as an assignment target.
    fn emit_slot_table(&mut self) {
        self.line("let mut rt = Runtime::new(vec![");
        self.indent += 1;
        for i in 0..self.slots.len() {
            let slot = &self.slots[i];
            let line = match slot.width {
                Some(width) => {
                    let mut base = format!(
                        "SlotDef::new({:?}, {}, {})",
                        slot.name, width, slot.signed
                    );
                    if let Some(fmt) = slot.float {
                        base = format!("{}.float(iris_runtime::value::FloatFmt::{:?})", base, fmt);
                    }
                    if slot.hidden {
                        format!("{}.hidden(),", base)
                    } else {
                        format!("{},", base)
                    }
                }
                None if slot.hidden => format!("SlotDef::undeclared({:?}).hidden(),", slot.name),
                None => format!("SlotDef::undeclared({:?}),", slot.name),
            };
            self.line(&line);
        }
        self.indent -= 1;
        self.line("]);");
        self.blank();
    }

    /// Everything `build()` does after creating the slot table
    fn emit_build_body(&mut self) -> Result<(), CodeGenError> {

        if !self.mems.is_empty() {
            self.line("// Memories");
            for i in 0..self.mems.len() {
                let mem = &self.mems[i];
                let (width, depth, is_rom, name) =
                    (mem.element_width, mem.depth, mem.is_rom, mem.name.clone());
                let init: Vec<u64> = mem.init.clone();
                let float = mem.float;
                let ctor = match float {
                    Some(fmt) => format!(
                        "Memory::new({}, {}, {}).float({})",
                        width,
                        depth,
                        is_rom,
                        fmt_code(fmt)
                    ),
                    None => format!("Memory::new({}, {}, {})", width, depth, is_rom),
                };
                self.line(&format!("rt.mems.push({}); // {}", ctor, name));
                if init.iter().any(|v| *v != 0) {
                    for (addr, value) in init.iter().enumerate() {
                        if *value == 0 {
                            continue;
                        }
                        self.line(&format!(
                            "rt.mems[{}].data[{}] = SignalValue::from_u64({}, {});",
                            i, addr, value, width
                        ));
                    }
                }
            }
            self.blank();
        }

        if !self.clocks.is_empty() {
            self.line("// Clocks");
            for i in 0..self.clocks.len() {
                let clock = &self.clocks[i];
                let (slot, period, name) = (clock.slot, clock.period, clock.name.clone());
                self.line(&format!(
                    "rt.clocks.push(ClockState {{ slot: {}, period: {}, value: 0, next_edge: {} }}); // {}",
                    slot,
                    period,
                    period / 2,
                    name
                ));
            }
            self.blank();
        }

        if !self.resets.is_empty() {
            self.line("// Resets");
            for i in 0..self.resets.len() {
                let reset = &self.resets[i];
                let (slot, active_low) = (reset.slot, reset.active_low);
                self.line(&format!(
                    "rt.resets.push(ResetState {{ slot: {}, active_low: {} }});",
                    slot, active_low
                ));
            }
            self.blank();
        }

        // Declared initial values
        self.line("// Initial values");
        let scopes = self.scopes.clone();
        for scope in &scopes {
            let module = match self.module(&scope.module) {
                Some(m) => m.clone(),
                None => continue,
            };
            for signal in &module.signals {
                let Some(init) = signal.init_value.as_ref() else {
                    continue;
                };
                let slot = self.slot_of[&join(&scope.prefix, &signal.name)];
                // The slot already carries the width, inferred for an untyped
                // `let`. Using the declaration here would undo that.
                let width = self.slots[slot].width.unwrap_or(1);
                let value = match self.const_value(init) {
                    // A literal is 32 bits wide; the declaration wins
                    Some((v, _)) => format!("SignalValue::from_u64({}, {})", v, width),
                    None => format!("SignalValue::new({})", width),
                };
                let signed = is_signed(&signal.ty);
                self.line(&format!(
                    "rt.sig[{}] = {}.with_signed({});",
                    slot, value, signed
                ));
            }
        }
        self.blank();

        // FSMs start in the state named by `initial:`, or the first one
        let (states, moore) = self.fsm_initial_assignments()?;
        if !states.is_empty() {
            self.line("// FSM initial states");
            for line in states {
                self.line(&line);
            }
            self.blank();
        }

        // Everything above set values directly. Recording them here gives the
        // waveform its signals in declaration order, which is the order the
        // interpreter produces.
        self.line("rt.tracing = tracing;");
        self.line("rt.record_initial();");
        self.blank();

        if !self.cover_points.is_empty() {
            self.line("// Every coverage point is listed, whether or not it is ever reached");
            for i in 0..self.cover_points.len() {
                let name = self.cover_points[i].clone();
                self.line(&format!("rt.cover({}, {:?}, false);", i, name));
            }
            self.blank();
        }

        if !moore.is_empty() {
            self.line("// Outputs each FSM drives just by being in its initial state");
            for line in moore {
                self.line(&line);
            }
            self.blank();
        }

        if self.is_test && !self.resets.is_empty() {
            self.line("// A test drives its own reset");
            if self.reset_at_start {
                self.line("rt.assert_resets();");
            } else {
                self.line("rt.deassert_resets();");
            }
            self.blank();
        } else if !self.resets.is_empty() {
            self.line("// A design driven from outside starts with reset released");
            self.line("rt.deassert_resets();");
            self.blank();
        }

        Ok(())
    }

    /// Assignments that put every FSM in its initial state.
    ///
    /// The state itself is stored directly, before the waveform is opened; the
    /// Moore outputs are stored afterwards, because they are changes.
    fn fsm_initial_assignments(&mut self) -> Result<(Vec<String>, Vec<String>), CodeGenError> {
        let mut states = Vec::new();
        let mut moore = Vec::new();
        let scopes = self.scopes.clone();
        for scope in &scopes {
            let module = match self.module(&scope.module) {
                Some(m) => m.clone(),
                None => continue,
            };
            for fsm in &module.fsm_blocks {
                let Some((index, state)) = fsm_initial_state(fsm) else {
                    continue;
                };
                let path = join(&scope.prefix, &fsm.name);
                let slot = self.slot_of[&format!("{}_state", path)];
                states.push(format!(
                    "rt.sig[{}] = SignalValue::from_u64({}, {});",
                    slot,
                    index,
                    state_width(fsm)
                ));
                let fsm_scope = scope.within(&path);
                for (name, expr) in moore_outputs(fsm, &state) {
                    let slot = self.target_slot(&fsm_scope, &name);
                    let code = self.expr_for_slot(&expr, slot, &fsm_scope)?;
                    moore.push(format!("rt.set({}, {});", slot, code));
                }
            }
        }
        Ok((states, moore))
    }

    /// Restoring every register to its declared initial value
    fn emit_apply_reset(&mut self) -> Result<(), CodeGenError> {
        self.line("#[allow(dead_code)]");
        self.open("fn apply_reset(rt: &mut Runtime) {");
        let scopes = self.scopes.clone();
        for scope in &scopes {
            let module = match self.module(&scope.module) {
                Some(m) => m.clone(),
                None => continue,
            };
            for signal in &module.signals {
                if !(signal.is_var || signal.is_mutable) {
                    continue;
                }
                let Some(init) = signal.init_value.as_ref() else {
                    continue;
                };
                let slot = self.slot_of[&join(&scope.prefix, &signal.name)];
                let code = self.const_code(Some(init), signal.ty.width().unwrap_or(1));
                self.line(&format!("rt.set({}, {});", slot, code));
            }
        }
        self.close("}");
        self.blank();
        Ok(())
    }

    /// Driving instance inputs from the expressions written at instantiation,
    /// and instance outputs back onto whatever they are wired to
    fn emit_port_propagation(&mut self) -> Result<(), CodeGenError> {
        let mut paths: Vec<(String, String, String)> = Vec::new();
        self.collect_instances("", &self.top.clone(), &mut paths);

        // Shallow instances first, so a parent's own ports carry their new
        // value before the instances below read them
        let mut inputs = paths.clone();
        inputs.sort_by_key(|(path, _, _)| (path.matches('.').count(), path.clone()));

        self.open("fn propagate_ports(rt: &mut Runtime) -> bool {");
        self.line("let mut changed = false;");
        for (inst_path, module_name, parent_prefix) in inputs {
            let Some(module) = self.module(&module_name).cloned() else {
                continue;
            };
            let Some(parent) = self.instance_of(&inst_path) else {
                continue;
            };
            let scope = Scope {
                module: String::new(),
                prefix: parent_prefix,
                inner: None,
            };
            for (port_name, expr) in &parent.port_connections {
                let is_input = module
                    .ports
                    .iter()
                    .find(|p| &p.name == port_name)
                    .map(|p| matches!(p.direction, PortDirection::In))
                    .unwrap_or(false);
                if !is_input {
                    continue;
                }
                let Some(&slot) = self.slot_of.get(&format!("{}.{}", inst_path, port_name)) else {
                    continue;
                };
                let code = self.expr(expr, &scope)?;
                self.line(&format!("changed |= rt.set({}, {});", slot, code));
            }
        }
        self.line("changed");
        self.close("}");
        self.blank();

        // Deepest first, so a value crosses several levels in one pass
        let mut outputs = paths;
        outputs.sort_by_key(|(path, _, _)| {
            (
                std::cmp::Reverse(path.matches('.').count()),
                path.clone(),
            )
        });

        self.open("fn propagate_outputs(rt: &mut Runtime) -> bool {");
        self.line("let mut changed = false;");
        for (inst_path, module_name, parent_prefix) in outputs {
            let Some(module) = self.module(&module_name).cloned() else {
                continue;
            };
            let Some(parent) = self.instance_of(&inst_path) else {
                continue;
            };
            let scope = Scope {
                module: String::new(),
                prefix: parent_prefix,
                inner: None,
            };
            for (port_name, expr) in &parent.port_connections {
                let is_output = module
                    .ports
                    .iter()
                    .find(|p| &p.name == port_name)
                    .map(|p| matches!(p.direction, PortDirection::Out))
                    .unwrap_or(false);
                if !is_output {
                    continue;
                }
                // Only a plain name can receive a value
                let Expression::Ident(target) = expr else {
                    continue;
                };
                let Some(&source) = self.slot_of.get(&format!("{}.{}", inst_path, port_name))
                else {
                    continue;
                };
                let slot = self.target_slot(&scope, target);
                self.line(&format!(
                    "changed |= rt.set({}, rt.get({}).clone());",
                    slot, source
                ));
            }
        }
        self.line("changed");
        self.close("}");
        self.blank();
        Ok(())
    }

    /// Every instance in the design as (path, module name, parent path)
    fn collect_instances(
        &self,
        prefix: &str,
        module_name: &str,
        out: &mut Vec<(String, String, String)>,
    ) {
        let Some(module) = self.module(module_name) else {
            return;
        };
        for inst in module.instances.clone() {
            let path = join(prefix, &inst.name);
            out.push((path.clone(), inst.module_name.clone(), prefix.to_string()));
            self.collect_instances(&path, &inst.module_name, out);
        }
    }

    /// The instantiation that created a path
    fn instance_of(&self, inst_path: &str) -> Option<crate::parser::Instance> {
        let (parent, name) = match inst_path.rfind('.') {
            Some(pos) => (&inst_path[..pos], &inst_path[pos + 1..]),
            None => ("", inst_path),
        };
        let module_name = self.module_at(parent)?;
        let module = self.module(&module_name)?;
        module.instances.iter().find(|i| i.name == name).cloned()
    }

    /// Which module sits at a path
    fn module_at(&self, prefix: &str) -> Option<String> {
        self.scopes
            .iter()
            .find(|s| s.prefix == prefix)
            .map(|s| s.module.clone())
    }

    /// Combinational logic, run to a fixed point
    fn emit_comb(&mut self) -> Result<(), CodeGenError> {
        self.open("fn comb_pass(rt: &mut Runtime) -> bool {");
        self.line("let mut changed = false;");
        self.line("let mut updates: Vec<(usize, SignalValue)> = Vec::new();");
        self.line("let mut mem_writes: Vec<(usize, usize, SignalValue)> = Vec::new();");
        let scopes = self.scopes.clone();
        for scope in &scopes {
            let module = match self.module(&scope.module) {
                Some(m) => m.clone(),
                None => continue,
            };
            // A module-level `let` bound to an expression is a continuously
            // driven wire (spec 2.4.3), not a value frozen at elaboration.
            // The interpreter re-evaluates it with the combinational logic;
            // do the same here, or the two backends disagree.
            let assigned = assigned_names(&module);
            for signal in &module.signals {
                if signal.is_var || signal.is_mutable {
                    continue;
                }
                if assigned.contains(&signal.name) {
                    continue;
                }
                let Some(init) = signal.init_value.as_ref() else {
                    continue;
                };
                let slot = self.slot_of[&join(&scope.prefix, &signal.name)];
                let code = self.expr(init, scope)?;
                if signal.has_explicit_type {
                    // The declaration fixes the width
                    let width = signal.ty.width().unwrap_or(1);
                    self.line(&format!(
                        "changed |= rt.set({}, SignalValue::from_u64({}.to_u64().unwrap_or(0), {}));",
                        slot, code, width
                    ));
                } else {
                    // `let sum = a + b;` writes no type, so the expression's
                    // own width is the signal's width
                    self.line(&format!("changed |= rt.set({}, {});", slot, code));
                }
            }

            for block in &module.logic_blocks {
                let LogicBlock::Comb(comb) = block else {
                    continue;
                };
                // The interpreter applies each statement's updates before the
                // next statement runs, so a comb block sees its own writes
                for stmt in &comb.statements {
                    // Emit the statement aside so its shape can be inspected.
                    // A statement that stages exactly one update needs no
                    // staging at all: the clear and the drain around it exist
                    // to keep several updates from seeing each other.
                    let saved = std::mem::take(&mut self.out);
                    self.emit_statement(stmt, scope)?;
                    let body = std::mem::replace(&mut self.out, saved);

                    if let Some((slot, value)) = lone_update(&body) {
                        // The value is bound first because the expression may
                        // itself borrow the runtime — a `match` arm that writes
                        // a binding does. Staging kept those two borrows apart;
                        // a local does the same.
                        let tmp = self.temp();
                        self.line(&format!("let {} = {};", tmp, value));
                        self.line(&format!("changed |= rt.set({}, {});", slot, tmp));
                        continue;
                    }

                    self.line("updates.clear();");
                    self.line("mem_writes.clear();");
                    self.out.push_str(&body);
                    self.open("for (slot, value) in updates.drain(..) {");
                    self.line("changed |= rt.set(slot, value);");
                    self.close("}");
                    self.open("for (mem, addr, value) in mem_writes.drain(..) {");
                    self.line("changed |= rt.mem_write(mem, addr, value);");
                    self.close("}");
                }
            }
        }
        self.line("changed");
        self.close("}");
        self.blank();

        self.open("fn comb_settle(rt: &mut Runtime) {");
        self.open("for _ in 0..10 {");
        self.line("let mut changed = comb_pass(rt);");
        self.line("changed |= propagate_outputs(rt);");
        self.line("changed |= propagate_ports(rt);");
        self.open("if !changed {");
        self.line("break;");
        self.close("}");
        self.close("}");
        self.close("}");
        self.blank();
        Ok(())
    }

    /// Sequential logic, grouped the way the interpreter groups it
    fn emit_sync(&mut self) -> Result<(), CodeGenError> {
        // A scope's sync blocks are collected together and applied together,
        // so each (scope, clock) pair becomes one function
        let groups = self.sync_groups();

        for (index, (scope, clock_signal)) in groups.iter().enumerate() {
            self.open(&format!("fn sync_{}(rt: &mut Runtime) {{", index));
            self.line("let mut updates: Vec<(usize, SignalValue)> = Vec::new();");
            self.line("let mut mem_writes: Vec<(usize, usize, SignalValue)> = Vec::new();");
            self.line("let mut mem_clears: Vec<usize> = Vec::new();");

            let module = self.module(&scope.module).cloned().unwrap();
            for block in &module.logic_blocks {
                let LogicBlock::Sync(sync) = block else {
                    continue;
                };
                if &sync.clock.signal != clock_signal {
                    continue;
                }
                if let Some(reset) = &sync.reset {
                    let active_low = self.reset_active_low(&module, &reset.signal);
                    let Some(reset_slot) = self.resolve(scope, &reset.signal) else {
                        return Err(CodeGenError::UnknownSignal(reset.signal.clone()));
                    };
                    self.open(&format!(
                        "if rt.reset_asserted({}, {}) {{",
                        reset_slot, active_low
                    ));
                    // Restore the initial value of every register this block
                    // drives; another domain's registers are left alone
                    let mut driven = Vec::new();
                    collect_assigned_signals(&sync.statements, &mut driven);
                    for signal in &module.signals {
                        if !(signal.is_var || signal.is_mutable) {
                            continue;
                        }
                        if !driven.iter().any(|d| d == &signal.name) {
                            continue;
                        }
                        let Some(init) = signal.init_value.as_ref() else {
                            continue;
                        };
                        let slot = self.slot_of[&join(&scope.prefix, &signal.name)];
                        let code = self.const_code(Some(init), signal.ty.width().unwrap_or(1));
                        self.line(&format!("updates.push(({}, {}));", slot, code));
                    }
                    let mut written = Vec::new();
                    collect_written_memories(&sync.statements, &mut written);
                    for name in written {
                        if let Some(mem) = self.resolve_mem(scope, &name) {
                            self.line(&format!("mem_clears.push({});", mem));
                        }
                    }
                    self.close("} else {");
                    self.indent += 1;
                    for stmt in &sync.statements {
                        self.emit_statement(stmt, scope)?;
                    }
                    self.close("}");
                } else {
                    for stmt in &sync.statements {
                        self.emit_statement(stmt, scope)?;
                    }
                }
            }

            self.open("for (slot, value) in updates.drain(..) {");
            self.line("rt.store(slot, value);");
            self.close("}");
            self.open("for mem in mem_clears.drain(..) {");
            self.line("rt.mem_clear(mem);");
            self.close("}");
            self.open("for (mem, addr, value) in mem_writes.drain(..) {");
            self.line("rt.mem_write(mem, addr, value);");
            self.close("}");
            self.close("}");
            self.blank();
        }

        // Dispatch: which groups run on which clock
        if self.clocks.len() > 1 {
            for i in 0..self.clocks.len() {
                let name = self.clocks[i].name.clone();
                let driven = self.groups_driven_by(&name, &groups);
                self.open(&format!("fn sync_clock_{}(rt: &mut Runtime) {{", i));
                for index in driven {
                    self.line(&format!("sync_{}(rt);", index));
                }
                self.close("}");
                self.blank();
            }
        } else {
            self.open("fn sync_all(rt: &mut Runtime) {");
            for index in 0..groups.len() {
                self.line(&format!("sync_{}(rt);", index));
            }
            self.close("}");
            self.blank();
        }
        Ok(())
    }

    /// Every (scope, clock signal) pair that has sequential logic
    fn sync_groups(&self) -> Vec<(Scope, String)> {
        let mut groups = Vec::new();
        for scope in &self.scopes {
            let Some(module) = self.module(&scope.module) else {
                continue;
            };
            let mut seen: Vec<String> = Vec::new();
            for block in &module.logic_blocks {
                if let LogicBlock::Sync(sync) = block {
                    if !seen.contains(&sync.clock.signal) {
                        seen.push(sync.clock.signal.clone());
                    }
                }
            }
            for clock in seen {
                groups.push((scope.clone(), clock));
            }
        }
        groups
    }

    /// The sync groups a top-level clock reaches, in the order they must run
    fn groups_driven_by(&self, clock: &str, groups: &[(Scope, String)]) -> Vec<usize> {
        let mut reached: Vec<(String, String)> = Vec::new();
        self.trace_clock(&self.top.clone(), "", clock, &mut reached);

        let mut out = Vec::new();
        for (index, (scope, signal)) in groups.iter().enumerate() {
            let local = join(&scope.prefix, signal);
            if reached
                .iter()
                .any(|(prefix, name)| prefix == &scope.prefix && name == &local)
            {
                out.push(index);
            }
        }
        out
    }

    /// Follow a clock down through the instance tree.
    ///
    /// A clock only reaches an instance through a port actually wired to it;
    /// a port wired to the other domain's clock must stay quiet, otherwise both
    /// domains would advance on every edge.
    fn trace_clock(
        &self,
        module_name: &str,
        prefix: &str,
        clock_full_name: &str,
        out: &mut Vec<(String, String)>,
    ) {
        out.push((prefix.to_string(), clock_full_name.to_string()));
        let Some(module) = self.module(module_name) else {
            return;
        };
        for inst in module.instances.clone() {
            let inst_prefix = join(prefix, &inst.name);
            for (port, expr) in &inst.port_connections {
                if let Expression::Ident(id) = expr {
                    if join(prefix, id) == clock_full_name {
                        let child = join(&inst_prefix, port);
                        self.trace_clock(&inst.module_name, &inst_prefix, &child, out);
                    }
                }
            }
        }
    }

    /// Whether the reset a block names is asserted low
    fn reset_active_low(&self, module: &Module, name: &str) -> bool {
        for port in &module.ports {
            if port.name == name {
                if let Type::Reset { active_low: true } = port.ty {
                    return true;
                }
            }
        }
        for signal in &module.signals {
            if signal.name == name {
                if let Type::Reset { active_low: true } = signal.ty {
                    return true;
                }
            }
        }
        name.ends_with("_n")
            || self.resets.iter().any(|r| {
                r.active_low && self.slots[r.slot].name.rsplit('.').next() == Some(name)
            })
    }

    // -------------------------------------------------------------------- FSM

    fn emit_fsms(&mut self) -> Result<(), CodeGenError> {
        let mut units: Vec<(Scope, FsmBlock)> = Vec::new();
        let scopes = self.scopes.clone();
        for scope in &scopes {
            let Some(module) = self.module(&scope.module).cloned() else {
                continue;
            };
            for fsm in &module.fsm_blocks {
                if fsm_initial_state(fsm).is_none() {
                    continue;
                }
                units.push((scope.clone(), fsm.clone()));
            }
        }

        for (index, (scope, fsm)) in units.clone().into_iter().enumerate() {
            self.emit_fsm(index, &scope, &fsm)?;
        }

        // Putting every FSM back in its initial state
        self.open("fn fsm_reset(rt: &mut Runtime) {");
        for (scope, fsm) in units.clone() {
            let Some((state_index, state)) = fsm_initial_state(&fsm) else {
                continue;
            };
            let path = join(&scope.prefix, &fsm.name);
            let slot = self.slot_of[&format!("{}_state", path)];
            self.line(&format!(
                "rt.set({}, SignalValue::from_u64({}, {}));",
                slot,
                state_index,
                state_width(&fsm)
            ));
            let fsm_scope = scope.within(&path);
            for (name, expr) in moore_outputs(&fsm, &state) {
                let target = self.target_slot(&fsm_scope, &name);
                let code = self.expr_for_slot(&expr, target, &fsm_scope)?;
                self.line(&format!("rt.set({}, {});", target, code));
            }
        }
        self.close("}");
        self.blank();

        // Dispatch by clock, or all together when there is only one
        if self.clocks.len() > 1 {
            for i in 0..self.clocks.len() {
                let clock_name = self.clocks[i].name.clone();
                let mut reached: Vec<(String, String)> = Vec::new();
                self.trace_clock(&self.top.clone(), "", &clock_name, &mut reached);
                let mut calls = Vec::new();
                for (index, (scope, fsm)) in units.iter().enumerate() {
                    let local = join(&scope.prefix, &fsm.clock.signal);
                    if reached
                        .iter()
                        .any(|(prefix, name)| prefix == &scope.prefix && name == &local)
                    {
                        calls.push(index);
                    }
                }
                self.open(&format!("fn fsm_clock_{}(rt: &mut Runtime) {{", i));
                for index in calls {
                    self.line(&format!("fsm_{}(rt);", index));
                }
                self.close("}");
                self.blank();
            }
        } else {
            self.open("fn fsm_all(rt: &mut Runtime) {");
            for index in 0..units.len() {
                self.line(&format!("fsm_{}(rt);", index));
            }
            self.close("}");
            self.blank();
        }
        Ok(())
    }

    fn emit_fsm(&mut self, index: usize, scope: &Scope, fsm: &FsmBlock) -> Result<(), CodeGenError> {
        let path = join(&scope.prefix, &fsm.name);
        // Inside an FSM, its own signals shadow the module's
        let scope = &scope.within(&path);
        let state_slot = self.slot_of[&format!("{}_state", path)];
        let width = state_width(fsm);
        let module = self.module(&scope.module).cloned().unwrap();

        self.open(&format!("fn fsm_{}(rt: &mut Runtime) {{", index));

        // An FSM with its own reset holds its initial state while asserted
        if let Some(reset) = &fsm.reset {
            let active_low = self.reset_active_low(&module, &reset.signal);
            if let Some(slot) = self.resolve(scope, &reset.signal) {
                self.open(&format!(
                    "if rt.reset_asserted({}, {}) {{",
                    slot, active_low
                ));
                self.line("return;");
                self.close("}");
            }
        }

        self.line(&format!("let current = rt.get_u64({}) as usize;", state_slot));
        self.line("let mut next = current;");
        self.line("let mut found = false;");

        for transition in &fsm.transitions {
            let from = if transition.from_state == "_" {
                None
            } else {
                Some(state_index(fsm, &transition.from_state).ok_or_else(|| {
                    CodeGenError::UnsupportedFeature(format!(
                        "transition from undeclared state '{}'",
                        transition.from_state
                    ))
                })?)
            };
            let guard = match from {
                Some(i) => format!("if !found && current == {} {{", i),
                None => "if !found {".to_string(),
            };
            self.open(&guard);
            for when in &transition.when_clauses {
                let cond = self.expr_ref(&when.condition, scope)?;
                self.open(&format!("if !found && ops::truthy({}) {{", cond));
                self.emit_fsm_actions(&when.actions, scope, fsm)?;
                self.close("}");
            }
            self.close("}");
        }

        self.open("if next != current {");
        self.line(&format!(
            "rt.set({}, SignalValue::from_u64(next as u64, {}));",
            state_slot, width
        ));
        // Moore outputs of the state just entered
        self.open("match next {");
        for (i, state) in fsm.states.iter().enumerate() {
            let outputs = moore_outputs(fsm, &state.name);
            if outputs.is_empty() {
                continue;
            }
            self.open(&format!("{} => {{", i));
            for (name, expr) in outputs {
                let slot = self.target_slot(scope, &name);
                let code = self.expr_for_slot(&expr, slot, scope)?;
                self.line(&format!("rt.set({}, {});", slot, code));
            }
            self.close("}");
        }
        self.line("_ => {}");
        self.close("}");
        self.close("}");

        // Mealy outputs, for whatever state the FSM is now in
        if !fsm.outputs.is_empty() {
            self.line(&format!("let active = rt.get_u64({}) as usize;", state_slot));
            for output in fsm.outputs.clone() {
                self.open("match active {");
                for (state, expr) in &output.mappings {
                    let Some(i) = state_index(fsm, state) else {
                        continue;
                    };
                    let slot = self.target_slot(scope, &output.signal);
                    let code = self.expr_for_slot(expr, slot, scope)?;
                    self.open(&format!("{} => {{", i));
                    self.line(&format!("rt.set({}, {});", slot, code));
                    self.close("}");
                }
                self.line("_ => {}");
                self.close("}");
            }
        }

        self.close("}");
        self.blank();
        Ok(())
    }

    /// Emit the actions of a `when` clause, following any `if` inside it
    fn emit_fsm_actions(
        &mut self,
        actions: &[FsmAction],
        scope: &Scope,
        fsm: &FsmBlock,
    ) -> Result<(), CodeGenError> {
        for action in actions {
            match action {
                FsmAction::Goto(state) => {
                    let target = state_index(fsm, state).ok_or_else(|| {
                        CodeGenError::UnsupportedFeature(format!(
                            "goto undeclared state '{}'",
                            state
                        ))
                    })?;
                    self.line(&format!("next = {};", target));
                    self.line("found = true;");
                }
                FsmAction::Assign { target, value } => {
                    let slot = self.target_slot(scope, target);
                    let code = self.expr_for_slot(value, slot, scope)?;
                    self.line(&format!("rt.set({}, {});", slot, code));
                }
                FsmAction::If {
                    condition,
                    then_branch,
                    else_branch,
                } => {
                    let cond = self.expr_ref(condition, scope)?;
                    self.open(&format!("if ops::truthy({}) {{", cond));
                    self.emit_fsm_actions(then_branch, scope, fsm)?;
                    if let Some(branch) = else_branch {
                        self.close("} else {");
                        self.indent += 1;
                        self.emit_fsm_actions(branch, scope, fsm)?;
                    }
                    self.close("}");
                }
            }
        }
        Ok(())
    }

    // ------------------------------------------------------- initial and seq

    /// The sequential program, emitted as a resumable state machine.
    ///
    /// The same flattening the interpreter uses becomes a `match` on the
    /// program counter, so `await` suspends here exactly as it does there.
    fn emit_initial(&mut self) -> Result<(), CodeGenError> {
        let top = self
            .module(&self.top)
            .cloned()
            .ok_or(CodeGenError::NoTopModule)?;
        let scope = Scope {
            module: self.top.clone(),
            prefix: String::new(),
            inner: None,
        };

        let mut statements = Vec::new();
        for block in &top.initial_blocks {
            statements.extend(block.statements.iter().cloned());
        }
        for block in &top.seq_blocks {
            statements.extend(block.statements.iter().cloned());
        }
        let program = crate::sim::seq::compile(&statements);

        self.open("fn seq_advance(rt: &mut Runtime, edge: bool) {");
        if program.is_empty() {
            self.line("let _ = (rt, edge);");
            self.close("}");
            self.blank();
            return Ok(());
        }

        self.open("if !rt.seq_ready(edge) {");
        self.line("return;");
        self.close("}");
        self.line(&format!("let mut budget = {}usize;", crate::sim::seq::STEP_BUDGET));
        self.open("loop {");
        self.open(&format!("if rt.seq_pc >= {} {{", program.len()));
        self.line("rt.seq_wait = Wait::Done;");
        self.line("return;");
        self.close("}");
        self.open("if budget == 0 {");
        self.line(&format!(
            "eprintln!({:?});",
            format!(
                "Warning: a sequential block ran {} steps without waiting; suspending it",
                crate::sim::seq::STEP_BUDGET
            )
        ));
        self.line("rt.seq_wait = Wait::Done;");
        self.line("return;");
        self.close("}");
        self.line("budget -= 1;");
        self.line("let pc = rt.seq_pc;");
        self.line("rt.seq_pc += 1;");
        self.open("match pc {");
        for (index, instr) in program.iter().enumerate() {
            self.open(&format!("{} => {{", index));
            self.emit_seq_instr(instr, &scope)?;
            self.close("}");
        }
        self.line("_ => {}");
        self.close("}");
        self.open("if rt.finished {");
        self.line("rt.seq_wait = Wait::Done;");
        self.line("return;");
        self.close("}");
        self.close("}");
        self.close("}");
        self.blank();
        Ok(())
    }

    /// One instruction of the sequential program
    fn emit_seq_instr(
        &mut self,
        instr: &crate::sim::seq::SeqInstr,
        scope: &Scope,
    ) -> Result<(), CodeGenError> {
        use crate::sim::seq::SeqInstr;
        match instr {
            SeqInstr::Assign { target, value } => {
                self.emit_seq_statement(
                    &SeqStatement::Assign {
                        target: target.clone(),
                        value: value.clone(),
                    },
                    scope,
                )?;
            }
            SeqInstr::SignalWrite { path, value } => {
                let Some(&slot) = self.slot_of.get(path) else {
                    return Err(CodeGenError::UnknownSignal(path.clone()));
                };
                let code = self.expr(value, scope)?;
                self.line(&format!("rt.set({}, {});", slot, code));
            }
            SeqInstr::MemWrite {
                mem_name,
                addr,
                value,
            } => {
                self.emit_seq_statement(
                    &SeqStatement::MemWrite {
                        mem_name: mem_name.clone(),
                        addr: addr.clone(),
                        value: value.clone(),
                    },
                    scope,
                )?;
            }
            SeqInstr::Assert(assert) => self.emit_assert(assert, scope)?,
            SeqInstr::Cover(cover) => self.emit_cover(cover, scope)?,
            SeqInstr::SysCall(call) => self.emit_sys_call(call, scope)?,
            SeqInstr::Jump(target) => self.line(&format!("rt.seq_pc = {};", target)),
            SeqInstr::JumpIfFalse { condition, target } => {
                let cond = self.expr_ref(condition, scope)?;
                self.open(&format!("if !ops::truthy({}) {{", cond));
                self.line(&format!("rt.seq_pc = {};", target));
                self.close("}");
            }
            SeqInstr::Delay(duration) => {
                self.line(&format!("rt.seq_wait = Wait::Time(rt.time + {});", duration));
                self.line("return;");
            }
            SeqInstr::AwaitEdges(count) => {
                let code = self.expr(count, scope)?;
                self.line(&format!(
                    "rt.seq_wait = Wait::Edges({}.to_u64().unwrap_or(1).max(1));",
                    code
                ));
                self.line("return;");
            }
            SeqInstr::AwaitUntil { condition, timeout } => {
                let limit = match timeout {
                    Some(ps) => ps.to_string(),
                    None => "CLOCK_PERIOD * 1000".to_string(),
                };
                self.line(&format!(
                    "let deadline = *rt.seq_deadline.get_or_insert(rt.time + {});",
                    limit
                ));
                let cond = self.expr_ref(condition, scope)?;
                self.open(&format!(
                    "if ops::truthy({}) || rt.time >= deadline {{",
                    cond
                ));
                self.line("rt.seq_deadline = None;");
                self.close("} else {");
                self.indent += 1;
                self.line("// Re-run this instruction on the next edge");
                self.line("rt.seq_pc -= 1;");
                self.line("rt.seq_wait = Wait::Edges(1);");
                self.line("return;");
                self.close("}");
            }
        }
        Ok(())
    }

    fn emit_seq_statement(
        &mut self,
        stmt: &SeqStatement,
        scope: &Scope,
    ) -> Result<(), CodeGenError> {
        match stmt {
            SeqStatement::Assign { target, value } => {
                let slot = self.target_slot(scope, target);
                let code = self.expr_for_slot(value, slot, scope)?;
                self.line(&format!("rt.set({}, {});", slot, code));
            }
            SeqStatement::SignalWrite { path, value } => {
                let name = path.to_string();
                let Some(&slot) = self.slot_of.get(&name) else {
                    return Err(CodeGenError::UnknownSignal(name));
                };
                let code = self.expr_for_slot(value, slot, scope)?;
                self.line(&format!("rt.set({}, {});", slot, code));
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let cond = self.expr_ref(condition, scope)?;
                self.open(&format!("if ops::truthy({}) {{", cond));
                for s in then_branch {
                    self.emit_seq_statement(s, scope)?;
                }
                if let Some(else_stmts) = else_branch {
                    self.close("} else {");
                    self.indent += 1;
                    for s in else_stmts {
                        self.emit_seq_statement(s, scope)?;
                    }
                }
                self.close("}");
            }
            SeqStatement::Assert(assert) => self.emit_assert(assert, scope)?,
            SeqStatement::Cover(cover) => self.emit_cover(cover, scope)?,
            SeqStatement::SysCall(call) => self.emit_sys_call(call, scope)?,
            SeqStatement::Delay(duration) => {
                self.line(&format!("rt.time += {};", duration.to_picoseconds()));
            }
            // Loop control is resolved into jumps when the block is flattened
            SeqStatement::Break | SeqStatement::Continue => {}
            SeqStatement::Await(await_expr) => self.emit_await(await_expr, scope)?,
            SeqStatement::MemWrite {
                mem_name,
                addr,
                value,
            } => {
                let Some(mem) = self.resolve_mem(scope, mem_name) else {
                    return Err(CodeGenError::UnknownSignal(mem_name.clone()));
                };
                let addr_code = self.expr(addr, scope)?;
                let value_code = self.expr(value, scope)?;
                self.line(&format!(
                    "rt.mem_write({}, {}.to_u64().unwrap_or(0) as usize, {});",
                    mem, addr_code, value_code
                ));
            }
            SeqStatement::For { var, range, body } => {
                let slot = self.loop_var_slot(scope, var);
                let start = self.expr(&range.start, scope)?;
                let end = self.expr(&range.end, scope)?;
                let plus = if range.inclusive { " + 1" } else { "" };
                self.line(&format!(
                    "let __start = {}.to_u64().unwrap_or(0) as i64;",
                    start
                ));
                self.line(&format!(
                    "let __end = {}.to_u64().unwrap_or(0) as i64{};",
                    end, plus
                ));
                self.open("for __i in __start..__end {");
                // A loop variable is not a signal change, so it is not recorded
                self.line(&format!(
                    "rt.set_silent({}, SignalValue::from_u64(__i as u64, 32));",
                    slot
                ));
                for s in body {
                    self.emit_seq_statement(s, scope)?;
                }
                self.close("}");
            }
            SeqStatement::While { condition, body } => {
                self.line("let mut __iterations = 0usize;");
                self.open("loop {");
                self.line("if __iterations >= 100000 { break; }");
                self.line("__iterations += 1;");
                let cond = self.expr_ref(condition, scope)?;
                self.line(&format!("if !ops::truthy({}) {{ break; }}", cond));
                for s in body {
                    self.emit_seq_statement(s, scope)?;
                }
                self.close("}");
            }
        }
        Ok(())
    }

    fn emit_await(&mut self, await_expr: &AwaitExpr, scope: &Scope) -> Result<(), CodeGenError> {
        match await_expr {
            AwaitExpr::ClockEdge { .. } => {
                self.line("rt.time += CLOCK_PERIOD;");
            }
            AwaitExpr::ClockCycles { count, .. } => {
                let code = self.expr(count, scope)?;
                self.line(&format!(
                    "rt.time += CLOCK_PERIOD * {}.to_u64().unwrap_or(1);",
                    code
                ));
            }
            AwaitExpr::Until { condition, timeout } => {
                let limit = timeout
                    .as_ref()
                    .map(|d| d.to_picoseconds().to_string())
                    .unwrap_or_else(|| "CLOCK_PERIOD * 1000".to_string());
                self.line(&format!("let __limit = {};", limit));
                self.line("let __start = rt.time;");
                self.open("while rt.time - __start < __limit {");
                let cond = self.expr_ref(condition, scope)?;
                self.line(&format!("if ops::truthy({}) {{ break; }}", cond));
                self.line("rt.time += CLOCK_PERIOD;");
                self.close("}");
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------- statements

    fn emit_statement(&mut self, stmt: &Statement, scope: &Scope) -> Result<(), CodeGenError> {
        match stmt {
            Statement::Break => self.line("break;"),
            Statement::Continue => self.line("continue;"),
            Statement::Assign { target, value } => {
                let slot = self.target_slot(scope, target);
                // Unsigned arithmetic over known-width signals is computed in a
                // machine word: the same truncations the general path applies,
                // without building a value for every intermediate result.
                let code = if self.word_safe(value, scope) {
                    let width = self.word_width(value, scope).unwrap_or(0);
                    let word = self.word_expr(value, scope)?;
                    format!("SignalValue::from_u64({}, {})", word, width)
                } else {
                    self.expr_for_slot(value, slot, scope)?
                };
                self.line(&format!("updates.push(({}, {}));", slot, code));
            }
            Statement::MemWrite {
                mem_name,
                addr,
                value,
            } => match self.resolve_mem(scope, mem_name) {
                Some(mem) => {
                    let addr_code = self.expr(addr, scope)?;
                    let value_code = self.expr(value, scope)?;
                    self.line(&format!(
                        "mem_writes.push(({}, {}.to_u64().unwrap_or(0) as usize, {}));",
                        mem, addr_code, value_code
                    ));
                }
                None => {
                    // Not a memory: `signal[i] = v` sets one bit
                    let bit = Statement::SliceWrite {
                        target: mem_name.clone(),
                        low: addr.clone(),
                        width: Expression::Literal(Literal::Decimal {
                            width: None,
                            value: 1,
                        }),
                        value: value.clone(),
                    };
                    self.emit_statement(&bit, scope)?;
                }
            },
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let cond = self.expr_ref(condition, scope)?;
                self.open(&format!("if ops::truthy({}) {{", cond));
                for s in then_branch {
                    self.emit_statement(s, scope)?;
                }
                if let Some(else_stmts) = else_branch {
                    self.close("} else {");
                    self.indent += 1;
                    for s in else_stmts {
                        self.emit_statement(s, scope)?;
                    }
                }
                self.close("}");
            }
            Statement::Match { expr, arms } => {
                let value = self.expr(expr, scope)?;
                let name = self.temp();
                self.line(&format!("let {} = {};", name, value));
                let mut first = true;
                for arm in arms {
                    let test = self.pattern_test(&arm.pattern, &name, scope)?;
                    let head = if first {
                        format!("if {} {{", test)
                    } else {
                        format!("}} else if {} {{", test)
                    };
                    if first {
                        self.open(&head);
                    } else {
                        self.close(&head);
                        self.indent += 1;
                    }
                    first = false;
                    self.emit_payload_binding(&arm.pattern, &name, scope)?;
                    for s in &arm.body {
                        self.emit_statement(s, scope)?;
                    }
                }
                if !first {
                    self.close("}");
                }
            }
            Statement::For { var, range, body } => {
                let slot = self.loop_var_slot(scope, var);
                let start = self.expr(&range.start, scope)?;
                let end = self.expr(&range.end, scope)?;
                let plus = if range.inclusive { " + 1" } else { "" };
                self.open("{");
                self.line(&format!(
                    "let __start = {}.to_u64().unwrap_or(0) as i64;",
                    start
                ));
                self.line(&format!(
                    "let __end = {}.to_u64().unwrap_or(0) as i64{};",
                    end, plus
                ));
                self.open("for __i in __start..__end {");
                // A loop variable is not a signal change, so it is not recorded
                self.line(&format!(
                    "rt.set_silent({}, SignalValue::from_u64(__i as u64, 32));",
                    slot
                ));
                for s in body {
                    self.emit_statement(s, scope)?;
                }
                self.close("}");
                self.close("}");
            }
            Statement::While { condition, body } => {
                self.open("{");
                self.line("let mut __iterations = 0usize;");
                self.open("loop {");
                self.line("if __iterations >= 1000 { break; }");
                // Counted before the body, so `continue` cannot skip it
                self.line("__iterations += 1;");
                let cond = self.expr_ref(condition, scope)?;
                self.line(&format!("if !ops::truthy({}) {{ break; }}", cond));
                for s in body {
                    self.emit_statement(s, scope)?;
                }
                self.close("}");
                self.close("}");
            }
            Statement::LetLocal { name, ty, value } => {
                let Some(expr) = value else {
                    return Ok(());
                };
                let slot = self.target_slot(scope, name);
                let code = self.expr(expr, scope)?;
                let code = match ty.as_ref().and_then(|t| t.width()) {
                    Some(width) => format!(
                        "SignalValue::from_u64({}.to_u64().unwrap_or(0), {})",
                        code, width
                    ),
                    None => code,
                };
                // A block-local is a wire: it is visible to the statements that
                // follow it, so it is stored at once rather than deferred
                self.line(&format!("rt.set({}, {});", slot, code));
            }
            Statement::Assert(assert) => self.emit_assert(assert, scope)?,
            Statement::Cover(cover) => self.emit_cover(cover, scope)?,
            Statement::SysCall(call) => self.emit_sys_call(call, scope)?,
            Statement::SliceWrite {
                target,
                low,
                width,
                value,
            } => {
                let slot = self.target_slot(scope, target);
                let low_code = self.expr(low, scope)?;
                let width_code = self.expr(width, scope)?;
                let value_code = self.expr(value, scope)?;
                self.open("{");
                self.line(&format!(
                    "let __low = {}.to_u64().unwrap_or(0) as usize;",
                    low_code
                ));
                self.line(&format!(
                    "let __width = {}.to_u64().unwrap_or(0) as usize;",
                    width_code
                ));
                self.line(&format!(
                    "let __field = {}.to_u64().unwrap_or(0);",
                    value_code
                ));
                self.open("if __width != 0 {");
                // Start from an update already pending for this signal, so that
                // several field writes in one block accumulate
                self.line(&format!(
                    "let __base = updates.iter().rev().find(|(s, _)| *s == {}).map(|(_, v)| v.clone()).unwrap_or_else(|| rt.get({}).clone());",
                    slot, slot
                ));
                self.line("let __merged = ops::merge_field(&__base, __low, __width, __field);");
                self.open(&format!(
                    "match updates.iter_mut().rev().find(|(s, _)| *s == {}) {{",
                    slot
                ));
                self.line("Some(entry) => entry.1 = __merged,");
                self.line(&format!("None => updates.push(({}, __merged)),", slot));
                self.close("}");
                self.close("}");
                self.close("}");
            }
        }
        Ok(())
    }

    /// A coverage point: count the times its condition held
    fn emit_cover(
        &mut self,
        cover: &crate::parser::CoverStmt,
        scope: &Scope,
    ) -> Result<(), CodeGenError> {
        let name = crate::sim::cover_name(cover);
        let index = match self.cover_points.iter().position(|n| n == &name) {
            Some(index) => index,
            None => {
                self.cover_points.push(name.clone());
                self.cover_points.len() - 1
            }
        };
        let cond = self.expr_ref(&cover.condition, scope)?;
        self.line(&format!(
            "rt.cover({}, {:?}, ops::truthy({}));",
            index, name, cond
        ));
        Ok(())
    }

    fn emit_assert(&mut self, assert: &AssertStmt, scope: &Scope) -> Result<(), CodeGenError> {
        let cond = self.expr_ref(&assert.condition, scope)?;
        let text = format!("{}", assert.condition);
        let severity = match assert.severity {
            AssertSeverity::Warning => "Severity::Warning",
            AssertSeverity::Fatal => "Severity::Fatal",
            _ => "Severity::Error",
        };
        let (line, col) = assert
            .span
            .as_ref()
            .map(|s| (s.start_line, s.start_col))
            .unwrap_or((0, 0));
        let message = match &assert.message {
            Some(m) => format!("Some({:?})", m),
            None => "None".to_string(),
        };

        self.open(&format!("if !ops::truthy({}) {{", cond));
        // A comparison reports both sides, as the interpreter does
        let operands = match &assert.condition {
            Expression::BinOp { lhs, rhs, .. } => {
                let l = self.expr(lhs, scope)?;
                let r = self.expr(rhs, scope)?;
                self.line(&format!("let __lhs = {}.to_u64();", l));
                self.line(&format!("let __rhs = {}.to_u64();", r));
                self.line("let __operands = match (__lhs, __rhs) { (Some(l), Some(r)) => Some((format!(\"0x{:x} ({})\", l, l), format!(\"0x{:x} ({})\", r, r))), _ => None };");
                "__operands"
            }
            _ => "None",
        };
        self.line(&format!(
            "rt.fail({:?}, {}, {}, {}, {}, {});",
            text, message, severity, line, col, operands
        ));
        self.close("}");
        Ok(())
    }

    fn emit_sys_call(&mut self, call: &Expression, scope: &Scope) -> Result<(), CodeGenError> {
        let Expression::SysFunc { name, args } = call else {
            return Ok(());
        };
        match name.as_str() {
            "display" => {
                let text = self.display_code(args, scope)?;
                self.line(&format!("println!(\"{{}}\", {});", text));
            }
            "finish" => self.line("rt.finished = true;"),
            "randomize" => self.emit_randomize(scope)?,
            // The value-returning functions have no effect as statements
            _ => {}
        }
        Ok(())
    }

    /// Draw new values for the random variables, honouring the constraints
    fn emit_randomize(&mut self, scope: &Scope) -> Result<(), CodeGenError> {
        let module = self
            .module(&self.top)
            .cloned()
            .ok_or(CodeGenError::NoTopModule)?;

        let variables: Vec<(usize, usize)> = module
            .signals
            .iter()
            .filter(|s| s.is_rand)
            .filter_map(|s| {
                let slot = self.slot_of.get(&join(&scope.prefix, &s.name)).copied()?;
                Some((slot, s.ty.width().unwrap_or(1)))
            })
            .collect();
        if variables.is_empty() {
            return Ok(());
        }

        let conditions: Vec<Expression> = module
            .constraints
            .iter()
            .flat_map(|c| c.conditions.iter().cloned())
            .collect();

        self.open("{");
        self.line("let mut __satisfied = false;");
        self.open("for _ in 0..iris_runtime::random::MAX_ATTEMPTS {");
        for (slot, width) in &variables {
            self.line(&format!(
                "let __v = rt.rng.next_bits({});\n            rt.set({}, SignalValue::from_u64(__v, {}));",
                width, slot, width
            ));
        }
        if conditions.is_empty() {
            self.line("__satisfied = true;");
        } else {
            let mut tests = Vec::new();
            for condition in &conditions {
                tests.push(format!("ops::truthy({})", self.expr_ref(condition, scope)?));
            }
            self.line(&format!("__satisfied = {};", tests.join(" && ")));
        }
        self.open("if __satisfied {");
        self.line("break;");
        self.close("}");
        self.close("}");
        self.open("if !__satisfied {");
        self.line("eprintln!(\"Warning: $randomize could not satisfy the constraints in {} attempts\", iris_runtime::random::MAX_ATTEMPTS);");
        self.close("}");
        self.close("}");
        Ok(())
    }

    /// Code that renders a `$display` argument list
    fn display_code(&mut self, args: &[SysFuncArg], scope: &Scope) -> Result<String, CodeGenError> {
        let mut rest = args.iter();
        let format = match rest.next() {
            Some(SysFuncArg::Str(text)) => text.clone(),
            Some(SysFuncArg::Expr(e)) => {
                let code = self.expr(e, scope)?;
                return Ok(format!("{}.to_string()", code));
            }
            _ => return Ok("String::new()".to_string()),
        };

        let mut values = Vec::new();
        let mut refs = Vec::new();
        for arg in rest {
            match arg {
                SysFuncArg::Expr(e) => {
                    let name = self.temp();
                    let code = self.expr(e, scope)?;
                    values.push(format!("let {} = {};", name, code));
                    refs.push(format!("Arg::Value(&{})", name));
                }
                SysFuncArg::Str(text) => refs.push(format!("Arg::Text({:?})", text)),
                SysFuncArg::Type(_) => refs.push("Arg::Text(\"\")".to_string()),
            }
        }

        let mut code = String::from("{ ");
        for value in values {
            code.push_str(&value);
            code.push(' ');
        }
        code.push_str(&format!(
            "format_display({:?}, &[{}]) }}",
            format,
            refs.join(", ")
        ));
        Ok(code)
    }

    // ------------------------------------------------------------ expressions

    fn temp(&mut self) -> String {
        self.tmp += 1;
        format!("__t{}", self.tmp)
    }

    /// Static width of an expression, by the rules `ops::binop_width` applies
    /// at run time.
    ///
    /// `None` when the width is not known here, which disqualifies the
    /// expression from the machine-word path.
    fn word_width(&self, expr: &Expression, scope: &Scope) -> Option<usize> {
        match expr {
            Expression::Literal(lit) => Some(lit.width().unwrap_or(32)),
            Expression::Ident(name) => {
                let slot = self.resolve(scope, name)?;
                self.slots.get(slot).and_then(|s| s.width)
            }
            Expression::BinOp { op, lhs, rhs } => {
                let op = crate::sim::eval::runtime_binop(*op);
                if op.is_relational() {
                    return Some(1);
                }
                let l = self.word_width(lhs, scope)?;
                let r = self.word_width(rhs, scope)?;
                let lu = crate::sim::eval::is_unsized_literal(lhs);
                let ru = crate::sim::eval::is_unsized_literal(rhs);
                Some(match (lu, ru) {
                    (false, true) => l,
                    (true, false) => r,
                    _ => l.max(r),
                })
            }
            Expression::UnaryOp { expr, .. } => self.word_width(expr, scope),
            _ => None,
        }
    }

    /// May this expression be computed in a machine word?
    ///
    /// Says no unless every part of it is understood. A wrong yes produces a
    /// simulation that is fast and wrong; a wrong no only costs speed.
    ///
    /// Signed operands are excluded rather than handled: `ops::signed_binop`
    /// treats comparison, division, remainder and arithmetic shift differently,
    /// and reproducing that here would be a second place to get it wrong.
    fn word_safe(&self, expr: &Expression, scope: &Scope) -> bool {
        if self.no_word_path {
            return false;
        }
        let Some(width) = self.word_width(expr, scope) else {
            return false;
        };
        if width == 0 || width > 64 {
            return false;
        }
        match expr {
            // A real literal is a floating-point value, not a machine word.
            Expression::Literal(Literal::Real { .. }) => false,
            Expression::Literal(lit) => lit.width().unwrap_or(32) <= 64,
            Expression::Ident(name) => match self.resolve(scope, name) {
                Some(slot) => match self.slots.get(slot) {
                    // A floating-point slot's bits are not an integer word.
                    Some(s) => {
                        !s.signed
                            && s.float.is_none()
                            && s.width.map(|w| w <= 64).unwrap_or(false)
                    }
                    None => false,
                },
                None => false,
            },
            Expression::BinOp { op, lhs, rhs } => {
                use crate::parser::ast::BinOp as B;
                let understood = matches!(
                    op,
                    B::Add | B::Sub | B::Mul | B::Div | B::Mod
                        | B::And | B::Or | B::Xor
                        | B::Shl | B::Shr
                        | B::Eq | B::Ne | B::Lt | B::Le | B::Gt | B::Ge
                );
                understood && self.word_safe(lhs, scope) && self.word_safe(rhs, scope)
            }
            Expression::UnaryOp { op, expr } => {
                use crate::parser::ast::UnaryOp as U;
                // `Not` is bitwise (~) and `LogNot` is logical (!).
                // `Neg` is left out: negation is a signed operation.
                matches!(op, U::Not | U::LogNot) && self.word_safe(expr, scope)
            }
            _ => false,
        }
    }

    /// Code for an expression as a `u64`, truncated at every step to the width
    /// the general path would have given it.
    fn word_expr(&mut self, expr: &Expression, scope: &Scope) -> Result<String, CodeGenError> {
        let width = self
            .word_width(expr, scope)
            .ok_or_else(|| CodeGenError::UnknownSignal("width".to_string()))?;
        let m = word_mask(width);

        match expr {
            Expression::Literal(lit) => Ok(format!("{}u64", lit.to_u64() & m)),
            Expression::Ident(name) => match self.resolve(scope, name) {
                Some(slot) => Ok(format!("rt.get_u64({})", slot)),
                None => Err(CodeGenError::UnknownSignal(join(&scope.prefix, name))),
            },
            Expression::BinOp { op, lhs, rhs } => {
                use crate::parser::ast::BinOp as B;
                let l = self.word_expr(lhs, scope)?;
                let r = self.word_expr(rhs, scope)?;
                let body = match op {
                    B::Add => format!("({}).wrapping_add({})", l, r),
                    B::Sub => format!("({}).wrapping_sub({})", l, r),
                    B::Mul => format!("({}).wrapping_mul({})", l, r),
                    // Division by zero yields zero, as `ops::binop` does
                    B::Div => format!("{{ let d = {}; if d != 0 {{ ({}) / d }} else {{ 0 }} }}", r, l),
                    B::Mod => format!("{{ let d = {}; if d != 0 {{ ({}) % d }} else {{ 0 }} }}", r, l),
                    B::And => format!("({}) & ({})", l, r),
                    B::Or => format!("({}) | ({})", l, r),
                    B::Xor => format!("({}) ^ ({})", l, r),
                    // A shift wider than the word masks its count, which is what
                    // `<<` and `>>` compile to in a release build
                    B::Shl => format!("({}).wrapping_shl(({}) as u32)", l, r),
                    B::Shr => format!("({}).wrapping_shr(({}) as u32)", l, r),
                    B::Eq => format!("((({}) == ({})) as u64)", l, r),
                    B::Ne => format!("((({}) != ({})) as u64)", l, r),
                    B::Lt => format!("((({}) < ({})) as u64)", l, r),
                    B::Le => format!("((({}) <= ({})) as u64)", l, r),
                    B::Gt => format!("((({}) > ({})) as u64)", l, r),
                    B::Ge => format!("((({}) >= ({})) as u64)", l, r),
                    _ => return Err(CodeGenError::UnknownSignal("operator".to_string())),
                };
                Ok(mask_to(&body, width))
            }
            Expression::UnaryOp { op, expr } => {
                use crate::parser::ast::UnaryOp as U;
                let value = self.word_expr(expr, scope)?;
                let body = match op {
                    U::Not => format!("!({})", value),
                    U::LogNot => format!("((({}) == 0) as u64)", value),
                    _ => return Err(CodeGenError::UnknownSignal("operator".to_string())),
                };
                Ok(mask_to(&body, width))
            }
            _ => Err(CodeGenError::UnknownSignal("expression".to_string())),
        }
    }

    /// The floating-point format an expression evaluates to, when it has one.
    ///
    /// A signal carries its slot's format; an arithmetic operation carries the
    /// format of a floating-point operand. A comparison yields one bit, not a
    /// float, so it has no format.
    fn expr_float_fmt(&self, expr: &Expression, scope: &Scope) -> Option<FloatFmt> {
        match expr {
            Expression::Ident(name) => {
                self.resolve(scope, name).and_then(|slot| self.slots[slot].float)
            }
            Expression::BinOp { op, lhs, rhs } if is_arith_op(*op) => self
                .expr_float_fmt(lhs, scope)
                .or_else(|| self.expr_float_fmt(rhs, scope)),
            _ => None,
        }
    }

    /// Code for a floating-point operand, as a `&SignalValue`. A real literal
    /// is encoded to the given format here, where the format is known.
    fn float_operand(
        &mut self,
        expr: &Expression,
        fmt: FloatFmt,
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        if let Some(text) = crate::sim::eval::real_text(expr) {
            return Ok(match fmt {
                FloatFmt::F32 => format!("&SignalValue::from_f32({}f32)", text),
                FloatFmt::F64 => format!("&SignalValue::from_f64({}f64)", text),
            });
        }
        self.expr_ref(expr, scope)
    }

    /// Code for a value assigned to `slot`, honouring the slot's floating-point
    /// format so a bare real literal (`y = 1.5`) or a real-literal-only
    /// expression (`y = 1.5 + 2.25`) takes the target's format, matching the
    /// interpreter. An integer slot falls straight through to `expr`.
    fn expr_for_slot(
        &mut self,
        value: &Expression,
        slot: usize,
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        if let Some(fmt) = self.slots.get(slot).and_then(|s| s.float) {
            return self.float_ctx_code(value, fmt, scope);
        }
        self.expr(value, scope)
    }

    /// Code for a value in a known floating-point format, folding a real
    /// literal or a real-literal-only operation into that format.
    fn float_ctx_code(
        &mut self,
        value: &Expression,
        fmt: FloatFmt,
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        if let Some(text) = crate::sim::eval::real_text(value) {
            return Ok(match fmt {
                FloatFmt::F32 => format!("SignalValue::from_f32({}f32)", text),
                FloatFmt::F64 => format!("SignalValue::from_f64({}f64)", text),
            });
        }
        if let Expression::BinOp { op, lhs, rhs } = value {
            if crate::sim::eval::real_text(lhs).is_some()
                || crate::sim::eval::real_text(rhs).is_some()
            {
                let l = self.float_operand(lhs, fmt, scope)?;
                let r = self.float_operand(rhs, fmt, scope)?;
                return Ok(format!(
                    "ops::float_binop(BinOp::{:?}, {}, {}, {})",
                    crate::sim::eval::runtime_binop(*op),
                    l,
                    r,
                    fmt_code(fmt),
                ));
            }
        }
        self.expr(value, scope)
    }

    /// Code for an expression where a `&SignalValue` is wanted.
    ///
    /// Reading a signal already yields a reference, so `&rt.get(n).clone()`
    /// builds a copy only to borrow it and drop it again. This returns the
    /// borrow itself where it can, and falls back to borrowing a temporary.
    fn expr_ref(&mut self, expr: &Expression, scope: &Scope) -> Result<String, CodeGenError> {
        let code = self.expr(expr, scope)?;
        match code.strip_suffix(".clone()") {
            Some(borrowed) if borrowed.starts_with("rt.get(") => Ok(borrowed.to_string()),
            _ => Ok(format!("&{}", code)),
        }
    }

    /// Code for an expression, yielding a `SignalValue`
    fn expr(&mut self, expr: &Expression, scope: &Scope) -> Result<String, CodeGenError> {
        match expr {
            // A real literal has no format on its own; it is encoded where the
            // format is known (in a floating-point operation, via
            // `float_operand`). Reaching here means it has no floating-point
            // context, which the compiled backend does not fold.
            Expression::Literal(Literal::Real { .. }) => Err(CodeGenError::UnsupportedFeature(
                "a real literal needs a floating-point operand in the compiled backend; \
                 use iris-sim"
                    .to_string(),
            )),
            Expression::Literal(lit) => {
                let width = lit.width().unwrap_or(32);
                Ok(format!(
                    "SignalValue::from_u64({}, {})",
                    lit.to_u64(),
                    width
                ))
            }
            Expression::Ident(name) => match self.resolve(scope, name) {
                Some(slot) => Ok(format!("rt.get({}).clone()", slot)),
                None => Err(CodeGenError::UnknownSignal(join(&scope.prefix, name))),
            },
            Expression::BinOp { op, lhs, rhs } => {
                // A floating-point operand (a signal, or a real literal beside
                // one) makes this a floating-point operation.
                let fmt = self
                    .expr_float_fmt(lhs, scope)
                    .or_else(|| self.expr_float_fmt(rhs, scope));
                if let (Some(fmt), true) = (fmt, is_float_op(*op)) {
                    let l = self.float_operand(lhs, fmt, scope)?;
                    let r = self.float_operand(rhs, fmt, scope)?;
                    return Ok(format!(
                        "ops::float_binop(BinOp::{:?}, {}, {}, {})",
                        crate::sim::eval::runtime_binop(*op),
                        l,
                        r,
                        fmt_code(fmt),
                    ));
                }
                let l = self.expr_ref(lhs, scope)?;
                let r = self.expr_ref(rhs, scope)?;
                Ok(format!(
                    "ops::binop(BinOp::{:?}, {}, {}, {}, {})",
                    crate::sim::eval::runtime_binop(*op),
                    l,
                    r,
                    crate::sim::eval::is_unsized_literal(lhs),
                    crate::sim::eval::is_unsized_literal(rhs)
                ))
            }
            Expression::UnaryOp { op, expr } => {
                let value = self.expr_ref(expr, scope)?;
                Ok(format!(
                    "ops::unop(UnaryOp::{:?}, {})",
                    crate::sim::eval::runtime_unop(*op),
                    value
                ))
            }
            Expression::Index { base, index } => {
                let Expression::Ident(name) = base.as_ref() else {
                    // Not a plain name: evaluate the base as an expression, so
                    // that `u.y[3]` works on an instance output.
                    let base_code = self.expr(base, scope)?;
                    let idx = self.expr(index, scope)?;
                    return Ok(format!(
                        "ops::bit(&{}, {}.to_u64().unwrap_or(0) as usize)",
                        base_code, idx
                    ));
                };
                if let Some(mem) = self.resolve_mem(scope, name) {
                    let addr = self.expr(index, scope)?;
                    return Ok(format!(
                        "rt.mem_read({}, {}.to_u64().unwrap_or(0) as usize)",
                        mem, addr
                    ));
                }
                let Some(slot) = self.resolve(scope, name) else {
                    return Err(CodeGenError::UnknownSignal(name.clone()));
                };
                let idx = self.expr(index, scope)?;
                Ok(format!(
                    "ops::bit(rt.get({}), {}.to_u64().unwrap_or(0) as usize)",
                    slot, idx
                ))
            }
            Expression::Slice { base, high, low } => {
                let Expression::Ident(name) = base.as_ref() else {
                    // Not a plain name: evaluate the base as an expression, so
                    // that `u.y[1:0]` works on an instance output.
                    let base_code = self.expr(base, scope)?;
                    let high_code = self.expr(high, scope)?;
                    let low_code = self.expr(low, scope)?;
                    return Ok(format!(
                        "ops::slice(&{}, {}.to_u64().unwrap_or(0) as usize, {}.to_u64().unwrap_or(0) as usize)",
                        base_code, high_code, low_code
                    ));
                };
                let Some(slot) = self.resolve(scope, name) else {
                    return Err(CodeGenError::UnknownSignal(name.clone()));
                };
                let high_code = self.expr(high, scope)?;
                let low_code = self.expr(low, scope)?;
                Ok(format!(
                    "ops::slice(rt.get({}), {}.to_u64().unwrap_or(0) as usize, {}.to_u64().unwrap_or(0) as usize)",
                    slot, high_code, low_code
                ))
            }
            Expression::PartSelect {
                base,
                index,
                width,
                upward,
            } => {
                let base_code = self.expr(base, scope)?;
                let index_code = self.expr(index, scope)?;
                let width_code = self.expr(width, scope)?;
                Ok(format!(
                    "ops::part_select(&{}, {}.to_u64().unwrap_or(0) as usize, {}.to_u64().unwrap_or(1).max(1) as usize, {})",
                    base_code, index_code, width_code, upward
                ))
            }
            Expression::MethodCall {
                receiver,
                method,
                args,
            } => self.method_call(receiver, method, args, scope),
            Expression::If {
                condition,
                then_expr,
                else_expr,
            } => {
                let cond = self.expr_ref(condition, scope)?;
                let then_code = self.expr(then_expr, scope)?;
                let else_code = self.expr(else_expr, scope)?;
                Ok(format!(
                    "(if ops::truthy({}) {{ {} }} else {{ {} }})",
                    cond, then_code, else_code
                ))
            }
            Expression::Concat(parts) => {
                let mut codes = Vec::new();
                for part in parts {
                    codes.push(self.expr(part, scope)?);
                }
                Ok(format!("ops::concat(&[{}])", codes.join(", ")))
            }
            // `{4{8'hAB}}` (spec 9.7.2). The count is fixed at elaboration, so
            // the repetition is unrolled into a concatenation here.
            Expression::Replicate { count, value } => {
                let times = crate::project::Project::const_value(count, &Default::default())
                    .ok_or_else(|| {
                        CodeGenError::UnsupportedFeature(
                            "a replication count must be known at elaboration".to_string(),
                        )
                    })? as usize;
                let mut codes = Vec::new();
                for _ in 0..times {
                    for part in value {
                        codes.push(self.expr(part, scope)?);
                    }
                }
                Ok(format!("ops::concat(&[{}])", codes.join(", ")))
            }
            Expression::MemRead { mem_name, addr } => {
                let Some(mem) = self.resolve_mem(scope, mem_name) else {
                    return Err(CodeGenError::UnknownSignal(mem_name.clone()));
                };
                let addr_code = self.expr(addr, scope)?;
                Ok(format!(
                    "rt.mem_read({}, {}.to_u64().unwrap_or(0) as usize)",
                    mem, addr_code
                ))
            }
            Expression::Call { name, .. } => Err(CodeGenError::UnsupportedFeature(format!(
                "call to unknown function '{}'",
                name
            ))),
            Expression::SysFunc { name, args } => self.sys_func(name, args, scope),
            Expression::Match { scrutinee, arms } => {
                let value = self.expr(scrutinee, scope)?;
                let name = self.temp();
                let mut code = format!("{{ let {} = {}; ", name, value);
                let mut tail = String::new();
                for arm in arms {
                    let test = self.pattern_test(&arm.pattern, &name, scope)?;
                    let arm_code = match arm.pattern.payload_binding() {
                        Some((binding, tag_width, payload_width)) => {
                            // The binding lives in a scope of its own, so it
                            // shadows nothing and leaves nothing behind
                            self.match_scopes += 1;
                            let inner =
                                format!("{}.__match{}", scope.prefix, self.match_scopes);
                            let slot = self.add_slot(
                                format!("{}.{}", inner, binding),
                                None,
                                false,
                                true,
                            );
                            let arm_scope = scope.within(&inner);
                            let result = self.expr(&arm.value, &arm_scope)?;
                            format!(
                                "{{ rt.set_silent({}, ops::slice(&{}, {}, {})); {} }}",
                                slot,
                                name,
                                tag_width + payload_width - 1,
                                tag_width,
                                result
                            )
                        }
                        None => self.expr(&arm.value, scope)?,
                    };
                    tail.push_str(&format!("if {} {{ {} }} else ", test, arm_code));
                }
                // No arm covering the value leaves the target unchanged in the
                // interpreter, because evaluation fails; zero is the closest
                // a compiled expression can come without a fallible path
                tail.push_str("{ SignalValue::new(1) }");
                code.push_str(&tail);
                code.push_str(" }");
                Ok(code)
            }
        }
    }

    fn method_call(
        &mut self,
        receiver: &Expression,
        method: &str,
        args: &[Expression],
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        // Reinterpretation and width methods (spec 3.4.2)
        match method {
            "signed" | "unsigned" => {
                let value = self.expr(receiver, scope)?;
                return Ok(format!("{}.with_signed({})", value, method == "signed"));
            }
            "sign_extend" => {
                if let Some(arg) = args.first() {
                    let value = self.expr(receiver, scope)?;
                    let width = self.expr(arg, scope)?;
                    return Ok(format!(
                        "{}.sign_extend({}.to_u64().unwrap_or(0) as usize)",
                        value, width
                    ));
                }
            }
            "extend" => {
                if let Some(arg) = args.first() {
                    let value = self.expr(receiver, scope)?;
                    let width = self.expr(arg, scope)?;
                    return Ok(format!(
                        "SignalValue::from_u64({}.to_u64().unwrap_or(0), {}.to_u64().unwrap_or(0) as usize)",
                        value, width
                    ));
                }
            }
            // The rest of spec 3.4.2 and 9.2.3/9.2.4. The interpreter grew
            // these; without them here the two backends answer differently for
            // the same design, which is the one thing a second backend must
            // never do.
            "truncate" => {
                if let Some(arg) = args.first() {
                    let value = self.expr(receiver, scope)?;
                    let width = self.expr(arg, scope)?;
                    return Ok(format!(
                        "{}.truncate({}.to_u64().unwrap_or(0) as usize)",
                        value, width
                    ));
                }
            }
            "resize" => {
                if let Some(arg) = args.first() {
                    let value = self.expr(receiver, scope)?;
                    let width = self.expr(arg, scope)?;
                    return Ok(format!(
                        "{{ let v = {}; let w = {}.to_u64().unwrap_or(0) as usize;                          if w < v.width() {{ v.truncate(w) }}                          else {{ SignalValue::from_u64(v.to_u64().unwrap_or(0), w) }} }}",
                        value, width
                    ));
                }
            }
            "saturate" => {
                if let Some(arg) = args.first() {
                    let value = self.expr(receiver, scope)?;
                    let width = self.expr(arg, scope)?;
                    return Ok(format!(
                        "{{ let v = {}.to_u64().unwrap_or(0);                          let w = {}.to_u64().unwrap_or(0) as usize;                          let max = if w >= 64 {{ u64::MAX }} else {{ (1u64 << w) - 1 }};                          SignalValue::from_u64(v.min(max), w) }}",
                        value, width
                    ));
                }
            }
            "width" => {
                let value = self.expr(receiver, scope)?;
                return Ok(format!(
                    "SignalValue::from_u64({}.width() as u64, 32)",
                    value
                ));
            }
            "count_ones" | "count_zeros" | "leading_zeros" | "trailing_zeros" => {
                let value = self.expr(receiver, scope)?;
                let body = match method {
                    "count_ones" => "(0..w).filter(|i| (n >> i) & 1 == 1).count()",
                    "count_zeros" => "(0..w).filter(|i| (n >> i) & 1 == 0).count()",
                    "leading_zeros" => "(0..w).rev().take_while(|i| (n >> i) & 1 == 0).count()",
                    _ => "(0..w).take_while(|i| (n >> i) & 1 == 0).count()",
                };
                return Ok(format!(
                    "{{ let v = {}; let w = v.width(); let n = v.to_u64().unwrap_or(0);                      SignalValue::from_u64(({}) as u64, 32) }}",
                    value, body
                ));
            }
            "reverse_bits" => {
                let value = self.expr(receiver, scope)?;
                return Ok(format!(
                    "{{ let v = {}; let w = v.width(); let n = v.to_u64().unwrap_or(0);                      let mut r = 0u64;                      for i in 0..w {{ if (n >> i) & 1 == 1 {{ r |= 1u64 << (w - 1 - i); }} }}                      SignalValue::from_u64(r, w) }}",
                    value
                ));
            }
            "and_reduce" | "or_reduce" | "xor_reduce" => {
                let value = self.expr(receiver, scope)?;
                let body = match method {
                    "and_reduce" => "(0..w).all(|i| (n >> i) & 1 == 1)",
                    "or_reduce" => "(0..w).any(|i| (n >> i) & 1 == 1)",
                    _ => "(0..w).filter(|i| (n >> i) & 1 == 1).count() % 2 == 1",
                };
                return Ok(format!(
                    "{{ let v = {}; let w = v.width(); let n = v.to_u64().unwrap_or(0);                      SignalValue::from_u64(({}) as u64, 1) }}",
                    value, body
                ));
            }
            "is_power_of_two" => {
                let value = self.expr(receiver, scope)?;
                return Ok(format!(
                    "{{ let n = {}.to_u64().unwrap_or(0);                      SignalValue::from_u64(((n != 0) && (n & (n - 1) == 0)) as u64, 1) }}",
                    value
                ));
            }
            _ => {}
        }

        // Otherwise this is a hierarchical reference such as `dut.count`,
        // or a deeper one such as `core.rf.regs`
        let Some(base) = dotted_path(receiver) else {
            return Err(CodeGenError::UnsupportedFeature(format!(
                "method call '{}'",
                method
            )));
        };
        let full = format!("{}.{}", base, method);

        // `u.m[1]` reads a memory inside an instance. It parses the same way a
        // method call does, so the memory is looked up before the name is
        // treated as a signal.
        if args.len() == 1 {
            if let Some(mem) = self.resolve_mem(scope, &full) {
                let addr = self.expr(&args[0], scope)?;
                return Ok(format!(
                    "rt.mem_read({}, {}.to_u64().unwrap_or(0) as usize)",
                    mem, addr
                ));
            }
        }

        match self.resolve(scope, &full) {
            Some(slot) => Ok(format!("rt.get({}).clone()", slot)),
            None => Err(CodeGenError::UnknownSignal(full)),
        }
    }

    fn sys_func(
        &mut self,
        name: &str,
        args: &[SysFuncArg],
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        match (name, args.first()) {
            ("isunknown", Some(SysFuncArg::Expr(e))) => {
                let code = self.expr(e, scope)?;
                Ok(format!(
                    "SignalValue::from_u64({}.to_u64().is_none() as u64, 1)",
                    code
                ))
            }
            ("onehot", Some(SysFuncArg::Expr(e))) => {
                let code = self.expr(e, scope)?;
                Ok(format!(
                    "SignalValue::from_u64(({}.to_u64().unwrap_or(0).count_ones() == 1) as u64, 1)",
                    code
                ))
            }
            ("size", Some(SysFuncArg::Expr(e))) => {
                // The argument may name a memory below this scope
                let path = crate::sim::eval::memory_path(e).ok_or_else(|| {
                    CodeGenError::UnsupportedFeature("$size of something that is not a memory".to_string())
                })?;
                match self.resolve_mem(scope, &path) {
                    Some(mem) => Ok(format!(
                        "SignalValue::from_u64(rt.mem_depth({}) as u64, 32)",
                        mem
                    )),
                    None => Err(CodeGenError::UnknownSignal(path)),
                }
            }
            _ => {
                // The synthesisable functions fold to a constant
                let expr = Expression::SysFunc {
                    name: name.to_string(),
                    args: args.to_vec(),
                };
                match self.const_value(&expr) {
                    Some((value, width)) => {
                        Ok(format!("SignalValue::from_u64({}, {})", value, width))
                    }
                    None => Err(CodeGenError::UnsupportedFeature(format!(
                        "system function ${}",
                        name
                    ))),
                }
            }
        }
    }

    /// Code testing whether a pattern accepts a value
    fn pattern_test(
        &mut self,
        pattern: &Pattern,
        value: &str,
        scope: &Scope,
    ) -> Result<String, CodeGenError> {
        Ok(match pattern {
            Pattern::Wildcard => "true".to_string(),
            Pattern::Literal(lit) => {
                format!("{}.to_u64() == Some({})", value, lit.to_u64())
            }
            Pattern::Ident(name) => match self.resolve(scope, name) {
                Some(slot) => format!("rt.get({}).to_u64() == {}.to_u64()", slot, value),
                None => "false".to_string(),
            },
            Pattern::Variant { tag, tag_width, .. } => {
                let mask: u64 = if *tag_width >= 64 {
                    u64::MAX
                } else {
                    (1u64 << tag_width) - 1
                };
                format!(
                    "{}.to_u64().map(|v| v & {} == {}).unwrap_or(false)",
                    value, mask, tag
                )
            }
            // Only an elaborated pattern can be matched
            Pattern::Path { .. } => "false".to_string(),
        })
    }

    /// Bind a matched payload to its name, before the arm runs
    fn emit_payload_binding(
        &mut self,
        pattern: &Pattern,
        value: &str,
        scope: &Scope,
    ) -> Result<(), CodeGenError> {
        let Some((name, tag_width, payload_width)) = pattern.payload_binding() else {
            return Ok(());
        };
        let slot = self.target_slot(scope, name);
        self.line(&format!(
            "rt.set({}, ops::slice(&{}, {}, {}));",
            slot,
            value,
            tag_width + payload_width - 1,
            tag_width
        ));
        Ok(())
    }

    // -------------------------------------------------------------- run loops

    fn emit_run_loop(&mut self) {
        let multi = self.clocks.len() > 1;

        // What happens on one rising edge
        if multi {
            for i in 0..self.clocks.len() {
                self.open(&format!("fn rising_{}(rt: &mut Runtime) {{", i));
                self.line("propagate_ports(rt);");
                self.line(&format!("sync_clock_{}(rt);", i));
                self.open("if rt.reset_active {");
                self.line("fsm_reset(rt);");
                self.close("} else {");
                self.indent += 1;
                self.line(&format!("fsm_clock_{}(rt);", i));
                self.close("}");
                self.line("comb_settle(rt);");
                self.close("}");
                self.blank();
            }
        }

        self.open("fn run_cycles(rt: &mut Runtime, cycles: u64) {");
        self.open("if !rt.initial_executed && !rt.reset_active {");
        self.line("rt.initial_executed = true;");
        self.line("seq_advance(rt, false);");
        self.close("}");
        self.blank();

        if multi {
            self.line("let end_time = rt.time + cycles * CLOCK_PERIOD;");
            self.open("while rt.time < end_time {");
            self.line("if rt.finished { break; }");
            self.line("let next = match rt.next_edge_time() { Some(t) if t < end_time => t, _ => break };");
            self.line("rt.time = next;");
            self.blank();
            self.line("let rising = rt.advance_clocks();");
            self.open("for clock in rising {");
            self.open("match clock {");
            for i in 0..self.clocks.len() {
                self.line(&format!("{} => rising_{}(rt),", i, i));
            }
            self.line("_ => {}");
            self.close("}");
            self.close("}");
            self.blank();
            if self.is_test {
                self.open("if rt.reset_active && rt.time / CLOCK_PERIOD >= RESET_CYCLES {");
                self.line("rt.deassert_resets();");
                self.close("}");
            }
            self.open("if !rt.initial_executed && !rt.reset_active {");
            self.line("rt.initial_executed = true;");
            self.line("seq_advance(rt, false);");
            self.close("} else if rt.initial_executed {");
            self.indent += 1;
            self.line("seq_advance(rt, true);");
            self.close("}");
            self.close("}");
        } else {
            self.open("for _ in 0..cycles {");
            self.line("if rt.finished { break; }");
            self.line("step(rt);");
            self.open("if !rt.initial_executed && !rt.reset_active {");
            self.line("rt.initial_executed = true;");
            self.line("seq_advance(rt, false);");
            self.close("} else if rt.initial_executed {");
            self.indent += 1;
            self.line("seq_advance(rt, true);");
            self.close("}");
            self.close("}");
        }
        self.close("}");
        self.blank();

        if !multi {
            self.open("fn step(rt: &mut Runtime) {");
            if self.is_test {
                self.line("rt.cycle_count += 1;");
                self.open("if rt.reset_active && rt.cycle_count > RESET_CYCLES {");
                self.line("rt.deassert_resets();");
                self.close("}");
            }
            if let Some(clock) = self.single_clock.clone() {
                if let Some(&slot) = self.slot_of.get(&clock) {
                    self.line(&format!(
                        "rt.set_raw({}, SignalValue::from_u64(1, 1)); // {} rises",
                        slot, clock
                    ));
                }
            }
            self.line("propagate_ports(rt);");
            self.line("sync_all(rt);");
            self.open("if rt.reset_active {");
            self.line("fsm_reset(rt);");
            self.close("} else {");
            self.indent += 1;
            self.line("fsm_all(rt);");
            self.close("}");
            self.line("comb_settle(rt);");
            self.line("rt.time += CLOCK_PERIOD / 2;");
            if let Some(clock) = self.single_clock.clone() {
                if let Some(&slot) = self.slot_of.get(&clock) {
                    self.line(&format!(
                        "rt.set_raw({}, SignalValue::from_u64(0, 1)); // {} falls",
                        slot, clock
                    ));
                }
            }
            self.line("rt.time += CLOCK_PERIOD / 2;");
            self.close("}");
            self.blank();
        }
    }

    fn emit_main(&mut self) {
        let top = self.top.clone();
        let is_test = self.is_test;
        let reset_cycles = self.reset_duration;

        self.line("#[allow(dead_code)]");
        self.line(&format!("const RESET_CYCLES: u64 = {};", reset_cycles));
        self.blank();
        self.open("fn main() {");
        self.line("let args: Vec<String> = std::env::args().collect();");
        self.line("let mut cycles: u64 = 100;");
        self.line("let mut output: Option<String> = None;");
        self.line(&format!("let mut source = String::from({:?});", self.source));
        self.line("let mut verbose = false;");
        self.line("let mut i = 1;");
        self.open("while i < args.len() {");
        self.open("match args[i].as_str() {");
        self.line("\"-c\" | \"--cycles\" => { i += 1; cycles = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(cycles); }");
        self.line("\"-o\" | \"--output\" => { i += 1; output = args.get(i).cloned(); }");
        self.line("\"-s\" | \"--source\" => { i += 1; source = args.get(i).cloned().unwrap_or(source); }");
        self.line("\"-v\" | \"--verbose\" => verbose = true,");
        self.line("other => { if let Ok(n) = other.parse::<u64>() { cycles = n; } }");
        self.close("}");
        self.line("i += 1;");
        self.close("}");
        self.blank();
        self.line("let mut rt = build(output.is_some());");

        if !is_test {
            self.line("// A design driven from outside gets an explicit reset first");
            self.line("rt.assert_resets();");
            self.line("apply_reset(&mut rt);");
            self.line("run_cycles(&mut rt, 5);");
            self.line("rt.deassert_resets();");
            for name in ["enable", "enable_sig"] {
                if let Some(&slot) = self.slot_of.get(name) {
                    self.line(&format!(
                        "rt.set({}, SignalValue::from_u64(1, 1)); // {}",
                        slot, name
                    ));
                }
            }
        }

        self.line("run_cycles(&mut rt, cycles);");
        self.blank();
        self.open("if verbose {");
        self.line("println!(\"  Simulation time: {} ps\", rt.time);");
        self.close("}");
        self.open("if let Some(path) = output {");
        self.line(&format!(
            "if let Err(e) = rt.trace.write_vcd(std::path::Path::new(&path), {:?}) {{",
            top
        ));
        self.indent += 1;
        self.line("eprintln!(\"failed to write {}: {}\", path, e);");
        self.close("}");
        self.close("}");
        self.blank();
        self.line("rt.report_coverage();");
        self.line("let failed = rt.report_failures(&source);");
        self.open("if failed {");
        self.line("println!(\"Simulation completed with assertion failures.\");");
        self.close("} else {");
        self.indent += 1;
        self.line("println!(\"Simulation completed successfully.\");");
        self.close("}");
        self.blank();
        self.open("if verbose {");
        self.line("println!();");
        self.line("println!(\"Final signal values:\");");
        self.open("for slot in 0..rt.sig.len() {");
        self.open("if !rt.is_visible(slot) {");
        self.line("continue;");
        self.close("}");
        self.line("println!(\"  {}: {}\", rt.names[slot], rt.sig[slot]);");
        self.close("}");
        self.close("}");
        self.blank();
        self.open("if failed {");
        self.line("std::process::exit(1);");
        self.close("}");
        self.close("}");
    }
}

// ------------------------------------------------------------------- helpers

/// The state an FSM starts in: the one named by `initial:`, else the first
fn fsm_initial_state(fsm: &FsmBlock) -> Option<(usize, String)> {
    if let Some(named) = &fsm.initial_state {
        if let Some(index) = fsm.states.iter().position(|s| &s.name == named) {
            return Some((index, named.clone()));
        }
    }
    fsm.states.first().map(|s| (0, s.name.clone()))
}

/// Number of bits needed to encode an FSM's states
fn state_width(fsm: &FsmBlock) -> usize {
    let states = fsm.states.len().max(2);
    (states as f64).log2().ceil().max(1.0) as usize
}

/// Position of a state in an FSM's state list
fn state_index(fsm: &FsmBlock, name: &str) -> Option<usize> {
    fsm.states.iter().position(|s| s.name == name)
}

/// The outputs a state drives just by being entered
fn moore_outputs(fsm: &FsmBlock, state: &str) -> Vec<(String, Expression)> {
    fsm.states
        .iter()
        .find(|s| s.name == state)
        .map(|s| s.moore_outputs.clone())
        .unwrap_or_default()
}

/// Collect block-local `let` declarations that carry an explicit type
fn collect_typed_let_locals(stmts: &[Statement], out: &mut Vec<(String, usize)>) {
    for stmt in stmts {
        match stmt {
            Statement::LetLocal { name, ty, .. } => {
                if let Some(width) = ty.as_ref().and_then(|t| t.width()) {
                    if !out.iter().any(|(n, _)| n == name) {
                        out.push((name.clone(), width));
                    }
                }
            }
            Statement::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_typed_let_locals(then_branch, out);
                if let Some(else_b) = else_branch {
                    collect_typed_let_locals(else_b, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                collect_typed_let_locals(body, out)
            }
            Statement::Match { arms, .. } => {
                for arm in arms {
                    collect_typed_let_locals(&arm.body, out);
                }
            }
            _ => {}
        }
    }
}

/// Collect the names of all signals assigned anywhere in a statement list
fn collect_assigned_signals(stmts: &[Statement], out: &mut Vec<String>) {
    for stmt in stmts {
        match stmt {
            Statement::Assign { target, .. } | Statement::SliceWrite { target, .. } => {
                if !out.iter().any(|t| t == target) {
                    out.push(target.clone());
                }
            }
            Statement::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_assigned_signals(then_branch, out);
                if let Some(else_b) = else_branch {
                    collect_assigned_signals(else_b, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                collect_assigned_signals(body, out)
            }
            Statement::Match { arms, .. } => {
                for arm in arms {
                    collect_assigned_signals(&arm.body, out);
                }
            }
            _ => {}
        }
    }
}

/// Collect the names of all memories written anywhere in a statement list
fn collect_written_memories(stmts: &[Statement], out: &mut Vec<String>) {
    for stmt in stmts {
        match stmt {
            Statement::MemWrite { mem_name, .. } => {
                if !out.iter().any(|m| m == mem_name) {
                    out.push(mem_name.clone());
                }
            }
            Statement::If {
                then_branch,
                else_branch,
                ..
            } => {
                collect_written_memories(then_branch, out);
                if let Some(else_b) = else_branch {
                    collect_written_memories(else_b, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                collect_written_memories(body, out)
            }
            Statement::Match { arms, .. } => {
                for arm in arms {
                    collect_written_memories(&arm.body, out);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate(source: &str) -> String {
        let parser = crate::parser::Parser::new();
        let result = parser.parse_all(source).expect("source should parse");
        let mut project = Project::new();
        for module in result.modules {
            project.modules.insert(module.name.clone(), module);
        }
        project.set_top("Counter").expect("top module should exist");
        project.elaborate();
        SimGenerator::new(project)
            .expect("prepare")
            .generate()
            .expect("generate")
    }

    #[test]
    fn a_counter_compiles_to_a_program() {
        let code = generate(
            r#"
            mod Counter(
                in clk: clock,
                in rst: reset,
                out count: bit[8],
            ) {
                var counter: bit[8] = 0;
                sync(clk.posedge, rst.async) {
                    counter = counter + 1;
                }
                comb {
                    count = counter;
                }
            }
            "#,
        );
        assert!(code.contains("fn main()"));
        assert!(code.contains("fn build(tracing: bool) -> Runtime"));
        // A run that asks for no waveform must not pay to record one
        assert!(code.contains("let mut rt = build(output.is_some());"));
        // `counter + 1` is unsigned arithmetic over a known width, so it is
        // computed in a machine word rather than through the generic operator
        assert!(code.contains("rt.get_u64("));
        assert!(!code.contains("ops::binop"));
    }

    #[test]
    fn combinational_feedback_keeps_the_settle_loop() {
        // The machine-word path reads and writes through `rt.get_u64` and
        // `rt.set_u64`. When the analysis that decides whether one pass settles
        // the design looked only for `rt.get` and `rt.set`, those became
        // invisible: a design with feedback looked as if it had none, the loop
        // was folded away and the design stopped half-settled.
        let code = generate(
            r#"
            mod Counter(
                in clk: clock,
                in rst: reset,
                in a: bit[8],
                out z: bit[8],
            ) {
                var s1: bit[8] = 0;
                var s2: bit[8] = 0;

                comb {
                    z = s2 + 1;
                }
                comb {
                    s2 = s1 + 1;
                }
                comb {
                    s1 = a + 1;
                }
            }
            "#,
        );
        assert!(code.contains("rt.get_u64("), "the word path should be in use");
        assert!(
            code.contains("for _ in 0..10"),
            "a design whose blocks feed one another must keep its settle loop"
        );
    }

    #[test]
    fn a_signed_operand_stays_on_the_general_path() {
        // `ops::signed_binop` gives signed comparison, division, remainder and
        // arithmetic shift their own meaning. The word path declines them.
        let code = generate(
            r#"
            mod Counter(
                in clk: clock,
                in rst: reset,
                out y: bit[32],
            ) {
                var a: int[32] = 0;
                var b: int[32] = 0;
                comb {
                    y = if a < b { 32'd1 } else { 32'd0 };
                }
            }
            "#,
        );
        assert!(code.contains("ops::binop"));
    }
}

/// A statement that stages exactly one update, unconditionally.
///
/// Returns the slot and the value expression when `body` is a single
/// `updates.push((slot, value));` and nothing else. Anything with a branch, a
/// loop, a memory write or a second update is left alone, because those are the
/// cases the staging buffer exists for.
fn lone_update(body: &str) -> Option<(String, String)> {
    let mut lines = body.lines().filter(|l| !l.trim().is_empty());
    let only = lines.next()?;
    if lines.next().is_some() {
        return None;
    }
    let trimmed = only.trim();
    let inner = trimmed
        .strip_prefix("updates.push((")?
        .strip_suffix("));")?;
    if body.matches("updates.push((").count() != 1 || body.contains("mem_writes.push(") {
        return None;
    }
    let comma = inner.find(',')?;
    let (slot, value) = inner.split_at(comma);
    if !slot.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((slot.to_string(), value[1..].trim().to_string()))
}

/// Reads and writes of one generated function, in the order they are emitted.
///
/// Each store closes a step: what was read since the previous store is what that
/// step depended on. Returns `None` when something in the body puts the analysis
/// out of reach — a memory, or a slot number that is not a literal.
fn steps_of(body: &str) -> Option<Vec<(usize, std::collections::BTreeSet<usize>)>> {
    if body.contains("rt.mem_write(")
        || body.contains("rt.mem_read(")
        || body.contains("rt.mem_clear(")
        || body.contains("mem_writes.push(")
    {
        return None;
    }

    let slot_after = |line: &str, prefix: &str| -> Option<Option<usize>> {
        let at = match line.find(prefix) {
            Some(a) => a,
            None => return Some(None),
        };
        let rest = &line[at + prefix.len()..];
        let end = rest.find(|c: char| !c.is_ascii_digit())?;
        if end == 0 {
            return None; // computed slot
        }
        rest[..end].parse::<usize>().ok().map(Some)
    };

    let mut steps = Vec::new();
    let mut reads = std::collections::BTreeSet::new();

    for line in body.lines() {
        // Reads on this line. Both the general accessor and the machine-word
        // one count: missing either makes a dependency invisible and lets the
        // settle loop collapse on a design that needs it.
        for prefix in ["rt.get(", "rt.get_u64("] {
            let mut rest = line;
            while let Some(at) = rest.find(prefix) {
                rest = &rest[at + prefix.len()..];
                let end = rest.find(|c: char| !c.is_ascii_digit())?;
                if end == 0 {
                    return None;
                }
                reads.insert(rest[..end].parse::<usize>().ok()?);
            }
        }

        for prefix in [
            "rt.set(",
            "rt.set_u64(",
            "rt.set_raw(",
            "rt.set_silent(",
            "rt.store(",
            "updates.push((",
        ] {
            if let Some(slot) = slot_after(line, prefix)? {
                steps.push((slot, std::mem::take(&mut reads)));
            }
        }
        if line.contains("updates.push(") && !line.contains("updates.push((") {
            return None; // a shape this analysis does not understand
        }
    }
    Some(steps)
}

/// The body of a generated function, by name
fn function_body<'a>(source: &'a str, header: &str) -> Option<&'a str> {
    let start = source.find(header)? + header.len();
    let rest = &source[start..];
    let end = rest.find("\n}\n")?;
    Some(&rest[..end])
}

/// Run the combinational blocks once instead of to a fixed point, when nothing
/// they write is read back by them.
///
/// The settle loop exists because one combinational block can feed another, and
/// the order they were written in need not be the order they must run in. When
/// no block reads a signal that any block writes, the first pass has already
/// settled and the second exists only to report that nothing changed.
///
/// Anything the analysis cannot account for — a memory, a computed slot number
/// — leaves the loop in place.
fn collapse_settle_when_acyclic(source: String) -> String {
    let parts = [
        "fn comb_pass(rt: &mut Runtime) -> bool {",
        "fn propagate_ports(rt: &mut Runtime) -> bool {",
        "fn propagate_outputs(rt: &mut Runtime) -> bool {",
    ];
    let mut steps = Vec::new();
    for header in parts {
        let Some(body) = function_body(&source, header) else {
            return source;
        };
        let Some(s) = steps_of(body) else {
            return source;
        };
        steps.extend(s);
    }

    // One pass settles the design when no step writes a signal an earlier step
    // read. The order the blocks were written in is then already an order they
    // can run in, and a second pass could only report no change.
    for (i, (slot, _)) in steps.iter().enumerate() {
        if steps[..i].iter().any(|(_, reads)| reads.contains(slot)) {
            return source;
        }
    }

    let looping = "fn comb_settle(rt: &mut Runtime) {\n    for _ in 0..10 {\n        let mut changed = comb_pass(rt);\n        changed |= propagate_outputs(rt);\n        changed |= propagate_ports(rt);\n        if !changed {\n            break;\n        }\n    }\n}";
    let once = "fn comb_settle(rt: &mut Runtime) {\n    // No step writes a signal an earlier step read, so the order these blocks\n    // were written in is an order they can run in. One pass settles the design\n    // and a second could only report no change.\n    comb_pass(rt);\n    propagate_outputs(rt);\n    propagate_ports(rt);\n}";
    if !source.contains(looping) {
        return source;
    }
    let source = source.replace(looping, once);

    // With the loop gone, nothing reads what `comb_pass` returns, so the
    // comparison each store makes to answer "did this change?" is dead work.
    let Some(body) = function_body(&source, "fn comb_pass(rt: &mut Runtime) -> bool {") else {
        return source;
    };
    let lean = body
        .replace("changed |= rt.set(", "rt.store(")
        .replace("changed |= rt.mem_write(", "rt.mem_write(");
    let lean = store_words_directly(&lean);
    source.replace(body, &lean)
}

/// Mask keeping the low `width` bits
fn word_mask(width: usize) -> u64 {
    if width == 0 {
        0
    } else if width >= 64 {
        u64::MAX
    } else {
        (1u64 << width) - 1
    }
}

/// Truncate an expression to `width` bits, when that does anything
fn mask_to(body: &str, width: usize) -> String {
    if width >= 64 {
        format!("({})", body)
    } else {
        format!("(({}) & {}u64)", body, word_mask(width))
    }
}

/// Store a machine word without wrapping it in a value first.
///
/// Turns
///
/// ```text
/// let __t1 = SignalValue::from_u64(EXPR, W);
/// rt.store(SLOT, __t1);
/// ```
///
/// into `rt.set_u64(SLOT, EXPR);`. The width `W` does not need checking against
/// the slot: `store` truncates the value to the slot's width and `set_u64`
/// masks to the same width, so the two agree whatever `W` was.
fn store_words_directly(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let mut out = String::with_capacity(body.len());
    let mut i = 0;

    while i < lines.len() {
        let first = lines[i].trim();
        let paired = i + 1 < lines.len();
        let built = first
            .strip_prefix("let ")
            .and_then(|r| r.split_once(" = SignalValue::from_u64("))
            .and_then(|(name, rest)| rest.strip_suffix(");").map(|args| (name, args)));

        if let (true, Some((name, args))) = (paired, built) {
            // Split the value from its width at the last comma outside brackets
            let mut depth = 0i32;
            let mut cut = None;
            for (at, c) in args.char_indices() {
                match c {
                    '(' | '[' | '{' => depth += 1,
                    ')' | ']' | '}' => depth -= 1,
                    ',' if depth == 0 => cut = Some(at),
                    _ => {}
                }
            }
            let store = format!("rt.store(", );
            let second = lines[i + 1].trim();
            if let (Some(cut), Some(rest)) = (cut, second.strip_prefix(&store)) {
                if let Some((slot, tmp)) = rest.strip_suffix(");").and_then(|r| r.split_once(", ")) {
                    if tmp == name && slot.chars().all(|c| c.is_ascii_digit()) {
                        let indent: String =
                            lines[i].chars().take_while(|c| c.is_whitespace()).collect();
                        out.push_str(&format!("{}rt.set_u64({}, {});\n", indent, slot, &args[..cut]));
                        i += 2;
                        continue;
                    }
                }
            }
        }
        out.push_str(lines[i]);
        out.push('\n');
        i += 1;
    }
    out
}
