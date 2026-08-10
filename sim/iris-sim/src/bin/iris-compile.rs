//! IRIS-COMPILE: compile an IRIS design to a standalone Rust simulation
//!
//! The generated program links against `iris-runtime` and simulates the design
//! on its own, without the parser or the interpreter. It accepts the same
//! designs `iris-sim` does, including multiple clock domains, memories and FSMs.

use anyhow::{Context, Result};
use clap::Parser as ClapParser;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use iris_sim::compile::SimGenerator;
use iris_sim::project::Project;

/// IRIS-COMPILE: generate a standalone Rust simulation from IRIS source
#[derive(ClapParser, Debug)]
#[command(author, version, about = "Compile IRIS to a standalone Rust simulation", long_about = None)]
struct Args {
    /// Input IRIS file path(s)
    #[arg(short, long, num_args = 1..)]
    input: Vec<PathBuf>,

    /// Output path: a `.rs` file to write the source, anything else to build a binary
    #[arg(short, long)]
    output: PathBuf,

    /// Build the generated code even when the output is a `.rs` file
    #[arg(long, default_value = "false")]
    build: bool,

    /// Build with optimisations (implies --build)
    #[arg(long, default_value = "false")]
    release: bool,

    /// Path to the iris-runtime crate
    #[arg(long)]
    runtime_path: Option<PathBuf>,

    /// Top module name (auto-detected if not given)
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
        println!("Parsing IRIS source code...");
    }

    let mut project = if args.input.len() == 1 {
        Project::load_single(&args.input[0])
            .with_context(|| format!("Failed to load file: {}", args.input[0].display()))?
    } else {
        let paths: Vec<&Path> = args.input.iter().map(|p| p.as_path()).collect();
        Project::load_files(&paths).with_context(|| "Failed to load project files")?
    };

    if let Some(ref top) = args.top {
        project
            .set_top(top)
            .with_context(|| format!("Failed to set top module: {}", top))?;
        project.elaborate();
    }

    project
        .validate_references()
        .with_context(|| "Project validation failed")?;
    project
        .check_circular_instantiation()
        .with_context(|| "Circular instantiation detected")?;

    // The same static checks the interpreter runs, in the same format
    let diagnostics = iris_sim::check::check_project(&project);
    if !diagnostics.is_empty() {
        eprint!("{}", iris_sim::check::format_diagnostics(&diagnostics));
        eprintln!();
    }
    if iris_sim::check::has_errors(&diagnostics) {
        anyhow::bail!("static checks failed; nothing generated");
    }

    let top_name = project
        .top_module
        .clone()
        .ok_or_else(|| anyhow::anyhow!("no top module"))?;

    if args.verbose {
        println!("  Top module: {}", top_name);
        println!("  Modules: {}", project.modules.len());
        println!();
        println!("Generating Rust code...");
    }

    // Assertion reports name a source file, as the interpreter's do
    let source_label = args
        .input
        .last()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "<source>".to_string());

    let rust_code = SimGenerator::new(project)
        .map(|generator| generator.with_source(&source_label))
        .and_then(|generator| generator.generate())
        .with_context(|| "Code generation failed")?;

    let sim_name = top_name.to_lowercase();
    let output_is_rust = args.output.extension().map_or(false, |e| e == "rs");
    let should_build = args.build || args.release || !output_is_rust;

    if !should_build {
        fs::write(&args.output, &rust_code)
            .with_context(|| format!("Failed to write {}", args.output.display()))?;
        println!("Code generation completed!");
        println!("  Output: {}", args.output.display());
        return Ok(());
    }

    // Build a small cargo project around the generated source
    let project_dir = args.output.parent().unwrap_or(Path::new("."));
    // The cargo project is named after the output, not the module, so that
    // `-o counter_sim` for a module called `Counter` cannot land the binary on
    // top of the directory being built in
    let output_stem = args
        .output
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| sim_name.clone());
    let sim_dir = project_dir.join(format!("{}_build", output_stem));
    if sim_dir == args.output {
        anyhow::bail!(
            "output path {} collides with the build directory; choose another name",
            args.output.display()
        );
    }
    fs::create_dir_all(sim_dir.join("src"))?;

    let main_path = sim_dir.join("src/main.rs");
    fs::write(&main_path, &rust_code)?;

    let runtime_path = args
        .runtime_path
        .unwrap_or_else(|| default_runtime_path(project_dir));
    let runtime_rel = if runtime_path.is_absolute() {
        runtime_path.to_string_lossy().to_string()
    } else {
        let absolute = std::env::current_dir()?.join(&runtime_path);
        pathdiff::diff_paths(&absolute, &sim_dir)
            .unwrap_or(runtime_path.clone())
            .to_string_lossy()
            .to_string()
    };

    fs::write(
        sim_dir.join("Cargo.toml"),
        SimGenerator::cargo_toml(&sim_name, &runtime_rel),
    )?;

    if args.verbose {
        println!("  Wrote: {}", main_path.display());
        println!();
        println!("Building simulation...");
    }

    let mut command = Command::new("cargo");
    command.current_dir(&sim_dir).arg("build");
    if args.release {
        command.arg("--release");
    }
    let status = command.status().with_context(|| "Failed to run cargo build")?;
    if !status.success() {
        anyhow::bail!("Build failed");
    }

    let profile = if args.release { "release" } else { "debug" };
    // Cargo puts the binary under CARGO_TARGET_DIR when that is set
    let target_root = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| sim_dir.join("target"));
    let built = target_root.join(profile).join(format!("{}-sim", sim_name));

    if !output_is_rust {
        fs::copy(&built, &args.output).with_context(|| {
            format!(
                "Failed to copy {} to {}",
                built.display(),
                args.output.display()
            )
        })?;
    }

    println!();
    println!("Build completed successfully!");
    println!("  Binary: {}", args.output.display());
    println!("  Source: {}", main_path.display());
    Ok(())
}

/// Where iris-runtime sits, found rather than guessed
///
/// The crate lives at `sim/iris-runtime` in the project. Guessing a fixed
/// number of `..` from the output directory only works when the output happens
/// to sit at the depth the guess assumed: building into
/// `example/riscv/sim/compiled/` used to look for `example/riscv/iris-runtime`
/// and fail. Walk up from the output and from this binary until the crate is
/// found, and fall back to the old guess so nothing that worked stops working.
fn default_runtime_path(project_dir: &Path) -> PathBuf {
    fn search_upward(start: &Path) -> Option<PathBuf> {
        let mut dir = start.canonicalize().ok()?;
        loop {
            for relative in ["sim/iris-runtime", "iris-runtime"] {
                let candidate = dir.join(relative);
                if candidate.join("Cargo.toml").exists() {
                    return Some(candidate);
                }
            }
            if !dir.pop() {
                return None;
            }
        }
    }

    // Next to iris-sim, which is where it lives in a normal checkout
    let beside = project_dir.join("../iris-runtime");
    if beside.join("Cargo.toml").exists() {
        return beside;
    }

    if let Some(found) = search_upward(project_dir) {
        return found;
    }

    // The running binary sits under the project's target directory, so walking
    // up from it finds the crate even when the output is somewhere else
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Some(found) = search_upward(dir) {
                return found;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if let Some(found) = search_upward(&cwd) {
            return found;
        }
    }

    PathBuf::from("../iris-runtime")
}
