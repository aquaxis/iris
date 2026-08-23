//! IRIS keyword documentation (for hover) and context-aware completions,
//! ported from the TypeScript `irisfmt-ls`.

use lsp_types::{CompletionItem, CompletionItemKind, Documentation};

/// Markdown documentation for an IRIS keyword, if it is one.
pub fn keyword_doc(word: &str) -> Option<&'static str> {
    let doc = match word {
        "mod" => "**mod** - Module definition\n\nDefines a hardware module with ports and internal logic.\n\n```iris\nmod Counter(in clk: clock, out count: bit[8]) {\n  // module body\n}\n```",
        "pub" => "**pub** - Public visibility\n\nMarks an item as publicly visible outside the current module.",
        "let" => "**let** - Immutable binding\n\nDeclares an immutable variable or wire signal.\n\n```iris\nlet x: bit[8] = 42;\n```",
        "var" => "**var** - Mutable signal\n\nDeclares a mutable register signal (only valid in sync blocks).\n\n```iris\nvar counter: bit[8] = 0;\n```",
        "const" => "**const** - Constant definition\n\nDeclares a compile-time constant value.\n\n```iris\nconst WIDTH: uint = 8;\n```",
        "type" => "**type** - Type alias\n\nDefines a type alias.\n\n```iris\ntype Word = bit[32];\n```",
        "struct" => "**struct** - Structure type\n\nDefines a composite data type with named fields.\n\n```iris\nstruct Point {\n  x: int<32>,\n  y: int<32>,\n}\n```",
        "enum" => "**enum** - Enumeration type\n\nDefines an enumeration with named variants.\n\n```iris\nenum State {\n  Idle,\n  Running,\n  Done,\n}\n```",
        "interface" => "**interface** - Interface definition\n\nDefines a reusable port bundle.\n\n```iris\ninterface AXI4Lite {\n  logic awvalid: bit,\n  logic awready: bit,\n  // ...\n}\n```",
        "bit" => "**bit** - Bit vector type\n\nFixed-width unsigned bit vector.\n\n```iris\nlet x: bit[8] = 0xFF;\n```",
        "int" => "**int** - Signed integer type\n\nFixed-width signed integer.\n\n```iris\nlet x: int<32> = -42;\n```",
        "uint" => "**uint** - Unsigned integer type\n\nFixed-width unsigned integer.\n\n```iris\nlet x: uint<16> = 1000;\n```",
        "bool" => "**bool** - Boolean type\n\nBoolean value (true or false).",
        "clock" => "**clock** - Clock signal type\n\nRepresents a clock signal.",
        "reset" => "**reset** - Reset signal type\n\nRepresents a reset signal.",
        "string" => "**string** - String type\n\nText string (mainly for simulation/testing).",
        "in" => "**in** - Input port direction\n\nDeclares an input port.\n\n```iris\nmod Foo(in data: bit[8]) { }\n```",
        "out" => "**out** - Output port direction\n\nDeclares an output port.\n\n```iris\nmod Foo(out result: bit[8]) { }\n```",
        "inout" => "**inout** - Bidirectional port\n\nDeclares a bidirectional port.",
        "if" => "**if** - Conditional statement\n\nConditional execution based on a boolean expression.\n\n```iris\nif condition {\n  // then block\n} else {\n  // else block\n}\n```",
        "else" => "**else** - Else clause\n\nAlternative branch for if statements.",
        "match" => "**match** - Pattern matching\n\nPattern matching expression or statement.\n\n```iris\nmatch state {\n  State::Idle => { ... }\n  State::Running => { ... }\n  _ => { ... }\n}\n```",
        "for" => "**for** - For loop\n\nIterates over a range.\n\n```iris\nfor i in 0..8 {\n  // loop body\n}\n```",
        "while" => "**while** - While loop\n\nRepeats while condition is true.\n\n```iris\nwhile condition {\n  // loop body\n}\n```",
        "return" => "**return** - Return statement\n\nReturns a value from a function.",
        "comb" => "**comb** - Combinational logic block\n\nDefines combinational (asynchronous) logic.\n\n```iris\ncomb {\n  out = a & b;\n}\n```",
        "sync" => "**sync** - Synchronous logic block\n\nDefines sequential (clocked) logic.\n\n```iris\nsync(clk.posedge) {\n  counter = counter + 1;\n}\n```",
        "fsm" => "**fsm** - Finite State Machine\n\nDefines a finite state machine.\n\n```iris\nfsm my_fsm(clk.posedge) {\n  state { Idle, Running, Done }\n  transitions { ... }\n}\n```",
        "state" => "**state** - FSM state definition\n\nDefines states in an FSM.",
        "transitions" => "**transitions** - FSM transitions\n\nDefines state transitions in an FSM.",
        "when" => "**when** - Transition condition\n\nSpecifies a condition for state transition.",
        "goto" => "**goto** - State transition\n\nTransitions to another state in an FSM.",
        "mem" => "**mem** - Memory declaration\n\nDeclares a memory array.\n\n```iris\nmem ram: bit[32][1024];\n```",
        "fn" => "**fn** - Function definition\n\nDefines a function.\n\n```iris\nfn add(a: int<32>, b: int<32>) -> int<32> {\n  return a + b;\n}\n```",
        "import" => "**import** - Import declaration\n\nImports items from another module.\n\n```iris\nimport std::math::*;\n```",
        "package" => "**package** - Package declaration\n\nDeclares a package namespace.",
        "as" => "**as** - Alias/Cast\n\nCreates an alias for imports or casts types.",
        "where" => "**where** - Generic constraint\n\nSpecifies constraints on generic parameters.",
        "true" => "**true** - Boolean literal\n\nBoolean true value.",
        "false" => "**false** - Boolean literal\n\nBoolean false value.",
        "test" => "**test** - Test definition\n\nDefines a test case.\n\n```iris\n#[test]\ntest my_test {\n  // test body\n}\n```",
        "inst" => "**inst** - Module instantiation\n\nCreates an instance of another module.\n\n```iris\ninst u_counter = Counter { clk: clk, count: count };\n```",
        "assert" => "**assert** - Immediate assertion\n\nChecks a condition and fails the simulation when it does not hold.\n\n```iris\nassert data == expected else error(\"mismatch\");\n```",
        "expect" => "**expect** - Concurrent assertion\n\nChecks a property without stopping the run.",
        "assume" => "**assume** - Assumption\n\nStates a condition the environment guarantees. Does not stop the run.",
        "cover" => "**cover** - Coverage point\n\nRecords whether a condition was reached during the run.",
        "constraint" => "**constraint** - Constraint block\n\nRestricts the values a `rand` signal may take.\n\n```iris\nconstraint valid_size {\n  size >= 16'd64;\n}\n```",
        "await" => "**await** - Wait\n\nSuspends a `seq` block until an edge, a condition or a delay.\n\n```iris\nawait clk.posedge;\nawait until(done, 1us);\n```",
        "seq" => "**seq** - Sequential block\n\nA procedural block for testbenches. Runs once and may suspend on `await`.",
        "break" => "**break** - Leave a loop\n\nStops the innermost `for` or `while`.",
        "continue" => "**continue** - Next iteration\n\nSkips to the next iteration of the innermost loop.",
        "default" => "**default** - Default branch\n\nThe fallback arm of a `match`.",
        "extern" => "**extern** - External declaration\n\nDeclares a module implemented outside IRIS.\n\n```iris\nextern mod legacy_uart(in clk: clock, out tx: bit);\n```",
        "export" => "**export** - Re-export\n\nPasses an imported item on to importers of this package.",
        "union" => "**union** - Union definition\n\nFields share the same storage; the whole is as wide as the widest field.\n\n```iris\nunion DataView {\n  as_byte: bit[8],\n  as_word: bit[32]\n}\n```",
        "mut" => "**mut** - Mutable modifier\n\n`let mut` is the same as `var`.",
        "initial" => "**initial** - Initial state\n\nNames the state an FSM starts in.\n\n```iris\ninitial Idle;\n```",
        "extends" => "**extends** - Interface inheritance\n\nAn interface inherits the members of another.\n\n```iris\ninterface AxiStream extends StreamBase { ... }\n```",
        "initiator" => "**initiator** - Initiator view\n\nThe driving side of an interface.",
        "target" => "**target** - Target view\n\nThe receiving side of an interface.",
        "monitor" => "**monitor** - Monitor view\n\nAn observe-only view of an interface.",
        "view" => "**view** - Interface view\n\nNames a direction set for an interface.",
        _ => return None,
    };
    Some(doc)
}

