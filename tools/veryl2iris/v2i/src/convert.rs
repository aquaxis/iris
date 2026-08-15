//! Veryl to IRIS.
//!
//! Reads with `veryl-parser`, so no Veryl front end is written here.
//!
//! ## How expressions are carried
//!
//! Structure (modules, ports, blocks, statements) is walked node by node.
//! Expressions are not: they are collected as a token sequence with
//! [`TokenCollector`] and re-spelled.
//!
//! That is deliberate. Re-implementing a printer for every expression node
//! means every node the implementation forgets is a sub-expression that
//! vanishes without a word, which is the failure this whole tool exists to
//! avoid: `veryl translate` loses 26 of 27 assignments that way. Carrying the
//! tokens cannot drop a term, because every token is copied. What it cannot do
//! is re-associate or reformat, and it does not try.
//!
//! Only the spellings that genuinely differ are rewritten, and each one is
//! named in [`crate::spelling`].

use veryl_parser::resource_table;
use veryl_parser::token_collector::TokenCollector;
use veryl_parser::veryl_grammar_trait as vg;
use veryl_parser::veryl_token::{Token, VerylToken};
use veryl_parser::veryl_walker::VerylWalker;

use veryl2iris_mapping as mapping;
use veryl2iris_mapping::diag::{Diagnostic, Level, Position, Report};

/// The result of converting one file.
pub struct Converted {
    /// IRIS source. Empty when the report holds an error.
    pub source: String,
    pub report: Report,
}

pub fn convert(file: &str, source: &str) -> Result<Converted, String> {
    let parsed = veryl_parser::Parser::parse(source, &std::path::PathBuf::from(file))
        .map_err(|e| {
            let text = format!("{:?}", e);
            format!("{}: {}", file, text.lines().next().unwrap_or(&text))
        })?;

    let mut out = String::new();
    let mut report = Report::default();

    for item in &parsed.veryl.veryl_list {
        let group = &item.description_group;
        convert_description(file, group, &mut out, &mut report);
    }

    if report.failed() {
        return Ok(Converted { source: String::new(), report });
    }
    Ok(Converted { source: out, report })
}

fn text_of(token: &Token) -> String {
    resource_table::get_str_value(token.text).unwrap_or_default()
}

fn position_of(token: &VerylToken) -> Position {
    Position { line: token.token.line as usize, column: token.token.column as usize }
}

/// Tokens of any subtree, in source order.
fn tokens_of<F>(walk: F) -> Vec<Token>
where
    F: FnOnce(&mut TokenCollector),
{
    let mut collector = TokenCollector::new(false);
    walk(&mut collector);
    collector.tokens
}

fn convert_description(
    file: &str,
    group: &vg::DescriptionGroup,
    out: &mut String,
    report: &mut Report,
) {
    use vg::DescriptionGroupGroup as G;
    let inner = match &*group.description_group_group {
        G::DescriptionItem(x) => &*x.description_item,
        G::LBraceDescriptionGroupGroupListRBrace(_) => {
            report.push(unsupported(file, Position::default(), "generate block"));
            return;
        }
    };

    use vg::DescriptionItem as D;
    match inner {
        D::DescriptionItemOptPublicDescriptionItem(x) => {
            use vg::PublicDescriptionItem as P;
            match &*x.public_description_item {
                P::ModuleDeclaration(m) => {
                    match module_to_iris(file, &m.module_declaration) {
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
                P::AliasDeclaration(_) => {
                    report.push(unsupported(file, Position::default(), "alias"))
                }
                P::ProtoDeclaration(_) => report.push(Diagnostic::unimplemented(
                    file,
                    Position::default(),
                    "proto",
                    "how much it differs from IRIS' extern mod has not been measured",
                )),
                _ => report.push(Diagnostic::unimplemented(
                    file,
                    Position::default(),
                    "this top-level item",
                    "only module declarations are written so far",
                )),
            }
        }
        D::BindDeclaration(_) => report.push(unsupported(file, Position::default(), "bind")),
        D::EmbedDeclaration(_) => report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "embed",
            "IRIS' extern mod is close but not the same; the difference is unmeasured",
        )),
        D::IncludeDeclaration(_) => report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "include",
            "the converter could inline the file; it does not yet",
        )),
        D::ImportDeclaration(_) => report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "import",
            "IRIS has import; the converter does not write it yet",
        )),
    }
}

