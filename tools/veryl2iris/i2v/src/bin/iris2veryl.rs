//! Convert IRIS source to Veryl.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: iris2veryl <file.iris> [...]");
        return ExitCode::FAILURE;
    }

    let mut failed = false;
    for path in &args {
        let source = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{}: {}", path, e);
                failed = true;
                continue;
            }
        };
        match iris2veryl::convert::convert(path, &source) {
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