/// The reserved words a rename must refuse (the keywords above).
pub fn is_reserved_word(word: &str) -> bool {
    keyword_doc(word).is_some()
}

/// Completion context, decided from the text just before the cursor.
#[derive(Clone, Copy)]
pub enum Ctx {
    Type,
    PortDirection,
    TypeParam,
    ModuleBody,
    FunctionBody,
    TopLevel,
}

/// Decide the completion context from the byte offset in the text.
pub fn completion_context(text: &str, offset: usize) -> Ctx {
    let before = &text[..offset.min(text.len())];
    let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line = &before[line_start..];
    let trimmed_end = line.trim_end_matches([' ', '\t']);

    if trimmed_end.ends_with("::") {
        return Ctx::TopLevel; // path context falls back to top-level items
    }
    if trimmed_end.ends_with(':') && !trimmed_end.ends_with("::") {
        return Ctx::Type;
    }
    if last_word_after_direction(line) {
        return Ctx::TopLevel; // identifier context -> top-level items
    }
    if is_partial_direction(line) {
        return Ctx::PortDirection;
    }
    if trimmed_end.ends_with('<') {
        return Ctx::TypeParam;
    }
    if inside_block(before, "mod") {
        return Ctx::ModuleBody;
    }
    if inside_block(before, "fn") {
        return Ctx::FunctionBody;
    }
    Ctx::TopLevel
}

