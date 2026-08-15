//! Hierarchical simulation engine
//!
//! This module provides hierarchical simulation support for multi-module designs,
//! including multi-clock domain support.

use std::collections::HashMap;

use crate::parser::{
    AssertSeverity, AssertStmt, AwaitExpr, ClockEdge, Expression, FsmAction, FsmBlock, LogicBlock, MemInit,
    MemReadMode, MemType, Module, ResetMode, SeqStatement, Span, Statement,
};
use crate::project::Project;
use crate::types::{SignalValue, SimTime};

/// What a `break` or `continue` asks the enclosing loop to do
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoopControl {
    Break,
    Continue,
}

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

/// Clock signal information for multi-clock simulation
#[derive(Debug, Clone)]
pub struct ClockInfo {
    /// Signal name
    pub name: String,
    /// Clock period in picoseconds
    pub period: SimTime,
    /// Current phase value (0 or 1)
    pub current_value: u64,
    /// Time of next scheduled edge (in picoseconds)
    pub next_edge_time: SimTime,
}

/// Reset signal information
#[derive(Debug, Clone)]
pub struct ResetInfo {
    /// Signal name
    pub name: String,
    /// Whether reset is active-low
    pub active_low: bool,
}

/// Instance runtime state
#[derive(Debug)]
struct InstanceState {
    /// Module name (type)
    module_name: String,
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
    /// Primary clock period (for cycle-based API compatibility)
    clock_period: SimTime,
    /// Signal trace
    trace: SignalTrace,
    /// Record every memory element as its own waveform signal
    dump_arrays: bool,
    /// All reset signals with their active-low configuration
    reset_signals: Vec<ResetInfo>,
    /// All clock signals with their period information
    clock_signals: Vec<ClockInfo>,
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
    /// Expressions the evaluator could not evaluate.
    ///
    /// An assignment whose right-hand side fails to evaluate used to be skipped
    /// in silence, leaving the target at whatever it already held — usually
    /// zero. That turned an unsupported construct into a wrong number with no
    /// way to notice. Every failure is recorded here instead.
    eval_failures: Vec<String>,
    /// Initial blocks have been executed
    initial_executed: bool,
    /// Sequential blocks, flattened so that `await` can suspend them
    seq_program: Vec<super::seq::SeqInstr>,
    /// Where the sequential program will resume
    seq_pc: usize,
    /// What the sequential program is waiting for
    seq_wait: super::seq::SeqWait,
    /// When an `await until(...)` gives up
    seq_deadline: Option<SimTime>,
    /// A `break` or `continue` waiting to be acted on by the enclosing loop
    loop_control: Option<LoopControl>,
    /// Coverage points, in declaration order, with how often each held
    coverage: Vec<(String, u64)>,
    /// The generator `$randomize` draws from
    rng: iris_runtime::random::Rng,
    /// Assertion failures
    assertion_failures: Vec<AssertionFailure>,
    /// FSM current states (fsm_name -> current_state_name)
    fsm_states: HashMap<String, String>,
    /// Memory states (memory_name -> MemoryState)
    memories: HashMap<String, MemoryState>,
    /// Set by `$finish`; stops the run loop
    finished: bool,
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
    /// How the violation should be reported
    pub severity: AssertSeverity,
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
            dump_arrays: false,
            reset_signals: Vec::new(),
            clock_signals: Vec::new(),
            reset_active: false,
            is_test_mode,
            reset_duration: 5, // Default: 5 cycles reset
            cycle_count: 0,
            warn_metastability,
            metastability_warnings: Vec::new(),
            eval_failures: Vec::new(),
            initial_executed: false,
            seq_program: Vec::new(),
            seq_pc: 0,
            seq_wait: super::seq::SeqWait::Ready,
            seq_deadline: None,
            loop_control: None,
            coverage: Vec::new(),
            rng: iris_runtime::random::Rng::default(),
            assertion_failures: Vec::new(),
            fsm_states: HashMap::new(),
            memories: HashMap::new(),
            finished: false,
        };
        sim.initialize();
        sim
    }

    /// Initialize all signals including instances
    fn initialize(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            // `initial` blocks run before `seq` blocks, as one program
            let mut statements = Vec::new();
            for block in &top.initial_blocks {
                statements.extend(block.statements.iter().cloned());
            }
            for block in &top.seq_blocks {
                statements.extend(block.statements.iter().cloned());
            }
            self.seq_program = super::seq::compile(&statements);
            if self.seq_program.is_empty() {
                self.seq_wait = super::seq::SeqWait::Done;
            }
            self.initialize_module(&top, "");
            // Every coverage point is listed, whether or not it is ever reached
            self.register_cover_points(&top);
            // Initialize FSMs
            self.initialize_fsms(&top, "");
            // Initialize memories of the top module and of every instance below it
            self.initialize_memories(&top, "");
            // A `let` written without a type takes its width from the
            // initialiser. That cannot be known while the signals are still
            // being created, so it is settled once they all exist.
            self.widen_inferred_signals(&top, "");
        }

        // For test mode, initialize clock and reset
        if self.is_test_mode {
            self.initialize_test_signals();
        } else {
            self.initialize_port_resets();
        }
    }

    /// Record every memory element as its own waveform signal.
    ///
    /// Off by default: a 1024-word memory adds 1024 signals to the waveform,
    /// which is a large change for anyone who only wanted the ports.
    pub fn set_dump_arrays(&mut self, dump_arrays: bool) {
        self.dump_arrays = dump_arrays;
        if !dump_arrays {
            return;
        }

        // Memories are filled in during construction, before this can be
        // called, so the starting contents are recorded here. Without this
        // only the addresses the design happens to write would ever appear.
        //
        // Elements are named by bare index, giving `core.dmem.3`. A viewer
        // reads brackets in a VCD reference as an index annotation rather
        // than part of the name, and then lists no variable at all, so
        // `[3]` would put the elements in the file but leave them
        // unreachable.
        //
        // Names are sorted because a HashMap does not iterate in a stable
        // order, and an unstable order would give the same design different
        // identifiers on different runs.
        let mut snapshot: Vec<(String, Vec<SignalValue>)> = self
            .memories
            .iter()
            .map(|(name, mem)| (name.clone(), mem.data.clone()))
            .collect();
        snapshot.sort_by(|a, b| a.0.cmp(&b.0));

        for (name, data) in snapshot {
            for (index, element) in data.iter().enumerate() {
                let element_name = format!("{}.{}", name, index);
                self.trace.record(&element_name, 0, element.clone());
            }
        }
    }

    /// Initialize memories of a module and, recursively, of its instances
    fn initialize_memories(&mut self, module: &Module, prefix: &str) {
        for mem in &module.memories {
            let mem_path = self.make_signal_name(prefix, &mem.name);
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
                name: mem_path.clone(),
                element_width,
                depth,
                data,
                read_mode,
                is_rom,
                read_data_reg: SignalValue::new(element_width),
            };

            self.memories.insert(mem_path.clone(), state);

            // Create signals for memory read data
            let read_data_signal = format!("{}_rdata", mem_path);
            self.signals
                .insert(read_data_signal.clone(), SignalValue::new(element_width));
            self.trace
                .record(&read_data_signal, 0, SignalValue::new(element_width));
        }

        for inst in &module.instances {
            let inst_prefix = self.make_signal_name(prefix, &inst.name);
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.initialize_memories(&inst_module, &inst_prefix);
            }
        }
    }

    /// Resolve a memory name written inside a module body to its hierarchical path
    fn resolve_mem_name(&self, prefix: &str, name: &str) -> Option<String> {
        let prefixed = self.make_signal_name(prefix, name);
        if self.memories.contains_key(&prefixed) {
            return Some(prefixed);
        }
        if self.memories.contains_key(name) {
            return Some(name.to_string());
        }
        None
    }

    /// Clear every word of a memory (used by reset)
    fn memory_clear(&mut self, mem_name: &str) {
        if let Some(mem) = self.memories.get_mut(mem_name) {
            if mem.is_rom {
                return;
            }
            let width = mem.element_width;
            for word in mem.data.iter_mut() {
                *word = SignalValue::new(width);
            }
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
        let mut written = None;
        if let Some(mem) = self.memories.get_mut(mem_name) {
            if mem.is_rom {
                return false; // Cannot write to ROM
            }
            if addr < mem.depth {
                mem.data[addr] = value.clone();
                written = Some(value);
            }
        }

        let Some(value) = written else {
            return false;
        };
        if self.dump_arrays {
            let element_name = format!("{}.{}", mem_name, addr);
            let time = self.time;
            self.trace.record(&element_name, time, value);
        }
        true
    }

    /// Get memory state
    pub fn get_memory(&self, name: &str) -> Option<&MemoryState> {
        self.memories.get(name)
    }

    /// Initialize the FSMs of a module and, recursively, of its instances
    fn initialize_fsms(&mut self, module: &Module, prefix: &str) {
        for fsm in &module.fsm_blocks {
            let Some((index, state_name)) = Self::fsm_initial_state(fsm) else {
                continue;
            };
            // Keyed by hierarchical path, so two instances of the same module
            // keep separate state
            let path = self.make_signal_name(prefix, &fsm.name);
            self.fsm_states.insert(path.clone(), state_name.clone());

            // Signals declared inside the FSM body live alongside the module's
            for local in &fsm.locals {
                // A signal declared in an FSM body belongs to that FSM, not to
                // the module, so two FSMs may each declare a `count`
                let name = format!("{}.{}", path, local.name);
                let width = local.ty.width().unwrap_or(1);
                let value = SignalValue::new(width);
                self.signals.entry(name.clone()).or_insert_with(|| {
                    self.trace.record(&name, 0, value.clone());
                    value
                });
            }

            let state_signal_name = format!("{}_state", path);
            let value = SignalValue::from_u64(index as u64, Self::state_width(fsm));
            self.signals.insert(state_signal_name.clone(), value.clone());
            self.trace.record(&state_signal_name, 0, value);

            self.apply_moore_outputs(fsm, &state_name, prefix);
        }

        for inst in &module.instances {
            let inst_prefix = self.make_signal_name(prefix, &inst.name);
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.initialize_fsms(&inst_module, &inst_prefix);
            }
        }
    }

    /// The state an FSM starts in: the one named by `initial:`, else the first
    fn fsm_initial_state(fsm: &FsmBlock) -> Option<(usize, String)> {
        if let Some(ref named) = fsm.initial_state {
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

    /// Apply Moore outputs for a given state
    fn apply_moore_outputs(&mut self, fsm: &FsmBlock, state_name: &str, prefix: &str) {
        let Some(state) = fsm.states.iter().find(|s| s.name == state_name) else {
            return;
        };
        let fsm_path = self.make_signal_name(prefix, &fsm.name);
        let outputs = state.moore_outputs.clone();
        for (output_name, value_expr) in outputs {
            let value = {
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories)
                        .within(&fsm_path);
                evaluator.eval(&value_expr)
            };
            if let Ok(val) = value {
                let target = self.fsm_target(prefix, &fsm_path, &output_name);
                self.apply_signal_update(&target, val);
            }
        }
    }

    /// Where an assignment inside an FSM writes: its own signal if it declared
    /// one by that name, otherwise the module's
    fn fsm_target(&self, prefix: &str, fsm_path: &str, name: &str) -> String {
        let local = format!("{}.{}", fsm_path, name);
        if self.signals.contains_key(&local) {
            local
        } else {
            self.make_signal_name(prefix, name)
        }
    }

    /// Initialize clock and reset signals for test mode
    fn initialize_test_signals(&mut self) {
        // Find clock and reset signals in internal declarations
        if let Some(top) = self.project.get_module(&self.top_module) {
            for signal in &top.signals {
                match &signal.ty {
                    crate::parser::Type::Clock => {
                        let mut period = 10_000; // Default 10ns

                        // Apply clock configuration if present
                        if let Some(ref config) = signal.clock_config {
                            if let Some(ref p) = config.period {
                                // Convert period to picoseconds
                                period = p.to_picoseconds();
                            }
                        }

                        // Set primary clock period (first clock found)
                        if self.clock_signals.is_empty() {
                            self.clock_period = period;
                        }

                        let clock_info = ClockInfo {
                            name: signal.name.clone(),
                            period,
                            current_value: 0,
                            next_edge_time: period / 2, // First rising edge at half period from time 0
                        };
                        self.clock_signals.push(clock_info);

                        // Initialize clock to 0
                        self.signals.insert(signal.name.clone(), SignalValue::from_u64(0, 1));
                        self.trace.record(&signal.name, 0, SignalValue::from_u64(0, 1));
                    }
                    crate::parser::Type::Reset { active_low } => {
                        let mut is_active_low = *active_low;
                        let mut should_assert_reset = true; // Default: assert reset
                        if let Some(ref config) = signal.reset_config {
                            is_active_low = config.active_low;
                            // assert_time takes priority over assert_cycles
                            if let Some(ref duration) = config.assert_time {
                                // Convert time to cycles (ceiling division)
                                let time_ps = duration.to_picoseconds();
                                let cycles = (time_ps + self.clock_period - 1) / self.clock_period;
                                self.reset_duration = cycles;
                                if cycles == 0 {
                                    should_assert_reset = false;
                                }
                            } else if let Some(cycles) = config.assert_cycles {
                                self.reset_duration = cycles;
                                // assert_cycles: 0 means skip reset sequence
                                if cycles == 0 {
                                    should_assert_reset = false;
                                }
                            }
                        }

                        // Auto-detect active_low from signal name suffix
                        let is_active_low = is_active_low || signal.name.ends_with("_n");

                        let reset_info = ResetInfo {
                            name: signal.name.clone(),
                            active_low: is_active_low,
                        };
                        self.reset_signals.push(reset_info);

                        // Initialize reset value based on should_assert_reset
                        // For active_high: asserted = 1, deasserted = 0
                        // For active_low: asserted = 0, deasserted = 1
                        let reset_value = if should_assert_reset {
                            if is_active_low { 0 } else { 1 }
                        } else {
                            if is_active_low { 1 } else { 0 }
                        };
                        self.signals.insert(signal.name.clone(), SignalValue::from_u64(reset_value, 1));
                        self.trace.record(&signal.name, 0, SignalValue::from_u64(reset_value, 1));
                        self.reset_active = should_assert_reset;
                    }
                    _ => {}
                }
            }
        }
    }

    /// Register the reset ports of a non-test top module.
    ///
    /// Without this, `assert_reset` and `deassert_reset` have nothing to drive and an
    /// active-low reset port keeps its initial zero, holding the design in reset.
    fn initialize_port_resets(&mut self) {
        let resets: Vec<ResetInfo> = match self.project.get_module(&self.top_module) {
            Some(top) => top
                .ports
                .iter()
                .filter_map(|port| match port.ty {
                    crate::parser::Type::Reset { active_low } => Some(ResetInfo {
                        name: port.name.clone(),
                        active_low: active_low || port.name.ends_with("_n"),
                    }),
                    _ => None,
                })
                .collect(),
            None => Vec::new(),
        };

        for info in resets {
            // Start deasserted; the caller drives the reset sequence explicitly
            let value = if info.active_low { 1 } else { 0 };
            let signal = SignalValue::from_u64(value, 1);
            self.signals.insert(info.name.clone(), signal.clone());
            self.trace.record(&info.name, 0, signal);
            self.reset_signals.push(info);
        }
    }

    /// Initialize a module and its instances recursively
    /// Give every untyped `let` the width of its initialiser
    ///
    /// `let sum = a + b;` writes no type. Its width is the expression's, but
    /// the expression cannot be evaluated while the ports it names are still
    /// being created — so at that point the signal is one bit wide, and every
    /// later assignment is truncated to it. Once all the signals exist the
    /// expression evaluates, and the width can be set.
    fn widen_inferred_signals(&mut self, module: &Module, prefix: &str) {
        let assigned = Self::assigned_names(module);
        for signal in &module.signals {
            if signal.has_explicit_type || signal.is_var || signal.is_mutable {
                continue;
            }
            if assigned.contains(&signal.name) {
                continue;
            }
            let Some(ref init) = signal.init_value else {
                continue;
            };
            let evaluator =
                HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
            if let Ok(value) = evaluator.eval(init) {
                let name = self.make_signal_name(prefix, &signal.name);
                self.signals.insert(name.clone(), value.clone());
                self.trace.record(&name, 0, value);
            }
        }

        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.widen_inferred_signals(&inst_module, &inst_prefix);
            }
        }
    }

    fn initialize_module(&mut self, module: &Module, prefix: &str) {
        // Initialize ports
        for port in &module.ports {
            let name = self.make_signal_name(prefix, &port.name);
            let width = port.ty.width().unwrap_or(1);
            let value = SignalValue::new(width).with_signed(Self::is_signed_type(&port.ty));
            self.signals.insert(name.clone(), value.clone());
            self.trace.record(&name, 0, value);
        }

        // Initialize internal signals
        for signal in &module.signals {
            let name = self.make_signal_name(prefix, &signal.name);
            let declared = signal.ty.width().unwrap_or(1);
            let signed = Self::is_signed_type(&signal.ty);
            let value = if let Some(ref init) = signal.init_value {
                let evaluator = Evaluator::new(&self.signals);
                match evaluator.eval(init) {
                    // Literals evaluate to 32 bits; the declaration wins.
                    // Without a declaration the expression sets the width, so
                    // `let sum = a + b;` is as wide as the sum.
                    Ok(v) => {
                        let width = if signal.has_explicit_type {
                            declared
                        } else {
                            v.width()
                        };
                        SignalValue::from_u64(v.to_u64().unwrap_or(0), width)
                    }
                    Err(_) => SignalValue::new(declared),
                }
            } else {
                SignalValue::new(declared)
            }
            .with_signed(signed);
            self.signals.insert(name.clone(), value.clone());
            // An untyped `let` is recorded once its width is settled, so that
            // the waveform does not show a one-bit value first
            let infer_width_later = !signal.has_explicit_type && signal.init_value.is_some();
            if !infer_width_later {
                self.trace.record(&name, 0, value);
            }
        }

        // Declare block-local `let`s that carry an explicit type, so they get the
        // declared width and appear in the waveform. Untyped locals take the width
        // of their expression when first assigned.
        for block in &module.logic_blocks {
            let statements = match block {
                LogicBlock::Comb(comb) => &comb.statements,
                LogicBlock::Sync(sync) => &sync.statements,
            };
            let mut locals = Vec::new();
            Self::collect_typed_let_locals(statements, &mut locals);
            for (local_name, width) in locals {
                let name = self.make_signal_name(prefix, &local_name);
                if self.signals.contains_key(&name) {
                    continue;
                }
                let value = SignalValue::new(width);
                self.signals.insert(name.clone(), value.clone());
                self.trace.record(&name, 0, value);
            }
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
                module_name: inst.module_name.clone(),
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
        for reset_info in &self.reset_signals.clone() {
            let value = if reset_info.active_low { 0 } else { 1 };
            self.signals.insert(reset_info.name.clone(), SignalValue::from_u64(value, 1));
            self.trace.record(&reset_info.name, self.time, SignalValue::from_u64(value, 1));
        }
        // Also handle legacy single-reset case
        if self.reset_signals.is_empty() {
            // No reset signals tracked - this shouldn't happen in test mode
            // but handle gracefully
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

        for reset_info in &self.reset_signals.clone() {
            let value = if reset_info.active_low { 1 } else { 0 };
            self.signals.insert(reset_info.name.clone(), SignalValue::from_u64(value, 1));
            self.trace.record(&reset_info.name, self.time, SignalValue::from_u64(value, 1));
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
                        self.apply_signal_update(&name, value);
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

    /// Is this type read as two's complement?
    fn is_signed_type(ty: &crate::parser::Type) -> bool {
        matches!(ty, crate::parser::Type::Int { signed: true, .. })
    }

    /// Truncate or zero-extend a value to the declared width of a signal.
    ///
    /// Expression evaluation widens intermediate results (an integer literal is
    /// 32 bits wide), so the result has to be fitted to the target before it is
    /// stored. Without this, a `bit[5]` counter would keep counting past 31.
    fn coerce_to_signal_width(&self, name: &str, value: SignalValue) -> SignalValue {
        match self.signals.get(name) {
            // The declaration decides both the width and how the bits are read
            Some(existing) => {
                iris_runtime::ops::coerce(value, existing.width(), existing.is_signed())
            }
            None => value,
        }
    }

    /// Store a signal value, fitting it to the declared width and tracing changes
    fn apply_signal_update(&mut self, name: &str, value: SignalValue) -> bool {
        let value = self.coerce_to_signal_width(name, value);
        let changed = self.signals.get(name) != Some(&value);
        self.signals.insert(name.to_string(), value.clone());
        if changed {
            self.trace.record(name, self.time, value);
        }
        changed
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

    /// Check if a specific reset signal is asserted, given its name and active_low flag
    fn is_reset_asserted(&self, reset_name: &str, active_low: bool) -> bool {
        if let Some(value) = self.signals.get(reset_name) {
            if active_low {
                value.to_u64().unwrap_or(0) == 0
            } else {
                value.to_u64().unwrap_or(0) == 1
            }
        } else {
            false
        }
    }

    /// Run simulation for specified number of cycles
    pub fn run_cycles(&mut self, cycles: u64) {
        // The sequential program starts once reset releases
        if !self.initial_executed && !self.reset_active {
            self.initial_executed = true;
            self.advance_seq(false);
        }

        if self.clock_signals.len() <= 1 {
            // Single clock mode: use original cycle-based approach for compatibility
            for _ in 0..cycles {
                if self.finished {
                    break;
                }
                self.step_cycle_single_clock();
                if !self.initial_executed && !self.reset_active {
                    self.initial_executed = true;
                    self.advance_seq(false);
                } else if self.initial_executed {
                    self.advance_seq(true);
                }
            }
        } else {
            // Multi-clock mode: use time-based simulation
            // Determine total simulation time to run
            let total_time = cycles * self.clock_period;
            let end_time = self.time + total_time;

            while self.time < end_time {
                if self.finished {
                    break;
                }
                // Find the next event time (earliest clock edge)
                let mut next_time = end_time;
                for clock in &self.clock_signals {
                    if clock.next_edge_time < next_time && clock.next_edge_time > self.time {
                        next_time = clock.next_edge_time;
                    }
                }

                if next_time <= self.time {
                    // No more events, just advance to end
                    break;
                }

                // Advance time to next event
                self.time = next_time;

                // Process clock edges at this time
                self.process_clock_edges();

                // For test mode, check reset deassertion based on primary clock cycles
                if self.is_test_mode {
                    // Count cycles based on primary clock period elapsed
                    // Reset is deasserted when elapsed_cycles >= reset_duration
                    // (matching single-clock behavior: reset_duration cycles of reset,
                    //  then deasserted before processing the next rising edge)
                    let elapsed_cycles = self.time / self.clock_period;
                    if self.reset_active && elapsed_cycles >= self.reset_duration {
                        self.deassert_reset();
                    }
                }

                // The sequential program starts once reset releases, and then
                // advances on every edge
                if !self.initial_executed && !self.reset_active {
                    self.initial_executed = true;
                    self.advance_seq(false);
                } else if self.initial_executed {
                    self.advance_seq(true);
                }
            }
        }
    }

    /// Process clock edges at the current time
    fn process_clock_edges(&mut self) {
        // Determine which clocks have edges at the current time
        let mut rising_edge_clocks: Vec<String> = Vec::new();
        let mut falling_edge_clocks: Vec<String> = Vec::new();

        for i in 0..self.clock_signals.len() {
            let clock = &self.clock_signals[i];
            if clock.next_edge_time == self.time {
                if clock.current_value == 0 {
                    // Transitioning from 0 to 1 (rising edge)
                    rising_edge_clocks.push(clock.name.clone());
                } else {
                    // Transitioning from 1 to 0 (falling edge)
                    falling_edge_clocks.push(clock.name.clone());
                }
            }
        }

        // Update clock signal values and schedule next edges
        for i in 0..self.clock_signals.len() {
            let clock = &mut self.clock_signals[i];
            if clock.next_edge_time == self.time {
                // Toggle clock value
                clock.current_value = 1 - clock.current_value;
                self.signals.insert(clock.name.clone(), SignalValue::from_u64(clock.current_value, 1));
                self.trace.record(&clock.name, self.time, SignalValue::from_u64(clock.current_value, 1));

                // Schedule next edge
                clock.next_edge_time += clock.period / 2;
            }
        }

        // Process rising edge events
        for clock_name in &rising_edge_clocks {
            // Check for test mode reset
            if self.is_test_mode && self.reset_active {
                // Still in reset - apply reset values but still execute sync blocks
                // (async reset blocks handle reset internally)
            }

            // Propagate port connections
            self.propagate_port_connections();

            // Execute sync blocks triggered by this clock's rising edge
            self.execute_sync_blocks_for_clock(clock_name, ClockEdge::Posedge);

            // Execute FSM transitions for this clock only (not while in reset)
            if !self.reset_active {
                if let Some(top) = self.project.get_module(&self.top_module).cloned() {
                    self.execute_module_fsms(&top, "", Some(clock_name));
                }
            } else {
                self.reset_fsms();
            }

            // Execute comb blocks
            self.execute_all_comb_blocks();

            // Propagate output ports
            self.propagate_output_ports();
        }

        // Process falling edge events
        for _clock_name in &falling_edge_clocks {
            // Falling edges typically don't trigger logic in synchronous designs
            // But we still need to update the clock signal (already done above)
        }
    }

    /// Determine whether the reset a sync block refers to is active-low.
    ///
    /// The declaration wins; the `_n` naming convention is only a fallback for
    /// designs that declare a plain `reset`.
    fn sync_reset_active_low(&self, module: &Module, reset_name: &str) -> bool {
        for port in &module.ports {
            if port.name == reset_name {
                if let crate::parser::Type::Reset { active_low } = port.ty {
                    if active_low {
                        return true;
                    }
                }
            }
        }
        for signal in &module.signals {
            if signal.name == reset_name {
                if let crate::parser::Type::Reset { active_low } = signal.ty {
                    if active_low {
                        return true;
                    }
                }
            }
        }
        reset_name.ends_with("_n")
            || self
                .reset_signals
                .iter()
                .any(|r| r.name == reset_name && r.active_low)
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
                    Self::collect_typed_let_locals(then_branch, out);
                    if let Some(else_b) = else_branch {
                        Self::collect_typed_let_locals(else_b, out);
                    }
                }
                Statement::For { body, .. } | Statement::While { body, .. } => {
                    Self::collect_typed_let_locals(body, out);
                }
                Statement::Match { arms, .. } => {
                    for arm in arms {
                        Self::collect_typed_let_locals(&arm.body, out);
                    }
                }
                Statement::Assign { .. }
                | Statement::MemWrite { .. }
                | Statement::Assert(_)
                | Statement::SysCall(_)
                | Statement::SliceWrite { .. }
                | Statement::Break
                | Statement::Continue
                | Statement::Cover(_) => {}
            }
        }
    }

    /// Collect the names of all signals assigned anywhere in a statement list
    fn collect_assigned_signals(stmts: &[Statement], out: &mut Vec<String>) {
        for stmt in stmts {
            match stmt {
                Statement::Assign { target, .. } => {
                    if !out.iter().any(|t| t == target) {
                        out.push(target.clone());
                    }
                }
                Statement::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    Self::collect_assigned_signals(then_branch, out);
                    if let Some(else_b) = else_branch {
                        Self::collect_assigned_signals(else_b, out);
                    }
                }
                Statement::For { body, .. } | Statement::While { body, .. } => {
                    Self::collect_assigned_signals(body, out);
                }
                Statement::Match { arms, .. } => {
                    for arm in arms {
                        Self::collect_assigned_signals(&arm.body, out);
                    }
                }
                // A block-local is a wire, not a register, so reset does not restore it
                Statement::SliceWrite { target, .. } => {
                    if !out.iter().any(|t| t == target) {
                        out.push(target.clone());
                    }
                }
                Statement::MemWrite { .. }
                | Statement::LetLocal { .. }
                | Statement::Assert(_)
                | Statement::SysCall(_)
                | Statement::Break
                | Statement::Continue
                | Statement::Cover(_) => {}
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
                    Self::collect_written_memories(then_branch, out);
                    if let Some(else_b) = else_branch {
                        Self::collect_written_memories(else_b, out);
                    }
                }
                Statement::For { body, .. } | Statement::While { body, .. } => {
                    Self::collect_written_memories(body, out);
                }
                Statement::Match { arms, .. } => {
                    for arm in arms {
                        Self::collect_written_memories(&arm.body, out);
                    }
                }
                Statement::Assign { .. }
                | Statement::LetLocal { .. }
                | Statement::Assert(_)
                | Statement::SysCall(_)
                | Statement::SliceWrite { .. }
                | Statement::Break
                | Statement::Continue
                | Statement::Cover(_) => {}
            }
        }
    }

    /// Execute sync blocks that are triggered by a specific clock edge
    fn execute_sync_blocks_for_clock(&mut self, clock_name: &str, _edge: ClockEdge) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.execute_module_sync_blocks_for_clock(&top, "", clock_name);
        }
    }

    /// Execute sync blocks for a module that are triggered by a specific clock
    fn execute_module_sync_blocks_for_clock(&mut self, module: &Module, prefix: &str, clock_name: &str) {
        let mut updates: Vec<(String, SignalValue)> = Vec::new();
        let mut mem_writes: Vec<(String, usize, SignalValue)> = Vec::new();
        let mut mem_clears: Vec<String> = Vec::new();

        for block in &module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                // Check if this sync block is triggered by the specified clock
                // The clock signal in the sync block spec may be prefixed with the instance path
                let sync_clock_matches = sync.clock.signal == clock_name
                    || (prefix.is_empty() && sync.clock.signal == clock_name)
                    || (!prefix.is_empty() && format!("{}.{}", prefix, sync.clock.signal) == clock_name);

                if !sync_clock_matches {
                    continue; // Skip sync blocks for other clocks
                }

                // Check reset mode for this specific sync block
                if let Some(ref reset) = sync.reset {
                    // Check if this specific reset is asserted
                    // Try the signal name directly, then with instance prefix
                    let is_active_low = self.sync_reset_active_low(module, &reset.signal);
                    let mut is_asserted = self.is_reset_asserted(&reset.signal, is_active_low);
                    if !is_asserted {
                        // Also try with the module prefix for instance signals
                        let prefixed_reset = self.make_signal_name(prefix, &reset.signal);
                        is_asserted = self.is_reset_asserted_with_name(&prefixed_reset, is_active_low);
                    }

                    if is_asserted {
                        // Restore the initial value of every signal this block drives.
                        // Signals belonging to another clock domain are left alone.
                        let mut driven = Vec::new();
                        Self::collect_assigned_signals(&sync.statements, &mut driven);
                        for signal in &module.signals {
                            if !(signal.is_var || signal.is_mutable) {
                                continue;
                            }
                            if !driven.iter().any(|d| d == &signal.name) {
                                continue;
                            }
                            if let Some(ref init) = signal.init_value {
                                let evaluator = Evaluator::new(&self.signals);
                                if let Ok(value) = evaluator.eval(init) {
                                    let name = self.make_signal_name(prefix, &signal.name);
                                    updates.push((name, value));
                                }
                            }
                        }
                        // Clear the memories this block writes to
                        let mut written = Vec::new();
                        Self::collect_written_memories(&sync.statements, &mut written);
                        for mem_name in written {
                            if let Some(path) = self.resolve_mem_name(prefix, &mem_name) {
                                mem_clears.push(path);
                            }
                        }
                        continue;
                    }
                }

                // Execute statements and collect all updates
                for stmt in &sync.statements {
                    self.execute_statement_collect(stmt, prefix, &mut updates, &mut mem_writes);
                }
            }
        }

        // Apply signal updates
        for (name, value) in updates {
            self.apply_signal_update(&name, value);
        }

        // Apply memory clears, then memory writes
        for mem_name in mem_clears {
            self.memory_clear(&mem_name);
        }
        for (mem_name, addr, value) in mem_writes {
            self.memory_write(&mem_name, addr, value);
        }

        // Execute sync blocks for instances
        for inst in &module.instances {
            let inst_prefix = if prefix.is_empty() {
                inst.name.clone()
            } else {
                format!("{}.{}", prefix, inst.name)
            };
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                // For instances, sync blocks reference their own clock ports.
                // The connection is written in this module's scope, so `prefix` is
                // what the connection expression resolves against.
                self.execute_instance_sync_blocks(
                    &inst_module,
                    &inst_prefix,
                    inst,
                    prefix,
                    clock_name,
                );
            }
        }
    }

    /// Execute sync blocks for an instance module
    fn execute_instance_sync_blocks(
        &mut self,
        module: &Module,
        inst_prefix: &str,
        inst: &crate::parser::Instance,
        parent_prefix: &str,
        parent_clock_name: &str,
    ) {
        // Map the parent clock onto the instance's clock ports.
        // Only ports actually wired to this clock may fire; a port wired to the
        // other domain's clock must stay quiet, otherwise both domains would
        // advance on every edge.
        let driven_ports: Vec<String> = inst
            .port_connections
            .iter()
            .filter_map(|(port_name, expr)| match expr {
                // The clock named in the connection belongs to the parent's scope
                Expression::Ident(id)
                    if self.make_signal_name(parent_prefix, id) == parent_clock_name =>
                {
                    Some(port_name.clone())
                }
                _ => None,
            })
            .collect();

        for port_name in driven_ports {
            let instance_clock_name = self.make_signal_name(inst_prefix, &port_name);
            self.execute_module_sync_blocks_for_clock(module, inst_prefix, &instance_clock_name);
        }
    }

    /// Check if a reset signal is asserted by its full name
    fn is_reset_asserted_with_name(&self, name: &str, active_low: bool) -> bool {
        if let Some(value) = self.signals.get(name) {
            if active_low {
                value.to_u64().unwrap_or(1) == 0
            } else {
                value.to_u64().unwrap_or(0) == 1
            }
        } else {
            false
        }
    }

    /// Single-clock step cycle (for backward compatibility)
    fn step_cycle_single_clock(&mut self) {
        // For test mode, auto-deassert reset after reset_duration cycles
        if self.is_test_mode {
            self.cycle_count += 1;
            if self.reset_active && self.cycle_count > self.reset_duration {
                self.deassert_reset();
            }
        }

        // Find clock signal
        let clk = if !self.clock_signals.is_empty() {
            Some(self.clock_signals[0].name.clone())
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

        // Execute sync blocks for all modules
        self.execute_all_sync_blocks();

        // Execute FSM transitions (only when not in reset)
        if !self.reset_active {
            self.execute_fsms();
        } else {
            self.reset_fsms();
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

    /// Let the sequential program run as far as it can.
    ///
    /// `edge` says whether a clock edge just happened, which is what a
    /// `await clk.cycles(n)` counts.
    fn advance_seq(&mut self, edge: bool) {
        use super::seq::{SeqInstr, SeqWait, STEP_BUDGET};

        // First see whether what it was waiting for has arrived
        match self.seq_wait.clone() {
            SeqWait::Done => return,
            SeqWait::Ready => {}
            SeqWait::Edges(remaining) => {
                if !edge {
                    return;
                }
                let remaining = remaining.saturating_sub(1);
                if remaining > 0 {
                    self.seq_wait = SeqWait::Edges(remaining);
                    return;
                }
                self.seq_wait = SeqWait::Ready;
            }
            SeqWait::Time(deadline) => {
                if self.time < deadline {
                    return;
                }
                self.seq_wait = SeqWait::Ready;
            }
        }

        let mut budget = STEP_BUDGET;
        while self.seq_pc < self.seq_program.len() {
            if budget == 0 {
                eprintln!(
                    "Warning: a sequential block ran {} steps without waiting; suspending it",
                    STEP_BUDGET
                );
                self.seq_wait = SeqWait::Done;
                return;
            }
            budget -= 1;

            let instr = self.seq_program[self.seq_pc].clone();
            self.seq_pc += 1;

            match instr {
                SeqInstr::Assign { target, value } => {
                    self.execute_seq_statement(&SeqStatement::Assign { target, value }, "")
                }
                SeqInstr::SignalWrite { path, value } => {
                    if let Some(val) = self.eval_in(&value, "") {
                        self.apply_signal_update(&path, val);
                    }
                }
                SeqInstr::MemWrite {
                    mem_name,
                    addr,
                    value,
                } => self.execute_seq_statement(
                    &SeqStatement::MemWrite {
                        mem_name,
                        addr,
                        value,
                    },
                    "",
                ),
                SeqInstr::Assert(assert) => self.execute_assert(&assert, ""),
                SeqInstr::Cover(cover) => self.record_cover(&cover, ""),
                SeqInstr::SysCall(call) => self.execute_sys_call(&call, ""),
                SeqInstr::Jump(target) => self.seq_pc = target,
                SeqInstr::JumpIfFalse { condition, target } => {
                    let holds = self
                        .eval_in(&condition, "")
                        .map(|v| iris_runtime::ops::truthy(&v))
                        .unwrap_or(false);
                    if !holds {
                        self.seq_pc = target;
                    }
                }
                SeqInstr::Delay(duration) => {
                    self.seq_wait = SeqWait::Time(self.time + duration);
                    return;
                }
                SeqInstr::AwaitEdges(count) => {
                    let count = self
                        .eval_in(&count, "")
                        .and_then(|v| v.to_u64())
                        .unwrap_or(1)
                        .max(1);
                    self.seq_wait = SeqWait::Edges(count);
                    return;
                }
                SeqInstr::AwaitUntil { condition, timeout } => {
                    let limit = timeout.unwrap_or(self.clock_period * 1000);
                    let deadline = *self.seq_deadline.get_or_insert(self.time + limit);
                    let met = self
                        .eval_in(&condition, "")
                        .map(|v| iris_runtime::ops::truthy(&v))
                        .unwrap_or(false);
                    if met || self.time >= deadline {
                        self.seq_deadline = None;
                        continue;
                    }
                    // Re-run this instruction on the next edge
                    self.seq_pc -= 1;
                    self.seq_wait = SeqWait::Edges(1);
                    return;
                }
            }

            if self.finished {
                self.seq_wait = SeqWait::Done;
                return;
            }
        }

        self.seq_wait = SeqWait::Done;
    }

    /// Execute a sequential statement
    fn execute_seq_statement(&mut self, stmt: &SeqStatement, prefix: &str) {
        match stmt {
            SeqStatement::Assign { target, value } => {
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                match evaluator.eval(value) {
                    Ok(val) => {
                        let name = self.make_signal_name(prefix, target);
                        self.apply_signal_update(&name, val);
                    }
                    Err(e) => {
                        let what = format!("assignment to '{}'", target);
                        self.record_eval_failure(&what, &e);
                    }
                }
            }
            SeqStatement::SignalWrite { path, value } => {
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                let target_name = path.to_string();
                match evaluator.eval(value) {
                    Ok(val) => {
                        self.apply_signal_update(&target_name, val);
                    }
                    Err(e) => {
                        let what = format!("assignment to '{}'", target_name);
                        self.record_eval_failure(&what, &e);
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
            SeqStatement::Cover(cover) => self.record_cover(cover, prefix),
            SeqStatement::SysCall(call) => {
                self.execute_sys_call(call, prefix);
            }
            SeqStatement::Delay(duration) => {
                // Advance simulation time
                let ps = duration.to_picoseconds();
                self.time += ps;
            }
            // Loop control is resolved into jumps when the block is flattened
            SeqStatement::Break | SeqStatement::Continue => {}
            SeqStatement::Await(await_expr) => {
                // For now, await just advances by the appropriate amount
                self.execute_await(await_expr, prefix);
            }
            SeqStatement::MemWrite {
                mem_name,
                addr,
                value,
            } => {
                let evaluator = HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                if let (Ok(addr_val), Ok(data_val)) = (evaluator.eval(addr), evaluator.eval(value))
                {
                    let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                    if let Some(path) = self.resolve_mem_name(prefix, mem_name) {
                        self.memory_write(&path, addr_usize, data_val);
                    }
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

    /// Execute a system call used as a statement
    fn execute_sys_call(&mut self, call: &Expression, prefix: &str) {
        let Expression::SysFunc { name, args } = call else {
            return;
        };

        match name.as_str() {
            "display" => {
                let text = self.format_display(args, prefix);
                println!("{}", text);
            }
            "finish" => {
                self.finished = true;
            }
            "randomize" => self.randomize(prefix),
            // The value-returning system functions have no effect as statements
            _ => {}
        }
    }

    /// Render a `$display` argument list.
    ///
    /// The first argument is a format string; `%d`, `%h`/`%x`, `%b` and `%s`
    /// consume the arguments that follow. `%%` is a literal percent sign.
    fn format_display(&self, args: &[crate::parser::SysFuncArg], prefix: &str) -> String {
        use crate::parser::SysFuncArg;

        let mut rest = args.iter();
        let format = match rest.next() {
            Some(SysFuncArg::Str(text)) => text.clone(),
            Some(SysFuncArg::Expr(e)) => {
                return self
                    .eval_in(e, prefix)
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            }
            _ => return String::new(),
        };

        // An argument that cannot be evaluated used to print as 0, which is a
        // real value and reads as one. Three methods of spec 9.2.4 were
        // unimplemented and looked like they worked because their result was
        // shown as 0. `x` is not a number, so it cannot be mistaken for one.
        let value_of = |arg: Option<&SysFuncArg>| -> Option<u64> {
            match arg {
                Some(SysFuncArg::Expr(e)) => self.eval_in(e, prefix).and_then(|v| v.to_u64()),
                _ => None,
            }
        };
        let show = |arg: Option<&SysFuncArg>, radix: u32| -> String {
            match value_of(arg) {
                Some(v) => match radix {
                    16 => format!("{:x}", v),
                    2 => format!("{:b}", v),
                    _ => v.to_string(),
                },
                None => "x".to_string(),
            }
        };

        let mut out = String::new();
        let mut chars = format.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '%' {
                out.push(c);
                continue;
            }
            // Width modifiers such as %0d are accepted and ignored
            while matches!(chars.peek(), Some(d) if d.is_ascii_digit()) {
                chars.next();
            }
            match chars.next() {
                Some('%') => out.push('%'),
                Some('d') => out.push_str(&show(rest.next(), 10)),
                Some('h') | Some('x') => {
                    out.push_str(&show(rest.next(), 16))
                }
                Some('b') => out.push_str(&show(rest.next(), 2)),
                Some('s') => match rest.next() {
                    Some(SysFuncArg::Str(text)) => out.push_str(text),
                    other => out.push_str(&show(other, 10)),
                },
                Some(other) => {
                    out.push('%');
                    out.push(other);
                }
                None => out.push('%'),
            }
        }
        out
    }

    /// Evaluate an expression in a module's scope
    fn eval_in(&self, expr: &Expression, prefix: &str) -> Option<SignalValue> {
        HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories)
            .eval(expr)
            .ok()
    }

    /// Has a `$finish` been executed?
    pub fn is_finished(&self) -> bool {
        self.finished
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
                    severity: assert_stmt.severity,
                    lhs_value,
                    rhs_value,
                };
                self.assertion_failures.push(failure);
                if assert_stmt.severity == AssertSeverity::Fatal {
                    self.finished = true;
                }
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

    /// Propagate port connections from parent to instance
    fn propagate_port_connections(&mut self) -> bool {
        let mut changed = false;
        // Shallow instances first, so a parent's own ports carry their new value
        // before the instances below it read them
        let mut instances: Vec<String> = self.instances.keys().cloned().collect();
        instances.sort_by_key(|path| (path.matches('.').count(), path.clone()));

        for inst_path in instances {
            let (connections, module_name) = match self.instances.get(&inst_path) {
                Some(state) => (state.port_connections.clone(), state.module_name.clone()),
                None => continue,
            };

            // A connection expression is written in the parent module's body, so it
            // resolves against the parent's scope, not the top of the design
            let parent_prefix = Self::parent_path(&inst_path);

            // Evaluate every input connection first, so the instance ports can then be
            // written without holding a borrow on the project
            let mut driven: Vec<(String, SignalValue)> = Vec::new();
            if let Some(module) = self.project.get_module(&module_name) {
                for (port_name, expr) in &connections {
                    let is_input = module
                        .ports
                        .iter()
                        .find(|p| &p.name == port_name)
                        .map(|p| matches!(p.direction, crate::parser::PortDirection::In))
                        .unwrap_or(false);
                    if !is_input {
                        continue;
                    }
                    let evaluator = HierarchicalEvaluator::with_memories(
                        &self.signals,
                        parent_prefix,
                        &self.memories,
                    );
                    if let Ok(value) = evaluator.eval(expr) {
                        driven.push((format!("{}.{}", inst_path, port_name), value));
                    }
                }
            }

            for (target, value) in driven {
                if self.apply_signal_update(&target, value) {
                    changed = true;
                }
            }
        }
        changed
    }

    /// The hierarchical path enclosing an instance ("" for a top-level instance)
    fn parent_path(inst_path: &str) -> &str {
        match inst_path.rfind('.') {
            Some(pos) => &inst_path[..pos],
            None => "",
        }
    }

    /// Copy each instance's output ports onto whatever they are wired to.
    ///
    /// A design that reads `dut.count` does not need this, but a connection
    /// written as `q: bus_signal` does, and so does every interface member.
    /// Returns whether anything changed.
    fn propagate_output_ports(&mut self) -> bool {
        let mut changed = false;
        let mut instances: Vec<String> = self.instances.keys().cloned().collect();
        // Deepest first, so a value crosses several levels in one pass
        instances.sort_by_key(|path| (std::cmp::Reverse(path.matches('.').count()), path.clone()));

        for inst_path in instances {
            let (connections, module_name) = match self.instances.get(&inst_path) {
                Some(state) => (state.port_connections.clone(), state.module_name.clone()),
                None => continue,
            };
            let parent_prefix = Self::parent_path(&inst_path).to_string();

            let mut driven: Vec<(String, SignalValue)> = Vec::new();
            if let Some(module) = self.project.get_module(&module_name) {
                for (port_name, expr) in &connections {
                    let is_output = module
                        .ports
                        .iter()
                        .find(|p| &p.name == port_name)
                        .map(|p| matches!(p.direction, crate::parser::PortDirection::Out))
                        .unwrap_or(false);
                    if !is_output {
                        continue;
                    }
                    // Only a plain name can receive a value
                    let Expression::Ident(target) = expr else {
                        continue;
                    };
                    let source = format!("{}.{}", inst_path, port_name);
                    let Some(value) = self.signals.get(&source).cloned() else {
                        continue;
                    };
                    driven.push((self.make_signal_name(&parent_prefix, target), value));
                }
            }

            for (target, value) in driven {
                if self.apply_signal_update(&target, value) {
                    changed = true;
                }
            }
        }
        changed
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

    /// Execute all sync blocks (for single-clock mode)
    fn execute_all_sync_blocks(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.execute_module_sync_blocks(&top, "");
        }
    }

    /// Execute sync blocks for a module (all clocks, for single-clock mode)
    fn execute_module_sync_blocks(&mut self, module: &Module, prefix: &str) {
        let mut updates: Vec<(String, SignalValue)> = Vec::new();
        let mut mem_writes: Vec<(String, usize, SignalValue)> = Vec::new();
        let mut mem_clears: Vec<String> = Vec::new();

        for block in &module.logic_blocks {
            if let LogicBlock::Sync(sync) = block {
                // Check reset mode for this specific sync block
                if let Some(ref reset) = sync.reset {
                    let is_active_low = self.sync_reset_active_low(module, &reset.signal);
                    let is_asserted = self.is_reset_asserted(&reset.signal, is_active_low)
                        || {
                            let prefixed = self.make_signal_name(prefix, &reset.signal);
                            self.is_reset_asserted_with_name(&prefixed, is_active_low)
                        };

                    if is_asserted {
                        // Reset is asserted for this sync block: restore the initial
                        // value of every signal the block drives
                        let mut driven = Vec::new();
                        Self::collect_assigned_signals(&sync.statements, &mut driven);
                        for signal in &module.signals {
                            if !(signal.is_var || signal.is_mutable) {
                                continue;
                            }
                            if !driven.iter().any(|d| d == &signal.name) {
                                continue;
                            }
                            if let Some(ref init) = signal.init_value {
                                let evaluator = Evaluator::new(&self.signals);
                                if let Ok(value) = evaluator.eval(init) {
                                    let name = self.make_signal_name(prefix, &signal.name);
                                    updates.push((name, value));
                                }
                            }
                        }
                        // Clear the memories this block writes to
                        let mut written = Vec::new();
                        Self::collect_written_memories(&sync.statements, &mut written);
                        for mem_name in written {
                            if let Some(path) = self.resolve_mem_name(prefix, &mem_name) {
                                mem_clears.push(path);
                            }
                        }
                        continue;
                    }
                }

                // Execute statements (only when not in reset)
                for stmt in &sync.statements {
                    self.execute_statement_collect(stmt, prefix, &mut updates, &mut mem_writes);
                }
            }
        }

        // Apply signal updates
        for (name, value) in updates {
            self.apply_signal_update(&name, value);
        }

        // Apply memory clears, then memory writes
        for mem_name in mem_clears {
            self.memory_clear(&mem_name);
        }
        for (mem_name, addr, value) in mem_writes {
            self.memory_write(&mem_name, addr, value);
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

    /// Reset every FSM in the design to its initial state
    fn reset_fsms(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.reset_module_fsms(&top, "");
        }
    }

    fn reset_module_fsms(&mut self, module: &Module, prefix: &str) {
        for fsm in &module.fsm_blocks {
            let Some((index, state_name)) = Self::fsm_initial_state(fsm) else {
                continue;
            };
            let path = self.make_signal_name(prefix, &fsm.name);
            self.fsm_states.insert(path.clone(), state_name.clone());

            let state_signal_name = format!("{}_state", path);
            let value = SignalValue::from_u64(index as u64, Self::state_width(fsm));
            self.apply_signal_update(&state_signal_name, value);

            self.apply_moore_outputs(fsm, &state_name, prefix);
        }

        for inst in &module.instances {
            let inst_prefix = self.make_signal_name(prefix, &inst.name);
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                self.reset_module_fsms(&inst_module, &inst_prefix);
            }
        }
    }

    /// Execute every FSM in the design (single-clock mode)
    fn execute_fsms(&mut self) {
        if let Some(top) = self.project.get_module(&self.top_module).cloned() {
            self.execute_module_fsms(&top, "", None);
        }
    }

    /// Execute the FSMs of a module and its instances.
    ///
    /// With `clock_name` set, only the FSMs driven by that clock run, which is what
    /// keeps clock domains apart in a multi-clock design.
    fn execute_module_fsms(&mut self, module: &Module, prefix: &str, clock_name: Option<&str>) {
        for fsm in &module.fsm_blocks {
            if let Some(clock) = clock_name {
                if self.make_signal_name(prefix, &fsm.clock.signal) != clock {
                    continue;
                }
            }
            // An FSM with its own reset holds its initial state while asserted
            if let Some(ref reset) = fsm.reset {
                let active_low = self.sync_reset_active_low(module, &reset.signal);
                let prefixed = self.make_signal_name(prefix, &reset.signal);
                if self.is_reset_asserted(&reset.signal, active_low)
                    || self.is_reset_asserted_with_name(&prefixed, active_low)
                {
                    continue;
                }
            }
            self.execute_fsm(fsm, prefix);
        }

        for inst in &module.instances {
            let inst_prefix = self.make_signal_name(prefix, &inst.name);
            if let Some(inst_module) = self.project.get_module(&inst.module_name).cloned() {
                // The clock reaches the instance through one of its ports
                let child_clock = clock_name.and_then(|clock| {
                    inst.port_connections.iter().find_map(|(port, expr)| match expr {
                        Expression::Ident(id)
                            if self.make_signal_name(prefix, id) == clock =>
                        {
                            Some(self.make_signal_name(&inst_prefix, port))
                        }
                        _ => None,
                    })
                });
                if clock_name.is_some() && child_clock.is_none() {
                    continue;
                }
                self.execute_module_fsms(&inst_module, &inst_prefix, child_clock.as_deref());
            }
        }
    }

    /// Run the actions of a `when` clause, following any `if` inside it
    fn execute_fsm_actions(
        &mut self,
        actions: &[FsmAction],
        prefix: &str,
        path: &str,
        next_state: &mut String,
        found: &mut bool,
    ) {
        for action in actions {
            match action {
                FsmAction::Goto(state) => {
                    *next_state = state.clone();
                    *found = true;
                }
                FsmAction::Assign { target, value } => {
                    let evaluated = {
                        let evaluator = HierarchicalEvaluator::with_memories(
                            &self.signals,
                            prefix,
                            &self.memories,
                        )
                        .within(path);
                        evaluator.eval(value)
                    };
                    if let Ok(val) = evaluated {
                        let name = self.fsm_target(prefix, path, target);
                        self.apply_signal_update(&name, val);
                    }
                }
                FsmAction::If {
                    condition,
                    then_branch,
                    else_branch,
                } => {
                    let taken = {
                        let evaluator = HierarchicalEvaluator::with_memories(
                            &self.signals,
                            prefix,
                            &self.memories,
                        )
                        .within(path);
                        evaluator
                            .eval(condition)
                            .ok()
                            .map(|v| iris_runtime::ops::truthy(&v))
                            .unwrap_or(false)
                    };
                    let branch = if taken {
                        Some(then_branch)
                    } else {
                        else_branch.as_ref()
                    };
                    if let Some(branch) = branch {
                        self.execute_fsm_actions(branch, prefix, path, next_state, found);
                    }
                }
            }
        }
    }

    /// Execute a single FSM in the scope of its module
    fn execute_fsm(&mut self, fsm: &FsmBlock, prefix: &str) {
        let path = self.make_signal_name(prefix, &fsm.name);
        let current_state = match self.fsm_states.get(&path) {
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
                    let evaluator = HierarchicalEvaluator::with_memories(
                        &self.signals,
                        prefix,
                        &self.memories,
                    )
                    .within(&path);
                    if let Ok(cond_val) = evaluator.eval(&when_clause.condition) {
                        let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                        if is_true {
                            self.execute_fsm_actions(
                                &when_clause.actions,
                                prefix,
                                &path,
                                &mut next_state,
                                &mut found_transition,
                            );
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
            self.fsm_states.insert(path.clone(), next_state.clone());

            let state_signal_name = format!("{}_state", path);
            let state_index = fsm
                .states
                .iter()
                .position(|s| s.name == next_state)
                .unwrap_or(0) as u64;
            let value = SignalValue::from_u64(state_index, Self::state_width(fsm));
            self.apply_signal_update(&state_signal_name, value);

            // Apply Moore outputs for new state
            self.apply_moore_outputs(fsm, &next_state, prefix);
        }

        // Apply Mealy outputs (output blocks)
        for output in &fsm.outputs {
            let active_state = self.fsm_states.get(&path).cloned().unwrap_or_default();
            for (state_name, value_expr) in &output.mappings {
                if state_name != &active_state {
                    continue;
                }
                let evaluated = {
                    let evaluator = HierarchicalEvaluator::with_memories(
                        &self.signals,
                        prefix,
                        &self.memories,
                    )
                    .within(&path);
                    evaluator.eval(value_expr)
                };
                if let Ok(val) = evaluated {
                    let name = self.fsm_target(prefix, &path, &output.signal);
                    self.apply_signal_update(&name, val);
                }
                break;
            }
        }
    }

    /// Execute all comb blocks
    fn execute_all_comb_blocks(&mut self) {
        // Iterate until convergence. Ports settle here too: a value that leaves
        // one instance may be combinational input to another.
        for _ in 0..10 {
            let mut any_changed = false;

            if let Some(top) = self.project.get_module(&self.top_module).cloned() {
                if self.execute_module_comb_blocks(&top, "") {
                    any_changed = true;
                }
            }
            if self.propagate_output_ports() {
                any_changed = true;
            }
            if self.propagate_port_connections() {
                any_changed = true;
            }

            if !any_changed {
                break;
            }
        }
    }

    /// Execute comb blocks for a module (returns true if any signal changed)
    /// Names this module assigns to, anywhere in its logic blocks.
    ///
    /// A `let` that something assigns to is a register or a block-driven wire;
    /// its initialiser is a reset value. A `let` nothing assigns to, declared
    /// with an expression, is the continuously driven wire of spec 2.4.3.
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

    fn execute_module_comb_blocks(&mut self, module: &Module, prefix: &str) -> bool {
        let mut any_changed = false;

        // A module-level `let` bound to an expression is a continuously driven
        // wire (spec 2.4.3), not a value frozen at elaboration. Re-evaluate it
        // with the combinational logic, so that `let sum = a + b;` follows a
        // and b instead of keeping whatever they held at time zero.
        let assigned = Self::assigned_names(module);
        for signal in &module.signals {
            if signal.is_var || signal.is_mutable {
                continue;
            }
            if assigned.contains(&signal.name) {
                continue;
            }
            let Some(ref init) = signal.init_value else {
                continue;
            };
            let evaluator =
                HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
            if let Ok(value) = evaluator.eval(init) {
                // `let sum = a + b;` writes no type, so the width comes from
                // the expression. Defaulting to one bit would silently
                // truncate every wire declared without an annotation.
                let width = if signal.has_explicit_type {
                    signal.ty.width().unwrap_or_else(|| value.width())
                } else {
                    value.width()
                };
                let value = SignalValue::from_u64(value.to_u64().unwrap_or(0), width)
                    .with_signed(Self::is_signed_type(&signal.ty));
                let name = self.make_signal_name(prefix, &signal.name);
                if self.apply_signal_update(&name, value) {
                    any_changed = true;
                }
            }
        }

        for block in &module.logic_blocks {
            if let LogicBlock::Comb(comb) = block {
                for stmt in &comb.statements {
                    let mut updates = Vec::new();
                    let mut mem_writes = Vec::new();
                    self.execute_statement_collect(stmt, prefix, &mut updates, &mut mem_writes);
                    for (name, value) in updates {
                        if self.apply_signal_update(&name, value) {
                            any_changed = true;
                        }
                    }
                    for (mem_name, addr, value) in mem_writes {
                        if self.memory_write(&mem_name, addr, value) {
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

    /// Draw new values for the random variables in scope, honouring the
    /// constraints declared alongside them.
    ///
    /// Values are drawn until every constraint holds, or until the attempt
    /// limit is reached, in which case the last draw is kept and a warning is
    /// reported. The generator is deterministic, so a run is reproducible.
    fn randomize(&mut self, prefix: &str) {
        let Some(module) = self
            .project
            .get_module(&self.top_module)
            .cloned()
        else {
            return;
        };

        let variables: Vec<(String, usize)> = module
            .signals
            .iter()
            .filter(|s| s.is_rand)
            .map(|s| {
                (
                    self.make_signal_name(prefix, &s.name),
                    s.ty.width().unwrap_or(1),
                )
            })
            .collect();
        if variables.is_empty() {
            return;
        }

        let conditions: Vec<Expression> = module
            .constraints
            .iter()
            .flat_map(|c| c.conditions.iter().cloned())
            .collect();

        let mut satisfied = false;
        for _ in 0..iris_runtime::random::MAX_ATTEMPTS {
            for (name, width) in &variables {
                let value = self.rng.next_bits(*width);
                self.apply_signal_update(name, SignalValue::from_u64(value, *width));
            }
            satisfied = conditions.iter().all(|condition| {
                self.eval_in(condition, prefix)
                    .map(|v| iris_runtime::ops::truthy(&v))
                    .unwrap_or(false)
            });
            if satisfied {
                break;
            }
        }

        if !satisfied {
            eprintln!(
                "Warning: $randomize could not satisfy the constraints in {} attempts",
                iris_runtime::random::MAX_ATTEMPTS
            );
        }
    }

    /// List every coverage point in the design, in declaration order
    fn register_cover_points(&mut self, module: &Module) {
        let mut names = Vec::new();
        collect_cover_names(module, &self.project, &mut names);
        for name in names {
            if !self.coverage.iter().any(|(n, _)| n == &name) {
                self.coverage.push((name, 0));
            }
        }
    }

    /// Note whether a coverage point's condition held
    fn record_cover(&mut self, cover: &crate::parser::CoverStmt, prefix: &str) {
        let name = cover_name(cover);
        let held = self
            .eval_in(&cover.condition, prefix)
            .map(|v| iris_runtime::ops::truthy(&v))
            .unwrap_or(false);
        if !held {
            return;
        }
        match self.coverage.iter_mut().find(|(n, _)| n == &name) {
            Some(entry) => entry.1 += 1,
            None => self.coverage.push((name, 1)),
        }
    }

    /// Coverage points with how often each held
    pub fn get_coverage(&self) -> &[(String, u64)] {
        &self.coverage
    }

    /// Make a matched payload visible under the name the pattern gave it
    fn bind_payload(
        &mut self,
        pattern: &crate::parser::Pattern,
        value: &SignalValue,
        prefix: &str,
    ) {
        let Some((name, tag_width, payload_width)) = pattern.payload_binding() else {
            return;
        };
        let payload = super::eval::payload_of(value, tag_width, payload_width);
        let target = self.make_signal_name(prefix, name);
        self.apply_signal_update(&target, payload);
    }

    /// Execute statements in order, stopping at a `break` or `continue`
    fn execute_statement_list(
        &mut self,
        stmts: &[Statement],
        prefix: &str,
        updates: &mut Vec<(String, SignalValue)>,
        mem_writes: &mut Vec<(String, usize, SignalValue)>,
    ) {
        for stmt in stmts {
            if self.loop_control.is_some() {
                return;
            }
            self.execute_statement_collect(stmt, prefix, updates, mem_writes);
        }
    }

    /// Execute a single statement, collecting ALL signal updates (not just the first one)
    fn execute_statement_collect(&mut self, stmt: &Statement, prefix: &str, updates: &mut Vec<(String, SignalValue)>, mem_writes: &mut Vec<(String, usize, SignalValue)>) {
        match stmt {
            Statement::Assign { target, value } => {
                // Create evaluator with hierarchical signal and memory resolution
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                match evaluator.eval(value) {
                    Ok(val) => {
                        let name = self.make_signal_name(prefix, target);
                        updates.push((name, val));
                    }
                    Err(e) => {
                        let what = format!("assignment to '{}'", target);
                        self.record_eval_failure(&what, &e);
                    }
                }
            }
            Statement::MemWrite { mem_name, addr, value } => {
                let evaluator = HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                if let (Ok(addr_val), Ok(data_val)) = (evaluator.eval(addr), evaluator.eval(value)) {
                    let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                    if let Some(path) = self.resolve_mem_name(prefix, mem_name) {
                        mem_writes.push((path, addr_usize, data_val));
                    } else {
                        // Not a memory: `signal[i] = v` sets one bit
                        let bit = Statement::SliceWrite {
                            target: mem_name.clone(),
                            low: addr.clone(),
                            width: Expression::Literal(crate::parser::Literal::Decimal {
                                width: None,
                                value: 1,
                            }),
                            value: value.clone(),
                        };
                        self.execute_statement_collect(&bit, prefix, updates, mem_writes);
                    }
                }
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                if let Ok(cond_val) = evaluator.eval(condition) {
                    let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                    let branch = if is_true {
                        then_branch
                    } else if let Some(ref else_b) = else_branch {
                        else_b
                    } else {
                        return;
                    };
                    self.execute_statement_list(branch, prefix, updates, mem_writes);
                }
            }
            Statement::Break => self.loop_control = Some(LoopControl::Break),
            Statement::Continue => self.loop_control = Some(LoopControl::Continue),
            Statement::For { var, range, body } => {
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
                        self.signals.insert(var_name, SignalValue::from_u64(i as u64, 32));
                        self.execute_statement_list(body, prefix, updates, mem_writes);
                        match self.loop_control.take() {
                            Some(LoopControl::Break) => break,
                            // `continue` simply ends this iteration
                            Some(LoopControl::Continue) | None => {}
                        }
                    }
                }
            }
            Statement::While { condition, body } => {
                const MAX_ITERATIONS: usize = 1000;
                let mut iterations = 0;

                loop {
                    if iterations >= MAX_ITERATIONS {
                        break;
                    }
                    // Counted before the body, so `continue` cannot skip it
                    iterations += 1;

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

                    self.execute_statement_list(body, prefix, updates, mem_writes);
                    match self.loop_control.take() {
                        Some(LoopControl::Break) => break,
                        Some(LoopControl::Continue) | None => {}
                    }
                }
            }
            Statement::Match { expr, arms } => {
                // Pick the arm outside the mutable borrow needed to run its body
                let chosen = {
                    let evaluator = HierarchicalEvaluator::with_memories(
                        &self.signals,
                        prefix,
                        &self.memories,
                    );
                    evaluator.eval(expr).ok().and_then(|value| {
                        arms.iter()
                            .position(|arm| evaluator.pattern_matches(&arm.pattern, &value))
                            .map(|index| (index, value))
                    })
                };
                if let Some((index, value)) = chosen {
                    self.bind_payload(&arms[index].pattern, &value, prefix);
                    let body = arms[index].body.clone();
                    self.execute_statement_list(&body, prefix, updates, mem_writes);
                }
            }
            Statement::LetLocal { name, ty, value } => {
                let Some(expr) = value else {
                    return;
                };
                let evaluator =
                    HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                let Ok(mut val) = evaluator.eval(expr) else {
                    return;
                };
                if let Some(width) = ty.as_ref().and_then(|t| t.width()) {
                    val = SignalValue::from_u64(val.to_u64().unwrap_or(0), width);
                }
                let full_name = self.make_signal_name(prefix, name);
                // A block-local is visible to the statements that follow it, so it
                // is applied immediately instead of being deferred with the rest.
                self.apply_signal_update(&full_name, val);
            }
            Statement::Assert(assert_stmt) => {
                self.execute_assert(assert_stmt, prefix);
            }
            Statement::Cover(cover) => self.record_cover(cover, prefix),
            Statement::SysCall(call) => {
                self.execute_sys_call(call, prefix);
            }
            Statement::SliceWrite {
                target,
                low,
                width,
                value,
            } => {
                let evaluated = {
                    let evaluator =
                        HierarchicalEvaluator::with_memories(&self.signals, prefix, &self.memories);
                    match (
                        evaluator.eval(low),
                        evaluator.eval(width),
                        evaluator.eval(value),
                    ) {
                        (Ok(l), Ok(w), Ok(v)) => Some((
                            l.to_u64().unwrap_or(0) as usize,
                            w.to_u64().unwrap_or(0) as usize,
                            v.to_u64().unwrap_or(0),
                        )),
                        _ => None,
                    }
                };
                let Some((low_bit, field_width, field)) = evaluated else {
                    return;
                };
                if field_width == 0 {
                    return;
                }

                let name = self.make_signal_name(prefix, target);
                // Start from an update already pending for this signal, so that
                // several field writes in one block accumulate instead of
                // overwriting each other
                let base = updates
                    .iter()
                    .rev()
                    .find(|(n, _)| n == &name)
                    .map(|(_, v)| v.clone())
                    .or_else(|| self.signals.get(&name).cloned());
                let Some(base) = base else {
                    return;
                };

                let new_value = iris_runtime::ops::merge_field(&base, low_bit, field_width, field);

                match updates.iter_mut().rev().find(|(n, _)| n == &name) {
                    Some(slot) => slot.1 = new_value,
                    None => updates.push((name, new_value)),
                }
            }
        }
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

    /// Record an expression the evaluator could not handle
    fn record_eval_failure(&mut self, what: &str, err: &super::eval::EvalError) {
        let message = format!("{}: {}", what, err);
        if !self.eval_failures.contains(&message) {
            self.eval_failures.push(message);
        }
    }

    /// Expressions the evaluator could not evaluate during the run
    pub fn get_eval_failures(&self) -> &[String] {
        &self.eval_failures
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
    /// A scope searched before the module's, used for an FSM's own signals
    inner: Option<String>,
    /// Names bound by a match arm, visible only while that arm is evaluated
    bindings: HashMap<String, SignalValue>,
}


/// Flatten a chain of zero-argument method calls into a dotted path
///
/// `core.rf.regs` parses as a method call whose receiver is itself a method
/// call. Reading a memory two levels down means walking that chain back to the
/// instance name at its root.
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

impl<'a> HierarchicalEvaluator<'a> {
    fn new(signals: &'a HashMap<String, SignalValue>, prefix: &'a str) -> Self {
        Self {
            signals,
            prefix,
            memories: None,
            inner: None,
            bindings: HashMap::new(),
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
            inner: None,
            bindings: HashMap::new(),
        }
    }

    /// Search `scope` before the module's own signals
    fn within(mut self, scope: &str) -> Self {
        self.inner = Some(scope.to_string());
        self
    }

    /// The same evaluator with one more name in scope
    fn binding(&self, name: &str, value: SignalValue) -> Self {
        let mut bindings = self.bindings.clone();
        bindings.insert(name.to_string(), value);
        Self {
            signals: self.signals,
            prefix: self.prefix,
            memories: self.memories,
            inner: self.inner.clone(),
            bindings,
        }
    }

    /// Does a match pattern accept this value?
    fn pattern_matches(&self, pattern: &crate::parser::Pattern, value: &SignalValue) -> bool {
        use crate::parser::Pattern;
        match pattern {
            Pattern::Wildcard => true,
            Pattern::Literal(lit) => Some(lit.to_u64()) == value.to_u64(),
            Pattern::Ident(name) => match self.resolve_signal(name) {
                Some(v) => v.to_u64() == value.to_u64(),
                None => false,
            },
            Pattern::Variant { tag, tag_width, .. } => {
                super::eval::matches_tag(value, *tag, *tag_width)
            }
            // Only an elaborated pattern can be matched
            Pattern::Path { .. } => false,
        }
    }

    /// Resolve a memory by its local name, honouring the current instance prefix
    fn resolve_memory(&self, name: &str) -> Option<&MemoryState> {
        let memories = self.memories?;
        if !self.prefix.is_empty() {
            if let Some(mem) = memories.get(&format!("{}.{}", self.prefix, name)) {
                return Some(mem);
            }
        }
        memories.get(name)
    }

    fn resolve_signal(&self, name: &str) -> Option<&SignalValue> {
        // A name bound by a match arm shadows everything else
        if let Some(value) = self.bindings.get(name) {
            return Some(value);
        }
        // An FSM's own signals shadow the module's
        if let Some(inner) = &self.inner {
            if let Some(val) = self.signals.get(&format!("{}.{}", inner, name)) {
                return Some(val);
            }
        }
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
        match expr {
            Expression::Call { name, .. } => Err(super::eval::EvalError::InvalidOperation(
                format!("call to unknown function '{}'", name),
            )),
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
                Ok(iris_runtime::ops::binop(
                    super::eval::runtime_binop(*op),
                    &l,
                    &r,
                    super::eval::is_unsized_literal(lhs),
                    super::eval::is_unsized_literal(rhs),
                ))
            }
            Expression::UnaryOp { op, expr } => {
                let val = self.eval(expr)?;
                Ok(iris_runtime::ops::unop(
                    super::eval::runtime_unop(*op),
                    &val,
                ))
            }
            Expression::MethodCall { receiver, method, args } => {
                // Reinterpretation and width methods (spec 3.4.2)
                match method.as_str() {
                    "signed" => {
                        if let Ok(v) = self.eval(receiver) {
                            return Ok(v.with_signed(true));
                        }
                    }
                    "unsigned" => {
                        if let Ok(v) = self.eval(receiver) {
                            return Ok(v.with_signed(false));
                        }
                    }
                    "sign_extend" => {
                        if let (Ok(v), Some(arg)) = (self.eval(receiver), args.first()) {
                            let width = self.eval(arg)?.to_u64().unwrap_or(0) as usize;
                            return Ok(v.sign_extend(width));
                        }
                    }
                    "extend" => {
                        if let (Ok(v), Some(arg)) = (self.eval(receiver), args.first()) {
                            let width = self.eval(arg)?.to_u64().unwrap_or(0) as usize;
                            return Ok(SignalValue::from_u64(v.to_u64().unwrap_or(0), width));
                        }
                    }
                    // `truncate` is listed beside `extend` in spec 3.4.2 and is
                    // implemented in the expression evaluator, but it was left
                    // out here. This is the evaluator that runs designs, so the
                    // method the specification documents twice did not work.
                    "truncate" => {
                        if let (Ok(v), Some(arg)) = (self.eval(receiver), args.first()) {
                            let width = self.eval(arg)?.to_u64().unwrap_or(0) as usize;
                            return Ok(v.truncate(width));
                        }
                    }
                    // `saturate` clamps instead of wrapping (spec 3.4.2).
                    "saturate" => {
                        if let (Ok(v), Some(arg)) = (self.eval(receiver), args.first()) {
                            let width = self.eval(arg)?.to_u64().unwrap_or(0) as usize;
                            let value = v.to_u64().unwrap_or(0);
                            let max = if width >= 64 { u64::MAX } else { (1u64 << width) - 1 };
                            return Ok(SignalValue::from_u64(value.min(max), width));
                        }
                    }
                    // The reduction operators of spec 9.2.3 and the width
                    // query. Like the bit-counting methods below, none of these
                    // existed, and a no-argument call resolves as a
                    // hierarchical name, so they gave nothing rather than
                    // saying they were unknown.
                    "and_reduce" | "or_reduce" | "xor_reduce" => {
                        if let Ok(v) = self.eval(receiver) {
                            let width = v.width();
                            let value = v.to_u64().unwrap_or(0);
                            let bits = (0..width).map(|i| (value >> i) & 1 == 1);
                            let result = match method.as_str() {
                                "and_reduce" => bits.into_iter().all(|b| b),
                                "or_reduce" => bits.into_iter().any(|b| b),
                                _ => bits.into_iter().filter(|b| *b).count() % 2 == 1,
                            };
                            return Ok(SignalValue::from_u64(result as u64, 1));
                        }
                    }
                    "width" => {
                        if let Ok(v) = self.eval(receiver) {
                            return Ok(SignalValue::from_u64(v.width() as u64, 32));
                        }
                    }
                    // `resize` is `extend` or `truncate` depending on which way
                    // it goes (spec 14, "error messages" recommends it).
                    "resize" => {
                        if let (Ok(v), Some(arg)) = (self.eval(receiver), args.first()) {
                            let width = self.eval(arg)?.to_u64().unwrap_or(0) as usize;
                            return Ok(if width < v.width() {
                                v.truncate(width)
                            } else {
                                SignalValue::from_u64(v.to_u64().unwrap_or(0), width)
                            });
                        }
                    }
                    "is_power_of_two" => {
                        if let Ok(v) = self.eval(receiver) {
                            let value = v.to_u64().unwrap_or(0);
                            let result = value != 0 && value & (value - 1) == 0;
                            return Ok(SignalValue::from_u64(result as u64, 1));
                        }
                    }
                    // The bit-counting methods of spec 9.2.4.
                    //
                    // None of these existed anywhere. A method with no argument
                    // is indistinguishable from a hierarchical name here, so
                    // instead of being reported they resolved to nothing and
                    // gave 0. `count_ones` on 8'b1010_0101 answered 0 where the
                    // specification's own example says 4.
                    "count_ones" | "count_zeros" | "leading_zeros" | "trailing_zeros"
                    | "reverse_bits" => {
                        if let Ok(v) = self.eval(receiver) {
                            let width = v.width();
                            let value = v.to_u64().unwrap_or(0);
                            let bits: Vec<bool> =
                                (0..width).map(|i| (value >> i) & 1 == 1).collect();
                            return Ok(match method.as_str() {
                                "count_ones" => SignalValue::from_u64(
                                    bits.iter().filter(|b| **b).count() as u64,
                                    32,
                                ),
                                "count_zeros" => SignalValue::from_u64(
                                    bits.iter().filter(|b| !**b).count() as u64,
                                    32,
                                ),
                                // Leading zeros are counted from the most
                                // significant end.
                                "leading_zeros" => SignalValue::from_u64(
                                    bits.iter().rev().take_while(|b| !**b).count() as u64,
                                    32,
                                ),
                                "trailing_zeros" => SignalValue::from_u64(
                                    bits.iter().take_while(|b| !**b).count() as u64,
                                    32,
                                ),
                                _ => {
                                    let mut reversed = 0u64;
                                    for (i, set) in bits.iter().enumerate() {
                                        if *set {
                                            reversed |= 1u64 << (width - 1 - i);
                                        }
                                    }
                                    SignalValue::from_u64(reversed, width)
                                }
                            });
                        }
                    }
                    _ => {}
                }
                // `u.m[1]` reads a memory inside an instance. It parses the
                // same way a method call does, so the memory has to be looked
                // up before the name is treated as a method.
                if args.len() == 1 {
                    if let Some(base) = dotted_path(receiver) {
                        let path = format!("{}.{}", base, method);
                        let addr = self.eval(&args[0])?.to_u64().unwrap_or(0) as usize;
                        if let Some(mem) = self.resolve_memory(&path) {
                            return if addr < mem.depth {
                                Ok(mem.data[addr].clone())
                            } else {
                                Err(super::eval::EvalError::InvalidOperation(format!(
                                    "address {} is outside memory '{}'",
                                    addr, path
                                )))
                            };
                        }
                    }
                }

                // `u.y[0]` selects a bit of an instance's output. It parses
                // the same way, so a signal of that name is an index too.
                if args.len() == 1 {
                    if let Some(base) = dotted_path(receiver) {
                        let path = format!("{}.{}", base, method);
                        if let Some(value) = self.resolve_signal(&path).cloned() {
                            let idx = self.eval(&args[0])?.to_u64().unwrap_or(0) as usize;
                            return Ok(iris_runtime::ops::bit(&value, idx));
                        }
                    }
                }

                // A call carrying arguments is a method, not a hierarchical
                // name. Saying "undefined signal 'a.sext'" for `a.sext[32]()`
                // sends the reader looking for a signal that was never meant.
                if !args.is_empty() {
                    return Err(super::eval::EvalError::InvalidOperation(format!(
                        "call to unknown method '{}'",
                        method
                    )));
                }

                // `dut.count` reads an instance's port, and `m.inner.rdata`
                // reads one two levels down. The second parses as a method call
                // whose receiver is itself a method call, so the chain is walked
                // back to the instance name rather than requiring a bare
                // identifier. The indexed forms above already do this.
                if let Some(base) = dotted_path(receiver) {
                    let full_name = format!("{}.{}", base, method);
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
                let addr_val = self.eval(addr)?;
                let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                if let Some(mem) = self.resolve_memory(mem_name) {
                    if addr_usize < mem.depth {
                        return Ok(mem.data[addr_usize].clone());
                    }
                    // Out-of-range reads return zero rather than aborting the assignment
                    return Ok(SignalValue::new(mem.element_width));
                }
                Err(super::eval::EvalError::UndefinedSignal(format!(
                    "memory read {}",
                    mem_name
                )))
            }
            Expression::Index { base, index } => {
                // Handle array indexing: base[index]
                // Could be memory read or bit slice
                if let Expression::Ident(name) = base.as_ref() {
                    // Try memory read first
                    if self.resolve_memory(name).is_some() {
                        let addr_val = self.eval(index)?;
                        let addr_usize = addr_val.to_u64().unwrap_or(0) as usize;
                        let mem = self.resolve_memory(name).unwrap();
                        if addr_usize < mem.depth {
                            return Ok(mem.data[addr_usize].clone());
                        }
                        return Ok(SignalValue::new(mem.element_width));
                    }
                }

                // Try as signal array access
                if let Expression::Ident(name) = base.as_ref() {
                    // Try to resolve as a hierarchical signal name
                    let prefixed_name = if self.prefix.is_empty() {
                        name.clone()
                    } else {
                        format!("{}.{}", self.prefix, name)
                    };

                    // Try the prefixed name first, then unprefixed
                    let signal_val = self.signals.get(&prefixed_name)
                        .or_else(|| self.signals.get(name));

                    if let Some(val) = signal_val {
                        let val = val.clone();
                        let idx = self.eval(index)?.to_u64().unwrap_or(0) as usize;
                        return Ok(iris_runtime::ops::bit(&val, idx));
                    }
                }

                // Not a plain signal name: evaluate the base as an expression.
                // This is what makes `u.y[3]` work, where `u.y` is an
                // instance output rather than a signal declared here.
                let base_val = self.eval(base)?;
                let idx = self.eval(index)?.to_u64().unwrap_or(0) as usize;
                Ok(iris_runtime::ops::bit(&base_val, idx))
            }
            Expression::Slice { base, high, low } => {
                // Bit slice: base[high:low]
                if let Expression::Ident(name) = base.as_ref() {
                    let prefixed_name = if self.prefix.is_empty() {
                        name.clone()
                    } else {
                        format!("{}.{}", self.prefix, name)
                    };
                    if let Some(val) = self.signals.get(&prefixed_name).or_else(|| self.signals.get(name)) {
                        let val = val.clone();
                        let high = self.eval(high)?.to_u64().unwrap_or(0) as usize;
                        let low = self.eval(low)?.to_u64().unwrap_or(0) as usize;
                        return Ok(iris_runtime::ops::slice(&val, high, low));
                    }
                }
                // Not a plain signal name: evaluate the base as an expression,
                // so that `u.y[1:0]` works on an instance output.
                let base_val = self.eval(base)?;
                let high = self.eval(high)?.to_u64().unwrap_or(0) as usize;
                let low = self.eval(low)?.to_u64().unwrap_or(0) as usize;
                Ok(iris_runtime::ops::slice(&base_val, high, low))
            }
            // `{4{8'hAB}}` (spec 9.7.2), unrolled into the concatenation it
            // stands for.
            Expression::Replicate { count, value } => {
                let times = self.eval(count)?.to_u64().unwrap_or(0) as usize;
                let mut repeated = Vec::new();
                for _ in 0..times {
                    repeated.extend(value.iter().cloned());
                }
                self.eval(&Expression::Concat(repeated))
            }
            Expression::Concat(exprs) => {
                let mut parts = Vec::with_capacity(exprs.len());
                for e in exprs {
                    parts.push(self.eval(e)?);
                }
                Ok(iris_runtime::ops::concat(&parts))
            }
            Expression::PartSelect {
                base,
                index,
                width,
                upward,
            } => {
                let base_val = self.eval(base)?;
                let index = self.eval(index)?.to_u64().unwrap_or(0) as usize;
                let width = self.eval(width)?.to_u64().unwrap_or(1).max(1) as usize;
                Ok(iris_runtime::ops::part_select(
                    &base_val, index, width, *upward,
                ))
            }
            Expression::SysFunc { name, args } => {
                use crate::parser::SysFuncArg;
                // Functions that inspect a value or a memory need the design context
                match (name.as_str(), args.first()) {
                    ("isunknown", Some(SysFuncArg::Expr(e))) => {
                        let value = self.eval(e)?;
                        let unknown = value.to_u64().is_none();
                        return Ok(SignalValue::from_u64(unknown as u64, 1));
                    }
                    ("onehot", Some(SysFuncArg::Expr(e))) => {
                        let value = self.eval(e)?.to_u64().unwrap_or(0);
                        return Ok(SignalValue::from_u64((value.count_ones() == 1) as u64, 1));
                    }
                    ("size", Some(SysFuncArg::Expr(e))) => {
                        // The argument may name a memory below this scope
                        if let Some(path) = super::eval::memory_path(e) {
                            if let Some(mem) = self.resolve_memory(&path) {
                                return Ok(SignalValue::from_u64(mem.depth as u64, 32));
                            }
                        }
                    }
                    _ => {}
                }
                super::eval::eval_sys_func(expr, |e| {
                    self.eval(e).ok().and_then(|v| v.to_u64()).map(|v| v as i64)
                })
                .map(|v| SignalValue::from_u64(v as u64, 32))
                .ok_or_else(|| {
                    super::eval::EvalError::InvalidOperation(format!("cannot evaluate {}", expr))
                })
            }
            Expression::Match { scrutinee, arms } => {
                let value = self.eval(scrutinee)?;
                for arm in arms {
                    if self.pattern_matches(&arm.pattern, &value) {
                        // A bound payload is visible only inside this arm
                        return match arm.pattern.payload_binding() {
                            Some((name, tag_width, payload_width)) => {
                                let payload =
                                    super::eval::payload_of(&value, tag_width, payload_width);
                                self.binding(name, payload).eval(&arm.value)
                            }
                            None => self.eval(&arm.value),
                        };
                    }
                }
                Err(super::eval::EvalError::InvalidOperation(
                    "match expression has no arm covering the value".to_string(),
                ))
            }
        }
    }
}

/// The name a coverage point is reported under
pub fn cover_name(cover: &crate::parser::CoverStmt) -> String {
    cover
        .name
        .clone()
        .unwrap_or_else(|| format!("{}", cover.condition))
}

/// Every coverage point in a module and the instances below it
fn collect_cover_names(module: &Module, project: &Project, out: &mut Vec<String>) {
    fn walk(stmts: &[Statement], out: &mut Vec<String>) {
        for stmt in stmts {
            match stmt {
                Statement::Cover(cover) => out.push(cover_name(cover)),
                Statement::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    walk(then_branch, out);
                    if let Some(branch) = else_branch {
                        walk(branch, out);
                    }
                }
                Statement::For { body, .. } | Statement::While { body, .. } => walk(body, out),
                Statement::Match { arms, .. } => {
                    for arm in arms {
                        walk(&arm.body, out);
                    }
                }
                _ => {}
            }
        }
    }

    fn walk_seq(stmts: &[SeqStatement], out: &mut Vec<String>) {
        for stmt in stmts {
            match stmt {
                SeqStatement::Cover(cover) => out.push(cover_name(cover)),
                SeqStatement::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    walk_seq(then_branch, out);
                    if let Some(branch) = else_branch {
                        walk_seq(branch, out);
                    }
                }
                SeqStatement::For { body, .. } | SeqStatement::While { body, .. } => {
                    walk_seq(body, out)
                }
                _ => {}
            }
        }
    }

    for block in &module.logic_blocks {
        let statements = match block {
            LogicBlock::Comb(comb) => &comb.statements,
            LogicBlock::Sync(sync) => &sync.statements,
        };
        walk(statements, out);
    }
    for block in &module.initial_blocks {
        walk_seq(&block.statements, out);
    }
    for block in &module.seq_blocks {
        walk_seq(&block.statements, out);
    }
    for inst in &module.instances {
        if let Some(child) = project.get_module(&inst.module_name) {
            collect_cover_names(child, project, out);
        }
    }
}
