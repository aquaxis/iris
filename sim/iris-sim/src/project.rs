//! Project management for multi-file IRIS designs
//!
//! This module provides the Project struct for managing multiple IRIS modules
//! and their relationships.

use std::collections::HashMap;
use std::path::Path;

use thiserror::Error;

use crate::parser::{
    EnumDecl, Expression, FnDecl, Interface, Literal, Module, ParseError, Parser, Pattern,
    StructDecl, Type, ViewDef,
};

/// Project error type
#[derive(Error, Debug)]
pub enum ProjectError {
    #[error("Parse error: {0}")]
    ParseError(#[from] ParseError),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Module not found: {0}")]
    ModuleNotFound(String),

    #[error("Top module not specified")]
    TopModuleNotSpecified,

    #[error("Duplicate module name: {0}")]
    DuplicateModule(String),

    #[error("Circular instantiation detected: {0}")]
    CircularInstantiation(String),
}

/// Project containing multiple IRIS modules
#[derive(Clone, Debug)]
pub struct Project {
    /// All modules in the project, keyed by name
    pub modules: HashMap<String, Module>,
    /// All interfaces in the project, keyed by name
    pub interfaces: HashMap<String, Interface>,
    /// User-defined enumerations, by name
    pub enums: HashMap<String, EnumDecl>,
    /// User-defined structures and unions, by name
    pub structs: HashMap<String, StructDecl>,
    /// User-defined functions, by name
    pub functions: HashMap<String, FnDecl>,
    /// What each source file declared and imported, for name resolution
    file_scopes: Vec<FileScope>,
    /// Top module name
    pub top_module: Option<String>,
}

impl Project {
    /// Create a new empty project
    pub fn new() -> Self {
        Self {
            modules: HashMap::new(),
            interfaces: HashMap::new(),
            enums: HashMap::new(),
            structs: HashMap::new(),
            functions: HashMap::new(),
            file_scopes: Vec::new(),
            top_module: None,
        }
    }

    /// Load a single file as a project
    pub fn load_single(path: &Path) -> Result<Self, ProjectError> {
        let source = std::fs::read_to_string(path)?;
        let parser = Parser::new();
        let result = parser.parse_all(&source)?;

        let mut project = Self::new();
        project.add_file(result);
        project.resolve_packages();

        // Auto-detect top module
        project.auto_detect_top();
        project.elaborate();

        Ok(project)
    }

    /// Load multiple files as a project
    pub fn load_files(paths: &[&Path]) -> Result<Self, ProjectError> {
        let mut project = Self::new();
        let parser = Parser::new();

        for path in paths {
            let source = std::fs::read_to_string(path)?;
            let result = parser.parse_all(&source)?;

            // A duplicate module name is an error, whatever else the file holds
            for module in &result.modules {
                let qualified = match &result.package {
                    Some(package) => format!("{}::{}", package, module.name),
                    None => module.name.clone(),
                };
                if project.modules.contains_key(&qualified) {
                    return Err(ProjectError::DuplicateModule(qualified));
                }
            }

            project.add_file(result);
        }
        project.resolve_packages();

        // Auto-detect top module if not specified
        // Priority: 1. test modules (is_test == true)
        //           2. modules with "TB" or "Testbench" in name
        //           3. single module
        project.auto_detect_top();
        project.elaborate();

        Ok(project)
    }

    /// Resolve generic parameters throughout the design.
    ///
    /// Each instantiation is specialized with its own generic arguments, falling back
    /// to the declared defaults. A module instantiated with different arguments becomes
    /// several concrete modules, and the instances are rewritten to point at them.
    pub fn elaborate(&mut self) {
        // Enumerations are resolved first: a variant becomes its value and an
        // enum-typed declaration gets a width, so the rest of elaboration and
        // the whole simulator see ordinary numbers.
        // A call to a user-defined function is replaced by its body, so
        // nothing after this point has to know that functions exist
        self.inline_functions();
        self.resolve_enums();
        // A structure becomes one signal per field; a union becomes one signal
        // whose fields are slices of it
        self.expand_composites();
        // Interfaces likewise become plain signals, one per member
        self.expand_interfaces();

        let Some(top_name) = self.top_module.clone() else {
            return;
        };

        // The top module has no instantiation site, so it uses its own defaults
        let env = self.default_env(&top_name);
        let mut done = HashMap::new();
        let concrete = self.specialize(&top_name, &env, &mut done, 0);
        self.top_module = Some(concrete);
    }

    /// Replace every interface-typed port and signal with one plain signal per
    /// member.
    ///
    /// A port declared `initiator axi: AxiLite` becomes one port per interface
    /// member, named `axi.awvalid` and so on, with the direction the named view
    /// gives it. A connection `axi: axi_bus` becomes one connection per member.
    /// Nothing after this point has to know that interfaces exist.
    fn expand_interfaces(&mut self) {
        if self.interfaces.is_empty() {
            return;
        }
        self.flatten_interface_inheritance();
        let interfaces = self.interfaces.clone();

        // Which ports carry an interface, before anything is rewritten
        let mut interface_ports: HashMap<String, HashMap<String, String>> = HashMap::new();
        for (name, module) in &self.modules {
            let mut ports = HashMap::new();
            for port in &module.ports {
                if let Type::Named(type_name) = &port.ty {
                    if interfaces.contains_key(type_name) {
                        ports.insert(port.name.clone(), type_name.clone());
                    }
                }
            }
            if !ports.is_empty() {
                interface_ports.insert(name.clone(), ports);
            }
        }

        for module in self.modules.values_mut() {
            let mut ports = Vec::new();
            for port in std::mem::take(&mut module.ports) {
                match interface_for(&interfaces, &port.ty) {
                    Some(interface) => {
                        let view = view_for(interface, port.direction);
                        for member in &interface.signals {
                            ports.push(crate::parser::Port {
                                name: format!("{}.{}", port.name, member.name),
                                direction: member_direction(view, &member.name, port.direction),
                                ty: member.ty.clone(),
                            });
                        }
                    }
                    None => ports.push(port),
                }
            }
            module.ports = ports;

            let mut signals = Vec::new();
            for signal in std::mem::take(&mut module.signals) {
                match interface_for(&interfaces, &signal.ty) {
                    Some(interface) => {
                        for member in &interface.signals {
                            signals.push(crate::parser::Signal {
                                has_explicit_type: true,
                                is_rand: false,
                                name: format!("{}.{}", signal.name, member.name),
                                ty: member.ty.clone(),
                                init_value: None,
                                is_mutable: signal.is_mutable,
                                is_var: signal.is_var,
                                clock_config: None,
                                reset_config: None,
                            });
                        }
                    }
                    None => signals.push(signal),
                }
            }
            module.signals = signals;

            for inst in &mut module.instances {
                let Some(ports) = interface_ports.get(&inst.module_name) else {
                    continue;
                };
                let mut connections = Vec::new();
                for (port_name, expr) in std::mem::take(&mut inst.port_connections) {
                    match (ports.get(&port_name), &expr) {
                        (Some(type_name), Expression::Ident(bus)) => {
                            let interface = &interfaces[type_name];
                            for member in &interface.signals {
                                connections.push((
                                    format!("{}.{}", port_name, member.name),
                                    Expression::Ident(format!("{}.{}", bus, member.name)),
                                ));
                            }
                        }
                        _ => connections.push((port_name, expr)),
                    }
                }
                inst.port_connections = connections;
            }
        }
    }

    /// Take one parsed file into the project, qualifying its declarations
    /// with the package it belongs to.
    fn add_file(&mut self, result: crate::parser::ParseResult) {
        let package = result.package.clone();
        let qualify = |name: &str| match &package {
            Some(path) => format!("{}::{}", path, name),
            None => name.to_string(),
        };

        let mut scope = FileScope {
            package: package.clone(),
            imports: result.imports.clone(),
            exports: result.exports.clone(),
            declared: Vec::new(),
            modules: Vec::new(),
        };

        for mut module in result.modules {
            let qualified = qualify(&module.name);
            scope.declared.push((module.name.clone(), qualified.clone()));
            scope.modules.push(qualified.clone());
            module.name = qualified.clone();
            self.modules.insert(qualified, module);
        }
        for mut decl in result.enums {
            let qualified = qualify(&decl.name);
            scope.declared.push((decl.name.clone(), qualified.clone()));
            decl.name = qualified.clone();
            self.enums.insert(qualified, decl);
        }
        for mut decl in result.structs {
            let qualified = qualify(&decl.name);
            scope.declared.push((decl.name.clone(), qualified.clone()));
            decl.name = qualified.clone();
            self.structs.insert(qualified, decl);
        }
        for mut decl in result.functions {
            let qualified = qualify(&decl.name);
            scope.declared.push((decl.name.clone(), qualified.clone()));
            decl.name = qualified.clone();
            self.functions.insert(qualified, decl);
        }
        for mut interface in result.interfaces {
            let qualified = qualify(&interface.name);
            scope.declared.push((interface.name.clone(), qualified.clone()));
            interface.name = qualified.clone();
            self.interfaces.insert(qualified, interface);
        }

        self.file_scopes.push(scope);
    }

