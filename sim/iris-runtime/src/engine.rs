//! Simulation state for compiled designs
//!
//! `iris-compile` turns a design into straight-line Rust: every signal becomes
//! a fixed slot, every block becomes a function. What stays the same from one
//! design to the next — storing a value at its declared width, driving clocks,
//! reporting a failed assertion — lives here.


use crate::ops;
use crate::trace::SignalTrace;
use crate::value::SignalValue;
use crate::SimTime;

/// What a suspended sequential program is waiting for
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wait {
    /// Nothing; the next instruction may run
    Ready,
    /// This many more clock edges
    Edges(u64),
    /// This point in time
    Time(SimTime),
    /// The program has run to the end
    Done,
}

/// How a violated assertion is reported
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// Reported; the run fails
    Error,
    /// Reported; the run still succeeds
    Warning,
    /// Reported; the run stops immediately
    Fatal,
}

/// A violated assertion
#[derive(Debug, Clone)]
pub struct Failure {
    /// When it was detected
    pub time: SimTime,
    /// The condition as written
    pub condition: String,
    /// The message given after `else`
    pub message: Option<String>,
    /// How to report it
    pub severity: Severity,
    /// Line and column in the source
    pub line: usize,
    /// Column in the source
    pub col: usize,
    /// Both sides of a comparison, when the condition was one
    pub operands: Option<(String, String)>,
}

/// A memory
#[derive(Debug, Clone)]
pub struct Memory {
    /// Bits per word
    pub element_width: usize,
    /// Number of words
    pub depth: usize,
    /// Contents
    pub data: Vec<SignalValue>,
    /// Writes are ignored
    pub is_rom: bool,
}

impl Memory {
    /// Create a memory of zeroed words
    pub fn new(element_width: usize, depth: usize, is_rom: bool) -> Self {
        Self {
            element_width,
            depth,
            data: vec![SignalValue::new(element_width); depth],
            is_rom,
        }
    }
}

/// A clock, with the time of its next transition
#[derive(Debug, Clone)]
pub struct ClockState {
    /// Slot of the clock signal
    pub slot: usize,
    /// Full period in picoseconds
    pub period: SimTime,
    /// Current level
    pub value: u64,
    /// Time of the next transition
    pub next_edge: SimTime,
}

/// A reset signal
#[derive(Debug, Clone, Copy)]
pub struct ResetState {
    /// Slot of the reset signal
    pub slot: usize,
    /// Asserted when low
    pub active_low: bool,
}

/// One signal in a compiled design
#[derive(Debug, Clone)]
pub struct SlotDef {
    /// Hierarchical name, as it appears in the waveform
    pub name: String,
    /// Declared width, or `None` for a name that only appears as an
    /// assignment target and so takes the width of the first value stored
    pub width: Option<usize>,
    /// Are the bits read as two's complement?
    pub signed: bool,
    /// Keep out of the waveform (loop variables and the like)
    pub hidden: bool,
}

impl SlotDef {
    /// A declared signal
    pub fn new(name: &str, width: usize, signed: bool) -> Self {
        Self {
            name: name.to_string(),
            width: Some(width),
            signed,
            hidden: false,
        }
    }

    /// A name that never appears in a declaration. It takes the width of the
    /// first value stored in it, and only then joins the waveform.
    pub fn undeclared(name: &str) -> Self {
        Self {
            name: name.to_string(),
            width: None,
            signed: false,
            hidden: false,
        }
    }

    /// Keep this slot out of the waveform
    pub fn hidden(mut self) -> Self {
        self.hidden = true;
        self
    }
}

/// Everything a compiled simulation needs to keep between steps
pub struct Runtime {
    /// Current value of every signal, indexed by slot
    pub sig: Vec<SignalValue>,
    /// Hierarchical name of every slot
    pub names: Vec<String>,
    /// Has a width been settled for this slot?
    established: Vec<bool>,
    /// Memories, indexed by slot
    pub mems: Vec<Memory>,
    /// Clocks
    pub clocks: Vec<ClockState>,
    /// Resets
    pub resets: Vec<ResetState>,
    /// Recorded waveform
    pub trace: SignalTrace,
    /// Whether to record into `trace`.
    ///
    /// Recording keys a hash map by signal name on every write and keeps every
    /// change for the life of the run, so it costs both time and memory that a
    /// run producing no waveform has no reason to pay. Off unless a caller asks.
    pub tracing: bool,
    /// Current time in picoseconds
    pub time: SimTime,
    /// Set by `$finish`
    pub finished: bool,
    /// A reset is currently asserted
    pub reset_active: bool,
    /// The initial and seq blocks have run
    pub initial_executed: bool,
    /// Elapsed cycles of the primary clock, used to release reset
    pub cycle_count: u64,
    /// Where the sequential program resumes
    pub seq_pc: usize,
    /// What the sequential program is waiting for
    pub seq_wait: Wait,
    /// When an `await until(...)` gives up
    pub seq_deadline: Option<SimTime>,
    /// Violated assertions, in the order detected
    pub failures: Vec<Failure>,
    /// Coverage points: how often each condition held, in declaration order
    pub coverage: Vec<(String, u64)>,
    /// The generator `$randomize` draws from
    pub rng: crate::random::Rng,
    /// Slots excluded from the waveform (loop variables and the like).
    ///
    /// Indexed by slot rather than hashed: slots are dense indices from zero,
    /// and this is read on every write to a signal.
    hidden: Vec<bool>,
}

