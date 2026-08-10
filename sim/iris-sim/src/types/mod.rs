//! Common types for IRIS simulator
//!
//! This module defines fundamental types used across the simulator.

mod signal;
mod time;

pub use signal::{BitValue, SignalValue};
pub use time::{format_time, SimTime, TimeUnit};
