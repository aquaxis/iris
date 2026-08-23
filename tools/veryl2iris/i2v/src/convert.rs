//! IRIS to Veryl.
//!
//! Reads with `iris-sim`'s parser, so no IRIS front end is written here.
//! Every decision about what may be converted comes from [`crate::mapping`];
//! this module only knows how to write the result out.

use iris_sim::parser::{
    BinOp, ClockEdge, CombBlock, EnumDecl, Expression, FnDecl, Interface, Literal, LogicBlock,
    Module, Port, PortDirection, Signal, Statement, StructDecl, SyncBlock, Type, UnaryOp,
    ViewDirection,
};

use iris_sim::project::Project;
use std::collections::HashMap;

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
    /// Every module the input files declare, so an instance's ports can be
    /// looked up. Converting one file at a time cannot see them.
    modules: &'a HashMap<String, Module>,
    /// For each instance, the variable each output port was wired to.
    ///
    /// IRIS reads `dec.rd` straight out of an instance. Veryl has no such
    /// expression: an output is wired to a variable at the instantiation and
    /// that variable is read.
    wires: HashMap<String, HashMap<String, String>>,
    /// The enumerations and structures the file declares. IRIS puts them at
    /// the top of the file; Veryl puts them inside a module, an interface or
    /// a package, so they are written into the module here.
    types: &'a FileTypes,
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

/// The named types one file declares.
#[derive(Default)]
pub struct FileTypes {
    enums: Vec<EnumDecl>,
    structs: Vec<StructDecl>,
    type_aliases: Vec<(String, Type)>,
}

impl FileTypes {
    fn is_empty(&self) -> bool {
        self.enums.is_empty() && self.structs.is_empty() && self.type_aliases.is_empty()
    }

    fn declares(&self, name: &str) -> bool {
        self.enums.iter().any(|e| e.name == name)
            || self.structs.iter().any(|s| s.name == name)
            || self.type_aliases.iter().any(|(n, _)| n == name)
    }
}

/// Convert every module in an IRIS source text to Veryl.
pub fn convert(file: &str, source: &str) -> Result<Converted, String> {
    convert_project(&[(file.to_string(), source.to_string())])
}

/// Convert several files that belong together.
///
/// **A module's ports are only knowable across files.** `riscv_core.iris`
/// reads `dec.rd`, and what `rd` is comes from `decoder.iris`. Converting one
/// file at a time cannot answer that, so the whole set is parsed first and the
/// modules are gathered before anything is written out.
pub fn convert_project(files: &[(String, String)]) -> Result<Converted, String> {
    let parser = iris_sim::parser::Parser::new();

    let mut parsed_files = Vec::new();
    let mut modules: HashMap<String, Module> = HashMap::new();
    for (file, source) in files {
        let parsed = parser
            .parse_all(source)
            .map_err(|e| format!("{}: {}", file, e))?;
        for module in &parsed.modules {
            modules.insert(module.name.clone(), module.clone());
        }
        parsed_files.push((file.clone(), parsed));
    }

    let mut out = String::new();
    let mut report = Report::default();

    for (file, parsed) in &parsed_files {
        let types = FileTypes {
            enums: parsed.enums.clone(),
            structs: parsed.structs.clone(),
            type_aliases: parsed.type_aliases.clone(),
        };
        convert_one(file, parsed, &modules, &types, &mut out, &mut report);
    }

    if report.failed() {
        return Ok(Converted { source: String::new(), report });
    }
    Ok(Converted { source: out, report })
}

/// An IRIS import as a Veryl one.
///
/// `(path, [])` is `import path;` and `(path, [a, b])` is `import path::{a, b};`.
/// The forms match Veryl's own, so the result reads back as the same import.
fn import_to_veryl(path: &str, names: &[String]) -> String {
    if names.is_empty() {
        format!("import {};\n", path)
    } else {
        format!("import {}::{{{}}};\n", path, names.join(", "))
    }
}

/// A module with nothing in it, to stand in as context for a function.
///
/// A function is not inside a module, but the writers ask their context for
/// widths. A pure function's expressions never reach for one, so an empty
/// module is enough; anything that did would come back with no width and be
/// refused, not guessed.
fn empty_module(name: &str) -> Module {
    Module {
        name: name.to_string(),
        is_public: false,
        is_extern: false,
        generics: Vec::new(),
        where_constraints: Vec::new(),
        ports: Vec::new(),
        signals: Vec::new(),
        logic_blocks: Vec::new(),
        instances: Vec::new(),
        span: None,
        is_test: false,
        seq_blocks: Vec::new(),
        initial_blocks: Vec::new(),
        fsm_blocks: Vec::new(),
        memories: Vec::new(),
        constraints: Vec::new(),
    }
}

