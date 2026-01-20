//! IRIS language parser
//!
//! This module provides parsing functionality for the IRIS hardware description language.

pub mod ast;
mod grammar;

pub use ast::*;
pub use grammar::{Parser, ParseError};
