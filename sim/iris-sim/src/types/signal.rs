//! Signal value types for IRIS simulator
//!
//! Provides 4-value logic (0, 1, X, Z) and multi-bit signal values.

use std::fmt;

/// Single bit value with 4-state logic
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BitValue {
    /// Logic 0
    Zero,
    /// Logic 1
    One,
    /// Unknown/undefined value
    X,
    /// High-impedance
    Z,
}

impl BitValue {
    /// Perform bitwise AND
    pub fn and(self, other: BitValue) -> BitValue {
        use BitValue::*;
        match (self, other) {
            (Zero, _) | (_, Zero) => Zero,
            (One, One) => One,
            _ => X,
        }
    }

    /// Perform bitwise OR
    pub fn or(self, other: BitValue) -> BitValue {
        use BitValue::*;
        match (self, other) {
            (One, _) | (_, One) => One,
            (Zero, Zero) => Zero,
            _ => X,
        }
    }

    /// Perform bitwise XOR
    pub fn xor(self, other: BitValue) -> BitValue {
        use BitValue::*;
        match (self, other) {
            (Zero, Zero) | (One, One) => Zero,
            (Zero, One) | (One, Zero) => One,
            _ => X,
        }
    }

    /// Perform bitwise NOT
    pub fn not(self) -> BitValue {
        use BitValue::*;
        match self {
            Zero => One,
            One => Zero,
            X => X,
            Z => X,
        }
    }

    /// Convert to char for display
    pub fn to_char(self) -> char {
        match self {
            BitValue::Zero => '0',
            BitValue::One => '1',
            BitValue::X => 'x',
            BitValue::Z => 'z',
        }
    }
}

impl fmt::Display for BitValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_char())
    }
}

/// Multi-bit signal value
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalValue {
    /// Bits stored LSB first (index 0 = LSB)
    bits: Vec<BitValue>,
}

impl SignalValue {
    /// Create a new signal value with specified width, initialized to 0
    pub fn new(width: usize) -> Self {
        Self {
            bits: vec![BitValue::Zero; width],
        }
    }

    /// Create a new signal value with all X (unknown)
    pub fn new_x(width: usize) -> Self {
        Self {
            bits: vec![BitValue::X; width],
        }
    }

    /// Create from u64 value
    pub fn from_u64(value: u64, width: usize) -> Self {
        let mut bits = Vec::with_capacity(width);
        for i in 0..width {
            if (value >> i) & 1 == 1 {
                bits.push(BitValue::One);
            } else {
                bits.push(BitValue::Zero);
            }
        }
        Self { bits }
    }

    /// Convert to u64 if all bits are 0 or 1
    pub fn to_u64(&self) -> Option<u64> {
        if self.bits.len() > 64 {
            return None;
        }
        let mut result = 0u64;
        for (i, bit) in self.bits.iter().enumerate() {
            match bit {
                BitValue::One => result |= 1 << i,
                BitValue::Zero => {}
                _ => return None, // X or Z present
            }
        }
        Some(result)
    }

    /// Get bit width
    pub fn width(&self) -> usize {
        self.bits.len()
    }

    /// Get bit at index (0 = LSB)
    pub fn get_bit(&self, index: usize) -> Option<BitValue> {
        self.bits.get(index).copied()
    }

    /// Set bit at index
    pub fn set_bit(&mut self, index: usize, value: BitValue) {
        if index < self.bits.len() {
            self.bits[index] = value;
        }
    }

    /// Extract a slice [high:low] (inclusive)
    pub fn slice(&self, high: usize, low: usize) -> SignalValue {
        let width = high - low + 1;
        let mut bits = Vec::with_capacity(width);
        for i in low..=high {
            bits.push(self.bits.get(i).copied().unwrap_or(BitValue::X));
        }
        SignalValue { bits }
    }

    /// Zero extend to new width
    pub fn extend(&self, new_width: usize) -> SignalValue {
        let mut bits = self.bits.clone();
        bits.resize(new_width, BitValue::Zero);
        SignalValue { bits }
    }

