//! Waveform output module
//!
//! This module provides waveform file output functionality.
//! Supports VCD (Value Change Dump) format.

mod writer;

pub use writer::{VcdWriter, WaveWriter, WaveformError};