/// An IRIS function as a Veryl one.
///
/// IRIS parameters carry no direction; Veryl wants one, and a value passed in
/// is an `input`. The bindings and the returned expression are written with
/// the same writers the module body uses.
fn function_to_veryl(
    file: &str,
    func: &FnDecl,
    modules: &HashMap<String, Module>,
    types: &FileTypes,
) -> Result<String, Report> {
    let placeholder = empty_module(&func.name);
    let ctx = Ctx {
        file,
        module: &placeholder,
        modules,
        wires: HashMap::new(),
        types,
        project: Project::new(),
    };
    let mut report = Report::default();

    let mut params = Vec::new();
    for (name, ty) in &func.params {
        let rendered = type_to_veryl(&ctx, ty, &mut report)?;
        params.push(format!("{}: input {}", name, rendered));
    }

    let mut out = format!("function {} ({})", func.name, params.join(", "));
    if let Some(ret) = &func.return_type {
        let rendered = type_to_veryl(&ctx, ret, &mut report)?;
        out.push_str(&format!(" -> {}", rendered));
    }
    out.push_str(" {\n");

    for (name, value) in &func.bindings {
        let rendered = expr_to_veryl(&ctx, value, &mut report)?;
        out.push_str(&format!("    let {} = {};\n", name, rendered));
    }
    let body = expr_to_veryl(&ctx, &func.body, &mut report)?;
    out.push_str(&format!("    return {};\n", body));
    out.push_str("}\n");

    if report.failed() {
        return Err(report);
    }
    Ok(out)
}

/// An IRIS interface as a Veryl one.
///
/// IRIS signals become Veryl `var`s and each view becomes a `modport`, the
/// grouped directions spread back out to one per signal.
fn interface_to_veryl(
    file: &str,
    iface: &Interface,
    modules: &HashMap<String, Module>,
    types: &FileTypes,
) -> Result<String, Report> {
    let placeholder = empty_module(&iface.name);
    let ctx = Ctx {
        file,
        module: &placeholder,
        modules,
        wires: HashMap::new(),
        types,
        project: Project::new(),
    };
    let mut report = Report::default();

    if !iface.generics.is_empty() {
        report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "a generic interface",
            "the converter does not write interface generics yet",
        ));
    }
    if iface.extends.is_some() {
        report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "an interface that extends another",
            "Veryl has no interface extension",
        ));
    }

    let mut out = format!("interface {} {{\n", iface.name);
    for signal in &iface.signals {
        let ty = type_to_veryl(&ctx, &signal.ty, &mut report)?;
        out.push_str(&format!("    var {}: {};\n", signal.name, ty));
    }
    for view in &iface.views {
        out.push_str(&format!("    modport {} {{\n", view.name));
        for item in &view.signals {
            let direction = match item.direction {
                ViewDirection::In => "input",
                ViewDirection::Out => "output",
                ViewDirection::InOut => "inout",
            };
            out.push_str(&format!("        {}: {},\n", item.name, direction));
        }
        out.push_str("    }\n");
    }
    out.push_str("}\n");

    if report.failed() {
        return Err(report);
    }
    Ok(out)
}