/// Refuse a construct IRIS cannot express. The entry must be in the table: a
/// refusal with no entry would be this tool inventing a language limit.
fn unsupported(file: &str, position: Position, veryl_construct: &str) -> Diagnostic {
    let entry = mapping::unsupported()
        .find(|m| m.veryl == veryl_construct)
        .or_else(|| mapping::unsupported().find(|m| m.veryl.starts_with(veryl_construct)))
        .expect("a language-level refusal must name an entry in the mapping table");
    Diagnostic::unsupported(file, position, entry, veryl_construct)
}

fn module_to_iris(file: &str, module: &vg::ModuleDeclaration) -> Result<(String, Report), Report> {
    let mut report = Report::default();
    let name = text_of(&module.identifier.identifier_token.token);

    if module.module_declaration_opt.is_some() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position_of(&module.identifier.identifier_token),
            "a generic module",
            "IRIS has generics; the converter does not write them yet",
        )));
    }

    let mut out = format!("mod {}(\n", name);
    if let Some(ports) = &module.module_declaration_opt2 {
        for line in ports_to_iris(file, &ports.port_declaration, &mut report)? {
            out.push_str(&format!("    {},\n", line));
        }
    }
    out.push_str(") {\n");

    let mut body = String::new();
    for item in &module.module_declaration_list {
        body.push_str(&group_to_iris(file, &item.module_group, &mut report)?);
    }
    out.push_str(&body);
    out.push_str("}\n");

    if report.failed() {
        return Err(report);
    }
    Ok((out, report))
}

fn one(diagnostic: Diagnostic) -> Report {
    let mut report = Report::default();
    report.push(diagnostic);
    report
}

fn ports_to_iris(
    file: &str,
    ports: &vg::PortDeclaration,
    report: &mut Report,
) -> Result<Vec<String>, Report> {
    let mut lines = Vec::new();
    let Some(list) = &ports.port_declaration_opt else {
        return Ok(lines);
    };
    let list = &list.port_declaration_list;

    let mut groups = vec![&*list.port_declaration_group];
    for extra in &list.port_declaration_list_list {
        groups.push(&extra.port_declaration_group);
    }

    for group in groups {
        use vg::PortDeclarationGroupGroup as G;
        let item = match &*group.port_declaration_group_group {
            G::PortDeclarationItem(x) => &*x.port_declaration_item,
            G::LBracePortDeclarationListRBrace(_) => {
                report.push(Diagnostic::unimplemented(
                    file,
                    Position::default(),
                    "a grouped port declaration",
                    "the converter reads a flat port list only",
                ));
                continue;
            }
        };
        lines.push(port_item_to_iris(file, item, report)?);
    }
    Ok(lines)
}

fn port_item_to_iris(
    file: &str,
    item: &vg::PortDeclarationItem,
    report: &mut Report,
) -> Result<String, Report> {
    let name = text_of(&item.identifier.identifier_token.token);
    let position = position_of(&item.identifier.identifier_token);

    use vg::PortDeclarationItemGroup as G;
    let concrete = match &*item.port_declaration_item_group {
        G::PortTypeConcrete(x) => &*x.port_type_concrete,
        // `interface_name.modport name` declares a port by view. IRIS has
        // views, but the direction of each signal lives in the view rather
        // than the port, and the two do not line up without measuring.
        G::PortTypeAbstract(_) => {
            return Err(one(Diagnostic::unimplemented(
                file,
                position,
                "an interface port",
                "IRIS declares directions inside the view; the correspondence is unmeasured",
            )))
        }
    };

    use vg::Direction as D;
    let direction = match &*concrete.direction {
        D::Input(_) => "in",
        D::Output(_) => "out",
        D::Inout(_) => "inout",
        D::Modport(_) | D::Import(_) => {
            return Err(one(Diagnostic::unimplemented(
                file,
                position,
                "a modport or import port direction",
                "IRIS' view has no direct counterpart for these",
            )))
        }
    };

    let ty = array_type_to_iris(file, &concrete.array_type, position, report)?;
    let _ = report;
    Ok(format!("{} {}: {}", direction, name, ty))
}

