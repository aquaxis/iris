//! Expression evaluator
//!
//! Evaluates IRIS expressions to produce signal values.

use std::collections::HashMap;
use thiserror::Error;

use crate::parser::{BinOp, Expression, Literal, UnaryOp};
use crate::types::{FloatFmt, SignalValue};

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

/// The runtime's spelling of a binary operator
pub fn runtime_binop(op: BinOp) -> iris_runtime::ops::BinOp {
    use iris_runtime::ops::BinOp as R;
    match op {
        BinOp::Add => R::Add,
        BinOp::Sub => R::Sub,
        BinOp::Mul => R::Mul,
        BinOp::Div => R::Div,
        BinOp::Mod => R::Mod,
        BinOp::And => R::And,
        BinOp::Or => R::Or,
        BinOp::Xor => R::Xor,
        BinOp::Shl => R::Shl,
        BinOp::Shr => R::Shr,
        BinOp::AShr => R::AShr,
        BinOp::Eq => R::Eq,
        BinOp::Ne => R::Ne,
        BinOp::Lt => R::Lt,
        BinOp::Le => R::Le,
        BinOp::Gt => R::Gt,
        BinOp::Ge => R::Ge,
        BinOp::LogicalAnd => R::LogicalAnd,
        BinOp::LogicalOr => R::LogicalOr,
    }
}

/// The runtime's spelling of a unary operator
pub fn runtime_unop(op: UnaryOp) -> iris_runtime::ops::UnaryOp {
    use iris_runtime::ops::UnaryOp as R;
    match op {
        UnaryOp::Not => R::Not,
        UnaryOp::Neg => R::Neg,
        UnaryOp::LogNot => R::LogNot,
    }
}

/// The text of a real literal, if the expression is one. A real literal has no
/// format on its own; it takes the format of the floating-point value it is
/// used with, so it cannot be evaluated in isolation.
pub(crate) fn real_text(expr: &Expression) -> Option<&str> {
    match expr {
        Expression::Literal(Literal::Real { text }) => Some(text),
        _ => None,
    }
}

/// A real literal encoded into a floating-point format.
pub(crate) fn real_to_value(text: &str, fmt: FloatFmt) -> Result<SignalValue, EvalError> {
    let invalid =
        || EvalError::InvalidOperation(format!("invalid floating-point literal '{}'", text));
    match fmt {
        FloatFmt::F32 => text.parse::<f32>().map(SignalValue::from_f32).map_err(|_| invalid()),
        FloatFmt::F64 => text.parse::<f64>().map(SignalValue::from_f64).map_err(|_| invalid()),
    }
}

/// A floating-point binary operation, as the interpreter uses it.
///
/// The arithmetic itself is `iris_runtime::ops::float_binop`, shared with the
/// code `iris-compile` generates so the two agree. This wrapper adds the
/// interpreter's diagnostics: it refuses unknown bits and operators floating
/// point does not define, rather than falling back silently.
pub(crate) fn float_binop(
    op: BinOp,
    lhs: &SignalValue,
    rhs: &SignalValue,
    fmt: FloatFmt,
) -> Result<SignalValue, EvalError> {
    let known = match fmt {
        FloatFmt::F32 => lhs.as_f32().is_some() && rhs.as_f32().is_some(),
        FloatFmt::F64 => lhs.as_f64().is_some() && rhs.as_f64().is_some(),
    };
    if !known {
        return Err(EvalError::InvalidOperation(
            "a floating-point operand has unknown bits".to_string(),
        ));
    }
    if !matches!(
        op,
        BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Eq
            | BinOp::Ne
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
    ) {
        return Err(EvalError::InvalidOperation(format!(
            "operator {:?} is not supported on floating point",
            op
        )));
    }
    Ok(iris_runtime::ops::float_binop(runtime_binop(op), lhs, rhs, fmt))
}

/// Do the low `tag_width` bits of a value hold this tag?
pub fn matches_tag(value: &SignalValue, tag: u64, tag_width: usize) -> bool {
    let mask = if tag_width >= 64 {
        u64::MAX
    } else {
        (1u64 << tag_width) - 1
    };
    value.to_u64().map(|v| v & mask == tag).unwrap_or(false)
}

/// The payload a tagged value carries
pub fn payload_of(value: &SignalValue, tag_width: usize, payload_width: usize) -> SignalValue {
    iris_runtime::ops::slice(value, tag_width + payload_width - 1, tag_width)
}

/// The memory a name refers to, written either plainly or hierarchically.
///
/// `storage` parses as an identifier, but `dut.storage` parses as a method
/// call on `dut`, so both forms have to be recognised.
pub fn memory_path(expr: &Expression) -> Option<String> {
    match expr {
        Expression::Ident(name) => Some(name.clone()),
        Expression::MethodCall {
            receiver,
            method,
            args,
        } if args.is_empty() => Some(format!("{}.{}", memory_path(receiver)?, method)),
        _ => None,
    }
}

/// Is this expression a decimal literal written without a width suffix?
///
/// Such a literal takes the width of the other operand, so `ptr + 1` wraps at
/// the width of `ptr` instead of at 32 bits.
pub fn is_unsized_literal(expr: &Expression) -> bool {
    matches!(expr, Expression::Literal(Literal::Decimal { width: None, .. }))
}