    /// Resolve the names each file uses to the declarations they refer to.
    ///
    /// A file sees its own package's declarations and whatever it imports.
    /// Only a `pub` declaration can be imported from another package.
    fn resolve_packages(&mut self) {
        if self.file_scopes.iter().all(|s| s.package.is_none()) {
            // Nothing is in a package, so every name is already itself
            self.file_scopes.clear();
            return;
        }

        // Everything a package offers to the outside
        let mut exported: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for scope in &self.file_scopes {
            let Some(package) = &scope.package else {
                continue;
            };
            for (local, qualified) in &scope.declared {
                if self.is_public(qualified) {
                    exported
                        .entry(package.clone())
                        .or_default()
                        .push((local.clone(), qualified.clone()));
                }
            }
        }

        // A package also offers on whatever it re-exports
        let scopes_snapshot = self.file_scopes.clone();
        for scope in &scopes_snapshot {
            let Some(package) = &scope.package else {
                continue;
            };
            for name in &scope.exports {
                let resolved = scope
                    .declared
                    .iter()
                    .find(|(local, _)| local == name)
                    .map(|(_, qualified)| qualified.clone())
                    .or_else(|| {
                        scope.imports.iter().find_map(|(path, names)| {
                            let offered = exported.get(path)?;
                            offered
                                .iter()
                                .find(|(local, _)| {
                                    local == name && (names.is_empty() || names.contains(local))
                                })
                                .map(|(_, qualified)| qualified.clone())
                        })
                    });
                if let Some(qualified) = resolved {
                    let entry = exported.entry(package.clone()).or_default();
                    if !entry.iter().any(|(local, _)| local == name) {
                        entry.push((name.clone(), qualified));
                    }
                }
            }
        }

        let scopes = std::mem::take(&mut self.file_scopes);
        for scope in &scopes {
            let mut visible: HashMap<String, String> = HashMap::new();
            // A file always sees its own declarations
            for (local, qualified) in &scope.declared {
                visible.insert(local.clone(), qualified.clone());
            }
            for (path, names) in &scope.imports {
                let Some(offered) = exported.get(path) else {
                    continue;
                };
                for (local, qualified) in offered {
                    if names.is_empty() || names.contains(local) {
                        visible.insert(local.clone(), qualified.clone());
                    }
                }
            }

            for name in &scope.modules {
                if let Some(mut module) = self.modules.remove(name) {
                    resolve_module_names(&mut module, &visible);
                    self.modules.insert(name.clone(), module);
                }
            }
        }
    }

    /// Was this declaration written `pub`?
    fn is_public(&self, qualified: &str) -> bool {
        self.modules
            .get(qualified)
            .map(|m| m.is_public)
            .or_else(|| self.enums.get(qualified).map(|e| e.is_public))
            .or_else(|| self.structs.get(qualified).map(|s| s.is_public))
            .or_else(|| self.functions.get(qualified).map(|f| f.is_public))
            .or_else(|| self.interfaces.get(qualified).map(|i| i.is_public))
            .unwrap_or(false)
    }

    /// Replace every call to a user-defined function with its body.
    ///
    /// A function is a pure expression, so inlining it is exact: the parameters
    /// become the argument expressions and nothing else changes.
    fn inline_functions(&mut self) {
        if self.functions.is_empty() {
            return;
        }
        let functions = self.functions.clone();
        for module in self.modules.values_mut() {
            rewrite_module_exprs(module, &mut |expr| inline_call(expr, &functions, 0));
        }
    }

    /// Replace every structure and union with plain signals.
    ///
    /// A structure's fields sit side by side, so each becomes its own signal
    /// named `point.x`. A union's fields share their bits, so the whole union
    /// becomes one signal and each field access becomes a slice of it.
    fn expand_composites(&mut self) {
        if self.structs.is_empty() {
            return;
        }
        let structs = self.structs.clone();

        // Where a union field sits, keyed by `Type::field`
        let mut union_fields: HashMap<String, (usize, usize)> = HashMap::new();
        for decl in structs.values() {
            if !decl.is_union {
                continue;
            }
            for (field, ty) in &decl.fields {
                let width = ty.width().unwrap_or(1);
                union_fields.insert(format!("{}::{}", decl.name, field), (width, 0));
            }
        }

        for module in self.modules.values_mut() {
            // Names in this module that hold a union, with its width
            let mut unions: HashMap<String, String> = HashMap::new();

            let mut ports = Vec::new();
            for port in std::mem::take(&mut module.ports) {
                match composite_for(&structs, &port.ty) {
                    Some(decl) if decl.is_union => {
                        unions.insert(port.name.clone(), decl.name.clone());
                        ports.push(crate::parser::Port {
                            name: port.name.clone(),
                            direction: port.direction,
                            ty: Type::BitVec {
                                width: union_width(decl),
                            },
                        });
                    }
                    Some(decl) => {
                        for (field, ty) in &decl.fields {
                            ports.push(crate::parser::Port {
                                name: format!("{}.{}", port.name, field),
                                direction: port.direction,
                                ty: ty.clone(),
                            });
                        }
                    }
                    None => ports.push(port),
                }
            }
            module.ports = ports;

            let mut signals = Vec::new();
            for signal in std::mem::take(&mut module.signals) {
                match composite_for(&structs, &signal.ty) {
                    Some(decl) if decl.is_union => {
                        unions.insert(signal.name.clone(), decl.name.clone());
                        signals.push(crate::parser::Signal {
                                has_explicit_type: true,
                            is_rand: false,
                            name: signal.name.clone(),
                            ty: Type::BitVec {
                                width: union_width(decl),
                            },
                            init_value: signal.init_value.clone(),
                            is_mutable: signal.is_mutable,
                            is_var: signal.is_var,
                            clock_config: None,
                            reset_config: None,
                        });
                    }
                    Some(decl) => {
                        for (field, ty) in &decl.fields {
                            signals.push(crate::parser::Signal {
                                has_explicit_type: true,
                                is_rand: false,
                                name: format!("{}.{}", signal.name, field),
                                ty: ty.clone(),
                                init_value: None,
                                is_mutable: signal.is_mutable,
                                is_var: signal.is_var,
                                clock_config: None,
                                reset_config: None,
                            });
                        }
                    }
                    None => signals.push(signal),
                }
            }
            module.signals = signals;

            if !unions.is_empty() {
                let layouts = union_layouts(&structs);
                rewrite_module_unions(module, &unions, &layouts);
            }
        }
    }

    /// Fold each `extends` into a flat set of signals and views (spec 8.5.1).
    ///
    /// A view the child redeclares replaces the parent's; a signal it
    /// redeclares is an error the specification forbids, so the parent's is
    /// kept and the duplicate ignored.
    fn flatten_interface_inheritance(&mut self) {
        // Deepest chains resolve last, so a parent is already flat
        let names: Vec<String> = self.interfaces.keys().cloned().collect();
        for _ in 0..3 {
            for name in &names {
                let Some(parent_name) = self
                    .interfaces
                    .get(name)
                    .and_then(|i| i.extends.clone())
                else {
                    continue;
                };
                let Some(parent) = self.interfaces.get(&parent_name).cloned() else {
                    continue;
                };
                // Wait until the parent itself is flat
                if parent.extends.is_some() {
                    continue;
                }
                let Some(child) = self.interfaces.get_mut(name) else {
                    continue;
                };

                let mut signals = parent.signals.clone();
                for signal in &child.signals {
                    if !signals.iter().any(|s| s.name == signal.name) {
                        signals.push(signal.clone());
                    }
                }
                let mut views = parent.views.clone();
                for view in &child.views {
                    match views.iter_mut().find(|v| v.name == view.name) {
                        Some(existing) => *existing = view.clone(),
                        None => views.push(view.clone()),
                    }
                }

                child.signals = signals;
                child.views = views;
                child.extends = None;
            }
        }
    }

