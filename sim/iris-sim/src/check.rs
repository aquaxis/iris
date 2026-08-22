//! Static checks over an elaborated design
//!
//! These are the compile-time rules the specification defines but that the
//! simulator would otherwise ignore: generic parameter constraints (spec 3.3.3),
//! `match` exhaustiveness (spec 5.6.2), the restriction of verification-only
//! system functions to verification contexts (spec 3.3.4), and constant slice
//! bounds (spec 9.6.2).
//!
//! Diagnostic codes follow the scheme in spec 14: a category range and a number.

use std::collections::HashMap;

use crate::parser::{
    BinOp, Constraint, Expression, LogicBlock, Module, Pattern, SeqStatement, Span, Statement,
    SysFuncArg, Type,
};
use crate::project::Project;

/// How serious a diagnostic is
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// A single static-check finding
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// Spec 14 code, such as "O1005"
    pub code: &'static str,
    pub severity: Severity,
    /// Module the finding belongs to
    pub module: String,
    pub message: String,
    pub span: Option<Span>,
    /// Extra context, rendered as `= note:` lines
    pub notes: Vec<String>,
    /// Suggested fix, rendered as a `= help:` line
    pub help: Option<String>,
}

impl Diagnostic {
    fn error(code: &'static str, module: &str, message: String) -> Self {
        Self {
            code,
            severity: Severity::Error,
            module: module.to_string(),
            message,
            span: None,
            notes: Vec::new(),
            help: None,
        }
    }

    fn warning(code: &'static str, module: &str, message: String) -> Self {
        Self {
            severity: Severity::Warning,
            ..Self::error(code, module, message)
        }
    }

    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    fn with_note(mut self, note: String) -> Self {
        self.notes.push(note);
        self
    }

    fn with_help(mut self, help: &str) -> Self {
        self.help = Some(help.to_string());
        self
    }
}

/// System functions the specification restricts to verification contexts
const VERIFICATION_ONLY: [&str; 4] = ["display", "finish", "isunknown", "onehot"];

/// Run every static check over an elaborated project
pub fn check_project(project: &Project) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    // Only the elaborated design is checked. A generic module still holds
    // unresolved parameters in its widths and bounds, and its specialized
    // copies are what actually run.
    for name in reachable_modules(project) {
        let Some(module) = project.get_module(&name) else {
            continue;
        };
        check_generic_constraints(project, module, &mut diagnostics);
        check_extern_instances(project, module, &mut diagnostics);
        check_unknown_types(project, module, &mut diagnostics);
        check_module_statements(project, module, &mut diagnostics);
    }
    // Deterministic order regardless of how the modules are stored
    diagnostics.sort_by(|a, b| {
        (a.module.as_str(), a.code, a.message.as_str())
            .cmp(&(b.module.as_str(), b.code, b.message.as_str()))
    });
    diagnostics.dedup_by(|a, b| {
        a.module == b.module && a.code == b.code && a.message == b.message
    });
    diagnostics
}

/// Modules reachable from the top module through instantiation
fn reachable_modules(project: &Project) -> Vec<String> {
    let Some(top) = project.top_module.clone() else {
        // Without a top module there is nothing elaborated to check
        return Vec::new();
    };

    let mut seen = Vec::new();
    let mut queue = vec![top];
    while let Some(name) = queue.pop() {
        if seen.contains(&name) {
            continue;
        }
        seen.push(name.clone());
        if let Some(module) = project.get_module(&name) {
            for inst in &module.instances {
                queue.push(inst.module_name.clone());
            }
        }
    }
    seen.sort();
    seen
}

