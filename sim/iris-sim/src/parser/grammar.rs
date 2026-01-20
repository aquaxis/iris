//! IRIS grammar parser using pest
//!
//! This module provides the parser implementation using the pest grammar.

use pest::Parser as PestParser;
use pest_derive::Parser as DeriveParser;
use thiserror::Error;

use super::ast::*;

#[derive(DeriveParser)]
#[grammar = "parser/iris.pest"]
pub struct IrisParser;

/// Parse error type
#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Syntax error at line {line}, column {column}: {message}")]
    SyntaxError {
        message: String,
        line: usize,
        column: usize,
    },
    #[error("Unexpected token: {0}")]
    UnexpectedToken(String),
    #[error("Invalid literal: {0}")]
    InvalidLiteral(String),
}

/// IRIS Parser
pub struct Parser;

impl Parser {
    /// Create a new parser
    pub fn new() -> Self {
        Self
    }

    /// Parse IRIS source code into a Module AST
    pub fn parse(&self, source: &str) -> Result<Module, ParseError> {
        let pairs = IrisParser::parse(Rule::file, source).map_err(|e| {
            let (line, column) = match e.line_col {
                pest::error::LineColLocation::Pos((l, c)) => (l, c),
                pest::error::LineColLocation::Span((l, c), _) => (l, c),
            };
            ParseError::SyntaxError {
                message: e.variant.message().to_string(),
                line,
                column,
            }
        })?;

        // file rule contains module_decl* and test_mod_decl*, so we need to iterate into_inner()
        for pair in pairs {
            if pair.as_rule() == Rule::file {
                for inner_pair in pair.into_inner() {
                    match inner_pair.as_rule() {
                        Rule::module_decl => {
                            return self.parse_module(inner_pair, false);
                        }
                        Rule::test_mod_decl => {
                            return self.parse_module(inner_pair, true);
                        }
                        _ => {}
                    }
                }
            } else if pair.as_rule() == Rule::module_decl {
                return self.parse_module(pair, false);
            } else if pair.as_rule() == Rule::test_mod_decl {
                return self.parse_module(pair, true);
            }
        }

        Err(ParseError::SyntaxError {
            message: "No module found".to_string(),
            line: 1,
            column: 1,
        })
    }

    fn parse_module(&self, pair: pest::iterators::Pair<Rule>, is_test: bool) -> Result<Module, ParseError> {
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected module name".to_string()))?
            .as_str()
            .to_string();

        let mut generics = Vec::new();
        let mut ports = Vec::new();
        let mut signals = Vec::new();
        let mut logic_blocks = Vec::new();
        let mut instances = Vec::new();

        for pair in inner {
            match pair.as_rule() {
                Rule::generics => {
                    generics = self.parse_generics(pair)?;
                }
                Rule::port_list => {
                    ports = self.parse_port_list(pair)?;
                }
                Rule::module_body | Rule::test_body => {
                    // Both module_body and test_body have the same structure
                    self.parse_body_items(pair, &mut signals, &mut logic_blocks, &mut instances)?;
                }
                _ => {}
            }
        }

        Ok(Module {
            name,
            generics,
            ports,
            signals,
            logic_blocks,
            instances,
            span: None,
            is_test,
        })
    }

