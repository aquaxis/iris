//! IRIS-COMPILE: IRIS to Rust Code Compiler
//!
//! Generates standalone Rust simulation code from IRIS source files.
//! Requires a 'test' declaration with DUT module instantiation.

use anyhow::{Context, Result};
use clap::Parser as ClapParser;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use iris_sim::compile::TestCodeGenerator;
use iris_sim::project::Project;

/// IRIS-COMPILE: Generate standalone Rust simulation code from IRIS test and DUT modules
#[derive(ClapParser, Debug)]
#[command(author, version, about = "Generate Rust simulation code (requires test + mod files)", long_about = None)]
struct Args {
    /// Input IRIS file path(s)
    #[arg(short, long, num_args = 1..)]
    input: Vec<PathBuf>,

    /// Output file path (.rs for source, no extension for binary)
    #[arg(short, long)]
    output: PathBuf,

    /// Build the generated code (requires cargo)
    #[arg(long, default_value = "false")]
    build: bool,

    /// Use release mode for build (implies --build)
    #[arg(long, default_value = "false")]
    release: bool,

    /// Path to iris-runtime crate (default: ../iris-runtime)
    #[arg(long)]
    runtime_path: Option<PathBuf>,

    /// Top module name (auto-detected if not specified)
    #[arg(short, long)]
    top: Option<String>,

    /// Verbose output
    #[arg(short, long, default_value = "false")]
    verbose: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();

    if args.verbose {
        println!("IRIS-COMPILE v{}", env!("CARGO_PKG_VERSION"));
        for (i, input) in args.input.iter().enumerate() {
            println!("Input file {}: {}", i + 1, input.display());
        }
        println!("Output: {}", args.output.display());
        println!();
    }

    // Load project
    if args.verbose {
        println!("Parsing IRIS source code...");
    }

    let mut project = if args.input.len() == 1 {
        Project::load_single(&args.input[0])
            .with_context(|| format!("Failed to load file: {}", args.input[0].display()))?
    } else {
        let paths: Vec<&std::path::Path> = args.input.iter().map(|p| p.as_path()).collect();
        Project::load_files(&paths).with_context(|| "Failed to load project files")?
    };

    // Set top module if specified
    if let Some(ref top) = args.top {
        project
            .set_top(top)
            .with_context(|| format!("Failed to set top module: {}", top))?;
    }

    // Validate project
    project
        .validate_references()
        .with_context(|| "Project validation failed")?;

    // Check if project has test module (required)
    if !project.has_test_module() {
        anyhow::bail!(
            "No test module found. iris-compile requires a 'test' declaration.\n\
             Example:\n\
               test MyTest {{\n\
                   let clk: clock;\n\
                   let rst: reset;\n\
                   inst dut = MyModule {{ ... }};\n\
               }}"
        );
    }

    // Get test module name
    let test_module = project.find_test_module()
        .ok_or_else(|| anyhow::anyhow!("Test module not found"))?;
    let top_module_name = test_module.name.clone();

    if args.verbose {
        println!("  Test module: {}", top_module_name);
        println!("  DUT modules: {}", project.modules.len() - 1);
        println!();
    }

    // Generate Rust code
    if args.verbose {
        println!("Generating Rust code...");
    }

    let mut generator = TestCodeGenerator::new();
    let rust_code = generator
        .generate(&project)
        .with_context(|| "Test code generation failed")?;
    let sim_name = top_module_name.to_lowercase();

    // Determine output paths
    let output_is_rust = args.output.extension().map_or(false, |e| e == "rs");
    let rust_file_path = if output_is_rust {
        args.output.clone()
    } else {
        args.output.with_extension("rs")
    };

    // Determine runtime path
    let runtime_path = args.runtime_path.unwrap_or_else(|| {
        // Try to find iris-runtime relative to the output
        let candidate = args.output.parent().unwrap_or(std::path::Path::new("."));
        candidate.join("../iris-runtime")
    });

    // Check if building
    let should_build = args.build || args.release || !output_is_rust;

    if should_build {
        // Create a temporary project directory
        let project_dir = args.output.parent().unwrap_or(std::path::Path::new("."));
        let sim_dir = project_dir.join(format!("{}_sim", sim_name));

        if args.verbose {
            println!("Creating project directory: {}", sim_dir.display());
        }

        // Create directory structure
        fs::create_dir_all(sim_dir.join("src"))?;

        // Write main.rs
        let main_path = sim_dir.join("src/main.rs");
        fs::write(&main_path, &rust_code)?;

        if args.verbose {
            println!("  Wrote: {}", main_path.display());
        }

        // Generate and write Cargo.toml
        let runtime_rel_path = if runtime_path.is_absolute() {
            runtime_path.to_string_lossy().to_string()
        } else {
            // Make runtime path relative to sim_dir
            let abs_runtime = std::env::current_dir()?.join(&runtime_path);
            pathdiff::diff_paths(&abs_runtime, &sim_dir)
                .unwrap_or(runtime_path.clone())
                .to_string_lossy()
                .to_string()
        };

        // Generate Cargo.toml using the appropriate generator
        let cargo_toml = generator.generate_cargo_toml(&sim_name, &runtime_rel_path);
        let cargo_path = sim_dir.join("Cargo.toml");
        fs::write(&cargo_path, cargo_toml)?;

        if args.verbose {
            println!("  Wrote: {}", cargo_path.display());
        }

        // Build the project
        if args.verbose {
            println!();
            println!("Building simulation...");
        }

        let mut cmd = Command::new("cargo");
        cmd.current_dir(&sim_dir).arg("build");

        if args.release {
            cmd.arg("--release");
        }

        let status = cmd.status().with_context(|| "Failed to run cargo build")?;

        if !status.success() {
            anyhow::bail!("Build failed");
        }

        // Copy binary to output location
        let build_dir = if args.release { "release" } else { "debug" };
        let binary_name = format!("{}-sim", sim_name);
        let built_binary = sim_dir.join("target").join(build_dir).join(&binary_name);

        if !output_is_rust {
            if args.verbose {
                println!("Copying binary to: {}", args.output.display());
            }
            fs::copy(&built_binary, &args.output)?;
        }

        println!();
        println!("Build completed successfully!");
        println!("  Binary: {}", args.output.display());
        println!("  Source: {}", main_path.display());
    } else {
        // Just write the Rust source file
        fs::write(&rust_file_path, &rust_code)?;

        println!("Code generation completed!");
        println!("  Output: {}", rust_file_path.display());
    }

    Ok(())
}
