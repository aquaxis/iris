//! The `iris` command.
//!
//! One entry point for the IRIS tools. `iris sim ...` runs the simulator,
//! `iris veryl import ...` runs the Veryl reader, `iris fmt ...` formats, and
//! so on. Each subcommand forwards its remaining arguments to the tool that
//! does the work.
//!
//! This dispatcher does not link the tools. `iris-sim` pins clap 4.4.18 and
//! `veryl-parser` needs clap ^4.6, so they cannot share a lock; linking either
//! would inherit that conflict. So the subcommands run the built binaries.
//!
//! Every subcommand now runs a Rust tool directly: `from-sv` (sv2iris) and
//! `sv` (iris2sv) were ported in stage A4, and `fmt`/`lint` (irisfmt) and `lsp`
//! (irisfmt-lsp) in stage A5. All are at parity with the former TypeScript
//! tools — the conformance suite passes with fmt, and the linter and language
//! server carry the same rule set. No subcommand shells out to node any more.
//! `schematic` is a browser front end, so `iris schematic` starts its dev
//! server with npm.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// A Rust tool `iris` can run: the binary name and where it is built, relative
/// to the repository root, so it is found when `iris` is run from there.
struct Tool {
    binary: &'static str,
    candidates: &'static [&'static str],
}

const IRIS_SIM: Tool = Tool {
    binary: "iris-sim",
    candidates: &[
        "sim/iris-sim/target/release/iris-sim",
        "sim/iris-sim/target/debug/iris-sim",
    ],
};
const IRIS_COMPILE: Tool = Tool {
    binary: "iris-compile",
    candidates: &[
        "sim/iris-sim/target/release/iris-compile",
        "sim/iris-sim/target/debug/iris-compile",
    ],
};
const IRIS_FORMAL: Tool = Tool {
    binary: "iris-formal",
    candidates: &[
        "sim/iris-sim/target/release/iris-formal",
        "sim/iris-sim/target/debug/iris-formal",
    ],
};
const VERYL2IRIS: Tool = Tool {
    binary: "veryl2iris",
    candidates: &[
        "tools/veryl2iris/v2i/target/release/veryl2iris",
        "tools/veryl2iris/v2i/target/debug/veryl2iris",
    ],
};
const IRIS2VERYL: Tool = Tool {
    binary: "iris2veryl",
    candidates: &[
        "tools/veryl2iris/i2v/target/release/iris2veryl",
        "tools/veryl2iris/i2v/target/debug/iris2veryl",
    ],
};
// sv2iris and iris2sv are ported to Rust (stage A4) and at parity with the
// TypeScript tools: the conformance suite passes with both. So `from-sv` and
// `sv` run the Rust binaries.
const SV2IRIS: Tool = Tool {
    binary: "sv2iris",
    candidates: &[
        "tools/sv2iris-rs/target/release/sv2iris",
        "tools/sv2iris-rs/target/debug/sv2iris",
    ],
};
const IRIS2SV: Tool = Tool {
    binary: "iris2sv",
    candidates: &[
        "tools/iris2sv-rs/target/release/iris2sv",
        "tools/iris2sv-rs/target/debug/iris2sv",
    ],
};
// The formatter is ported to Rust (stage A5): it lexes IRIS keeping comments,
// checks the source parses with the shared iris-sim parser, and re-emits the
// token stream with canonical whitespace. So `fmt` runs the Rust binary.
const IRISFMT: Tool = Tool {
    binary: "irisfmt",
    candidates: &[
        "tools/irisfmt-rs/target/release/irisfmt",
        "tools/irisfmt-rs/target/debug/irisfmt",
    ],
};
// The linter is ported to Rust (stage A5): it runs its rules over the shared
// iris-sim AST. So `lint` runs the Rust binary.
const IRISFMT_LINT: Tool = Tool {
    binary: "irisfmt-lint",
    candidates: &[
        "tools/irisfmt-rs/target/release/irisfmt-lint",
        "tools/irisfmt-rs/target/debug/irisfmt-lint",
    ],
};

// The language server is ported to Rust (stage A5): it reuses irisfmt's
// formatter and linter and the iris-sim AST for symbols. So `lsp` runs the
// Rust binary.
const IRISFMT_LSP: Tool = Tool {
    binary: "irisfmt-lsp",
    candidates: &[
        "tools/irisfmt-lsp-rs/target/release/irisfmt-lsp",
        "tools/irisfmt-lsp-rs/target/debug/irisfmt-lsp",
    ],
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let Some(sub) = args.first() else {
        usage();
        return ExitCode::from(2);
    };

    match sub.as_str() {
        "-h" | "--help" | "help" => {
            usage();
            ExitCode::SUCCESS
        }
        "sim" => run(&IRIS_SIM, &args[1..]),
        "compile" => run(&IRIS_COMPILE, &args[1..]),
        "formal" => run(&IRIS_FORMAL, &args[1..]),
        "veryl" => run_veryl(&args[1..]),
        "fmt" => run(&IRISFMT, &args[1..]),
        "lint" => run(&IRISFMT_LINT, &args[1..]),
        "lsp" => run(&IRISFMT_LSP, &args[1..]),
        "sv" => run(&IRIS2SV, &args[1..]),
        "from-sv" => run(&SV2IRIS, &args[1..]),
        "schematic" => run_schematic(&args[1..]),
        other => {
            eprintln!("iris: unknown subcommand '{other}'\n");
            usage();
            ExitCode::from(2)
        }
    }
}

