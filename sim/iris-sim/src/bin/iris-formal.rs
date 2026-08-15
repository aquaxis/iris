//! IRIS-FORMAL: emit a reference SystemVerilog model for equivalence checking
//!
//! The model this emits is the one `iris2sv`'s output is proven against. Both
//! come from the same IRIS source and from nothing else in common: this walks
//! the AST `iris.pest` produces, `iris2sv` walks its own.
//!
//! See tools/formal/run.sh for the flow that consumes this.

use anyhow::{Context, Result};
use clap::Parser as ClapParser;
use std::path::{Path, PathBuf};

use iris_sim::formal::emit_project;
use iris_sim::project::Project;

/// IRIS-FORMAL: generate a reference SystemVerilog model from IRIS source
#[derive(ClapParser, Debug)]
#[command(author, version, about = "Emit a reference model for formal equivalence checking", long_about = None)]
struct Args {
    /// Input IRIS file path(s)
    #[arg(short, long, num_args = 1..)]
    input: Vec<PathBuf>,

    /// Output directory, or a `.sv` file
    #[arg(short, long)]
    output: PathBuf,

    /// Verbose output
    #[arg(short, long, default_value = "false")]
    verbose: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let mut project = if args.input.len() == 1 {
        Project::load_single(&args.input[0])
            .with_context(|| format!("Failed to load file: {}", args.input[0].display()))?
    } else {
        let paths: Vec<&Path> = args.input.iter().map(|p| p.as_path()).collect();
        Project::load_files(&paths).with_context(|| "Failed to load project files")?
    };

    project
        .validate_references()
        .with_context(|| "Project validation failed")?;
    project
        .check_circular_instantiation()
        .with_context(|| "Circular instantiation detected")?;

    // A construct the reference model cannot express is an error, not a note.
    // Emitting a model that quietly leaves something out would prove a
    // statement about a circuit nobody wrote.
    let text = emit_project(&project).map_err(|e| anyhow::anyhow!("{}", e))?;

    let path = if args.output.extension().and_then(|e| e.to_str()) == Some("sv") {
        args.output.clone()
    } else {
        std::fs::create_dir_all(&args.output).with_context(|| {
            format!("Failed to create directory: {}", args.output.display())
        })?;
        args.output.join("reference.sv")
    };

    std::fs::write(&path, text)
        .with_context(|| format!("Failed to write: {}", path.display()))?;

    if args.verbose {
        println!("Reference model written to {}", path.display());
    }

    Ok(())
}