    /// How an enumeration is laid out.
    ///
    /// The tag occupies the low bits. A tagged union puts the payload above it,
    /// so the whole value is `(payload << tag_width) | tag`.
    fn enum_layout(&self, decl: &EnumDecl) -> EnumLayout {
        let mut variants = Vec::new();
        let mut next = 0i64;
        for variant in &decl.variants {
            let tag = variant
                .value
                .as_ref()
                .and_then(|e| Self::const_value(e, &HashMap::new()))
                .unwrap_or(next);
            next = tag + 1;
            variants.push((
                variant.name.clone(),
                tag as u64,
                variant.payload.as_ref().and_then(|t| t.width()).unwrap_or(0),
            ));
        }

        let tag_width = decl
            .underlying
            .as_ref()
            .and_then(|t| t.width())
            .unwrap_or_else(|| {
                let highest = variants.iter().map(|(_, tag, _)| *tag).max().unwrap_or(0);
                clog2(highest as i64 + 1).max(1) as usize
            });
        let payload_width = variants.iter().map(|(_, _, w)| *w).max().unwrap_or(0);

        EnumLayout {
            tag_width,
            width: tag_width + payload_width,
            variants,
        }
    }

    /// Replace every mention of an enumeration with a plain number.
    ///
    /// `Colour::Red` becomes a literal and `var c: Colour` gets the width the
    /// enumeration needs, so nothing downstream has to know about enums.
    fn resolve_enums(&mut self) {
        if self.enums.is_empty() {
            return;
        }

        let mut widths: HashMap<String, usize> = HashMap::new();
        let mut variants: HashMap<String, VariantInfo> = HashMap::new();
        for (name, decl) in &self.enums {
            let layout = self.enum_layout(decl);
            widths.insert(name.clone(), layout.width);
            for (variant, tag, payload_width) in &layout.variants {
                variants.insert(
                    format!("{}::{}", name, variant),
                    VariantInfo {
                        width: layout.width,
                        tag_width: layout.tag_width,
                        tag: *tag,
                        payload_width: *payload_width,
                    },
                );
            }
        }

        for module in self.modules.values_mut() {
            rewrite_module_enums(module, &widths, &variants);
        }
    }

    /// Generic environment for a module, given the arguments supplied at its
    /// instantiation site.
    ///
    /// Defaults are filled in afterwards and in declaration order, so a parameter
    /// declared as `AddrWidth: uint = $clog2(Depth)` follows an overridden `Depth`.
    fn resolve_env(
        &self,
        module_name: &str,
        explicit: HashMap<String, i64>,
    ) -> HashMap<String, i64> {
        let mut env = explicit;
        if let Some(module) = self.modules.get(module_name) {
            for param in &module.generics {
                if env.contains_key(&param.name) {
                    continue;
                }
                if let Some(value) = param
                    .default_value
                    .as_ref()
                    .and_then(|e| Self::eval_const(e, &env))
                {
                    env.insert(param.name.clone(), value);
                }
            }
        }
        env
    }

    /// Generic environment built from a module's declared defaults alone
    fn default_env(&self, module_name: &str) -> HashMap<String, i64> {
        self.resolve_env(module_name, HashMap::new())
    }