/// A Veryl type as IRIS spells it. An array is refused here: only a `var`
/// declaration can carry one, as an IRIS `mem`.
fn array_type_to_iris(
    file: &str,
    ty: &vg::ArrayType,
    position: Position,
    report: &mut Report,
) -> Result<String, Report> {
    if ty.array_type_opt.is_some() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "an array in this position",
            "IRIS carries an array as a mem declaration, which only a var can be",
        )));
    }
    scalar_type_to_iris(file, &ty.scalar_type, position, report)
}

/// The element type and depth of an array, when the type is one.
fn array_parts(
    file: &str,
    ty: &vg::ArrayType,
    position: Position,
    report: &mut Report,
) -> Result<Option<(String, String)>, Report> {
    let Some(opt) = &ty.array_type_opt else {
        return Ok(None);
    };
    let array = &opt.array;
    // A single dimension only. IRIS' mem is one-dimensional, and folding two
    // Veryl dimensions into one would change what an index means.
    if !array.array_list.is_empty() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "a multi-dimensional array",
            "an IRIS mem has one dimension; folding two would change what an index means",
        )));
    }
    let element = scalar_type_to_iris(file, &ty.scalar_type, position, report)?;
    let depth = spell(&tokens_of(|c| c.expression(&array.expression)));
    Ok(Some((element, depth)))
}

fn scalar_type_to_iris(
    file: &str,
    ty: &vg::ScalarType,
    position: Position,
    report: &mut Report,
) -> Result<String, Report> {
    // `signed` turns a vector into IRIS' int[N]; `tri` has no counterpart.
    let mut signed = false;
    for modifier in &ty.scalar_type_list {
        use vg::TypeModifier as M;
        match &*modifier.type_modifier {
            M::Signed(_) => signed = true,
            M::Tri(_) => return Err(one(unsupported(file, position, "tri"))),
            M::Defaul(_) => {}
        }
    }

    let tokens = tokens_of(|c| c.scalar_type(ty));
    let words: Vec<String> = tokens
        .iter()
        .map(text_of)
        .filter(|t| t != "signed" && t != "tri" && t != "default")
        .collect();
    let spelled = words.join("");

    // Width, when the type carries one: `logic<8>` and `u8` both mean eight.
    let base = words.first().cloned().unwrap_or_default();
    let width = width_of(&spelled);

    Ok(match base.as_str() {
        "logic" | "bit" => match width {
            Some(w) if signed => format!("int[{}]", w),
            Some(w) => format!("bit[{}]", w),
            None if signed => "int[1]".to_string(),
            None => "bit".to_string(),
        },
        "clock" => "clock".to_string(),
        "clock_posedge" => "clock".to_string(),
        "reset" => "reset".to_string(),
        "reset_async_low" | "reset_sync_low" => "reset(active_low: true)".to_string(),
        "reset_async_high" | "reset_sync_high" => "reset".to_string(),
        "string" => "string".to_string(),
        "u8" => "uint[8]".to_string(),
        "u16" => "uint[16]".to_string(),
        "u32" => "uint[32]".to_string(),
        "u64" => "uint[64]".to_string(),
        "i8" => "int[8]".to_string(),
        "i16" => "int[16]".to_string(),
        "i32" => "int[32]".to_string(),
        "i64" => "int[64]".to_string(),
        "f32" | "f64" => return Err(one(unsupported(file, position, "f32 / f64"))),
        "p8" | "p16" | "p32" | "p64" => {
            return Err(one(unsupported(file, position, "p8 .. p64")))
        }
        "bbool" | "lbool" => {
            report.push(lossy(file, position, "bbool / lbool", "bool"));
            "bool".to_string()
        }
        "clock_negedge" => {
            report.push(Diagnostic {
                level: Level::Warning,
                file: file.to_string(),
                position,
                message: "a negedge clock keeps its edge on the sync block in IRIS".to_string(),
                note: Some("written as clock; the edge appears in sync(clk.negedge)".to_string()),
            });
            "clock".to_string()
        }
        // A user-defined type name passes through. IRIS reports an undeclared
        // one as O1008, so it does not vanish silently on the far side.
        _ => base,
    })
}

