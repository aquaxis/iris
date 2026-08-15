//! IRIS to Veryl.
//!
//! Reads with `iris-sim`'s parser, so no IRIS front end is written here.
//! Every decision about what may be converted comes from [`crate::mapping`];
//! this module only knows how to write the result out.

use iris_sim::parser::{
    BinOp, ClockEdge, CombBlock, Expression, Literal, LogicBlock, Module, Port, PortDirection,
    Signal, Statement, SyncBlock, Type, UnaryOp,
};

use iris_sim::project::Project;

use veryl2iris_mapping::diag::{Diagnostic, Level, Position, Report};
use veryl2iris_mapping as mapping;

/// The result of converting one file.
pub struct Converted {
    /// Veryl source. Empty when the report holds an error.
    pub source: String,
    pub report: Report,
}

/// What the expression writer needs besides the expression itself.
///
/// Widths are asked of `iris-sim` rather than worked out here, so that there
/// is one answer to "how wide is this" and not two that can drift apart.
struct Ctx<'a> {
    file: &'a str,
    module: &'a Module,
    /// An empty project is enough for the widths this converter asks for:
    /// nothing it converts reaches through an instance, and an expression
    /// that did would come back with no width and be refused, not guessed.
    project: Project,
}

impl Ctx<'_> {
    fn width(&self, expr: &Expression) -> Option<usize> {
        iris_sim::check::expr_width(&self.project, self.module, expr)
    }
}

/// Convert every module in an IRIS source text to Veryl.
pub fn convert(file: &str, source: &str) -> Result<Converted, String> {
    let parser = iris_sim::parser::Parser::new();
    let parsed = parser
        .parse_all(source)
        .map_err(|e| format!("{}: {}", file, e))?;

    let mut out = String::new();
    let mut report = Report::default();

    // A test module is verification scaffolding, and Veryl has no counterpart
    // for the statements inside it. Refusing the whole file would stop a
    // design that happens to sit beside its bench, so they are skipped with a
    // note rather than converted or silently dropped.
    for module in &parsed.modules {
        if module.is_test {
            report.push(Diagnostic {
                level: Level::Warning,
                file: file.to_string(),
                position: Position::default(),
                message: format!("test module '{}' was not converted", module.name),
                note: Some(
                    "Veryl has no test, assert, cover or constraint construct".to_string(),
                ),
            });
            continue;
        }
        match module_to_veryl(file, module) {
            Ok((text, sub)) => {
                report.extend(sub);
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&text);
            }
            Err(sub) => report.extend(sub),
        }
    }

    if report.failed() {
        return Ok(Converted { source: String::new(), report });
    }
    Ok(Converted { source: out, report })
}

fn module_to_veryl(file: &str, module: &Module) -> Result<(String, Report), Report> {
    let mut report = Report::default();
    let mut out = String::new();

    // Constructs IRIS has and Veryl does not. Named, never dropped.
    if !module.fsm_blocks.is_empty() {
        report.push(unsupported_iris(file, "fsm"));
    }

    if module.signals.iter().any(|s| s.is_rand) {
        report.push(unsupported_iris(file, "rand"));
    }
    if report.failed() {
        return Err(report);
    }

    out.push_str(&format!("module {} (\n", module.name));
    for (i, port) in module.ports.iter().enumerate() {
        let comma = if i + 1 == module.ports.len() { "," } else { "," };
        out.push_str(&format!("    {}{}\n", port_to_veryl(file, port, &mut report)?, comma));
    }
    out.push_str(") {\n");

    for signal in &module.signals {
        out.push_str(&format!("    {}\n", signal_to_veryl(file, signal, &mut report)?));
    }
    for mem in &module.memories {
        out.push_str(&format!("    {}\n", mem_to_veryl(file, mem, &mut report)?));
    }
    if !module.signals.is_empty() || !module.memories.is_empty() {
        out.push('\n');
    }

    let ctx = Ctx { file, module, project: Project::new() };

    for inst in &module.instances {
        out.push_str(&inst_to_veryl(&ctx, inst, &mut report)?);
    }
    if !module.instances.is_empty() {
        out.push('\n');
    }

    for block in &module.logic_blocks {
        match block {
            LogicBlock::Comb(comb) => out.push_str(&comb_to_veryl(&ctx, comb, &mut report)?),
            LogicBlock::Sync(sync) => out.push_str(&sync_to_veryl(&ctx, sync, &mut report)?),
        }
    }

    out.push_str("}\n");
    if report.failed() {
        return Err(report);
    }
    Ok((out, report))
}