    /// Specialize a module for one generic environment, returning its concrete name
    fn specialize(
        &mut self,
        module_name: &str,
        env: &HashMap<String, i64>,
        done: &mut HashMap<String, String>,
        depth: usize,
    ) -> String {
        const MAX_DEPTH: usize = 64;
        if depth > MAX_DEPTH {
            return module_name.to_string();
        }

        let key = Self::env_key(module_name, env);
        if let Some(existing) = done.get(&key) {
            return existing.clone();
        }

        let Some(mut module) = self.modules.get(module_name).cloned() else {
            return module_name.to_string();
        };

        // A module with no parameters to substitute keeps its name
        let concrete_name = if env.is_empty() || module.generics.is_empty() {
            module_name.to_string()
        } else {
            Self::mangle(module_name, &module.generics, env)
        };
        done.insert(key, concrete_name.clone());

        Self::substitute_module(&mut module, env);
        // Record what this copy was specialized with, so later passes (and the
        // static checks) can see the values rather than the original defaults
        for param in &mut module.generics {
            if let Some(value) = env.get(&param.name) {
                param.default_value = Some(crate::parser::Expression::Literal(
                    crate::parser::Literal::Decimal {
                        width: None,
                        value: *value,
                    },
                ));
            }
        }
        module.name = concrete_name.clone();

        // Specialize the children, then rewrite the instances to reference them
        let child_specs: Vec<(usize, String)> = module
            .instances
            .iter()
            .enumerate()
            .map(|(i, inst)| {
                // Arguments are evaluated in the parent's environment, then the
                // child's remaining defaults are resolved on top of them
                let explicit: HashMap<String, i64> = inst
                    .generic_args
                    .iter()
                    .filter_map(|(name, expr)| {
                        Self::eval_const(expr, env).map(|v| (name.clone(), v))
                    })
                    .collect();
                let child_env = self.resolve_env(&inst.module_name, explicit);
                (i, inst.module_name.clone(), child_env)
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|(i, child_name, child_env)| {
                (i, self.specialize(&child_name, &child_env, done, depth + 1))
            })
            .collect();

        for (i, child_concrete) in child_specs {
            module.instances[i].module_name = child_concrete;
        }

        self.modules.insert(concrete_name.clone(), module);
        concrete_name
    }

    /// Cache key for a module specialized with a given environment
    fn env_key(module_name: &str, env: &HashMap<String, i64>) -> String {
        let mut parts: Vec<String> = env.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
        parts.sort();
        format!("{}[{}]", module_name, parts.join(","))
    }

    /// Name for a specialized module, listing only the parameters it declares
    fn mangle(
        module_name: &str,
        generics: &[crate::parser::GenericParam],
        env: &HashMap<String, i64>,
    ) -> String {
        let mut parts = Vec::new();
        for param in generics {
            if let Some(value) = env.get(&param.name) {
                parts.push(format!("{}{}", param.name, value));
            }
        }
        if parts.is_empty() {
            module_name.to_string()
        } else {
            format!("{}__{}", module_name, parts.join("_"))
        }
    }

    /// Replace generic parameter references throughout a module with their values
    fn substitute_module(module: &mut Module, env: &HashMap<String, i64>) {
        use crate::parser::LogicBlock;

        for port in &mut module.ports {
            Self::substitute_type(&mut port.ty, env);
        }
        for signal in &mut module.signals {
            Self::substitute_type(&mut signal.ty, env);
            if let Some(init) = signal.init_value.as_mut() {
                Self::substitute_expr(init, env);
            }
        }
        for mem in &mut module.memories {
            Self::substitute_type(&mut mem.element_type, env);
            if let Some(mut expr) = mem.depth_expr.clone() {
                Self::substitute_expr(&mut expr, env);
                if let Some(value) = Self::eval_const(&expr, env) {
                    if value > 0 {
                        mem.depth = value as usize;
                        mem.depth_expr = None;
                    }
                }
            }
        }
        for block in &mut module.logic_blocks {
            let statements = match block {
                LogicBlock::Comb(comb) => &mut comb.statements,
                LogicBlock::Sync(sync) => &mut sync.statements,
            };
            Self::substitute_statements(statements, env);
        }
    }

    /// Replace generic parameter references inside a statement list
    fn substitute_statements(stmts: &mut [crate::parser::Statement], env: &HashMap<String, i64>) {
        use crate::parser::Statement;
        for stmt in stmts {
            match stmt {
                Statement::Break | Statement::Continue => {}
                Statement::Cover(cover) => Self::substitute_expr(&mut cover.condition, env),
                Statement::Assign { value, .. } => Self::substitute_expr(value, env),
                Statement::MemWrite { addr, value, .. } => {
                    Self::substitute_expr(addr, env);
                    Self::substitute_expr(value, env);
                }
                Statement::If {
                    condition,
                    then_branch,
                    else_branch,
                } => {
                    Self::substitute_expr(condition, env);
                    Self::substitute_statements(then_branch, env);
                    if let Some(else_b) = else_branch {
                        Self::substitute_statements(else_b, env);
                    }
                }
                Statement::Match { expr, arms } => {
                    Self::substitute_expr(expr, env);
                    for arm in arms {
                        Self::substitute_statements(&mut arm.body, env);
                    }
                }
                Statement::For { range, body, .. } => {
                    Self::substitute_expr(&mut range.start, env);
                    Self::substitute_expr(&mut range.end, env);
                    Self::substitute_statements(body, env);
                }
                Statement::While { condition, body } => {
                    Self::substitute_expr(condition, env);
                    Self::substitute_statements(body, env);
                }
                Statement::LetLocal { ty, value, .. } => {
                    if let Some(t) = ty.as_mut() {
                        Self::substitute_type(t, env);
                    }
                    if let Some(v) = value.as_mut() {
                        Self::substitute_expr(v, env);
                    }
                }
                Statement::Assert(assert_stmt) => {
                    Self::substitute_expr(&mut assert_stmt.condition, env)
                }
                Statement::SysCall(call) => Self::substitute_expr(call, env),
                Statement::SliceWrite {
                    low, width, value, ..
                } => {
                    Self::substitute_expr(low, env);
                    Self::substitute_expr(width, env);
                    Self::substitute_expr(value, env);
                    Self::fold(width, env);
                }
            }
        }
    }

    /// Replace generic parameter references inside an expression, folding the
    /// system functions that become constant as a result
    fn substitute_expr(expr: &mut crate::parser::Expression, env: &HashMap<String, i64>) {
        use crate::parser::{Expression, Literal, SysFuncArg};

        match expr {
            Expression::Call { args, .. } => {
                for arg in args {
                    Self::substitute_expr(arg, env);
                }
            }
            Expression::Ident(name) => {
                if let Some(value) = env.get(name.as_str()) {
                    *expr = Expression::Literal(Literal::Decimal {
                        width: None,
                        value: *value,
                    });
                }
            }
            Expression::BinOp { lhs, rhs, .. } => {
                Self::substitute_expr(lhs, env);
                Self::substitute_expr(rhs, env);
            }
            Expression::UnaryOp { expr: inner, .. } => Self::substitute_expr(inner, env),
            Expression::Index { base, index } => {
                Self::substitute_expr(base, env);
                Self::substitute_expr(index, env);
            }
            Expression::Slice { base, high, low } => {
                Self::substitute_expr(base, env);
                Self::substitute_expr(high, env);
                Self::substitute_expr(low, env);
                Self::fold(high, env);
                Self::fold(low, env);
            }
            Expression::PartSelect {
                base,
                index,
                width,
                ..
            } => {
                Self::substitute_expr(base, env);
                Self::substitute_expr(index, env);
                Self::substitute_expr(width, env);
                Self::fold(width, env);
            }
            Expression::MethodCall { receiver, args, .. } => {
                Self::substitute_expr(receiver, env);
                for arg in args {
                    Self::substitute_expr(arg, env);
                }
            }
            Expression::If {
                condition,
                then_expr,
                else_expr,
            } => {
                Self::substitute_expr(condition, env);
                Self::substitute_expr(then_expr, env);
                Self::substitute_expr(else_expr, env);
            }
            Expression::Concat(exprs) => {
                for e in exprs {
                    Self::substitute_expr(e, env);
                }
            }
            Expression::Replicate { count, value } => {
                Self::substitute_expr(count, env);
                for e in value {
                    Self::substitute_expr(e, env);
                }
            }
            Expression::MemRead { addr, .. } => Self::substitute_expr(addr, env),
            Expression::Match { scrutinee, arms } => {
                Self::substitute_expr(scrutinee, env);
                for arm in arms {
                    Self::substitute_expr(&mut arm.value, env);
                }
            }
            Expression::SysFunc { args, .. } => {
                for arg in args.iter_mut() {
                    match arg {
                        SysFuncArg::Expr(e) => Self::substitute_expr(e, env),
                        SysFuncArg::Type(t) => Self::substitute_type(t, env),
                        SysFuncArg::Str(_) => {}
                    }
                }
                Self::fold(expr, env);
            }
            Expression::Literal(_) => {}
        }
    }

    /// Replace an expression with its value when it is constant
    fn fold(expr: &mut crate::parser::Expression, env: &HashMap<String, i64>) {
        use crate::parser::{Expression, Literal};
        if matches!(expr, Expression::Literal(_)) {
            return;
        }
        if let Some(value) = Self::eval_const(expr, env) {
            *expr = Expression::Literal(Literal::Decimal {
                width: None,
                value,
            });
        }
    }

    /// Replace a generic width with its value
    fn substitute_type(ty: &mut crate::parser::Type, env: &HashMap<String, i64>) {
        use crate::parser::Type;
        match ty {
            Type::BitVecExpr { expr } => {
                Self::substitute_expr(expr, env);
                if let Some(value) = Self::eval_const(expr, env) {
                    if value > 0 {
                        *ty = Type::BitVec {
                            width: value as usize,
                        };
                    }
                }
            }
            Type::Array { element, .. } => Self::substitute_type(element, env),
            _ => {}
        }
    }

    /// Evaluate a compile-time constant expression against a generic environment
    pub fn const_value(
        expr: &crate::parser::Expression,
        env: &HashMap<String, i64>,
    ) -> Option<i64> {
        Self::eval_const(expr, env)
    }

    /// Evaluate a compile-time constant expression against a generic environment
    fn eval_const(
        expr: &crate::parser::Expression,
        env: &HashMap<String, i64>,
    ) -> Option<i64> {
        use crate::parser::{BinOp, Expression, UnaryOp};
        match expr {
            Expression::Literal(lit) => Some(lit.to_u64() as i64),
            Expression::Ident(name) => env.get(name).copied(),
            Expression::UnaryOp { op, expr } => {
                let v = Self::eval_const(expr, env)?;
                match op {
                    UnaryOp::Neg => Some(-v),
                    UnaryOp::Not => Some(!v),
                    UnaryOp::LogNot => Some(if v == 0 { 1 } else { 0 }),
                }
            }
            Expression::SysFunc { name, args } => {
                use crate::parser::SysFuncArg;
                match (name.as_str(), args.first()) {
                    ("clog2", Some(SysFuncArg::Expr(e))) => {
                        let n = Self::eval_const(e, env)?;
                        Some(clog2(n))
                    }
                    ("bits", Some(SysFuncArg::Type(t))) => t.width().map(|w| w as i64),
                    _ => None,
                }
            }
            // The width methods of spec 3.4.2 keep a constant constant, so a
            // slice bound written `32'(W - 1)` still has a bound known at
            // elaboration. Without this the folder gave up and the slice was
            // rejected as varying at run time.
            Expression::MethodCall { receiver, method, args } => {
                let value = Self::eval_const(receiver, env)?;
                match method.as_str() {
                    "truncate" => {
                        let width = Self::eval_const(args.first()?, env)?;
                        if !(1..=63).contains(&width) {
                            return Some(value);
                        }
                        Some(value & ((1i64 << width) - 1))
                    }
                    "extend" | "sign_extend" | "signed" | "unsigned" => Some(value),
                    _ => None,
                }
            }
            Expression::BinOp { op, lhs, rhs } => {
                let l = Self::eval_const(lhs, env)?;
                let r = Self::eval_const(rhs, env)?;
                match op {
                    BinOp::Add => Some(l + r),
                    BinOp::Sub => Some(l - r),
                    BinOp::Mul => Some(l * r),
                    BinOp::Div if r != 0 => Some(l / r),
                    BinOp::Mod if r != 0 => Some(l % r),
                    BinOp::Shl => Some(l << r),
                    BinOp::Shr => Some(l >> r),
                    BinOp::And => Some(l & r),
                    BinOp::Or => Some(l | r),
                    BinOp::Xor => Some(l ^ r),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Set the top module
    pub fn set_top(&mut self, name: &str) -> Result<(), ProjectError> {
        if !self.modules.contains_key(name) {
            return Err(ProjectError::ModuleNotFound(name.to_string()));
        }
        self.top_module = Some(name.to_string());
        Ok(())
    }

    /// Get the top module
    pub fn get_top_module(&self) -> Result<&Module, ProjectError> {
        let top_name = self.top_module.as_ref()
            .ok_or(ProjectError::TopModuleNotSpecified)?;
        self.modules.get(top_name)
            .ok_or_else(|| ProjectError::ModuleNotFound(top_name.clone()))
    }

    /// Get a module by name
    pub fn get_module(&self, name: &str) -> Option<&Module> {
        self.modules.get(name)
    }

    /// Check if all referenced modules exist
    pub fn validate_references(&self) -> Result<(), ProjectError> {
        for module in self.modules.values() {
            for instance in &module.instances {
                if !self.modules.contains_key(&instance.module_name) {
                    return Err(ProjectError::ModuleNotFound(instance.module_name.clone()));
                }
            }
        }
        Ok(())
    }

    /// Check for circular instantiation
    pub fn check_circular_instantiation(&self) -> Result<(), ProjectError> {
        fn check_recursive(
            project: &Project,
            module_name: &str,
            visited: &mut Vec<String>,
        ) -> Result<(), ProjectError> {
            if visited.contains(&module_name.to_string()) {
                return Err(ProjectError::CircularInstantiation(
                    visited.join(" -> ") + " -> " + module_name,
                ));
            }

            visited.push(module_name.to_string());

            if let Some(module) = project.modules.get(module_name) {
                for instance in &module.instances {
                    check_recursive(project, &instance.module_name, visited)?;
                }
            }

            visited.pop();
            Ok(())
        }

        for module_name in self.modules.keys() {
            check_recursive(self, module_name, &mut Vec::new())?;
        }

        Ok(())
    }

    /// Get list of module names
    pub fn module_names(&self) -> impl Iterator<Item = &String> {
        self.modules.keys()
    }

    /// Get all modules
    pub fn get_all_modules(&self) -> impl Iterator<Item = (&String, &Module)> {
        self.modules.iter()
    }

    /// Check if project has a test module
    pub fn has_test_module(&self) -> bool {
        self.modules.values().any(|m| m.is_test)
    }

    /// Auto-detect top module
    /// Priority: 1. test modules (is_test == true)
    ///           2. modules with "TB" or "Testbench" in name
    ///           3. single module
    fn auto_detect_top(&mut self) {
        // Priority 1: Find test modules
        let test_modules: Vec<_> = self.modules.iter()
            .filter(|(_, m)| m.is_test)
            .map(|(name, _)| name.clone())
            .collect();

        if test_modules.len() == 1 {
            self.top_module = Some(test_modules[0].clone());
            return;
        }

        // Priority 2: Find modules with "TB" or "Testbench" in name
        if test_modules.is_empty() {
            for name in self.modules.keys() {
                let lower = name.to_lowercase();
                if lower.contains("tb") || lower.contains("testbench") || lower.contains("top") {
                    self.top_module = Some(name.clone());
                    return;
                }
            }
        }

        // Priority 3: Single module case
        if self.modules.len() == 1 {
            self.top_module = self.modules.keys().next().cloned();
        }
    }

    /// Find test module (is_test == true)
    pub fn find_test_module(&self) -> Option<&Module> {
        self.modules.values().find(|m| m.is_test)
    }

    /// Check if top module is a test module
    pub fn is_top_test_module(&self) -> bool {
        if let Some(top_name) = &self.top_module {
            if let Some(module) = self.modules.get(top_name) {
                return module.is_test;
            }
        }
        false
    }
}

/// Ceiling of log2, as defined for `$clog2`: the number of bits needed to
/// address `n` items. `$clog2(0)` and `$clog2(1)` are 0.
pub fn clog2(n: i64) -> i64 {
    if n <= 1 {
        return 0;
    }
    let mut bits = 0;
    let mut value = n - 1;
    while value > 0 {
        value >>= 1;
        bits += 1;
    }
    bits
}

impl Default for Project {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_project() {
        let project = Project::new();
        assert!(project.modules.is_empty());
        assert!(project.top_module.is_none());
    }
}

/// Replace every enum mention in a module with a plain number
fn rewrite_module_enums(
    module: &mut Module,
    widths: &HashMap<String, usize>,
    variants: &HashMap<String, VariantInfo>,
) {
    use crate::parser::LogicBlock;

    for port in &mut module.ports {
        rewrite_type(&mut port.ty, widths);
    }
    for signal in &mut module.signals {
        rewrite_type(&mut signal.ty, widths);
        if let Some(init) = signal.init_value.as_mut() {
            rewrite_expr(init, variants);
        }
    }
    for mem in &mut module.memories {
        rewrite_type(&mut mem.element_type, widths);
    }
    for generic in &mut module.generics {
        rewrite_type(&mut generic.ty, widths);
    }
    for block in &mut module.logic_blocks {
        let statements = match block {
            LogicBlock::Comb(comb) => &mut comb.statements,
            LogicBlock::Sync(sync) => &mut sync.statements,
        };
        rewrite_statements(statements, widths, variants);
    }
    for block in &mut module.seq_blocks {
        rewrite_seq_statements(&mut block.statements, variants);
    }
    for block in &mut module.initial_blocks {
        rewrite_seq_statements(&mut block.statements, variants);
    }
    for fsm in &mut module.fsm_blocks {
        for local in &mut fsm.locals {
            rewrite_type(&mut local.ty, widths);
        }
        for state in &mut fsm.states {
            for (_, expr) in &mut state.moore_outputs {
                rewrite_expr(expr, variants);
            }
        }
        for transition in &mut fsm.transitions {
            for clause in &mut transition.when_clauses {
                rewrite_expr(&mut clause.condition, variants);
                rewrite_fsm_actions(&mut clause.actions, variants);
            }
        }
        for output in &mut fsm.outputs {
            for (_, expr) in &mut output.mappings {
                rewrite_expr(expr, variants);
            }
        }
    }
    for inst in &mut module.instances {
        for (_, expr) in &mut inst.port_connections {
            rewrite_expr(expr, variants);
        }
        for (_, expr) in &mut inst.generic_args {
            rewrite_expr(expr, variants);
        }
    }
}

fn rewrite_type(ty: &mut Type, widths: &HashMap<String, usize>) {
    match ty {
        Type::Named(name) => {
            if let Some(&width) = widths.get(name) {
                *ty = Type::Enum {
                    name: name.clone(),
                    width,
                };
            }
        }
        Type::Array { element, .. } => rewrite_type(element, widths),
        _ => {}
    }
}

fn rewrite_pattern(pattern: &mut Pattern, variants: &HashMap<String, VariantInfo>) {
    let (path, binding) = match pattern {
        Pattern::Ident(name) => (name.clone(), None),
        Pattern::Path { path, binding } => (path.clone(), binding.clone()),
        _ => return,
    };
    let Some(info) = variants.get(path.as_str()).copied() else {
        return;
    };
    // A variant that carries nothing is just its value
    *pattern = if info.payload_width == 0 && binding.is_none() {
        Pattern::Literal(Literal::Binary {
            width: info.width,
            value: info.tag,
        })
    } else {
        Pattern::Variant {
            tag: info.tag,
            tag_width: info.tag_width,
            binding,
            payload_width: info.payload_width,
        }
    };
}

fn rewrite_expr(expr: &mut Expression, variants: &HashMap<String, VariantInfo>) {
    match expr {
        Expression::Ident(name) => {
            if let Some(info) = variants.get(name.as_str()).copied() {
                *expr = Expression::Literal(Literal::Binary {
                    width: info.width,
                    value: info.tag,
                });
            }
        }
        Expression::BinOp { lhs, rhs, .. } => {
            rewrite_expr(lhs, variants);
            rewrite_expr(rhs, variants);
        }
        Expression::UnaryOp { expr, .. } => rewrite_expr(expr, variants),
        Expression::Index { base, index } => {
            rewrite_expr(base, variants);
            rewrite_expr(index, variants);
        }
        Expression::Slice { base, high, low } => {
            rewrite_expr(base, variants);
            rewrite_expr(high, variants);
            rewrite_expr(low, variants);
        }
        Expression::PartSelect {
            base, index, width, ..
        } => {
            rewrite_expr(base, variants);
            rewrite_expr(index, variants);
            rewrite_expr(width, variants);
        }
        Expression::MethodCall {
            receiver,
            method,
            args,
        } => {
            // `Packet::Payload(8'hab)` parses as a call on the variant
            if let Expression::Ident(path) = receiver.as_ref() {
                if let Some(info) = variants.get(path.as_str()).copied() {
                    if info.payload_width > 0 && args.len() == 1 {
                        let mut payload = args[0].clone();
                        rewrite_expr(&mut payload, variants);
                        *expr = tagged_value(info, payload);
                        return;
                    }
                }
            }
            let _ = method;
            rewrite_expr(receiver, variants);
            for arg in args {
                rewrite_expr(arg, variants);
            }
        }
        Expression::If {
            condition,
            then_expr,
            else_expr,
        } => {
            rewrite_expr(condition, variants);
            rewrite_expr(then_expr, variants);
            rewrite_expr(else_expr, variants);
        }
        Expression::Concat(parts) => {
            for part in parts {
                rewrite_expr(part, variants);
            }
        }
        Expression::Replicate { count, value } => {
            rewrite_expr(count, variants);
            for part in value {
                rewrite_expr(part, variants);
            }
        }
        Expression::MemRead { addr, .. } => rewrite_expr(addr, variants),
        Expression::Match { scrutinee, arms } => {
            rewrite_expr(scrutinee, variants);
            for arm in arms {
                rewrite_pattern(&mut arm.pattern, variants);
                rewrite_expr(&mut arm.value, variants);
            }
        }
        Expression::SysFunc { args, .. } => {
            for arg in args {
                if let crate::parser::SysFuncArg::Expr(e) = arg {
                    rewrite_expr(e, variants);
                }
            }
        }
        Expression::Call { args, .. } => {
            for arg in args {
                rewrite_expr(arg, variants);
            }
        }
        Expression::Literal(_) => {}
    }
}

fn rewrite_statements(
    stmts: &mut [crate::parser::Statement],
    widths: &HashMap<String, usize>,
    variants: &HashMap<String, VariantInfo>,
) {
    use crate::parser::Statement;
    for stmt in stmts {
        match stmt {
            Statement::Break | Statement::Continue => {}
            Statement::Cover(cover) => rewrite_expr(&mut cover.condition, variants),
            Statement::Assign { value, .. } => rewrite_expr(value, variants),
            Statement::MemWrite { addr, value, .. } => {
                rewrite_expr(addr, variants);
                rewrite_expr(value, variants);
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr(condition, variants);
                rewrite_statements(then_branch, widths, variants);
                if let Some(branch) = else_branch {
                    rewrite_statements(branch, widths, variants);
                }
            }
            Statement::Match { expr, arms } => {
                rewrite_expr(expr, variants);
                for arm in arms {
                    rewrite_pattern(&mut arm.pattern, variants);
                    rewrite_statements(&mut arm.body, widths, variants);
                }
            }
            Statement::For { range, body, .. } => {
                rewrite_expr(&mut range.start, variants);
                rewrite_expr(&mut range.end, variants);
                rewrite_statements(body, widths, variants);
            }
            Statement::While { condition, body } => {
                rewrite_expr(condition, variants);
                rewrite_statements(body, widths, variants);
            }
            Statement::LetLocal { ty, value, .. } => {
                if let Some(ty) = ty {
                    rewrite_type(ty, widths);
                }
                if let Some(value) = value {
                    rewrite_expr(value, variants);
                }
            }
            Statement::Assert(assert) => rewrite_expr(&mut assert.condition, variants),
            Statement::SysCall(call) => rewrite_expr(call, variants),
            Statement::SliceWrite {
                low, width, value, ..
            } => {
                rewrite_expr(low, variants);
                rewrite_expr(width, variants);
                rewrite_expr(value, variants);
            }
        }
    }
}

fn rewrite_seq_statements(
    stmts: &mut [crate::parser::SeqStatement],
    variants: &HashMap<String, VariantInfo>,
) {
    use crate::parser::SeqStatement;
    for stmt in stmts {
        match stmt {
            SeqStatement::Assign { value, .. } | SeqStatement::SignalWrite { value, .. } => {
                rewrite_expr(value, variants)
            }
            SeqStatement::MemWrite { addr, value, .. } => {
                rewrite_expr(addr, variants);
                rewrite_expr(value, variants);
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr(condition, variants);
                rewrite_seq_statements(then_branch, variants);
                if let Some(branch) = else_branch {
                    rewrite_seq_statements(branch, variants);
                }
            }
            SeqStatement::Assert(assert) => rewrite_expr(&mut assert.condition, variants),
            SeqStatement::SysCall(call) => rewrite_expr(call, variants),
            SeqStatement::For { range, body, .. } => {
                rewrite_expr(&mut range.start, variants);
                rewrite_expr(&mut range.end, variants);
                rewrite_seq_statements(body, variants);
            }
            SeqStatement::While { condition, body } => {
                rewrite_expr(condition, variants);
                rewrite_seq_statements(body, variants);
            }
            SeqStatement::Cover(cover) => rewrite_expr(&mut cover.condition, variants),
            SeqStatement::Delay(_)
            | SeqStatement::Await(_)
            | SeqStatement::Break
            | SeqStatement::Continue => {}
        }
    }
}

fn rewrite_fsm_actions(
    actions: &mut [crate::parser::FsmAction],
    variants: &HashMap<String, VariantInfo>,
) {
    use crate::parser::FsmAction;
    for action in actions {
        match action {
            FsmAction::Assign { value, .. } => rewrite_expr(value, variants),
            FsmAction::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr(condition, variants);
                rewrite_fsm_actions(then_branch, variants);
                if let Some(branch) = else_branch {
                    rewrite_fsm_actions(branch, variants);
                }
            }
            FsmAction::Goto(_) => {}
        }
    }
}

/// The interface a declaration carries, if it carries one
fn interface_for<'a>(
    interfaces: &'a HashMap<String, Interface>,
    ty: &Type,
) -> Option<&'a Interface> {
    match ty {
        Type::Named(name) => interfaces.get(name),
        _ => None,
    }
}

/// The view a port's direction names
fn view_for(interface: &Interface, direction: crate::parser::PortDirection) -> Option<&ViewDef> {
    use crate::parser::PortDirection;
    let wanted = match direction {
        PortDirection::Initiator => "initiator",
        PortDirection::Target => "target",
        PortDirection::Monitor => "monitor",
        _ => return None,
    };
    interface.views.iter().find(|v| v.name == wanted)
}

/// Which way a member is driven, seen from a port with this direction
fn member_direction(
    view: Option<&ViewDef>,
    member: &str,
    direction: crate::parser::PortDirection,
) -> crate::parser::PortDirection {
    use crate::parser::{PortDirection, ViewDirection};
    // A monitor observes everything
    if matches!(direction, PortDirection::Monitor) {
        return PortDirection::In;
    }
    match view.and_then(|v| v.signals.iter().find(|s| s.name == member)) {
        Some(signal) => match signal.direction {
            ViewDirection::In => PortDirection::In,
            ViewDirection::Out => PortDirection::Out,
            ViewDirection::InOut => PortDirection::InOut,
        },
        // A member the view does not mention is observed, not driven
        None => PortDirection::In,
    }
}

/// How an enumeration is laid out in bits
struct EnumLayout {
    /// Bits the tag occupies, at the bottom of the value
    tag_width: usize,
    /// Bits the whole value occupies
    width: usize,
    /// Each variant with its tag and the width of what it carries
    variants: Vec<(String, u64, usize)>,
}

/// What one variant needs, once the layout is known
#[derive(Clone, Copy)]
struct VariantInfo {
    width: usize,
    tag_width: usize,
    tag: u64,
    payload_width: usize,
}

/// `(payload << tag_width) | tag`, as an expression
fn tagged_value(info: VariantInfo, payload: Expression) -> Expression {
    let shifted = Expression::BinOp {
        op: crate::parser::BinOp::Shl,
        lhs: Box::new(Expression::MethodCall {
            receiver: Box::new(payload),
            method: "extend".to_string(),
            args: vec![Expression::Literal(Literal::Decimal {
                width: None,
                value: info.width as i64,
            })],
        }),
        rhs: Box::new(Expression::Literal(Literal::Decimal {
            width: None,
            value: info.tag_width as i64,
        })),
    };
    Expression::BinOp {
        op: crate::parser::BinOp::Or,
        lhs: Box::new(shifted),
        rhs: Box::new(Expression::Literal(Literal::Binary {
            width: info.width,
            value: info.tag,
        })),
    }
}

/// The composite a declaration names, if it names one
fn composite_for<'a>(
    structs: &'a HashMap<String, StructDecl>,
    ty: &Type,
) -> Option<&'a StructDecl> {
    match ty {
        Type::Named(name) => structs.get(name),
        _ => None,
    }
}

/// A union is as wide as its widest field
fn union_width(decl: &StructDecl) -> usize {
    decl.fields
        .iter()
        .map(|(_, ty)| ty.width().unwrap_or(1))
        .max()
        .unwrap_or(1)
}

/// Where each union's fields sit: every field starts at bit zero
fn union_layouts(structs: &HashMap<String, StructDecl>) -> HashMap<String, usize> {
    let mut out = HashMap::new();
    for decl in structs.values() {
        if !decl.is_union {
            continue;
        }
        for (field, ty) in &decl.fields {
            out.insert(
                format!("{}.{}", decl.name, field),
                ty.width().unwrap_or(1),
            );
        }
    }
    out
}

/// Rewrite every access to a union's field into a slice of the union
fn rewrite_module_unions(
    module: &mut Module,
    unions: &HashMap<String, String>,
    layouts: &HashMap<String, usize>,
) {
    use crate::parser::LogicBlock;

    let field_width = |name: &str, field: &str| -> Option<usize> {
        let ty = unions.get(name)?;
        layouts.get(&format!("{}.{}", ty, field)).copied()
    };

    for block in &mut module.logic_blocks {
        let statements = match block {
            LogicBlock::Comb(comb) => &mut comb.statements,
            LogicBlock::Sync(sync) => &mut sync.statements,
        };
        rewrite_union_statements(statements, &field_width);
    }
    for block in &mut module.seq_blocks {
        rewrite_union_seq(&mut block.statements, &field_width);
    }
    for block in &mut module.initial_blocks {
        rewrite_union_seq(&mut block.statements, &field_width);
    }
}

/// `u.field` becomes `u[width-1:0]`
fn rewrite_union_expr<F>(expr: &mut Expression, width_of: &F)
where
    F: Fn(&str, &str) -> Option<usize>,
{
    if let Expression::MethodCall {
        receiver,
        method,
        args,
    } = expr
    {
        if args.is_empty() {
            if let Expression::Ident(name) = receiver.as_ref() {
                if let Some(width) = width_of(name, method) {
                    *expr = Expression::Slice {
                        base: Box::new(Expression::Ident(name.clone())),
                        high: Box::new(literal_usize(width - 1)),
                        low: Box::new(literal_usize(0)),
                    };
                    return;
                }
            }
        }
    }

    match expr {
        Expression::BinOp { lhs, rhs, .. } => {
            rewrite_union_expr(lhs, width_of);
            rewrite_union_expr(rhs, width_of);
        }
        Expression::UnaryOp { expr, .. } => rewrite_union_expr(expr, width_of),
        Expression::Index { base, index } => {
            rewrite_union_expr(base, width_of);
            rewrite_union_expr(index, width_of);
        }
        Expression::Slice { base, .. } => rewrite_union_expr(base, width_of),
        Expression::PartSelect { base, index, .. } => {
            rewrite_union_expr(base, width_of);
            rewrite_union_expr(index, width_of);
        }
        Expression::MethodCall { receiver, args, .. } => {
            rewrite_union_expr(receiver, width_of);
            for arg in args {
                rewrite_union_expr(arg, width_of);
            }
        }
        Expression::If {
            condition,
            then_expr,
            else_expr,
        } => {
            rewrite_union_expr(condition, width_of);
            rewrite_union_expr(then_expr, width_of);
            rewrite_union_expr(else_expr, width_of);
        }
        Expression::Concat(parts) => {
            for part in parts {
                rewrite_union_expr(part, width_of);
            }
        }
        Expression::Replicate { count, value } => {
            rewrite_union_expr(count, width_of);
            for part in value {
                rewrite_union_expr(part, width_of);
            }
        }
        Expression::MemRead { addr, .. } => rewrite_union_expr(addr, width_of),
        Expression::Match { scrutinee, arms } => {
            rewrite_union_expr(scrutinee, width_of);
            for arm in arms {
                rewrite_union_expr(&mut arm.value, width_of);
            }
        }
        _ => {}
    }
}

/// A name written `u.field`, split into its parts
fn split_field(target: &str) -> Option<(&str, &str)> {
    let (name, field) = target.rsplit_once('.')?;
    Some((name, field))
}

fn literal_usize(value: usize) -> Expression {
    Expression::Literal(Literal::Decimal {
        width: None,
        value: value as i64,
    })
}

fn rewrite_union_statements<F>(stmts: &mut Vec<crate::parser::Statement>, width_of: &F)
where
    F: Fn(&str, &str) -> Option<usize>,
{
    use crate::parser::Statement;
    for stmt in stmts.iter_mut() {
        // An assignment to a field writes those bits of the union
        if let Statement::Assign { target, value } = stmt {
            if let Some((name, field)) = split_field(target) {
                if let Some(width) = width_of(name, field) {
                    let mut new_value = value.clone();
                    rewrite_union_expr(&mut new_value, width_of);
                    *stmt = Statement::SliceWrite {
                        target: name.to_string(),
                        low: literal_usize(0),
                        width: literal_usize(width),
                        value: new_value,
                    };
                    continue;
                }
            }
        }
        match stmt {
            Statement::Assign { value, .. } => rewrite_union_expr(value, width_of),
            Statement::MemWrite { addr, value, .. } => {
                rewrite_union_expr(addr, width_of);
                rewrite_union_expr(value, width_of);
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_union_expr(condition, width_of);
                rewrite_union_statements(then_branch, width_of);
                if let Some(branch) = else_branch {
                    rewrite_union_statements(branch, width_of);
                }
            }
            Statement::Match { expr, arms } => {
                rewrite_union_expr(expr, width_of);
                for arm in arms {
                    rewrite_union_statements(&mut arm.body, width_of);
                }
            }
            Statement::For { range, body, .. } => {
                rewrite_union_expr(&mut range.start, width_of);
                rewrite_union_expr(&mut range.end, width_of);
                rewrite_union_statements(body, width_of);
            }
            Statement::While { condition, body } => {
                rewrite_union_expr(condition, width_of);
                rewrite_union_statements(body, width_of);
            }
            Statement::LetLocal { value, .. } => {
                if let Some(value) = value {
                    rewrite_union_expr(value, width_of);
                }
            }
            Statement::Assert(assert) => rewrite_union_expr(&mut assert.condition, width_of),
            Statement::Cover(cover) => rewrite_union_expr(&mut cover.condition, width_of),
            Statement::SysCall(call) => rewrite_union_expr(call, width_of),
            Statement::SliceWrite { value, .. } => rewrite_union_expr(value, width_of),
            Statement::Break | Statement::Continue => {}
        }
    }
}

fn rewrite_union_seq<F>(stmts: &mut Vec<crate::parser::SeqStatement>, width_of: &F)
where
    F: Fn(&str, &str) -> Option<usize>,
{
    use crate::parser::SeqStatement;
    for stmt in stmts.iter_mut() {
        match stmt {
            SeqStatement::Assign { value, .. } | SeqStatement::SignalWrite { value, .. } => {
                rewrite_union_expr(value, width_of)
            }
            SeqStatement::MemWrite { addr, value, .. } => {
                rewrite_union_expr(addr, width_of);
                rewrite_union_expr(value, width_of);
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_union_expr(condition, width_of);
                rewrite_union_seq(then_branch, width_of);
                if let Some(branch) = else_branch {
                    rewrite_union_seq(branch, width_of);
                }
            }
            SeqStatement::Assert(assert) => rewrite_union_expr(&mut assert.condition, width_of),
            SeqStatement::Cover(cover) => rewrite_union_expr(&mut cover.condition, width_of),
            SeqStatement::SysCall(call) => rewrite_union_expr(call, width_of),
            SeqStatement::For { range, body, .. } => {
                rewrite_union_expr(&mut range.start, width_of);
                rewrite_union_expr(&mut range.end, width_of);
                rewrite_union_seq(body, width_of);
            }
            SeqStatement::While { condition, body } => {
                rewrite_union_expr(condition, width_of);
                rewrite_union_seq(body, width_of);
            }
            SeqStatement::Delay(_)
            | SeqStatement::Await(_)
            | SeqStatement::Break
            | SeqStatement::Continue => {}
        }
    }
}

/// How deep a function may call into others before we give up
const MAX_INLINE_DEPTH: usize = 16;

/// Replace a call with the function's body, parameters substituted
fn inline_call(expr: &mut Expression, functions: &HashMap<String, FnDecl>, depth: usize) {
    let Expression::Call { name, args } = expr else {
        return;
    };
    if depth >= MAX_INLINE_DEPTH {
        return;
    }
    let Some(decl) = functions.get(name.as_str()) else {
        return;
    };

    let mut bound: HashMap<String, Expression> = HashMap::new();
    for ((param, _), arg) in decl.params.iter().zip(args.iter()) {
        let mut arg = arg.clone();
        // An argument may itself be a call
        rewrite_expr_tree(&mut arg, &mut |e| inline_call(e, functions, depth + 1));
        bound.insert(param.clone(), arg);
    }

    // A binding may use the parameters and the bindings before it
    for (name, value) in &decl.bindings {
        let mut value = value.clone();
        substitute_params(&mut value, &bound);
        rewrite_expr_tree(&mut value, &mut |e| inline_call(e, functions, depth + 1));
        bound.insert(name.clone(), value);
    }

    let mut body = decl.body.clone();
    substitute_params(&mut body, &bound);
    rewrite_expr_tree(&mut body, &mut |e| inline_call(e, functions, depth + 1));
    *expr = body;
}

/// Replace parameter names in a function body with the arguments given
fn substitute_params(expr: &mut Expression, bound: &HashMap<String, Expression>) {
    rewrite_expr_tree(expr, &mut |e| {
        if let Expression::Ident(name) = e {
            if let Some(value) = bound.get(name.as_str()) {
                *e = value.clone();
            }
        }
    });
}

/// Apply a rewrite to an expression and everything inside it
fn rewrite_expr_tree<F>(expr: &mut Expression, f: &mut F)
where
    F: FnMut(&mut Expression),
{
    f(expr);
    match expr {
        Expression::BinOp { lhs, rhs, .. } => {
            rewrite_expr_tree(lhs, f);
            rewrite_expr_tree(rhs, f);
        }
        Expression::UnaryOp { expr, .. } => rewrite_expr_tree(expr, f),
        Expression::Index { base, index } => {
            rewrite_expr_tree(base, f);
            rewrite_expr_tree(index, f);
        }
        Expression::Slice { base, high, low } => {
            rewrite_expr_tree(base, f);
            rewrite_expr_tree(high, f);
            rewrite_expr_tree(low, f);
        }
        Expression::PartSelect {
            base, index, width, ..
        } => {
            rewrite_expr_tree(base, f);
            rewrite_expr_tree(index, f);
            rewrite_expr_tree(width, f);
        }
        Expression::MethodCall { receiver, args, .. } => {
            rewrite_expr_tree(receiver, f);
            for arg in args {
                rewrite_expr_tree(arg, f);
            }
        }
        Expression::Call { args, .. } => {
            for arg in args {
                rewrite_expr_tree(arg, f);
            }
        }
        Expression::If {
            condition,
            then_expr,
            else_expr,
        } => {
            rewrite_expr_tree(condition, f);
            rewrite_expr_tree(then_expr, f);
            rewrite_expr_tree(else_expr, f);
        }
        Expression::Concat(parts) => {
            for part in parts {
                rewrite_expr_tree(part, f);
            }
        }
        Expression::Replicate { count, value } => {
            rewrite_expr_tree(count, f);
            for part in value {
                rewrite_expr_tree(part, f);
            }
        }
        Expression::MemRead { addr, .. } => rewrite_expr_tree(addr, f),
        Expression::Match { scrutinee, arms } => {
            rewrite_expr_tree(scrutinee, f);
            for arm in arms {
                rewrite_expr_tree(&mut arm.value, f);
            }
        }
        Expression::SysFunc { args, .. } => {
            for arg in args {
                if let crate::parser::SysFuncArg::Expr(e) = arg {
                    rewrite_expr_tree(e, f);
                }
            }
        }
        Expression::Literal(_) | Expression::Ident(_) => {}
    }
}

/// Apply a rewrite to every expression a module contains
fn rewrite_module_exprs<F>(module: &mut Module, f: &mut F)
where
    F: FnMut(&mut Expression),
{
    use crate::parser::LogicBlock;

    for signal in &mut module.signals {
        if let Some(init) = signal.init_value.as_mut() {
            rewrite_expr_tree(init, f);
        }
    }
    for block in &mut module.logic_blocks {
        let statements = match block {
            LogicBlock::Comb(comb) => &mut comb.statements,
            LogicBlock::Sync(sync) => &mut sync.statements,
        };
        rewrite_stmt_exprs(statements, f);
    }
    for block in &mut module.seq_blocks {
        rewrite_seq_exprs(&mut block.statements, f);
    }
    for block in &mut module.initial_blocks {
        rewrite_seq_exprs(&mut block.statements, f);
    }
    for fsm in &mut module.fsm_blocks {
        for state in &mut fsm.states {
            for (_, expr) in &mut state.moore_outputs {
                rewrite_expr_tree(expr, f);
            }
        }
        for transition in &mut fsm.transitions {
            for clause in &mut transition.when_clauses {
                rewrite_expr_tree(&mut clause.condition, f);
                rewrite_fsm_action_exprs(&mut clause.actions, f);
            }
        }
        for output in &mut fsm.outputs {
            for (_, expr) in &mut output.mappings {
                rewrite_expr_tree(expr, f);
            }
        }
    }
    for inst in &mut module.instances {
        for (_, expr) in &mut inst.port_connections {
            rewrite_expr_tree(expr, f);
        }
    }
}

fn rewrite_fsm_action_exprs<F>(actions: &mut [crate::parser::FsmAction], f: &mut F)
where
    F: FnMut(&mut Expression),
{
    use crate::parser::FsmAction;
    for action in actions {
        match action {
            FsmAction::Assign { value, .. } => rewrite_expr_tree(value, f),
            FsmAction::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr_tree(condition, f);
                rewrite_fsm_action_exprs(then_branch, f);
                if let Some(branch) = else_branch {
                    rewrite_fsm_action_exprs(branch, f);
                }
            }
            FsmAction::Goto(_) => {}
        }
    }
}

