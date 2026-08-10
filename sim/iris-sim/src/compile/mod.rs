//! IRIS to Rust code generator
//!
//! Turns an elaborated project into a standalone Rust program that simulates
//! it. The generated program links against `iris-runtime`, which also backs
//! the interpreter, so both give the same answer.

mod codegen;

pub use codegen::{CodeGenError, SimGenerator};
