//! Deterministic randomisation
//!
//! A testbench that draws random values must draw the same ones whether it is
//! interpreted or compiled, so the generator lives here and both backends use
//! it. It is seeded from a constant: a run is reproducible by construction.

/// A small, fast, deterministic generator (xorshift64*)
#[derive(Debug, Clone)]
pub struct Rng {
    state: u64,
}

/// The seed every run starts from, so two runs of a design agree
pub const DEFAULT_SEED: u64 = 0x2545_F491_4F6C_DD1D;

impl Rng {
    /// Start from a seed. Zero is replaced, since the generator would stick.
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { DEFAULT_SEED } else { seed },
        }
    }

    /// The next value in the sequence
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// A value that fits in `width` bits
    pub fn next_bits(&mut self, width: usize) -> u64 {
        if width == 0 {
            return 0;
        }
        let value = self.next_u64();
        if width >= 64 {
            value
        } else {
            value & ((1u64 << width) - 1)
        }
    }
}

impl Default for Rng {
    fn default() -> Self {
        Self::new(DEFAULT_SEED)
    }
}

/// How many draws to try before giving up on the constraints
pub const MAX_ATTEMPTS: usize = 1000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sequence_is_reproducible() {
        let mut a = Rng::new(DEFAULT_SEED);
        let mut b = Rng::new(DEFAULT_SEED);
        for _ in 0..8 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn a_drawn_value_fits_its_width() {
        let mut rng = Rng::default();
        for _ in 0..100 {
            assert!(rng.next_bits(4) < 16);
            assert!(rng.next_bits(1) < 2);
        }
    }

    #[test]
    fn a_zero_seed_still_generates() {
        let mut rng = Rng::new(0);
        assert_ne!(rng.next_u64(), 0);
    }
}