fn rewrite_stmt_exprs<F>(stmts: &mut [crate::parser::Statement], f: &mut F)
where
    F: FnMut(&mut Expression),
{
    use crate::parser::Statement;
    for stmt in stmts {
        match stmt {
            Statement::Assign { value, .. } => rewrite_expr_tree(value, f),
            Statement::MemWrite { addr, value, .. } => {
                rewrite_expr_tree(addr, f);
                rewrite_expr_tree(value, f);
            }
            Statement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr_tree(condition, f);
                rewrite_stmt_exprs(then_branch, f);
                if let Some(branch) = else_branch {
                    rewrite_stmt_exprs(branch, f);
                }
            }
            Statement::Match { expr, arms } => {
                rewrite_expr_tree(expr, f);
                for arm in arms {
                    rewrite_stmt_exprs(&mut arm.body, f);
                }
            }
            Statement::For { range, body, .. } => {
                rewrite_expr_tree(&mut range.start, f);
                rewrite_expr_tree(&mut range.end, f);
                rewrite_stmt_exprs(body, f);
            }
            Statement::While { condition, body } => {
                rewrite_expr_tree(condition, f);
                rewrite_stmt_exprs(body, f);
            }
            Statement::LetLocal { value, .. } => {
                if let Some(value) = value {
                    rewrite_expr_tree(value, f);
                }
            }
            Statement::Assert(assert) => rewrite_expr_tree(&mut assert.condition, f),
            Statement::Cover(cover) => rewrite_expr_tree(&mut cover.condition, f),
            Statement::SysCall(call) => rewrite_expr_tree(call, f),
            Statement::SliceWrite {
                low, width, value, ..
            } => {
                rewrite_expr_tree(low, f);
                rewrite_expr_tree(width, f);
                rewrite_expr_tree(value, f);
            }
            Statement::Break | Statement::Continue => {}
        }
    }
}

