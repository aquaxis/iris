//! Hierarchical simulation engine
//!
//! This module provides hierarchical simulation support for multi-module designs.

use std::collections::HashMap;

use crate::parser::{Expression, Instance, LogicBlock, Module, ResetMode, Statement};
use crate::project::Project;
use crate::types::{SignalValue, SimTime};

use super::eval::Evaluator;
use super::trace::SignalTrace;

/// Instance runtime state
#[derive(Debug)]
struct InstanceState {
    /// Instance name
    name: String,
    /// Module name (type)
    module_name: String,
    /// Signal values for this instance (prefixed with instance path)
    signals: HashMap<String, SignalValue>,
    /// Port connections (port_name -> expression)
    port_connections: Vec<(String, Expression)>,
}

/// Hierarchical simulator for multi-module designs
pub struct HierarchicalSimulator {
    /// Project containing all modules
    project: Project,
    /// Top module name
    top_module: String,
    /// All signal values (hierarchical names like "top.dut.count")
    signals: HashMap<String, SignalValue>,
    /// Instance states
    instances: HashMap<String, InstanceState>,
    /// Current simulation time
    time: SimTime,
    /// Clock period
    clock_period: SimTime,
    /// Signal trace
    trace: SignalTrace,
    /// Reset signal name
    reset_signal: Option<String>,
    /// Clock signal name
    clock_signal: Option<String>,
    /// Reset is active
    reset_active: bool,
    /// Is top module a test module (no ports, auto-generate clock/reset)
    is_test_mode: bool,
    /// Reset duration in cycles (for test mode)
    reset_duration: u64,
    /// Current cycle count (for test mode reset)
    cycle_count: u64,
}

impl HierarchicalSimulator {
    /// Create a new hierarchical simulator
    pub fn new(project: Project) -> Self {
        let top_module = project.top_module.clone().unwrap_or_default();
        let is_test_mode = project.is_top_test_module();
        let mut sim = Self {
            project,
            top_module,
            signals: HashMap::new(),
            instances: HashMap::new(),
            time: 0,
            clock_period: 10_000, // 10ns
            trace: SignalTrace::new(),
            reset_signal: None,
            clock_signal: None,
            reset_active: false,
            is_test_mode,
            reset_duration: 5, // Default: 5 cycles reset
            cycle_count: 0,
        };
        sim.initialize();
        sim
    }

    /// Initialize all signals including instances
    fn initialize(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.initialize_module(&top, "");
        }