fn lossy(file: &str, position: Position, veryl: &str, _iris: &str) -> Diagnostic {
    let entry = mapping::lossy()
        .find(|m| m.veryl == veryl)
        .expect("a lossy conversion must name an entry in the mapping table");
    Diagnostic::lossy(file, position, entry, veryl)
}

/// The width inside `<...>`, when there is one.
fn width_of(spelled: &str) -> Option<usize> {
    let start = spelled.find('<')?;
    let end = spelled.find('>')?;
    spelled.get(start + 1..end)?.parse().ok()
}

fn group_to_iris(
    file: &str,
    group: &vg::ModuleGroup,
    report: &mut Report,
) -> Result<String, Report> {
    use vg::ModuleGroupGroup as G;
    match &*group.module_group_group {
        G::ModuleItem(x) => item_to_iris(file, &x.module_item.generate_item, report),
        G::LBraceModuleGroupGroupListRBrace(_) => Err(one(unsupported(
            file,
            Position::default(),
            "generate block",
        ))),
    }
}

fn item_to_iris(
    file: &str,
    item: &vg::GenerateItem,
    report: &mut Report,
) -> Result<String, Report> {
    use vg::GenerateItem as I;
    Ok(match item {
        I::VarDeclaration(x) => var_to_iris(file, &x.var_declaration, report)?,
        I::AlwaysCombDeclaration(x) => {
            let body = block_to_iris(file, &x.always_comb_declaration.statement_block, 2, report)?;
            format!("    comb {{\n{}    }}\n", body)
        }
        I::AlwaysFfDeclaration(x) => always_ff_to_iris(file, &x.always_ff_declaration, report)?,
        I::InstDeclaration(x) => {
            inst_to_iris(file, &x.inst_declaration.component_instantiation, report)?
        }
        // Constructs IRIS cannot express. Named, never dropped.
        I::BindDeclaration(_) => return Err(one(unsupported(file, Position::default(), "bind"))),
        I::ConnectDeclaration(_) => {
            return Err(one(unsupported(file, Position::default(), "connect")))
        }
        I::GenerateIfDeclaration(_) => {
            return Err(one(unsupported(file, Position::default(), "generate if")))
        }
        I::GenerateBlockDeclaration(_) => {
            return Err(one(unsupported(file, Position::default(), "generate block")))
        }
        I::AliasDeclaration(_) => return Err(one(unsupported(file, Position::default(), "alias"))),
        I::FinalDeclaration(_) => return Err(one(unsupported(file, Position::default(), "final"))),
        I::UnsafeBlock(_) => return Err(one(unsupported(file, Position::default(), "unsafe"))),
        // Everything else is expressible but unwritten.
        other => {
            return Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                item_kind(other),
                "IRIS can express it; the converter does not write it yet",
            )))
        }
    })
}

fn item_kind(item: &vg::GenerateItem) -> &'static str {
    use vg::GenerateItem as I;
    match item {
        I::LetDeclaration(_) => "a let declaration",
        I::InstDeclaration(_) => "an instance",
        I::ConstDeclaration(_) => "a const declaration",
        I::GenDeclaration(_) => "a gen declaration",
        I::AssignDeclaration(_) => "an assign declaration",
        I::FunctionDeclaration(_) => "a function",
        I::GenerateForDeclaration(_) => "a generate for",
        I::TypeDefDeclaration(_) => "a type definition",
        I::EnumDeclaration(_) => "an enum",
        I::StructUnionDeclaration(_) => "a struct or union",
        I::ImportDeclaration(_) => "an import",
        I::InitialDeclaration(_) => "an initial block",
        I::EmbedDeclaration(_) => "an embed",
        _ => "this construct",
    }
}

