//! Veryl to IRIS.
//!
//! Reads with `veryl-parser`. Every decision about what may be converted comes
//! from `veryl2iris-mapping`; this crate only knows how to write the result
//! out.

pub mod convert;
pub mod spelling;