impl Runtime {
    /// Create the state for a design
    pub fn new(slots: Vec<SlotDef>) -> Self {
        let sig = slots
            .iter()
            .map(|s| SignalValue::new(s.width.unwrap_or(0)).with_signed(s.signed))
            .collect();
        let established = slots.iter().map(|s| s.width.is_some()).collect();
        let hidden: Vec<bool> = slots.iter().map(|s| s.hidden).collect();
        let names = slots.into_iter().map(|s| s.name).collect();
        Self {
            sig,
            names,
            established,
            mems: Vec::new(),
            clocks: Vec::new(),
            resets: Vec::new(),
            trace: SignalTrace::new(),
            tracing: false,
            time: 0,
            finished: false,
            reset_active: false,
            initial_executed: false,
            cycle_count: 0,
            seq_pc: 0,
            seq_wait: Wait::Ready,
            seq_deadline: None,
            failures: Vec::new(),
            coverage: Vec::new(),
            rng: crate::random::Rng::default(),
            hidden,
        }
    }

    /// Is this slot kept out of the waveform?
    pub fn is_hidden(&self, slot: usize) -> bool {
        self.hidden[slot]
    }

    /// Does this slot appear in the waveform and in a final-value listing?
    ///
    /// A name that only ever appears as an assignment target has no value
    /// until something assigns to it, so until then it is not a signal.
    pub fn is_visible(&self, slot: usize) -> bool {
        !self.hidden[slot] && self.established[slot]
    }

    /// Record the starting value of every visible slot.
    ///
    /// A slot whose width is not settled yet has no value to record: the
    /// interpreter has no entry for that name until something assigns to it.
    pub fn record_initial(&mut self) {
        if !self.tracing {
            return;
        }
        for slot in 0..self.sig.len() {
            if self.hidden[slot] || !self.established[slot] {
                continue;
            }
            let value = self.sig[slot].clone();
            self.trace.record(&self.names[slot], 0, value);
        }
    }

    /// Read a slot
    #[inline]
    pub fn get(&self, slot: usize) -> &SignalValue {
        &self.sig[slot]
    }

    /// Read a slot as a number, treating unknown bits as zero
    #[inline]
    pub fn get_u64(&self, slot: usize) -> u64 {
        self.sig[slot].to_u64().unwrap_or(0)
    }

    /// Store a value, fitted to the slot's width. Returns whether it changed.
    ///
    /// A name that never appeared in a declaration takes the width of the first
    /// value stored in it, and is fitted to that width from then on.
    #[inline]
    pub fn set(&mut self, slot: usize, value: SignalValue) -> bool {
        let value = if self.established[slot] {
            ops::coerce(value, self.sig[slot].width(), self.sig[slot].is_signed())
        } else {
            self.established[slot] = true;
            value
        };
        let changed = self.sig[slot] != value;
        // The clone belongs to the recording, not to the store. Cloning first
        // and recording second costs an allocation on every write of a run that
        // records nothing.
        if self.tracing && changed && !self.hidden[slot] {
            self.trace.record(&self.names[slot], self.time, value.clone());
        }
        self.sig[slot] = value;
        changed
    }

    /// Store a value without fitting it to a width and without recording it.
    ///
    /// A loop variable is written this way: the interpreter puts it straight
    /// into its signal table, so it never appears in the waveform.
    #[inline]
    pub fn set_silent(&mut self, slot: usize, value: SignalValue) {
        self.established[slot] = true;
        self.sig[slot] = value;
    }

    /// Store a value without fitting it to a declared width
    #[inline]
    pub fn set_raw(&mut self, slot: usize, value: SignalValue) {
        // The comparison only decides whether to record. A run keeping no
        // waveform has no reason to make it.
        if self.tracing && !self.hidden[slot] && self.sig[slot] != value {
            self.trace.record(&self.names[slot], self.time, value.clone());
        }
        self.sig[slot] = value;
    }

