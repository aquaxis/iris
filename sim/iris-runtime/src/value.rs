//! Signal values
//!
//! Four-state logic (0, 1, X, Z) and multi-bit values. Shared by the
//! interpreter and by the code that `iris-compile` generates, so that a
//! design gives the same answer either way.

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

/// Bits stored LSB first, one entry per bit
///
/// This is the general form, used only when a value carries X or Z or is wider
/// than a machine word. The common case never reaches it, so it is a plain
/// vector rather than something cleverer: keeping an inline buffer here made
/// every value 48 bytes and every move that much more expensive.
type Bits = Vec<BitValue>;

/// `width` copies of one bit value
fn filled(value: BitValue, width: usize) -> Bits {
    vec![value; width]
}

/// Build `width` bits, each from `f`
fn from_fn(width: usize, f: impl FnMut(usize) -> BitValue) -> Bits {
    (0..width).map(f).collect()
}

/// Mask keeping the low `width` bits
#[inline]
fn mask(width: usize) -> u64 {
    if width == 0 {
        0
    } else if width >= 64 {
        u64::MAX
    } else {
        (1u64 << width) - 1
    }
}

/// How a value is held
///
/// Almost every value in a running simulation has all its bits known and fits
/// in a machine word. Arithmetic already works on words — `binop` converts to
/// `u64`, operates, and converts back — so holding the word directly removes
/// both conversions. The general form stays for X, Z and wide values.
#[derive(Clone, Debug)]
enum Repr {
    /// Every bit is 0 or 1, and the width is at most 64
    Word {
        /// The value, with bits above `width` cleared
        value: u64,
        /// Declared width
        width: usize,
    },
    /// Any of the four states, any width
    General(Bits),
}

impl Repr {
    #[inline]
    fn width(&self) -> usize {
        match self {
            Repr::Word { width, .. } => *width,
            Repr::General(b) => b.as_slice().len(),
        }
    }

    /// The numeric value, when every bit is known and it fits
    #[inline]
    fn to_word(&self) -> Option<u64> {
        match self {
            Repr::Word { value, .. } => Some(*value),
            Repr::General(b) => {
                let slice = b.as_slice();
                if slice.len() > 64 {
                    return None;
                }
                let mut result = 0u64;
                for (i, bit) in slice.iter().enumerate() {
                    match bit {
                        BitValue::One => result |= 1 << i,
                        BitValue::Zero => {}
                        _ => return None, // X or Z present
                    }
                }
                Some(result)
            }
        }
    }

    /// The same value as individual bits
    fn to_bits(&self) -> Bits {
        match self {
            Repr::Word { value, width } => from_fn(*width, |i| {
                if i < 64 && (value >> i) & 1 == 1 {
                    BitValue::One
                } else {
                    BitValue::Zero
                }
            }),
            Repr::General(b) => b.clone(),
        }
    }
}

/// Multi-bit signal value
#[derive(Clone, Debug)]
pub struct SignalValue {
    /// Bits stored LSB first (index 0 = LSB)
    repr: Repr,
    /// Whether the bits are to be read as two's complement.
    /// This is an interpretation, not part of the value, so it is excluded
    /// from equality.
    signed: bool,
}

impl Eq for SignalValue {}

impl PartialEq for SignalValue {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        if let (Repr::Word { value: a, width: aw }, Repr::Word { value: b, width: bw }) =
            (&self.repr, &other.repr)
        {
            return a == b && aw == bw;
        }
        self.repr.to_bits().as_slice() == other.repr.to_bits().as_slice()
    }
}

impl SignalValue {
    /// Create a new signal value with specified width, initialized to 0
    #[inline]
    pub fn new(width: usize) -> Self {
        Self::from_u64(0, width)
    }

    /// Create a new signal value with all X (unknown)
    pub fn new_x(width: usize) -> Self {
        Self {
            repr: Repr::General(filled(BitValue::X, width)),
            signed: false,
        }
    }

