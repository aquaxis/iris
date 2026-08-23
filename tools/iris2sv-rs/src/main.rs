//! The `iris2sv` command: read IRIS file(s), write SystemVerilog.
//!
//! Usage: `iris2sv <file.iris> [...] [-o <dir>]`. Without `-o` the SystemVerilog
//! goes to stdout; with it, each input's output is written to `<dir>/<name>.sv`.

use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut inputs: Vec<String> = Vec::new();
    let mut out_dir: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                i += 1;
                match args.get(i) {
                    Some(d) => out_dir = Some(d.clone()),
                    None => {
                        eprintln!("iris2sv: -o needs a directory");
                        return ExitCode::from(2);
                    }
                }
            }
            other => inputs.push(other.to_string()),
        }
        i += 1;
    }

    if inputs.is_empty() {
        eprintln!("iris2sv: expected at least one .iris file");
        return ExitCode::from(2);
    }

    let mut had_error = false;
    let mut compiled = 0;
    for path in &inputs {
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("iris2sv: cannot read '{}': {}", path, e);
                had_error = true;
                continue;
            }
        };
        match iris2sv::transpile(&source) {
            Ok(sv) => match &out_dir {
                Some(dir) => {
                    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("out");
                    let dest = Path::new(dir).join(format!("{}.sv", stem));
                    if let Some(parent) = dest.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Err(e) = std::fs::write(&dest, sv) {
                        eprintln!("iris2sv: cannot write '{}': {}", dest.display(), e);
                        had_error = true;
                    } else {
                        compiled += 1;
                    }
                }
                None => {
                    print!("{}", sv);
                    compiled += 1;
                }
            },
            Err(msg) => {
                eprintln!("{}: {}", path, msg);
                had_error = true;
            }
        }
    }

    if had_error {
        ExitCode::FAILURE
    } else {
        // The success line the conformance harness looks for.
        println!("Compilation succeeded: {} file(s) compiled, 0 warning(s).", compiled);
        ExitCode::SUCCESS
    }
}