/// O1005: a generic argument violates a `where` constraint
fn check_generic_constraints(project: &Project, module: &Module, out: &mut Vec<Diagnostic>) {
    if module.where_constraints.is_empty() {
        return;
    }

    // A specialized module carries its parameter values in its generic defaults
    let env = generic_values(module);

    for constraint in &module.where_constraints {
        let violation = match constraint {
            Constraint::Compare {
                param, op, bound, ..
            } => match (env.get(param).copied(), Project::const_value(bound, &env)) {
                (None, _) => Some(format!(
                    "constraint mentions unknown generic parameter '{}'",
                    param
                )),
                // A bound that will not fold is not something to judge
                (Some(_), None) => None,
                (Some(actual), Some(bound)) if !satisfies(actual, *op, bound) => Some(format!(
                    "generic parameter constraint violation: {}={} violates constraint: {}",
                    param, actual, constraint
                )),
                _ => None,
            },
            Constraint::TypeBound { param, ty, .. } => {
                match module.generics.iter().find(|g| &g.name == param) {
                    None => Some(format!(
                        "constraint mentions unknown generic parameter '{}'",
                        param
                    )),
                    Some(declared) if !type_satisfies(&declared.ty, ty) => Some(format!(
                        "generic parameter constraint violation: {} is declared '{}', not '{}'",
                        param, declared.ty, ty
                    )),
                    _ => None,
                }
            }
            Constraint::Predicate {
                subject,
                method,
                args,
                ..
            } => check_predicate(subject, method, args, &env, constraint),
        };

        let Some(message) = violation else {
            continue;
        };

        out.push(
            Diagnostic::error("O1005", &module.name, message)
                .with_span(constraint.span())
                .with_note(format!(
                    "{} requires: {}",
                    base_name(&module.name),
                    module
                        .where_constraints
                        .iter()
                        .map(|c| c.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
                .with_help("pass a value that satisfies the constraint"),
        );
    }

    let _ = project;
}

/// Does a parameter declared as `declared` meet a `where` bound of `required`?
fn type_satisfies(declared: &Type, required: &Type) -> bool {
    match (declared, required) {
        // A width is not part of the bound: `Depth: uint` accepts `uint[16]`
        (Type::Int { signed: a, .. }, Type::Int { signed: b, .. }) => a == b,
        (Type::Bool, Type::Bool) | (Type::Bit, Type::Bit) => true,
        (Type::BitVec { .. }, Type::Bit) | (Type::Bit, Type::BitVec { .. }) => true,
        (Type::BitVec { .. }, Type::BitVec { .. }) => true,
        (Type::Named(a), Type::Named(b)) => a == b,
        _ => false,
    }
}

/// The predicates a `where` clause may call on a parameter
const PREDICATES: [&str; 3] = ["is_power_of_two", "is_even", "is_odd"];

/// Check a predicate form such as `Depth.is_power_of_two()`
fn check_predicate(
    subject: &Expression,
    method: &str,
    args: &[Expression],
    env: &HashMap<String, i64>,
    constraint: &Constraint,
) -> Option<String> {
    if !PREDICATES.contains(&method) {
        return Some(format!(
            "unknown constraint predicate '{}'; supported: {}",
            method,
            PREDICATES.join(", ")
        ));
    }
    if !args.is_empty() {
        return Some(format!("predicate '{}' takes no arguments", method));
    }
    // An unresolved subject is not something to judge
    let value = Project::const_value(subject, env)?;
    let holds = match method {
        "is_power_of_two" => value > 0 && (value & (value - 1)) == 0,
        "is_even" => value % 2 == 0,
        _ => value % 2 != 0,
    };
    if holds {
        None
    } else {
        Some(format!(
            "generic parameter constraint violation: {} violates constraint: {}",
            value, constraint
        ))
    }
}

/// O1007: an instantiated `extern` module has no behaviour here
fn check_extern_instances(project: &Project, module: &Module, out: &mut Vec<Diagnostic>) {
    for inst in &module.instances {
        let Some(target) = project.get_module(&inst.module_name) else {
            continue;
        };
        if !target.is_extern {
            continue;
        }
        out.push(
            Diagnostic::warning(
                "O1007",
                &module.name,
                format!(
                    "instance '{}' is an extern module, which this simulator cannot execute",
                    inst.name
                ),
            )
            .with_note(format!(
                "'{}' is implemented outside IRIS, so its outputs stay at their initial value",
                base_name(&inst.module_name)
            ))
            .with_help("replace it with an IRIS model for simulation"),
        );
    }
}

/// Values of a module's generic parameters after elaboration
fn generic_values(module: &Module) -> HashMap<String, i64> {
    let mut env = HashMap::new();
    for param in &module.generics {
        if let Some(value) = param
            .default_value
            .as_ref()
            .and_then(|e| Project::const_value(e, &env))
        {
            env.insert(param.name.clone(), value);
        }
    }
    env
}

/// The module name without the suffix elaboration appends
fn base_name(name: &str) -> &str {
    name.split("__").next().unwrap_or(name)
}

fn satisfies(actual: i64, op: BinOp, bound: i64) -> bool {
    match op {
        BinOp::Lt => actual < bound,
        BinOp::Le => actual <= bound,
        BinOp::Gt => actual > bound,
        BinOp::Ge => actual >= bound,
        BinOp::Eq => actual == bound,
        BinOp::Ne => actual != bound,
        // A constraint written with any other operator is not a comparison
        _ => true,
    }
}

/// Walk a module's blocks, checking statements and expressions
/// O1008: a type name that nothing declares
///
/// An unresolved name reaches the simulator as `Type::Named`, whose width is
/// unknown, and every caller falls back to one bit. A signal declared with a
/// misspelt or foreign type name silently becomes one bit and carries the
/// wrong value, with nothing to say so.
///
/// This matters beyond typos. Veryl has ten type names IRIS does not
/// (`f32`, `f64`, `p8`..`p64`, `bbool`, `lbool`), so a converter that passes
/// one through unchanged would produce a design that simulates, reports
/// success, and is wrong. `iris2sv` already warns here; until this check the
/// two tools disagreed about the same input.
fn check_unknown_types(project: &Project, module: &Module, out: &mut Vec<Diagnostic>) {
    let mut report = |kind: &str, holder: &str, ty: &Type| {
        let Type::Named(name) = ty else {
            return;
        };
        if is_known_type(project, name) {
            return;
        }
        out.push(
            Diagnostic::warning(
                "O1008",
                &module.name,
                format!("user type '{}' is not declared anywhere", name),
            )
            .with_note(format!(
                "{} '{}' has no known width, so it is treated as 1 bit",
                kind, holder
            ))
            .with_help("declare the type, or use a built-in type such as bit[N]"),
        );
    };

    for port in &module.ports {
        report("port", &port.name, &port.ty);
    }
    for signal in &module.signals {
        report("signal", &signal.name, &signal.ty);
    }
    for mem in &module.memories {
        report("memory", &mem.name, &mem.element_type);
    }
}

/// Whether a name is declared as an enumeration, structure, union or interface
fn is_known_type(project: &Project, name: &str) -> bool {
    let base = base_name(name);
    let known = |n: &str| {
        project.enums.contains_key(n)
            || project.structs.contains_key(n)
            || project.interfaces.contains_key(n)
            || project.type_aliases.contains_key(n)
    };
    if known(name) || known(base) {
        return true;
    }
    // A name written with a package path resolves on its last segment
    match name.rsplit("::").next() {
        Some(last) if last != name => known(last) || known(base_name(last)),
        _ => false,
    }
}

fn check_module_statements(project: &Project, module: &Module, out: &mut Vec<Diagnostic>) {
    for block in &module.logic_blocks {
        let statements = match block {
            LogicBlock::Comb(comb) => &comb.statements,
            LogicBlock::Sync(sync) => &sync.statements,
        };
        // A logic block is synthesizable, so it is not a verification context
        check_statements(
            project,
            module, statements, module.is_test, out);
    }

    // An FSM is synthesizable logic, like a sync block
    for fsm in &module.fsm_blocks {
        for state in &fsm.states {
            for (_, expr) in &state.moore_outputs {
                check_expr(
            project,
            module, expr, module.is_test, out);
            }
        }
        for transition in &fsm.transitions {
            for when_clause in &transition.when_clauses {
                check_expr(
            project,
            module, &when_clause.condition, module.is_test, out);
                for action in &when_clause.actions {
                    if let crate::parser::FsmAction::Assign { value, .. } = action {
                        check_expr(
            project,
            module, value, module.is_test, out);
                    }
                }
            }
        }
        for output in &fsm.outputs {
            for (_, expr) in &output.mappings {
                check_expr(
            project,
            module, expr, module.is_test, out);
            }
        }
    }

    // `seq` and `initial` blocks are verification contexts
    for seq in &module.seq_blocks {
        check_seq_statements(project, module, &seq.statements, out);
    }
    for initial in &module.initial_blocks {
        check_seq_statements(project, module, &initial.statements, out);
    }
}

fn check_statements(
    project: &Project,
    module: &Module,
    stmts: &[Statement],
    verification_context: bool,
    out: &mut Vec<Diagnostic>,
) {
    for stmt in stmts {
        match stmt {
            Statement::Break | Statement::Continue => {}
            Statement::Cover(cover) => check_expr(
                project,
                module,
                &cover.condition,
                true,
                out,
            ),
            Statement::Assign { value, .. } => {
                check_expr(
            project,
            module, value, verification_context, out)
            }
            Statement::MemWrite { addr, value, .. } => {
                check_expr(
            project,
            module, addr, verification_context, out);
                check_expr(
            project,
            module, value, verification_context, out);
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                check_expr(
            project,
            module, condition, verification_context, out);
                check_statements(
            project,
            module, then_branch, verification_context, out);
                if let Some(else_b) = else_branch {
                    check_statements(
            project,
            module, else_b, verification_context, out);
                }
            }
            Statement::Match { expr, arms } => {
                check_expr(
            project,
            module, expr, verification_context, out);
                let patterns: Vec<&Pattern> = arms.iter().map(|a| &a.pattern).collect();
                check_exhaustive(project, module, expr, &patterns, out);
                for arm in arms {
                    check_statements(
            project,
            module, &arm.body, verification_context, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                check_statements(
            project,
            module, body, verification_context, out)
            }
            Statement::LetLocal { value, .. } => {
                if let Some(v) = value {
                    check_expr(
            project,
            module, v, verification_context, out);
                }
            }
            Statement::Assert(assert_stmt) => {
                check_expr(
            project,
            module, &assert_stmt.condition, verification_context, out)
            }
            Statement::SysCall(call) => check_expr(
            project,
            module, call, verification_context, out),
            Statement::SliceWrite {
                target,
                low,
                width,
                value,
            } => {
                check_expr(
            project,
            module, low, verification_context, out);
                check_expr(
            project,
            module, width, verification_context, out);
                check_expr(
            project,
            module, value, verification_context, out);
                // The position may vary, the width may not
                if !matches!(width, Expression::Literal(_)) {
                    out.push(
                        Diagnostic::error(
                            "O2007",
                            &module.name,
                            format!(
                                "width of the bit field assigned to '{}' is not a constant",
                                target
                            ),
                        )
                        .with_note(
                            "a bit field must have a fixed width, so it has to be known at elaboration"
                                .to_string(),
                        )
                        .with_help(
                            "use a part select, `target[index +: width]`, with a constant width",
                        ),
                    );
                }
            }
        }
    }
}

fn check_seq_statements(
    project: &Project,
    module: &Module,
    stmts: &[SeqStatement],
    out: &mut Vec<Diagnostic>,
) {
    for stmt in stmts {
        match stmt {
            SeqStatement::Assign { value, .. } | SeqStatement::SignalWrite { value, .. } => {
                check_expr(
            project,
            module, value, true, out)
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                check_expr(
            project,
            module, condition, true, out);
                check_seq_statements(project, module, then_branch, out);
                if let Some(else_b) = else_branch {
                    check_seq_statements(project, module, else_b, out);
                }
            }
            SeqStatement::For { body, .. } | SeqStatement::While { body, .. } => {
                check_seq_statements(project, module, body, out)
            }
            SeqStatement::MemWrite { addr, value, .. } => {
                check_expr(
            project,
            module, addr, true, out);
                check_expr(
            project,
            module, value, true, out);
            }
            SeqStatement::Assert(a) => check_expr(
            project,
            module, &a.condition, true, out),
            SeqStatement::SysCall(call) => check_expr(
            project,
            module, call, true, out),
            SeqStatement::Cover(cover) => {
                check_expr(project, module, &cover.condition, true, out)
            }
            SeqStatement::Delay(_)
            | SeqStatement::Await(_)
            | SeqStatement::Break
            | SeqStatement::Continue => {}
        }
    }
}

fn check_expr(
    project: &Project,
    module: &Module,
    expr: &Expression,
    verification_context: bool,
    out: &mut Vec<Diagnostic>,
) {
    match expr {
        Expression::SysFunc { name, args } => {
            if !verification_context && VERIFICATION_ONLY.contains(&name.as_str()) {
                out.push(
                    Diagnostic::error(
                        "O7009",
                        &module.name,
                        format!("'${}' used outside a verification context", name),
                    )
                    .with_note(
                        "verification-only system functions are allowed in a 'test' module, or in a 'seq' or 'initial' block"
                            .to_string(),
                    )
                    .with_help("move the call into a test module, or delete it"),
                );
            }
            for arg in args {
                if let SysFuncArg::Expr(e) = arg {
                    check_expr(
            project,
            module, e, verification_context, out);
                }
            }
        }
        Expression::Match { scrutinee, arms } => {
            check_expr(
            project,
            module, scrutinee, verification_context, out);
            let patterns: Vec<&Pattern> = arms.iter().map(|a| &a.pattern).collect();
            check_exhaustive(project, module, scrutinee, &patterns, out);
            for arm in arms {
                check_expr(
            project,
            module, &arm.value, verification_context, out);
            }
        }
        Expression::BinOp { lhs, rhs, .. } => {
            check_expr(
            project,
            module, lhs, verification_context, out);
            check_expr(
            project,
            module, rhs, verification_context, out);
        }
        Expression::UnaryOp { expr, .. } => check_expr(
            project,
            module, expr, verification_context, out),
        Expression::Index { base, index } => {
            check_expr(
            project,
            module, base, verification_context, out);
            check_expr(
            project,
            module, index, verification_context, out);
        }
        Expression::Slice { base, high, low } => {
            check_expr(
            project,
            module, base, verification_context, out);
            // Elaboration folds constant bounds to literals; anything left is a
            // value that varies at run time, so the slice would have no fixed width
            for (bound, which) in [(high, "high"), (low, "low")] {
                if !matches!(bound.as_ref(), Expression::Literal(_)) {
                    out.push(
                        Diagnostic::error(
                            "O2007",
                            &module.name,
                            format!(
                                "slice {} bound '{}' is not a constant",
                                which, bound
                            ),
                        )
                        .with_note(
                            "a slice must have a fixed width, so both bounds have to be known at elaboration"
                                .to_string(),
                        )
                        .with_help(
                            "use a part select, `value[index +: width]`, to choose a position that varies at run time",
                        ),
                    );
                }
            }
        }
        Expression::PartSelect { base, index, .. } => {
            check_expr(
            project,
            module, base, verification_context, out);
            check_expr(
            project,
            module, index, verification_context, out);
        }
        Expression::MethodCall { receiver, args, .. } => {
            check_expr(
            project,
            module, receiver, verification_context, out);
            for arg in args {
                check_expr(
            project,
            module, arg, verification_context, out);
            }
        }
        Expression::If {
            condition,
            then_expr,
            else_expr,
        } => {
            check_expr(
            project,
            module, condition, verification_context, out);
            check_expr(
            project,
            module, then_expr, verification_context, out);
            check_expr(
            project,
            module, else_expr, verification_context, out);
        }
        Expression::Concat(exprs) => {
            for e in exprs {
                check_expr(
            project,
            module, e, verification_context, out);
            }
        }
        Expression::Replicate { count, value } => {
            check_expr(project, module, count, verification_context, out);
            for e in value {
                check_expr(project, module, e, verification_context, out);
            }
        }
        Expression::MemRead { addr, .. } => check_expr(
            project,
            module, addr, verification_context, out),
        Expression::Call { name, args } => {
            // Elaboration replaces a call with its body; one left here names
            // no function that exists
            out.push(
                Diagnostic::error(
                    "O1006",
                    &module.name,
                    format!("call to unknown function '{}'", name),
                )
                .with_help("declare it with `fn`, or check the spelling"),
            );
            for arg in args {
                check_expr(project, module, arg, verification_context, out);
            }
        }
        Expression::Literal(_) | Expression::Ident(_) => {}
    }
}

/// Spec 5.6.2: a `match` must cover every value of the scrutinee, or use `_`
fn check_exhaustive(
    project: &Project,
    module: &Module,
    scrutinee: &Expression,
    patterns: &[&Pattern],
    out: &mut Vec<Diagnostic>,
) {
    let has_wildcard = patterns.iter().any(|p| matches!(p, Pattern::Wildcard));
    if has_wildcard {
        return;
    }

    // An enumeration is covered by its variants, not by every bit pattern
    if let Some(name) = scrutinee_enum(module, scrutinee) {
        check_enum_exhaustive(project, module, &name, patterns, out);
        return;
    }

    // Only a scrutinee whose width is known can be checked
    let Some(width) = scrutinee_width(project, module, scrutinee) else {
        return;
    };

    // Above four bits the specification asks for a wildcard rather than
    // sixteen or more arms
    if width >= 4 {
        out.push(
            Diagnostic::warning(
                "O2006",
                &module.name,
                format!(
                    "match on bit[{}] should use a '_' arm rather than listing {} patterns",
                    width,
                    1u64 << width.min(63)
                ),
            )
            .with_help("add a '_' arm covering the remaining values"),
        );
        return;
    }

    let distinct: std::collections::BTreeSet<u64> = patterns
        .iter()
        .filter_map(|p| match p {
            Pattern::Literal(lit) => Some(lit.to_u64()),
            _ => None,
        })
        .collect();

    let required = 1u64 << width;
    if (distinct.len() as u64) < required {
        let missing: Vec<String> = (0..required)
            .filter(|v| !distinct.contains(v))
            .take(4)
            .map(|v| v.to_string())
            .collect();
        out.push(
            Diagnostic::error(
                "O2006",
                &module.name,
                format!(
                    "non-exhaustive match on bit[{}]: {} of {} values are covered",
                    width,
                    distinct.len(),
                    required
                ),
            )
            .with_note(format!("values not covered: {}", missing.join(", ")))
            .with_help("add the missing arms, or a '_' arm"),
        );
    }
}

/// The enumeration a scrutinee is declared with, if any
fn scrutinee_enum(module: &Module, scrutinee: &Expression) -> Option<String> {
    let Expression::Ident(name) = scrutinee else {
        return None;
    };
    module
        .ports
        .iter()
        .find(|p| &p.name == name)
        .map(|p| &p.ty)
        .or_else(|| {
            module
                .signals
                .iter()
                .find(|s| &s.name == name)
                .map(|s| &s.ty)
        })
        .and_then(|ty| match ty {
            Type::Enum { name, .. } => Some(name.clone()),
            _ => None,
        })
}

/// Spec 5.6.2: a `match` on an enumeration must cover every variant
fn check_enum_exhaustive(
    project: &Project,
    module: &Module,
    enum_name: &str,
    patterns: &[&Pattern],
    out: &mut Vec<Diagnostic>,
) {
    let Some(decl) = project.enums.get(enum_name) else {
        return;
    };

    // A variant without a payload became a literal; one with a payload kept
    // its tag
    let covered: std::collections::BTreeSet<u64> = patterns
        .iter()
        .filter_map(|p| match p {
            Pattern::Literal(lit) => Some(lit.to_u64()),
            Pattern::Variant { tag, .. } => Some(*tag),
            _ => None,
        })
        .collect();

    let mut missing = Vec::new();
    let mut next = 0i64;
    for variant in &decl.variants {
        let value = variant
            .value
            .as_ref()
            .and_then(|e| Project::const_value(e, &HashMap::new()))
            .unwrap_or(next);
        next = value + 1;
        if !covered.contains(&(value as u64)) {
            missing.push(variant.name.clone());
        }
    }

    if !missing.is_empty() {
        out.push(
            Diagnostic::error(
                "O2006",
                &module.name,
                format!(
                    "non-exhaustive match on enum {}: {} of {} variants are covered",
                    enum_name,
                    decl.variants.len() - missing.len(),
                    decl.variants.len()
                ),
            )
            .with_note(format!(
                "variants not covered: {}",
                missing
                    .iter()
                    .map(|m| format!("{}::{}", enum_name, m))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
            .with_help("add the missing arms, or a '_' arm"),
        );
    }
}

/// Width of a match scrutinee.
///
/// The rules follow `iris_runtime::ops`, so that the check judges the same
/// value the simulator will produce. `None` means the width cannot be settled
/// without running the design, and the arm count is then not judged.
fn scrutinee_width(project: &Project, module: &Module, scrutinee: &Expression) -> Option<usize> {
    expr_width(project, module, scrutinee)
}

/// Width of a port reached through an instance, as in `dut.count`
fn instance_port_width(
    project: &Project,
    module: &Module,
    instance: &str,
    port: &str,
) -> Option<usize> {
    let inst = module.instances.iter().find(|i| i.name == instance)?;
    let target = project.get_module(&inst.module_name)?;
    target
        .ports
        .iter()
        .find(|p| p.name == port)
        .and_then(|p| p.ty.width())
        .or_else(|| declared_width(target, port))
}

/// Declared width of a name in a module
fn declared_width(module: &Module, name: &str) -> Option<usize> {
    module
        .ports
        .iter()
        .find(|p| p.name == name)
        .map(|p| &p.ty)
        .or_else(|| {
            module
                .signals
                .iter()
                .find(|s| s.name == name)
                .map(|s| &s.ty)
        })
        .and_then(|ty| ty.width())
        .or_else(|| {
            // A memory's read-data signal carries the element width
            module
                .memories
                .iter()
                .find(|m| format!("{}_rdata", m.name) == name)
                .and_then(|m| m.element_type.width())
        })
}

/// Is this a decimal literal written without a width suffix?
fn unsized_literal(expr: &Expression) -> bool {
    matches!(
        expr,
        Expression::Literal(crate::parser::Literal::Decimal { width: None, .. })
    )
}

/// Width an expression evaluates to, when that can be settled statically
///
/// `None` means the width could not be settled, never that it is zero. A
/// caller that needs a width must refuse the input rather than assume one.
pub fn expr_width(project: &Project, module: &Module, expr: &Expression) -> Option<usize> {
    match expr {
        Expression::Literal(lit) => Some(lit.width().unwrap_or(32)),
        Expression::Ident(name) => declared_width(module, name),
        Expression::BinOp { op, lhs, rhs } => {
            if crate::sim::eval::runtime_binop(*op).is_relational() {
                return Some(1);
            }
            let (l, r) = (expr_width(project, module, lhs), expr_width(project, module, rhs));
            // An unsized literal takes the width of the other operand
            match (unsized_literal(lhs), unsized_literal(rhs)) {
                (false, true) => l,
                (true, false) => r,
                _ => Some(l?.max(r?)),
            }
        }
        Expression::UnaryOp { expr, .. } => expr_width(project, module, expr),
        Expression::Index { .. } => Some(1),
        Expression::Slice { high, low, .. } => {
            let high = const_usize(high)?;
            let low = const_usize(low)?;
            Some(high.saturating_sub(low) + 1)
        }
        Expression::PartSelect { width, .. } => Some(const_usize(width)?.max(1)),
        Expression::Concat(parts) => {
            let mut total = 0;
            for part in parts {
                total += expr_width(project, module, part)?;
            }
            Some(total.max(1))
        }
        // `{4{8'hAB}}` is as wide as its operand repeated that many times.
        Expression::Replicate { count, value } => {
            let times = crate::project::Project::const_value(count, &Default::default())? as usize;
            let mut one = 0;
            for part in value {
                one += expr_width(project, module, part)?;
            }
            Some((one * times).max(1))
        }
        Expression::If {
            then_expr,
            else_expr,
            ..
        } => Some(expr_width(project, module, then_expr)?.max(expr_width(project, module, else_expr)?)),
        Expression::Match { arms, .. } => {
            let mut width = 0;
            for arm in arms {
                width = width.max(expr_width(project, module, &arm.value)?);
            }
            Some(width)
        }
        Expression::MemRead { mem_name, .. } => module
            .memories
            .iter()
            .find(|m| &m.name == mem_name)
            .and_then(|m| m.element_type.width()),
        Expression::MethodCall {
            receiver,
            method,
            args,
        } => match method.as_str() {
            "signed" | "unsigned" => expr_width(project, module, receiver),
            "extend" | "sign_extend" => args.first().and_then(const_usize),
            // Otherwise this reaches into an instance, as in `dut.count`
            _ => match receiver.as_ref() {
                Expression::Ident(instance) => {
                    instance_port_width(project, module, instance, method)
                }
                _ => None,
            },
        },
        // A system function yields a 32-bit result
        Expression::SysFunc { .. } => Some(32),
        // A call that survived elaboration is reported elsewhere
        Expression::Call { .. } => None,
    }
}

/// An expression that is already a literal, as a width
fn const_usize(expr: &Expression) -> Option<usize> {
    match expr {
        Expression::Literal(lit) => Some(lit.to_u64() as usize),
        _ => None,
    }
}

/// Render diagnostics in the style of spec 14
pub fn format_diagnostics(diagnostics: &[Diagnostic]) -> String {
    let mut out = String::new();
    for d in diagnostics {
        let kind = match d.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        out.push('\n');
        out.push_str(&format!("{}[{}]: {}\n", kind, d.code, d.message));
        if let Some(ref span) = d.span {
            out.push_str(&format!(
                "  --> {}:{}:{}\n",
                base_name(&d.module),
                span.start_line,
                span.start_col
            ));
        } else {
            out.push_str(&format!("  --> module {}\n", d.module));
        }
        for note in &d.notes {
            out.push_str(&format!("   = note: {}\n", note));
        }
        if let Some(ref help) = d.help {
            out.push_str(&format!("   = help: {}\n", help));
        }
    }
    out
}

/// Does this set of diagnostics prevent simulation?
pub fn has_errors(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|d| d.severity == Severity::Error)
}