    fn parse_body_items(
        &self,
        pair: pest::iterators::Pair<Rule>,
        signals: &mut Vec<Signal>,
        logic_blocks: &mut Vec<LogicBlock>,
        instances: &mut Vec<Instance>,
    ) -> Result<(), ParseError> {
        for item in pair.into_inner() {
            match item.as_rule() {
                Rule::signal_decl => {
                    signals.push(self.parse_signal_decl(item)?);
                }
                Rule::logic_block => {
                    logic_blocks.push(self.parse_logic_block(item)?);
                }
                Rule::instance => {
                    instances.push(self.parse_instance(item)?);
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn parse_generics(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Vec<GenericParam>, ParseError> {
        let mut generics = Vec::new();
        for param in pair.into_inner() {
            if param.as_rule() == Rule::generic_param {
                let mut inner = param.into_inner();
                let name = inner
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected generic name".to_string())
                    })?
                    .as_str()
                    .to_string();
                let ty = self.parse_type(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected generic type".to_string())
                })?)?;
                let default_value = inner.next().map(|p| self.parse_expr(p)).transpose()?;
                generics.push(GenericParam {
                    name,
                    ty,
                    default_value,
                });
            }
        }
        Ok(generics)
    }

    fn parse_port_list(&self, pair: pest::iterators::Pair<Rule>) -> Result<Vec<Port>, ParseError> {
        let mut ports = Vec::new();
        for port in pair.into_inner() {
            if port.as_rule() == Rule::port_decl {
                ports.push(self.parse_port_decl(port)?);
            }
        }
        Ok(ports)
    }

    fn parse_port_decl(&self, pair: pest::iterators::Pair<Rule>) -> Result<Port, ParseError> {
        let mut inner = pair.into_inner();

        let direction = match inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected port direction".to_string()))?
            .as_str()
        {
            "in" => PortDirection::In,
            "out" => PortDirection::Out,
            "inout" => PortDirection::InOut,
            _ => {
                return Err(ParseError::UnexpectedToken(
                    "Invalid port direction".to_string(),
                ))
            }
        };

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected port name".to_string()))?
            .as_str()
            .to_string();

        let ty = self.parse_type(
            inner
                .next()
                .ok_or_else(|| ParseError::UnexpectedToken("Expected port type".to_string()))?,
        )?;

        Ok(Port {
            name,
            direction,
            ty,
        })
    }

    fn parse_type(&self, pair: pest::iterators::Pair<Rule>) -> Result<Type, ParseError> {
        let inner = pair.into_inner().next();
        if inner.is_none() {
            return Ok(Type::Bit);
        }
        let inner = inner.unwrap();

        match inner.as_rule() {
            Rule::base_type => {
                let base = inner.into_inner().next();
                if base.is_none() {
                    return Ok(Type::Bit);
                }
                let base = base.unwrap();
                match base.as_rule() {
                    Rule::bit_type => {
                        let width_pair = base.into_inner().next();
                        if let Some(w) = width_pair {
                            let width_expr = w.into_inner().next();
                            if let Some(we) = width_expr {
                                let width: usize = we.as_str().parse().map_err(|_| {
                                    ParseError::InvalidLiteral("Invalid bit width".to_string())
                                })?;
                                Ok(Type::BitVec { width })
                            } else {
                                Ok(Type::Bit)
                            }
                        } else {
                            Ok(Type::Bit)
                        }
                    }
                    Rule::clock_type => Ok(Type::Clock),
                    Rule::reset_type => {
                        let active_low = base.as_str().contains("active_low");
                        Ok(Type::Reset { active_low })
                    }
                    Rule::identifier => Ok(Type::Named(base.as_str().to_string())),
                    _ => Ok(Type::Bit),
                }
            }
            _ => Ok(Type::Bit),
        }
    }

    fn parse_signal_decl(&self, pair: pest::iterators::Pair<Rule>) -> Result<Signal, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected signal declaration".to_string())
        })?;

        let (is_var, is_mutable) = match inner.as_rule() {
            Rule::var_decl => (true, true),
            Rule::let_decl => {
                let has_mut = inner.as_str().contains("mut");
                (false, has_mut)
            }
            _ => (false, false),
        };

        let mut parts = inner.into_inner();
        let name = parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected signal name".to_string()))?
            .as_str()
            .to_string();

        let mut ty = Type::Bit;
        let mut init_value = None;

        for part in parts {
            match part.as_rule() {
                Rule::type_expr => {
                    ty = self.parse_type(part)?;
                }
                Rule::expr => {
                    init_value = Some(self.parse_expr(part)?);
                }
                _ => {}
            }
        }

        Ok(Signal {
            name,
            ty,
            init_value,
            is_mutable,
            is_var,
        })
    }

    fn parse_logic_block(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<LogicBlock, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected logic block".to_string())
        })?;

        match inner.as_rule() {
            Rule::comb_block => {
                let statements = self.parse_statements(inner)?;
                Ok(LogicBlock::Comb(CombBlock { statements }))
            }
            Rule::sync_block => {
                let mut parts = inner.into_inner();
                let clock = self.parse_clock_spec(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected clock spec".to_string())
                })?)?;

                let mut reset = None;
                let mut statements = Vec::new();

                for part in parts {
                    match part.as_rule() {
                        Rule::reset_spec => {
                            reset = Some(self.parse_reset_spec(part)?);
                        }
                        Rule::statement => {
                            statements.push(self.parse_statement(part)?);
                        }
                        _ => {}
                    }
                }

                Ok(LogicBlock::Sync(SyncBlock {
                    clock,
                    reset,
                    statements,
                }))
            }
            _ => Err(ParseError::UnexpectedToken(
                "Invalid logic block".to_string(),
            )),
        }
    }

    fn parse_clock_spec(&self, pair: pest::iterators::Pair<Rule>) -> Result<ClockSpec, ParseError> {
        let mut inner = pair.into_inner();
        let signal = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected clock signal".to_string()))?
            .as_str()
            .to_string();
        let edge = match inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected clock edge".to_string()))?
            .as_str()
        {
            "posedge" => ClockEdge::Posedge,
            "negedge" => ClockEdge::Negedge,
            _ => return Err(ParseError::UnexpectedToken("Invalid clock edge".to_string())),
        };
        Ok(ClockSpec { signal, edge })
    }

    fn parse_reset_spec(&self, pair: pest::iterators::Pair<Rule>) -> Result<ResetSpec, ParseError> {
        let mut inner = pair.into_inner();
        let signal = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected reset signal".to_string()))?
            .as_str()
            .to_string();
        let mode = match inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected reset mode".to_string()))?
            .as_str()
        {
            "sync" => ResetMode::Sync,
            "async" => ResetMode::Async,
            _ => return Err(ParseError::UnexpectedToken("Invalid reset mode".to_string())),
        };
        Ok(ResetSpec { signal, mode })
    }

    fn parse_statements(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Vec<Statement>, ParseError> {
        let mut statements = Vec::new();
        for stmt in pair.into_inner() {
            if stmt.as_rule() == Rule::statement {
                statements.push(self.parse_statement(stmt)?);
            }
        }
        Ok(statements)
    }

    fn parse_statement(&self, pair: pest::iterators::Pair<Rule>) -> Result<Statement, ParseError> {
        let inner = pair
            .into_inner()
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected statement".to_string()))?;

        match inner.as_rule() {
            Rule::assign_stmt => {
                let mut parts = inner.into_inner();
                let target = parts
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected assignment target".to_string())
                    })?
                    .as_str()
                    .to_string();
                let value = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected assignment value".to_string())
                })?)?;
                Ok(Statement::Assign { target, value })
            }
            Rule::if_stmt => {
                let mut parts = inner.into_inner();
                let condition = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected if condition".to_string())
                })?)?;

                let mut then_branch = Vec::new();
                let mut else_branch = None;
                let mut in_else = false;

                for part in parts {
                    if part.as_rule() == Rule::statement {
                        let stmt = self.parse_statement(part)?;
                        if in_else {
                            else_branch.get_or_insert_with(Vec::new).push(stmt);
                        } else {
                            then_branch.push(stmt);
                        }
                    } else if part.as_str() == "else" {
                        in_else = true;
                    }
                }

                Ok(Statement::If {
                    condition,
                    then_branch,
                    else_branch,
                })
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unexpected statement type: {:?}",
                inner.as_rule()
            ))),
        }
    }

    fn parse_expr(&self, pair: pest::iterators::Pair<Rule>) -> Result<Expression, ParseError> {
        let mut inner = pair.into_inner();
        let first = inner.next();

        if first.is_none() {
            return Err(ParseError::UnexpectedToken(
                "Empty expression".to_string(),
            ));
        }

        let first = first.unwrap();
        let mut lhs = self.parse_unary_expr(first)?;

        while let Some(op_pair) = inner.next() {
            if op_pair.as_rule() == Rule::bin_op {
                let op = self.parse_bin_op(op_pair)?;
                let rhs_pair = inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected right operand".to_string())
                })?;
                let rhs = self.parse_unary_expr(rhs_pair)?;
                lhs = Expression::BinOp {
                    op,
                    lhs: Box::new(lhs),
                    rhs: Box::new(rhs),
                };
            }
        }

        Ok(lhs)
    }

    fn parse_unary_expr(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Expression, ParseError> {
        let mut inner = pair.into_inner();
        let mut ops = Vec::new();

        // Collect unary operators
        while let Some(p) = inner.peek() {
            if p.as_rule() == Rule::unary_op {
                ops.push(self.parse_unary_op(inner.next().unwrap())?);
            } else {
                break;
            }
        }

        // Parse primary expression
        let primary = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected primary expression".to_string()))?;
        let mut expr = self.parse_primary_expr(primary)?;

        // Apply postfix operators
        for postfix in inner {
            if postfix.as_rule() == Rule::postfix {
                expr = self.apply_postfix(expr, postfix)?;
            }
        }

        // Apply unary operators (in reverse order)
        for op in ops.into_iter().rev() {
            expr = Expression::UnaryOp {
                op,
                expr: Box::new(expr),
            };
        }

        Ok(expr)
    }

    fn parse_primary_expr(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Expression, ParseError> {
        match pair.as_rule() {
            Rule::primary_expr => {
                let inner = pair.into_inner().next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Empty primary expression".to_string())
                })?;
                self.parse_primary_expr(inner)
            }
            Rule::literal => self.parse_literal(pair).map(Expression::Literal),
            Rule::identifier => Ok(Expression::Ident(pair.as_str().to_string())),
            Rule::paren_expr => {
                let inner = pair.into_inner().next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Empty parenthesized expression".to_string())
                })?;
                self.parse_expr(inner)
            }
            Rule::concat_expr => {
                let exprs: Result<Vec<_>, _> =
                    pair.into_inner().map(|p| self.parse_expr(p)).collect();
                Ok(Expression::Concat(exprs?))
            }
            Rule::if_expr => {
                let mut inner = pair.into_inner();
                let condition = self.parse_expr(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected if condition".to_string())
                })?)?;
                let then_expr = self.parse_expr(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected then expression".to_string())
                })?)?;
                let else_expr = self.parse_expr(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected else expression".to_string())
                })?)?;
                Ok(Expression::If {
                    condition: Box::new(condition),
                    then_expr: Box::new(then_expr),
                    else_expr: Box::new(else_expr),
                })
            }
            Rule::integer => {
                let value: i64 = pair.as_str().parse().map_err(|_| {
                    ParseError::InvalidLiteral("Invalid integer".to_string())
                })?;
                Ok(Expression::Literal(Literal::Decimal { width: None, value }))
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unexpected primary expression: {:?}",
                pair.as_rule()
            ))),
        }
    }

    fn apply_postfix(
        &self,
        base: Expression,
        postfix: pest::iterators::Pair<Rule>,
    ) -> Result<Expression, ParseError> {
        let inner = postfix.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Empty postfix".to_string())
        })?;

        match inner.as_rule() {
            Rule::index => {
                let index_expr = self.parse_expr(inner.into_inner().next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected index expression".to_string())
                })?)?;
                Ok(Expression::Index {
                    base: Box::new(base),
                    index: Box::new(index_expr),
                })
            }
            Rule::slice => {
                let mut parts = inner.into_inner();
                let high: usize = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected slice high".to_string()))?
                    .as_str()
                    .parse()
                    .map_err(|_| ParseError::InvalidLiteral("Invalid slice index".to_string()))?;
                let low: usize = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected slice low".to_string()))?
                    .as_str()
                    .parse()
                    .map_err(|_| ParseError::InvalidLiteral("Invalid slice index".to_string()))?;
                Ok(Expression::Slice {
                    base: Box::new(base),
                    high,
                    low,
                })
            }
            Rule::method_call => {
                let mut parts = inner.into_inner();
                let method = parts
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected method name".to_string())
                    })?
                    .as_str()
                    .to_string();
                let args: Result<Vec<_>, _> = parts.map(|p| self.parse_expr(p)).collect();
                Ok(Expression::MethodCall {
                    receiver: Box::new(base),
                    method,
                    args: args?,
                })
            }
            Rule::field_access => {
                let field = inner
                    .into_inner()
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected field name".to_string()))?
                    .as_str()
                    .to_string();
                Ok(Expression::MethodCall {
                    receiver: Box::new(base),
                    method: field,
                    args: vec![],
                })
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown postfix: {:?}",
                inner.as_rule()
            ))),
        }
    }

    fn parse_literal(&self, pair: pest::iterators::Pair<Rule>) -> Result<Literal, ParseError> {
        let inner = pair.into_inner().next();
        if inner.is_none() {
            return Err(ParseError::InvalidLiteral("Empty literal".to_string()));
        }
        let inner = inner.unwrap();

        match inner.as_rule() {
            Rule::sized_literal => {
                let mut parts = inner.into_inner();
                let width: usize = parts
                    .next()
                    .ok_or_else(|| ParseError::InvalidLiteral("Expected width".to_string()))?
                    .as_str()
                    .parse()
                    .map_err(|_| ParseError::InvalidLiteral("Invalid width".to_string()))?;

                let value_part = parts
                    .next()
                    .ok_or_else(|| ParseError::InvalidLiteral("Expected value".to_string()))?;

                match value_part.as_rule() {
                    Rule::bin_literal => {
                        let digits = value_part
                            .into_inner()
                            .next()
                            .ok_or_else(|| {
                                ParseError::InvalidLiteral("Expected binary digits".to_string())
                            })?
                            .as_str()
                            .replace('_', "");
                        let value = u64::from_str_radix(&digits, 2).map_err(|_| {
                            ParseError::InvalidLiteral("Invalid binary literal".to_string())
                        })?;
                        Ok(Literal::Binary { width, value })
                    }
                    Rule::hex_literal => {
                        let digits = value_part
                            .into_inner()
                            .next()
                            .ok_or_else(|| {
                                ParseError::InvalidLiteral("Expected hex digits".to_string())
                            })?
                            .as_str()
                            .replace('_', "");
                        let value = u64::from_str_radix(&digits, 16).map_err(|_| {
                            ParseError::InvalidLiteral("Invalid hex literal".to_string())
                        })?;
                        Ok(Literal::Hex { width, value })
                    }
                    Rule::dec_literal => {
                        let digits = value_part
                            .into_inner()
                            .next()
                            .ok_or_else(|| {
                                ParseError::InvalidLiteral("Expected decimal digits".to_string())
                            })?
                            .as_str();
                        let value: i64 = digits.parse().map_err(|_| {
                            ParseError::InvalidLiteral("Invalid decimal literal".to_string())
                        })?;
                        Ok(Literal::Decimal {
                            width: Some(width),
                            value,
                        })
                    }
                    _ => Err(ParseError::InvalidLiteral("Unknown literal type".to_string())),
                }
            }
            Rule::integer => {
                let value: i64 = inner.as_str().parse().map_err(|_| {
                    ParseError::InvalidLiteral("Invalid integer".to_string())
                })?;
                Ok(Literal::Decimal { width: None, value })
            }
            _ => Err(ParseError::InvalidLiteral(format!(
                "Unknown literal: {:?}",
                inner.as_rule()
            ))),
        }
    }

    fn parse_bin_op(&self, pair: pest::iterators::Pair<Rule>) -> Result<BinOp, ParseError> {
        match pair.as_str() {
            "+" => Ok(BinOp::Add),
            "-" => Ok(BinOp::Sub),
            "*" => Ok(BinOp::Mul),
            "/" => Ok(BinOp::Div),
            "%" => Ok(BinOp::Mod),
            "&" => Ok(BinOp::And),
            "|" => Ok(BinOp::Or),
            "^" => Ok(BinOp::Xor),
            "<<" => Ok(BinOp::Shl),
            ">>" => Ok(BinOp::Shr),
            "==" => Ok(BinOp::Eq),
            "!=" => Ok(BinOp::Ne),
            "<" => Ok(BinOp::Lt),
            "<=" => Ok(BinOp::Le),
            ">" => Ok(BinOp::Gt),
            ">=" => Ok(BinOp::Ge),
            "&&" => Ok(BinOp::LogicalAnd),
            "||" => Ok(BinOp::LogicalOr),
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown operator: {}",
                pair.as_str()
            ))),
        }
    }

    fn parse_unary_op(&self, pair: pest::iterators::Pair<Rule>) -> Result<UnaryOp, ParseError> {
        match pair.as_str() {
            "!" => Ok(UnaryOp::LogNot),
            "~" => Ok(UnaryOp::Not),
            "-" => Ok(UnaryOp::Neg),
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown unary operator: {}",
                pair.as_str()
            ))),
        }
    }

    fn parse_instance(&self, pair: pest::iterators::Pair<Rule>) -> Result<Instance, ParseError> {
        let mut inner = pair.into_inner();

        // Instance name
        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected instance name".to_string()))?
            .as_str()
            .to_string();

        let mut array_size = None;
        let mut module_name = String::new();
        let mut generic_args = Vec::new();
        let mut port_connections = Vec::new();

        for part in inner {
            match part.as_rule() {
                Rule::array_size => {
                    let size_str = part.into_inner()
                        .next()
                        .ok_or_else(|| ParseError::InvalidLiteral("Expected array size".to_string()))?
                        .as_str();
                    array_size = Some(size_str.parse().map_err(|_| {
                        ParseError::InvalidLiteral("Invalid array size".to_string())
                    })?);
                }
                Rule::identifier => {
                    module_name = part.as_str().to_string();
                }
                Rule::generic_args => {
                    for arg in part.into_inner() {
                        if arg.as_rule() == Rule::generic_arg {
                            let mut arg_inner = arg.into_inner();
                            let arg_name = arg_inner
                                .next()
                                .ok_or_else(|| ParseError::UnexpectedToken("Expected generic arg name".to_string()))?
                                .as_str()
                                .to_string();
                            let arg_value = self.parse_expr(arg_inner.next().ok_or_else(|| {
                                ParseError::UnexpectedToken("Expected generic arg value".to_string())
                            })?)?;
                            generic_args.push((arg_name, arg_value));
                        }
                    }
                }
                Rule::port_connections => {
                    for conn in part.into_inner() {
                        if conn.as_rule() == Rule::port_connection {
                            let mut conn_inner = conn.into_inner();
                            let port_name = conn_inner
                                .next()
                                .ok_or_else(|| ParseError::UnexpectedToken("Expected port name".to_string()))?
                                .as_str()
                                .to_string();
                            let signal = self.parse_expr(conn_inner.next().ok_or_else(|| {
                                ParseError::UnexpectedToken("Expected port signal".to_string())
                            })?)?;
                            port_connections.push((port_name, signal));
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(Instance {
            name,
            module_name,
            generic_args,
            port_connections,
            array_size,
        })
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}
