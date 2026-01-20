//! Simulation engine
//!
//! Main simulation engine that executes IRIS modules.

use std::collections::HashMap;

use crate::parser::{LogicBlock, Module, ResetMode, Statement};
use crate::types::{SignalValue, SimTime};

use super::eval::Evaluator;
use super::trace::SignalTrace;

/// Simulation engine
pub struct Simulator {
    /// The module being simulated
    module: Module,
    /// Current signal values
    signals: HashMap<String, SignalValue>,
    /// Current simulation time (in picoseconds)
    time: SimTime,
    /// Clock period (in picoseconds)
    clock_period: SimTime,
    /// Signal trace for waveform output
    trace: SignalTrace,
    /// Reset signal name
    reset_signal: Option<String>,
    /// Reset is active
    reset_active: bool,
}

impl Simulator {
    /// Create a new simulator for the given module
    pub fn new(module: Module) -> Self {
        let mut sim = Self {
            module,
            signals: HashMap::new(),
            time: 0,
            clock_period: 10_000, // Default: 10ns
            trace: SignalTrace::new(),
            reset_signal: None,
            reset_active: false,
        };
        sim.initialize();
        sim
    }

    /// Set clock period in picoseconds
    pub fn set_clock_period(&mut self, period: SimTime) {
        self.clock_period = period;
    }

    /// Initialize all signals
    fn initialize(&mut self) {
        // Initialize ports
        for port in &self.module.ports {
            let width = port.ty.width().unwrap_or(1);
            let value = SignalValue::new(width);
            self.signals.insert(port.name.clone(), value.clone());
            self.trace.record(&port.name, 0, value);

            // Track reset signal
            if matches!(port.ty, crate::parser::Type::Reset { .. }) {
                self.reset_signal = Some(port.name.clone());
            }
        }

        // Initialize internal signals
        for signal in &self.module.signals {
            let width = signal.ty.width().unwrap_or(1);
            let value = if let Some(ref init) = signal.init_value {
                // Evaluate initial value
                let evaluator = Evaluator::new(&self.signals);
                evaluator.eval(init).unwrap_or_else(|_| SignalValue::new(width))
            } else {
                SignalValue::new(width)
            };
            self.signals.insert(signal.name.clone(), value.clone());
            self.trace.record(&signal.name, 0, value);
        }
    }

    /// Assert reset
    pub fn assert_reset(&mut self) {
        if let Some(ref rst) = self.reset_signal {
            self.signals.insert(rst.clone(), SignalValue::from_u64(1, 1));
            self.trace
                .record(rst, self.time, SignalValue::from_u64(1, 1));
        }
        self.reset_active = true;
        self.apply_reset();
    }

    /// Deassert reset
    pub fn deassert_reset(&mut self) {
        if let Some(ref rst) = self.reset_signal {
            self.signals.insert(rst.clone(), SignalValue::from_u64(0, 1));
            self.trace
                .record(rst, self.time, SignalValue::from_u64(0, 1));
        }
        self.reset_active = false;
    }

