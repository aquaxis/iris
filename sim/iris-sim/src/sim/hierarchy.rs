//! Hierarchical simulation engine
//!
//! This module provides hierarchical simulation support for multi-module designs.

use std::collections::HashMap;

use crate::parser::{
    AssertStmt, AwaitExpr, Expression, FsmAction, FsmBlock, LogicBlock, MemInit, MemReadMode,
    MemType, Module, ResetMode, SeqStatement, Span, Statement,
};
use crate::project::Project;
use crate::types::{SignalValue, SimTime};

/// Memory runtime state
#[derive(Debug, Clone)]
pub struct MemoryState {
    /// Memory name
    pub name: String,
    /// Element width in bits
    pub element_width: usize,
    /// Memory depth
    pub depth: usize,
    /// Memory contents
    pub data: Vec<SignalValue>,
    /// Read mode (sync/async)
    pub read_mode: MemReadMode,
    /// Is ROM (read-only)
    pub is_rom: bool,
    /// Registered read data (for sync read)
    pub read_data_reg: SignalValue,
}

use super::eval::Evaluator;
use super::trace::SignalTrace;

/// Metastability warning information
#[derive(Debug, Clone)]
pub struct MetastabilityWarning {
    /// Simulation time when the warning occurred
    pub time: SimTime,
    /// Module path where the warning occurred
    pub module_path: String,
    /// Clock signal name
    pub clock_signal: String,
    /// Reset signal name
    pub reset_signal: String,
    /// Clock edge type
    pub clock_edge: String,
}

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
    /// Enable metastability warnings
    warn_metastability: bool,
    /// Collected metastability warnings
    metastability_warnings: Vec<MetastabilityWarning>,
    /// Initial blocks have been executed
    initial_executed: bool,
    /// Assertion failures
    assertion_failures: Vec<AssertionFailure>,
    /// FSM current states (fsm_name -> current_state_name)
    fsm_states: HashMap<String, String>,
    /// Memory states (memory_name -> MemoryState)
    memories: HashMap<String, MemoryState>,
}

/// Assertion failure information
#[derive(Debug, Clone)]
pub struct AssertionFailure {
    /// Simulation time when the assertion failed
    pub time: SimTime,
    /// Assertion message (if provided)
    pub message: Option<String>,
    /// Condition expression (as string for display)
    pub condition: String,
    /// Source location (line, column)
    pub span: Option<Span>,
    /// Left-hand side value (for binary comparisons)
    pub lhs_value: Option<String>,
    /// Right-hand side value (for binary comparisons)
    pub rhs_value: Option<String>,
}

impl HierarchicalSimulator {
    /// Create a new hierarchical simulator
    pub fn new(project: Project) -> Self {
        Self::with_options(project, false)
    }