    /// Truncate to new width
    pub fn truncate(&self, new_width: usize) -> SignalValue {
        let mut bits = self.bits.clone();
        bits.truncate(new_width);
        SignalValue { bits }
    }

    /// Bitwise AND
    pub fn and(&self, other: &SignalValue) -> SignalValue {
        let width = self.width().max(other.width());
        let mut bits = Vec::with_capacity(width);
        for i in 0..width {
            let a = self.bits.get(i).copied().unwrap_or(BitValue::Zero);
            let b = other.bits.get(i).copied().unwrap_or(BitValue::Zero);
            bits.push(a.and(b));
        }
        SignalValue { bits }
    }

    /// Bitwise OR
    pub fn or(&self, other: &SignalValue) -> SignalValue {
        let width = self.width().max(other.width());
        let mut bits = Vec::with_capacity(width);
        for i in 0..width {
            let a = self.bits.get(i).copied().unwrap_or(BitValue::Zero);
            let b = other.bits.get(i).copied().unwrap_or(BitValue::Zero);
            bits.push(a.or(b));
        }
        SignalValue { bits }
    }

    /// Bitwise XOR
    pub fn xor(&self, other: &SignalValue) -> SignalValue {
        let width = self.width().max(other.width());
        let mut bits = Vec::with_capacity(width);
        for i in 0..width {
            let a = self.bits.get(i).copied().unwrap_or(BitValue::Zero);
            let b = other.bits.get(i).copied().unwrap_or(BitValue::Zero);
            bits.push(a.xor(b));
        }
        SignalValue { bits }
    }

    /// Bitwise NOT
    pub fn not(&self) -> SignalValue {
        SignalValue {
            bits: self.bits.iter().map(|b| b.not()).collect(),
        }
    }

    /// Add two signal values
    pub fn add(&self, other: &SignalValue) -> SignalValue {
        let a = self.to_u64();
        let b = other.to_u64();
        match (a, b) {
            (Some(a), Some(b)) => {
                let result = a.wrapping_add(b);
                SignalValue::from_u64(result, self.width().max(other.width()))
            }
            _ => SignalValue::new_x(self.width().max(other.width())),
        }
    }

    /// Check if equal to another signal value
    pub fn is_equal(&self, other: &SignalValue) -> Option<bool> {
        let a = self.to_u64()?;
        let b = other.to_u64()?;
        Some(a == b)
    }

    /// Format as binary string
    pub fn to_binary_string(&self) -> String {
        self.bits.iter().rev().map(|b| b.to_char()).collect()
    }

    /// Format as hex string
    pub fn to_hex_string(&self) -> String {
        if let Some(val) = self.to_u64() {
            let nibbles = (self.width() + 3) / 4;
            format!("{:0width$x}", val, width = nibbles)
        } else {
            self.to_binary_string()
        }
    }
}

impl fmt::Display for SignalValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}'h{}", self.width(), self.to_hex_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bit_operations() {
        assert_eq!(BitValue::One.and(BitValue::One), BitValue::One);
        assert_eq!(BitValue::One.and(BitValue::Zero), BitValue::Zero);
        assert_eq!(BitValue::One.or(BitValue::Zero), BitValue::One);
        assert_eq!(BitValue::Zero.not(), BitValue::One);
    }

    #[test]
    fn test_signal_from_u64() {
        let sig = SignalValue::from_u64(0xFF, 8);
        assert_eq!(sig.to_u64(), Some(0xFF));
        assert_eq!(sig.width(), 8);
    }

    #[test]
    fn test_signal_slice() {
        let sig = SignalValue::from_u64(0xAB, 8);
        let slice = sig.slice(3, 0);
        assert_eq!(slice.to_u64(), Some(0xB));
    }

    #[test]
    fn test_signal_add() {
        let a = SignalValue::from_u64(10, 8);
        let b = SignalValue::from_u64(5, 8);
        let result = a.add(&b);
        assert_eq!(result.to_u64(), Some(15));
    }
}
