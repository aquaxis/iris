//! Reset signal implementation

/// Reset signal for simulation
#[derive(Debug, Clone)]
pub struct Reset {
    /// Reset is active (asserted)
    pub active: bool,
    /// Active low reset (true = reset when signal is 0)
    pub active_low: bool,
}

impl Reset {
    /// Create a new reset signal (active high by default)
    pub fn new() -> Self {
        Self {
            active: false,
            active_low: false,
        }
    }

    /// Create a new active-low reset signal
    pub fn new_active_low() -> Self {
        Self {
            active: false,
            active_low: true,
        }
    }

    /// Assert reset (activate)
    pub fn assert(&mut self) {
        self.active = true;
    }

    /// Deassert reset (deactivate)
    pub fn deassert(&mut self) {
        self.active = false;
    }

    /// Check if reset is active
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Get reset signal value as u64
    pub fn as_u64(&self) -> u64 {
        if self.active_low {
            if self.active { 0 } else { 1 }
        } else {
            if self.active { 1 } else { 0 }
        }
    }

    /// Get reset signal value as bool (signal level, not active state)
    pub fn signal_value(&self) -> bool {
        if self.active_low {
            !self.active
        } else {
            self.active
        }
    }
}

impl Default for Reset {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reset_active_high() {
        let mut rst = Reset::new();
        assert!(!rst.is_active());
        assert_eq!(rst.as_u64(), 0);

        rst.assert();
        assert!(rst.is_active());
        assert_eq!(rst.as_u64(), 1);

        rst.deassert();
        assert!(!rst.is_active());
        assert_eq!(rst.as_u64(), 0);
    }

    #[test]
    fn test_reset_active_low() {
        let mut rst = Reset::new_active_low();
        assert!(!rst.is_active());
        assert_eq!(rst.as_u64(), 1); // signal high when not active

        rst.assert();
        assert!(rst.is_active());
        assert_eq!(rst.as_u64(), 0); // signal low when active

        rst.deassert();
        assert!(!rst.is_active());
        assert_eq!(rst.as_u64(), 1);
    }
}
