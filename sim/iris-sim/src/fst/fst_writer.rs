//! FST (Fast Signal Trace) waveform writer
//!
//! Outputs simulation traces in FST format using GTKWave's fstapi.
//! FST is a compressed binary format that is more efficient than VCD.

use std::collections::HashMap;
use std::ffi::CString;
use std::path::Path;
use std::ptr;

use fst_sys::*;

use crate::sim::SignalTrace;
use crate::types::{BitValue, SignalValue, SimTime};

use super::writer::{WaveWriter, WaveformError};

/// FST waveform writer
pub struct FstWriter {
    ctx: *mut std::os::raw::c_void,
    signals: HashMap<String, (fstHandle, usize)>, // name -> (handle, width)
    timescale: String,
}

impl FstWriter {
    /// Create a new FST writer (internal constructor)
    fn create(path: &Path) -> Result<Self, WaveformError> {
        let path_str = path.to_str().ok_or_else(|| {
            WaveformError::FstError("Invalid path".to_string())
        })?;
        let c_path = CString::new(path_str).map_err(|e| {
            WaveformError::FstError(format!("Invalid path: {}", e))
        })?;

        let ctx = unsafe { fstWriterCreate(c_path.as_ptr(), 1) };
        if ctx.is_null() {
            return Err(WaveformError::FstError("Failed to create FST file".to_string()));
        }

        // Set compression type to LZ4 for better performance
        unsafe {
            fstWriterSetPackType(ctx, fstWriterPackType_FST_WR_PT_LZ4);
        }

        Ok(Self {
            ctx,
            signals: HashMap::new(),
            timescale: "1ps".to_string(),
        })
    }

    /// Set timescale string to FST timescale value
    fn apply_timescale(&mut self) {
        let c_timescale = CString::new(self.timescale.as_str()).unwrap_or_else(|_| {
            CString::new("1ps").unwrap()
        });
        unsafe {
            fstWriterSetTimescaleFromString(self.ctx, c_timescale.as_ptr());
        }
    }

    /// Add a signal definition
    fn add_signal(&mut self, name: &str, width: usize) -> Result<fstHandle, WaveformError> {
        let c_name = CString::new(name).map_err(|e| {
            WaveformError::FstError(format!("Invalid signal name: {}", e))
        })?;

        let handle = unsafe {
            fstWriterCreateVar(
                self.ctx,
                fstVarType_FST_VT_VCD_WIRE,
                fstVarDir_FST_VD_IMPLICIT,
                width as u32,
                c_name.as_ptr(),
                0, // no alias
            )
        };

        self.signals.insert(name.to_string(), (handle, width));
        Ok(handle)
    }

    /// Set scope (module hierarchy)
    fn set_scope(&mut self, scope_name: &str) -> Result<(), WaveformError> {
        let c_name = CString::new(scope_name).map_err(|e| {
            WaveformError::FstError(format!("Invalid scope name: {}", e))
        })?;

        unsafe {
            fstWriterSetScope(
                self.ctx,
                fstScopeType_FST_ST_VCD_MODULE,
                c_name.as_ptr(),
                ptr::null(),
            );
        }
        Ok(())
    }

    /// Exit current scope
    fn upscope(&mut self) {
        unsafe {
            fstWriterSetUpscope(self.ctx);
        }
    }

    /// Emit time change
    fn emit_time(&mut self, time: SimTime) {
        unsafe {
            fstWriterEmitTimeChange(self.ctx, time);
        }
    }

    /// Emit value change for a signal
    fn emit_value(&mut self, handle: fstHandle, value: &SignalValue) {
        let width = value.width();
        let mut value_str = String::with_capacity(width);

        // Build value string (MSB first)
        for i in (0..width).rev() {
            let bit = value.get_bit(i).unwrap_or(BitValue::X);
            value_str.push(bit.to_char());
        }

        let c_value = CString::new(value_str).unwrap_or_else(|_| {
            CString::new("x").unwrap()
        });

        unsafe {
            fstWriterEmitValueChange(
                self.ctx,
                handle,
                c_value.as_ptr() as *const std::os::raw::c_void,
            );
        }
    }

    /// Write complete trace to FST file (internal implementation)
    fn write_trace_internal(
        &mut self,
        trace: &SignalTrace,
        module_name: &str,
    ) -> Result<(), WaveformError> {
        // Apply timescale
        self.apply_timescale();

        // Set module scope
        self.set_scope(module_name)?;

        // Collect all signal names and add definitions
        let signal_names: Vec<String> = trace.signal_names().cloned().collect();
        for name in &signal_names {
            let width = trace.get_width(name).unwrap_or(1);
            self.add_signal(name, width)?;
        }

        // Close scope
        self.upscope();

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

        // Track current values for change detection
        let mut current_values: HashMap<String, SignalValue> = HashMap::new();

        // Initialize with first values and emit initial values at time 0
        if !all_times.is_empty() {
            self.emit_time(0);
            for name in &signal_names {
                if let Some(changes) = trace.get_changes(name) {
                    if let Some((_, value)) = changes.first() {
                        if let Some((handle, _)) = self.signals.get(name) {
                            self.emit_value(*handle, value);
                        }
                        current_values.insert(name.clone(), value.clone());
                    }
                }
            }
        }

        // Write value changes at each time point
        for time in &all_times {
            if *time == 0 {
                continue; // Already handled initial values
            }

            let mut time_emitted = false;

            for name in &signal_names {
                if let Some(changes) = trace.get_changes(name) {
                    for (t, value) in changes {
                        if t == time {
                            // Check if value actually changed
                            let changed = current_values
                                .get(name)
                                .map(|v| v != value)
                                .unwrap_or(true);

                            if changed {
                                if !time_emitted {
                                    self.emit_time(*time);
                                    time_emitted = true;
                                }

                                if let Some((handle, _)) = self.signals.get(name) {
                                    self.emit_value(*handle, value);
                                }
                                current_values.insert(name.clone(), value.clone());
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Close the writer (internal implementation)
    fn close_internal(self) -> Result<(), WaveformError> {
        if !self.ctx.is_null() {
            unsafe {
                fstWriterClose(self.ctx);
            }
        }
        Ok(())
    }
}

impl WaveWriter for FstWriter {
    fn new(path: &Path) -> Result<Self, WaveformError> {
        FstWriter::create(path)
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

// FstWriter owns the raw pointer, so we need to implement Drop
impl Drop for FstWriter {
    fn drop(&mut self) {
        // Note: close() should be called explicitly to handle errors
        // This is a safety net in case close() wasn't called
        if !self.ctx.is_null() {
            unsafe {
                fstWriterClose(self.ctx);
            }
            self.ctx = ptr::null_mut();
        }
    }
}