/// Refuse a construct the target language cannot express.
///
/// The entry must exist in the table: a refusal with no entry would be this
/// tool inventing a language limit, which is exactly what the table is for.
fn unsupported_iris(file: &str, construct: &str) -> Diagnostic {
    let entry = mapping::unsupported()
        .find(|m| m.iris == construct)
        .or_else(|| mapping::unsupported().find(|m| m.iris.starts_with(construct)))
        .expect("a language-level refusal must name an entry in the mapping table");
    Diagnostic::unsupported(file, Position::default(), entry, construct)
}

fn port_to_veryl(file: &str, port: &Port, report: &mut Report) -> Result<String, Report> {
    let direction = match port.direction {
        PortDirection::In => "input",
        PortDirection::Out => "output",
        PortDirection::InOut => "inout",
        // An interface port names a view, and an IRIS view has no default
        // direction or reversal to carry across. Refused rather than guessed.
        other => {
            let mut sub = Report::default();
            sub.push(Diagnostic {
                level: Level::Error,
                file: file.to_string(),
                position: Position::default(),
                message: format!("port direction '{:?}' has no counterpart in Veryl", other),
                note: Some(
                    "an IRIS view maps onto a modport only when each signal names its direction"
                        .to_string(),
                ),
            });
            return Err(sub);
        }
    };
    let ty = type_to_veryl(file, &port.ty, report)?;
    Ok(format!("{}: {} {}", port.name, direction, ty))
}

fn signal_to_veryl(file: &str, signal: &Signal, report: &mut Report) -> Result<String, Report> {
    let ty = type_to_veryl(file, &signal.ty, report)?;
    // IRIS writes an initial value on the declaration; Veryl has no such form,
    // and the reset branch of an always_ff is where the value belongs.
    Ok(format!("var {}: {};", signal.name, ty))
}

/// An IRIS `mem` as a Veryl array.
///
/// Veryl has arrays but no memory configuration, so `ram`, `rom`, the read and
/// write modes and `init_file` have nowhere to go. That is stated rather than
/// dropped: a ROM silently becoming writable memory is the kind of difference
/// that survives a simulation and fails in synthesis.
fn mem_to_veryl(
    file: &str,
    mem: &iris_sim::parser::MemDecl,
    report: &mut Report,
) -> Result<String, Report> {
    let element = type_to_veryl(file, &mem.element_type, report)?;

    let config = &mem.config;
    let configured = config.ports.is_some()
        || config.mem_type.is_some()
        || config.read_mode.is_some()
        || config.write_mode.is_some()
        || config.init_file.is_some();
    if configured {
        report.push(lossy_iris(file, "mem with ram/rom/read_mode/init_file"));
    }
    if mem.init.is_some() {
        report.push(Diagnostic {
            level: Level::Warning,
            file: file.to_string(),
            position: Position::default(),
            message: format!("the initial contents of '{}' are not carried across", mem.name),
            note: Some("Veryl has no initialiser on an array declaration".to_string()),
        });
    }

    Ok(format!("var {}: {} [{}];", mem.name, element, mem.depth))
}

/// Report a conversion that keeps going but loses something.
fn lossy_iris(file: &str, construct: &str) -> Diagnostic {
    let entry = mapping::lossy()
        .find(|m| m.iris == construct)
        .expect("a lossy conversion must name an entry in the mapping table");
    Diagnostic::lossy(file, Position::default(), entry, construct)
}

fn type_to_veryl(file: &str, ty: &Type, report: &mut Report) -> Result<String, Report> {
    Ok(match ty {
        Type::Bit => "logic".to_string(),
        Type::BitVec { width } => format!("logic<{}>", width),
        Type::Bool => "logic".to_string(),
        Type::Clock => "clock".to_string(),
        Type::Reset { .. } => "reset".to_string(),
        Type::Int { width, signed: true } => format!("signed logic<{}>", width),
        Type::Int { width, signed: false } => format!("logic<{}>", width),
        Type::Enum { name, .. } => name.clone(),
        Type::Array { element, size } => {
            let inner = type_to_veryl(file, element, report)?;
            format!("{}[{}]", inner, size)
        }
        // A width still written as an expression, such as `bit[DataWidth]`.
        // Veryl has generic parameters too, so this is a limit of the
        // converter rather than of the language.
        Type::BitVecExpr { .. } => {
            return Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                &format!("the type '{}'", ty),
                "Veryl has generic parameters; the converter does not write them yet",
            )))
        }
        // A name nothing declares. IRIS reports this as O1008, so passing it
        // through as if it were a type would carry the fault across.
        Type::Named(name) => {
            return Err(one(Diagnostic {
                level: Level::Error,
                file: file.to_string(),
                position: Position::default(),
                message: format!("type '{}' is not declared anywhere", name),
                note: Some("guessing a width would change the design".to_string()),
            }))
        }
    })
}

