//! Waveform output module
//!
//! This module provides waveform file output functionality.
//! Supports VCD (Value Change Dump) and FST (Fast Signal Trace) formats.

mod writer;
mod fst_writer;

pub use writer::{VcdWriter, WaveWriter, WaveformError, WaveformFormat};
pub use fst_writer::FstWriter;