    /// Create a new hierarchical simulator with options
    pub fn with_options(project: Project, warn_metastability: bool) -> Self {
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
            warn_metastability,
            metastability_warnings: Vec::new(),
            initial_executed: false,
            assertion_failures: Vec::new(),
            fsm_states: HashMap::new(),
            memories: HashMap::new(),
        };
        sim.initialize();
        sim
    }

    /// Initialize all signals including instances
    fn initialize(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.initialize_module(&top, "");
            // Initialize FSMs
            self.initialize_fsms(&top);
            // Initialize memories
            self.initialize_memories(&top);
        }

        // For test mode, initialize clock and reset
        if self.is_test_mode {
            self.initialize_test_signals();
        }
    }

    /// Initialize memories
    fn initialize_memories(&mut self, module: &Module) {
        for mem in &module.memories {
            let element_width = mem.element_type.width().unwrap_or(8);
            let depth = mem.depth;

            // Determine read mode (default: async)
            let read_mode = mem.config.read_mode.unwrap_or(MemReadMode::Async);

            // Determine if ROM
            let is_rom = mem.config.mem_type == Some(MemType::Rom);

            // Initialize memory contents
            let mut data: Vec<SignalValue> = Vec::with_capacity(depth);

            // Apply initialization if provided
            match &mem.init {
                Some(MemInit::Values(values)) => {
                    for (i, expr) in values.iter().enumerate() {
                        if i >= depth {
                            break;
                        }
                        let evaluator = Evaluator::new(&self.signals);
                        let val = evaluator
                            .eval(expr)
                            .unwrap_or_else(|_| SignalValue::new(element_width));
                        data.push(val);
                    }
                    // Fill remaining with zeros
                    while data.len() < depth {
                        data.push(SignalValue::new(element_width));
                    }
                }
                Some(MemInit::File(path)) => {
                    // Try to load from file
                    if let Ok(content) = std::fs::read_to_string(path) {
                        for (i, line) in content.lines().enumerate() {
                            if i >= depth {
                                break;
                            }
                            let line = line.trim();
                            if line.is_empty() || line.starts_with("//") {
                                continue;
                            }
                            // Try to parse as hex (default) or binary
                            let val = if let Ok(v) = u64::from_str_radix(line, 16) {
                                SignalValue::from_u64(v, element_width)
                            } else if let Ok(v) = u64::from_str_radix(line, 2) {
                                SignalValue::from_u64(v, element_width)
                            } else {
                                SignalValue::new(element_width)
                            };
                            data.push(val);
                        }
                    }
                    // Fill remaining with zeros
                    while data.len() < depth {
                        data.push(SignalValue::new(element_width));
                    }
                }
                None => {
                    // Initialize all to zero
                    for _ in 0..depth {
                        data.push(SignalValue::new(element_width));
                    }
                }
            }

            let state = MemoryState {
                name: mem.name.clone(),
                element_width,
                depth,
                data,
                read_mode,
                is_rom,
                read_data_reg: SignalValue::new(element_width),
            };

            self.memories.insert(mem.name.clone(), state);

            // Create signals for memory read data
            let read_data_signal = format!("{}_rdata", mem.name);
            self.signals
                .insert(read_data_signal.clone(), SignalValue::new(element_width));
            self.trace
                .record(&read_data_signal, 0, SignalValue::new(element_width));
        }
    }

    /// Read from memory
    pub fn memory_read(&self, mem_name: &str, addr: usize) -> Option<SignalValue> {
        if let Some(mem) = self.memories.get(mem_name) {
            if addr < mem.depth {
                return Some(mem.data[addr].clone());
            }
        }
        None
    }

    /// Write to memory (returns false if ROM or out of bounds)
    pub fn memory_write(&mut self, mem_name: &str, addr: usize, value: SignalValue) -> bool {
        if let Some(mem) = self.memories.get_mut(mem_name) {
            if mem.is_rom {
                return false; // Cannot write to ROM
            }
            if addr < mem.depth {
                mem.data[addr] = value;
                return true;
            }
        }
        false
    }

    /// Get memory state
    pub fn get_memory(&self, name: &str) -> Option<&MemoryState> {
        self.memories.get(name)
    }

    /// Initialize FSMs to their first state
    fn initialize_fsms(&mut self, module: &Module) {
        for fsm in &module.fsm_blocks {
            // Set initial state to the first state in the enum
            if let Some(first_state) = fsm.states.first() {
                self.fsm_states.insert(fsm.name.clone(), first_state.name.clone());

                // Create a signal to track the FSM state (useful for debugging)
                let state_signal_name = format!("{}_state", fsm.name);
                // Encode state as index
                let state_index = 0u64;
                let width = (fsm.states.len() as f64).log2().ceil().max(1.0) as usize;
                let value = SignalValue::from_u64(state_index, width);
                self.signals.insert(state_signal_name.clone(), value.clone());
                self.trace.record(&state_signal_name, 0, value);

                // Apply initial Moore outputs
                self.apply_moore_outputs(fsm, &first_state.name);
            }
        }
    }

    /// Apply Moore outputs for a given state
    fn apply_moore_outputs(&mut self, fsm: &FsmBlock, state_name: &str) {
        // Find the state
        if let Some(state) = fsm.states.iter().find(|s| s.name == state_name) {
            for (output_name, value_expr) in &state.moore_outputs {
                let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                if let Ok(val) = evaluator.eval(value_expr) {
                    let changed = self.signals.get(output_name) != Some(&val);
                    self.signals.insert(output_name.clone(), val.clone());
                    if changed {
                        self.trace.record(output_name, self.time, val);
                    }
                }
            }
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
        // Check for metastability before deasserting
        if self.warn_metastability && self.reset_active {
            self.check_and_record_metastability_warning();
        }

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
        // Execute initial blocks once after reset is deasserted
        if !self.initial_executed && !self.reset_active {
            self.execute_initial_blocks();
            self.initial_executed = true;
        }

        for _ in 0..cycles {
            self.step_cycle();

            // Execute initial blocks after reset is deasserted (if not yet done)
            if !self.initial_executed && !self.reset_active {
                self.execute_initial_blocks();
                self.initial_executed = true;
            }
        }
    }

    /// Execute all initial blocks and seq blocks
    fn execute_initial_blocks(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            // Execute initial blocks first
            for initial in &top.initial_blocks {
                for stmt in &initial.statements {
                    self.execute_seq_statement(stmt, "");
                }
            }

            // Execute seq blocks (testbench sequential code)
            for seq_block in &top.seq_blocks {
                for stmt in &seq_block.statements {
                    self.execute_seq_statement(stmt, "");
                }
            }
        }
    }

    /// Execute a sequential statement
    fn execute_seq_statement(&mut self, stmt: &SeqStatement, prefix: &str) {
        match stmt {
            SeqStatement::Assign { target, value } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let Ok(val) = evaluator.eval(value) {
                    let name = self.make_signal_name(prefix, target);
                    let changed = self.signals.get(&name) != Some(&val);
                    self.signals.insert(name.clone(), val.clone());
                    if changed {
                        self.trace.record(&name, self.time, val);
                    }
                }
            }
            SeqStatement::SignalWrite { path, value } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let Ok(val) = evaluator.eval(value) {
                    let name = path.to_string();
                    let changed = self.signals.get(&name) != Some(&val);
                    self.signals.insert(name.clone(), val.clone());
                    if changed {
                        self.trace.record(&name, self.time, val);
                    }
                }
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let Ok(cond_val) = evaluator.eval(condition) {
                    let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                    let branch = if is_true {
                        then_branch
                    } else if let Some(else_b) = else_branch {
                        else_b
                    } else {
                        return;
                    };
                    for s in branch {
                        self.execute_seq_statement(s, prefix);
                    }
                }
            }
            SeqStatement::Assert(assert_stmt) => {
                self.execute_assert(assert_stmt, prefix);
            }
            SeqStatement::Delay(duration) => {
                // Advance simulation time
                let ps = duration.to_picoseconds();
                self.time += ps;
            }
            SeqStatement::Await(await_expr) => {
                // For now, await just advances by the appropriate amount
                self.execute_await(await_expr, prefix);
            }
            SeqStatement::MemWrite {
                mem_name,
                addr,
                value,
            } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let (Ok(addr_val), Ok(data_val)) = (evaluator.eval(addr), evaluator.eval(value))
                {
                    let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                    self.memory_write(mem_name, addr_usize, data_val);
                }
            }
            SeqStatement::For { var, range, body } => {
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let (Ok(start_val), Ok(end_val)) =
                    (evaluator.eval(&range.start), evaluator.eval(&range.end))
                {
                    let start = start_val.to_u64().unwrap_or(0) as i64;
                    let end = end_val.to_u64().unwrap_or(0) as i64;
                    let end = if range.inclusive { end + 1 } else { end };

                    for i in start..end {
                        // Set loop variable in signals
                        let var_name = self.make_signal_name(prefix, var);
                        self.signals
                            .insert(var_name.clone(), SignalValue::from_u64(i as u64, 32));

                        // Execute body
                        for stmt in body {
                            self.execute_seq_statement(stmt, prefix);
                        }
                    }
                }
            }
            SeqStatement::While { condition, body } => {
                const MAX_ITERATIONS: usize = 100000; // Prevent infinite loops
                let mut iterations = 0;

                loop {
                    if iterations >= MAX_ITERATIONS {
                        eprintln!(
                            "Warning: While loop exceeded {} iterations, breaking",
                            MAX_ITERATIONS
                        );
                        break;
                    }

                    let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                    match evaluator.eval(condition) {
                        Ok(cond_val) => {
                            let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                            if !is_true {
                                break;
                            }
                        }
                        Err(_) => break,
                    }

                    // Execute body
                    for stmt in body {
                        self.execute_seq_statement(stmt, prefix);
                    }

                    iterations += 1;
                }
            }
        }
    }

    /// Execute an assert statement
    fn execute_assert(&mut self, assert_stmt: &AssertStmt, prefix: &str) {
        let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
        if let Ok(cond_val) = evaluator.eval(&assert_stmt.condition) {
            let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
            if !is_true {
                // Extract lhs/rhs values for binary comparison expressions
                let (lhs_value, rhs_value) = match &assert_stmt.condition {
                    Expression::BinOp { lhs, rhs, .. } => {
                        let lhs_val = evaluator.eval(lhs).ok().and_then(|v| {
                            v.to_u64().map(|val| format!("0x{:x} ({})", val, val))
                        });
                        let rhs_val = evaluator.eval(rhs).ok().and_then(|v| {
                            v.to_u64().map(|val| format!("0x{:x} ({})", val, val))
                        });
                        (lhs_val, rhs_val)
                    }
                    _ => (None, None),
                };

                let failure = AssertionFailure {
                    time: self.time,
                    message: assert_stmt.message.clone(),
                    condition: format!("{}", assert_stmt.condition),
                    span: assert_stmt.span.clone(),
                    lhs_value,
                    rhs_value,
                };
                self.assertion_failures.push(failure);
            }
        }
    }

    /// Execute an await expression
    fn execute_await(&mut self, await_expr: &AwaitExpr, _prefix: &str) {
        match await_expr {
            AwaitExpr::ClockEdge { signal: _, edge: _ } => {
                // Wait for one clock cycle
                self.time += self.clock_period;
            }
            AwaitExpr::ClockCycles { signal: _, count } => {
                // Evaluate the count expression
                let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                if let Ok(count_val) = evaluator.eval(count) {
                    let cycles = count_val.to_u64().unwrap_or(1);
                    self.time += self.clock_period * cycles;
                }
            }
            AwaitExpr::Until { condition, timeout } => {
                // Simple implementation: check condition, advance time if not met
                let max_time = timeout
                    .as_ref()
                    .map(|d| d.to_picoseconds())
                    .unwrap_or(self.clock_period * 1000); // Default timeout: 1000 cycles
                let start_time = self.time;

                while self.time - start_time < max_time {
                    let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                    if let Ok(cond_val) = evaluator.eval(condition) {
                        if cond_val.to_u64().map(|v| v != 0).unwrap_or(false) {
                            return; // Condition met
                        }
                    }
                    self.time += self.clock_period;
                }
                // Timeout reached
            }
        }
    }

    /// Get assertion failures
    pub fn get_assertion_failures(&self) -> &[AssertionFailure] {
        &self.assertion_failures
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
            // Reset FSMs to initial state
            self.reset_fsms();
        } else {
            // Execute sync blocks for all modules
            self.execute_all_sync_blocks();
            // Execute FSM transitions
            self.execute_fsms();
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

    /// Reset all FSMs to their initial state
    fn reset_fsms(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            for fsm in &top.fsm_blocks {
                if let Some(first_state) = fsm.states.first() {
                    self.fsm_states.insert(fsm.name.clone(), first_state.name.clone());

                    // Update state signal
                    let state_signal_name = format!("{}_state", fsm.name);
                    let width = (fsm.states.len() as f64).log2().ceil().max(1.0) as usize;
                    let value = SignalValue::from_u64(0, width);
                    let changed = self.signals.get(&state_signal_name) != Some(&value);
                    self.signals.insert(state_signal_name.clone(), value.clone());
                    if changed {
                        self.trace.record(&state_signal_name, self.time, value);
                    }

                    // Apply initial Moore outputs
                    self.apply_moore_outputs(&fsm, &first_state.name);
                }
            }
        }
    }

    /// Execute FSM transitions
    fn execute_fsms(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            for fsm in &top.fsm_blocks {
                self.execute_fsm(&fsm);
            }
        }
    }

    /// Execute a single FSM
    fn execute_fsm(&mut self, fsm: &FsmBlock) {
        let current_state = match self.fsm_states.get(&fsm.name) {
            Some(s) => s.clone(),
            None => return,
        };

        // Find transition for current state
        let mut next_state = current_state.clone();
        let mut found_transition = false;

        for transition in &fsm.transitions {
            // Check if this transition applies to current state
            if transition.from_state == current_state || transition.from_state == "_" {
                // Evaluate when clauses
                for when_clause in &transition.when_clauses {
                    let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                    if let Ok(cond_val) = evaluator.eval(&when_clause.condition) {
                        let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                        if is_true {
                            // Execute actions
                            for action in &when_clause.actions {
                                match action {
                                    FsmAction::Goto(state) => {
                                        next_state = state.clone();
                                        found_transition = true;
                                    }
                                    FsmAction::Assign { target, value } => {
                                        let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                                        if let Ok(val) = evaluator.eval(value) {
                                            let changed = self.signals.get(target) != Some(&val);
                                            self.signals.insert(target.clone(), val.clone());
                                            if changed {
                                                self.trace.record(target, self.time, val);
                                            }
                                        }
                                    }
                                }
                            }
                            break; // First matching when clause wins
                        }
                    }
                }

                if found_transition {
                    break; // First matching transition wins
                }
            }
        }

        // Update state if changed
        if next_state != current_state {
            self.fsm_states.insert(fsm.name.clone(), next_state.clone());

            // Update state signal
            let state_signal_name = format!("{}_state", fsm.name);
            let state_index = fsm.states.iter()
                .position(|s| s.name == next_state)
                .unwrap_or(0) as u64;
            let width = (fsm.states.len() as f64).log2().ceil().max(1.0) as usize;
            let value = SignalValue::from_u64(state_index, width);
            let changed = self.signals.get(&state_signal_name) != Some(&value);
            self.signals.insert(state_signal_name.clone(), value.clone());
            if changed {
                self.trace.record(&state_signal_name, self.time, value);
            }

            // Apply Moore outputs for new state
            self.apply_moore_outputs(fsm, &next_state);
        }

        // Apply Mealy outputs (output blocks)
        for output in &fsm.outputs {
            let current_state = self.fsm_states.get(&fsm.name).cloned().unwrap_or_default();
            for (state_name, value_expr) in &output.mappings {
                if state_name == &current_state {
                    let evaluator = HierarchicalEvaluator::new(&self.signals, "");
                    if let Ok(val) = evaluator.eval(value_expr) {
                        let changed = self.signals.get(&output.signal) != Some(&val);
                        self.signals.insert(output.signal.clone(), val.clone());
                        if changed {
                            self.trace.record(&output.signal, self.time, val);
                        }
                    }
                    break;
                }
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
            Statement::For { var: _, range, body } => {
                // For comb/sync blocks, for loops are unrolled at compile time
                // The range must be known at compile time
                let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                if let (Ok(start_val), Ok(end_val)) =
                    (evaluator.eval(&range.start), evaluator.eval(&range.end))
                {
                    let start = start_val.to_u64().unwrap_or(0) as i64;
                    let end = end_val.to_u64().unwrap_or(0) as i64;
                    let end = if range.inclusive { end + 1 } else { end };

                    for _i in start..end {
                        for stmt in body {
                            if let Some(result) = self.execute_statement(stmt, prefix) {
                                return Some(result);
                            }
                        }
                    }
                }
            }
            Statement::While { condition, body } => {
                // For comb/sync blocks, while loops need careful handling
                const MAX_ITERATIONS: usize = 1000;
                let mut iterations = 0;

                loop {
                    if iterations >= MAX_ITERATIONS {
                        break;
                    }

                    let evaluator = HierarchicalEvaluator::new(&self.signals, prefix);
                    match evaluator.eval(condition) {
                        Ok(cond_val) => {
                            let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                            if !is_true {
                                break;
                            }
                        }
                        Err(_) => break,
                    }

                    for stmt in body {
                        if let Some(result) = self.execute_statement(stmt, prefix) {
                            return Some(result);
                        }
                    }

                    iterations += 1;
                }
            }
            Statement::Match { .. } => {
                // Match is already handled via pattern matching in other contexts
            }
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

    /// Check and record metastability warning for async reset blocks
    fn check_and_record_metastability_warning(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.check_module_metastability(&top, "");
        }
    }

    /// Check a module and its instances for async reset usage
    fn check_module_metastability(&mut self, module: &Module, prefix: &str) {
        for block in &module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                if let Some(ref reset) = sync.reset {
                    if matches!(reset.mode, ResetMode::Async) {
                        let module_path = if prefix.is_empty() {
                            module.name.clone()
                        } else {
                            format!("{}.{}", prefix, module.name)
                        };

                        let warning = MetastabilityWarning {
                            time: self.time,
                            module_path,
                            clock_signal: sync.clock.signal.clone(),
                            reset_signal: reset.signal.clone(),
                            clock_edge: format!("{}", sync.clock.edge),
                        };
                        self.metastability_warnings.push(warning);
                    }
                }
            }
        }

        // Check instances recursively
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.check_module_metastability(&inst_module, &inst_prefix);
            }
        }
    }

    /// Get collected metastability warnings
    pub fn get_metastability_warnings(&self) -> &[MetastabilityWarning] {
        &self.metastability_warnings
    }
}

