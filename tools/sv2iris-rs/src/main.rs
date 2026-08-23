//! The `sv2iris` command: read SystemVerilog file(s), write IRIS.
//!
//! Usage: `sv2iris <file.sv> [more.sv ...] [-o <out.iris>]`. Without `-o` the
//! IRIS is printed to stdout; with it, written to that file. A parse error is
//! reported with the file and line and the exit code is non-zero, so a failure
//! is never mistaken for an empty success.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut inputs: Vec<String> = Vec::new();
    let mut output: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                i += 1;
                match args.get(i) {
                    Some(path) => output = Some(path.clone()),
                    None => {
                        eprintln!("sv2iris: -o needs a file path");
                        return ExitCode::from(2);
                    }
                }
            }
            other => inputs.push(other.to_string()),
        }
        i += 1;
    }

    if inputs.is_empty() {
        eprintln!("sv2iris: expected at least one .sv file");
        eprintln!("  sv2iris <file.sv> [more.sv ...] [-o <out.iris>]");
        return ExitCode::from(2);
    }

    let mut rendered = String::new();
    let mut had_error = false;
    for path in &inputs {
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("sv2iris: cannot read '{}': {}", path, err);
                had_error = true;
                continue;
            }
        };
        match sv2iris::transpile(&source) {
            Ok(iris) => rendered.push_str(&iris),
            Err(msg) => {
                eprintln!("{}: {}", path, msg);
                had_error = true;
            }
        }
    }

    if had_error {
        return ExitCode::FAILURE;
    }

    match &output {
        Some(path) => {
            if let Err(err) = std::fs::write(path, &rendered) {
                eprintln!("sv2iris: cannot write '{}': {}", path, err);
                return ExitCode::FAILURE;
            }
        }
        None => print!("{}", rendered),
    }
    ExitCode::SUCCESS
}