fn rewrite_seq_exprs<F>(stmts: &mut [crate::parser::SeqStatement], f: &mut F)
where
    F: FnMut(&mut Expression),
{
    use crate::parser::SeqStatement;
    for stmt in stmts {
        match stmt {
            SeqStatement::Assign { value, .. } | SeqStatement::SignalWrite { value, .. } => {
                rewrite_expr_tree(value, f)
            }
            SeqStatement::MemWrite { addr, value, .. } => {
                rewrite_expr_tree(addr, f);
                rewrite_expr_tree(value, f);
            }
            SeqStatement::If {
                condition,
                then_branch,
                else_branch,
            } => {
                rewrite_expr_tree(condition, f);
                rewrite_seq_exprs(then_branch, f);
                if let Some(branch) = else_branch {
                    rewrite_seq_exprs(branch, f);
                }
            }
            SeqStatement::Assert(assert) => rewrite_expr_tree(&mut assert.condition, f),
            SeqStatement::Cover(cover) => rewrite_expr_tree(&mut cover.condition, f),
            SeqStatement::SysCall(call) => rewrite_expr_tree(call, f),
            SeqStatement::For { range, body, .. } => {
                rewrite_expr_tree(&mut range.start, f);
                rewrite_expr_tree(&mut range.end, f);
                rewrite_seq_exprs(body, f);
            }
            SeqStatement::While { condition, body } => {
                rewrite_expr_tree(condition, f);
                rewrite_seq_exprs(body, f);
            }
            SeqStatement::Delay(_)
            | SeqStatement::Await(_)
            | SeqStatement::Break
            | SeqStatement::Continue => {}
        }
    }
}

