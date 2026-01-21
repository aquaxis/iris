//! IRIS Runtime Library
//!
//! Support library for compiled IRIS simulations.
//! Provides Clock, Reset, BitVec, and WaveTracer types.

mod clock;
mod reset;
mod bitvec;
mod tracer;

pub use clock::Clock;
pub use reset::Reset;
pub use bitvec::BitVec;
pub use tracer::WaveTracer;

/// Simulation time in picoseconds
pub type SimTime = u64;

/// Default clock period (10ns = 10000ps)
pub const DEFAULT_CLOCK_PERIOD: SimTime = 10_000;

/// Default reset cycles
pub const DEFAULT_RESET_CYCLES: u64 = 5;