/// `\b(in|out|inout)\s+\w*$`
fn last_word_after_direction(line: &str) -> bool {
    let t = line.trim_end_matches(|c: char| c.is_ascii_alphanumeric() || c == '_');
    if t.len() == line.len() && !line.ends_with([' ', '\t']) {
        // no trailing partial word and no space: not this context
    }
    let t = t.trim_end();
    t.ends_with(" in") || t.ends_with(" out") || t.ends_with(" inout")
        || t == "in" || t == "out" || t == "inout"
}

/// `\b(i|in|o|ou|out|ino|inou|inout)$` — a partially typed direction keyword.
fn is_partial_direction(line: &str) -> bool {
    let word = line
        .rsplit(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .next()
        .unwrap_or("");
    matches!(word, "i" | "in" | "o" | "ou" | "out" | "ino" | "inou" | "inout")
}

/// A `kw name ... {` opened before the cursor with more `{` than `}` after it.
fn inside_block(before: &str, kw: &str) -> bool {
    let needle = format!("{kw} ");
    let Some(pos) = before.rfind(&needle) else {
        return false;
    };
    let after = &before[pos..];
    let opens = after.matches('{').count();
    let closes = after.matches('}').count();
    opens > closes
}

fn item(label: &str, kind: CompletionItemKind, detail: &str, kw: Option<&str>) -> CompletionItem {
    CompletionItem {
        label: label.to_string(),
        kind: Some(kind),
        detail: Some(detail.to_string()),
        documentation: kw
            .and_then(keyword_doc)
            .map(|d| Documentation::String(d.to_string())),
        ..Default::default()
    }
}

/// Completion items for a context.
pub fn completion_items(ctx: Ctx) -> Vec<CompletionItem> {
    use CompletionItemKind as K;
    match ctx {
        Ctx::Type => vec![
            item("bit", K::TYPE_PARAMETER, "Bit vector type", Some("bit")),
            item("int", K::TYPE_PARAMETER, "Signed integer type", Some("int")),
            item("uint", K::TYPE_PARAMETER, "Unsigned integer type", Some("uint")),
            item("bool", K::TYPE_PARAMETER, "Boolean type", Some("bool")),
            item("clock", K::TYPE_PARAMETER, "Clock signal type", Some("clock")),
            item("reset", K::TYPE_PARAMETER, "Reset signal type", Some("reset")),
            item("string", K::TYPE_PARAMETER, "String type", Some("string")),
        ],
        Ctx::PortDirection => vec![
            item("in", K::KEYWORD, "Input port direction", Some("in")),
            item("out", K::KEYWORD, "Output port direction", Some("out")),
            item("inout", K::KEYWORD, "Bidirectional port", Some("inout")),
        ],
        Ctx::TypeParam => vec![
            item("8", K::VALUE, "8-bit width", None),
            item("16", K::VALUE, "16-bit width", None),
            item("32", K::VALUE, "32-bit width", None),
            item("64", K::VALUE, "64-bit width", None),
        ],
        Ctx::ModuleBody => vec![
            item("comb", K::KEYWORD, "Combinational logic block", Some("comb")),
            item("sync", K::KEYWORD, "Synchronous logic block", Some("sync")),
            item("fsm", K::KEYWORD, "Finite state machine", Some("fsm")),
            item("var", K::KEYWORD, "Mutable signal", Some("var")),
            item("let", K::KEYWORD, "Immutable binding", Some("let")),
            item("mem", K::KEYWORD, "Memory declaration", Some("mem")),
            item("if", K::KEYWORD, "Conditional statement", Some("if")),
            item("match", K::KEYWORD, "Pattern matching", Some("match")),
            item("for", K::KEYWORD, "For loop", Some("for")),
        ],
        Ctx::FunctionBody => vec![
            item("let", K::KEYWORD, "Immutable binding", Some("let")),
            item("return", K::KEYWORD, "Return statement", Some("return")),
            item("if", K::KEYWORD, "Conditional statement", Some("if")),
            item("match", K::KEYWORD, "Pattern matching", Some("match")),
            item("for", K::KEYWORD, "For loop", Some("for")),
            item("while", K::KEYWORD, "While loop", Some("while")),
        ],
        Ctx::TopLevel => vec![
            item("mod", K::KEYWORD, "Module definition", Some("mod")),
            item("fn", K::KEYWORD, "Function definition", Some("fn")),
            item("struct", K::KEYWORD, "Structure type", Some("struct")),
            item("enum", K::KEYWORD, "Enumeration type", Some("enum")),
            item("type", K::KEYWORD, "Type alias", Some("type")),
            item("interface", K::KEYWORD, "Interface definition", Some("interface")),
            item("import", K::KEYWORD, "Import declaration", Some("import")),
            item("package", K::KEYWORD, "Package declaration", Some("package")),
            item("const", K::KEYWORD, "Constant definition", Some("const")),
            item("pub", K::KEYWORD, "Public visibility", Some("pub")),
            item("test", K::KEYWORD, "Test definition", Some("test")),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_keywords_have_docs() {
        assert!(keyword_doc("sync").is_some());
        assert!(keyword_doc("mod").is_some());
        assert!(keyword_doc("not_a_keyword").is_none());
    }

    #[test]
    fn reserved_words_match_keywords() {
        assert!(is_reserved_word("sync"));
        assert!(!is_reserved_word("my_signal"));
    }

    #[test]
    fn context_after_colon_is_type() {
        let text = "mod A(in a: ";
        assert!(matches!(completion_context(text, text.len()), Ctx::Type));
    }

    #[test]
    fn top_level_context_by_default() {
        assert!(matches!(completion_context("", 0), Ctx::TopLevel));
    }
}
