//! Waveform writer module
//!
//! Provides waveform output functionality supporting VCD and FST formats.
//! VCD files can be viewed with GTKWave or converted to FST using vcd2fst.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use thiserror::Error;

use crate::sim::SignalTrace;
use crate::types::{BitValue, SignalValue, SimTime};

/// Waveform output error
#[derive(Error, Debug)]
pub enum WaveformError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid signal: {0}")]
    InvalidSignal(String),
    #[error("FST error: {0}")]
    FstError(String),
}

/// Waveform output format
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaveformFormat {
    /// VCD (Value Change Dump) - IEEE 1364 standard text format
    Vcd,
    /// FST (Fast Signal Trace) - GTKWave binary format
    Fst,
}

impl WaveformFormat {
    /// Detect format from file extension
    pub fn from_extension(path: &Path) -> Self {
        match path.extension().and_then(|e| e.to_str()) {
            Some("fst") => WaveformFormat::Fst,
            _ => WaveformFormat::Vcd,
        }
    }
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
    signals: HashMap<String, (char, usize)>, // name -> (id_char, width)
    next_id: char,
    timescale: String,
}

impl VcdWriter {
    /// Create a new VCD writer (internal constructor)
    fn create(path: &Path) -> Result<Self, WaveformError> {
        let file = File::create(path)?;
        Ok(Self {
            writer: BufWriter::new(file),
            signals: HashMap::new(),
            next_id: '!', // VCD uses printable ASCII chars for IDs
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

    /// Add a signal definition
    fn add_signal(&mut self, name: &str, width: usize) -> Result<char, WaveformError> {
        let id = self.next_id;
        self.signals.insert(name.to_string(), (id, width));

        // Write variable definition
        if width == 1 {
            writeln!(self.writer, "$var wire {} {} {} $end", width, id, name)?;
        } else {
            writeln!(
                self.writer,
                "$var wire {} {} {} [{}:0] $end",
                width,
                id,
                name,
                width - 1
            )?;
        }

        // Advance to next ID character
        self.next_id = (self.next_id as u8 + 1) as char;
        if self.next_id > '~' {
            // Wrap around if we run out of printable chars
            self.next_id = '!';
        }

        Ok(id)
    }

    /// Write signal value
    fn write_value(&mut self, id: char, value: &SignalValue) -> Result<(), WaveformError> {
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
        for name in &signal_names {
            let width = trace.get_width(name).unwrap_or(1);
            self.add_signal(name, width)?;
        }

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
                if let Some(changes) = trace.get_changes(name) {
                    if let Some((_, value)) = changes.first() {
                        self.write_value(*id, value)?;
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
                                    self.write_value(*id, value)?;
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
