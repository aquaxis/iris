//! Convert Veryl source to IRIS.
//!
//! `--check` parses without converting, which is how the other direction
//! verifies that what it wrote is really Veryl.

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let check_only = args.iter().any(|a| a == "--check");
    let files: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();

    if files.is_empty() {
        eprintln!("usage: veryl2iris [--check] <file.veryl> [...]");
        return ExitCode::FAILURE;
    }

    let mut failed = false;
    for path in files {
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{}: {}", path, e);
                failed = true;
                continue;
            }
        };
        if check_only {
            match veryl_parser::Parser::parse(&source, &PathBuf::from(path)) {
                Ok(parser) => {
                    println!("{}: OK  top-level items = {}", path, parser.veryl.veryl_list.len())
                }
                Err(e) => {
                    let text = format!("{:?}", e);
                    eprintln!("{}: parse error: {}", path, text.lines().next().unwrap_or(&text));
                    failed = true;
                }
            }
            continue;
        }

        match veryl2iris::convert::convert(path, &source) {
            Ok(converted) => {
                if !converted.report.is_empty() {
                    eprintln!("{}", converted.report);
                }
                if converted.report.failed() {
                    failed = true;
                } else {
                    print!("{}", converted.source);
                }
            }
            Err(e) => {
                eprintln!("{}", e);
                failed = true;
            }
        }
    }

    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