    /// Create from u64 value
    #[inline]
    pub fn from_u64(value: u64, width: usize) -> Self {
        let repr = if width <= 64 {
            Repr::Word {
                value: value & mask(width),
                width,
            }
        } else {
            Repr::General(from_fn(width, |i| {
                if i < 64 && (value >> i) & 1 == 1 {
                    BitValue::One
                } else {
                    BitValue::Zero
                }
            }))
        };
        Self {
            repr,
            signed: false,
        }
    }

    /// Create from a signed value, in two's complement
    pub fn from_i64(value: i64, width: usize) -> Self {
        let mut v = Self::from_u64(value as u64, width);
        v.signed = true;
        v
    }

    /// Are these bits to be read as two's complement?
    #[inline]
    pub fn is_signed(&self) -> bool {
        self.signed
    }

    /// The same bits, reinterpreted with the given signedness
    #[inline]
    pub fn with_signed(mut self, signed: bool) -> Self {
        self.signed = signed;
        self
    }

    /// Read the bits as two's complement, sign-extending from the top bit
    pub fn to_i64(&self) -> Option<i64> {
        let raw = self.to_u64()?;
        let width = self.width();
        if width == 0 || width >= 64 {
            return Some(raw as i64);
        }
        let sign_bit = 1u64 << (width - 1);
        if raw & sign_bit != 0 {
            // Set every bit above the width so the value stays negative
            Some((raw | !(sign_bit * 2 - 1)) as i64)
        } else {
            Some(raw as i64)
        }
    }

    /// Widen, replicating the sign bit
    pub fn sign_extend(&self, new_width: usize) -> SignalValue {
        if let Repr::Word { value, width } = self.repr {
            if new_width <= 64 {
                let sign_set = width > 0 && (value >> (width - 1)) & 1 == 1;
                let extended = if sign_set && new_width > width {
                    value | (mask(new_width) & !mask(width))
                } else {
                    value
                };
                return SignalValue {
                    repr: Repr::Word {
                        value: extended & mask(new_width),
                        width: new_width,
                    },
                    signed: true,
                };
            }
        }
        let old = self.repr.to_bits();
        let slice = old.as_slice();
        let sign = slice.last().copied().unwrap_or(BitValue::Zero);
        let bits = from_fn(new_width, |i| slice.get(i).copied().unwrap_or(sign));
        SignalValue {
            repr: Repr::General(bits),
            signed: true,
        }
    }

    /// Convert to u64 if all bits are 0 or 1
    #[inline]
    pub fn to_u64(&self) -> Option<u64> {
        self.repr.to_word()
    }

    /// Get bit width
    #[inline]
    pub fn width(&self) -> usize {
        self.repr.width()
    }

    /// Get bit at index (0 = LSB)
    #[inline]
    pub fn get_bit(&self, index: usize) -> Option<BitValue> {
        match &self.repr {
            Repr::Word { value, width } => {
                if index >= *width {
                    None
                } else if (value >> index) & 1 == 1 {
                    Some(BitValue::One)
                } else {
                    Some(BitValue::Zero)
                }
            }
            Repr::General(b) => b.as_slice().get(index).copied(),
        }
    }

    /// Replace the numeric content, keeping the declared width
    ///
    /// The generator uses this where it has already worked the arithmetic out
    /// in a machine word. Updating the word in place avoids building a value
    /// and moving it into the slot.
    #[inline]
    pub fn set_word(&mut self, value: u64) {
        let width = self.width();
        match &mut self.repr {
            Repr::Word { value: slot, .. } => *slot = value & mask(width),
            _ => {
                self.repr = Repr::Word {
                    value: value & mask(width),
                    width,
                }
            }
        }
    }

    /// Set bit at index
    pub fn set_bit(&mut self, index: usize, value: BitValue) {
        if index >= self.width() {
            return;
        }
        // A single known bit keeps the word form; anything else falls back
        if let (Repr::Word { value: word, width }, BitValue::Zero | BitValue::One) =
            (&mut self.repr, value)
        {
            let bit = matches!(value, BitValue::One) as u64;
            *word = (*word & !(1u64 << index)) | (bit << index);
            *word &= mask(*width);
            return;
        }
        let mut bits = self.repr.to_bits();
        bits.as_mut_slice()[index] = value;
        self.repr = Repr::General(bits);
    }

