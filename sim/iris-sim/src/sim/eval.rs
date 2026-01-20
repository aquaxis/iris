//! Expression evaluator
//!
//! Evaluates IRIS expressions to produce signal values.

use std::collections::HashMap;
use thiserror::Error;

use crate::parser::{BinOp, Expression, Literal, UnaryOp};
use crate::types::SignalValue;

/// Evaluation error
#[derive(Error, Debug)]
pub enum EvalError {
    #[error("Undefined signal: {0}")]
    UndefinedSignal(String),
    #[error("Type mismatch: {0}")]
    TypeMismatch(String),
    #[error("Division by zero")]
    DivisionByZero,
    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
}

/// Expression evaluator
pub struct Evaluator<'a> {
    signals: &'a HashMap<String, SignalValue>,
}

impl<'a> Evaluator<'a> {
    /// Create a new evaluator with access to signal values
    pub fn new(signals: &'a HashMap<String, SignalValue>) -> Self {
        Self { signals }
    }

    /// Evaluate an expression
    pub fn eval(&self, expr: &Expression) -> Result<SignalValue, EvalError> {
        match expr {
            Expression::Literal(lit) => self.eval_literal(lit),
            Expression::Ident(name) => self
                .signals
                .get(name)
                .cloned()
                .ok_or_else(|| EvalError::UndefinedSignal(name.clone())),
            Expression::BinOp { op, lhs, rhs } => {
                let lhs_val = self.eval(lhs)?;
                let rhs_val = self.eval(rhs)?;
                self.eval_binop(*op, &lhs_val, &rhs_val)
            }
            Expression::UnaryOp { op, expr } => {
                let val = self.eval(expr)?;
                self.eval_unaryop(*op, &val)
            }
            Expression::Index { base, index } => {
                let base_val = self.eval(base)?;
                let index_val = self.eval(index)?;
                let idx = index_val
                    .to_u64()
                    .ok_or_else(|| EvalError::InvalidOperation("Invalid index".to_string()))?
                    as usize;
                if let Some(bit) = base_val.get_bit(idx) {
                    Ok(SignalValue::from_u64(
                        if bit == crate::types::BitValue::One {
                            1
                        } else {
                            0
                        },
                        1,
                    ))
                } else {
                    Err(EvalError::InvalidOperation("Index out of bounds".to_string()))
                }
            }
            Expression::Slice { base, high, low } => {
                let base_val = self.eval(base)?;
                Ok(base_val.slice(*high, *low))
            }
            Expression::MethodCall {
                receiver,
                method,
                args,
            } => {
                let recv_val = self.eval(receiver)?;
                self.eval_method_call(&recv_val, method, args)
            }
            Expression::If {
                condition,
                then_expr,
                else_expr,
            } => {
                let cond_val = self.eval(condition)?;
                let is_true = cond_val.to_u64().map(|v| v != 0).unwrap_or(false);
                if is_true {
                    self.eval(then_expr)
                } else {
                    self.eval(else_expr)
                }
            }
            Expression::Concat(exprs) => {
                let mut result_bits = Vec::new();
                for e in exprs.iter().rev() {
                    let val = self.eval(e)?;
                    for i in 0..val.width() {
                        if let Some(bit) = val.get_bit(i) {
                            result_bits.push(bit);
                        }
                    }
                }
                let mut result = SignalValue::new(result_bits.len());
                for (i, bit) in result_bits.into_iter().enumerate() {
                    result.set_bit(i, bit);
                }
                Ok(result)
            }
        }
    }

    /// Evaluate a literal
    fn eval_literal(&self, lit: &Literal) -> Result<SignalValue, EvalError> {
        let (width, value) = match lit {
            Literal::Binary { width, value } => (*width, *value),
            Literal::Hex { width, value } => (*width, *value),
            Literal::Decimal { width, value } => {
                let w = width.unwrap_or(32);
                (w, *value as u64)
            }
        };
        Ok(SignalValue::from_u64(value, width))
    }

