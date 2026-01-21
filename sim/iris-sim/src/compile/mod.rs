//! IRIS to Rust code generator
//!
//! This module provides compilation from IRIS AST to Rust source code.

mod codegen;

pub use codegen::CodeGenError;
pub use codegen::RustCodeGenerator;
pub use codegen::TestCodeGenerator;
