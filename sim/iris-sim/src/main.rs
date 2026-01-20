//! IRIS-SIM: IRIS RTL Simulator CLI
//!
//! Command-line interface for simulating IRIS hardware designs.

use anyhow::{Context, Result};
use clap::{Parser as ClapParser, ValueEnum};
use std::path::PathBuf;

use iris_sim::fst::{FstWriter, VcdWriter, WaveWriter, WaveformFormat};
use iris_sim::project::Project;
use iris_sim::sim::{HierarchicalSimulator, Simulator};

/// Output format for waveform files
#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    /// VCD (Value Change Dump) - IEEE 1364 standard text format
    Vcd,
    /// FST (Fast Signal Trace) - GTKWave binary format
    Fst,
}

/// IRIS-SIM: A simulator for IRIS hardware description language
#[derive(ClapParser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Input IRIS file path(s) - can specify multiple files
    #[arg(short, long, num_args = 1..)]
    input: Vec<PathBuf>,

    /// Output waveform file path
    #[arg(short, long)]
    output: Option<PathBuf>,

    /// Output format (auto-detected from file extension if not specified)
    #[arg(short, long, value_enum)]
    format: Option<OutputFormat>,

    /// Number of simulation cycles
    #[arg(short, long, default_value = "100")]
    cycles: u64,

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
        println!("IRIS-SIM v{}", env!("CARGO_PKG_VERSION"));
        for (i, input) in args.input.iter().enumerate() {
            println!("Input file {}: {}", i + 1, input.display());
        }
        if let Some(ref output) = args.output {
            println!("Output file: {}", output.display());
            let format = args.format
                .map(|f| match f {
                    OutputFormat::Vcd => WaveformFormat::Vcd,
                    OutputFormat::Fst => WaveformFormat::Fst,
                })
                .unwrap_or_else(|| WaveformFormat::from_extension(output));
            println!("Output format: {:?}", format);
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
            println!("      Ports: {}, Signals: {}, Logic blocks: {}",
                     m.ports.len(), m.signals.len(), m.logic_blocks.len());
        }
        println!();
    }

    // 2. Run simulation
    if args.verbose {
        println!("Running simulation for {} cycles...", args.cycles);
    }

    // Check if we need hierarchical simulation (has instances)
    let has_instances = module.instances.len() > 0 || project.modules.len() > 1;

    if has_instances {
        // Use hierarchical simulator
        let mut simulator = HierarchicalSimulator::new(project.clone());

        // Reset sequence
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

        // Run simulation
        simulator.run_cycles(args.cycles);

        if args.verbose {
            println!("  Simulation time: {} ps", simulator.get_time());
            println!();
        }

        // Output waveform
        if let Some(ref output_path) = args.output {
            if args.verbose {
                println!("Writing waveform to {}...", output_path.display());
            }

            // Determine output format
            let format = args.format
                .map(|f| match f {
                    OutputFormat::Vcd => WaveformFormat::Vcd,
                    OutputFormat::Fst => WaveformFormat::Fst,
                })
                .unwrap_or_else(|| WaveformFormat::from_extension(output_path));

            match format {
                WaveformFormat::Vcd => {
                    let mut writer = VcdWriter::new(output_path)
                        .with_context(|| format!("Failed to create VCD file: {}", output_path.display()))?;
                    writer
                        .write_trace(simulator.get_trace(), &module.name)
                        .with_context(|| "Failed to write VCD waveform")?;
                    writer.close().with_context(|| "Failed to close VCD file")?;
                }
                WaveformFormat::Fst => {
                    let mut writer = FstWriter::new(output_path)
                        .with_context(|| format!("Failed to create FST file: {}", output_path.display()))?;
                    writer
                        .write_trace(simulator.get_trace(), &module.name)
                        .with_context(|| "Failed to write FST waveform")?;
                    writer.close().with_context(|| "Failed to close FST file")?;
                }
            }

            if args.verbose {
                println!("  Signals recorded: {}", simulator.get_trace().signal_names().count());
            }
        }

        println!("Simulation completed successfully.");

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
    } else {
        // Use simple simulator for single module
        let mut simulator = Simulator::new(module.clone());

        // Reset sequence
        simulator.assert_reset();
        simulator.run_cycles(5);
        simulator.deassert_reset();

        // Set enable signal if it exists
        if simulator.get_signal("enable").is_some() {
            simulator.set_signal("enable", iris_sim::types::SignalValue::from_u64(1, 1));
        }

        // Run simulation
        simulator.run_cycles(args.cycles);

        if args.verbose {
            println!("  Simulation time: {} ps", simulator.get_time());
            println!();
        }

        // Output waveform
        if let Some(ref output_path) = args.output {
            if args.verbose {
                println!("Writing waveform to {}...", output_path.display());
            }

            // Determine output format
            let format = args.format
                .map(|f| match f {
                    OutputFormat::Vcd => WaveformFormat::Vcd,
                    OutputFormat::Fst => WaveformFormat::Fst,
                })
                .unwrap_or_else(|| WaveformFormat::from_extension(output_path));

            match format {
                WaveformFormat::Vcd => {
                    let mut writer = VcdWriter::new(output_path)
                        .with_context(|| format!("Failed to create VCD file: {}", output_path.display()))?;
                    writer
                        .write_trace(simulator.get_trace(), &module.name)
                        .with_context(|| "Failed to write VCD waveform")?;
                    writer.close().with_context(|| "Failed to close VCD file")?;
                }
                WaveformFormat::Fst => {
                    let mut writer = FstWriter::new(output_path)
                        .with_context(|| format!("Failed to create FST file: {}", output_path.display()))?;
                    writer
                        .write_trace(simulator.get_trace(), &module.name)
                        .with_context(|| "Failed to write FST waveform")?;
                    writer.close().with_context(|| "Failed to close FST file")?;
                }
            }

            if args.verbose {
                println!("  Signals recorded: {}", simulator.get_trace().signal_names().count());
            }
        }

        println!("Simulation completed successfully.");

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
    }

    Ok(())
}