/// Expression evaluator
/// Evaluate a system function that survived elaboration, using `value_of` to
/// resolve its argument. Only the synthesisable functions are handled.
pub fn eval_sys_func<F>(expr: &Expression, value_of: F) -> Option<i64>
where
    F: Fn(&Expression) -> Option<i64>,
{
    use crate::parser::SysFuncArg;
    let Expression::SysFunc { name, args } = expr else {
        return None;
    };
    match (name.as_str(), args.first()) {
        ("clog2", Some(SysFuncArg::Expr(e))) => value_of(e).map(crate::project::clog2),
        ("bits", Some(SysFuncArg::Type(t))) => t.width().map(|w| w as i64),
        _ => None,
    }
}

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
            Expression::Call { name, .. } => Err(EvalError::InvalidOperation(format!(
                "call to unknown function '{}'",
                name
            ))),
            Expression::Literal(lit) => self.eval_literal(lit),
            Expression::Ident(name) => self
                .signals
                .get(name)
                .cloned()
                .ok_or_else(|| EvalError::UndefinedSignal(name.clone())),
            Expression::BinOp { op, lhs, rhs } => {
                // A real literal has no format on its own, so it is not
                // evaluated yet; its format comes from the other operand.
                let lhs_real = real_text(lhs);
                let rhs_real = real_text(rhs);
                let lhs_val = if lhs_real.is_none() { Some(self.eval(lhs)?) } else { None };
                let rhs_val = if rhs_real.is_none() { Some(self.eval(rhs)?) } else { None };

                // A floating-point operand makes this a floating-point op. The
                // format travels with the value, so no type lookup is needed.
                let fmt = lhs_val
                    .as_ref()
                    .and_then(|v| v.float_fmt())
                    .or_else(|| rhs_val.as_ref().and_then(|v| v.float_fmt()));
                if let Some(fmt) = fmt {
                    let a = match lhs_real {
                        Some(t) => real_to_value(t, fmt)?,
                        None => lhs_val.unwrap(),
                    };
                    let b = match rhs_real {
                        Some(t) => real_to_value(t, fmt)?,
                        None => rhs_val.unwrap(),
                    };
                    return float_binop(*op, &a, &b, fmt);
                }

                let real_needs_float = || {
                    EvalError::InvalidOperation(
                        "a real literal needs a floating-point operand".to_string(),
                    )
                };
                let lhs_val = lhs_val.ok_or_else(real_needs_float)?;
                let rhs_val = rhs_val.ok_or_else(real_needs_float)?;
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
                let high = self.eval(high)?.to_u64().unwrap_or(0) as usize;
                let low = self.eval(low)?.to_u64().unwrap_or(0) as usize;
                Ok(base_val.slice(high, low))
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
            Expression::Replicate { count, value } => {
                let times = self.eval(count)?.to_u64().unwrap_or(0) as usize;
                let mut repeated = Vec::new();
                for _ in 0..times {
                    repeated.extend(value.iter().cloned());
                }
                self.eval(&Expression::Concat(repeated))
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
            Expression::MemRead { mem_name, .. } => {
                // Basic evaluator doesn't have memory access
                Err(EvalError::UndefinedSignal(format!(
                    "memory read {} (requires HierarchicalEvaluator)",
                    mem_name
                )))
            }
            Expression::PartSelect {
                base,
                index,
                width,
                upward,
            } => {
                let base_val = self.eval(base)?;
                let index = self.eval(index)?.to_u64().unwrap_or(0) as usize;
                let width = self.eval(width)?.to_u64().unwrap_or(1).max(1) as usize;
                let low = if *upward {
                    index
                } else {
                    index.saturating_sub(width - 1)
                };
                Ok(base_val.slice(low + width - 1, low))
            }
            Expression::SysFunc { .. } => eval_sys_func(expr, |e| {
                self.eval(e).ok().and_then(|v| v.to_u64()).map(|v| v as i64)
            })
            .map(|v| SignalValue::from_u64(v as u64, 32))
            .ok_or_else(|| {
                EvalError::InvalidOperation(format!("cannot evaluate {}", expr))
            }),
            Expression::Match { scrutinee, arms } => {
                let value = self.eval(scrutinee)?;
                for arm in arms {
                    if self.pattern_matches(&arm.pattern, &value) {
                        return self.eval(&arm.value);
                    }
                }
                Err(EvalError::InvalidOperation(
                    "match expression has no arm covering the value".to_string(),
                ))
            }
        }
    }

    /// Does a match pattern accept this value?
    fn pattern_matches(&self, pattern: &crate::parser::Pattern, value: &SignalValue) -> bool {
        use crate::parser::Pattern;
        match pattern {
            Pattern::Wildcard => true,
            Pattern::Literal(lit) => Some(lit.to_u64()) == value.to_u64(),
            Pattern::Ident(name) => match self.signals.get(name) {
                Some(v) => v.to_u64() == value.to_u64(),
                None => false,
            },
            Pattern::Variant { tag, tag_width, .. } => {
                matches_tag(value, *tag, *tag_width)
            }
            // Only an elaborated pattern can be matched
            Pattern::Path { .. } => false,
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
            // Floating point is parsed but not evaluated yet. Refuse it rather
            // than computing its bits as an integer.
            Literal::Real { text } => {
                return Err(EvalError::InvalidOperation(format!(
                    "floating-point literal '{}' is not implemented yet",
                    text
                )))
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
            BinOp::AShr => {
                // Arithmetic shift keeps the sign when both sides are signed
                let width = lhs.width();
                let shift = rhs.to_u64().ok_or_else(|| {
                    EvalError::InvalidOperation("Cannot shift by an X/Z amount".to_string())
                })? as u32;
                if lhs.is_signed() {
                    let a = lhs.to_i64().ok_or_else(|| {
                        EvalError::InvalidOperation("Cannot shift X/Z values".to_string())
                    })?;
                    Ok(SignalValue::from_i64(a >> shift.min(63), width))
                } else {
                    let a = lhs.to_u64().ok_or_else(|| {
                        EvalError::InvalidOperation("Cannot shift X/Z values".to_string())
                    })?;
                    Ok(SignalValue::from_u64(a >> shift, width))
                }
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
