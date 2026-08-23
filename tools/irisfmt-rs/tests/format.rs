use irisfmt::format_src;

/// Formatting is idempotent: formatting formatted output changes nothing.
fn assert_idempotent(src: &str) {
    let once = format_src(src).expect("first format");
    let twice = format_src(&once).expect("second format");
    assert_eq!(once, twice, "not idempotent");
}

#[test]
fn formats_a_simple_module() {
    let src = "mod A(in a:bit[8],out y:bit[8],){comb{y=a;}}";
    let out = format_src(src).unwrap();
    assert_eq!(
        out,
        "mod A(in a: bit[8], out y: bit[8],) {\n    comb {\n        y = a;\n    }\n}\n"
    );
    assert_idempotent(src);
}

#[test]
fn preserves_comments() {
    let src = "/// doc\nmod A(in a: bit[8], out y: bit[8]) {\n    comb {\n        // note\n        y = a;\n    }\n}\n";
    let out = format_src(src).unwrap();
    assert!(out.contains("/// doc"), "doc comment dropped");
    assert!(out.contains("// note"), "line comment dropped");
    assert_idempotent(src);
}

#[test]
fn a_line_comment_ends_its_line() {
    let src = "mod A(in a: bit[8], out y: bit[8]) {\n    comb {\n        y = a; // trailing\n    }\n}\n";
    let out = format_src(src).unwrap();
    // Nothing follows the comment on its line.
    for line in out.lines() {
        if let Some(idx) = line.find("//") {
            assert!(line[idx..].trim_end().ends_with("trailing"));
        }
    }
    assert_idempotent(src);
}

#[test]
fn keeps_the_arrow_operator_intact() {
    let src = "fn add(a: bit[8], b: bit[8]) -> bit[8] {\n    return a + b;\n}\n";
    let out = format_src(src).unwrap();
    assert!(out.contains("-> bit[8]"), "arrow was split: {out}");
    assert_idempotent(src);
}

#[test]
fn rejects_unparseable_source() {
    let src = "mod Broken( @@@ not valid {{{";
    assert!(format_src(src).is_err());
}

#[test]
fn ends_with_a_single_newline() {
    let out = format_src("mod A(in a: bit[8], out y: bit[8]) {\n    comb { y = a; }\n}\n").unwrap();
    assert!(out.ends_with("}\n"));
    assert!(!out.ends_with("\n\n"));
}
