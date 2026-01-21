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

/// Parse result containing both modules and interfaces
#[derive(Debug, Default)]
pub struct ParseResult {
    pub modules: Vec<Module>,
    pub interfaces: Vec<Interface>,
}

/// IRIS Parser
pub struct Parser;

impl Parser {
    /// Create a new parser
    pub fn new() -> Self {
        Self
    }

    /// Parse IRIS source code into a Module AST (returns first module found)
    pub fn parse(&self, source: &str) -> Result<Module, ParseError> {
        let result = self.parse_all(source)?;
        result.modules.into_iter().next().ok_or_else(|| ParseError::SyntaxError {
            message: "No module found".to_string(),
            line: 1,
            column: 1,
        })
    }

    /// Parse IRIS source code and return all modules and interfaces
    pub fn parse_all(&self, source: &str) -> Result<ParseResult, ParseError> {
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

        let mut result = ParseResult::default();

        // file rule contains module_decl*, test_mod_decl*, interface_decl*
        for pair in pairs {
            if pair.as_rule() == Rule::file {
                for inner_pair in pair.into_inner() {
                    match inner_pair.as_rule() {
                        Rule::module_decl => {
                            result.modules.push(self.parse_module(inner_pair, false)?);
                        }
                        Rule::test_mod_decl => {
                            result.modules.push(self.parse_module(inner_pair, true)?);
                        }
                        Rule::interface_decl => {
                            result.interfaces.push(self.parse_interface(inner_pair)?);
                        }
                        _ => {}
                    }
                }
            } else {
                match pair.as_rule() {
                    Rule::module_decl => {
                        result.modules.push(self.parse_module(pair, false)?);
                    }
                    Rule::test_mod_decl => {
                        result.modules.push(self.parse_module(pair, true)?);
                    }
                    Rule::interface_decl => {
                        result.interfaces.push(self.parse_interface(pair)?);
                    }
                    _ => {}
                }
            }
        }

        Ok(result)
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
        let mut seq_blocks = Vec::new();
        let mut initial_blocks = Vec::new();
        let mut fsm_blocks = Vec::new();
        let mut memories = Vec::new();

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
                    self.parse_body_items(pair, &mut signals, &mut logic_blocks, &mut instances, &mut seq_blocks, &mut initial_blocks, &mut fsm_blocks, &mut memories)?;
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
            seq_blocks,
            initial_blocks,
            fsm_blocks,
            memories,
        })
    }

    fn parse_body_items(
        &self,
        pair: pest::iterators::Pair<Rule>,
        signals: &mut Vec<Signal>,
        logic_blocks: &mut Vec<LogicBlock>,
        instances: &mut Vec<Instance>,
        seq_blocks: &mut Vec<SeqBlock>,
        initial_blocks: &mut Vec<InitialBlock>,
        fsm_blocks: &mut Vec<FsmBlock>,
        memories: &mut Vec<MemDecl>,
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
                Rule::seq_block => {
                    seq_blocks.push(self.parse_seq_block(item)?);
                }
                Rule::initial_block => {
                    initial_blocks.push(self.parse_initial_block(item)?);
                }
                Rule::fsm_block => {
                    fsm_blocks.push(self.parse_fsm_block(item)?);
                }
                Rule::mem_decl => {
                    memories.push(self.parse_mem_decl(item)?);
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
        let (ty, _, _) = self.parse_type_with_config(pair)?;
        Ok(ty)
    }

    /// Parse type with optional clock/reset configuration
    fn parse_type_with_config(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<(Type, Option<ClockConfig>, Option<ResetConfig>), ParseError> {
        let inner = pair.into_inner().next();
        if inner.is_none() {
            return Ok((Type::Bit, None, None));
        }
        let inner = inner.unwrap();

        match inner.as_rule() {
            Rule::base_type => {
                let base = inner.into_inner().next();
                if base.is_none() {
                    return Ok((Type::Bit, None, None));
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
                                Ok((Type::BitVec { width }, None, None))
                            } else {
                                Ok((Type::Bit, None, None))
                            }
                        } else {
                            Ok((Type::Bit, None, None))
                        }
                    }
                    Rule::clock_type => {
                        // Parse clock configuration if present
                        let clock_config = self.parse_clock_type_config(base)?;
                        Ok((Type::Clock, clock_config, None))
                    }
                    Rule::reset_type => {
                        // Parse reset configuration
                        let reset_config = self.parse_reset_type_config(base)?;
                        let active_low = reset_config.as_ref().map(|c| c.active_low).unwrap_or(false);
                        Ok((Type::Reset { active_low }, None, reset_config))
                    }
                    Rule::identifier => Ok((Type::Named(base.as_str().to_string()), None, None)),
                    _ => Ok((Type::Bit, None, None)),
                }
            }
            _ => Ok((Type::Bit, None, None)),
        }
    }

    /// Parse clock type configuration: clock(period: 10ns)
    fn parse_clock_type_config(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Option<ClockConfig>, ParseError> {
        let mut config = ClockConfig::default();
        let mut has_config = false;

        for inner in pair.into_inner() {
            if inner.as_rule() == Rule::clock_config {
                has_config = true;
                for config_inner in inner.into_inner() {
                    if config_inner.as_rule() == Rule::duration {
                        let duration = self.parse_duration(config_inner)?;
                        config.period = Some(duration);
                    }
                }
            }
        }

        if has_config {
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Parse reset type configuration: reset(active_low: true, assert_cycles: 5)
    fn parse_reset_type_config(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Option<ResetConfig>, ParseError> {
        let mut config = ResetConfig::default();
        let mut has_config = false;

        for inner in pair.into_inner() {
            if inner.as_rule() == Rule::reset_config {
                has_config = true;
                for param in inner.into_inner() {
                    match param.as_rule() {
                        Rule::reset_active_low => {
                            // Parse active_low: true/false
                            for p in param.into_inner() {
                                if p.as_rule() == Rule::bool_literal {
                                    config.active_low = p.as_str() == "true";
                                }
                            }
                        }
                        Rule::reset_assert_cycles => {
                            // Parse assert_cycles: N
                            for p in param.into_inner() {
                                if p.as_rule() == Rule::integer {
                                    let cycles: u64 = p.as_str().parse().unwrap_or(5);
                                    config.assert_cycles = Some(cycles);
                                }
                            }
                        }
                        Rule::reset_assert_time => {
                            // Parse assert_time: duration (e.g., 50ns)
                            for p in param.into_inner() {
                                if p.as_rule() == Rule::duration {
                                    if let Ok(duration) = self.parse_duration(p) {
                                        config.assert_time = Some(duration);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        if has_config {
            Ok(Some(config))
        } else {
            Ok(None)
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
        let mut clock_config = None;
        let mut reset_config = None;

        for part in parts {
            match part.as_rule() {
                Rule::type_expr => {
                    let (parsed_ty, clk_cfg, rst_cfg) = self.parse_type_with_config(part)?;
                    ty = parsed_ty;
                    clock_config = clk_cfg;
                    reset_config = rst_cfg;
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
            clock_config,
            reset_config,
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
            Rule::for_stmt => {
                let mut parts = inner.into_inner();
                let var = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected loop variable".to_string()))?
                    .as_str()
                    .to_string();
                let range_pair = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected range expression".to_string()))?;
                let range = self.parse_range_expr(range_pair)?;
                let mut body = Vec::new();
                for part in parts {
                    if part.as_rule() == Rule::statement {
                        body.push(self.parse_statement(part)?);
                    }
                }
                Ok(Statement::For { var, range, body })
            }
            Rule::while_stmt => {
                let mut parts = inner.into_inner();
                let condition = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected while condition".to_string())
                })?)?;
                let mut body = Vec::new();
                for part in parts {
                    if part.as_rule() == Rule::statement {
                        body.push(self.parse_statement(part)?);
                    }
                }
                Ok(Statement::While { condition, body })
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

    /// Parse seq_block
    fn parse_seq_block(&self, pair: pest::iterators::Pair<Rule>) -> Result<SeqBlock, ParseError> {
        let inner = pair.into_inner();
        let mut name = None;
        let mut statements = Vec::new();

        for part in inner {
            match part.as_rule() {
                Rule::identifier => {
                    name = Some(part.as_str().to_string());
                }
                Rule::seq_statement => {
                    statements.push(self.parse_seq_statement(part)?);
                }
                _ => {}
            }
        }

        Ok(SeqBlock { name, statements })
    }

    /// Parse initial_block
    fn parse_initial_block(&self, pair: pest::iterators::Pair<Rule>) -> Result<InitialBlock, ParseError> {
        let mut statements = Vec::new();

        for part in pair.into_inner() {
            if part.as_rule() == Rule::seq_statement {
                statements.push(self.parse_seq_statement(part)?);
            }
        }

        Ok(InitialBlock { statements })
    }

    /// Parse seq_statement
    fn parse_seq_statement(&self, pair: pest::iterators::Pair<Rule>) -> Result<SeqStatement, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected seq statement".to_string())
        })?;

        match inner.as_rule() {
            Rule::await_stmt => {
                let await_expr = self.parse_await_stmt(inner)?;
                Ok(SeqStatement::Await(await_expr))
            }
            Rule::delay_stmt => {
                let duration = self.parse_delay_stmt(inner)?;
                Ok(SeqStatement::Delay(duration))
            }
            Rule::assert_stmt => {
                let assert = self.parse_assert_stmt(inner)?;
                Ok(SeqStatement::Assert(assert))
            }
            Rule::signal_write => {
                let (path, value) = self.parse_signal_write(inner)?;
                Ok(SeqStatement::SignalWrite { path, value })
            }
            Rule::assign_stmt => {
                let mut parts = inner.into_inner();
                let target = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected assignment target".to_string()))?
                    .as_str()
                    .to_string();
                let value = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected assignment value".to_string())
                })?)?;
                Ok(SeqStatement::Assign { target, value })
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
                    if part.as_rule() == Rule::seq_statement {
                        let stmt = self.parse_seq_statement(part)?;
                        if in_else {
                            else_branch.get_or_insert_with(Vec::new).push(stmt);
                        } else {
                            then_branch.push(stmt);
                        }
                    } else if part.as_str() == "else" {
                        in_else = true;
                    }
                }

                Ok(SeqStatement::If {
                    condition,
                    then_branch,
                    else_branch,
                })
            }
            Rule::seq_for_stmt => {
                let mut parts = inner.into_inner();
                let var = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected loop variable".to_string()))?
                    .as_str()
                    .to_string();
                let range_pair = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected range expression".to_string()))?;
                let range = self.parse_range_expr(range_pair)?;
                let mut body = Vec::new();
                for part in parts {
                    if part.as_rule() == Rule::seq_statement {
                        body.push(self.parse_seq_statement(part)?);
                    }
                }
                Ok(SeqStatement::For { var, range, body })
            }
            Rule::seq_while_stmt => {
                let mut parts = inner.into_inner();
                let condition = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected while condition".to_string())
                })?)?;
                let mut body = Vec::new();
                for part in parts {
                    if part.as_rule() == Rule::seq_statement {
                        body.push(self.parse_seq_statement(part)?);
                    }
                }
                Ok(SeqStatement::While { condition, body })
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown seq statement type: {:?}",
                inner.as_rule()
            ))),
        }
    }

    /// Parse await statement
    fn parse_await_stmt(&self, pair: pest::iterators::Pair<Rule>) -> Result<AwaitExpr, ParseError> {
        let await_expr = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected await expression".to_string())
        })?;

        let inner = await_expr.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected await inner expression".to_string())
        })?;

        match inner.as_rule() {
            Rule::clock_cycles => {
                let mut parts = inner.into_inner();
                let signal = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected clock signal".to_string()))?
                    .as_str()
                    .to_string();
                let count = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected cycle count".to_string())
                })?)?;
                Ok(AwaitExpr::ClockCycles { signal, count })
            }
            Rule::clock_edge_expr => {
                let mut parts = inner.into_inner();
                let signal = parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected clock signal".to_string()))?
                    .as_str()
                    .to_string();
                let edge = match parts
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected clock edge".to_string()))?
                    .as_str()
                {
                    "posedge" => ClockEdge::Posedge,
                    "negedge" => ClockEdge::Negedge,
                    _ => return Err(ParseError::UnexpectedToken("Invalid clock edge".to_string())),
                };
                Ok(AwaitExpr::ClockEdge { signal, edge })
            }
            Rule::until_expr => {
                let mut parts = inner.into_inner();
                let condition = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected until condition".to_string())
                })?)?;
                let timeout = parts.next().map(|p| self.parse_duration(p)).transpose()?;
                Ok(AwaitExpr::Until { condition, timeout })
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown await expression type: {:?}",
                inner.as_rule()
            ))),
        }
    }

    /// Parse delay statement
    fn parse_delay_stmt(&self, pair: pest::iterators::Pair<Rule>) -> Result<Duration, ParseError> {
        let duration_pair = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected duration".to_string())
        })?;
        self.parse_duration(duration_pair)
    }

    /// Parse duration (e.g., 10ns, 100us)
    fn parse_duration(&self, pair: pest::iterators::Pair<Rule>) -> Result<Duration, ParseError> {
        let mut parts = pair.into_inner();
        let value: u64 = parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected duration value".to_string()))?
            .as_str()
            .parse()
            .map_err(|_| ParseError::InvalidLiteral("Invalid duration value".to_string()))?;

        let unit = if let Some(unit_pair) = parts.next() {
            match unit_pair.as_str() {
                "ps" => TimeUnit::Ps,
                "ns" => TimeUnit::Ns,
                "us" => TimeUnit::Us,
                "ms" => TimeUnit::Ms,
                "s" => TimeUnit::S,
                _ => TimeUnit::Ns,
            }
        } else {
            TimeUnit::Ns // Default to nanoseconds
        };

        Ok(Duration { value, unit })
    }

    /// Parse assert statement
    fn parse_assert_stmt(&self, pair: pest::iterators::Pair<Rule>) -> Result<AssertStmt, ParseError> {
        // Capture span information before consuming the pair
        let line_col = pair.as_span().start_pos().line_col();
        let end_line_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_line_col.0, end_line_col.1));

        let mut parts = pair.into_inner();
        let condition = self.parse_expr(parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected assert condition".to_string())
        })?)?;

        let message = parts.next().map(|p| {
            // Extract string content from string_literal
            let content = p.into_inner().next().map(|c| c.as_str().to_string());
            content.unwrap_or_default()
        });

        Ok(AssertStmt { condition, message, span })
    }

    /// Parse signal write (signal.set(expr))
    fn parse_signal_write(&self, pair: pest::iterators::Pair<Rule>) -> Result<(SignalPath, Expression), ParseError> {
        let mut parts = pair.into_inner();
        let path_pair = parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected signal path".to_string())
        })?;
        let path = self.parse_signal_path(path_pair)?;

        let value = self.parse_expr(parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected value expression".to_string())
        })?)?;

        Ok((path, value))
    }

    /// Parse signal path (e.g., dut.counter)
    fn parse_signal_path(&self, pair: pest::iterators::Pair<Rule>) -> Result<SignalPath, ParseError> {
        let segments: Vec<String> = pair.into_inner()
            .filter(|p| p.as_rule() == Rule::identifier)
            .map(|p| p.as_str().to_string())
            .collect();

        if segments.is_empty() {
            return Err(ParseError::UnexpectedToken("Empty signal path".to_string()));
        }

        Ok(SignalPath { segments })
    }

    /// Parse FSM block
    fn parse_fsm_block(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmBlock, ParseError> {
        let mut inner = pair.into_inner();

        // FSM name
        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected FSM name".to_string()))?
            .as_str()
            .to_string();

        // Clock spec
        let clock_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected clock spec".to_string()))?;
        let clock = self.parse_clock_spec(clock_pair)?;

        // Optional reset spec
        let mut reset = None;
        let mut states = Vec::new();
        let mut transitions = Vec::new();
        let mut outputs = Vec::new();

        for item in inner {
            match item.as_rule() {
                Rule::reset_spec => {
                    reset = Some(self.parse_reset_spec(item)?);
                }
                Rule::state_enum => {
                    states = self.parse_state_enum(item)?;
                }
                Rule::transitions_block => {
                    transitions = self.parse_transitions_block(item)?;
                }
                Rule::output_block => {
                    outputs.push(self.parse_output_block(item)?);
                }
                _ => {}
            }
        }

        Ok(FsmBlock {
            name,
            clock,
            reset,
            states,
            transitions,
            outputs,
        })
    }

    /// Parse state enumeration
    fn parse_state_enum(&self, pair: pest::iterators::Pair<Rule>) -> Result<Vec<FsmState>, ParseError> {
        let mut states = Vec::new();

        for item in pair.into_inner() {
            if item.as_rule() == Rule::state_item {
                states.push(self.parse_state_item(item)?);
            }
        }

        Ok(states)
    }

    /// Parse state item
    fn parse_state_item(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmState, ParseError> {
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected state name".to_string()))?
            .as_str()
            .to_string();

        let mut moore_outputs = Vec::new();

        // Parse Moore outputs if present
        for item in inner {
            if item.as_rule() == Rule::moore_outputs {
                for output in item.into_inner() {
                    if output.as_rule() == Rule::output_assign {
                        let mut assign_inner = output.into_inner();
                        let signal = assign_inner
                            .next()
                            .ok_or_else(|| ParseError::UnexpectedToken("Expected output name".to_string()))?
                            .as_str()
                            .to_string();
                        let value = self.parse_expr(assign_inner.next().ok_or_else(|| {
                            ParseError::UnexpectedToken("Expected output value".to_string())
                        })?)?;
                        moore_outputs.push((signal, value));
                    }
                }
            }
        }

        Ok(FsmState { name, moore_outputs })
    }

    /// Parse transitions block
    fn parse_transitions_block(&self, pair: pest::iterators::Pair<Rule>) -> Result<Vec<FsmTransition>, ParseError> {
        let mut transitions = Vec::new();

        for item in pair.into_inner() {
            if item.as_rule() == Rule::transition_item {
                transitions.push(self.parse_transition_item(item)?);
            }
        }

        Ok(transitions)
    }

    /// Parse transition item
    fn parse_transition_item(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmTransition, ParseError> {
        let mut inner = pair.into_inner();

        // Get from_state (identifier or "_")
        let from_state_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected state name".to_string()))?;
        let from_state = from_state_pair.as_str().to_string();

        let mut when_clauses = Vec::new();

        for item in inner {
            if item.as_rule() == Rule::when_clause {
                when_clauses.push(self.parse_when_clause(item)?);
            }
        }

        Ok(FsmTransition {
            from_state,
            when_clauses,
        })
    }

    /// Parse when clause
    fn parse_when_clause(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmWhenClause, ParseError> {
        let mut inner = pair.into_inner();

        // Condition expression
        let condition = self.parse_expr(inner.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected condition expression".to_string())
        })?)?;

        let mut actions = Vec::new();

        for item in inner {
            if item.as_rule() == Rule::transition_action {
                actions.push(self.parse_transition_action(item)?);
            }
        }

        Ok(FsmWhenClause { condition, actions })
    }

    /// Parse transition action
    fn parse_transition_action(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmAction, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected action".to_string())
        })?;

        match inner.as_rule() {
            Rule::goto_stmt => {
                let state = inner
                    .into_inner()
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected state name".to_string()))?
                    .as_str()
                    .to_string();
                Ok(FsmAction::Goto(state))
            }
            Rule::assign_stmt => {
                let mut assign_inner = inner.into_inner();
                let target = assign_inner
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected target".to_string()))?
                    .as_str()
                    .to_string();
                let value = self.parse_expr(assign_inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected value".to_string())
                })?)?;
                Ok(FsmAction::Assign { target, value })
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown action type: {:?}",
                inner.as_rule()
            ))),
        }
    }

    /// Parse output block (Mealy-style)
    fn parse_output_block(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmOutput, ParseError> {
        let mut inner = pair.into_inner();

        let signal = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected output signal name".to_string()))?
            .as_str()
            .to_string();

        let mut mappings = Vec::new();

        for item in inner {
            if item.as_rule() == Rule::output_case {
                let mut case_inner = item.into_inner();
                let state = case_inner
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected state name".to_string()))?
                    .as_str()
                    .to_string();
                let value = self.parse_expr(case_inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected output value".to_string())
                })?)?;
                mappings.push((state, value));
            }
        }

        Ok(FsmOutput { signal, mappings })
    }

    /// Parse memory declaration
    fn parse_mem_decl(&self, pair: pest::iterators::Pair<Rule>) -> Result<MemDecl, ParseError> {
        let mut inner = pair.into_inner();

        // Memory name
        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected memory name".to_string()))?
            .as_str()
            .to_string();

        // Memory type (element_type[depth])
        let mem_type_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected memory type".to_string()))?;
        let (element_type, depth) = self.parse_mem_type(mem_type_pair)?;

        // Optional config and initializer
        let mut config = MemConfig::default();
        let mut init = None;

        for item in inner {
            match item.as_rule() {
                Rule::mem_config => {
                    config = self.parse_mem_config(item)?;
                }
                Rule::mem_initializer => {
                    init = Some(self.parse_mem_initializer(item)?);
                }
                _ => {}
            }
        }

        Ok(MemDecl {
            name,
            element_type,
            depth,
            config,
            init,
        })
    }

    /// Parse memory type (e.g., bit[8][1024])
    fn parse_mem_type(&self, pair: pest::iterators::Pair<Rule>) -> Result<(Type, usize), ParseError> {
        let mut inner = pair.into_inner();

        // Base type
        let base_type_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected base type".to_string()))?;
        let element_type = self.parse_type(base_type_pair)?;

        // Depth
        let depth_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected memory depth".to_string()))?;
        let depth: usize = depth_pair
            .as_str()
            .parse()
            .map_err(|_| ParseError::InvalidLiteral(depth_pair.as_str().to_string()))?;

        Ok((element_type, depth))
    }

    /// Parse memory configuration
    fn parse_mem_config(&self, pair: pest::iterators::Pair<Rule>) -> Result<MemConfig, ParseError> {
        let mut config = MemConfig::default();

        for item in pair.into_inner() {
            if item.as_rule() == Rule::config_item {
                let mut config_inner = item.into_inner();
                let key = config_inner
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected config key".to_string()))?
                    .as_str();
                let value_pair = config_inner
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected config value".to_string()))?;

                // Extract the actual value from config_value wrapper
                let value = value_pair
                    .into_inner()
                    .next()
                    .map(|p| p.as_str())
                    .unwrap_or("");

                match key {
                    "ports" => {
                        let val: usize = value.parse().unwrap_or(1);
                        config.ports = Some(val);
                    }
                    "type" => {
                        config.mem_type = match value {
                            "ram" => Some(MemType::Ram),
                            "rom" => Some(MemType::Rom),
                            _ => None,
                        };
                    }
                    "read_mode" => {
                        config.read_mode = match value {
                            "sync" => Some(MemReadMode::Sync),
                            "async" => Some(MemReadMode::Async),
                            _ => None,
                        };
                    }
                    "write_mode" => {
                        config.write_mode = Some(MemWriteMode::Sync);
                    }
                    "init_file" => {
                        config.init_file = Some(value.to_string());
                    }
                    _ => {}
                }
            }
        }

        Ok(config)
    }

    /// Parse memory initializer
    fn parse_mem_initializer(&self, pair: pest::iterators::Pair<Rule>) -> Result<MemInit, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected initializer".to_string())
        })?;

        match inner.as_rule() {
            Rule::array_initializer => {
                let mut values = Vec::new();
                for expr_pair in inner.into_inner() {
                    values.push(self.parse_expr(expr_pair)?);
                }
                Ok(MemInit::Values(values))
            }
            Rule::string_literal => {
                let file_path = inner.into_inner()
                    .next()
                    .map(|s| s.as_str().to_string())
                    .unwrap_or_default();
                Ok(MemInit::File(file_path))
            }
            _ => Err(ParseError::UnexpectedToken(format!(
                "Unknown initializer type: {:?}",
                inner.as_rule()
            ))),
        }
    }

    /// Parse interface definition
    fn parse_interface(&self, pair: pest::iterators::Pair<Rule>) -> Result<Interface, ParseError> {
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected interface name".to_string()))?
            .as_str()
            .to_string();

        let mut generics = Vec::new();
        let mut signals = Vec::new();
        let mut views = Vec::new();

        for pair in inner {
            match pair.as_rule() {
                Rule::generics => {
                    generics = self.parse_generics(pair)?;
                }
                Rule::interface_body => {
                    for body_item in pair.into_inner() {
                        match body_item.as_rule() {
                            Rule::interface_signal => {
                                signals.push(self.parse_interface_signal(body_item)?);
                            }
                            Rule::view_def => {
                                views.push(self.parse_view_def(body_item)?);
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(Interface {
            name,
            generics,
            signals,
            views,
        })
    }

    /// Parse interface signal
    fn parse_interface_signal(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<InterfaceSignal, ParseError> {
        let mut inner = pair.into_inner();
        let mut is_logic = false;
        let mut name = String::new();
        let mut ty = Type::Bit;

        while let Some(item) = inner.next() {
            match item.as_rule() {
                Rule::identifier => {
                    // Could be "logic" keyword or signal name
                    let text = item.as_str();
                    if text == "logic" {
                        is_logic = true;
                    } else {
                        name = text.to_string();
                    }
                }
                Rule::type_expr => {
                    ty = self.parse_type(item)?;
                }
                _ => {}
            }
        }

        // If name is still empty, get it from a later identifier
        if name.is_empty() {
            return Err(ParseError::UnexpectedToken(
                "Expected signal name".to_string(),
            ));
        }

        Ok(InterfaceSignal { name, ty, is_logic })
    }

    /// Parse view definition
    fn parse_view_def(&self, pair: pest::iterators::Pair<Rule>) -> Result<ViewDef, ParseError> {
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected view name".to_string()))?
            .as_str()
            .to_string();

        let mut signals = Vec::new();

        for item in inner {
            if item.as_rule() == Rule::view_signal {
                signals.push(self.parse_view_signal(item)?);
            }
        }

        Ok(ViewDef { name, signals })
    }

    /// Parse view signal
    fn parse_view_signal(&self, pair: pest::iterators::Pair<Rule>) -> Result<ViewSignal, ParseError> {
        let mut inner = pair.into_inner();

        let direction_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected view direction".to_string()))?;

        let direction = match direction_pair.as_str() {
            "in" => ViewDirection::In,
            "out" => ViewDirection::Out,
            "inout" => ViewDirection::InOut,
            _ => {
                return Err(ParseError::UnexpectedToken(format!(
                    "Unknown view direction: {}",
                    direction_pair.as_str()
                )))
            }
        };

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected signal name".to_string()))?
            .as_str()
            .to_string();

        Ok(ViewSignal { name, direction })
    }

    /// Parse range expression (e.g., 0..10, 0..=9)
    fn parse_range_expr(&self, pair: pest::iterators::Pair<Rule>) -> Result<RangeExpr, ParseError> {
        let mut inner = pair.into_inner();

        let start = self.parse_expr(inner.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected range start".to_string())
        })?)?;

        let range_op = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected range operator".to_string()))?;
        let inclusive = range_op.as_str() == "..=";

        let end = self.parse_expr(inner.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected range end".to_string())
        })?)?;

        Ok(RangeExpr {
            start,
            end,
            inclusive,
        })
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}
