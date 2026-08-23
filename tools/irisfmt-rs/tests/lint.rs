use irisfmt::lint_src;

fn rules(src: &str) -> Vec<String> {
    let mut rs: Vec<String> = lint_src(src)
        .expect("parse")
        .into_iter()
        .map(|d| format!("{}:{}", d.rule, d.message))
        .collect();
    rs.sort();
    rs
}

fn has_rule(src: &str, rule: &str) -> bool {
    lint_src(src).expect("parse").iter().any(|d| d.rule == rule)
}

#[test]
fn clean_design_has_no_diagnostics() {
    let src = "mod Counter(in clk: clock, out y: bit[8]) {\n    var count: bit[8] = 0;\n    sync(clk.posedge) {\n        count = count + 1;\n    }\n    comb {\n        y = count;\n    }\n}\n";
    assert!(lint_src(src).unwrap().is_empty(), "{:?}", rules(src));
}

#[test]
fn flags_naming_violations() {
    let src = "mod bad_Name(in clk: clock, in EnableIt: bit, out y: bit) {\n    comb { y = EnableIt; }\n}\n";
    let rs = rules(src);
    assert!(rs.iter().any(|r| r.contains("Module 'bad_Name' should be PascalCase")), "{rs:?}");
    assert!(rs.iter().any(|r| r.contains("Port 'EnableIt' should be snake_case")), "{rs:?}");
}

#[test]
fn flags_unused_signal_but_not_used_or_underscore() {
    let src = "mod M(in clk: clock, out y: bit[8]) {\n    let unused_s: bit[8] = 0;\n    let _ignored: bit[8] = 0;\n    let used_s: bit[8] = 1;\n    comb { y = used_s; }\n}\n";
    let rs = rules(src);
    assert!(rs.iter().any(|r| r.contains("Unused signal 'unused_s'")), "{rs:?}");
    assert!(!rs.iter().any(|r| r.contains("'used_s'")), "{rs:?}");
    // A `_`-prefixed name is exempt from unused-signal (but not from naming).
    assert!(!rs.iter().any(|r| r.contains("Unused signal '_ignored'")), "{rs:?}");
}

#[test]
fn flags_empty_block() {
    let src = "mod M(in clk: clock, out y: bit) {\n    comb { }\n}\n";
    assert!(has_rule(src, "no-empty-block"));
}

#[test]
fn flags_unused_and_duplicate_and_ordered_imports() {
    let src = "import pkg_b::{Foo};\nimport std::math::{clog2};\nimport pkg_a::{Bar};\nimport pkg_b::{Foo};\n\nmod M(in clk: clock, out y: bit[8]) {\n    comb { y = clog2(8); }\n}\n";
    assert!(has_rule(src, "unused-import"), "unused");
    assert!(has_rule(src, "duplicate-import"), "duplicate");
    assert!(has_rule(src, "import-order"), "order");
}

#[test]
fn seq_missing_timeout_only_without_timeout() {
    let src = "test M_tb {\n    seq {\n        await until(a);\n        await until(b, timeout: 100ns);\n    }\n}\n";
    let n = lint_src(src)
        .unwrap()
        .iter()
        .filter(|d| d.rule == "seq-missing-timeout")
        .count();
    assert_eq!(n, 1, "only the untimed await should warn");
}

#[test]
fn dead_code_after_break() {
    let src = "mod M(in clk: clock, out y: bit[8]) {\n    sync(clk.posedge) {\n        for i in 0..4 {\n            break;\n            y = i;\n        }\n    }\n}\n";
    assert!(has_rule(src, "dead-code"));
}

#[test]
fn rejects_unparseable_source() {
    assert!(lint_src("mod Broken( @@@ {{{").is_err());
}
