//! Convert IRIS source to Veryl.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: iris2veryl <file.iris> [...]");
        return ExitCode::FAILURE;
    }

    // The files are converted as one project, not one at a time. A module
    // that instantiates another needs that other module's ports, and reading
    // the files separately cannot supply them.
    let mut files = Vec::new();
    let mut failed = false;
    for path in &args {
        match std::fs::read_to_string(path) {
            Ok(source) => files.push((path.clone(), source)),
            Err(e) => {
                eprintln!("{}: {}", path, e);
                failed = true;
            }
        }
    }

    if !failed {
        match iris2veryl::convert::convert_project(&files) {
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