/// A Veryl instantiation as an IRIS one.
fn inst_to_iris(
    file: &str,
    inst: &vg::ComponentInstantiation,
    report: &mut Report,
) -> Result<String, Report> {
    let name = text_of(&inst.identifier.identifier_token.token);
    let position = position_of(&inst.identifier.identifier_token);
    let module = spell(&tokens_of(|c| c.scoped_identifier(&inst.scoped_identifier)));

    if inst.component_instantiation_opt.is_some() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "a clock domain on an instance",
            "IRIS has no clock domain annotation",
        )));
    }
    if inst.component_instantiation_opt0.is_some() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "an instance array",
            "IRIS has inst u[N]; the converter does not write it yet",
        )));
    }
    if inst.component_instantiation_opt1.is_some() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "instance parameters",
            "IRIS has generic arguments; the converter does not write them yet",
        )));
    }

    let mut ports = Vec::new();
    if let Some(port_opt) = &inst.component_instantiation_opt2 {
        if let Some(list) = &port_opt.inst_port.inst_port_opt {
            let list = &list.inst_port_list;
            let mut groups = vec![&*list.inst_port_group];
            for extra in &list.inst_port_list_list {
                groups.push(&extra.inst_port_group);
            }
            for group in groups {
                use vg::InstPortGroupGroup as G;
                let item = match &*group.inst_port_group_group {
                    G::InstPortItem(x) => &*x.inst_port_item,
                    G::LBraceInstPortListRBrace(_) => {
                        return Err(one(Diagnostic::unimplemented(
                            file,
                            position,
                            "a grouped port connection",
                            "the converter reads a flat connection list only",
                        )))
                    }
                };
                let port = text_of(&item.identifier.identifier_token.token);
                // `.port` on its own means the port takes a signal of the same
                // name; IRIS always writes both sides.
                let value = match &item.inst_port_item_opt {
                    Some(v) => expression(file, &v.expression, position)?,
                    None => port.clone(),
                };
                ports.push(format!("{}: {}", port, value));
            }
        }
    }

    let _ = report;
    Ok(format!(
        "    inst {} = {} {{ {} }};\n",
        name,
        module,
        ports.join(", ")
    ))
}

fn var_to_iris(
    file: &str,
    var: &vg::VarDeclaration,
    report: &mut Report,
) -> Result<String, Report> {
    let name = text_of(&var.identifier.identifier_token.token);
    let position = position_of(&var.identifier.identifier_token);
    let Some(opt) = &var.var_declaration_opt else {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "a var with no type",
            "IRIS needs a declared type here",
        )));
    };
    // An array declaration is a memory in IRIS, and memories are declared
    // with `mem` rather than `var`.
    if let Some((element, depth)) = array_parts(file, &opt.array_type, position, report)? {
        return Ok(format!("    mem {}: {}[{}];\n", name, element, depth));
    }

    let ty = array_type_to_iris(file, &opt.array_type, position, report)?;
    // IRIS wants an initial value; Veryl puts the reset value in always_ff.
    // Zero is the value IRIS itself uses when a reset branch is absent.
    Ok(format!("    var {}: {} = 0;\n", name, ty))
}

fn always_ff_to_iris(
    file: &str,
    block: &vg::AlwaysFfDeclaration,
    report: &mut Report,
) -> Result<String, Report> {
    let mut head = String::new();
    if let Some(opt) = &block.always_ff_declaration_opt {
        let list = &opt.always_ff_event_list;
        let clock = text_of(
            &tokens_of(|c| c.always_ff_clock(&list.always_ff_clock))
                .into_iter()
                .next()
                .expect("a clock names a signal"),
        );
        head.push_str(&format!("{}.posedge", clock));
        if let Some(reset_opt) = &list.always_ff_event_list_opt {
            let reset = text_of(
                &tokens_of(|c| c.always_ff_reset(&reset_opt.always_ff_reset))
                    .into_iter()
                    .next()
                    .expect("a reset names a signal"),
            );
            head.push_str(&format!(", {}.async", reset));
        }
    } else {
        return Err(one(Diagnostic::unimplemented(
            file,
            Position::default(),
            "an always_ff with no clock",
            "IRIS names the clock on the sync block",
        )));
    }

    let body = block_to_iris(file, &block.statement_block, 2, report)?;
    Ok(format!("    sync({}) {{\n{}    }}\n", head, body))
}

