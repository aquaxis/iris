//! Waveform recording and VCD output
//!
//! Both the interpreter and a compiled simulation record into a `SignalTrace`
//! and write it out with `write_vcd`, so the two produce byte-identical
//! waveforms for the same design.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::value::{BitValue, SignalValue};
use crate::SimTime;

/// Recorded value changes, per signal
#[derive(Clone, Debug, Default)]
pub struct SignalTrace {
    /// Value changes, in the order they were recorded
    signals: HashMap<String, Vec<(SimTime, SignalValue)>>,
    /// Declared width of each signal
    widths: HashMap<String, usize>,
    /// Signal names in the order they were first recorded
    order: Vec<String>,
}

impl SignalTrace {
    /// Create an empty trace
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a value change. Repeating the current value is ignored.
    pub fn record(&mut self, name: &str, time: SimTime, value: SignalValue) {
        self.widths.insert(name.to_string(), value.width());

        let changes = match self.signals.get_mut(name) {
            Some(changes) => changes,
            None => {
                self.order.push(name.to_string());
                self.signals.entry(name.to_string()).or_default()
            }
        };

        if changes.is_empty() || changes.last().map(|(_, v)| v != &value).unwrap_or(true) {
            changes.push((time, value));
        }
    }

    /// Changes recorded for one signal
    pub fn get_changes(&self, name: &str) -> Option<&Vec<(SimTime, SignalValue)>> {
        self.signals.get(name)
    }

    /// Every signal name, in the order first recorded
    pub fn signal_names(&self) -> impl Iterator<Item = &String> {
        self.order.iter()
    }

    /// Declared width of a signal
    pub fn get_width(&self, name: &str) -> Option<usize> {
        self.widths.get(name).copied()
    }

    /// Every signal with its changes
    pub fn signals(&self) -> impl Iterator<Item = (&String, &Vec<(SimTime, SignalValue)>)> {
        self.signals.iter()
    }

    /// Time of the last recorded change
    pub fn end_time(&self) -> SimTime {
        self.signals
            .values()
            .filter_map(|changes| changes.last().map(|(t, _)| *t))
            .max()
            .unwrap_or(0)
    }

    /// Write the trace as a VCD file
    pub fn write_vcd(&self, path: &Path, module_name: &str) -> std::io::Result<()> {
        let mut writer = BufWriter::new(File::create(path)?);
        write_vcd_to(&mut writer, self, module_name, "1ps")?;
        writer.flush()
    }
}

/// Render a trace in VCD form
pub fn write_vcd_to<W: Write>(
    out: &mut W,
    trace: &SignalTrace,
    module_name: &str,
    timescale: &str,
) -> std::io::Result<()> {
    writeln!(out, "$date")?;
    writeln!(out, "   Simulation output")?;
    writeln!(out, "$end")?;
    writeln!(out, "$version")?;
    writeln!(out, "   IRIS-SIM 0.1.0")?;
    writeln!(out, "$end")?;
    writeln!(out, "$timescale")?;
    writeln!(out, "   {}", timescale)?;
    writeln!(out, "$end")?;
    writeln!(out, "$scope module {} $end", module_name)?;

    // VCD identifies signals by a short printable code
    let names: Vec<String> = trace.signal_names().cloned().collect();
    let mut ids: HashMap<String, char> = HashMap::new();
    let mut next_id = b'!';
    for name in &names {
        let id = next_id as char;
        ids.insert(name.clone(), id);
        let width = trace.get_width(name).unwrap_or(1);
        if width == 1 {
            writeln!(out, "$var wire {} {} {} $end", width, id, name)?;
        } else {
            writeln!(
                out,
                "$var wire {} {} {} [{}:0] $end",
                width,
                id,
                name,
                width - 1
            )?;
        }
        next_id = if next_id >= b'~' { b'!' } else { next_id + 1 };
    }

    writeln!(out, "$upscope $end")?;
    writeln!(out, "$enddefinitions $end")?;

    let mut all_times: Vec<SimTime> = Vec::new();
    for (_, changes) in trace.signals() {
        for (time, _) in changes {
            all_times.push(*time);
        }
    }
    all_times.sort_unstable();
    all_times.dedup();

    writeln!(out, "$dumpvars")?;
    for name in &names {
        if let (Some(id), Some(changes)) = (ids.get(name), trace.get_changes(name)) {
            if let Some((_, value)) = changes.first() {
                write_value(out, *id, value)?;
            }
        }
    }
    writeln!(out, "$end")?;

    let mut current: HashMap<&str, &SignalValue> = HashMap::new();
    for name in &names {
        if let Some(changes) = trace.get_changes(name) {
            if let Some((_, value)) = changes.first() {
                current.insert(name.as_str(), value);
            }
        }
    }

    for time in &all_times {
        let mut time_written = false;
        for name in &names {
            let Some(changes) = trace.get_changes(name) else {
                continue;
            };
            for (t, value) in changes {
                if t != time {
                    continue;
                }
                let changed = current.get(name.as_str()).map(|v| *v != value).unwrap_or(true);
                if changed || *time == 0 {
                    if !time_written {
                        writeln!(out, "#{}", time)?;
                        time_written = true;
                    }
                    if let Some(id) = ids.get(name) {
                        write_value(out, *id, value)?;
                    }
                    current.insert(name.as_str(), value);
                }
            }
        }
    }

    Ok(())
}

fn write_value<W: Write>(out: &mut W, id: char, value: &SignalValue) -> std::io::Result<()> {
    let width = value.width();
    if width == 1 {
        let bit = value.get_bit(0).unwrap_or(BitValue::X);
        writeln!(out, "{}{}", bit.to_char(), id)
    } else {
        write!(out, "b")?;
        for i in (0..width).rev() {
            let bit = value.get_bit(i).unwrap_or(BitValue::X);
            write!(out, "{}", bit.to_char())?;
        }
        writeln!(out, " {}", id)
    }
}
