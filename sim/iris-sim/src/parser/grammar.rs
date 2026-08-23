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
    pub enums: Vec<EnumDecl>,
    pub structs: Vec<StructDecl>,
    pub functions: Vec<FnDecl>,
    /// The package this file declares, if any
    pub package: Option<String>,
    /// What this file imports: a package path, and the names taken from it.
    /// An empty name list means `::*`.
    pub imports: Vec<(String, Vec<String>)>,
    /// Names this file offers on to the packages that import it
    pub exports: Vec<String>,
    /// Type aliases: a name and the type it stands for. `type Byte = bit[8];`
    pub type_aliases: Vec<(String, Type)>,
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
                        Rule::module_decl | Rule::extern_mod_decl => {
                            result.modules.push(self.parse_module(inner_pair, false)?);
                        }
                        Rule::test_mod_decl => {
                            result.modules.push(self.parse_module(inner_pair, true)?);
                        }
                        Rule::interface_decl => {
                            result.interfaces.push(self.parse_interface(inner_pair)?);
                        }
                        Rule::enum_decl => {
                            result.enums.push(self.parse_enum(inner_pair)?);
                        }
                        Rule::struct_decl => {
                            result.structs.push(self.parse_struct(inner_pair, false)?);
                        }
                        Rule::union_decl => {
                            result.structs.push(self.parse_struct(inner_pair, true)?);
                        }
                        Rule::fn_decl => {
                            result.functions.push(self.parse_fn(inner_pair)?);
                        }
                        Rule::type_alias => {
                            result.type_aliases.push(self.parse_type_alias(inner_pair)?);
                        }
                        Rule::package_decl => {
                            result.package = inner_pair
                                .into_inner()
                                .next()
                                .map(|p| p.as_str().to_string());
                        }
                        Rule::import_decl => {
                            result.imports.push(Self::parse_import(inner_pair));
                        }
                        Rule::export_decl => {
                            if let Some(name) = inner_pair.into_inner().next() {
                                result.exports.push(name.as_str().to_string());
                            }
                        }
                        _ => {}
                    }
                }
            } else {
                match pair.as_rule() {
                    Rule::module_decl | Rule::extern_mod_decl => {
                        result.modules.push(self.parse_module(pair, false)?);
                    }
                    Rule::test_mod_decl => {
                        result.modules.push(self.parse_module(pair, true)?);
                    }
                    Rule::interface_decl => {
                        result.interfaces.push(self.parse_interface(pair)?);
                    }
                    Rule::enum_decl => {
                        result.enums.push(self.parse_enum(pair)?);
                    }
                    Rule::struct_decl => {
                        result.structs.push(self.parse_struct(pair, false)?);
                    }
                    Rule::union_decl => {
                        result.structs.push(self.parse_struct(pair, true)?);
                    }
                    Rule::fn_decl => {
                        result.functions.push(self.parse_fn(pair)?);
                    }
                    Rule::type_alias => {
                        result.type_aliases.push(self.parse_type_alias(pair)?);
                    }
                    _ => {}
                }
            }
        }

        Ok(result)
    }

    /// Parse a type alias: `type Byte = bit[8];`
    fn parse_type_alias(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<(String, Type), ParseError> {
        let mut inner = pair.into_inner();
        let name = Self::next_str(&mut inner, "type alias name")?;
        let type_pair = inner.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected a type in a type alias".to_string())
        })?;
        let ty = self.parse_type(type_pair)?;
        Ok((name, ty))
    }

    /// Parse an import: the package path and the names taken from it
    fn parse_import(pair: pest::iterators::Pair<Rule>) -> (String, Vec<String>) {
        let mut path = String::new();
        let mut names = Vec::new();
        for item in pair.into_inner() {
            match item.as_rule() {
                Rule::package_path => path = item.as_str().to_string(),
                Rule::import_list => {
                    for name in item.into_inner() {
                        names.push(name.as_str().to_string());
                    }
                }
                // `::*` takes everything, which an empty list stands for
                Rule::import_all => names.clear(),
                _ => {}
            }
        }
        (path, names)
    }

    /// Parse a user-defined function (spec 12.1)
    /// Parse a constraint block (spec 11.4.2)
    fn parse_constraint_block(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<ConstraintBlock, ParseError> {
        let line_col = pair.as_span().start_pos().line_col();
        let end_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));

        let mut inner = pair.into_inner();
        let name = Self::next_str(&mut inner, "constraint name")?;
        let mut conditions = Vec::new();
        for item in inner {
            conditions.push(self.parse_expr(item)?);
        }

        Ok(ConstraintBlock {
            name,
            conditions,
            span,
        })
    }

    fn parse_fn(&self, pair: pest::iterators::Pair<Rule>) -> Result<FnDecl, ParseError> {
        let is_public = pair.as_str().trim_start().starts_with("pub ");
        let line_col = pair.as_span().start_pos().line_col();
        let end_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));

        let mut inner = pair.into_inner();
        let name = Self::next_str(&mut inner, "function name")?;

        let mut params = Vec::new();
        let mut return_type = None;
        let mut body = None;
        let mut bindings = Vec::new();
        for item in inner {
            match item.as_rule() {
                Rule::fn_let => {
                    let mut parts = item.into_inner();
                    let name = Self::next_str(&mut parts, "binding name")?;
                    // The type, when written, is not needed for inlining
                    let value = parts
                        .next_back()
                        .ok_or_else(|| {
                            ParseError::UnexpectedToken("Expected a bound value".to_string())
                        })
                        .and_then(|e| self.parse_expr(e))?;
                    bindings.push((name, value));
                }
                Rule::fn_param => {
                    let mut parts = item.into_inner();
                    let param = Self::next_str(&mut parts, "parameter name")?;
                    let ty = self.parse_type(parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected parameter type".to_string())
                    })?)?;
                    params.push((param, ty));
                }
                Rule::type_expr => return_type = Some(self.parse_type(item)?),
                Rule::return_stmt => {
                    let expr = item.into_inner().next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected a returned value".to_string())
                    })?;
                    body = Some(self.parse_expr(expr)?);
                }
                _ => {}
            }
        }

        let body = body.ok_or_else(|| {
            ParseError::UnexpectedToken("A function body must be a single `return`".to_string())
        })?;

        Ok(FnDecl {
            name,
            is_public,
            params,
            return_type,
            bindings,
            body,
            span,
        })
    }

    /// Parse a structure or union declaration (spec 3.2.2, 3.2.3)
    fn parse_struct(
        &self,
        pair: pest::iterators::Pair<Rule>,
        is_union: bool,
    ) -> Result<StructDecl, ParseError> {
        let is_public = pair.as_str().trim_start().starts_with("pub ");
        let line_col = pair.as_span().start_pos().line_col();
        let end_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));

        let mut inner = pair.into_inner();
        let name = Self::next_str(&mut inner, "type name")?;

        let mut fields = Vec::new();
        for item in inner {
            if item.as_rule() != Rule::struct_field {
                continue;
            }
            let mut parts = item.into_inner();
            let field = Self::next_str(&mut parts, "field name")?;
            let ty = self.parse_type(parts.next().ok_or_else(|| {
                ParseError::UnexpectedToken("Expected field type".to_string())
            })?)?;
            fields.push((field, ty));
        }

        Ok(StructDecl {
            name,
            is_public,
            fields,
            is_union,
            span,
        })
    }

    /// Parse an enumeration declaration (spec 3.2.1)
    fn parse_enum(&self, pair: pest::iterators::Pair<Rule>) -> Result<EnumDecl, ParseError> {
        let is_public = pair.as_str().trim_start().starts_with("pub ");
        let line_col = pair.as_span().start_pos().line_col();
        let end_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));

        let mut inner = pair.into_inner();
        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected enum name".to_string()))?
            .as_str()
            .to_string();

        let mut underlying = None;
        let mut variants = Vec::new();
        for item in inner {
            match item.as_rule() {
                Rule::type_expr => underlying = Some(self.parse_type(item)?),
                Rule::enum_variant => {
                    let mut parts = item.into_inner();
                    let variant = parts
                        .next()
                        .ok_or_else(|| {
                            ParseError::UnexpectedToken("Expected variant name".to_string())
                        })?
                        .as_str()
                        .to_string();
                    let mut payload = None;
                    let mut value = None;
                    for rest in parts {
                        match rest.as_rule() {
                            Rule::type_expr => payload = Some(self.parse_type(rest)?),
                            _ => value = Some(self.parse_expr(rest)?),
                        }
                    }
                    variants.push(EnumVariant {
                        name: variant,
                        value,
                        payload,
                    });
                }
                _ => {}
            }
        }

        Ok(EnumDecl {
            name,
            is_public,
            underlying,
            variants,
            span,
        })
    }

    fn parse_module(&self, pair: pest::iterators::Pair<Rule>, is_test: bool) -> Result<Module, ParseError> {
        let text = pair.as_str().trim_start();
        let is_public = text.starts_with("pub ");
        let is_extern = text.starts_with("extern ") || text.starts_with("pub extern ");
        let line_col = pair.as_span().start_pos().line_col();
        let end_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected module name".to_string()))?
            .as_str()
            .to_string();

        let mut generics = Vec::new();
        let mut where_constraints = Vec::new();
        let mut ports = Vec::new();
        let mut signals = Vec::new();
        let mut logic_blocks = Vec::new();
        let mut instances = Vec::new();
        let mut seq_blocks = Vec::new();
        let mut initial_blocks = Vec::new();
        let mut fsm_blocks = Vec::new();
        let mut memories = Vec::new();
        let mut constraints = Vec::new();

        for pair in inner {
            match pair.as_rule() {
                Rule::generics => {
                    generics = self.parse_generics(pair)?;
                }
                Rule::where_clause => {
                    where_constraints = self.parse_where_clause(pair)?;
                }
                Rule::port_list => {
                    ports = self.parse_port_list(pair)?;
                }
                Rule::module_body | Rule::test_body => {
                    // Both module_body and test_body have the same structure
                    self.parse_body_items(pair, &mut constraints, &mut signals, &mut logic_blocks, &mut instances, &mut seq_blocks, &mut initial_blocks, &mut fsm_blocks, &mut memories)?;
                }
                _ => {}
            }
        }

        Ok(Module {
            name,
            is_public,
            is_extern,
            constraints,
            generics,
            where_constraints,
            ports,
            signals,
            logic_blocks,
            instances,
            span,
            is_test,
            seq_blocks,
            initial_blocks,
            fsm_blocks,
            memories,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn parse_body_items(
        &self,
        pair: pest::iterators::Pair<Rule>,
        constraints: &mut Vec<ConstraintBlock>,
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
                Rule::constraint_block => {
                    constraints.push(self.parse_constraint_block(item)?);
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Parse a `where` clause constraining generic parameters
    fn parse_where_clause(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Vec<Constraint>, ParseError> {
        let mut constraints = Vec::new();
        for item in pair.into_inner() {
            if item.as_rule() != Rule::constraint {
                continue;
            }
            let line_col = item.as_span().start_pos().line_col();
            let end_col = item.as_span().end_pos().line_col();
            let span = Some(Span::new(line_col.0, line_col.1, end_col.0, end_col.1));

            let form = item.into_inner().next().ok_or_else(|| {
                ParseError::UnexpectedToken("Expected a constraint".to_string())
            })?;
            let rule = form.as_rule();
            let mut parts = form.into_inner();

            let constraint = match rule {
                Rule::constraint_cmp => {
                    let param = Self::next_str(&mut parts, "constrained parameter")?;
                    let op = match Self::next_str(&mut parts, "constraint operator")?.trim() {
                        "<=" => BinOp::Le,
                        ">=" => BinOp::Ge,
                        "==" => BinOp::Eq,
                        "!=" => BinOp::Ne,
                        "<" => BinOp::Lt,
                        _ => BinOp::Gt,
                    };
                    let bound = self.parse_expr(parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected constraint bound".to_string())
                    })?)?;
                    Constraint::Compare {
                        param,
                        op,
                        bound,
                        span,
                    }
                }
                Rule::constraint_type => {
                    let param = Self::next_str(&mut parts, "constrained parameter")?;
                    let ty = self.parse_type(parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected constraint type".to_string())
                    })?)?;
                    Constraint::TypeBound { param, ty, span }
                }
                _ => {
                    let subject = Expression::Ident(Self::next_str(&mut parts, "constraint subject")?);
                    let method = Self::next_str(&mut parts, "constraint predicate")?;
                    let mut args = Vec::new();
                    for arg in parts {
                        args.push(self.parse_expr(arg)?);
                    }
                    Constraint::Predicate {
                        subject,
                        method,
                        args,
                        span,
                    }
                }
            };
            constraints.push(constraint);
        }
        Ok(constraints)
    }

    /// The text of the next token, or a parse error naming what was expected
    fn next_str(
        parts: &mut pest::iterators::Pairs<Rule>,
        expected: &str,
    ) -> Result<String, ParseError> {
        Ok(parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken(format!("Expected {}", expected)))?
            .as_str()
            .to_string())
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
            "initiator" => PortDirection::Initiator,
            "target" => PortDirection::Target,
            "monitor" => PortDirection::Monitor,
            other => {
                return Err(ParseError::UnexpectedToken(format!(
                    "Invalid port direction '{}'",
                    other
                )))
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

    /// Wrap a base type in the array dimensions written after it
    fn apply_array_suffixes(ty: Type, sizes: &[usize]) -> Type {
        sizes.iter().rev().fold(ty, |element, size| Type::Array {
            element: Box::new(element),
            size: *size,
        })
    }

    /// Parse type with optional clock/reset configuration
    fn parse_type_with_config(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<(Type, Option<ClockConfig>, Option<ResetConfig>), ParseError> {
        // Callers pass either a `type_expr` or, as in `mem_type`, a bare `base_type`
        let (inner, array_sizes) = if pair.as_rule() == Rule::base_type {
            (Some(pair), Vec::new())
        } else {
            let mut parts = pair.into_inner();
            let base = parts.next();
            // `bit[8][4]` is an array of four bit[8] elements
            let sizes: Vec<usize> = parts
                .filter(|p| p.as_rule() == Rule::array_suffix)
                .filter_map(|p| p.as_str().trim_matches(|c| c == '[' || c == ']').parse().ok())
                .collect();
            (base, sizes)
        };
        if inner.is_none() {
            return Ok((Type::Bit, None, None));
        }
        let inner = inner.unwrap();

        let resolved = match inner.as_rule() {
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
                                match we.as_str().trim().parse::<usize>() {
                                    Ok(width) => Ok((Type::BitVec { width }, None, None)),
                                    // Anything else is a constant expression that may
                                    // mention generics; it is resolved at elaboration
                                    Err(_) => Ok((
                                        Type::BitVecExpr {
                                            expr: Box::new(self.parse_expr(we)?),
                                        },
                                        None,
                                        None,
                                    )),
                                }
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
                    Rule::int_type => {
                        Ok((Self::sized_int(base, true)?, None, None))
                    }
                    Rule::uint_type => {
                        Ok((Self::sized_int(base, false)?, None, None))
                    }
                    Rule::float_type => {
                        let bits = if base.as_str() == "f64" { 64 } else { 32 };
                        Ok((Type::Float { bits }, None, None))
                    }
                    Rule::bool_type => Ok((Type::Bool, None, None)),
                    Rule::string_type => {
                        Ok((Type::Named("string".to_string()), None, None))
                    }
                    Rule::identifier => {
                        // `u8` and `i16` are aliases for `uint[8]` and `int[16]`
                        let text = base.as_str();
                        match Self::builtin_alias(text) {
                            Some(ty) => Ok((ty, None, None)),
                            None => Ok((Type::Named(text.to_string()), None, None)),
                        }
                    }
                    _ => Ok((Type::Bit, None, None)),
                }
            }
            _ => Ok((Type::Bit, None, None)),
        };

        let (ty, clock_config, reset_config) = resolved?;
        Ok((
            Self::apply_array_suffixes(ty, &array_sizes),
            clock_config,
            reset_config,
        ))
    }

    /// `int[N]` / `uint[N]`, defaulting to 32 bits when no width is written
    fn sized_int(
        pair: pest::iterators::Pair<Rule>,
        signed: bool,
    ) -> Result<Type, ParseError> {
        let width = pair
            .into_inner()
            .next()
            .and_then(|w| w.into_inner().next())
            .map(|we| we.as_str().trim().parse::<usize>())
            .transpose()
            .map_err(|_| ParseError::InvalidLiteral("Invalid integer width".to_string()))?
            .unwrap_or(32);
        Ok(Type::Int { width, signed })
    }

    /// Recognise the `iN` / `uN` built-in type names (spec 3.1.2)
    fn builtin_alias(text: &str) -> Option<Type> {
        let (signed, digits) = match text.split_at(1) {
            ("i", rest) => (true, rest),
            ("u", rest) => (false, rest),
            _ => return None,
        };
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        digits.parse::<usize>().ok().map(|width| Type::Int { width, signed })
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
                for param_wrapper in inner.into_inner() {
                    // `reset_param` wraps the concrete parameter rule
                    let param = match param_wrapper.as_rule() {
                        Rule::reset_param => match param_wrapper.into_inner().next() {
                            Some(p) => p,
                            None => continue,
                        },
                        _ => param_wrapper,
                    };
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

        let is_rand = inner.as_rule() == Rule::rand_decl;
        let (is_var, is_mutable) = match inner.as_rule() {
            // A random variable is a register the testbench redraws
            Rule::rand_decl => (true, true),
            Rule::var_decl => (true, true),
            Rule::let_decl => {
                let has_mut = inner.as_str().contains("mut");
                (false, has_mut)
            }
            // A constant is an immutable named value, which is exactly what a
            // `let` is once elaboration has folded it.
            Rule::const_decl => (false, false),
            _ => (false, false),
        };

        let mut parts = inner.into_inner();
        let name = parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected signal name".to_string()))?
            .as_str()
            .to_string();

        let mut ty = Type::Bit;
        let mut has_explicit_type = false;
        let mut init_value = None;
        let mut clock_config = None;
        let mut reset_config = None;

        for part in parts {
            match part.as_rule() {
                Rule::type_expr => {
                    let (parsed_ty, clk_cfg, rst_cfg) = self.parse_type_with_config(part)?;
                    ty = parsed_ty;
                    has_explicit_type = true;
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
            is_rand,
            name,
            has_explicit_type,
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
            Rule::mem_write_stmt => {
                let mut parts = inner.into_inner();
                let mem_name = parts
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected memory name".to_string())
                    })?
                    .as_str()
                    .to_string();
                let addr = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected memory address".to_string())
                })?)?;
                // Skip the "]" token
                let value = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected memory write value".to_string())
                })?)?;
                Ok(Statement::MemWrite {
                    mem_name,
                    addr,
                    value,
                })
            }
            Rule::if_stmt => self.parse_if_stmt(inner),
            Rule::let_local => {
                let mut parts = inner.into_inner();
                let name = parts
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected local name".to_string())
                    })?
                    .as_str()
                    .to_string();
                let mut ty = None;
                let mut value = None;
                for part in parts {
                    match part.as_rule() {
                        Rule::type_expr => ty = Some(self.parse_type(part)?),
                        Rule::expr => value = Some(self.parse_expr(part)?),
                        _ => {}
                    }
                }
                Ok(Statement::LetLocal { name, ty, value })
            }
            Rule::assert_stmt => Ok(Statement::Assert(self.parse_assert_stmt(inner)?)),
            Rule::cover_stmt => Ok(Statement::Cover(self.parse_cover_stmt(inner)?)),
            Rule::break_stmt => Ok(Statement::Break),
            Rule::continue_stmt => Ok(Statement::Continue),
            Rule::sys_stmt => {
                let call = inner.into_inner().next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected system call".to_string())
                })?;
                Ok(Statement::SysCall(self.parse_primary_expr(call)?))
            }
            Rule::slice_assign_stmt => self.parse_slice_assign(inner),
            Rule::match_stmt => {
                let mut parts = inner.into_inner();
                let expr = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected match scrutinee".to_string())
                })?)?;
                let mut arms = Vec::new();
                for arm in parts {
                    if arm.as_rule() != Rule::match_arm {
                        continue;
                    }
                    let mut arm_parts = arm.into_inner();
                    let pattern = self.parse_pattern(arm_parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected match pattern".to_string())
                    })?)?;
                    let mut body = Vec::new();
                    for part in arm_parts {
                        match part.as_rule() {
                            Rule::statement => body.push(self.parse_statement(part)?),
                            // `pattern => expr,` is shorthand for assigning nothing;
                            // it is only meaningful in a match expression, so it is
                            // preserved here as an expression statement with no target
                            Rule::expr => {
                                let _ = self.parse_expr(part)?;
                            }
                            _ => {}
                        }
                    }
                    arms.push(MatchArm { pattern, body });
                }
                Ok(Statement::Match { expr, arms })
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
        let first_operand = self.parse_unary_expr(first)?;

        // The grammar is a flat list of operands and operators, so the grouping
        // is decided here. It used to fold left to right whatever the
        // operators were, which made `a + b * c` mean `(a + b) * c`. Spec 9.8
        // gives a precedence table, and its own example says `a + (b * c)`.
        let mut operands = vec![first_operand];
        let mut operators: Vec<BinOp> = Vec::new();

        while let Some(op_pair) = inner.next() {
            if op_pair.as_rule() == Rule::bin_op {
                let op = self.parse_bin_op(op_pair)?;
                let rhs_pair = inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected right operand".to_string())
                })?;
                operands.push(self.parse_unary_expr(rhs_pair)?);
                operators.push(op);
            }
        }

        Ok(Self::fold_by_precedence(operands, operators))
    }

    /// Combine a flat operand/operator list according to spec 9.8.
    ///
    /// Every binary operator in IRIS is left-associative, so equal strengths
    /// group leftwards.
    fn fold_by_precedence(
        mut operands: Vec<Expression>,
        mut operators: Vec<BinOp>,
    ) -> Expression {
        while !operators.is_empty() {
            // The tightest operator binds first; the leftmost of that strength
            // wins, which is what left associativity means.
            let mut at = 0;
            for (i, op) in operators.iter().enumerate() {
                if op.precedence() < operators[at].precedence() {
                    at = i;
                }
            }

            let op = operators.remove(at);
            let rhs = operands.remove(at + 1);
            let lhs = operands.remove(at);
            operands.insert(
                at,
                Expression::BinOp {
                    op,
                    lhs: Box::new(lhs),
                    rhs: Box::new(rhs),
                },
            );
        }

        operands.pop().expect("an expression has at least one operand")
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
            Rule::call_expr => {
                let mut parts = pair.into_inner();
                let name = Self::next_str(&mut parts, "function name")?;
                let mut args = Vec::new();
                for arg in parts {
                    args.push(self.parse_expr(arg)?);
                }
                Ok(Expression::Call { name, args })
            }
            Rule::enum_path => Ok(Expression::Ident(pair.as_str().to_string())),
            Rule::enum_call => {
                let mut parts = pair.into_inner();
                let path = Self::next_str(&mut parts, "variant name")?;
                let payload = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected variant payload".to_string())
                })?)?;
                // Elaboration turns this into the tagged value
                Ok(Expression::MethodCall {
                    receiver: Box::new(Expression::Ident(path)),
                    method: "construct".to_string(),
                    args: vec![payload],
                })
            }
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
            Rule::replication => {
                let mut inner = pair.into_inner();
                let count = self.parse_expr(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected replication count".to_string())
                })?)?;
                let value: Result<Vec<_>, _> = inner.map(|p| self.parse_expr(p)).collect();
                Ok(Expression::Replicate {
                    count: Box::new(count),
                    value: value?,
                })
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
            Rule::sys_func => {
                let mut inner = pair.into_inner();
                let name = inner
                    .next()
                    .ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected system function name".to_string())
                    })?
                    .as_str()
                    .to_string();
                let mut args = Vec::new();
                for arg_pair in inner {
                    if arg_pair.as_rule() != Rule::sys_func_arg {
                        continue;
                    }
                    let Some(inner_arg) = arg_pair.into_inner().next() else {
                        continue;
                    };
                    args.push(match inner_arg.as_rule() {
                        Rule::string_literal => SysFuncArg::Str(Self::string_contents(inner_arg)),
                        Rule::type_expr => SysFuncArg::Type(self.parse_type(inner_arg)?),
                        _ => SysFuncArg::Expr(self.parse_expr(inner_arg)?),
                    });
                }
                Ok(Expression::SysFunc { name, args })
            }
            Rule::match_expr => {
                let mut inner = pair.into_inner();
                let scrutinee = self.parse_expr(inner.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected match scrutinee".to_string())
                })?)?;
                let mut arms = Vec::new();
                for arm in inner {
                    if arm.as_rule() != Rule::match_expr_arm {
                        continue;
                    }
                    let mut parts = arm.into_inner();
                    let pattern = self.parse_pattern(parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected match pattern".to_string())
                    })?)?;
                    let value = self.parse_expr(parts.next().ok_or_else(|| {
                        ParseError::UnexpectedToken("Expected match arm value".to_string())
                    })?)?;
                    arms.push(MatchExprArm { pattern, value });
                }
                Ok(Expression::Match {
                    scrutinee: Box::new(scrutinee),
                    arms,
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
                let high = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected slice high bound".to_string())
                })?)?;
                let low = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected slice low bound".to_string())
                })?)?;
                Ok(Expression::Slice {
                    base: Box::new(base),
                    high: Box::new(high),
                    low: Box::new(low),
                })
            }
            Rule::part_select => {
                let mut parts = inner.into_inner();
                let index = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected part select index".to_string())
                })?)?;
                let op = parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected +: or -:".to_string())
                })?;
                let upward = op.as_str().trim().starts_with('+');
                let width = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected part select width".to_string())
                })?)?;
                Ok(Expression::PartSelect {
                    base: Box::new(base),
                    index: Box::new(index),
                    width: Box::new(width),
                    upward,
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
            Rule::real_literal => Ok(Literal::Real {
                text: inner.as_str().to_string(),
            }),
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
            ">>>" => Ok(BinOp::AShr),
            "<<<" => Ok(BinOp::Shl),
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

    /// Lift a logic-block statement into its sequential-block equivalent.
    ///
    /// The `if_stmt` rule is shared between logic blocks and sequential blocks,
    /// so its nested statements always parse as `statement`.
    /// `match` has no sequential counterpart and is dropped.
    fn statement_to_seq(stmt: Statement) -> Option<SeqStatement> {
        match stmt {
            Statement::Cover(cover) => Some(SeqStatement::Cover(cover)),
            Statement::Break => Some(SeqStatement::Break),
            Statement::Continue => Some(SeqStatement::Continue),
            Statement::Assign { target, value } => Some(SeqStatement::Assign { target, value }),
            Statement::MemWrite {
                mem_name,
                addr,
                value,
            } => Some(SeqStatement::MemWrite {
                mem_name,
                addr,
                value,
            }),
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => Some(SeqStatement::If {
                condition,
                then_branch: then_branch.into_iter().filter_map(Self::statement_to_seq).collect(),
                else_branch: else_branch
                    .map(|b| b.into_iter().filter_map(Self::statement_to_seq).collect()),
            }),
            Statement::For { var, range, body } => Some(SeqStatement::For {
                var,
                range,
                body: body.into_iter().filter_map(Self::statement_to_seq).collect(),
            }),
            Statement::While { condition, body } => Some(SeqStatement::While {
                condition,
                body: body.into_iter().filter_map(Self::statement_to_seq).collect(),
            }),
            Statement::Assert(a) => Some(SeqStatement::Assert(a)),
            Statement::SysCall(e) => Some(SeqStatement::SysCall(e)),
            // A sequential block has no bit-field write of its own
            Statement::SliceWrite { .. } => None,
            Statement::LetLocal { name, value, .. } => value
                .map(|value| SeqStatement::Assign { target: name, value }),
            Statement::Match { .. } => None,
        }
    }

    /// Parse seq_statement
    fn parse_seq_statement(&self, pair: pest::iterators::Pair<Rule>) -> Result<SeqStatement, ParseError> {
        let inner = pair.into_inner().next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected seq statement".to_string())
        })?;
        self.parse_seq_statement_inner(inner)
    }

    /// Parse a sequential statement from its own rule, without the wrapper
    fn parse_seq_statement_inner(
        &self,
        inner: pest::iterators::Pair<Rule>,
    ) -> Result<SeqStatement, ParseError> {

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
            Rule::cover_stmt => Ok(SeqStatement::Cover(self.parse_cover_stmt(inner)?)),
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
            Rule::if_stmt | Rule::seq_if_stmt => {
                let mut parts = inner.into_inner();
                let condition = self.parse_expr(parts.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected if condition".to_string())
                })?)?;

                let mut then_branch = Vec::new();
                let mut else_branch = None;

                for part in parts {
                    match part.as_rule() {
                        Rule::seq_statement => then_branch.push(self.parse_seq_statement(part)?),
                        // The shared `if_stmt` rule nests `statement`, not `seq_statement`
                        Rule::statement => {
                            then_branch.extend(Self::statement_to_seq(self.parse_statement(part)?));
                        }
                        Rule::else_clause | Rule::seq_else_clause => {
                            let mut stmts = Vec::new();
                            for s in part.into_inner() {
                                match s.as_rule() {
                                    Rule::seq_statement => stmts.push(self.parse_seq_statement(s)?),
                                    Rule::seq_if_stmt => {
                                        stmts.push(self.parse_seq_statement_inner(s)?)
                                    }
                                    Rule::statement => {
                                        stmts.extend(Self::statement_to_seq(self.parse_statement(s)?))
                                    }
                                    Rule::if_stmt => {
                                        stmts.extend(Self::statement_to_seq(self.parse_if_stmt(s)?))
                                    }
                                    _ => {}
                                }
                            }
                            else_branch = Some(stmts);
                        }
                        _ => {}
                    }
                }

                Ok(SeqStatement::If {
                    condition,
                    then_branch,
                    else_branch,
                })
            }
            Rule::sys_stmt => {
                let call = inner.into_inner().next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected system call".to_string())
                })?;
                Ok(SeqStatement::SysCall(self.parse_primary_expr(call)?))
            }
            Rule::break_stmt => Ok(SeqStatement::Break),
            Rule::continue_stmt => Ok(SeqStatement::Continue),
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
    /// Parse an assignment to a bit field, reducing both spellings to a start
    /// bit and a width
    fn parse_slice_assign(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Statement, ParseError> {
        let one = || {
            Expression::Literal(Literal::Decimal {
                width: None,
                value: 1,
            })
        };
        let sub = |lhs: Expression, rhs: Expression| Expression::BinOp {
            op: BinOp::Sub,
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
        };

        let mut parts = pair.into_inner();
        let target = parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected assignment target".to_string()))?
            .as_str()
            .to_string();
        let range = parts
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected bit range".to_string()))?;

        let (low, width) = match range.as_rule() {
            Rule::slice => {
                let mut b = range.into_inner();
                let high = self.parse_expr(b.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected slice high bound".to_string())
                })?)?;
                let low = self.parse_expr(b.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected slice low bound".to_string())
                })?)?;
                let width = Expression::BinOp {
                    op: BinOp::Add,
                    lhs: Box::new(sub(high, low.clone())),
                    rhs: Box::new(one()),
                };
                (low, width)
            }
            _ => {
                let mut b = range.into_inner();
                let index = self.parse_expr(b.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected part select index".to_string())
                })?)?;
                let op = b
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected +: or -:".to_string()))?;
                let upward = op.as_str().trim().starts_with('+');
                let width = self.parse_expr(b.next().ok_or_else(|| {
                    ParseError::UnexpectedToken("Expected part select width".to_string())
                })?)?;
                // `index -: width` runs downward from index
                let low = if upward {
                    index
                } else {
                    sub(index, sub(width.clone(), one()))
                };
                (low, width)
            }
        };

        let value = self.parse_expr(
            parts
                .next()
                .ok_or_else(|| ParseError::UnexpectedToken("Expected assigned value".to_string()))?,
        )?;

        Ok(Statement::SliceWrite {
            target,
            low,
            width,
            value,
        })
    }

    /// Parse an `if` statement, including an `else if` chain.
    ///
    /// The else clause holds either a statement list or another `if_stmt`,
    /// which is how `else if` is written (tools/iris.ebnf).
    fn parse_if_stmt(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<Statement, ParseError> {
        let mut parts = pair.into_inner();
        let condition = self.parse_expr(parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected if condition".to_string())
        })?)?;

        let mut then_branch = Vec::new();
        let mut else_branch = None;

        for part in parts {
            match part.as_rule() {
                Rule::statement => then_branch.push(self.parse_statement(part)?),
                Rule::else_clause => {
                    let mut stmts = Vec::new();
                    for s in part.into_inner() {
                        match s.as_rule() {
                            Rule::statement => stmts.push(self.parse_statement(s)?),
                            // `else if` nests another if statement
                            Rule::if_stmt => stmts.push(self.parse_if_stmt(s)?),
                            _ => {}
                        }
                    }
                    else_branch = Some(stmts);
                }
                _ => {}
            }
        }

        Ok(Statement::If {
            condition,
            then_branch,
            else_branch,
        })
    }

    /// Parse a match pattern.
    ///
    /// Wildcards, literals and identifiers are the forms the simulator can
    /// evaluate; richer patterns are kept as their source text.
    fn parse_pattern(&self, pair: pest::iterators::Pair<Rule>) -> Result<Pattern, ParseError> {
        let text = pair.as_str().trim().to_string();
        let inner = if pair.as_rule() == Rule::pattern {
            pair.into_inner().next()
        } else {
            Some(pair)
        };

        match inner {
            // `_` has no inner token
            None => Ok(Pattern::Wildcard),
            Some(p) => match p.as_rule() {
                Rule::literal => Ok(Pattern::Literal(self.parse_literal(p)?)),
                Rule::identifier => Ok(Pattern::Ident(p.as_str().to_string())),
                Rule::path_pattern => {
                    let mut parts = p.into_inner();
                    let base = Self::next_str(&mut parts, "enum name")?;
                    let variant = Self::next_str(&mut parts, "variant name")?;
                    let binding = parts.next().map(|b| b.as_str().to_string());
                    Ok(Pattern::Path {
                        path: format!("{}::{}", base, variant),
                        binding,
                    })
                }
                _ if text == "_" => Ok(Pattern::Wildcard),
                _ => Ok(Pattern::Ident(text)),
            },
        }
    }

    /// Parse a coverage point
    fn parse_cover_stmt(&self, pair: pest::iterators::Pair<Rule>) -> Result<CoverStmt, ParseError> {
        let line_col = pair.as_span().start_pos().line_col();
        let end_line_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_line_col.0, end_line_col.1));

        let mut parts = pair.into_inner();
        let condition = self.parse_expr(parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected cover condition".to_string())
        })?)?;
        let name = parts.next().map(Self::string_contents);

        Ok(CoverStmt {
            condition,
            name,
            span,
        })
    }

    fn parse_assert_stmt(&self, pair: pest::iterators::Pair<Rule>) -> Result<AssertStmt, ParseError> {
        // Capture span information before consuming the pair
        let line_col = pair.as_span().start_pos().line_col();
        let end_line_col = pair.as_span().end_pos().line_col();
        let span = Some(Span::new(line_col.0, line_col.1, end_line_col.0, end_line_col.1));

        // The keyword decides how a violation is reported
        let kind = match pair.as_str().trim_start().split_whitespace().next() {
            Some("expect") => AssertKind::Expect,
            Some("assume") => AssertKind::Assume,
            _ => AssertKind::Assert,
        };

        let mut parts = pair.into_inner();
        let condition = self.parse_expr(parts.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected assert condition".to_string())
        })?)?;

        // Either `, "message"` or `else severity("message")`
        let mut message = None;
        // `expect` and `assume` are soft: they report and carry on
        let mut severity = match kind {
            AssertKind::Assert => AssertSeverity::Error,
            _ => AssertSeverity::Warning,
        };
        for part in parts {
            match part.as_rule() {
                Rule::string_literal => message = Some(Self::string_contents(part)),
                Rule::assert_action => {
                    for item in part.into_inner() {
                        match item.as_rule() {
                            Rule::assert_severity => {
                                severity = match item.as_str().trim() {
                                    "warning" => AssertSeverity::Warning,
                                    "fatal" => AssertSeverity::Fatal,
                                    _ => AssertSeverity::Error,
                                }
                            }
                            Rule::string_literal => message = Some(Self::string_contents(item)),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(AssertStmt {
            condition,
            message,
            severity,
            kind,
            span,
        })
    }

    /// Text inside a string literal, without the surrounding quotes
    fn string_contents(pair: pest::iterators::Pair<Rule>) -> String {
        pair.into_inner()
            .next()
            .map(|c| c.as_str().to_string())
            .unwrap_or_default()
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
        let mut initial_state = None;
        let mut locals = Vec::new();
        let mut transitions = Vec::new();
        let mut outputs = Vec::new();
        let mut encoding = FsmEncoding::Binary;

        for item in inner {
            match item.as_rule() {
                Rule::reset_spec => {
                    reset = Some(self.parse_reset_spec(item)?);
                }
                Rule::state_enum => {
                    states = self.parse_state_enum(item)?;
                }
                Rule::initial_state => {
                    initial_state = item
                        .into_inner()
                        .next()
                        .map(|p| p.as_str().to_string());
                }
                Rule::signal_decl => {
                    locals.push(self.parse_signal_decl(item)?);
                }
                Rule::transitions_block => {
                    transitions = self.parse_transitions_block(item)?;
                }
                Rule::output_block => {
                    outputs.push(self.parse_output_block(item)?);
                }
                Rule::output_encoding => {
                    encoding = match item.as_str().split(':').nth(1).map(str::trim) {
                        Some("onehot") => FsmEncoding::OneHot,
                        Some("gray") => FsmEncoding::Gray,
                        _ => FsmEncoding::Binary,
                    };
                }
                _ => {}
            }
        }

        Ok(FsmBlock {
            name,
            clock,
            reset,
            states,
            initial_state,
            locals,
            transitions,
            outputs,
            encoding,
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

    /// Parse an `if` inside a `when` clause, whose branches hold further actions
    fn parse_fsm_if(&self, pair: pest::iterators::Pair<Rule>) -> Result<FsmAction, ParseError> {
        let mut inner = pair.into_inner();
        let condition = self.parse_expr(inner.next().ok_or_else(|| {
            ParseError::UnexpectedToken("Expected condition".to_string())
        })?)?;

        let mut then_branch = Vec::new();
        let mut else_branch = None;
        for item in inner {
            match item.as_rule() {
                Rule::transition_action => then_branch.push(self.parse_transition_action(item)?),
                Rule::fsm_else_clause => {
                    let mut actions = Vec::new();
                    for part in item.into_inner() {
                        match part.as_rule() {
                            // `else if` chains
                            Rule::fsm_if_stmt => actions.push(self.parse_fsm_if(part)?),
                            Rule::transition_action => {
                                actions.push(self.parse_transition_action(part)?)
                            }
                            _ => {}
                        }
                    }
                    else_branch = Some(actions);
                }
                _ => {}
            }
        }

        Ok(FsmAction::If {
            condition,
            then_branch,
            else_branch,
        })
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
            Rule::fsm_if_stmt => self.parse_fsm_if(inner),
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
        let (element_type, depth, depth_expr) = self.parse_mem_type(mem_type_pair)?;

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
            depth_expr,
            config,
            init,
        })
    }

    /// Parse memory type (e.g., bit[8][1024])
    fn parse_mem_type(
        &self,
        pair: pest::iterators::Pair<Rule>,
    ) -> Result<(Type, usize, Option<Expression>), ParseError> {
        let mut inner = pair.into_inner();

        // Base type
        let base_type_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected base type".to_string()))?;
        let element_type = self.parse_type(base_type_pair)?;

        // Depth: an integer literal, or a generic parameter resolved at elaboration
        let depth_pair = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected memory depth".to_string()))?;
        let text = depth_pair.as_str().trim();
        match text.parse::<usize>() {
            Ok(depth) => Ok((element_type, depth, None)),
            Err(_) => {
                let expr = depth_pair
                    .into_inner()
                    .next()
                    .map(|p| self.parse_expr(p))
                    .transpose()?
                    .ok_or_else(|| ParseError::InvalidLiteral(text.to_string()))?;
                Ok((element_type, 0, Some(expr)))
            }
        }
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
        let is_public = pair.as_str().trim_start().starts_with("pub ");
        let mut inner = pair.into_inner();

        let name = inner
            .next()
            .ok_or_else(|| ParseError::UnexpectedToken("Expected interface name".to_string()))?
            .as_str()
            .to_string();

        let mut generics = Vec::new();
        let mut signals = Vec::new();
        let mut views = Vec::new();
        let mut extends = None;

        for pair in inner {
            match pair.as_rule() {
                Rule::generics => {
                    generics = self.parse_generics(pair)?;
                }
                // The only bare identifier left is the extended interface
                Rule::identifier => extends = Some(pair.as_str().to_string()),
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
            is_public,
            extends,
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
            if item.as_rule() == Rule::direction_list {
                // direction_list = { view_direction ~ ":" ~ signal_list }
                let mut dir_inner = item.into_inner();

                let direction_pair = dir_inner
                    .next()
                    .ok_or_else(|| ParseError::UnexpectedToken("Expected view direction".to_string()))?;

                let direction = match direction_pair.as_rule() {
                    Rule::view_direction => match direction_pair.as_str() {
                        "in" => ViewDirection::In,
                        "out" => ViewDirection::Out,
                        "inout" => ViewDirection::InOut,
                        _ => {
                            return Err(ParseError::UnexpectedToken(format!(
                                "Unknown view direction: {}",
                                direction_pair.as_str()
                            )))
                        }
                    },
                    _ => {
                        return Err(ParseError::UnexpectedToken(format!(
                            "Expected view_direction, got {:?}",
                            direction_pair.as_rule()
                        )))
                    }
                };

                // Collect signal names from signal_list
                for signal_item in dir_inner {
                    if signal_item.as_rule() == Rule::signal_list {
                        for signal_inner in signal_item.into_inner() {
                            if signal_inner.as_rule() == Rule::identifier {
                                signals.push(ViewSignal {
                                    name: signal_inner.as_str().to_string(),
                                    direction: direction.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(ViewDef { name, signals })
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
