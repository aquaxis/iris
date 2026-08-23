//! IRIS style linter, ported from the TypeScript `irisfmt-lint`.
//!
//! The rules run over the shared `iris-sim` AST rather than a linter-private
//! parser. That AST is built for simulation, so it carries a span only on a
//! few definitions (modules, enums, structs, functions) and holds names as
//! plain strings. Diagnostics therefore anchor to the nearest definition that
//! has a span and fall back to the start of the file — coarser than the
//! TypeScript linter, which tracked a span per identifier.
//!
//! Two TypeScript rules have no faithful home on this AST and are intentionally
//! omitted (see `lint_src`): `dead-code`'s "after return" form (blocks and
//! functions have no return statements here — a function body is one
//! expression), which is re-expressed as unreachable code after `break`/
//! `continue`; and `var-context-restriction`, because the AST does not tag a
//! statement-level `let` as `var`, and a module-level `var` is valid in current
//! IRIS.

use std::collections::HashSet;

use iris_sim::parser::ast::{
    AwaitExpr, BinOp, EnumDecl, Expression, FnDecl, FsmAction, FsmBlock, Instance, Interface,
    LogicBlock, MemInit, Module, Pattern, SeqStatement, Span, Statement, StructDecl, Type,
};
use iris_sim::parser::Parser;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Info => "info",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub line: usize,
    pub col: usize,
    pub rule: &'static str,
    pub severity: Severity,
    pub message: String,
}

/// Lint IRIS source. Returns an error only if the source does not parse.
pub fn lint_src(source: &str) -> Result<Vec<Diagnostic>, String> {
    let parser = Parser::new();
    let parsed = parser
        .parse_all(source)
        .map_err(|e| format!("parse error: {e}"))?;

    let mut out: Vec<Diagnostic> = Vec::new();

    // File-level import rules.
    unused_imports(&parsed, &mut out);
    duplicate_imports(&parsed, &mut out);
    import_order(&parsed, &mut out);

    // Definition rules.
    for m in &parsed.modules {
        naming_module(m, &mut out);
        unused_signals(m, &mut out);
        unused_variables_module(m, &mut out);
        no_empty_block_module(m, &mut out);
        dead_code_module(m, &mut out);
        complexity_module(m, &mut out);
        seq_missing_timeout_module(m, &mut out);
    }
    for f in &parsed.functions {
        naming_function(f, &mut out);
        no_empty_block_function(f, &mut out);
        complexity_function(f, &mut out);
        unused_variables_function(f, &mut out);
    }
    for e in &parsed.enums {
        naming_enum(e, &mut out);
    }
    for s in &parsed.structs {
        naming_struct(s, &mut out);
    }
    for it in &parsed.interfaces {
        naming_interface(it, &mut out);
    }
    for (name, _ty) in &parsed.type_aliases {
        if !is_pascal_case(name) {
            out.push(diag(
                None,
                "naming-convention",
                Severity::Warning,
                format!("Type alias '{name}' should be PascalCase"),
            ));
        }
    }

    // Stable order: by location, then rule name.
    out.sort_by(|a, b| {
        (a.line, a.col, a.rule).cmp(&(b.line, b.col, b.rule))
    });
    Ok(out)
}

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

fn loc_of(span: &Option<Span>) -> (usize, usize) {
    match span {
        Some(s) => (s.start_line, s.start_col),
        None => (1, 1),
    }
}

fn diag(span: Option<&Span>, rule: &'static str, severity: Severity, message: String) -> Diagnostic {
    let (line, col) = loc_of(&span.cloned());
    Diagnostic {
        line,
        col,
        rule,
        severity,
        message,
    }
}

// ---------------------------------------------------------------------------
// Naming convention
// ---------------------------------------------------------------------------