/// Hierarchical evaluator that resolves instance.signal references
struct HierarchicalEvaluator<'a> {
    signals: &'a HashMap<String, SignalValue>,
    prefix: &'a str,
    memories: Option<&'a HashMap<String, MemoryState>>,
}

impl<'a> HierarchicalEvaluator<'a> {
    fn new(signals: &'a HashMap<String, SignalValue>, prefix: &'a str) -> Self {
        Self {
            signals,
            prefix,
            memories: None,
        }
    }

    fn with_memories(
        signals: &'a HashMap<String, SignalValue>,
        prefix: &'a str,
        memories: &'a HashMap<String, MemoryState>,
    ) -> Self {
        Self {
            signals,
            prefix,
            memories: Some(memories),
        }
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
            Expression::MemRead { mem_name, addr } => {
                if let Some(memories) = self.memories {
                    let addr_val = self.eval(addr)?;
                    let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                    if let Some(mem) = memories.get(mem_name) {
                        if addr_usize < mem.depth {
                            return Ok(mem.data[addr_usize].clone());
                        }
                    }
                }
                Err(super::eval::EvalError::UndefinedSignal(format!(
                    "memory read {}",
                    mem_name
                )))
            }
            _ => Err(super::eval::EvalError::InvalidOperation("Unsupported expression".to_string())),
        }
    }
}
