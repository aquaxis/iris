//! IRIS Runtime Library
//!
//! Support library for compiled IRIS simulations. The value type, the
//! operations on it and the waveform recorder are shared with the interpreter
//! so that a design behaves the same whether it is interpreted or compiled.

mod bitvec;
mod clock;
pub mod engine;
pub mod ops;
pub mod random;
mod reset;
mod tracer;
pub mod trace;
pub mod value;

pub use bitvec::BitVec;
pub use clock::Clock;
pub use engine::{Runtime, SlotDef, Wait};
pub use reset::Reset;
pub use trace::SignalTrace;
pub use tracer::WaveTracer;
pub use value::{BitValue, SignalValue};

/// Simulation time in picoseconds
pub type SimTime = u64;

/// Default clock period (10ns = 10000ps)
pub const DEFAULT_CLOCK_PERIOD: SimTime = 10_000;

/// Default reset cycles
pub const DEFAULT_RESET_CYCLES: u64 = 5;