//! Bit vector implementation for hardware simulation

use std::ops::{Add, Sub, BitAnd, BitOr, BitXor, Not, Shl, Shr};

/// Fixed-width bit vector for hardware simulation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BitVec<const N: usize> {
    value: u64,
}

impl<const N: usize> BitVec<N> {
    /// Bit mask for N bits
    const MASK: u64 = if N >= 64 { u64::MAX } else { (1u64 << N) - 1 };

    /// Create a new BitVec with initial value
    pub fn new(value: u64) -> Self {
        Self {
            value: value & Self::MASK,
        }
    }

    /// Create a zero-initialized BitVec
    pub fn zero() -> Self {
        Self::new(0)
    }

    /// Get the underlying value
    pub fn get(&self) -> u64 {
        self.value
    }

    /// Set the value
    pub fn set(&mut self, value: u64) {
        self.value = value & Self::MASK;
    }

    /// Get the bit width
    pub fn width(&self) -> usize {
        N
    }

    /// Extract a single bit
    pub fn bit(&self, index: usize) -> bool {
        if index >= N {
            false
        } else {
            (self.value >> index) & 1 == 1
        }
    }

    /// Extract a range of bits [high:low]
    pub fn slice(&self, high: usize, low: usize) -> u64 {
        if low > high || low >= N {
            0
        } else {
            let h = high.min(N - 1);
            let mask = ((1u64 << (h - low + 1)) - 1) << low;
            (self.value & mask) >> low
        }
    }

    /// Wrapping add
    pub fn wrapping_add(&self, other: Self) -> Self {
        Self::new(self.value.wrapping_add(other.value))
    }

    /// Wrapping sub
    pub fn wrapping_sub(&self, other: Self) -> Self {
        Self::new(self.value.wrapping_sub(other.value))
    }

    /// Wrapping mul
    pub fn wrapping_mul(&self, other: Self) -> Self {
        Self::new(self.value.wrapping_mul(other.value))
    }

    /// Signed comparison (less than)
    pub fn signed_lt(&self, other: Self) -> bool {
        let self_signed = self.to_signed();
        let other_signed = other.to_signed();
        self_signed < other_signed
    }

    /// Convert to signed integer
    pub fn to_signed(&self) -> i64 {
        if N == 0 {
            0
        } else if N >= 64 {
            self.value as i64
        } else {
            // Sign extend
            let sign_bit = 1u64 << (N - 1);
            if self.value & sign_bit != 0 {
                (self.value | !Self::MASK) as i64
            } else {
                self.value as i64
            }
        }
    }

    /// Format as binary string with width prefix
    pub fn to_binary_string(&self) -> String {
        format!("{}'b{:0width$b}", N, self.value, width = N)
    }

    /// Format as hex string with width prefix
    pub fn to_hex_string(&self) -> String {
        let hex_width = (N + 3) / 4;
        format!("{}'h{:0width$x}", N, self.value, width = hex_width)
    }
}

impl<const N: usize> Default for BitVec<N> {
    fn default() -> Self {
        Self::zero()
    }
}

impl<const N: usize> From<u64> for BitVec<N> {
    fn from(value: u64) -> Self {
        Self::new(value)
    }
}

impl<const N: usize> From<BitVec<N>> for u64 {
    fn from(bv: BitVec<N>) -> Self {
        bv.value
    }
}

// Arithmetic operations
impl<const N: usize> Add for BitVec<N> {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        self.wrapping_add(other)
    }
}

impl<const N: usize> Sub for BitVec<N> {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        self.wrapping_sub(other)
    }
}

// Bitwise operations
impl<const N: usize> BitAnd for BitVec<N> {
    type Output = Self;
    fn bitand(self, other: Self) -> Self {
        Self::new(self.value & other.value)
    }
}

impl<const N: usize> BitOr for BitVec<N> {
    type Output = Self;
    fn bitor(self, other: Self) -> Self {
        Self::new(self.value | other.value)
    }
}

impl<const N: usize> BitXor for BitVec<N> {
    type Output = Self;
    fn bitxor(self, other: Self) -> Self {
        Self::new(self.value ^ other.value)
    }
}

impl<const N: usize> Not for BitVec<N> {
    type Output = Self;
    fn not(self) -> Self {
        Self::new(!self.value)
    }
}

impl<const N: usize> Shl<usize> for BitVec<N> {
    type Output = Self;
    fn shl(self, rhs: usize) -> Self {
        Self::new(self.value << rhs)
    }
}

impl<const N: usize> Shr<usize> for BitVec<N> {
    type Output = Self;
    fn shr(self, rhs: usize) -> Self {
        Self::new(self.value >> rhs)
    }
}

impl<const N: usize> std::fmt::Display for BitVec<N> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_hex_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitvec_basic() {
        let bv: BitVec<8> = BitVec::new(255);
        assert_eq!(bv.get(), 255);
        assert_eq!(bv.width(), 8);

        let bv2: BitVec<8> = BitVec::new(256); // overflow
        assert_eq!(bv2.get(), 0); // masked to 8 bits
    }

    #[test]
    fn test_bitvec_arithmetic() {
        let a: BitVec<8> = BitVec::new(200);
        let b: BitVec<8> = BitVec::new(100);

        let sum = a + b;
        assert_eq!(sum.get(), 44); // 300 & 0xFF = 44

        let diff = a - b;
        assert_eq!(diff.get(), 100);
    }

    #[test]
    fn test_bitvec_bitwise() {
        let a: BitVec<8> = BitVec::new(0b11110000);
        let b: BitVec<8> = BitVec::new(0b10101010);

        assert_eq!((a & b).get(), 0b10100000);
        assert_eq!((a | b).get(), 0b11111010);
        assert_eq!((a ^ b).get(), 0b01011010);
        assert_eq!((!a).get(), 0b00001111);
    }

    #[test]
    fn test_bitvec_slice() {
        let bv: BitVec<8> = BitVec::new(0b11010110);
        assert_eq!(bv.slice(3, 0), 0b0110);
        assert_eq!(bv.slice(7, 4), 0b1101);
        assert!(bv.bit(1));
        assert!(!bv.bit(0));
    }

    #[test]
    fn test_bitvec_signed() {
        let pos: BitVec<8> = BitVec::new(127);
        let neg: BitVec<8> = BitVec::new(128); // -128 in signed 8-bit

        assert_eq!(pos.to_signed(), 127);
        assert_eq!(neg.to_signed(), -128);
        assert!(neg.signed_lt(pos));
    }
}