fn block_to_iris(
    file: &str,
    block: &vg::StatementBlock,
    depth: usize,
    report: &mut Report,
) -> Result<String, Report> {
    let mut out = String::new();
    for group in &block.statement_block_list {
        use vg::StatementBlockGroupGroup as G;
        match &*group.statement_block_group.statement_block_group_group {
            G::StatementBlockItem(x) => {
                out.push_str(&block_item_to_iris(file, &x.statement_block_item, depth, report)?)
            }
            G::BlockLBraceStatementBlockGroupGroupListRBrace(_) => {
                return Err(one(Diagnostic::unimplemented(
                    file,
                    Position::default(),
                    "a named block",
                    "IRIS has no named statement block",
                )))
            }
        }
    }
    Ok(out)
}

fn block_item_to_iris(
    file: &str,
    item: &vg::StatementBlockItem,
    depth: usize,
    report: &mut Report,
) -> Result<String, Report> {
    use vg::StatementBlockItem as I;
    match item {
        I::Statement(x) => statement_to_iris(file, &x.statement, depth, report),
        other => {
            let _ = other;
            Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                "a declaration inside a block",
                "the converter writes statements only",
            )))
        }
    }
}

fn statement_to_iris(
    file: &str,
    stmt: &vg::Statement,
    depth: usize,
    report: &mut Report,
) -> Result<String, Report> {
    let pad = "    ".repeat(depth);
    use vg::Statement as S;
    Ok(match stmt {
        S::IdentifierStatement(x) => {
            let s = &x.identifier_statement;
            let target = spell(&tokens_of(|c| c.expression_identifier(&s.expression_identifier)));
            use vg::IdentifierStatementGroup as G;
            match &*s.identifier_statement_group {
                G::Assignment(a) => {
                    let assignment = &a.assignment;
                    // A compound assignment such as `a += b` expands, which
                    // changes the shape of the statement.
                    // The operator is the first token of the assignment.
                    let operator = tokens_of(|c| c.assignment(assignment))
                        .first()
                        .map(text_of)
                        .unwrap_or_else(|| "=".to_string());
                    let value = expression(file, &assignment.expression, Position::default())?;
                    if operator == "=" {
                        format!("{}{} = {};\n", pad, target, value)
                    } else {
                        let op = operator.trim_end_matches('=');
                        report.push(lossy(
                            file,
                            Position::default(),
                            "+= -= *= and the other compound assignments",
                            "a = a + b",
                        ));
                        format!("{}{} = {} {} ({});\n", pad, target, target, op, value)
                    }
                }
                G::FunctionCall(_) => {
                    return Err(one(Diagnostic::unimplemented(
                        file,
                        Position::default(),
                        "a function call statement",
                        "IRIS has functions; the converter does not write the call yet",
                    )))
                }
            }
        }
        S::IfStatement(x) => {
            let s = &x.if_statement;
            // The condition of an if *statement* is an ordinary expression;
            // it is the if *expression* that reshapes.
            let condition = expression(file, &s.expression, Position::default())?;
            let mut out = format!("{}if {} {{\n", pad, condition);
            out.push_str(&block_to_iris(file, &s.statement_block, depth + 1, report)?);
            out.push_str(&format!("{}}}", pad));
            for branch in &s.if_statement_list {
                let cond = expression(file, &branch.expression, Position::default())?;
                out.push_str(&format!(" else if {} {{\n", cond));
                out.push_str(&block_to_iris(file, &branch.statement_block, depth + 1, report)?);
                out.push_str(&format!("{}}}", pad));
            }
            if let Some(last) = &s.if_statement_opt {
                out.push_str(" else {\n");
                out.push_str(&block_to_iris(file, &last.statement_block, depth + 1, report)?);
                out.push_str(&format!("{}}}", pad));
            }
            out.push('\n');
            out
        }
        S::CaseStatement(_) => {
            return Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                "a case statement",
                "IRIS has match; the arm shapes are not written yet",
            )))
        }
        S::IfResetStatement(_) => {
            return Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                "if_reset",
                "IRIS puts the reset value on the declaration; the mapping is unwritten",
            )))
        }
        other => {
            let _ = other;
            return Err(one(Diagnostic::unimplemented(
                file,
                Position::default(),
                "this statement",
                "only assignment and if are written so far",
            )));
        }
    })
}

