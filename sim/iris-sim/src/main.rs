//! IRIS-SIM: IRIS RTL Simulator CLI
//!
//! Command-line interface for simulating IRIS hardware designs.

use anyhow::{Context, Result};
use clap::Parser as ClapParser;
use std::path::PathBuf;

use iris_sim::fst::{VcdWriter, WaveWriter};
use iris_sim::project::Project;
use iris_sim::parser::AssertSeverity;
use iris_sim::sim::{AssertionFailure, HierarchicalSimulator, MetastabilityWarning};

/// IRIS-SIM: A simulator for IRIS hardware description language
#[derive(ClapParser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input IRIS file path(s) - can specify multiple files
    #[arg(short, long, num_args = 1..)]
    input: Vec<PathBuf>,

    /// Output waveform file path (.vcd)
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Number of simulation cycles
    #[arg(short, long, default_value = "100")]
    cycles: u64,

    /// Top module name (auto-detected if not specified)
    #[arg(short, long)]
    top: Option<String>,

    /// Verbose output
    #[arg(short, long, default_value = "false")]
    verbose: bool,

    /// Enable metastability warnings (async reset deassert coinciding with clock edge)
    #[arg(short = 'W', long = "warn-metastability", default_value = "false")]
    warn_metastability: bool,
}

/// Print metastability warnings in a formatted style
fn print_metastability_warnings(warnings: &[MetastabilityWarning]) {
    use std::collections::HashSet;

    // Deduplicate warnings (same module/signal combination)
    let mut seen: HashSet<(String, String, String)> = HashSet::new();

    for warning in warnings {
        let key = (
            warning.module_path.clone(),
            warning.clock_signal.clone(),
            warning.reset_signal.clone(),
        );

        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);

        // Convert time from ps to ns for display
        let time_ns = warning.time as f64 / 1000.0;

        eprintln!();
        eprintln!("warning[W001]: potential metastability risk");
        eprintln!("  --> {}:sync({}.{}, {}.async)",
            warning.module_path,
            warning.clock_signal,
            warning.clock_edge,
            warning.reset_signal);
        eprintln!("   |");
        eprintln!("   = note: async reset '{}' deasserts at time {:.1}ns, coinciding with '{}' {}",
            warning.reset_signal,
            time_ns,
            warning.clock_signal,
            warning.clock_edge);
        eprintln!("   = help: consider using a reset synchronizer to safely release reset");
    }

    if !seen.is_empty() {
        eprintln!();
    }
}

/// Print assertion failures in a formatted style
fn print_assertion_failures(failures: &[AssertionFailure], input_files: &[PathBuf]) -> bool {
    if failures.is_empty() {
        return false;
    }

    eprintln!();
    eprintln!("=== Assertion Failures ===");

    for (i, failure) in failures.iter().enumerate() {
        let time_ns = failure.time as f64 / 1000.0;
        // A warning is reported but does not fail the run
        let kind = match failure.severity {
            AssertSeverity::Warning => "warning",
            _ => "error",
        };

        eprintln!();
        eprintln!("{}[A{:03}]: assertion failed", kind, i + 1);

        // Print source location if available
        if let Some(ref span) = failure.span {
            // Try to find the file that contains this line
            let file_hint = if !input_files.is_empty() {
                input_files.last().map(|p| p.display().to_string()).unwrap_or_else(|| "<source>".to_string())
            } else {
                "<source>".to_string()
            };
            eprintln!("  --> {}:{}:{}", file_hint, span.start_line, span.start_col);
        }

        eprintln!("   |");
        eprintln!("   | assert {}", failure.condition);
        eprintln!("   |");

        // Print evaluated values for comparison expressions
        if let (Some(ref lhs), Some(ref rhs)) = (&failure.lhs_value, &failure.rhs_value) {
            eprintln!("   = note: left  = {}", lhs);
            eprintln!("   = note: right = {}", rhs);
        }

        // Print custom message if provided
        if let Some(ref msg) = failure.message {
            eprintln!("   = message: \"{}\"", msg);
        }

        eprintln!("   = time: {:.1}ns ({} ps)", time_ns, failure.time);
    }

    let fatal = failures
        .iter()
        .filter(|f| f.severity != AssertSeverity::Warning)
        .count();
    let warnings = failures.len() - fatal;

    eprintln!();
    eprintln!(
        "assertion failure summary: {} failed, {} warning(s)",
        fatal, warnings
    );
    eprintln!();

    // Warnings alone do not fail the run
    fatal > 0
}