/// A report holding a single diagnostic.
fn one(diagnostic: Diagnostic) -> Report {
    let mut report = Report::default();
    report.push(diagnostic);
    report
}

/// An IRIS instance as a Veryl one.
fn inst_to_veryl(
    ctx: &Ctx,
    inst: &iris_sim::parser::Instance,
    report: &mut Report,
) -> Result<String, Report> {
    if inst.array_size.is_some() {
        return Err(one(Diagnostic::unimplemented(
            ctx.file,
            Position::default(),
            "an instance array",
            "Veryl has arrays of instances; the converter does not write them yet",
        )));
    }

    let mut out = format!("    inst {}: {}", inst.name, inst.module_name);

    if !inst.generic_args.is_empty() {
        let mut params = Vec::new();
        for (name, value) in &inst.generic_args {
            params.push(format!("{}: {}", name, expr_to_veryl(ctx, value, report)?));
        }
        out.push_str(&format!(" #({})", params.join(", ")));
    }

    if !inst.port_connections.is_empty() {
        let mut ports = Vec::new();
        for (name, value) in &inst.port_connections {
            ports.push(format!("{}: {}", name, expr_to_veryl(ctx, value, report)?));
        }
        out.push_str(&format!(" ({})", ports.join(", ")));
    }

    out.push_str(";\n");
    Ok(out)
}

fn comb_to_veryl(ctx: &Ctx, comb: &CombBlock, report: &mut Report) -> Result<String, Report> {
    let mut out = String::from("    always_comb {\n");
    for stmt in &comb.statements {
        out.push_str(&statement_to_veryl(ctx, stmt, 2, report)?);
    }
    out.push_str("    }\n");
    Ok(out)
}

fn sync_to_veryl(ctx: &Ctx, sync: &SyncBlock, report: &mut Report) -> Result<String, Report> {
    // Veryl names the clock and, when there is one, the reset; the edge and
    // the active level travel with the signal's own type rather than the
    // sensitivity list.
    let mut head = sync.clock.signal.clone();
    if sync.clock.edge == ClockEdge::Negedge {
        // A negative edge is expressible, but the reader should know the
        // sensitivity moved from the block to the declaration.
        report.push(Diagnostic {
            level: Level::Warning,
            file: ctx.file.to_string(),
            position: Position::default(),
            message: "a negedge clock moves from the block to the signal type".to_string(),
            note: Some("declare the port as clock_negedge in Veryl".to_string()),
        });
    }
    if let Some(reset) = &sync.reset {
        head.push_str(&format!(", {}", reset.signal));
    }

    let mut out = format!("    always_ff ({}) {{\n", head);
    for stmt in &sync.statements {
        out.push_str(&statement_to_veryl(ctx, stmt, 2, report)?);
    }
    out.push_str("    }\n");
    Ok(out)
}