/// Constructs whose *shape* differs between the two languages, not merely
/// their spelling.
///
/// Carrying tokens works only where both languages build the expression the
/// same way. A Veryl `case` expression is `case x { 1: a, default: b }` and
/// the IRIS one is `match x { 1 => a, _ => b }`: same meaning, different
/// shape. Copying the tokens produces something that is not IRIS at all.
///
/// This was found by converting `alu.veryl`, whose output the IRIS parser
/// rejected at the `case`. Until then the converter reported success and
/// emitted it, which is the failure this tool exists to avoid.
/// `repeat` was added after `{i_v[11] repeat 20, i_v}` came out of this
/// converter unchanged, was reported as a success, and was then rejected by
/// the IRIS parser. IRIS writes the same thing as `{{20{i_v[11]}}, i_v}`.
const SHAPE_DIFFERS: &[&str] = &[
    "case", "switch", "if", "inside", "outside", "msb", "lsb", "repeat",
];

/// Whether a token sequence holds a construct that cannot simply be re-spelled.
fn reshapes(tokens: &[Token]) -> Option<String> {
    tokens
        .iter()
        .map(text_of)
        .find(|t| SHAPE_DIFFERS.contains(&t.as_str()))
}

/// Convert an expression.
///
/// Fast path: an expression with no shape difference is carried as tokens,
/// which cannot lose a term. Otherwise the tree is taken apart and the
/// differing construct is rebuilt in IRIS' shape.
fn expression(file: &str, expr: &vg::Expression, position: Position) -> Result<String, Report> {
    let tokens = tokens_of(|c| c.expression(expr));
    if reshapes(&tokens).is_none() {
        return Ok(spell(&tokens));
    }

    // `if c ? x : y` becomes `if c { x } else { y }`.
    if !expr.if_expression.if_expression_list.is_empty() {
        return if_expression(file, &expr.if_expression, position);
    }

    // `case x { 1: a, default: b }` becomes `match x { 1 => a, _ => b, }`.
    if let Some(vg::Factor::CaseExpression(c)) = sole_factor(&expr.if_expression.expression01) {
        return case_expression(file, &c.case_expression, position);
    }

    // `{a repeat n, b}` becomes `{{n{a}}, b}`.
    if let Some(vg::Factor::LBraceConcatenationListRBrace(c)) =
        sole_factor(&expr.if_expression.expression01)
    {
        return concatenation(file, &c.concatenation_list, position);
    }

    let construct = reshapes(&tokens).unwrap_or_else(|| "this construct".to_string());
    Err(one(Diagnostic::unimplemented(
        file,
        position,
        &format!("`{}` nested inside a larger expression", construct),
        "IRIS builds it differently, and only a whole expression is rebuilt so far",
    )))
}

/// The single factor an expression reduces to, when it has no operators at any
/// level. `case x { .. }` is one; `a + case x { .. }` is not.
fn sole_factor(chain: &vg::Expression01) -> Option<&vg::Factor> {
    if !chain.expression01_list.is_empty() {
        return None;
    }
    let level2 = &chain.expression02;
    if !level2.expression02_list.is_empty() || level2.expression02_opt.is_some() {
        return None;
    }
    Some(&level2.factor)
}

