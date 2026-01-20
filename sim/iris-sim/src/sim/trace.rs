//! Signal trace for waveform recording
//!
//! Records signal value changes over simulation time.

use std::collections::HashMap;

use crate::types::{SignalValue, SimTime};

/// Signal trace for recording waveforms
#[derive(Clone, Debug)]
pub struct SignalTrace {
    /// Map from signal name to list of (time, value) pairs
    signals: HashMap<String, Vec<(SimTime, SignalValue)>>,
    /// Signal widths
    widths: HashMap<String, usize>,
}

impl SignalTrace {
    /// Create a new empty trace
    pub fn new() -> Self {
        Self {
            signals: HashMap::new(),
            widths: HashMap::new(),
        }
    }

    /// Record a signal value change
    pub fn record(&mut self, name: &str, time: SimTime, value: SignalValue) {
        let width = value.width();
        self.widths.insert(name.to_string(), width);

        let changes = self.signals.entry(name.to_string()).or_insert_with(Vec::new);

        // Only record if value actually changed or this is the first value
        if changes.is_empty() || changes.last().map(|(_, v)| v != &value).unwrap_or(true) {
            changes.push((time, value));
        }
    }

    /// Get signal changes for a specific signal
    pub fn get_changes(&self, name: &str) -> Option<&Vec<(SimTime, SignalValue)>> {
        self.signals.get(name)
    }

    /// Get all signal names
    pub fn signal_names(&self) -> impl Iterator<Item = &String> {
        self.signals.keys()
    }

    /// Get signal width
    pub fn get_width(&self, name: &str) -> Option<usize> {
        self.widths.get(name).copied()
    }

    /// Get all signals with their changes
    pub fn signals(&self) -> impl Iterator<Item = (&String, &Vec<(SimTime, SignalValue)>)> {
        self.signals.iter()
    }

    /// Get the end time of the trace
    pub fn end_time(&self) -> SimTime {
        self.signals
            .values()
            .filter_map(|changes| changes.last().map(|(t, _)| *t))
            .max()
            .unwrap_or(0)
    }
}

impl Default for SignalTrace {
    fn default() -> Self {
        Self::new()
    }
}
