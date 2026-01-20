//! Simulation engine for IRIS
//!
//! This module provides the simulation engine for executing IRIS designs.

mod engine;
mod eval;
mod hierarchy;
mod trace;

pub use engine::Simulator;
pub use eval::{EvalError, Evaluator};
pub use hierarchy::HierarchicalSimulator;
pub use trace::SignalTrace;
