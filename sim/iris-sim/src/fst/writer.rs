//! Waveform writer module
//!
//! Provides waveform output functionality supporting VCD format.
//! VCD files can be viewed with GTKWave.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use thiserror::Error;

use crate::sim::SignalTrace;
use iris_runtime::trace::{vcd_ident, write_scoped_vars, VarDecl};
use crate::types::{BitValue, SignalValue, SimTime};

/// Waveform output error
#[derive(Error, Debug)]
pub enum WaveformError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid signal: {0}")]
    InvalidSignal(String),
}

/// Trait for waveform writers
pub trait WaveWriter: Sized {
    /// Create a new writer for the given path
    fn new(path: &Path) -> Result<Self, WaveformError>;

    /// Set timescale (e.g., "1ns", "1ps")
    fn set_timescale(&mut self, timescale: &str);

    /// Write complete trace to waveform file
    fn write_trace(&mut self, trace: &SignalTrace, module_name: &str) -> Result<(), WaveformError>;

    /// Close the writer and finalize the file
    fn close(self) -> Result<(), WaveformError>;
}

/// VCD waveform writer
pub struct VcdWriter {
    writer: BufWriter<File>,
    signals: HashMap<String, (String, usize)>, // name -> (id_code, width)
    next_count: usize,
    timescale: String,
}

impl VcdWriter {
    /// Create a new VCD writer (internal constructor)
    fn create(path: &Path) -> Result<Self, WaveformError> {
        let file = File::create(path)?;
        Ok(Self {
            writer: BufWriter::new(file),
            signals: HashMap::new(),
            next_count: 0,
            timescale: "1ps".to_string(),
        })
    }

    /// Write VCD header
    fn write_header(&mut self, module_name: &str) -> Result<(), WaveformError> {
        writeln!(self.writer, "$date")?;
        writeln!(self.writer, "   Simulation output")?;
        writeln!(self.writer, "$end")?;
        writeln!(self.writer, "$version")?;
        writeln!(self.writer, "   IRIS-SIM 0.1.0")?;
        writeln!(self.writer, "$end")?;
        writeln!(self.writer, "$timescale")?;
        writeln!(self.writer, "   {}", self.timescale)?;
        writeln!(self.writer, "$end")?;
        writeln!(self.writer, "$scope module {} $end", module_name)?;
        Ok(())
    }

    /// Register a signal and allocate its identifier.
    ///
    /// The `$var` line is not written here: declarations are emitted together
    /// afterwards so that dotted names can be grouped into nested `$scope`
    /// blocks.
    fn add_signal(&mut self, name: &str, width: usize) -> Result<String, WaveformError> {
        let id = vcd_ident(self.next_count);
        self.signals.insert(name.to_string(), (id.clone(), width));
        self.next_count += 1;
        Ok(id)
    }

    /// Write signal value
    fn write_value(&mut self, id: &str, value: &SignalValue) -> Result<(), WaveformError> {
        let width = value.width();
        if width == 1 {
            let bit = value.get_bit(0).unwrap_or(BitValue::X);
            writeln!(self.writer, "{}{}", bit.to_char(), id)?;
        } else {
            write!(self.writer, "b")?;
            for i in (0..width).rev() {
                let bit = value.get_bit(i).unwrap_or(BitValue::X);
                write!(self.writer, "{}", bit.to_char())?;
            }
            writeln!(self.writer, " {}", id)?;
        }
        Ok(())
    }

    /// Write time stamp
    fn write_time(&mut self, time: SimTime) -> Result<(), WaveformError> {
        writeln!(self.writer, "#{}", time)?;
        Ok(())
    }

    /// Write complete trace to VCD file (internal implementation)
    fn write_trace_internal(
        &mut self,
        trace: &SignalTrace,
        module_name: &str,
    ) -> Result<(), WaveformError> {
        // Write header
        self.write_header(module_name)?;

        // Collect all signal names and add definitions
        let signal_names: Vec<String> = trace.signal_names().cloned().collect();
        let mut decls: Vec<VarDecl> = Vec::with_capacity(signal_names.len());
        for name in &signal_names {
            let width = trace.get_width(name).unwrap_or(1);
            let id = self.add_signal(name, width)?;
            decls.push((name.clone(), id, width, trace.is_signed(name)));
        }
        write_scoped_vars(&mut self.writer, &decls)?;

        // Close scope and end definitions
        writeln!(self.writer, "$upscope $end")?;
        writeln!(self.writer, "$enddefinitions $end")?;

        // Collect all time points
        let mut all_times: Vec<SimTime> = Vec::new();
        for (_, changes) in trace.signals() {
            for (time, _) in changes {
                if !all_times.contains(time) {
                    all_times.push(*time);
                }
            }
        }
        all_times.sort();

        // Write initial values (dumpvars)
        writeln!(self.writer, "$dumpvars")?;
        for name in &signal_names {
            if let Some((id, _)) = self.signals.get(name) {
                let id = id.clone();
                if let Some(changes) = trace.get_changes(name) {
                    if let Some((_, value)) = changes.first() {
                        self.write_value(&id, value)?;
                    }
                }
            }
        }
        writeln!(self.writer, "$end")?;

        // Write value changes at each time point
        let mut current_values: HashMap<String, SignalValue> = HashMap::new();

        // Initialize with first values
        for name in &signal_names {
            if let Some(changes) = trace.get_changes(name) {
                if let Some((_, value)) = changes.first() {
                    current_values.insert(name.clone(), value.clone());
                }
            }
        }

        for time in &all_times {
            let mut time_written = false;

            for name in &signal_names {
                if let Some(changes) = trace.get_changes(name) {
                    for (t, value) in changes {
                        if t == time {
                            // Check if value actually changed
                            let changed = current_values
                                .get(name)
                                .map(|v| v != value)
                                .unwrap_or(true);

                            if changed || *time == 0 {
                                if !time_written {
                                    self.write_time(*time)?;
                                    time_written = true;
                                }

                                if let Some((id, _)) = self.signals.get(name) {
                                    let id = id.clone();
                                    self.write_value(&id, value)?;
                                }
                                current_values.insert(name.clone(), value.clone());
                            }
                        }
                    }
                }
            }
        }

        self.writer.flush()?;
        Ok(())
    }

    /// Close the writer
    pub fn close_internal(mut self) -> Result<(), WaveformError> {
        self.writer.flush()?;
        Ok(())
    }
}

impl WaveWriter for VcdWriter {
    fn new(path: &Path) -> Result<Self, WaveformError> {
        VcdWriter::create(path)
    }

    fn set_timescale(&mut self, timescale: &str) {
        self.timescale = timescale.to_string();
    }

    fn write_trace(&mut self, trace: &SignalTrace, module_name: &str) -> Result<(), WaveformError> {
        self.write_trace_internal(trace, module_name)
    }

    fn close(self) -> Result<(), WaveformError> {
        self.close_internal()
    }
}
