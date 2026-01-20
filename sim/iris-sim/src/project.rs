//! Project management for multi-file IRIS designs
//!
//! This module provides the Project struct for managing multiple IRIS modules
//! and their relationships.

use std::collections::HashMap;
use std::path::Path;

use thiserror::Error;

use crate::parser::{Module, Parser, ParseError};

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
    /// Top module name
    pub top_module: Option<String>,
}

impl Project {
    /// Create a new empty project
    pub fn new() -> Self {
        Self {
            modules: HashMap::new(),
            top_module: None,
        }
    }

    /// Load a single file as a project
    pub fn load_single(path: &Path) -> Result<Self, ProjectError> {
        let source = std::fs::read_to_string(path)?;
        let parser = Parser::new();
        let module = parser.parse(&source)?;

        let mut project = Self::new();
        let module_name = module.name.clone();
        project.modules.insert(module.name.clone(), module);
        project.top_module = Some(module_name);

        Ok(project)
    }

    /// Load multiple files as a project
    pub fn load_files(paths: &[&Path]) -> Result<Self, ProjectError> {
        let mut project = Self::new();
        let parser = Parser::new();

        for path in paths {
            let source = std::fs::read_to_string(path)?;

            // Parse file - may contain multiple modules
            let module = parser.parse(&source)?;

            if project.modules.contains_key(&module.name) {
                return Err(ProjectError::DuplicateModule(module.name.clone()));
            }

            project.modules.insert(module.name.clone(), module);
        }

        // Auto-detect top module if not specified
        // Priority: 1. test modules (is_test == true)
        //           2. modules with "TB" or "Testbench" in name
        //           3. single module
        project.auto_detect_top();

        Ok(project)
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