        // For test mode, initialize clock and reset
        if self.is_test_mode {
            self.initialize_test_signals();
        }
    }

    /// Initialize clock and reset signals for test mode
    fn initialize_test_signals(&mut self) {
        // Find clock and reset signals in internal declarations
        if let Some(top) = self.project.get_module(&self.top_module) {
            for signal in &top.signals {
                match &signal.ty {
                    crate::parser::Type::Clock => {
                        self.clock_signal = Some(signal.name.clone());
                        // Initialize clock to 0
                        self.signals.insert(signal.name.clone(), SignalValue::from_u64(0, 1));
                        self.trace.record(&signal.name, 0, SignalValue::from_u64(0, 1));
                    }
                    crate::parser::Type::Reset { .. } => {
                        self.reset_signal = Some(signal.name.clone());
                        // Initialize reset to active (1)
                        self.signals.insert(signal.name.clone(), SignalValue::from_u64(1, 1));
                        self.trace.record(&signal.name, 0, SignalValue::from_u64(1, 1));
                        self.reset_active = true;
                    }
                    _ => {}
                }
            }
        }
    }

    /// Initialize a module and its instances recursively
    fn initialize_module(&mut self, module: &Module, prefix: &str) {
        // Initialize ports
        for port in &module.ports {
            let name = self.make_signal_name(prefix, &port.name);
            let width = port.ty.width().unwrap_or(1);
            let value = SignalValue::new(width);
            self.signals.insert(name.clone(), value.clone());
            self.trace.record(&name, 0, value);

            // Track reset signal (only at top level)
            if prefix.is_empty() && matches!(port.ty, crate::parser::Type::Reset { .. }) {
                self.reset_signal = Some(name);
            }
        }

        // Initialize internal signals
        for signal in &module.signals {
            let name = self.make_signal_name(prefix, &signal.name);
            let width = signal.ty.width().unwrap_or(1);
            let value = if let Some(ref init) = signal.init_value {
                let evaluator = Evaluator::new(&self.signals);
                evaluator.eval(init).unwrap_or_else(|_| SignalValue::new(width))
            } else {
                SignalValue::new(width)
            };
            self.signals.insert(name.clone(), value.clone());
            self.trace.record(&name, 0, value);
        }

        // Initialize instances
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };

            // Create instance state
            let state = InstanceState {
                name: inst.name.clone(),
                module_name: inst.module_name.clone(),
                signals: HashMap::new(),
                port_connections: inst.port_connections.clone(),
            };
            self.instances.insert(inst_prefix.clone(), state);

            // Recursively initialize the instantiated module
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.initialize_module(&inst_module, &inst_prefix);
            }
        }
    }

    /// Make hierarchical signal name
    fn make_signal_name(&self, prefix: &str, name: &str) -> String {
        if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}.{}", prefix, name)
        }
    }

    /// Assert reset
    pub fn assert_reset(&mut self) {
        if let Some(ref rst) = self.reset_signal.clone() {
            self.signals.insert(rst.clone(), SignalValue::from_u64(1, 1));
            self.trace.record(rst, self.time, SignalValue::from_u64(1, 1));
        }
        self.reset_active = true;
        self.apply_reset();
    }

    /// Deassert reset
    pub fn deassert_reset(&mut self) {
        if let Some(ref rst) = self.reset_signal.clone() {
            self.signals.insert(rst.clone(), SignalValue::from_u64(0, 1));
            self.trace.record(rst, self.time, SignalValue::from_u64(0, 1));
        }
        self.reset_active = false;
    }

    /// Apply reset values
    fn apply_reset(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.apply_reset_to_module(&top, "");
        }
    }

    /// Apply reset to a module and its instances
    fn apply_reset_to_module(&mut self, module: &Module, prefix: &str) {
        for signal in &module.signals {
            if signal.is_var || signal.is_mutable {
                if let Some(ref init) = signal.init_value {
                    let evaluator = Evaluator::new(&self.signals);
                    if let Ok(value) = evaluator.eval(init) {
                        let name = self.make_signal_name(prefix, &signal.name);
                        self.signals.insert(name.clone(), value.clone());
                        self.trace.record(&name, self.time, value);
                    }
                }
            }
        }

        // Apply reset to instances
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.apply_reset_to_module(&inst_module, &inst_prefix);
            }
        }
    }

    /// Set a signal value
    pub fn set_signal(&mut self, name: &str, value: SignalValue) {
        if self.signals.contains_key(name) {
            self.signals.insert(name.to_string(), value.clone());
            self.trace.record(name, self.time, value);
        }
    }

    /// Get a signal value
    pub fn get_signal(&self, name: &str) -> Option<&SignalValue> {
        self.signals.get(name)
    }

    /// Run simulation for specified number of cycles
    pub fn run_cycles(&mut self, cycles: u64) {
        for _ in 0..cycles {
            self.step_cycle();
        }
    }

    /// Execute one clock cycle
    fn step_cycle(&mut self) {
        // For test mode, auto-deassert reset after reset_duration cycles
        if self.is_test_mode {
            self.cycle_count += 1;
            if self.reset_active && self.cycle_count > self.reset_duration {
                self.deassert_reset();
            }
        }

        // Find clock signal (use clock_signal for test mode, or find from ports)
        let clk = if self.is_test_mode {
            self.clock_signal.clone()
        } else {
            self.find_clock_signal()
        };

        // Clock rising edge
        if let Some(ref clk_name) = clk {
            self.signals.insert(clk_name.clone(), SignalValue::from_u64(1, 1));
            self.trace.record(clk_name, self.time, SignalValue::from_u64(1, 1));
        }

        // Propagate port connections (inputs to instances)
        self.propagate_port_connections();

        // Check async reset
        let has_async_reset = self.has_async_reset() && self.reset_active;

        if has_async_reset {
            self.apply_reset();
        } else {
            // Execute sync blocks for all modules
            self.execute_all_sync_blocks();
        }

        // Execute comb blocks for all modules
        self.execute_all_comb_blocks();

        // Propagate output ports from instances
        self.propagate_output_ports();

        // Clock falling edge
        self.time += self.clock_period / 2;
        if let Some(ref clk_name) = clk {
            self.signals.insert(clk_name.clone(), SignalValue::from_u64(0, 1));
            self.trace.record(clk_name, self.time, SignalValue::from_u64(0, 1));
        }

        self.time += self.clock_period / 2;
    }

    /// Propagate port connections from parent to instance
    fn propagate_port_connections(&mut self) {
        let instances: Vec<_> = self.instances.keys().cloned().collect();

        for inst_path in instances {
            if let Some(state) = self.instances.get(&inst_path) {
                let connections = state.port_connections.clone();
                let module_name = state.module_name.clone();

                if let Some(module) = self.project.get_module(&module_name) {
                    for (port_name, expr) in &connections {
                        // Find the port in the module
                        if let Some(port) = module.ports.iter().find(|p| &p.name == port_name) {
                            if matches!(port.direction, crate::parser::PortDirection::In) {
                                // Evaluate expression in parent context
                                let evaluator = Evaluator::new(&self.signals);
                                if let Ok(value) = evaluator.eval(expr) {
                                    // Set the instance's port value
                                    let target = format!("{}.{}", inst_path, port_name);
                                    self.signals.insert(target, value);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// Propagate output ports from instances to parent
    fn propagate_output_ports(&mut self) {
        // This is handled by comb block evaluation with hierarchical references
    }

    /// Find clock signal
    fn find_clock_signal(&self) -> Option<String> {
        if let Some(top) = self.project.get_module(&self.top_module) {
            for port in &top.ports {
                if matches!(port.ty, crate::parser::Type::Clock) {
                    return Some(port.name.clone());
                }
            }
        }
        None
    }

    /// Check if any module has async reset
    fn has_async_reset(&self) -> bool {
        if let Some(top) = self.project.get_module(&self.top_module) {
            for block in &top.logic_blocks {
                if let LogicBlock::Sync(sync) = block {
                    if let Some(ref reset) = sync.reset {
                        if matches!(reset.mode, ResetMode::Async) {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// Execute all sync blocks
    fn execute_all_sync_blocks(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.execute_module_sync_blocks(&top, "");
        }
    }

    /// Execute sync blocks for a module
    fn execute_module_sync_blocks(&mut self, module: &Module, prefix: &str) {
        let mut updates: Vec<(String, SignalValue)> = Vec::new();

        for block in &module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                // Check sync reset
                if let Some(ref reset) = sync.reset {
                    if matches!(reset.mode, ResetMode::Sync) && self.reset_active {
                        for signal in &module.signals {
                            if signal.is_var || signal.is_mutable {
                                if let Some(ref init) = signal.init_value {
                                    let evaluator = Evaluator::new(&self.signals);
                                    if let Ok(value) = evaluator.eval(init) {
                                        let name = self.make_signal_name(prefix, &signal.name);
                                        updates.push((name, value));
                                    }
                                }
                            }
                        }
                        continue;
                    }
                }

                // Execute statements
                for stmt in &sync.statements {
                    if let Some((name, value)) = self.execute_statement(stmt, prefix) {
                        updates.push((name, value));
                    }
                }
            }
        }

        // Apply updates
        for (name, value) in updates {
            let changed = self.signals.get(&name) != Some(&value);
            self.signals.insert(name.clone(), value.clone());
            if changed {
                self.trace.record(&name, self.time, value);
            }
        }

        // Execute sync blocks for instances
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.execute_module_sync_blocks(&inst_module, &inst_prefix);
            }
        }
    }

    /// Execute all comb blocks
    fn execute_all_comb_blocks(&mut self) {
        // Iterate until convergence
        for _ in 0..10 {
            let mut any_changed = false;

            if let Some(top) = self.project.get_module(&self.top_module).cloned() {
                if self.execute_module_comb_blocks(&top, "") {
                    any_changed = true;
                }
            }

            if !any_changed {
                break;
            }
        }
    }

    /// Execute comb blocks for a module (returns true if any signal changed)
    fn execute_module_comb_blocks(&mut self, module: &Module, prefix: &str) -> bool {
        let mut any_changed = false;

        for block in &module.logic_blocks {
            if let LogicBlock::Comb(comb) = block {
                for stmt in &comb.statements {
                    if let Some((name, value)) = self.execute_statement(stmt, prefix) {
                        let changed = self.signals.get(&name) != Some(&value);
                        if changed {
                            self.signals.insert(name.clone(), value.clone());
                            self.trace.record(&name, self.time, value);
                            any_changed = true;
                        }
                    }
                }
            }
        }

        // Execute comb blocks for instances
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                if self.execute_module_comb_blocks(&inst_module, &inst_prefix) {
                    any_changed = true;
                }
            }
        }

        any_changed
    }

    /// Execute a statement
    fn execute_statement(&self, stmt: &Statement, prefix: &str) -> Option<(String, SignalValue)> {
        match stmt {
            Statement::Assign { target, value } => {
                // Create evaluator with hierarchical signal resolution
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let Ok(val) = evaluator.eval(value) {
                    let name = self.make_signal_name(prefix, target);
                    return Some((name, val));
                }
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let Ok(cond_val) = evaluator.eval(condition) {
                    let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                    let branch = if is_true {
                        then_branch
                    } else {
                        else_branch.as_ref()?
                    };
                    for s in branch {
                        if let Some(result) = self.execute_statement(s, prefix) {
                            return Some(result);
                        }
                    }
                }
            }
            _ => {}
        }
        None
    }

    /// Get current time
    pub fn get_time(&self) -> SimTime {
        self.time
    }

    /// Get trace
    pub fn get_trace(&self) -> &SignalTrace {
        &self.trace
    }
}

/// Hierarchical evaluator that resolves instance.signal references
struct HierarchicalEvaluator<'a> {
    signals: &'a HashMap<String, SignalValue>,
    prefix: &'a str,
}

impl<'a> HierarchicalEvaluator<'a> {
    fn new(signals: &'a HashMap<String, SignalValue>, prefix: &'a str) -> Self {
        Self { signals, prefix }
    }

    fn resolve_signal(&self, name: &str) -> Option<&SignalValue> {
        // First try with prefix (local signal)
        let prefixed = if self.prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}.{}", self.prefix, name)
        };

        if let Some(val) = self.signals.get(&prefixed) {
            return Some(val);
        }

        // Try as-is (might be hierarchical reference like "dut.count")
        if let Some(val) = self.signals.get(name) {
            return Some(val);
        }

        // Try combining prefix with hierarchical name
        if self.prefix.is_empty() {
            self.signals.get(name)
        } else {
            // For "dut.count" in module with prefix "", look for "dut.count"
            self.signals.get(name)
        }
    }

    fn eval(&self, expr: &Expression) -> Result<SignalValue, super::eval::EvalError> {
        use crate::parser::BinOp;

        match expr {
            Expression::Literal(lit) => {
                let width = lit.width().unwrap_or(32);
                Ok(SignalValue::from_u64(lit.to_u64(), width))
            }
            Expression::Ident(name) => {
                self.resolve_signal(name)
                    .cloned()
                    .ok_or_else(|| super::eval::EvalError::UndefinedSignal(name.clone()))
            }
            Expression::BinOp { op, lhs, rhs } => {
                let l = self.eval(lhs)?;
                let r = self.eval(rhs)?;
                let lv = l.to_u64().unwrap_or(0);
                let rv = r.to_u64().unwrap_or(0);
                let width = l.width().max(r.width());

                let result = match op {
                    BinOp::Add => lv.wrapping_add(rv),
                    BinOp::Sub => lv.wrapping_sub(rv),
                    BinOp::Mul => lv.wrapping_mul(rv),
                    BinOp::Div => {
                        if rv != 0 {
                            lv / rv
                        } else {
                            0
                        }
                    }
                    BinOp::Mod => {
                        if rv != 0 {
                            lv % rv
                        } else {
                            0
                        }
                    }
                    BinOp::And => lv & rv,
                    BinOp::Or => lv | rv,
                    BinOp::Xor => lv ^ rv,
                    BinOp::Shl => lv << (rv as u32),
                    BinOp::Shr => lv >> (rv as u32),
                    BinOp::Eq => {
                        if lv == rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::Ne => {
                        if lv != rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::Lt => {
                        if lv < rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::Le => {
                        if lv <= rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::Gt => {
                        if lv > rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::Ge => {
                        if lv >= rv {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::LogicalAnd => {
                        if lv != 0 && rv != 0 {
                            1
                        } else {
                            0
                        }
                    }
                    BinOp::LogicalOr => {
                        if lv != 0 || rv != 0 {
                            1
                        } else {
                            0
                        }
                    }
                };

                Ok(SignalValue::from_u64(result, width))
            }
            Expression::UnaryOp { op, expr } => {
                use crate::parser::UnaryOp;
                let val = self.eval(expr)?;
                let v = val.to_u64().unwrap_or(0);
                let width = val.width();

                let result = match op {
                    UnaryOp::Not => !v,
                    UnaryOp::Neg => (-(v as i64)) as u64,
                    UnaryOp::LogNot => {
                        if v == 0 {
                            1
                        } else {
                            0
                        }
                    }
                };

                Ok(SignalValue::from_u64(result, width))
            }
            Expression::MethodCall { receiver, method, args: _ } => {
                // Handle dut.count style references
                if let Expression::Ident(inst_name) = receiver.as_ref() {
                    let full_name = format!("{}.{}", inst_name, method);
                    self.resolve_signal(&full_name)
                        .cloned()
                        .ok_or_else(|| super::eval::EvalError::UndefinedSignal(full_name))
                } else {
                    Err(super::eval::EvalError::UndefinedSignal("method call".to_string()))
                }
            }
            Expression::If { condition, then_expr, else_expr } => {
                let cond = self.eval(condition)?;
                let is_true = cond.to_u64().map(|v| v != 0).unwrap_or(false);
                if is_true {
                    self.eval(then_expr)
                } else {
                    self.eval(else_expr)
                }
            }
            _ => Err(super::eval::EvalError::InvalidOperation("Unsupported expression".to_string())),
        }
    }
}