fn is_pascal_case(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => {}
        _ => return false,
    }
    name.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_snake_case(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    name.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn naming(out: &mut Vec<Diagnostic>, span: Option<&Span>, ok: bool, entity: &str, name: &str, style: &str) {
    if !ok {
        out.push(diag(
            span,
            "naming-convention",
            Severity::Warning,
            format!("{entity} '{name}' should be {style}"),
        ));
    }
}

fn naming_module(m: &Module, out: &mut Vec<Diagnostic>) {
    let span = m.span.as_ref();
    naming(out, span, is_pascal_case(&m.name), "Module", &m.name, "PascalCase");
    for g in &m.generics {
        naming(out, span, is_pascal_case(&g.name), "Generic parameter", &g.name, "PascalCase");
    }
    for p in &m.ports {
        naming(out, span, is_snake_case(&p.name), "Port", &p.name, "snake_case");
    }
    for s in &m.signals {
        let kind = if s.is_var { "Variable" } else { "Signal" };
        naming(out, span, is_snake_case(&s.name), kind, &s.name, "snake_case");
    }
    for inst in &m.instances {
        naming(out, span, is_snake_case(&inst.name), "Instance", &inst.name, "snake_case");
    }
    for mem in &m.memories {
        naming(out, span, is_snake_case(&mem.name), "Memory", &mem.name, "snake_case");
    }
    for fsm in &m.fsm_blocks {
        naming(out, span, is_snake_case(&fsm.name), "FSM", &fsm.name, "snake_case");
    }
    // Block-local lets.
    for lb in &m.logic_blocks {
        let stmts = match lb {
            LogicBlock::Comb(b) => &b.statements,
            LogicBlock::Sync(b) => &b.statements,
        };
        naming_local_lets(stmts, span, out);
    }
}

fn naming_local_lets(stmts: &[Statement], span: Option<&Span>, out: &mut Vec<Diagnostic>) {
    for s in stmts {
        match s {
            Statement::LetLocal { name, .. } => {
                naming(out, span, is_snake_case(name), "Variable", name, "snake_case");
            }
            Statement::If { then_branch, else_branch, .. } => {
                naming_local_lets(then_branch, span, out);
                if let Some(e) = else_branch {
                    naming_local_lets(e, span, out);
                }
            }
            Statement::For { var, body, .. } => {
                naming(out, span, is_snake_case(var), "Loop variable", var, "snake_case");
                naming_local_lets(body, span, out);
            }
            Statement::While { body, .. } => naming_local_lets(body, span, out),
            Statement::Match { arms, .. } => {
                for a in arms {
                    naming_local_lets(&a.body, span, out);
                }
            }
            _ => {}
        }
    }
}

fn naming_function(f: &FnDecl, out: &mut Vec<Diagnostic>) {
    let span = f.span.as_ref();
    naming(out, span, is_snake_case(&f.name), "Function", &f.name, "snake_case");
    for (pname, _ty) in &f.params {
        naming(out, span, is_snake_case(pname), "Parameter", pname, "snake_case");
    }
    for (bname, _e) in &f.bindings {
        naming(out, span, is_snake_case(bname), "Variable", bname, "snake_case");
    }
}

fn naming_enum(e: &EnumDecl, out: &mut Vec<Diagnostic>) {
    let span = e.span.as_ref();
    naming(out, span, is_pascal_case(&e.name), "Enum", &e.name, "PascalCase");
    for v in &e.variants {
        naming(out, span, is_pascal_case(&v.name), "Enum variant", &v.name, "PascalCase");
    }
}

fn naming_struct(s: &StructDecl, out: &mut Vec<Diagnostic>) {
    let span = s.span.as_ref();
    naming(out, span, is_pascal_case(&s.name), "Struct", &s.name, "PascalCase");
    for (fname, _ty) in &s.fields {
        naming(out, span, is_snake_case(fname), "Field", fname, "snake_case");
    }
}

fn naming_interface(it: &Interface, out: &mut Vec<Diagnostic>) {
    naming(out, None, is_pascal_case(&it.name), "Interface", &it.name, "PascalCase");
    for s in &it.signals {
        naming(out, None, is_snake_case(&s.name), "Interface signal", &s.name, "snake_case");
    }
}

// ---------------------------------------------------------------------------
// Import rules
// ---------------------------------------------------------------------------

fn unused_imports(parsed: &iris_sim::parser::ParseResult, out: &mut Vec<Diagnostic>) {
    // Every name referenced anywhere in the file.
    let mut used: HashSet<String> = HashSet::new();
    for m in &parsed.modules {
        collect_module_uses(m, &mut used);
    }
    for f in &parsed.functions {
        for (_p, ty) in &f.params {
            collect_type_uses(ty, &mut used);
        }
        if let Some(rt) = &f.return_type {
            collect_type_uses(rt, &mut used);
        }
        for (_b, e) in &f.bindings {
            collect_expr_uses(e, &mut used);
        }
        collect_expr_uses(&f.body, &mut used);
    }
    for s in &parsed.structs {
        for (_f, ty) in &s.fields {
            collect_type_uses(ty, &mut used);
        }
    }
    for e in &parsed.enums {
        for v in &e.variants {
            if let Some(val) = &v.value {
                collect_expr_uses(val, &mut used);
            }
        }
    }
    for (_n, ty) in &parsed.type_aliases {
        collect_type_uses(ty, &mut used);
    }

    for (pkg, names) in &parsed.imports {
        if names.is_empty() {
            // `import pkg::*` — usage cannot be attributed, so skip.
            continue;
        }
        for name in names {
            if !used.contains(name) {
                out.push(diag(
                    None,
                    "unused-import",
                    Severity::Warning,
                    format!("Unused import '{name}' (from '{pkg}')"),
                ));
            }
        }
    }
}

fn duplicate_imports(parsed: &iris_sim::parser::ParseResult, out: &mut Vec<Diagnostic>) {
    let mut seen: HashSet<String> = HashSet::new();
    for (pkg, names) in &parsed.imports {
        let paths: Vec<String> = if names.is_empty() {
            vec![format!("{pkg}::*")]
        } else {
            names.iter().map(|n| format!("{pkg}::{n}")).collect()
        };
        for p in paths {
            if !seen.insert(p.clone()) {
                out.push(diag(
                    None,
                    "duplicate-import",
                    Severity::Warning,
                    format!("Duplicate import of '{p}'"),
                ));
            }
        }
    }
}

fn import_group(pkg: &str) -> u8 {
    if pkg == "std" || pkg.starts_with("std::") {
        0
    } else {
        1
    }
}

fn import_order(parsed: &iris_sim::parser::ParseResult, out: &mut Vec<Diagnostic>) {
    let imports = &parsed.imports;
    if imports.len() <= 1 {
        return;
    }
    for i in 1..imports.len() {
        let (prev, _) = &imports[i - 1];
        let (curr, _) = &imports[i];
        let (gp, gc) = (import_group(prev), import_group(curr));
        let correct = if gp != gc { gp < gc } else { prev.as_str() <= curr.as_str() };
        if !correct {
            out.push(diag(
                None,
                "import-order",
                Severity::Warning,
                format!("Import '{curr}' should be placed before '{prev}'"),
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Unused signals
// ---------------------------------------------------------------------------

fn unused_signals(m: &Module, out: &mut Vec<Diagnostic>) {
    let mut used: HashSet<String> = HashSet::new();
    collect_module_uses(m, &mut used);

    for s in &m.signals {
        if s.name.starts_with('_') {
            continue;
        }
        if !used.contains(&s.name) {
            out.push(diag(
                m.span.as_ref(),
                "unused-signal",
                Severity::Warning,
                format!("Unused signal '{}'", s.name),
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Unused variables (block-local lets, function params/bindings)
// ---------------------------------------------------------------------------

fn unused_variables_module(m: &Module, out: &mut Vec<Diagnostic>) {
    for lb in &m.logic_blocks {
        let stmts = match lb {
            LogicBlock::Comb(b) => &b.statements,
            LogicBlock::Sync(b) => &b.statements,
        };
        let mut declared: Vec<String> = Vec::new();
        collect_local_decls(stmts, &mut declared);
        if declared.is_empty() {
            continue;
        }
        let mut used: HashSet<String> = HashSet::new();
        for s in stmts {
            collect_stmt_uses(s, &mut used);
        }
        for name in declared {
            if !name.starts_with('_') && !used.contains(&name) {
                out.push(diag(
                    m.span.as_ref(),
                    "unused-variable",
                    Severity::Warning,
                    format!("Unused variable '{name}'"),
                ));
            }
        }
    }
}

fn unused_variables_function(f: &FnDecl, out: &mut Vec<Diagnostic>) {
    let mut used: HashSet<String> = HashSet::new();
    collect_expr_uses(&f.body, &mut used);
    for (_b, e) in &f.bindings {
        collect_expr_uses(e, &mut used);
    }
    for (pname, _ty) in &f.params {
        if !pname.starts_with('_') && !used.contains(pname) {
            out.push(diag(
                f.span.as_ref(),
                "unused-variable",
                Severity::Warning,
                format!("Unused variable '{pname}'"),
            ));
        }
    }
    for (bname, _e) in &f.bindings {
        if !bname.starts_with('_') && !used.contains(bname) {
            out.push(diag(
                f.span.as_ref(),
                "unused-variable",
                Severity::Warning,
                format!("Unused variable '{bname}'"),
            ));
        }
    }
}

fn collect_local_decls(stmts: &[Statement], out: &mut Vec<String>) {
    for s in stmts {
        match s {
            Statement::LetLocal { name, .. } => out.push(name.clone()),
            Statement::If { then_branch, else_branch, .. } => {
                collect_local_decls(then_branch, out);
                if let Some(e) = else_branch {
                    collect_local_decls(e, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                collect_local_decls(body, out)
            }
            Statement::Match { arms, .. } => {
                for a in arms {
                    collect_local_decls(&a.body, out);
                }
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// No empty block
// ---------------------------------------------------------------------------

fn no_empty_block_module(m: &Module, out: &mut Vec<Diagnostic>) {
    let span = m.span.as_ref();
    for lb in &m.logic_blocks {
        match lb {
            LogicBlock::Comb(b) => {
                if b.statements.is_empty() {
                    empty_block(out, span, "comb block");
                } else {
                    empty_nested(&b.statements, span, out);
                }
            }
            LogicBlock::Sync(b) => {
                if b.statements.is_empty() {
                    empty_block(out, span, "sync block");
                } else {
                    empty_nested(&b.statements, span, out);
                }
            }
        }
    }
    for fsm in &m.fsm_blocks {
        if fsm.transitions.is_empty() {
            empty_block(out, span, "transitions block");
        }
    }
    for ib in &m.initial_blocks {
        if ib.statements.is_empty() {
            empty_block(out, span, "initial block");
        }
    }
    for sb in &m.seq_blocks {
        if sb.statements.is_empty() {
            empty_block(out, span, "seq block");
        }
    }
}

fn empty_nested(stmts: &[Statement], span: Option<&Span>, out: &mut Vec<Diagnostic>) {
    for s in stmts {
        match s {
            Statement::If { then_branch, else_branch, .. } => {
                if then_branch.is_empty() {
                    empty_block(out, span, "if block");
                } else {
                    empty_nested(then_branch, span, out);
                }
                if let Some(e) = else_branch {
                    if e.is_empty() {
                        empty_block(out, span, "else block");
                    } else {
                        empty_nested(e, span, out);
                    }
                }
            }
            Statement::For { body, .. } => {
                if body.is_empty() {
                    empty_block(out, span, "for loop body");
                } else {
                    empty_nested(body, span, out);
                }
            }
            Statement::While { body, .. } => {
                if body.is_empty() {
                    empty_block(out, span, "while loop body");
                } else {
                    empty_nested(body, span, out);
                }
            }
            Statement::Match { arms, .. } => {
                for a in arms {
                    empty_nested(&a.body, span, out);
                }
            }
            _ => {}
        }
    }
}

fn no_empty_block_function(f: &FnDecl, out: &mut Vec<Diagnostic>) {
    // A function body is a single expression; there is no empty form to flag.
    let _ = (f, out);
}

fn empty_block(out: &mut Vec<Diagnostic>, span: Option<&Span>, kind: &str) {
    out.push(diag(
        span,
        "no-empty-block",
        Severity::Warning,
        format!("Empty {kind}"),
    ));
}

// ---------------------------------------------------------------------------
// Dead code (statements after break/continue)
// ---------------------------------------------------------------------------

fn dead_code_module(m: &Module, out: &mut Vec<Diagnostic>) {
    let span = m.span.as_ref();
    for lb in &m.logic_blocks {
        let stmts = match lb {
            LogicBlock::Comb(b) => &b.statements,
            LogicBlock::Sync(b) => &b.statements,
        };
        dead_code_stmts(stmts, span, out);
    }
}

fn dead_code_stmts(stmts: &[Statement], span: Option<&Span>, out: &mut Vec<Diagnostic>) {
    let mut terminated = false;
    for s in stmts {
        if terminated {
            out.push(diag(
                span,
                "dead-code",
                Severity::Warning,
                "Unreachable code detected after break/continue".to_string(),
            ));
            terminated = false; // report once per run of dead statements
        }
        match s {
            Statement::Break | Statement::Continue => terminated = true,
            Statement::If { then_branch, else_branch, .. } => {
                dead_code_stmts(then_branch, span, out);
                if let Some(e) = else_branch {
                    dead_code_stmts(e, span, out);
                }
            }
            Statement::For { body, .. } | Statement::While { body, .. } => {
                dead_code_stmts(body, span, out)
            }
            Statement::Match { arms, .. } => {
                for a in arms {
                    dead_code_stmts(&a.body, span, out);
                }
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Cyclomatic complexity
// ---------------------------------------------------------------------------

const COMPLEXITY_THRESHOLD: u32 = 15;

fn complexity_module(m: &Module, out: &mut Vec<Diagnostic>) {
    let span = m.span.as_ref();
    for lb in &m.logic_blocks {
        let (stmts, kind, name) = match lb {
            LogicBlock::Comb(b) => (&b.statements, "Combinational block", "comb"),
            LogicBlock::Sync(b) => (&b.statements, "Synchronous block", "sync"),
        };
        let c = 1 + stmts.iter().map(stmt_complexity).sum::<u32>();
        if c > COMPLEXITY_THRESHOLD {
            report_complexity(out, span, kind, name, c);
        }
    }
}

fn complexity_function(f: &FnDecl, out: &mut Vec<Diagnostic>) {
    let c = 1 + expr_complexity(&f.body);
    if c > COMPLEXITY_THRESHOLD {
        report_complexity(out, f.span.as_ref(), "Function", &f.name, c);
    }
}

fn report_complexity(out: &mut Vec<Diagnostic>, span: Option<&Span>, kind: &str, name: &str, c: u32) {
    out.push(diag(
        span,
        "complexity",
        Severity::Warning,
        format!("{kind} '{name}' has a cyclomatic complexity of {c} (threshold: {COMPLEXITY_THRESHOLD})"),
    ));
}

fn stmt_complexity(s: &Statement) -> u32 {
    match s {
        Statement::If { condition, then_branch, else_branch } => {
            let mut c = 1 + logical_ops(condition);
            c += then_branch.iter().map(stmt_complexity).sum::<u32>();
            if let Some(e) = else_branch {
                c += e.iter().map(stmt_complexity).sum::<u32>();
            }
            c
        }
        Statement::For { body, .. } => 1 + body.iter().map(stmt_complexity).sum::<u32>(),
        Statement::While { condition, body } => {
            1 + logical_ops(condition) + body.iter().map(stmt_complexity).sum::<u32>()
        }
        Statement::Match { arms, .. } => {
            let base = (arms.len() as u32).saturating_sub(1);
            base + arms.iter().map(|a| a.body.iter().map(stmt_complexity).sum::<u32>()).sum::<u32>()
        }
        _ => 0,
    }
}

fn expr_complexity(e: &Expression) -> u32 {
    match e {
        Expression::If { condition, then_expr, else_expr } => {
            1 + logical_ops(condition) + expr_complexity(then_expr) + expr_complexity(else_expr)
        }
        Expression::Match { arms, .. } => {
            let base = (arms.len() as u32).saturating_sub(1);
            base + arms.iter().map(|a| expr_complexity(&a.value)).sum::<u32>()
        }
        Expression::BinOp { op, lhs, rhs } => {
            let here = if matches!(op, BinOp::LogicalAnd | BinOp::LogicalOr) { 1 } else { 0 };
            here + expr_complexity(lhs) + expr_complexity(rhs)
        }
        _ => 0,
    }
}

fn logical_ops(e: &Expression) -> u32 {
    match e {
        Expression::BinOp { op, lhs, rhs } => {
            let here = if matches!(op, BinOp::LogicalAnd | BinOp::LogicalOr) { 1 } else { 0 };
            here + logical_ops(lhs) + logical_ops(rhs)
        }
        Expression::UnaryOp { expr, .. } => logical_ops(expr),
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// seq-missing-timeout
// ---------------------------------------------------------------------------

fn seq_missing_timeout_module(m: &Module, out: &mut Vec<Diagnostic>) {
    let span = m.span.as_ref();
    for sb in &m.seq_blocks {
        seq_timeout_stmts(&sb.statements, span, out);
    }
    for ib in &m.initial_blocks {
        seq_timeout_stmts(&ib.statements, span, out);
    }
}

fn seq_timeout_stmts(stmts: &[SeqStatement], span: Option<&Span>, out: &mut Vec<Diagnostic>) {
    for s in stmts {
        match s {
            SeqStatement::Await(AwaitExpr::Until { timeout: None, .. }) => {
                out.push(diag(
                    span,
                    "seq-missing-timeout",
                    Severity::Warning,
                    "await until(...) has no timeout; if the condition never holds the sequence stops for the rest of the run".to_string(),
                ));
            }
            SeqStatement::If { then_branch, else_branch, .. } => {
                seq_timeout_stmts(then_branch, span, out);
                if let Some(e) = else_branch {
                    seq_timeout_stmts(e, span, out);
                }
            }
            SeqStatement::For { body, .. } | SeqStatement::While { body, .. } => {
                seq_timeout_stmts(body, span, out)
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Name-use collection
// ---------------------------------------------------------------------------

fn collect_module_uses(m: &Module, out: &mut HashSet<String>) {
    for p in &m.ports {
        collect_type_uses(&p.ty, out);
    }
    for g in &m.generics {
        if let Some(d) = &g.default_value {
            collect_expr_uses(d, out);
        }
    }
    for s in &m.signals {
        collect_type_uses(&s.ty, out);
        if let Some(init) = &s.init_value {
            collect_expr_uses(init, out);
        }
    }
    for lb in &m.logic_blocks {
        match lb {
            LogicBlock::Comb(b) => {
                for st in &b.statements {
                    collect_stmt_uses(st, out);
                }
            }
            LogicBlock::Sync(b) => {
                out.insert(b.clock.signal.clone());
                if let Some(r) = &b.reset {
                    out.insert(r.signal.clone());
                }
                for st in &b.statements {
                    collect_stmt_uses(st, out);
                }
            }
        }
    }
    for inst in &m.instances {
        collect_instance_uses(inst, out);
    }
    for mem in &m.memories {
        collect_type_uses(&mem.element_type, out);
        if let Some(d) = &mem.depth_expr {
            collect_expr_uses(d, out);
        }
        if let Some(MemInit::Values(vals)) = &mem.init {
            for v in vals {
                collect_expr_uses(v, out);
            }
        }
    }
    for sb in &m.seq_blocks {
        for st in &sb.statements {
            collect_seq_uses(st, out);
        }
    }
    for ib in &m.initial_blocks {
        for st in &ib.statements {
            collect_seq_uses(st, out);
        }
    }
    for fsm in &m.fsm_blocks {
        collect_fsm_uses(fsm, out);
    }
    for cb in &m.constraints {
        for c in &cb.conditions {
            collect_expr_uses(c, out);
        }
    }
}

fn collect_instance_uses(inst: &Instance, out: &mut HashSet<String>) {
    out.insert(inst.module_name.clone());
    for (_g, e) in &inst.generic_args {
        collect_expr_uses(e, out);
    }
    for (_p, e) in &inst.port_connections {
        collect_expr_uses(e, out);
    }
}

fn collect_fsm_uses(fsm: &FsmBlock, out: &mut HashSet<String>) {
    out.insert(fsm.clock.signal.clone());
    if let Some(r) = &fsm.reset {
        out.insert(r.signal.clone());
    }
    for l in &fsm.locals {
        collect_type_uses(&l.ty, out);
        if let Some(init) = &l.init_value {
            collect_expr_uses(init, out);
        }
    }
    for st in &fsm.states {
        for (sig, e) in &st.moore_outputs {
            out.insert(sig.clone());
            collect_expr_uses(e, out);
        }
    }
    for tr in &fsm.transitions {
        for w in &tr.when_clauses {
            collect_expr_uses(&w.condition, out);
            for a in &w.actions {
                collect_fsm_action_uses(a, out);
            }
        }
    }
    for o in &fsm.outputs {
        out.insert(o.signal.clone());
        for (_state, e) in &o.mappings {
            collect_expr_uses(e, out);
        }
    }
}

fn collect_fsm_action_uses(a: &FsmAction, out: &mut HashSet<String>) {
    match a {
        FsmAction::If { condition, then_branch, else_branch } => {
            collect_expr_uses(condition, out);
            for x in then_branch {
                collect_fsm_action_uses(x, out);
            }
            if let Some(eb) = else_branch {
                for x in eb {
                    collect_fsm_action_uses(x, out);
                }
            }
        }
        FsmAction::Goto(_) => {}
        FsmAction::Assign { target, value } => {
            out.insert(target.clone());
            collect_expr_uses(value, out);
        }
    }
}

fn collect_stmt_uses(s: &Statement, out: &mut HashSet<String>) {
    match s {
        Statement::Assign { target, value } => {
            out.insert(target.clone());
            collect_expr_uses(value, out);
        }
        Statement::MemWrite { mem_name, addr, value } => {
            out.insert(mem_name.clone());
            collect_expr_uses(addr, out);
            collect_expr_uses(value, out);
        }
        Statement::If { condition, then_branch, else_branch } => {
            collect_expr_uses(condition, out);
            for st in then_branch {
                collect_stmt_uses(st, out);
            }
            if let Some(e) = else_branch {
                for st in e {
                    collect_stmt_uses(st, out);
                }
            }
        }
        Statement::Match { expr, arms } => {
            collect_expr_uses(expr, out);
            for a in arms {
                collect_pattern_uses(&a.pattern, out);
                for st in &a.body {
                    collect_stmt_uses(st, out);
                }
            }
        }
        Statement::For { range, body, .. } => {
            collect_expr_uses(&range.start, out);
            collect_expr_uses(&range.end, out);
            for st in body {
                collect_stmt_uses(st, out);
            }
        }
        Statement::While { condition, body } => {
            collect_expr_uses(condition, out);
            for st in body {
                collect_stmt_uses(st, out);
            }
        }
        Statement::LetLocal { ty, value, .. } => {
            if let Some(t) = ty {
                collect_type_uses(t, out);
            }
            if let Some(v) = value {
                collect_expr_uses(v, out);
            }
        }
        Statement::Assert(a) => collect_expr_uses(&a.condition, out),
        Statement::SysCall(e) => collect_expr_uses(e, out),
        Statement::SliceWrite { target, low, width, value } => {
            out.insert(target.clone());
            collect_expr_uses(low, out);
            collect_expr_uses(width, out);
            collect_expr_uses(value, out);
        }
        Statement::Cover(c) => collect_expr_uses(&c.condition, out),
        Statement::Break | Statement::Continue => {}
    }
}

fn collect_seq_uses(s: &SeqStatement, out: &mut HashSet<String>) {
    match s {
        SeqStatement::Await(a) => match a {
            AwaitExpr::ClockEdge { signal, .. } => {
                out.insert(signal.clone());
            }
            AwaitExpr::ClockCycles { signal, count } => {
                out.insert(signal.clone());
                collect_expr_uses(count, out);
            }
            AwaitExpr::Until { condition, .. } => collect_expr_uses(condition, out),
        },
        SeqStatement::Delay(_) => {}
        SeqStatement::SignalWrite { path, value } => {
            if let Some(first) = path.segments.first() {
                out.insert(first.clone());
            }
            collect_expr_uses(value, out);
        }
        SeqStatement::Assign { target, value } => {
            out.insert(target.clone());
            collect_expr_uses(value, out);
        }
        SeqStatement::If { condition, then_branch, else_branch } => {
            collect_expr_uses(condition, out);
            for st in then_branch {
                collect_seq_uses(st, out);
            }
            if let Some(e) = else_branch {
                for st in e {
                    collect_seq_uses(st, out);
                }
            }
        }
        SeqStatement::Assert(a) => collect_expr_uses(&a.condition, out),
        SeqStatement::MemWrite { mem_name, addr, value } => {
            out.insert(mem_name.clone());
            collect_expr_uses(addr, out);
            collect_expr_uses(value, out);
        }
        SeqStatement::For { range, body, .. } => {
            collect_expr_uses(&range.start, out);
            collect_expr_uses(&range.end, out);
            for st in body {
                collect_seq_uses(st, out);
            }
        }
        SeqStatement::While { condition, body } => {
            collect_expr_uses(condition, out);
            for st in body {
                collect_seq_uses(st, out);
            }
        }
        SeqStatement::SysCall(e) => collect_expr_uses(e, out),
        SeqStatement::Break | SeqStatement::Continue => {}
        SeqStatement::Cover(c) => collect_expr_uses(&c.condition, out),
    }
}

fn collect_expr_uses(e: &Expression, out: &mut HashSet<String>) {
    match e {
        Expression::Literal(_) => {}
        Expression::Ident(name) => {
            out.insert(name.clone());
        }
        Expression::BinOp { lhs, rhs, .. } => {
            collect_expr_uses(lhs, out);
            collect_expr_uses(rhs, out);
        }
        Expression::UnaryOp { expr, .. } => collect_expr_uses(expr, out),
        Expression::Index { base, index } => {
            collect_expr_uses(base, out);
            collect_expr_uses(index, out);
        }
        Expression::Slice { base, high, low } => {
            collect_expr_uses(base, out);
            collect_expr_uses(high, out);
            collect_expr_uses(low, out);
        }
        Expression::PartSelect { base, index, width, .. } => {
            collect_expr_uses(base, out);
            collect_expr_uses(index, out);
            collect_expr_uses(width, out);
        }
        Expression::SysFunc { args, .. } => {
            for a in args {
                if let iris_sim::parser::ast::SysFuncArg::Expr(x) = a {
                    collect_expr_uses(x, out);
                }
            }
        }
        Expression::MethodCall { receiver, args, .. } => {
            collect_expr_uses(receiver, out);
            for a in args {
                collect_expr_uses(a, out);
            }
        }
        Expression::If { condition, then_expr, else_expr } => {
            collect_expr_uses(condition, out);
            collect_expr_uses(then_expr, out);
            collect_expr_uses(else_expr, out);
        }
        Expression::Concat(xs) => {
            for x in xs {
                collect_expr_uses(x, out);
            }
        }
        Expression::Replicate { count, value } => {
            collect_expr_uses(count, out);
            for v in value {
                collect_expr_uses(v, out);
            }
        }
        Expression::MemRead { mem_name, addr } => {
            out.insert(mem_name.clone());
            collect_expr_uses(addr, out);
        }
        Expression::Call { name, args } => {
            out.insert(name.clone());
            for a in args {
                collect_expr_uses(a, out);
            }
        }
        Expression::Match { scrutinee, arms } => {
            collect_expr_uses(scrutinee, out);
            for a in arms {
                collect_pattern_uses(&a.pattern, out);
                collect_expr_uses(&a.value, out);
            }
        }
    }
}

fn collect_pattern_uses(p: &Pattern, out: &mut HashSet<String>) {
    match p {
        // `Enum::Variant` references the enum type.
        Pattern::Path { path, .. } => {
            if let Some(head) = path.split("::").next() {
                out.insert(head.to_string());
            }
        }
        Pattern::Ident(name) => {
            out.insert(name.clone());
        }
        _ => {}
    }
}

fn collect_type_uses(t: &Type, out: &mut HashSet<String>) {
    match t {
        Type::Named(name) => {
            out.insert(name.clone());
        }
        Type::Enum { name, .. } => {
            out.insert(name.clone());
        }
        Type::Array { element, .. } => collect_type_uses(element, out),
        Type::BitVecExpr { expr } => collect_expr_uses(expr, out),
        _ => {}
    }
}
