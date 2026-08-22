//! Does every claim in the table have something behind it?
//!
//! The table says a construct crosses exactly. **That is a claim, and a claim
//! with nothing behind it is a hope.** These tests reconcile the rows against
//! the samples on disk so that a row cannot be added, or a sample deleted,
//! without someone saying so in words.

use std::collections::HashSet;
use std::path::PathBuf;

use veryl2iris_mapping::{exact, Coverage, COVERAGE};

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("mapping sits inside tools/veryl2iris")
        .join("samples")
}

fn entry(row: &str) -> Option<&'static Coverage> {
    COVERAGE.iter().find(|c| c.row == row)
}

#[test]
fn every_exact_row_is_accounted_for() {
    let mut missing = Vec::new();
    for mapping in exact() {
        if entry(mapping.veryl).is_none() {
            missing.push(mapping.veryl);
        }
    }
    assert!(
        missing.is_empty(),
        "these rows claim to cross exactly and nothing says whether they do:\n  {}",
        missing.join("\n  ")
    );
}

#[test]
fn no_coverage_entry_names_a_row_that_is_not_exact() {
    let rows: HashSet<&str> = exact().map(|m| m.veryl).collect();
    for entry in COVERAGE {
        assert!(
            rows.contains(entry.row),
            "coverage names '{}', which is not an Exact row",
            entry.row
        );
    }
}

#[test]
fn a_row_is_covered_once_and_no_more() {
    let mut seen = HashSet::new();
    for entry in COVERAGE {
        assert!(seen.insert(entry.row), "'{}' is covered twice", entry.row);
    }
}

#[test]
fn an_uncovered_row_says_why() {
    for entry in COVERAGE {
        if entry.sample.is_none() {
            assert!(
                !entry.note.is_empty(),
                "'{}' has no sample and no reason given",
                entry.row
            );
        }
    }
}

#[test]
fn every_named_sample_exists() {
    for entry in COVERAGE {
        let Some(slug) = entry.sample else { continue };
        let path = samples_dir().join(format!("{}.veryl", slug));
        assert!(
            path.exists(),
            "'{}' names the sample '{}', which is not in {}",
            entry.row,
            slug,
            samples_dir().display()
        );
    }
}

#[test]
fn every_sample_on_disk_is_named_by_a_row() {
    // Otherwise a sample can be left behind after its row is renamed, and go
    // on being run against nothing in particular.
    let named: HashSet<&str> = COVERAGE.iter().filter_map(|c| c.sample).collect();
    let dir = samples_dir();
    let entries = std::fs::read_dir(&dir).expect("the samples directory should be readable");
    for file in entries {
        let path = file.expect("a directory entry should be readable").path();
        if path.extension().and_then(|e| e.to_str()) != Some("veryl") {
            continue;
        }
        let slug = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("a sample file should have a name")
            .to_string();
        assert!(
            named.contains(slug.as_str()),
            "{} is not named by any row",
            path.display()
        );
    }
}

#[test]
fn how_much_of_the_table_is_exercised_is_stated_here() {
    // Not a threshold. This is the number that has to be reported rather than
    // rounded up to "the table is tested", and it fails when it moves so that
    // moving it is a decision rather than a drift.
    let total = exact().count();
    let covered = COVERAGE.iter().filter(|c| c.sample.is_some()).count();
    assert_eq!(total, 30, "the number of Exact rows changed");
    assert_eq!(
        covered, 29,
        "the number of Exact rows with a round trip changed: {} of {}",
        covered, total
    );
}
