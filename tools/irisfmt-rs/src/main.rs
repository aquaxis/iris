//! CLI for the Rust `irisfmt` formatter.
//!
//! Mirrors the TypeScript `irisfmt-format` CLI: prints formatted output to
//! stdout by default, `-w` writes in place, `-c` checks. An unparseable file
//! is reported and left untouched, never truncated.

use std::process::exit;

const VERSION: &str = "0.1.0";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut write = false;
    let mut check = false;
    let mut files: Vec<String> = Vec::new();

    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                exit(0);
            }
            "-v" | "--version" => {
                println!("irisfmt {VERSION}");
                exit(0);
            }
            "-w" | "--write" => write = true,
            "-c" | "--check" => check = true,
            "--config" => {
                // Accept and ignore a config path for CLI compatibility.
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

    let mut has_unformatted = false;
    let mut formatted_count = 0usize;
    let mut error_count = 0usize;

    for file in &files {
        let source = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error processing {file}: {e}");
                error_count += 1;
                continue;
            }
        };

        match irisfmt::format_src(&source) {
            Ok(formatted) => {
                if check {
                    if formatted != source {
                        println!("{file} needs formatting");
                        has_unformatted = true;
                    }
                } else if write {
                    if let Err(e) = std::fs::write(file, &formatted) {
                        eprintln!("Error processing {file}: {e}");
                        error_count += 1;
                    } else {
                        formatted_count += 1;
                    }
                } else {
                    // `formatted` already ends with a single newline.
                    print!("{formatted}");
                }
            }
            Err(e) => {
                // Leave the file untouched — never rewrite what we can't parse.
                eprintln!("Error processing {file}: {e}");
                error_count += 1;
            }
        }
    }

    if files.len() > 1 {
        if write {
            println!("\nFormatted {formatted_count} file(s)");
        } else if check && !has_unformatted {
            println!("\nAll {} file(s) are formatted correctly", files.len());
        }
        if error_count > 0 {
            eprintln!("{error_count} file(s) had errors");
        }
    }

    if has_unformatted || error_count > 0 {
        exit(1);
    }
}

fn print_help() {
    println!(
        r#"
irisfmt - IRIS Code Formatter

USAGE:
  irisfmt [OPTIONS] <FILES...>

OPTIONS:
  -w, --write              Write formatted output back to files
  -c, --check              Check if files are formatted (exit 1 if not)
      --config <path>      Accepted for compatibility (ignored)
  -h, --help               Show this help message
  -v, --version            Show version information

EXAMPLES:
  irisfmt example.iris              # Print formatted to stdout
  irisfmt -w example.iris           # Format in place
  irisfmt -c example.iris           # Check formatting (exit 1 if not)
"#
    );
}