    /// Evaluate a binary operation
    fn eval_binop(
        &self,
        op: BinOp,
        lhs: &SignalValue,
        rhs: &SignalValue,
    ) -> Result<SignalValue, EvalError> {
        let width = lhs.width().max(rhs.width());

        match op {
            BinOp::Add => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot add X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot add X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64(a.wrapping_add(b), width))
            }
            BinOp::Sub => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot subtract X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot subtract X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64(a.wrapping_sub(b), width))
            }
            BinOp::Mul => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot multiply X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot multiply X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64(a.wrapping_mul(b), lhs.width() + rhs.width()))
            }
            BinOp::Div => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot divide X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot divide X/Z values".to_string())
                })?;
                if b == 0 {
                    return Err(EvalError::DivisionByZero);
                }
                Ok(SignalValue::from_u64(a / b, width))
            }
            BinOp::Mod => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot modulo X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot modulo X/Z values".to_string())
                })?;
                if b == 0 {
                    return Err(EvalError::DivisionByZero);
                }
                Ok(SignalValue::from_u64(a % b, width))
            }
            BinOp::And => Ok(lhs.and(rhs)),
            BinOp::Or => Ok(lhs.or(rhs)),
            BinOp::Xor => Ok(lhs.xor(rhs)),
            BinOp::Shl => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot shift X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot shift by X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64(a << (b as u32), lhs.width()))
            }
            BinOp::Shr => {
                let a = lhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot shift X/Z values".to_string())
                })?;
                let b = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot shift by X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64(a >> (b as u32), lhs.width()))
            }
            BinOp::Eq => {
                let result = lhs.is_equal(rhs).unwrap_or(false);
                Ok(SignalValue::from_u64(if result { 1 } else { 0 }, 1))
            }
            BinOp::Ne => {
                let result = lhs.is_equal(rhs).map(|eq| !eq).unwrap_or(true);
                Ok(SignalValue::from_u64(if result { 1 } else { 0 }, 1))
            }
            BinOp::Lt => {
                let a = lhs.to_u64();
                let b = rhs.to_u64();
                match (a, b) {
                    (Some(a), Some(b)) => Ok(SignalValue::from_u64(if a < b { 1 } else { 0 }, 1)),
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
            BinOp::Le => {
                let a = lhs.to_u64();
                let b = rhs.to_u64();
                match (a, b) {
                    (Some(a), Some(b)) => Ok(SignalValue::from_u64(if a <= b { 1 } else { 0 }, 1)),
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
            BinOp::Gt => {
                let a = lhs.to_u64();
                let b = rhs.to_u64();
                match (a, b) {
                    (Some(a), Some(b)) => Ok(SignalValue::from_u64(if a > b { 1 } else { 0 }, 1)),
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
            BinOp::Ge => {
                let a = lhs.to_u64();
                let b = rhs.to_u64();
                match (a, b) {
                    (Some(a), Some(b)) => Ok(SignalValue::from_u64(if a >= b { 1 } else { 0 }, 1)),
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
            BinOp::LogicalAnd => {
                let a = lhs.to_u64().map(|v| v != 0);
                let b = rhs.to_u64().map(|v| v != 0);
                match (a, b) {
                    (Some(a), Some(b)) => {
                        Ok(SignalValue::from_u64(if a && b { 1 } else { 0 }, 1))
                    }
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
            BinOp::LogicalOr => {
                let a = lhs.to_u64().map(|v| v != 0);
                let b = rhs.to_u64().map(|v| v != 0);
                match (a, b) {
                    (Some(a), Some(b)) => {
                        Ok(SignalValue::from_u64(if a || b { 1 } else { 0 }, 1))
                    }
                    _ => Ok(SignalValue::new_x(1)),
                }
            }
        }
    }

    /// Evaluate a unary operation
    fn eval_unaryop(&self, op: UnaryOp, val: &SignalValue) -> Result<SignalValue, EvalError> {
        match op {
            UnaryOp::Not => Ok(val.not()),
            UnaryOp::Neg => {
                let v = val.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot negate X/Z values".to_string())
                })?;
                Ok(SignalValue::from_u64((!v).wrapping_add(1), val.width()))
            }
            UnaryOp::LogNot => {
                let v = val.to_u64().map(|v| v == 0);
                match v {
                    Some(true) => Ok(SignalValue::from_u64(1, 1)),
                    Some(false) => Ok(SignalValue::from_u64(0, 1)),
                    None => Ok(SignalValue::new_x(1)),
                }
            }
        }
    }

    /// Evaluate a method call
    fn eval_method_call(
        &self,
        receiver: &SignalValue,
        method: &str,
        args: &[Expression],
    ) -> Result<SignalValue, EvalError> {
        match method {
            "extend" => {
                if args.is_empty() {
                    return Err(EvalError::InvalidOperation(
                        "extend requires width argument".to_string(),
                    ));
                }
                let width_val = self.eval(&args[0])?;
                let new_width = width_val.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Invalid width for extend".to_string())
                })? as usize;
                Ok(receiver.extend(new_width))
            }
            "truncate" => {
                if args.is_empty() {
                    return Err(EvalError::InvalidOperation(
                        "truncate requires width argument".to_string(),
                    ));
                }
                let width_val = self.eval(&args[0])?;
                let new_width = width_val.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Invalid width for truncate".to_string())
                })? as usize;
                Ok(receiver.truncate(new_width))
            }
            "width" => Ok(SignalValue::from_u64(receiver.width() as u64, 32)),
            _ => Err(EvalError::InvalidOperation(format!(
                "Unknown method: {}",
                method
            ))),
        }
    }
}