/// `if c ? x : y` in Veryl, `if c { x } else { y }` in IRIS.
fn if_expression(
    file: &str,
    expr: &vg::IfExpression,
    position: Position,
) -> Result<String, Report> {
    let mut out = String::new();
    for branch in &expr.if_expression_list {
        let condition = expression(file, &branch.expression, position)?;
        let value = expression(file, &branch.expression0, position)?;
        out.push_str(&format!("if {} {{ {} }} else ", condition, value));
    }
    // The tail is the final else, and it sits one level down the chain.
    let tail = spell(&tokens_of(|c| c.expression01(&expr.expression01)));
    if let Some(construct) = reshapes(&tokens_of(|c| c.expression01(&expr.expression01))) {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            &format!("`{}` in the else of a conditional", construct),
            "only the branches of a conditional are rebuilt so far",
        )));
    }
    out.push_str(&format!("{{ {} }}", tail));
    Ok(out)
}

/// `case x { c: e, default: e }` in Veryl, `match x { c => e, _ => e, }` in IRIS.
fn case_expression(
    file: &str,
    expr: &vg::CaseExpression,
    position: Position,
) -> Result<String, Report> {
    let subject = expression(file, &expr.expression, position)?;
    let mut arms = Vec::new();

    arms.push(case_arm(file, &expr.case_condition, &expr.expression0, position)?);
    for arm in &expr.case_expression_list {
        arms.push(case_arm(file, &arm.case_condition, &arm.expression, position)?);
    }

    let default = expression(file, &expr.expression1, position)?;
    arms.push(format!("_ => {}", default));

    Ok(format!("match {} {{ {}, }}", subject, arms.join(", ")))
}

/// `{a repeat n, b}` in Veryl, `{{n{a}}, b}` in IRIS.
///
/// Both languages repeat a value inside a concatenation; only the notation
/// differs. This is where a sign extension lands coming the other way, since
/// `x.sign_extend[32]()` is written out as a repeated sign bit.
fn concatenation(
    file: &str,
    list: &vg::ConcatenationList,
    position: Position,
) -> Result<String, Report> {
    let mut items = vec![concatenation_item(file, &list.concatenation_item, position)?];
    for rest in &list.concatenation_list_list {
        items.push(concatenation_item(file, &rest.concatenation_item, position)?);
    }
    Ok(format!("{{{}}}", items.join(", ")))
}

fn concatenation_item(
    file: &str,
    item: &vg::ConcatenationItem,
    position: Position,
) -> Result<String, Report> {
    let value = expression(file, &item.expression, position)?;
    match &item.concatenation_item_opt {
        None => Ok(value),
        Some(repeat) => {
            let count = expression(file, &repeat.expression, position)?;
            Ok(format!("{{{}{{{}}}}}", count, value))
        }
    }
}

fn case_arm(
    file: &str,
    condition: &vg::CaseCondition,
    value: &vg::Expression,
    position: Position,
) -> Result<String, Report> {
    // An IRIS match arm carries one pattern. A Veryl arm may list several.
    if !condition.case_condition_list.is_empty() {
        return Err(one(Diagnostic::unimplemented(
            file,
            position,
            "a case arm listing several values",
            "an IRIS match arm takes one pattern; the arm would have to be split",
        )));
    }
    let pattern = spell(&tokens_of(|c| c.range_item(&condition.range_item)));
    // A range as a pattern has no IRIS counterpart at all.
    if pattern.contains("..") {
        return Err(one(unsupported(file, position, "range pattern")));
    }
    let value = expression(file, value, position)?;
    Ok(format!("{} => {}", pattern, value))
}

/// Re-spell a token sequence as IRIS.
///
/// Only the spellings that differ are touched, and each is listed here so the
/// set can be read at a glance rather than hunted through the walk.
fn spell(tokens: &[Token]) -> String {
    let mut out = String::new();
    for (i, token) in tokens.iter().enumerate() {
        let text = text_of(token);
        let mapped = crate::spelling::to_iris(&text);
        if i > 0 && needs_space(&out, mapped) {
            out.push(' ');
        }
        out.push_str(mapped);
    }
    out
}

fn needs_space(so_far: &str, next: &str) -> bool {
    let last = so_far.chars().last().unwrap_or(' ');
    let first = next.chars().next().unwrap_or(' ');
    let tight = |c: char| "([{.".contains(c);
    let tight_after = |c: char| ")]}.,;:".contains(c);
    !(tight(last) || tight_after(first))
}