fn statement_to_veryl(
    ctx: &Ctx,
    stmt: &Statement,
    depth: usize,
    report: &mut Report,
) -> Result<String, Report> {
    let pad = "    ".repeat(depth);
    Ok(match stmt {
        Statement::Assign { target, value } => {
            format!("{}{} = {};\n", pad, target, expr_to_veryl(ctx, value, report)?)
        }
        Statement::MemWrite { mem_name, addr, value } => format!(
            "{}{}[{}] = {};\n",
            pad,
            mem_name,
            expr_to_veryl(ctx, addr, report)?,
            expr_to_veryl(ctx, value, report)?
        ),
        Statement::If { condition, then_branch, else_branch } => {
            let mut out = format!("{}if {} {{\n", pad, expr_to_veryl(ctx, condition, report)?);
            for s in then_branch {
                out.push_str(&statement_to_veryl(ctx, s, depth + 1, report)?);
            }
            out.push_str(&format!("{}}}", pad));
            if let Some(else_branch) = else_branch {
                out.push_str(" else {\n");
                for s in else_branch {
                    out.push_str(&statement_to_veryl(ctx, s, depth + 1, report)?);
                }
                out.push_str(&format!("{}}}", pad));
            }
            out.push('\n');
            out
        }
        Statement::Match { expr, arms } => {
            let mut out = format!("{}case {} {{\n", pad, expr_to_veryl(ctx, expr, report)?);
            for arm in arms {
                let label = pattern_to_veryl(ctx.file, &arm.pattern, report)?;
                out.push_str(&format!("{}    {}: {{\n", pad, label));
                for s in &arm.body {
                    out.push_str(&statement_to_veryl(ctx, s, depth + 2, report)?);
                }
                out.push_str(&format!("{}    }}\n", pad));
            }
            out.push_str(&format!("{}}}\n", pad));
            out
        }
        // Everything else is verification scaffolding or a memory write, and
        // Veryl has no counterpart. Refused rather than skipped.
        other => {
            let mut sub = Report::default();
            sub.push(Diagnostic {
                level: Level::Error,
                file: ctx.file.to_string(),
                position: Position::default(),
                message: format!("statement has no counterpart in Veryl: {:?}", kind_of(other)),
                note: Some("only assignment, if and match convert".to_string()),
            });
            return Err(sub);
        }
    })
}

fn kind_of(stmt: &Statement) -> &'static str {
    match stmt {
        Statement::Assign { .. } => "assign",
        Statement::MemWrite { .. } => "memory write",
        Statement::If { .. } => "if",
        Statement::Match { .. } => "match",
        Statement::For { .. } => "for",
        Statement::While { .. } => "while",
        Statement::LetLocal { .. } => "let",
        Statement::Assert(_) => "assert",
        _ => "other",
    }
}

fn pattern_to_veryl(
    file: &str,
    pattern: &iris_sim::parser::Pattern,
    report: &mut Report,
) -> Result<String, Report> {
    use iris_sim::parser::Pattern;
    Ok(match pattern {
        Pattern::Wildcard => "default".to_string(),
        Pattern::Literal(lit) => literal_to_veryl(lit),
        Pattern::Ident(name) => name.clone(),
        other => {
            let mut sub = Report::default();
            sub.push(Diagnostic {
                level: Level::Error,
                file: file.to_string(),
                position: Position::default(),
                message: format!("pattern has no counterpart in Veryl: {:?}", other),
                note: Some("only a literal, an identifier or _ converts".to_string()),
            });
            let _ = report;
            return Err(sub);
        }
    })
}

fn literal_to_veryl(lit: &Literal) -> String {
    match lit {
        Literal::Binary { width, value } => format!("{}'b{:b}", width, value),
        Literal::Hex { width, value } => format!("{}'h{:x}", width, value),
        Literal::Decimal { width: Some(w), value } => format!("{}'d{}", w, value),
        Literal::Decimal { width: None, value } => format!("{}", value),
    }
}

