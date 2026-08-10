//! Simulation engine for IRIS
//!
//! This module provides the simulation engine for executing IRIS designs.

pub mod eval;
mod hierarchy;
pub mod seq;
mod trace;

pub use eval::{EvalError, Evaluator};
pub use hierarchy::{cover_name, AssertionFailure, HierarchicalSimulator, MetastabilityWarning};
pub use trace::SignalTrace;