fn convert_one(
    file: &str,
    parsed: &iris_sim::parser::ParseResult,
    modules: &HashMap<String, Module>,
    types: &FileTypes,
    out: &mut String,
    report: &mut Report,
) {
    // Imports sit at the top of the file in both languages. IRIS keeps the
    // package path and the names taken from it; Veryl writes the same, save
    // that `::*` is not represented distinctly here, so a name-less import is
    // written as a bare path rather than a star.
    if !parsed.imports.is_empty() {
        if !out.is_empty() {
            out.push('\n');
        }
        for (path, names) in &parsed.imports {
            out.push_str(&import_to_veryl(path, names));
        }
    }

    // A function is a file-level item in both languages, and it does not need
    // a module around it. It is written before the modules so it is in scope
    // for them, as IRIS reads it.
    for func in &parsed.functions {
        match function_to_veryl(file, func, modules, types) {
            Ok(text) => {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&text);
            }
            Err(sub) => report.extend(sub),
        }
    }

    // An interface is a file-level item in both languages. Its signals become
    // Veryl `var`s and its views become `modport`s.
    for iface in &parsed.interfaces {
        match interface_to_veryl(file, iface, modules, types) {
            Ok(text) => {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&text);
            }
            Err(sub) => report.extend(sub),
        }
    }

    // IRIS declares an enumeration once for the whole file; Veryl declares it
    // inside one module. Writing it into two modules would make two types
    // that only look alike, so a file that declares one and holds several
    // designs is refused rather than duplicated.
    let designs = parsed.modules.iter().filter(|m| !m.is_test).count();
    if !types.is_empty() && designs > 1 {
        report.push(Diagnostic::unimplemented(
            file,
            Position::default(),
            "a file that declares a named type and holds more than one module",
            "Veryl would put the type in a package; writing it into each module \
             would make several types that only look alike",
        ));
        return;
    }

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
        match module_to_veryl(file, module, modules, types) {
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
}