    /// Apply reset values to all registers
    fn apply_reset(&mut self) {
        for signal in &self.module.signals {
            if signal.is_var || signal.is_mutable {
                if let Some(ref init) = signal.init_value {
                    let evaluator = Evaluator::new(&self.signals);
                    if let Ok(value) = evaluator.eval(init) {
                        self.signals.insert(signal.name.clone(), value.clone());
                        self.trace.record(&signal.name, self.time, value);
                    }
                }
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

    /// Run simulation for specified number of clock cycles
    pub fn run_cycles(&mut self, cycles: u64) {
        for _ in 0..cycles {
            self.step_cycle();
        }
    }

    /// Execute one clock cycle
    fn step_cycle(&mut self) {
        // Record clock rising edge
        if let Some(ref clk) = self.find_clock_signal() {
            self.signals.insert(clk.clone(), SignalValue::from_u64(1, 1));
            self.trace
                .record(clk, self.time, SignalValue::from_u64(1, 1));
        }

        // Check for async reset
        let has_async_reset = self.has_async_reset() && self.reset_active;

        if has_async_reset {
            self.apply_reset();
        } else {
            // Execute sync blocks (register updates)
            self.execute_sync_blocks();
        }

        // Execute comb blocks
        self.execute_comb_blocks();

        // Half cycle - clock falling edge
        self.time += self.clock_period / 2;
        if let Some(ref clk) = self.find_clock_signal() {
            self.signals.insert(clk.clone(), SignalValue::from_u64(0, 1));
            self.trace
                .record(clk, self.time, SignalValue::from_u64(0, 1));
        }

        // Complete the cycle
        self.time += self.clock_period / 2;
    }

    /// Find clock signal name
    fn find_clock_signal(&self) -> Option<String> {
        for port in &self.module.ports {
            if matches!(port.ty, crate::parser::Type::Clock) {
                return Some(port.name.clone());
            }
        }
        None
    }

    /// Check if module has async reset
    fn has_async_reset(&self) -> bool {
        for block in &self.module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                if let Some(ref reset) = sync.reset {
                    if matches!(reset.mode, ResetMode::Async) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Execute all sync blocks
    fn execute_sync_blocks(&mut self) {
        // Collect updates first (non-blocking semantics)
        let mut updates: Vec<(String, SignalValue)> = Vec::new();

        for block in &self.module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                // Check if sync reset and reset is active
                if let Some(ref reset) = sync.reset {
                    if matches!(reset.mode, ResetMode::Sync) && self.reset_active {
                        // Apply reset values
                        for signal in &self.module.signals {
                            if signal.is_var || signal.is_mutable {
                                if let Some(ref init) = signal.init_value {
                                    let evaluator = Evaluator::new(&self.signals);
                                    if let Ok(value) = evaluator.eval(init) {
                                        updates.push((signal.name.clone(), value));
                                    }
                                }
                            }
                        }
                        continue;
                    }
                }

                // Execute statements
                for stmt in &sync.statements {
                    if let Some((name, value)) = self.execute_statement(stmt) {
                        updates.push((name, value));
                    }
                }
            }
        }

        // Apply all updates atomically
        for (name, value) in updates {
            let changed = self.signals.get(&name) != Some(&value);
            self.signals.insert(name.clone(), value.clone());
            if changed {
                self.trace.record(&name, self.time, value);
            }
        }
    }

    /// Execute all comb blocks
    fn execute_comb_blocks(&mut self) {
        // Iterate until convergence (simple approach)
        for _ in 0..10 {
            let mut any_changed = false;

            for block in &self.module.logic_blocks {
                if let LogicBlock::Comb(comb) = block {
                    for stmt in &comb.statements {
                        if let Some((name, value)) = self.execute_statement(stmt) {
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

            if !any_changed {
                break;
            }
        }
    }

    /// Execute a single statement
    fn execute_statement(&self, stmt: &Statement) -> Option<(String, SignalValue)> {
        match stmt {
            Statement::Assign { target, value } => {
                let evaluator = Evaluator::new(&self.signals);
                if let Ok(val) = evaluator.eval(value) {
                    return Some((target.clone(), val));
                }
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let evaluator = Evaluator::new(&self.signals);
                if let Ok(cond_val) = evaluator.eval(condition) {
                    let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                    let branch = if is_true {
                        then_branch
                    } else {
                        else_branch.as_ref()?
                    };
                    for s in branch {
                        if let Some(result) = self.execute_statement(s) {
                            return Some(result);
                        }
                    }
                }
            }
            _ => {}
        }
        None
    }

    /// Get current simulation time
    pub fn get_time(&self) -> SimTime {
        self.time
    }

    /// Get signal trace
    pub fn get_trace(&self) -> &SignalTrace {
        &self.trace
    }

    /// Get mutable signal trace
    pub fn get_trace_mut(&mut self) -> &mut SignalTrace {
        &mut self.trace
    }
}