/// `iris veryl import|export ...`. IRIS and Veryl convert both ways, so the
/// direction is a subcommand rather than a flag.
fn run_veryl(args: &[String]) -> ExitCode {
    let Some(direction) = args.first() else {
        eprintln!("iris veryl: expected 'import' or 'export'");
        eprintln!("  iris veryl import <file.veryl>   Veryl -> IRIS");
        eprintln!("  iris veryl export <file.iris>    IRIS -> Veryl");
        return ExitCode::from(2);
    };
    match direction.as_str() {
        "import" => run(&VERYL2IRIS, &args[1..]),
        "export" => run(&IRIS2VERYL, &args[1..]),
        other => {
            eprintln!("iris veryl: unknown direction '{other}' (expected import or export)");
            ExitCode::from(2)
        }
    }
}

/// Find the tool's binary and run it with the forwarded arguments.
fn run(tool: &Tool, forwarded: &[String]) -> ExitCode {
    let program = resolve(tool);
    match Command::new(&program).args(forwarded).status() {
        Ok(status) => match status.code() {
            Some(code) => ExitCode::from(code as u8),
            // Killed by a signal: 128+signal is not available portably here, so
            // just report failure.
            None => ExitCode::FAILURE,
        },
        Err(err) => {
            eprintln!(
                "iris: could not run {} ({}). Looked for '{}'.",
                tool.binary,
                err,
                program.display()
            );
            eprintln!(
                "Build it, or set IRIS_{}_BIN to its path.",
                tool.binary.to_uppercase().replace('-', "_")
            );
            ExitCode::from(127)
        }
    }
}

/// `iris schematic` starts the block-diagram viewer's dev server. It is a
/// browser front end, not a CLI, so this launches `npm run dev` in its package
/// and passes any extra arguments through (e.g. `-- --port 5000`).
fn run_schematic(forwarded: &[String]) -> ExitCode {
    let dir = ["tools/schematic"]
        .iter()
        .map(Path::new)
        .find(|p| p.join("package.json").exists());
    let Some(dir) = dir else {
        eprintln!("iris schematic: could not find tools/schematic.");
        return ExitCode::from(127);
    };
    let mut command = Command::new("npm");
    command.arg("--prefix").arg(dir).arg("run").arg("dev");
    if !forwarded.is_empty() {
        command.arg("--").args(forwarded);
    }
    match command.status() {
        Ok(status) => match status.code() {
            Some(code) => ExitCode::from(code as u8),
            None => ExitCode::FAILURE,
        },
        Err(err) => {
            eprintln!("iris schematic: could not run npm ({err}). Is npm installed?");
            ExitCode::from(127)
        }
    }
}

/// Where a Rust tool's binary is.
///
/// In order: an `IRIS_<TOOL>_BIN` override, then next to this `iris` binary,
/// then the build paths under the repository (so it works when run from the
/// repository root), then the bare name for `PATH` to resolve.
fn resolve(tool: &Tool) -> PathBuf {
    let env_key = format!("IRIS_{}_BIN", tool.binary.to_uppercase().replace('-', "_"));
    if let Ok(path) = std::env::var(&env_key) {
        return PathBuf::from(path);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside = dir.join(tool.binary);
            if beside.exists() {
                return beside;
            }
        }
    }

    for candidate in tool.candidates {
        let path = Path::new(candidate);
        if path.exists() {
            return path.to_path_buf();
        }
    }

    PathBuf::from(tool.binary)
}

fn usage() {
    eprintln!(
        "iris - one command for the IRIS tools

Usage:
  iris <command> [arguments...]

Commands (Rust):
  sim        run the simulator (iris-sim)
  compile    build and run a compiled simulation (iris-compile)
  formal     emit the formal-equivalence reference model (iris-formal)
  veryl import <file.veryl>   convert Veryl to IRIS (veryl2iris)
  veryl export <file.iris>    convert IRIS to Veryl (iris2veryl)
  sv         convert IRIS to SystemVerilog (iris2sv)
  from-sv    convert SystemVerilog to IRIS (sv2iris)
  fmt        format IRIS source (irisfmt)
  lint       check IRIS style (irisfmt-lint)
  lsp        start the language server (irisfmt-lsp)

Browser front end (npm):
  schematic  start the block-diagram viewer (npm run dev)

Arguments after the command are passed through unchanged, so
'iris sim -i design.iris -o out.vcd -c 100' runs iris-sim with those.

A Rust tool's path can be overridden with IRIS_<TOOL>_BIN (e.g.
IRIS_IRIS_SIM_BIN). Only 'iris schematic' needs npm on PATH."
    );
}