    /// Store a number into a slot, fitted to its declared width.
    ///
    /// The narrow counterpart of `get_u64`. Where the generator has proved an
    /// expression is unsigned arithmetic over known-width signals, the whole
    /// store is a mask and a field write: no value is built and none is moved.
    #[inline]
    pub fn set_u64(&mut self, slot: usize, value: u64) {
        self.established[slot] = true;
        if self.tracing && !self.hidden[slot] {
            // Recording needs the value as a value, and needs to know whether
            // it changed, so this path stays as it was.
            let mut next = self.sig[slot].clone();
            next.set_word(value);
            if self.sig[slot] != next {
                self.trace.record(&self.names[slot], self.time, next.clone());
            }
            self.sig[slot] = next;
            return;
        }
        self.sig[slot].set_word(value);
    }

    /// Store a value, fitting it to the slot's width, without reporting whether
    /// it changed.
    ///
    /// A `sync` block discards that answer — only the combinational settle uses
    /// it — so this skips the comparison the same way `set_raw` does.
    #[inline]
    pub fn store(&mut self, slot: usize, value: SignalValue) {
        let value = if self.established[slot] {
            ops::coerce(value, self.sig[slot].width(), self.sig[slot].is_signed())
        } else {
            self.established[slot] = true;
            value
        };
        if self.tracing && !self.hidden[slot] && self.sig[slot] != value {
            self.trace.record(&self.names[slot], self.time, value.clone());
        }
        self.sig[slot] = value;
    }

    /// Read one word. Reads past the end give zero rather than aborting.
    pub fn mem_read(&self, mem: usize, addr: usize) -> SignalValue {
        let m = &self.mems[mem];
        if addr < m.depth {
            m.data[addr].clone()
        } else {
            SignalValue::new(m.element_width)
        }
    }

    /// Write one word. Returns whether the memory changed.
    pub fn mem_write(&mut self, mem: usize, addr: usize, value: SignalValue) -> bool {
        let m = &mut self.mems[mem];
        if m.is_rom || addr >= m.depth {
            return false;
        }
        let value = ops::coerce(value, m.element_width, false);
        let changed = m.data[addr] != value;
        m.data[addr] = value;
        changed
    }

    /// Zero every word of a memory
    pub fn mem_clear(&mut self, mem: usize) {
        let m = &mut self.mems[mem];
        if m.is_rom {
            return;
        }
        let width = m.element_width;
        for word in m.data.iter_mut() {
            *word = SignalValue::new(width);
        }
    }

    /// Number of words in a memory
    pub fn mem_depth(&self, mem: usize) -> usize {
        self.mems[mem].depth
    }

    /// Is the reset driving this slot asserted?
    pub fn reset_asserted(&self, slot: usize, active_low: bool) -> bool {
        let level = self.sig[slot].to_u64().unwrap_or(if active_low { 1 } else { 0 });
        if active_low {
            level == 0
        } else {
            level == 1
        }
    }

    /// Drive every reset to its asserted level
    pub fn assert_resets(&mut self) {
        for i in 0..self.resets.len() {
            let r = self.resets[i];
            let level = if r.active_low { 0 } else { 1 };
            self.set_raw(r.slot, SignalValue::from_u64(level, 1));
        }
        self.reset_active = true;
    }

    /// Drive every reset to its released level
    pub fn deassert_resets(&mut self) {
        for i in 0..self.resets.len() {
            let r = self.resets[i];
            let level = if r.active_low { 1 } else { 0 };
            self.set_raw(r.slot, SignalValue::from_u64(level, 1));
        }
        self.reset_active = false;
    }

    /// Time of the earliest clock transition after now, if any
    pub fn next_edge_time(&self) -> Option<SimTime> {
        self.clocks
            .iter()
            .filter(|c| c.next_edge > self.time)
            .map(|c| c.next_edge)
            .min()
    }

    /// Toggle every clock due at the current time.
    ///
    /// Returns the clocks that went from low to high; those are the edges that
    /// run sequential logic.
    pub fn advance_clocks(&mut self) -> Vec<usize> {
        let mut rising = Vec::new();
        for i in 0..self.clocks.len() {
            if self.clocks[i].next_edge != self.time {
                continue;
            }
            if self.clocks[i].value == 0 {
                rising.push(i);
            }
            self.clocks[i].value = 1 - self.clocks[i].value;
            let level = self.clocks[i].value;
            let slot = self.clocks[i].slot;
            self.set_raw(slot, SignalValue::from_u64(level, 1));
            self.clocks[i].next_edge += self.clocks[i].period / 2;
        }
        rising
    }

    /// Has what the sequential program was waiting for arrived?
    ///
    /// `edge` says whether a clock edge just happened.
    pub fn seq_ready(&mut self, edge: bool) -> bool {
        match self.seq_wait {
            Wait::Done => false,
            Wait::Ready => true,
            Wait::Edges(remaining) => {
                if !edge {
                    return false;
                }
                let remaining = remaining.saturating_sub(1);
                if remaining > 0 {
                    self.seq_wait = Wait::Edges(remaining);
                    return false;
                }
                self.seq_wait = Wait::Ready;
                true
            }
            Wait::Time(deadline) => {
                if self.time < deadline {
                    return false;
                }
                self.seq_wait = Wait::Ready;
                true
            }
        }
    }