fn expr_to_veryl(ctx: &Ctx, expr: &Expression, report: &mut Report) -> Result<String, Report> {
    Ok(match expr {
        Expression::Literal(lit) => literal_to_veryl(lit),
        Expression::Ident(name) => name.clone(),
        Expression::BinOp { op, lhs, rhs } => {
            let l = expr_to_veryl(ctx, lhs, report)?;
            let r = expr_to_veryl(ctx, rhs, report)?;
            format!("({} {} {})", l, binop_to_veryl(*op), r)
        }
        Expression::UnaryOp { op, expr } => {
            let inner = expr_to_veryl(ctx, expr, report)?;
            let symbol = match op {
                UnaryOp::LogNot => "!",
                UnaryOp::Not => "~",
                UnaryOp::Neg => "-",
                #[allow(unreachable_patterns)]
                _ => {
                    let mut sub = Report::default();
                    sub.push(Diagnostic {
                        level: Level::Error,
                        file: ctx.file.to_string(),
                        position: Position::default(),
                        message: format!("unary operator has no counterpart in Veryl: {:?}", op),
                        note: Some("only !, ~ and - convert".to_string()),
                    });
                    return Err(sub);
                }
            };
            format!("{}{}", symbol, inner)
        }
        Expression::Index { base, index } => format!(
            "{}[{}]",
            expr_to_veryl(ctx, base, report)?,
            expr_to_veryl(ctx, index, report)?
        ),
        Expression::Slice { base, high, low } => format!(
            "{}[{}:{}]",
            expr_to_veryl(ctx, base, report)?,
            expr_to_veryl(ctx, high, report)?,
            expr_to_veryl(ctx, low, report)?
        ),
        Expression::If { condition, then_expr, else_expr } => format!(
            "if {} ? {} : {}",
            expr_to_veryl(ctx, condition, report)?,
            expr_to_veryl(ctx, then_expr, report)?,
            expr_to_veryl(ctx, else_expr, report)?
        ),
        Expression::Match { scrutinee, arms } => {
            let mut out = format!("case {} {{\n", expr_to_veryl(ctx, scrutinee, report)?);
            for arm in arms {
                let label = pattern_to_veryl(ctx.file, &arm.pattern, report)?;
                let value = expr_to_veryl(ctx, &arm.value, report)?;
                out.push_str(&format!("            {}: {},\n", label, value));
            }
            out.push_str("        }");
            out
        }
        Expression::Concat(parts) => {
            let mut rendered = Vec::new();
            for p in parts {
                rendered.push(expr_to_veryl(ctx, p, report)?);
            }
            format!("{{{}}}", rendered.join(", "))
        }
        // IRIS `{n{a, b}}`, Veryl `{{a, b} repeat n}`.
        Expression::Replicate { count, value } => {
            let mut rendered = Vec::new();
            for part in value {
                rendered.push(expr_to_veryl(ctx, part, report)?);
            }
            let one = if rendered.len() == 1 {
                rendered.remove(0)
            } else {
                format!("{{{}}}", rendered.join(", "))
            };
            format!("{{{} repeat {}}}", one, expr_to_veryl(ctx, count, report)?)
        }
        Expression::MethodCall { receiver, method, args } if method == "sign_extend" => {
            sign_extend_to_veryl(ctx, receiver, args, report)?
        }
        Expression::MethodCall { receiver, method, args } => {
            let mut sub = Report::default();
            sub.push(method_refusal(ctx, receiver, method, args));
            return Err(sub);
        }
        other => {
            let mut sub = Report::default();
            sub.push(Diagnostic::unimplemented(
                ctx.file,
                Position::default(),
                &format!("expression {}", expr_kind(other)),
                "it may well be expressible; the converter does not write it yet",
            ));
            return Err(sub);
        }
    })
}

/// The width conversions IRIS spells as methods (spec 3.4.2).
const WIDTH_METHODS: &[&str] = &[
    "extend",
    "truncate",
    "saturate",
    "signed",
    "unsigned",
    "resize",
];

/// Why a method call could not be converted.
///
/// The same syntax carries two unrelated things in IRIS: a width conversion
/// such as `x.truncate[8]()`, and a read of an instance's output port such as
/// `dec.rd`. Reporting both as "a method" told the reader nothing about which
/// problem they had, so they are named apart.
fn method_refusal(
    ctx: &Ctx,
    receiver: &Expression,
    method: &str,
    args: &[Expression],
) -> Diagnostic {
    if WIDTH_METHODS.contains(&method) {
        return Diagnostic::unimplemented(
            ctx.file,
            Position::default(),
            &format!("`{}`", method),
            "Veryl can express the width conversions; only sign_extend is written so far",
        );
    }

    let reads_a_port = args.is_empty()
        && matches!(receiver, Expression::Ident(name)
            if ctx.module.instances.iter().any(|i| &i.name == name));
    if reads_a_port {
        return Diagnostic::unimplemented(
            ctx.file,
            Position::default(),
            &format!("reading an instance's port, as in `{}`", method),
            "Veryl wires an output to a variable at the instantiation and reads \
             that instead; the rewrite needs the ports of the instantiated module, \
             and this converter reads one file at a time",
        );
    }

    Diagnostic::unimplemented(
        ctx.file,
        Position::default(),
        &format!("the method `{}`", method),
        "the converter does not write it yet",
    )
}