fn main() -> Result<()> {
    let args = Args::parse();

    if args.verbose {
        println!("IRIS-SIM v{}", env!("CARGO_PKG_VERSION"));
        for (i, input) in args.input.iter().enumerate() {
            println!("Input file {}: {}", i + 1, input.display());
        }
        if let Some(ref output) = args.output {
            println!("Output file: {}", output.display());
            println!("Output format: VCD");
        }
        if let Some(ref top) = args.top {
            println!("Top module: {}", top);
        }
        println!("Simulation cycles: {}", args.cycles);
        println!();
    }

    if args.verbose {
        println!("Parsing IRIS source code...");
    }

    // 1. Load project (single or multiple files)
    let mut project = if args.input.len() == 1 {
        Project::load_single(&args.input[0])
            .with_context(|| format!("Failed to load file: {}", args.input[0].display()))?
    } else {
        let paths: Vec<&std::path::Path> = args.input.iter().map(|p| p.as_path()).collect();
        Project::load_files(&paths)
            .with_context(|| "Failed to load project files")?
    };

    // Set top module if specified
    if let Some(ref top) = args.top {
        project.set_top(top)
            .with_context(|| format!("Failed to set top module: {}", top))?;
    }

    // Validate project
    project.validate_references()
        .with_context(|| "Project validation failed")?;
    project.check_circular_instantiation()
        .with_context(|| "Circular instantiation detected")?;

    // Static checks defined by the specification (generic constraints, match
    // exhaustiveness, verification-only system functions)
    let diagnostics = iris_sim::check::check_project(&project);
    if !diagnostics.is_empty() {
        eprint!("{}", iris_sim::check::format_diagnostics(&diagnostics));
        eprintln!();
        let errors = diagnostics
            .iter()
            .filter(|d| d.severity == iris_sim::check::Severity::Error)
            .count();
        let warnings = diagnostics.len() - errors;
        eprintln!("check summary: {} error(s), {} warning(s)", errors, warnings);
        eprintln!();
    }
    if iris_sim::check::has_errors(&diagnostics) {
        anyhow::bail!("static checks failed; simulation not started");
    }

    // Get top module for simulation
    let module = project.get_top_module()
        .with_context(|| "Failed to get top module")?
        .clone();

    if args.verbose {
        println!("  Project modules: {}", project.modules.len());
        for name in project.module_names() {
            let m = project.get_module(name).unwrap();
            let is_top = project.top_module.as_ref() == Some(name);
            println!("    {} {}", name, if is_top { "(top)" } else { "" });
            println!("      Ports: {}, Signals: {}, Logic blocks: {}, Seq blocks: {}, Initial blocks: {}, FSM blocks: {}, Memories: {}",
                     m.ports.len(), m.signals.len(), m.logic_blocks.len(),
                     m.seq_blocks.len(), m.initial_blocks.len(), m.fsm_blocks.len(), m.memories.len());
        }
        println!();
    }

    // 2. Run simulation
    if args.verbose {
        println!("Running simulation for {} cycles...", args.cycles);
    }

    // The hierarchical simulator is used for every design. It is a superset of the
    // flat engine: memories, block-local `let`, `match`, `assert` and multiple clock
    // domains are only implemented there.
    {
        // Use hierarchical simulator
        let mut simulator = HierarchicalSimulator::with_options(project.clone(), args.warn_metastability);

        // Reset sequence - only for non-test modules
        // Test modules handle reset automatically based on their reset signal configuration
        if !module.is_test {
            simulator.assert_reset();
            simulator.run_cycles(5);
            simulator.deassert_reset();

            // Set enable signal if it exists
            if simulator.get_signal("enable").is_some() {
                simulator.set_signal("enable", iris_sim::types::SignalValue::from_u64(1, 1));
            }
            if simulator.get_signal("enable_sig").is_some() {
                simulator.set_signal("enable_sig", iris_sim::types::SignalValue::from_u64(1, 1));
            }
        }

        // Run simulation
        simulator.run_cycles(args.cycles);

        // Output metastability warnings if any
        let warnings = simulator.get_metastability_warnings();
        if !warnings.is_empty() {
            print_metastability_warnings(warnings);
        }

        // An expression the evaluator could not handle used to leave its target
        // untouched, so an unsupported construct read as zero. Report it.
        let eval_failures = simulator.get_eval_failures().to_vec();
        if !eval_failures.is_empty() {
            eprintln!();
            for message in &eval_failures {
                // Chapter 14 already names the unknown-call diagnostic
                let code = if message.contains("unknown method")
                    || message.contains("unknown function")
                {
                    "O1006"
                } else {
                    "O3001"
                };
                eprintln!("error[{}]: could not evaluate {}", code, message);
            }
            eprintln!();
            eprintln!(
                "evaluation failure summary: {} expression(s) could not be evaluated",
                eval_failures.len()
            );
            eprintln!();
        }

        if args.verbose {
            println!("  Simulation time: {} ps", simulator.get_time());
            println!();
        }

        // Output waveform (VCD format)
        if let Some(ref output_path) = args.output {
            if args.verbose {
                println!("Writing waveform to {}...", output_path.display());
            }

            let mut writer = VcdWriter::new(output_path)
                .with_context(|| format!("Failed to create VCD file: {}", output_path.display()))?;
            writer
                .write_trace(simulator.get_trace(), &module.name)
                .with_context(|| "Failed to write VCD waveform")?;
            writer.close().with_context(|| "Failed to close VCD file")?;

            if args.verbose {
                println!("  Signals recorded: {}", simulator.get_trace().signal_names().count());
            }
        }

        // Report coverage before the verdict
        iris_runtime::engine::report_coverage(simulator.get_coverage());

        // Check and report assertion failures
        let failures = simulator.get_assertion_failures();
        let has_failures = print_assertion_failures(failures, &args.input);

        if has_failures {
            println!("Simulation completed with assertion failures.");
        } else {
            println!("Simulation completed successfully.");
        }

        // Print final signal values
        if args.verbose {
            println!();
            println!("Final signal values:");
            for name in simulator.get_trace().signal_names() {
                if let Some(value) = simulator.get_signal(name) {
                    println!("  {}: {}", name, value);
                }
            }
        }

        // Return non-zero exit code if assertions failed
        if has_failures {
            std::process::exit(1);
        }
    }

    Ok(())
}
