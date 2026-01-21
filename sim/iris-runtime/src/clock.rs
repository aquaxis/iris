//! Clock signal implementation

use crate::SimTime;

/// Clock signal for simulation
#[derive(Debug, Clone)]
pub struct Clock {
    /// Clock period in picoseconds
    pub period: SimTime,
    /// Current clock value (true = high, false = low)
    pub value: bool,
    /// Current simulation time in picoseconds
    pub time: SimTime,
    /// Previous clock value (for edge detection)
    prev_value: bool,
}

impl Clock {
    /// Create a new clock with specified period in picoseconds
    pub fn new(period_ps: SimTime) -> Self {
        Self {
            period: period_ps,
            value: false,
            time: 0,
            prev_value: false,
        }
    }

    /// Create a new clock with period in nanoseconds
    pub fn new_ns(period_ns: u64) -> Self {
        Self::new(period_ns * 1000)
    }

    /// Advance clock by half period (toggle)
    pub fn tick(&mut self) {
        self.prev_value = self.value;
        self.value = !self.value;
        self.time += self.period / 2;
    }

    /// Advance clock by one full cycle
    pub fn cycle(&mut self) {
        self.tick();
        self.tick();
    }

    /// Check if positive edge occurred (low -> high)
    pub fn posedge(&self) -> bool {
        !self.prev_value && self.value
    }

    /// Check if negative edge occurred (high -> low)
    pub fn negedge(&self) -> bool {
        self.prev_value && !self.value
    }

    /// Get current time in picoseconds
    pub fn get_time(&self) -> SimTime {
        self.time
    }

    /// Get current time in nanoseconds
    pub fn get_time_ns(&self) -> f64 {
        self.time as f64 / 1000.0
    }

    /// Get clock value as u64 (0 or 1)
    pub fn as_u64(&self) -> u64 {
        if self.value { 1 } else { 0 }
    }
}

impl Default for Clock {
    fn default() -> Self {
        Self::new(crate::DEFAULT_CLOCK_PERIOD)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clock_basic() {
        let mut clk = Clock::new(10_000); // 10ns
        assert!(!clk.value);
        assert_eq!(clk.time, 0);

        clk.tick();
        assert!(clk.value);
        assert!(clk.posedge());
        assert_eq!(clk.time, 5_000);

        clk.tick();
        assert!(!clk.value);
        assert!(clk.negedge());
        assert_eq!(clk.time, 10_000);
    }

    #[test]
    fn test_clock_cycle() {
        let mut clk = Clock::new(10_000);
        clk.cycle();
        assert_eq!(clk.time, 10_000);
        assert!(!clk.value);
    }
}