    /// Extract a slice [high:low] (inclusive)
    pub fn slice(&self, high: usize, low: usize) -> SignalValue {
        let width = high - low + 1;
        if let Repr::Word { value, width: w } = self.repr {
            if low < w && width <= 64 && high < w {
                return SignalValue {
                    repr: Repr::Word {
                        value: (value >> low) & mask(width),
                        width,
                    },
                    signed: false,
                };
            }
        }
        let old = self.repr.to_bits();
        let slice = old.as_slice();
        let bits = from_fn(width, |i| slice.get(low + i).copied().unwrap_or(BitValue::X));
        SignalValue {
            repr: Repr::General(bits),
            signed: false,
        }
    }

    /// Zero extend to new width
    pub fn extend(&self, new_width: usize) -> SignalValue {
        self.resized(new_width)
    }

    /// Truncate to new width
    pub fn truncate(&self, new_width: usize) -> SignalValue {
        self.resized(new_width)
    }

    /// The same bits at a different width, padding with zero
    fn resized(&self, new_width: usize) -> SignalValue {
        if let Repr::Word { value, .. } = self.repr {
            if new_width <= 64 {
                return SignalValue {
                    repr: Repr::Word {
                        value: value & mask(new_width),
                        width: new_width,
                    },
                    signed: false,
                };
            }
        }
        let old = self.repr.to_bits();
        let slice = old.as_slice();
        let bits = from_fn(new_width, |i| {
            slice.get(i).copied().unwrap_or(BitValue::Zero)
        });
        SignalValue {
            repr: Repr::General(bits),
            signed: false,
        }
    }

    /// Bitwise AND
    pub fn and(&self, other: &SignalValue) -> SignalValue {
        self.bitwise(other, |a, b| a & b, BitValue::and)
    }

    /// Bitwise OR
    pub fn or(&self, other: &SignalValue) -> SignalValue {
        self.bitwise(other, |a, b| a | b, BitValue::or)
    }

    /// Bitwise XOR
    pub fn xor(&self, other: &SignalValue) -> SignalValue {
        self.bitwise(other, |a, b| a ^ b, BitValue::xor)
    }

    /// One bitwise operation, on words when both sides are fully known
    fn bitwise(
        &self,
        other: &SignalValue,
        on_word: impl Fn(u64, u64) -> u64,
        on_bit: impl Fn(BitValue, BitValue) -> BitValue,
    ) -> SignalValue {
        let width = self.width().max(other.width());
        if width <= 64 {
            if let (Repr::Word { value: a, .. }, Repr::Word { value: b, .. }) =
                (&self.repr, &other.repr)
            {
                return SignalValue {
                    repr: Repr::Word {
                        value: on_word(*a, *b) & mask(width),
                        width,
                    },
                    signed: false,
                };
            }
        }
        let (x, y) = (self.repr.to_bits(), other.repr.to_bits());
        let (x, y) = (x.as_slice(), y.as_slice());
        let bits = from_fn(width, |i| {
            let a = x.get(i).copied().unwrap_or(BitValue::Zero);
            let b = y.get(i).copied().unwrap_or(BitValue::Zero);
            on_bit(a, b)
        });
        SignalValue {
            repr: Repr::General(bits),
            signed: false,
        }
    }

    /// Bitwise NOT
    pub fn not(&self) -> SignalValue {
        if let Repr::Word { value, width } = self.repr {
            return SignalValue {
                repr: Repr::Word {
                    value: !value & mask(width),
                    width,
                },
                signed: self.signed,
            };
        }
        let old = self.repr.to_bits();
        let slice = old.as_slice();
        let bits = from_fn(slice.len(), |i| slice[i].not());
        SignalValue {
            repr: Repr::General(bits),
            signed: self.signed,
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
        self.repr
            .to_bits()
            .as_slice()
            .iter()
            .rev()
            .map(|b| b.to_char())
            .collect()
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
        write!(f, "{}'h{}", self.width(), self.to_hex_string())?;
        // Bits alone do not say what a signed value means, so show the number
        match self.to_i64() {
            Some(value) if self.signed => write!(f, " ({})", value),
            _ => Ok(()),
        }
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