/// `x.sign_extend[N]()` in IRIS, `{msb repeat N-w, x}` in Veryl.
///
/// **Veryl's cast is not the counterpart.** `x as i32` emits `int'(x)`, which
/// zero-extends an unsigned operand, while IRIS emits `32'($signed(x))`,
/// which replicates the sign bit. Writing the replication out says the same
/// thing in both languages and leaves nothing to either one's rules about
/// when a value is signed.
///
/// Both languages have the construct, so this is not a gap between them.
fn sign_extend_to_veryl(
    ctx: &Ctx,
    receiver: &Expression,
    args: &[Expression],
    report: &mut Report,
) -> Result<String, Report> {
    let refuse = |what: &str, note: &str| {
        one(Diagnostic::unimplemented(ctx.file, Position::default(), what, note))
    };

    let target = match args.first() {
        Some(Expression::Literal(lit)) => lit.to_u64() as usize,
        _ => {
            return Err(refuse(
                "a sign extension to a width that is not a literal",
                "the number of sign bits to repeat has to be known here",
            ))
        }
    };
    let Some(width) = ctx.width(receiver) else {
        return Err(refuse(
            "a sign extension whose operand width is not known",
            "the number of sign bits to repeat is that width subtracted from the target",
        ));
    };

    let value = expr_to_veryl(ctx, receiver, report)?;
    // Narrowing is not what sign_extend means; IRIS rejects it, and silently
    // widening or truncating here would hide that.
    if target < width {
        let mut sub = Report::default();
        sub.push(Diagnostic {
            level: Level::Error,
            file: ctx.file.to_string(),
            position: Position::default(),
            message: format!("sign_extend[{}] narrows a {}-bit value", target, width),
            note: Some("use truncate to make a value narrower".to_string()),
        });
        return Err(sub);
    }
    if target == width {
        return Ok(value);
    }

    let msb = msb_of(ctx, receiver, width, report)?;
    Ok(format!("{{{} repeat {}, {}}}", msb, target - width, value))
}

/// The bit an expression's sign lives in, written as Veryl.
///
/// Indexing is applied to the operand's own parts rather than to the whole
/// expression, because Veryl indexes an identifier and not an arbitrary
/// parenthesised expression.
fn msb_of(
    ctx: &Ctx,
    expr: &Expression,
    width: usize,
    report: &mut Report,
) -> Result<String, Report> {
    Ok(match expr {
        // Already one bit wide, so it is its own sign bit.
        Expression::Index { .. } => expr_to_veryl(ctx, expr, report)?,
        Expression::Ident(name) => format!("{}[{}]", name, width - 1),
        Expression::Slice { base, high, .. } => format!(
            "{}[{}]",
            expr_to_veryl(ctx, base, report)?,
            expr_to_veryl(ctx, high, report)?
        ),
        // The leading part carries the sign of the whole.
        Expression::Concat(parts) => {
            let first = parts.first().ok_or_else(|| {
                one(Diagnostic::unimplemented(
                    ctx.file,
                    Position::default(),
                    "a sign extension of an empty concatenation",
                    "there is no sign bit to repeat",
                ))
            })?;
            let first_width = ctx.width(first).ok_or_else(|| {
                one(Diagnostic::unimplemented(
                    ctx.file,
                    Position::default(),
                    "a sign extension whose leading part has no known width",
                    "the sign bit sits at the top of that part",
                ))
            })?;
            msb_of(ctx, first, first_width, report)?
        }
        _ => {
            return Err(one(Diagnostic::unimplemented(
                ctx.file,
                Position::default(),
                "a sign extension of an expression of this form",
                "the converter does not work out where its sign bit is yet",
            )))
        }
    })
}

/// A short name for an expression, for diagnostics.
fn expr_kind(expr: &Expression) -> &'static str {
    match expr {
        Expression::SysFunc { .. } => "system function",
        Expression::PartSelect { .. } => "part select",
        Expression::Replicate { .. } => "replication",
        Expression::Match { .. } => "match",
        Expression::Concat(_) => "concatenation",
        _ => "of this form",
    }
}

fn binop_to_veryl(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Mod => "%",
        BinOp::And => "&",
        BinOp::Or => "|",
        BinOp::Xor => "^",
        BinOp::Shl => "<<",
        BinOp::Shr => ">>",
        BinOp::AShr => ">>>",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        // Veryl spells the ordering comparisons with a colon so that `<` stays
        // free for generic arguments.
        BinOp::Lt => "<:",
        BinOp::Le => "<=",
        BinOp::Gt => ">:",
        BinOp::Ge => ">=",
        BinOp::LogicalAnd => "&&",
        BinOp::LogicalOr => "||",
    }
}