    /// Note that a coverage point was reached
    pub fn cover(&mut self, index: usize, name: &str, held: bool) {
        while self.coverage.len() <= index {
            let placeholder = self.coverage.len();
            let _ = placeholder;
            self.coverage.push((name.to_string(), 0));
        }
        self.coverage[index].0 = name.to_string();
        if held {
            self.coverage[index].1 += 1;
        }
    }

    /// Print how often each coverage point held
    pub fn report_coverage(&self) {
        report_coverage(&self.coverage);
    }

    /// Record a violated assertion
    #[allow(clippy::too_many_arguments)]
    pub fn fail(
        &mut self,
        condition: &str,
        message: Option<&str>,
        severity: Severity,
        line: usize,
        col: usize,
        operands: Option<(String, String)>,
    ) {
        self.failures.push(Failure {
            time: self.time,
            condition: condition.to_string(),
            message: message.map(|m| m.to_string()),
            severity,
            line,
            col,
            operands,
        });
        if severity == Severity::Fatal {
            self.finished = true;
        }
    }

    /// Print the failures in the same form as the interpreter.
    /// Returns true when at least one of them fails the run.
    pub fn report_failures(&self, source: &str) -> bool {
        if self.failures.is_empty() {
            return false;
        }

        eprintln!();
        eprintln!("=== Assertion Failures ===");

        for (i, failure) in self.failures.iter().enumerate() {
            let time_ns = failure.time as f64 / 1000.0;
            let kind = match failure.severity {
                Severity::Warning => "warning",
                _ => "error",
            };

            eprintln!();
            eprintln!("{}[A{:03}]: assertion failed", kind, i + 1);
            if failure.line > 0 {
                eprintln!("  --> {}:{}:{}", source, failure.line, failure.col);
            }
            eprintln!("   |");
            eprintln!("   | assert {}", failure.condition);
            eprintln!("   |");
            if let Some((ref lhs, ref rhs)) = failure.operands {
                eprintln!("   = note: left  = {}", lhs);
                eprintln!("   = note: right = {}", rhs);
            }
            if let Some(ref msg) = failure.message {
                eprintln!("   = message: \"{}\"", msg);
            }
            eprintln!("   = time: {:.1}ns ({} ps)", time_ns, failure.time);
        }

        let fatal = self
            .failures
            .iter()
            .filter(|f| f.severity != Severity::Warning)
            .count();
        let warnings = self.failures.len() - fatal;

        eprintln!();
        eprintln!(
            "assertion failure summary: {} failed, {} warning(s)",
            fatal, warnings
        );
        eprintln!();

        fatal > 0
    }
}

/// How one `$display` conversion is filled in
pub enum Arg<'a> {
    /// A value, printed according to the conversion
    Value(&'a SignalValue),
    /// A literal string, for `%s`
    Text(&'a str),
}

/// Render a `$display` format string.
///
/// `%d`, `%h`/`%x`, `%b` and `%s` each consume one argument; `%%` is a literal
/// percent sign. A width modifier such as `%0d` is accepted and ignored.
pub fn format_display(format: &str, args: &[Arg]) -> String {
    let mut rest = args.iter();
    let mut out = String::new();
    let mut chars = format.chars().peekable();

    let number = |arg: Option<&Arg>| -> u64 {
        match arg {
            Some(Arg::Value(v)) => v.to_u64().unwrap_or(0),
            _ => 0,
        }
    };

    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        while matches!(chars.peek(), Some(d) if d.is_ascii_digit()) {
            chars.next();
        }
        match chars.next() {
            Some('%') => out.push('%'),
            Some('d') => out.push_str(&number(rest.next()).to_string()),
            Some('h') | Some('x') => out.push_str(&format!("{:x}", number(rest.next()))),
            Some('b') => out.push_str(&format!("{:b}", number(rest.next()))),
            Some('s') => match rest.next() {
                Some(Arg::Text(text)) => out.push_str(text),
                other => out.push_str(&number(other).to_string()),
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

/// Print how often each coverage point held.
///
/// Shared so that the interpreter and a compiled run report identically.
pub fn report_coverage(points: &[(String, u64)]) {
    if points.is_empty() {
        return;
    }
    println!();
    println!("=== Coverage ===");
    let mut hit = 0;
    for (name, count) in points {
        if *count > 0 {
            hit += 1;
        }
        println!("  {}: {}", name, count);
    }
    println!(
        "coverage summary: {} of {} points reached",
        hit,
        points.len()
    );
}