/// What one source file declared and imported
#[derive(Clone, Debug)]
struct FileScope {
    package: Option<String>,
    imports: Vec<(String, Vec<String>)>,
    exports: Vec<String>,
    /// Each declaration as written, and its qualified name
    declared: Vec<(String, String)>,
    /// The qualified names of the modules declared here
    modules: Vec<String>,
}

/// Rewrite the names a module uses to the declarations they resolve to
fn resolve_module_names(module: &mut Module, visible: &HashMap<String, String>) {
    let resolve = |name: &str| visible.get(name).cloned();

    for port in &mut module.ports {
        resolve_type_name(&mut port.ty, &resolve);
    }
    for signal in &mut module.signals {
        resolve_type_name(&mut signal.ty, &resolve);
    }
    for mem in &mut module.memories {
        resolve_type_name(&mut mem.element_type, &resolve);
    }
    for inst in &mut module.instances {
        if let Some(target) = resolve(&inst.module_name) {
            inst.module_name = target;
        }
    }
    rewrite_module_exprs(module, &mut |expr| match expr {
        Expression::Call { name, .. } => {
            if let Some(target) = resolve(name) {
                *name = target;
            }
        }
        // `Colour::Red` names its enumeration first
        Expression::Ident(name) => {
            if let Some((base, rest)) = name.split_once("::") {
                if let Some(target) = resolve(base) {
                    *name = format!("{}::{}", target, rest);
                }
            }
        }
        _ => {}
    });
}

fn resolve_type_name<F>(ty: &mut Type, resolve: &F)
where
    F: Fn(&str) -> Option<String>,
{
    match ty {
        Type::Named(name) => {
            if let Some(target) = resolve(name) {
                *name = target;
            }
        }
        Type::Array { element, .. } => resolve_type_name(element, resolve),
        _ => {}
    }
}
