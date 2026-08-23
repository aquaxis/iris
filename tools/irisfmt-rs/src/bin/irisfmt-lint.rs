//! CLI for the Rust `irisfmt-lint` linter.
//!
//! Mirrors the TypeScript `irisfmt-lint` CLI: prints one diagnostic per line as
//! `file:line:col severity [rule] message`, and exits 1 when any error-severity
//! diagnostic is found. Ports/signals lack spans in the shared AST, so a
//! diagnostic anchors to the nearest definition with a span.

use std::process::exit;

use irisfmt::{lint_src, Severity};

const VERSION: &str = "0.1.0";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut files: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                exit(0);
            }
            "-v" | "--version" => {
                println!("irisfmt-lint {VERSION}");
                exit(0);
            }
            "--fix" => { /* not implemented; accepted for compatibility */ }
            "--config" | "--ignore" => {
                let _ = it.next();
            }
            s if !s.starts_with('-') => files.push(s.to_string()),
            _ => {}
        }
    }

    if files.is_empty() {
        print_help();
        exit(1);
    }

    let mut files_checked = 0usize;
    let mut total_errors = 0usize;
    let mut total_warnings = 0usize;

    for file in &files {
        let source = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error processing {file}: {e}");
                total_errors += 1;
                continue;
            }
        };
        match lint_src(&source) {
            Ok(diags) => {
                files_checked += 1;
                for d in diags {
                    println!(
                        "{file}:{}:{} {} [{}] {}",
                        d.line,
                        d.col,
                        d.severity.as_str(),
                        d.rule,
                        d.message
                    );
                    match d.severity {
                        Severity::Error => total_errors += 1,
                        Severity::Warning => total_warnings += 1,
                        Severity::Info => {}
                    }
                }
            }
            Err(e) => {
                eprintln!("Error processing {file}: {e}");
                total_errors += 1;
            }
        }
    }

    if files.len() > 1 {
        println!();
        println!("Checked {files_checked} file(s)");
        if total_errors > 0 || total_warnings > 0 {
            println!("Found {total_errors} error(s) and {total_warnings} warning(s)");
        } else {
            println!("No problems found");
        }
    }

    if total_errors > 0 {
        exit(1);
    }
}

fn print_help() {
    println!(
        r#"
irisfmt-lint - IRIS Style Linter

USAGE:
  irisfmt-lint [OPTIONS] <FILES...>

OPTIONS:
      --fix            Accepted for compatibility (not implemented)
      --config <path>  Accepted for compatibility (ignored)
      --ignore <glob>  Accepted for compatibility (ignored)
  -h, --help           Show this help message
  -v, --version        Show version information

EXAMPLES:
  irisfmt-lint example.iris
"#
    );
}