fn module_to_veryl(
    file: &str,
    module: &Module,
    modules: &HashMap<String, Module>,
    types: &FileTypes,
) -> Result<(String, Report), Report> {
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

    let wires = wires_for_instances(module, modules);
    let ctx = Ctx { file, module, modules, types, wires, project: Project::new() };

    out.push_str(&format!("module {}", module.name));
    out.push_str(&generics_to_veryl(&ctx, &mut report)?);
    out.push_str(" (\n");
    for (i, port) in module.ports.iter().enumerate() {
        let comma = if i + 1 == module.ports.len() { "," } else { "," };
        out.push_str(&format!("    {}{}\n", port_to_veryl(&ctx, port, &mut report)?, comma));
    }
    out.push_str(") {\n");

    out.push_str(&named_types_to_veryl(&ctx, &mut report)?);

    for signal in &module.signals {
        out.push_str(&format!("    {}\n", signal_to_veryl(&ctx, signal, &mut report)?));
    }
    for mem in &module.memories {
        out.push_str(&format!("    {}\n", mem_to_veryl(&ctx, mem, &mut report)?));
    }
    // The variables that stand in for the instances' outputs, declared before
    // the instances so that one instance may be wired to another's output.
    for line in wire_declarations(&ctx, &mut report)? {
        out.push_str(&format!("    {}\n", line));
    }
    if !module.signals.is_empty() || !module.memories.is_empty() || !ctx.wires.is_empty() {
        out.push('\n');
    }

    for inst in &module.instances {
        out.push_str(&inst_to_veryl(&ctx, inst, &mut report)?);
    }
    if !module.instances.is_empty() {
        out.push('\n');
    }

    out.push_str(&initial_to_veryl(&ctx, &mut report)?);

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

/// Pick a variable for every instance output that is read rather than wired.
///
/// IRIS reads an instance's output straight out of the instance:
///
/// ```text
/// inst dec = Decoder { instr: imem_rdata, };
/// alu_b = if dec.alu_b_imm { dec.imm } else { rf.rdata2 };
/// ```
///
/// Veryl has no expression for that. An output is wired to a variable at the
/// instantiation and the variable is read, so one is named here for each.
///
/// The name is `<instance>_<port>`, and a suffix is added if the module
/// already declares that name. **Reusing a declared name would connect the
/// instance to whatever that name already meant**, which simulates and is
/// wrong.
fn wires_for_instances(
    module: &Module,
    modules: &HashMap<String, Module>,
) -> HashMap<String, HashMap<String, String>> {
    let mut taken: std::collections::HashSet<String> = module
        .ports
        .iter()
        .map(|p| p.name.clone())
        .chain(module.signals.iter().map(|s| s.name.clone()))
        .chain(module.memories.iter().map(|m| m.name.clone()))
        .collect();

    let mut wires = HashMap::new();
    for inst in &module.instances {
        let Some(target) = modules.get(&inst.module_name) else {
            continue;
        };
        let mut for_this = HashMap::new();
        for port in &target.ports {
            if port.direction != PortDirection::Out {
                continue;
            }
            if inst.port_connections.iter().any(|(name, _)| name == &port.name) {
                continue;
            }
            let mut name = format!("{}_{}", inst.name, port.name);
            while taken.contains(&name) {
                name.push('_');
            }
            taken.insert(name.clone());
            for_this.insert(port.name.clone(), name);
        }
        if !for_this.is_empty() {
            wires.insert(inst.name.clone(), for_this);
        }
    }
    wires
}

/// The `var` lines for those stand-in variables, in a settled order.
fn wire_declarations(ctx: &Ctx, report: &mut Report) -> Result<Vec<String>, Report> {
    let mut lines = Vec::new();
    for inst in &ctx.module.instances {
        let (Some(ports), Some(target)) =
            (ctx.wires.get(&inst.name), ctx.modules.get(&inst.module_name))
        else {
            continue;
        };
        // Walked in the target's own port order, so the output does not move
        // about between runs.
        for port in &target.ports {
            let Some(wire) = ports.get(&port.name) else {
                continue;
            };
            let ty = type_to_veryl(ctx, &port.ty, report)?;
            lines.push(format!("var {}: {};", wire, ty));
        }
    }
    Ok(lines)
}

/// `mod M[W: uint = 8,]` in IRIS, `module M #(param W: logic<32> = 8,)` in Veryl.
///
/// The `where` clause has nowhere to go. Veryl bounds a generic parameter with
/// a `proto`, which constrains its shape rather than its value, so
/// `where DataWidth >= 1` cannot be carried. **It is reported rather than
/// dropped**: a module that silently loses its own bounds accepts an argument
/// its author ruled out, and the failure shows up somewhere else entirely.
fn generics_to_veryl(ctx: &Ctx, report: &mut Report) -> Result<String, Report> {
    if !ctx.module.where_constraints.is_empty() {
        report.push(lossy_iris(ctx.file, "where clause on a generic parameter"));
    }
    if ctx.module.generics.is_empty() {
        return Ok(String::new());
    }

    let mut out = String::from(" #(\n");
    for param in &ctx.module.generics {
        let ty = type_to_veryl(ctx, &param.ty, report)?;
        match &param.default_value {
            Some(value) => out.push_str(&format!(
                "    param {}: {} = {},\n",
                param.name,
                ty,
                expr_to_veryl(ctx, value, report)?
            )),
            None => out.push_str(&format!("    param {}: {},\n", param.name, ty)),
        }
    }
    out.push(')');
    Ok(out)
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

fn port_to_veryl(ctx: &Ctx, port: &Port, report: &mut Report) -> Result<String, Report> {
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
                file: ctx.file.to_string(),
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
    let ty = type_to_veryl(ctx, &port.ty, report)?;
    Ok(format!("{}: {} {}", port.name, direction, ty))
}

/// A declaration, and what its initialiser is.
///
/// **The initialiser used to be dropped**, on the reasoning that Veryl has no
/// initialiser on a declaration and the reset branch of an `always_ff` is
/// where a starting value belongs. That is true of a register whose design
/// writes its own reset, and false of everything else:
///
/// ```text
/// const K: bit[8] = 8'd3;   became  var K: logic<8>;    the 3 was gone
/// let w: bit[8] = a;        became  var w: logic<8>;    w = a was gone
/// var acc: bit[8] = 8'd7;   became  var acc: logic<8>;  acc started at 0
/// ```
///
/// Each of those is valid Veryl that elaborates, simulates, and computes
/// something else. So `let` and `const` keep their definition, and a `var`
/// with a starting value gets an `initial` block, which Veryl does have.
fn signal_to_veryl(ctx: &Ctx, signal: &Signal, report: &mut Report) -> Result<String, Report> {
    let ty = type_to_veryl(ctx, &signal.ty, report)?;

    // `let` and `const` reach here alike: `iris-sim`'s parser records both as
    // immutable with an initialiser and keeps no note of which word was
    // written. `let` is right for both, and `const` would be wrong for
    // `let w = a`, so `let` is what is written.
    if !signal.is_var {
        return match &signal.init_value {
            Some(value) => Ok(format!(
                "let {}: {} = {};",
                signal.name,
                ty,
                expr_to_veryl(ctx, value, report)?
            )),
            // Nothing to lose: what drives it is written elsewhere.
            None => Ok(format!("var {}: {};", signal.name, ty)),
        };
    }

    Ok(format!("var {}: {};", signal.name, ty))
}

/// The file's enumerations and structures, written inside the module.
///
/// IRIS declares them once at the top of the file. Veryl has no top-level
/// form: an enumeration lives in a module, an interface or a package. With one
/// module in the file the two are the same thing said in different places.
fn named_types_to_veryl(ctx: &Ctx, report: &mut Report) -> Result<String, Report> {
    let mut out = String::new();

    for decl in &ctx.types.enums {
        let underlying = match &decl.underlying {
            Some(ty) => format!(": {}", type_to_veryl(ctx, ty, report)?),
            // Veryl needs a width; IRIS settles one from the variant count.
            None => {
                let bits = usize::max(1, usize::BITS as usize - (decl.variants.len() - 1).leading_zeros() as usize);
                format!(": logic<{}>", bits)
            }
        };
        let mut variants = Vec::new();
        for variant in &decl.variants {
            if variant.payload.is_some() {
                return Err(one(Diagnostic::unimplemented(
                    ctx.file,
                    Position::default(),
                    "an enum variant carrying a value",
                    "Veryl enumerations hold no payload; the tagged form would \
                     have to be written out as a struct",
                )));
            }
            match &variant.value {
                Some(value) => variants.push(format!(
                    "        {} = {},",
                    variant.name,
                    expr_to_veryl(ctx, value, report)?
                )),
                None => variants.push(format!("        {},", variant.name)),
            }
        }
        out.push_str(&format!(
            "    enum {}{} {{\n{}\n    }}\n",
            decl.name,
            underlying,
            variants.join("\n")
        ));
    }

    for decl in &ctx.types.structs {
        let keyword = if decl.is_union { "union" } else { "struct" };
        let mut fields = Vec::new();
        for (name, ty) in &decl.fields {
            fields.push(format!("        {}: {},", name, type_to_veryl(ctx, ty, report)?));
        }
        out.push_str(&format!(
            "    {} {} {{\n{}\n    }}\n",
            keyword,
            decl.name,
            fields.join("\n")
        ));
    }

    // IRIS writes a type alias at file level; Veryl writes it inside the
    // module, so it is placed here with the enumerations and structures.
    for (name, ty) in &ctx.types.type_aliases {
        out.push_str(&format!("    type {} = {};\n", name, type_to_veryl(ctx, ty, report)?));
    }

    if !out.is_empty() {
        out.push('\n');
    }
    Ok(out)
}

/// The `initial` block that carries the starting values of the `var`s.
///
/// A design need not reset a register in its `always_ff`; IRIS lets the
/// declaration say where it starts, and dropping that changes what the design
/// computes from the first cycle.
fn initial_to_veryl(ctx: &Ctx, report: &mut Report) -> Result<String, Report> {
    let mut lines = Vec::new();
    for signal in &ctx.module.signals {
        if !signal.is_var {
            continue;
        }
        let Some(value) = &signal.init_value else {
            continue;
        };
        lines.push(format!(
            "        {} = {};",
            signal.name,
            expr_to_veryl(ctx, value, report)?
        ));
    }
    if lines.is_empty() {
        return Ok(String::new());
    }
    Ok(format!("    initial {{\n{}\n    }}\n\n", lines.join("\n")))
}

/// An IRIS `mem` as a Veryl array.
///
/// Veryl has arrays but no memory configuration, so `ram`, `rom`, the read and
/// write modes and `init_file` have nowhere to go. That is stated rather than
/// dropped: a ROM silently becoming writable memory is the kind of difference
/// that survives a simulation and fails in synthesis.
fn mem_to_veryl(
    ctx: &Ctx,
    mem: &iris_sim::parser::MemDecl,
    report: &mut Report,
) -> Result<String, Report> {
    let element = type_to_veryl(ctx, &mem.element_type, report)?;

    let config = &mem.config;
    let configured = config.ports.is_some()
        || config.mem_type.is_some()
        || config.read_mode.is_some()
        || config.write_mode.is_some()
        || config.init_file.is_some();
    if configured {
        report.push(lossy_iris(ctx.file, "mem with ram/rom/read_mode/init_file"));
    }
    if mem.init.is_some() {
        report.push(Diagnostic {
            level: Level::Warning,
            file: ctx.file.to_string(),
            position: Position::default(),
            message: format!("the initial contents of '{}' are not carried across", mem.name),
            note: Some("Veryl has no initialiser on an array declaration".to_string()),
        });
    }

    // A depth written as `Depth` is resolved to its default at parse time.
    // Emitting that number would turn a generic memory into a fixed one that
    // still looks generic, so the expression is written when there is one.
    let depth = match &mem.depth_expr {
        Some(expr) => expr_to_veryl(ctx, expr, report)?,
        None => mem.depth.to_string(),
    };
    Ok(format!("var {}: {} [{}];", mem.name, element, depth))
}

/// Report a conversion that keeps going but loses something.
fn lossy_iris(file: &str, construct: &str) -> Diagnostic {
    let entry = mapping::lossy()
        .find(|m| m.iris == construct)
        .expect("a lossy conversion must name an entry in the mapping table");
    Diagnostic::lossy(file, Position::default(), entry, construct)
}

fn type_to_veryl(ctx: &Ctx, ty: &Type, report: &mut Report) -> Result<String, Report> {
    Ok(match ty {
        Type::Bit => "logic".to_string(),
        Type::BitVec { width } => format!("logic<{}>", width),
        Type::Bool => "logic".to_string(),
        Type::Clock => "clock".to_string(),
        Type::Reset { .. } => "reset".to_string(),
        // Veryl has f32/f64 too, so a floating-point type maps straight across.
        Type::Float { bits } if *bits == 64 => "f64".to_string(),
        Type::Float { .. } => "f32".to_string(),
        // Veryl has a fixed type at each of these widths, and IRIS spells
        // them `u8`..`u64` and `i8`..`i64` as well. Writing `logic<8>` instead
        // would come back as `bit[8]`, so `uint[8]` would not survive a round
        // trip even though the table calls the pair exact.
        Type::Int { width, signed } => match (width, signed) {
            (8, false) => "u8".to_string(),
            (16, false) => "u16".to_string(),
            (32, false) => "u32".to_string(),
            (64, false) => "u64".to_string(),
            (8, true) => "i8".to_string(),
            (16, true) => "i16".to_string(),
            (32, true) => "i32".to_string(),
            (64, true) => "i64".to_string(),
            (w, true) => format!("signed logic<{}>", w),
            (w, false) => format!("logic<{}>", w),
        },
        Type::Enum { name, .. } => name.clone(),
        Type::Array { element, size } => {
            let inner = type_to_veryl(ctx, element, report)?;
            format!("{}[{}]", inner, size)
        }
        // A width still written as an expression, such as `bit[DataWidth]`.
        // Veryl has generic parameters too, so this is a limit of the
        // converter rather than of the language.
        // A width still written as an expression, such as `bit[DataWidth]`.
        // It mentions the module's generic parameters, which Veryl carries as
        // `#(param ...)`, so the expression is written out as it stands.
        Type::BitVecExpr { expr } => {
            format!("logic<{}>", expr_to_veryl(ctx, expr, report)?)
        }
        // A name nothing declares. IRIS reports this as O1008, so passing it
        // through as if it were a type would carry the fault across.
        // A name the file declares as an enumeration or a structure.
        Type::Named(name) if ctx.types.declares(name) => name.clone(),
        Type::Named(name) => {
            return Err(one(Diagnostic {
                level: Level::Error,
                file: ctx.file.to_string(),
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

    let mut ports = Vec::new();
    for (name, value) in &inst.port_connections {
        ports.push(format!("{}: {}", name, expr_to_veryl(ctx, value, report)?));
    }
    // The outputs IRIS left unwired, so that reads of them have something to
    // name on the Veryl side.
    if let (Some(wires), Some(target)) =
        (ctx.wires.get(&inst.name), ctx.modules.get(&inst.module_name))
    {
        for port in &target.ports {
            if let Some(wire) = wires.get(&port.name) {
                ports.push(format!("{}: {}", port.name, wire));
            }
        }
    }
    if !ports.is_empty() {
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
        // `Op::Add`. Veryl spells it the same way.
        Pattern::Path { path, binding: None } => path.clone(),
        // A binding takes the payload out of a tagged variant. Veryl
        // enumerations carry no payload, so there is nothing to bind.
        Pattern::Path { path, binding: Some(_) } => {
            let mut sub = Report::default();
            sub.push(Diagnostic {
                level: Level::Error,
                file: file.to_string(),
                position: Position::default(),
                message: format!("binding a payload in '{}' has no counterpart in Veryl", path),
                note: Some("a Veryl enumeration holds no payload to bind".to_string()),
            });
            return Err(sub);
        }
        other => {
            let mut sub = Report::default();
            sub.push(Diagnostic::unimplemented(
                file,
                Position::default(),
                &format!("the pattern {:?}", other),
                "the converter does not write it yet",
            ));
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
        // A real literal is kept as its source text, so it carries across as-is.
        Literal::Real { text } => text.clone(),
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
        // Both languages spell the system functions the same way.
        Expression::SysFunc { name, args } => {
            let mut rendered = Vec::new();
            for arg in args {
                match arg {
                    iris_sim::parser::SysFuncArg::Expr(e) => {
                        rendered.push(expr_to_veryl(ctx, e, report)?)
                    }
                    iris_sim::parser::SysFuncArg::Type(t) => {
                        rendered.push(type_to_veryl(ctx, t, report)?)
                    }
                    iris_sim::parser::SysFuncArg::Str(text) => {
                        rendered.push(format!("\"{}\"", text))
                    }
                }
            }
            // The parser drops the leading `$`; Veryl keeps it.
            format!("${}({})", name.trim_start_matches('$'), rendered.join(", "))
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
        Expression::MethodCall { receiver, method, args }
            if method == "sign_extend" || method == "extend" =>
        {
            widen_to_veryl(ctx, receiver, method, args, report)?
        }
        // `p.hi` reads a field of a structure. Veryl writes it the same way.
        Expression::MethodCall { receiver, method, args }
            if args.is_empty() && struct_field(ctx, receiver, method) =>
        {
            format!("{}.{}", expr_to_veryl(ctx, receiver, report)?, method)
        }
        // `dec.rd` reads an instance's output. On the Veryl side that output
        // was wired to a variable, so the read becomes that variable.
        Expression::MethodCall { receiver, method, args }
            if args.is_empty() && wire_for(ctx, receiver, method).is_some() =>
        {
            wire_for(ctx, receiver, method).expect("just checked")
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

/// Is this a read of a field of a structure the file declares?
fn struct_field(ctx: &Ctx, receiver: &Expression, field: &str) -> bool {
    let Expression::Ident(name) = receiver else {
        return false;
    };
    let declared = ctx
        .module
        .signals
        .iter()
        .find(|s| &s.name == name)
        .map(|s| &s.ty)
        .or_else(|| ctx.module.ports.iter().find(|p| &p.name == name).map(|p| &p.ty));
    let Some(Type::Named(type_name)) = declared else {
        return false;
    };
    ctx.types
        .structs
        .iter()
        .any(|s| &s.name == type_name && s.fields.iter().any(|(f, _)| f == field))
}

/// The variable an instance's output port was wired to, if this is one.
fn wire_for(ctx: &Ctx, receiver: &Expression, port: &str) -> Option<String> {
    let Expression::Ident(instance) = receiver else {
        return None;
    };
    ctx.wires.get(instance)?.get(port).cloned()
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

/// `x.sign_extend[N]()` and `x.extend[N]()` in IRIS, a repeated leading bit
/// in Veryl: `{msb repeat N-w, x}` and `{1'b0 repeat N-w, x}`.
///
/// **Veryl's cast is not the counterpart of the signed one.** `x as i32`
/// emits `int'(x)`, which zero-extends an unsigned operand, while IRIS emits
/// `32'($signed(x))`, which replicates the sign bit. Writing the replication
/// out says the same thing in both languages and leaves nothing to either
/// one's rules about when a value is signed.
///
/// The unsigned one is written the same way rather than as `x as N`, so that
/// both take the same road and the round trip needs only one construct.
///
/// Both languages have that construct, so this is not a gap between them.
fn widen_to_veryl(
    ctx: &Ctx,
    receiver: &Expression,
    method: &str,
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
                "a widening to a width that is not a literal",
                "the number of sign bits to repeat has to be known here",
            ))
        }
    };
    let Some(width) = ctx.width(receiver) else {
        return Err(refuse(
            "a widening whose operand width is not known",
            "the number of bits to repeat is that width subtracted from the target",
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
            message: format!("{}[{}] narrows a {}-bit value", method, target, width),
            note: Some("use truncate to make a value narrower".to_string()),
        });
        return Err(sub);
    }
    if target == width {
        return Ok(value);
    }

    // The signed one repeats the operand's own top bit; the unsigned one a zero.
    let lead = match method {
        "sign_extend" => msb_of(ctx, receiver, width, report)?,
        _ => "1'b0".to_string(),
    };
    Ok(format!("{{{} repeat {}, {}}}", lead, target - width, value))
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
