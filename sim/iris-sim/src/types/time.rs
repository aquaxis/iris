//! Simulation time types
//!
//! Provides types for managing simulation time in the simulator.

use std::fmt;

/// Simulation time in picoseconds
pub type SimTime = u64;

/// Time unit for display and conversion
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeUnit {
    /// Picoseconds
    Ps,
    /// Nanoseconds
    Ns,
    /// Microseconds
    Us,
    /// Milliseconds
    Ms,
}

impl TimeUnit {
    /// Convert to picoseconds multiplier
    pub fn to_ps_multiplier(self) -> u64 {
        match self {
            TimeUnit::Ps => 1,
            TimeUnit::Ns => 1_000,
            TimeUnit::Us => 1_000_000,
            TimeUnit::Ms => 1_000_000_000,
        }
    }

    /// Convert a value in this unit to picoseconds
    pub fn to_ps(self, value: u64) -> SimTime {
        value * self.to_ps_multiplier()
    }
}

impl fmt::Display for TimeUnit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TimeUnit::Ps => write!(f, "ps"),
            TimeUnit::Ns => write!(f, "ns"),
            TimeUnit::Us => write!(f, "us"),
            TimeUnit::Ms => write!(f, "ms"),
        }
    }
}

/// Format simulation time with appropriate unit
pub fn format_time(time: SimTime) -> String {
    if time >= 1_000_000_000 {
        format!("{} ms", time / 1_000_000_000)
    } else if time >= 1_000_000 {
        format!("{} us", time / 1_000_000)
    } else if time >= 1_000 {
        format!("{} ns", time / 1_000)
    } else {
        format!("{} ps", time)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_unit_conversion() {
        assert_eq!(TimeUnit::Ns.to_ps(10), 10_000);
        assert_eq!(TimeUnit::Us.to_ps(1), 1_000_000);
    }

    #[test]
    fn test_format_time() {
        assert_eq!(format_time(500), "500 ps");
        assert_eq!(format_time(5_000), "5 ns");
        assert_eq!(format_time(5_000_000), "5 us");
    }
}
