//! Simulation-level tests for IRIS language constructs
//!
//! Each test builds a project from source, runs it, and checks the resulting
//! signal values. They guard the constructs that the hierarchical simulator
//! executes: block-local `let`, `match` as a statement and as an expression,
//! `assert` inside a logic block, and generic parameters.

use iris_sim::parser::{AssertSeverity, Parser};
use iris_sim::project::Project;
use iris_sim::sim::HierarchicalSimulator;

/// Build a project from source and run it for the given number of cycles
fn run(source: &str, top: &str, cycles: u64) -> HierarchicalSimulator {
    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");

    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.enums {
        project.enums.insert(decl.name.clone(), decl);
    }
    for interface in result.interfaces {
        project.interfaces.insert(interface.name.clone(), interface);
    }
    for decl in result.structs {
        project.structs.insert(decl.name.clone(), decl);
    }
    for (name, ty) in result.type_aliases {
        project.type_aliases.insert(name, ty);
    }
    project.set_top(top).expect("top module should exist");
    project.elaborate();

    let mut sim = HierarchicalSimulator::new(project);
    sim.assert_reset();
    sim.run_cycles(2);
    sim.deassert_reset();
    sim.run_cycles(cycles);
    sim
}

/// Build a project from source and run it as a testbench.
/// A test module drives its own reset from the declared configuration.
fn run_test_module(source: &str, top: &str, cycles: u64) -> HierarchicalSimulator {
    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");

    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.enums {
        project.enums.insert(decl.name.clone(), decl);
    }
    for interface in result.interfaces {
        project.interfaces.insert(interface.name.clone(), interface);
    }
    for decl in result.structs {
        project.structs.insert(decl.name.clone(), decl);
    }
    for (name, ty) in result.type_aliases {
        project.type_aliases.insert(name, ty);
    }
    project.set_top(top).expect("top module should exist");
    project.elaborate();

    let mut sim = HierarchicalSimulator::new(project);
    sim.run_cycles(cycles);
    sim
}

/// Read a signal as an integer
fn value_of(sim: &HierarchicalSimulator, name: &str) -> u64 {
    sim.get_signal(name)
        .unwrap_or_else(|| panic!("signal '{}' should exist", name))
        .to_u64()
        .unwrap_or_else(|| panic!("signal '{}' should be fully defined", name))
}

const COUNTER_HEAD: &str = "
    in  clk: clock,
    in  rst_n: reset(active_low: true),
";

#[test]
fn block_local_let_is_visible_to_later_statements() {
    let source = format!(
        "mod LetTest({head} out y: bit[8]) {{
            var acc: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{ acc = acc + 1; }}
            comb {{
                let doubled: bit[8] = acc + acc;
                y = doubled;
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "LetTest", 5);
    let acc = value_of(&sim, "acc");
    assert_eq!(acc, 5, "counter should advance one step per cycle");
    assert_eq!(value_of(&sim, "doubled"), acc * 2);
    assert_eq!(value_of(&sim, "y"), acc * 2);
}

#[test]
fn let_local_takes_its_declared_width() {
    let source = format!(
        "mod NarrowLet({head} out y: bit[8]) {{
            var acc: bit[8] = 200;
            sync(clk.posedge, rst_n.async) {{ acc = acc + 1; }}
            comb {{
                let narrow: bit[4] = acc;
                y = narrow;
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "NarrowLet", 1);
    // 201 truncated to four bits
    assert_eq!(value_of(&sim, "narrow"), 201 & 0xf);
}

#[test]
fn a_type_alias_takes_the_width_of_the_type_it_names() {
    let source = format!(
        "type Byte = bit[8];
         mod AliasWidth({head} out y: bit[8]) {{
            var acc: Byte = 200;
            sync(clk.posedge, rst_n.async) {{ acc = acc + 55; }}
            comb {{ y = acc; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "AliasWidth", 1);
    // 200 + 55 = 255 fits in Byte, which is bit[8]. A one-bit fallback would
    // truncate to 1, so this value proves the alias took its declared width.
    assert_eq!(value_of(&sim, "acc"), 255);
    assert_eq!(value_of(&sim, "y"), 255);
}

#[test]
fn a_chained_type_alias_resolves_to_the_concrete_type() {
    let source = format!(
        "type Word = bit[8];
         type Data = Word;
         mod Chain({head} out y: bit[8]) {{
            var acc: Data = 200;
            sync(clk.posedge, rst_n.async) {{ acc = acc + 55; }}
            comb {{ y = acc; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "Chain", 1);
    assert_eq!(value_of(&sim, "acc"), 255);
}

#[test]
fn match_statement_selects_the_matching_arm() {
    let source = format!(
        "mod MatchStmt({head} out y: bit[8]) {{
            var sel: bit[2] = 0;
            var out_v: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{ sel = sel + 1; }}
            comb {{
                match sel {{
                    0 => {{ out_v = 10; }},
                    1 => {{ out_v = 20; }},
                    _ => {{ out_v = 99; }},
                }}
                y = out_v;
            }}
        }}",
        head = COUNTER_HEAD
    );

    for (cycles, expected) in [(1u64, 20u64), (2, 99), (3, 99), (4, 10)] {
        let sim = run(&source, "MatchStmt", cycles);
        assert_eq!(
            value_of(&sim, "y"),
            expected,
            "after {} cycles, sel = {}",
            cycles,
            value_of(&sim, "sel")
        );
    }
}

#[test]
fn match_expression_covers_every_arm() {
    let source = format!(
        "mod Alu({head} out result: bit[8]) {{
            var a: bit[8] = 12;
            var b: bit[8] = 5;
            var op: bit[2] = 0;
            sync(clk.posedge, rst_n.async) {{ op = op + 1; }}
            comb {{
                result = match op {{
                    2'b00 => a + b,
                    2'b01 => a - b,
                    2'b10 => a & b,
                    _     => a | b,
                }};
            }}
        }}",
        head = COUNTER_HEAD
    );

    // op cycles 1, 2, 3, 0 over four cycles
    for (cycles, expected) in [(1u64, 12 - 5), (2, 12 & 5), (3, 12 | 5), (4, 12 + 5)] {
        let sim = run(&source, "Alu", cycles);
        assert_eq!(
            value_of(&sim, "result"),
            expected,
            "after {} cycles, op = {}",
            cycles,
            value_of(&sim, "op")
        );
    }
}

#[test]
fn assert_in_a_logic_block_reports_failures() {
    let source = format!(
        "mod AssertTest({head} out y: bit[8]) {{
            var c: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{
                c = c + 1;
                assert c < 3, \"counter overflow\";
            }}
            comb {{ y = c; }}
        }}",
        head = COUNTER_HEAD
    );

    let passing = run(&source, "AssertTest", 2);
    assert!(
        passing.get_assertion_failures().is_empty(),
        "no failure while the counter stays below the bound"
    );

    let failing = run(&source, "AssertTest", 6);
    let failures = failing.get_assertion_failures();
    assert!(!failures.is_empty(), "assertion should fire once c reaches 3");
    assert_eq!(
        failures[0].message.as_deref(),
        Some("counter overflow"),
        "the declared message should be reported"
    );
}

#[test]
fn generic_width_comes_from_the_declared_default() {
    let source = format!(
        "mod GW[Width: uint = 12]({head} out q: bit[Width]) {{
            var c: bit[Width] = 0;
            sync(clk.posedge, rst_n.async) {{ c = c + 1; }}
            comb {{ q = c; }}
        }}",
        head = COUNTER_HEAD
    );

    let parser = Parser::new();
    let result = parser.parse_all(&source).expect("source should parse");
    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.enums {
        project.enums.insert(decl.name.clone(), decl);
    }
    for interface in result.interfaces {
        project.interfaces.insert(interface.name.clone(), interface);
    }
    for decl in result.structs {
        project.structs.insert(decl.name.clone(), decl);
    }
    for (name, ty) in result.type_aliases {
        project.type_aliases.insert(name, ty);
    }
    project.set_top("GW").unwrap();
    project.elaborate();

    let top = project.get_top_module().unwrap();
    let q = top.ports.iter().find(|p| p.name == "q").unwrap();
    assert_eq!(q.ty.width(), Some(12), "the default should size the port");
}

#[test]
fn each_instance_gets_its_own_generic_arguments() {
    let source = "
        mod Ram[Depth: uint = 4](
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  addr: bit[8],
            in  we: bit,
            in  wdata: bit[8],
            out rdata: bit[8],
        ) {
            mem storage: bit[8][Depth];
            sync(clk.posedge, rst_n.async) {
                if we { storage[addr] = wdata; }
            }
            comb { rdata = storage[addr]; }
        }

        test RamTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var addr: bit[8] = 10;
            var we: bit = 1;
            var wdata: bit[8] = 200;

            inst small = Ram[Depth: 4] {
                clk: clk, rst_n: rst_n, addr: addr, we: we, wdata: wdata,
            };
            inst big = Ram[Depth: 16] {
                clk: clk, rst_n: rst_n, addr: addr, we: we, wdata: wdata,
            };

            sync(clk.posedge, rst_n.async) {
                addr = 10;
                wdata = 200;
                we = 1;
            }
        }";

    let sim = run(source, "RamTB", 10);
    // Address 10 is inside the depth-16 instance and beyond the depth-4 one
    assert_eq!(value_of(&sim, "big.rdata"), 200);
    assert_eq!(value_of(&sim, "small.rdata"), 0);
}

#[test]
fn else_branches_are_executed() {
    let source = format!(
        "mod ElseTest({head} out y: bit[8]) {{
            var c: bit[8] = 0;
            var taken: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{
                c = c + 1;
                if c < 2 {{
                    taken = 1;
                }} else {{
                    taken = 2;
                }}
            }}
            comb {{ y = taken; }}
        }}",
        head = COUNTER_HEAD
    );

    assert_eq!(value_of(&run(&source, "ElseTest", 1), "taken"), 1);
    assert_eq!(value_of(&run(&source, "ElseTest", 5), "taken"), 2);
}

#[test]
fn active_low_reset_is_read_from_the_declaration() {
    // The signal is not named with an `_n` suffix, so only the declaration
    // can tell the simulator that it is active-low.
    let source = "
        mod Counter(
            in  clk: clock,
            in  rst: reset(active_low: true),
            out y: bit[8],
        ) {
            var c: bit[8] = 0;
            sync(clk.posedge, rst.async) { c = c + 1; }
            comb { y = c; }
        }";

    let sim = run(source, "Counter", 4);
    assert_eq!(
        value_of(&sim, "c"),
        4,
        "the counter must run once reset is deasserted"
    );
}

#[test]
fn clog2_sizes_types_and_folds_in_expressions() {
    let source = format!(
        "mod Sys[Depth: uint = 64]({head} out addr: bit[$clog2(Depth)], out n: bit[8]) {{
            var c: bit[$clog2(Depth) + 1] = 0;
            sync(clk.posedge, rst_n.async) {{ c = c + 1; }}
            comb {{
                addr = c[$clog2(Depth) - 1 : 0];
                n = $clog2(Depth);
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "Sys", 9);
    // $clog2(64) = 6, so the pointer is 7 bits and the address 6
    assert_eq!(value_of(&sim, "c"), 9);
    assert_eq!(value_of(&sim, "addr"), 9);
    assert_eq!(value_of(&sim, "n"), 6, "$clog2 should evaluate in an expression");

    let width = sim.get_signal("addr").unwrap().width();
    assert_eq!(width, 6, "$clog2(Depth) should size the port");
    assert_eq!(sim.get_signal("c").unwrap().width(), 7);
}

#[test]
fn clog2_rounds_up() {
    use iris_sim::project::clog2;
    // The number of bits needed to address n items
    assert_eq!(clog2(0), 0);
    assert_eq!(clog2(1), 0);
    assert_eq!(clog2(2), 1);
    assert_eq!(clog2(3), 2);
    assert_eq!(clog2(4), 2);
    assert_eq!(clog2(5), 3);
    assert_eq!(clog2(16), 4);
    assert_eq!(clog2(17), 5);
    assert_eq!(clog2(256), 8);
}

#[test]
fn part_select_reads_a_fixed_width_window() {
    let source = format!(
        "mod PartSel({head} out lo: bit[4], out hi: bit[4], out down: bit[4]) {{
            var v: bit[16] = 0;
            var idx: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{
                v = 16'hBEEF;
                idx = 8;
            }}
            comb {{
                lo = v[0 +: 4];
                hi = v[idx +: 4];
                down = v[15 -: 4];
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "PartSel", 3);
    assert_eq!(value_of(&sim, "v"), 0xBEEF);
    assert_eq!(value_of(&sim, "lo"), 0xF, "bits 3:0");
    assert_eq!(value_of(&sim, "hi"), 0xE, "bits 11:8, selected by a signal");
    assert_eq!(value_of(&sim, "down"), 0xB, "bits 15:12");
}

#[test]
fn slice_bounds_may_be_constant_expressions() {
    let source = format!(
        "mod SliceExpr[W: uint = 8]({head} out top_half: bit[4]) {{
            var v: bit[W] = 0;
            sync(clk.posedge, rst_n.async) {{ v = 8'hA5; }}
            comb {{ top_half = v[W - 1 : W - 4]; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "SliceExpr", 3);
    assert_eq!(value_of(&sim, "v"), 0xA5);
    assert_eq!(value_of(&sim, "top_half"), 0xA, "v[7:4]");
}

#[test]
fn ports_and_clocks_reach_a_nested_instance() {
    // Names differ at each level, so a connection expression must resolve in the
    // scope of the module that writes it rather than at the top of the design.
    let source = "
        mod Leaf(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  step: bit[8],
            out y: bit[8],
        ) {
            var acc: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { acc = acc + step; }
            comb { y = acc; }
        }

        mod Mid(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  amount: bit[8],
            out out_v: bit[8],
        ) {
            inst leaf = Leaf { clk: clk, rst_n: rst_n, step: amount };
            comb { out_v = leaf.y; }
        }

        test NestTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var tb_amount: bit[8] = 3;
            inst mid = Mid { clk: clk, rst_n: rst_n, amount: tb_amount };
        }";

    let sim = run_test_module(source, "NestTB", 20);
    // Five cycles of reset, then fifteen increments of three
    assert_eq!(value_of(&sim, "mid.leaf.step"), 3, "the inner port should be driven");
    assert_eq!(value_of(&sim, "mid.leaf.acc"), 45, "the inner sync block should run");
    assert_eq!(value_of(&sim, "mid.out_v"), 45, "the result should reach the parent");
}

#[test]
fn three_levels_of_hierarchy_propagate() {
    let source = "
        mod L3(in clk: clock, in rst_n: reset(active_low: true), in s: bit[8], out y: bit[8]) {
            var acc: bit[8] = 0;
            sync(clk.posedge, rst_n.async) { acc = acc + s; }
            comb { y = acc; }
        }
        mod L2(in clk: clock, in rst_n: reset(active_low: true), in b: bit[8], out y2: bit[8]) {
            inst c = L3 { clk: clk, rst_n: rst_n, s: b };
            comb { y2 = c.y; }
        }
        mod L1(in clk: clock, in rst_n: reset(active_low: true), in a: bit[8], out y1: bit[8]) {
            inst b_inst = L2 { clk: clk, rst_n: rst_n, b: a };
            comb { y1 = b_inst.y2; }
        }
        test DeepTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var amt: bit[8] = 2;
            inst top_i = L1 { clk: clk, rst_n: rst_n, a: amt };
        }";

    let sim = run_test_module(source, "DeepTB", 15);
    assert_eq!(value_of(&sim, "top_i.b_inst.c.s"), 2);
    assert_eq!(value_of(&sim, "top_i.b_inst.c.acc"), 20, "ten increments of two");
    assert_eq!(value_of(&sim, "top_i.y1"), 20);
}

#[test]
fn finish_stops_the_run() {
    let source = format!(
        "mod Fin({head} out y: bit[8]) {{
            var c: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{
                c = c + 1;
                if c == 4 {{ $finish; }}
            }}
            comb {{ y = c; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "Fin", 50);
    assert!(sim.is_finished(), "$finish should mark the run as finished");
    assert_eq!(
        value_of(&sim, "c"),
        5,
        "counting should stop on the edge that ran $finish"
    );
}

#[test]
fn assert_severity_separates_warnings_from_errors() {
    let warn_source = format!(
        "mod Warn({head} out y: bit[8]) {{
            var c: bit[8] = 0;
            sync(clk.posedge, rst_n.async) {{
                c = c + 1;
                assert c < 3 else warning(\"counter above two\");
            }}
            comb {{ y = c; }}
        }}",
        head = COUNTER_HEAD
    );
    let sim = run(&warn_source, "Warn", 8);
    let failures = sim.get_assertion_failures();
    assert!(!failures.is_empty(), "the condition should be violated");
    assert!(
        failures.iter().all(|f| f.severity == AssertSeverity::Warning),
        "the declared severity should be carried through"
    );
    assert!(!sim.is_finished(), "a warning must not stop the run");

    let fatal_source = warn_source.replace("warning(", "fatal(").replace("mod Warn", "mod Fatal");
    let sim = run(&fatal_source, "Fatal", 8);
    assert_eq!(
        sim.get_assertion_failures().len(),
        1,
        "a fatal assertion should stop at the first violation"
    );
    assert!(sim.is_finished());
}

#[test]
fn onehot_and_isunknown_inspect_values() {
    let source = format!(
        "mod Inspect({head} out a: bit[1], out b: bit[1], out c_out: bit[1]) {{
            var one: bit[4] = 1;
            var two: bit[4] = 3;
            var v: bit[4] = 0;
            sync(clk.posedge, rst_n.async) {{ v = v + 1; }}
            comb {{
                a = $onehot(one);
                b = $onehot(two);
                c_out = $isunknown(v);
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "Inspect", 3);
    assert_eq!(value_of(&sim, "a"), 1, "0b0001 has exactly one bit set");
    assert_eq!(value_of(&sim, "b"), 0, "0b0011 has two bits set");
    assert_eq!(value_of(&sim, "c_out"), 0, "a driven signal is known");
}

#[test]
fn size_reports_the_memory_depth() {
    let source = "
        mod WithMem[Depth: uint = 32](
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out n: bit[8],
        ) {
            mem buf: bit[8][Depth];
            comb { n = $size(buf); }
        }";

    let sim = run(source, "WithMem", 3);
    assert_eq!(value_of(&sim, "n"), 32);
}

#[test]
fn integer_types_keep_their_declared_width() {
    let source = format!(
        "mod T({head} out o: bit[16]) {{
            var a: uint[16] = 1000;
            var b: int[12] = 5;
            var c: bool = 1;
            sync(clk.posedge, rst_n.async) {{ a = a + 1; }}
            comb {{ o = a; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "T", 3);
    assert_eq!(sim.get_signal("a").unwrap().width(), 16, "uint[16] is 16 bits");
    assert_eq!(sim.get_signal("b").unwrap().width(), 12, "int[12] is 12 bits");
    assert_eq!(sim.get_signal("c").unwrap().width(), 1, "bool is one bit");
    // The initial value must survive, rather than being truncated to one bit
    assert_eq!(value_of(&sim, "a"), 1003);
}

#[test]
fn builtin_integer_aliases_are_recognised() {
    // Spec 3.1.2: u8 is uint[8], i16 is int[16]
    let source = format!(
        "mod A({head} out o: bit[8]) {{
            var d: u8 = 200;
            var e: i16 = 7;
            comb {{ o = d; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "A", 2);
    assert_eq!(sim.get_signal("d").unwrap().width(), 8);
    assert_eq!(sim.get_signal("e").unwrap().width(), 16);
    assert_eq!(value_of(&sim, "d"), 200);
}

#[test]
fn array_suffixes_size_a_signal() {
    let source = format!(
        "mod Arr({head} out o: bit[8]) {{
            var f: bit[8][4] = 0;
            comb {{ o = 1; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "Arr", 2);
    assert_eq!(
        sim.get_signal("f").unwrap().width(),
        32,
        "four elements of eight bits"
    );
}

#[test]
fn else_if_chains_select_the_right_branch() {
    // tools/iris.ebnf: if_stmt = "if" expr "{" ... "}" [ "else" ( if_stmt | block_stmt ) ]
    let source = format!(
        "mod Mux({head} out y: bit[8]) {{
            var sel: bit[2] = 0;
            sync(clk.posedge, rst_n.async) {{ sel = sel + 1; }}
            comb {{
                if sel == 2'b00 {{
                    y = 10;
                }} else if sel == 2'b01 {{
                    y = 20;
                }} else if sel == 2'b10 {{
                    y = 30;
                }} else {{
                    y = 40;
                }}
            }}
        }}",
        head = COUNTER_HEAD
    );

    for (cycles, expected) in [(1u64, 20u64), (2, 30), (3, 40), (4, 10)] {
        let sim = run(&source, "Mux", cycles);
        assert_eq!(
            value_of(&sim, "y"),
            expected,
            "after {} cycles, sel = {}",
            cycles,
            value_of(&sim, "sel")
        );
    }
}

#[test]
fn contextual_names_are_usable_as_identifiers() {
    // Spec 2.4 lists 58 reserved words; `period`, `value`, `ports` and `ram`
    // are contextual names and are not among them
    let source = "
        mod V(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            in  period: bit[8],
            out o: bit[8],
        ) {
            var value: bit[8] = 0;
            var ports: bit[4] = 0;
            var ram: bit = 0;
            sync(clk.posedge, rst_n.async) { value = value + period; }
            comb { o = value; }
        }";

    let sim = run(source, "V", 3);
    assert_eq!(sim.get_signal("value").unwrap().width(), 8);
    assert_eq!(sim.get_signal("ports").unwrap().width(), 4);
}

/// Every word spec 2.4 reserves (58 of them)
const RESERVED_WORDS: [&str; 58] = [
    "mod", "extern", "inst", "in", "out", "inout", "const", "type", "import", "export", "pub",
    "package", "if", "else", "match", "for", "while", "break", "continue", "return", "bit", "int",
    "uint", "bool", "enum", "struct", "union", "clock", "reset", "let", "var", "mut", "mem",
    "comb", "sync", "fsm", "state", "when", "goto", "initial", "transitions", "default", "test",
    "assert", "expect", "cover", "assume", "constraint", "await", "seq", "interface", "initiator",
    "target", "view", "extends", "monitor", "where", "fn",
];

#[test]
fn reserved_words_are_still_rejected_as_identifiers() {
    // A PEG alternation commits to its first match, so `in` used to hide
    // `inst`, `inout`, `int`, `initial`, `interface` and `initiator`, and
    // `const` used to hide `constraint`. Those parsed as ordinary names.
    let parser = Parser::new();
    for name in RESERVED_WORDS {
        let source = format!(
            "mod R(in clk: clock, in rst_n: reset(active_low: true), out o: bit[8]) {{
                var {}: bit[8] = 0;
                comb {{ o = 0; }}
            }}",
            name
        );
        assert!(
            parser.parse_all(&source).is_err(),
            "'{}' is reserved by spec 2.4 and must not be usable as a signal name",
            name
        );
    }
}

#[test]
fn the_reserved_word_list_matches_the_specification() {
    // Spec 2.4 counts 58 reserved words, contextual keywords excluded
    let mut sorted = RESERVED_WORDS;
    sorted.sort_unstable();
    let unique = {
        let mut v = sorted.to_vec();
        v.dedup();
        v.len()
    };
    assert_eq!(unique, 58, "the reserved list must hold 58 distinct words");
}

#[test]
fn a_single_bit_of_a_signal_can_be_assigned() {
    // `signal[i] = v` used to parse as a memory write and vanish silently
    let source = format!(
        "mod W({head} out o: bit[16]) {{
            var r: bit[16] = 0;
            sync(clk.posedge, rst_n.async) {{ r[3] = 1; }}
            comb {{ o = r; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "W", 3);
    assert_eq!(value_of(&sim, "r"), 0x0008);
}

#[test]
fn a_slice_of_a_signal_can_be_assigned() {
    let source = format!(
        "mod W({head} out o: bit[16]) {{
            var r: bit[16] = 0;
            sync(clk.posedge, rst_n.async) {{
                r[7:0] = 8'hAB;
                r[15:8] = 8'hCD;
            }}
            comb {{ o = r; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "W", 3);
    assert_eq!(
        value_of(&sim, "r"),
        0xCDAB,
        "two field writes in one block should accumulate, not overwrite"
    );
}

#[test]
fn a_part_select_target_may_have_a_varying_position() {
    let source = format!(
        "mod W({head} out o: bit[16]) {{
            var up: bit[16] = 0;
            var down: bit[16] = 0;
            var pos: bit[4] = 4;
            sync(clk.posedge, rst_n.async) {{
                up[pos +: 4] = 4'hF;
                down[15 -: 8] = 8'h5A;
            }}
            comb {{ o = up; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "W", 3);
    assert_eq!(value_of(&sim, "up"), 0x00F0, "four bits starting at bit 4");
    assert_eq!(value_of(&sim, "down"), 0x5A00, "eight bits ending at bit 15");
}

#[test]
fn a_field_assignment_leaves_the_other_bits_alone() {
    let source = format!(
        "mod W({head} out o: bit[16]) {{
            var r: bit[16] = 65535;
            sync(clk.posedge, rst_n.async) {{ r[11:4] = 0; }}
            comb {{ o = r; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "W", 3);
    assert_eq!(value_of(&sim, "r"), 0xF00F, "only bits 11:4 are cleared");
}

const ENUM_DESIGN: &str = "
    enum Colour { Red, Green, Blue }

    enum State: bit[2] {
        Idle = 2'b00,
        Run  = 2'b01,
        Stop = 2'b11
    }

    mod Painter(
        in  clk: clock,
        in  rst_n: reset(active_low: true),
        out y: bit[8],
        out s: bit[2],
    ) {
        var c: Colour = Colour::Red;
        var st: State = State::Idle;
        var out_v: bit[8] = 0;

        sync(clk.posedge, rst_n.async) {
            c = Colour::Green;
            st = State::Stop;
        }

        comb {
            match c {
                Colour::Red => { out_v = 10; },
                Colour::Green => { out_v = 20; },
                Colour::Blue => { out_v = 30; },
            }
            y = out_v;
            s = st;
        }
    }";

#[test]
fn an_enum_without_an_underlying_type_takes_the_width_it_needs() {
    let sim = run(ENUM_DESIGN, "Painter", 3);
    // Three variants need two bits
    assert_eq!(sim.get_signal("c").unwrap().width(), 2);
    assert_eq!(value_of(&sim, "c"), 1, "Colour::Green is the second variant");
}

#[test]
fn an_enum_may_declare_its_underlying_type_and_values() {
    let sim = run(ENUM_DESIGN, "Painter", 3);
    assert_eq!(sim.get_signal("st").unwrap().width(), 2);
    assert_eq!(value_of(&sim, "st"), 3, "State::Stop was written as 2'b11");
}

#[test]
fn a_match_on_an_enum_selects_by_variant() {
    let sim = run(ENUM_DESIGN, "Painter", 3);
    assert_eq!(value_of(&sim, "y"), 20, "the Green arm ran");
}

const INTERFACE_DESIGN: &str = "interface Simple {
                valid: bit,
                data: bit[8],
                ready: bit,

                view initiator {
                    out: valid, data
                    in: ready
                }
                view target {
                    in: valid, data
                    out: ready
                }
            }

            mod Producer(
                in clk: clock,
                in rst_n: reset(active_low: true),
                initiator bus: Simple,
            ) {
                var count: bit[8] = 0;
                sync(clk.posedge, rst_n.async) { count = count + 1; }
                comb {
                    bus.valid = 1;
                    bus.data = count;
                }
            }

            mod Consumer(
                in clk: clock,
                in rst_n: reset(active_low: true),
                target bus: Simple,
                out seen: bit[8],
            ) {
                var last: bit[8] = 0;
                sync(clk.posedge, rst_n.async) {
                    if bus.valid { last = bus.data; }
                }
                comb {
                    bus.ready = 1;
                    seen = last;
                }
            }

            test IfaceTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                let link: Simple;
                var observed: bit[8] = 0;

                inst p = Producer { clk: clk, rst_n: rst_n, bus: link };
                inst c = Consumer { clk: clk, rst_n: rst_n, bus: link };

                comb { observed = c.seen; }
            }";

#[test]
fn an_interface_port_expands_into_its_members() {
    let sim = run_test_module(INTERFACE_DESIGN, "IfaceTB", 12);
    // The bus itself became one signal per member
    assert!(sim.get_signal("link.valid").is_some());
    assert!(sim.get_signal("link.data").is_some());
    // The producer drives the bus through its initiator view
    assert_eq!(value_of(&sim, "link.valid"), 1);
    assert!(value_of(&sim, "link.data") > 0, "the producer drives data");
    // The consumer drives ready through its target view
    assert_eq!(value_of(&sim, "link.ready"), 1);
}

#[test]
fn an_interface_carries_data_between_modules() {
    let sim = run_test_module(INTERFACE_DESIGN, "IfaceTB", 12);
    let sent = value_of(&sim, "link.data");
    let seen = value_of(&sim, "observed");
    assert!(seen > 0, "the consumer should have latched a value");
    assert_eq!(seen + 1, sent, "the consumer latches the previous cycle");
}

#[test]
fn break_and_continue_control_a_sequential_loop() {
    let source = "
        test BreakTB {
            let clk: clock;
            let rst: reset;
            var value: bit[8] = 0;
            var i: bit[8] = 0;
            var acc: bit[8] = 0;

            sync(clk.posedge, rst.async) { value = value + 1; }

            seq {
                for i in 0..10 {
                    if i == 8'd2 { continue; }
                    if i == 8'd5 { break; }
                    acc = acc + i;
                }
            }
        }";

    let sim = run_test_module(source, "BreakTB", 40);
    // 0 + 1 + 3 + 4, with 2 skipped and the loop left at 5
    assert_eq!(value_of(&sim, "acc"), 8);
    assert_eq!(value_of(&sim, "i"), 5, "the loop stopped where break was hit");
}

#[test]
fn break_and_continue_control_a_logic_block_loop() {
    let source = format!(
        "mod LoopCtl({head} out y: bit[16]) {{
            var i: bit[8] = 0;
            var mask: bit[16] = 0;
            comb {{
                for i in 0..10 {{
                    if i == 2 {{ continue; }}
                    if i == 5 {{ break; }}
                    mask[i] = 1;
                }}
                y = mask;
            }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "LoopCtl", 3);
    // Bits 0, 1, 3 and 4: iteration 2 was skipped and the loop stopped at 5
    assert_eq!(value_of(&sim, "mask"), 0b11011);
}

const TAGGED_UNION: &str = "enum Packet {
                Header,
                Payload(bit[8]),
                Footer
            }

            mod Router(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out kind: bit[8],
                out body: bit[8],
            ) {
                var pkt: Packet = Packet::Payload(8'hab);
                var k: bit[8] = 0;
                var b: bit[8] = 0;

                comb {
                    match pkt {
                        Packet::Header => { k = 1; b = 0; },
                        Packet::Payload(data) => { k = 2; b = data; },
                        Packet::Footer => { k = 3; b = 0; },
                    }
                    kind = k;
                    body = b;
                }
            }";

#[test]
fn an_enum_variant_may_carry_a_payload() {
    let sim = run(TAGGED_UNION, "Router", 3);
    // Two tag bits below an eight-bit payload
    assert_eq!(sim.get_signal("pkt").unwrap().width(), 10);
    assert_eq!(value_of(&sim, "pkt"), (0xab << 2) | 1);
}

#[test]
fn a_match_arm_binds_the_payload_it_matched() {
    let sim = run(TAGGED_UNION, "Router", 3);
    assert_eq!(value_of(&sim, "kind"), 2, "the Payload arm ran");
    assert_eq!(value_of(&sim, "body"), 0xab, "the payload was bound");
}

#[test]
fn an_interface_may_extend_another() {
    let source = "interface StreamBase {
                valid: bit,
                ready: bit,

                view initiator { out: valid
                                 in: ready }
                view target { in: valid
                              out: ready }
            }

            interface AxiStream extends StreamBase {
                data: bit[32],
                last: bit,

                view initiator { out: valid, data, last
                                 in: ready }
                view target { in: valid, data, last
                              out: ready }
            }

            mod Src(
                in clk: clock,
                in rst_n: reset(active_low: true),
                initiator s: AxiStream,
            ) {
                var c: bit[32] = 0;
                sync(clk.posedge, rst_n.async) { c = c + 1; }
                comb { s.valid = 1; s.data = c; s.last = 0; }
            }

            mod Snk(
                in clk: clock,
                in rst_n: reset(active_low: true),
                target s: AxiStream,
                out got: bit[32],
            ) {
                var last_v: bit[32] = 0;
                sync(clk.posedge, rst_n.async) { if s.valid { last_v = s.data; } }
                comb { s.ready = 1; got = last_v; }
            }

            test ExtTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                let bus: AxiStream;
                var seen: bit[32] = 0;
                inst a = Src { clk: clk, rst_n: rst_n, s: bus };
                inst b = Snk { clk: clk, rst_n: rst_n, s: bus };
                comb { seen = b.got; }
            }";
    let sim = run_test_module(source, "ExtTB", 12);
    // The base's members and the child's are both present
    assert!(sim.get_signal("bus.valid").is_some(), "inherited from the base");
    assert!(sim.get_signal("bus.ready").is_some(), "inherited from the base");
    assert!(sim.get_signal("bus.data").is_some(), "declared by the child");
    assert!(value_of(&sim, "seen") > 0, "data crossed the inherited bus");
}

#[test]
fn expect_and_assume_do_not_fail_the_run() {
    let source = "
        test SoftTB {
            let clk: clock;
            let rst: reset;
            var count: bit[8] = 0;
            sync(clk.posedge, rst.async) {
                count = count + 1;
                expect count < 8'd3, \"soft\";
            }
        }";
    let sim = run_test_module(source, "SoftTB", 20);
    let failures = sim.get_assertion_failures();
    assert!(!failures.is_empty(), "the soft check is still reported");
    assert!(
        failures
            .iter()
            .all(|f| f.severity == AssertSeverity::Warning),
        "a soft check must not fail the run"
    );
}

#[test]
fn cover_counts_how_often_a_condition_held() {
    let source = "
        test CoverTB {
            let clk: clock;
            let rst: reset;
            var count: bit[8] = 0;
            sync(clk.posedge, rst.async) {
                count = count + 1;
                cover count == 8'd5, \"reached five\";
                cover count > 8'd100, \"over a hundred\";
            }
        }";
    let sim = run_test_module(source, "CoverTB", 20);
    let coverage = sim.get_coverage();
    assert_eq!(coverage.len(), 2, "both points are listed");
    assert_eq!(coverage[0], ("reached five".to_string(), 1));
    assert_eq!(
        coverage[1],
        ("over a hundred".to_string(), 0),
        "a point never reached still appears"
    );
}

const COMPOSITES: &str = "struct Header {
                dst: bit[16],
                src: bit[16],
                kind: bit[8]
            }

            union DataView {
                as_byte: bit[8],
                as_word: bit[32]
            }

            mod Framer(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out total: bit[32],
                out low: bit[8],
            ) {
                var hdr: Header;
                var dv: DataView;

                sync(clk.posedge, rst_n.async) {
                    hdr.dst = 16'hbeef;
                    hdr.src = 16'hcafe;
                    hdr.kind = 8'h08;
                    dv.as_word = 32'h11223344;
                }

                comb {
                    total = hdr.dst + hdr.src;
                    low = dv.as_byte;
                }
            }";

#[test]
fn a_struct_becomes_one_signal_per_field() {
    let sim = run(COMPOSITES, "Framer", 4);
    assert_eq!(value_of(&sim, "hdr.dst"), 0xbeef);
    assert_eq!(value_of(&sim, "hdr.src"), 0xcafe);
    assert_eq!(value_of(&sim, "hdr.kind"), 0x08);
    assert!(
        sim.get_signal("hdr").is_none(),
        "the structure itself is not a signal"
    );
}

#[test]
fn a_union_shares_its_bits_between_fields() {
    let sim = run(COMPOSITES, "Framer", 4);
    // One signal as wide as the widest field
    assert_eq!(sim.get_signal("dv").unwrap().width(), 32);
    assert_eq!(value_of(&sim, "dv"), 0x11223344);
    // The narrow field is the low bits of the same storage
    assert_eq!(value_of(&sim, "low"), 0x44);
}

#[test]
fn a_function_call_is_replaced_by_its_body() {
    let source = "
        pub fn add(a: bit[8], b: bit[8]) -> bit[8] { return a + b; }
        fn scale(x: bit[8]) -> bit[8] { return add(x, x); }

        mod Calc(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out y: bit[8],
            out z: bit[8],
        ) {
            var c: bit[8] = 3;
            sync(clk.posedge, rst_n.async) { c = c + 1; }
            comb {
                y = add(c, 8'd10);
                z = scale(c);
            }
        }";

    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");
    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.functions {
        project.functions.insert(decl.name.clone(), decl);
    }
    project.set_top("Calc").expect("top module should exist");
    project.elaborate();

    let mut sim = HierarchicalSimulator::new(project);
    sim.assert_reset();
    sim.run_cycles(2);
    sim.deassert_reset();
    sim.run_cycles(3);

    let c = value_of(&sim, "c");
    assert_eq!(value_of(&sim, "y"), c + 10, "add was inlined");
    assert_eq!(value_of(&sim, "z"), c * 2, "a nested call was inlined too");
}

#[test]
fn randomize_honours_its_constraints() {
    let source = "
        test RandTB {
            let clk: clock;
            let rst: reset;
            rand size: bit[16];
            rand kind: bit[4];
            var draws: bit[8] = 0;

            constraint valid_size {
                size >= 16'd64;
                size <= 16'd1518;
            }
            constraint valid_kind {
                kind < 4'd8;
            }

            seq {
                for draws in 0..6 {
                    $randomize;
                    assert size >= 16'd64, \"lower bound\";
                    assert size <= 16'd1518, \"upper bound\";
                    assert kind < 4'd8, \"kind bound\";
                    await clk.cycles(1);
                }
            }
        }";

    let sim = run_test_module(source, "RandTB", 40);
    assert!(
        sim.get_assertion_failures().is_empty(),
        "every draw must satisfy the constraints"
    );
    // A drawn value is inside the constrained range
    let size = value_of(&sim, "size");
    assert!((64..=1518).contains(&size), "size was {}", size);
    assert!(value_of(&sim, "kind") < 8);
}

#[test]
fn randomisation_is_reproducible() {
    let source = "
        test RandTB {
            let clk: clock;
            let rst: reset;
            rand v: bit[16];
            var draws: bit[8] = 0;
            seq {
                for draws in 0..4 { $randomize; await clk.cycles(1); }
            }
        }";

    let first = run_test_module(source, "RandTB", 30);
    let second = run_test_module(source, "RandTB", 30);
    assert_eq!(
        value_of(&first, "v"),
        value_of(&second, "v"),
        "the same design must draw the same values"
    );
}

#[test]
fn a_match_expression_binds_a_payload_within_its_arm() {
    let source = "enum Packet { Header, Payload(bit[8]), Footer }

            mod M(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out y: bit[8],
            ) {
                var pkt: Packet = Packet::Payload(8'hab);
                comb {
                    y = match pkt {
                        Packet::Header => 1,
                        Packet::Payload(data) => data,
                        Packet::Footer => 3,
                    };
                }
            }";
    let sim = run(source, "M", 3);
    assert_eq!(value_of(&sim, "y"), 0xab, "the payload reached the arm");
    assert!(
        sim.get_signal("data").is_none(),
        "the binding must not outlive the arm"
    );
}

#[test]
fn a_function_body_may_bind_intermediates() {
    let source = "
        fn mix(a: bit[8], b: bit[8]) -> bit[8] {
            let sum = a + b;
            let doubled = sum + sum;
            return doubled ^ a;
        }

        mod M(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out y: bit[8],
        ) {
            var p: bit[8] = 3;
            var q: bit[8] = 5;
            comb { y = mix(p, q); }
        }";

    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");
    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
    }
    for decl in result.functions {
        project.functions.insert(decl.name.clone(), decl);
    }
    project.set_top("M").expect("top module should exist");
    project.elaborate();

    let mut sim = HierarchicalSimulator::new(project);
    sim.run_cycles(3);
    // ((3 + 5) * 2) ^ 3
    assert_eq!(value_of(&sim, "y"), 0x13);
}

/// `truncate` is listed beside `extend` in spec 3.4.2 and is spelled
/// `x.truncate[8]()` in two places in the specification. The expression
/// evaluator implemented it; the hierarchical evaluator, which is the one that
/// runs designs, did not. So the method the specification documents twice
/// failed with "call to unknown method 'truncate'".
///
/// The value matters here: a failed evaluation leaves the signal at zero, so a
/// test that only checks the run completes would pass either way.
#[test]
fn truncate_narrows_a_value() {
    let source = format!(
        "mod TruncTest({head} out y: bit[8]) {{
            let a: bit[16] = 16'hABCD;
            comb {{ y = a.truncate(8); }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "TruncTest", 2);
    assert_eq!(value_of(&sim, "y"), 0xCD);
}

#[test]
fn every_width_method_of_the_specification_runs() {
    // Each pair is the expression and what it must produce for 8'hAB, so a
    // method that silently fails to evaluate cannot pass.
    for (method, expected) in [
        ("truncate(4)", 0xB_u64),
        ("extend(16)", 0xAB),
        ("sign_extend(16)", 0xFFAB),
        ("signed()", 0xAB),
        ("unsigned()", 0xAB),
    ] {
        let source = format!(
            "mod WidthTest({head} out y: bit[16]) {{
                let a: bit[8] = 8'hAB;
                comb {{ y = a.{method}; }}
            }}",
            head = COUNTER_HEAD,
            method = method
        );
        let sim = run(&source, "WidthTest", 2);
        assert_eq!(
            value_of(&sim, "y"),
            expected,
            "method '{}' should evaluate to {:#x}",
            method,
            expected
        );
    }
}

/// Spec 9.8 gives a precedence table and works an example: `a + b * c` means
/// `a + (b * c)`.
///
/// The grammar is `expr = unary_expr ~ (bin_op ~ unary_expr)*`, which says
/// nothing about grouping, and the builder folded strictly left to right. So
/// the reference computed `(a + b) * c` — 20 where the specification says 14 —
/// and every unparenthesised mixed expression in every design meant something
/// other than what it reads as.
#[test]
fn operators_group_by_the_precedence_the_specification_gives() {
    // (expression, expected) with a = 2, b = 3, c = 4.
    let cases: &[(&str, u64)] = &[
        ("a + b * c", 14),         // not (a + b) * c = 20
        ("a * b + c", 10),         // same either way, but it must not regress
        ("a & b | c", 6),          // (a & b) | c
        ("a | b & c", 2),          // a | (b & c)
        ("a + b << 1", 10),        // (a + b) << 1
        ("a << 1 + b", 32),        // a << (1 + b)
        ("a ^ b >> 1", 3),         // a ^ (b >> 1)
        ("a == b - 1", 1),         // a == (b - 1)
    ];

    for (expr, expected) in cases {
        let source = format!(
            "mod PrecTest(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out y: bit[16],
            ) {{
                let a: bit[16] = 16'd2;
                let b: bit[16] = 16'd3;
                let c: bit[16] = 16'd4;
                comb {{ y = {expr}; }}
            }}",
            expr = expr
        );

        let sim = run(&source, "PrecTest", 2);
        assert_eq!(
            value_of(&sim, "y"),
            *expected,
            "`{}` should group as spec 9.8 says",
            expr
        );
    }
}

/// Equal strengths group leftwards, as the table's associativity column says.
#[test]
fn equal_precedence_groups_to_the_left() {
    let source = "
        mod AssocTest(
            in  clk: clock,
            in  rst_n: reset(active_low: true),
            out y: bit[16],
        ) {
            let a: bit[16] = 16'd20;
            let b: bit[16] = 16'd4;
            let c: bit[16] = 16'd2;
            comb { y = a - b - c; }
        }";

    // (20 - 4) - 2 = 14, not 20 - (4 - 2) = 18
    let sim = run(source, "AssocTest", 2);
    assert_eq!(value_of(&sim, "y"), 14);
}

/// The bit-manipulation methods of spec 9.2.4, against the values 9.2.4 states.
///
/// None of these existed anywhere in the simulator. A method with no argument
/// cannot be told from a hierarchical name in the syntax tree, so instead of
/// being reported they resolved to nothing, and `$display` printed the nothing
/// as 0. Two of the five happened to have 0 as their correct answer, which is
/// what made the other three look like they worked.
#[test]
fn the_bit_methods_of_the_specification_give_the_values_it_states() {
    // 8'b1010_0101 is the specification's own example.
    let cases: &[(&str, u64)] = &[
        ("count_ones()", 4),
        ("count_zeros()", 4),
        ("leading_zeros()", 0),
        ("trailing_zeros()", 0),
    ];

    for (method, expected) in cases {
        let source = format!(
            "mod BitTest({head} out y: bit[16]) {{
                let val: bit[8] = 8'b1010_0101;
                comb {{ y = val.{method}; }}
            }}",
            head = COUNTER_HEAD,
            method = method
        );

        let sim = run(&source, "BitTest", 2);
        assert_eq!(value_of(&sim, "y"), *expected, "`{}` should give {}", method, expected);
    }
}

#[test]
fn reverse_bits_turns_a_word_end_to_end() {
    // The specification's example is a palindrome, so it cannot tell a correct
    // implementation from one that returns its input.
    let source = format!(
        "mod RevTest({head} out y: bit[8]) {{
            let v: bit[8] = 8'b1110_0001;
            comb {{ y = v.reverse_bits(); }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "RevTest", 2);
    assert_eq!(value_of(&sim, "y"), 0b1000_0111);
}

#[test]
fn saturate_clamps_instead_of_wrapping() {
    let source = format!(
        "mod SatTest({head} out y: bit[4]) {{
            let a: bit[8] = 8'hFF;
            comb {{ y = a.saturate(4); }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "SatTest", 2);
    assert_eq!(value_of(&sim, "y"), 0xF);
}

/// The reduction operators of spec 9.2.3, against the values 9.2.3 states.
#[test]
fn reduction_operators_give_the_values_the_specification_states() {
    // (literal, method, expected) — the first three are the specification's
    // own rows; the rest make sure a true result is not simply always returned.
    let cases: &[(&str, &str, u64)] = &[
        ("4'b1111", "and_reduce()", 1),
        ("4'b0001", "or_reduce()", 1),
        ("4'b1101", "xor_reduce()", 1),
        ("4'b0001", "and_reduce()", 0),
        ("4'b0000", "or_reduce()", 0),
        ("4'b1100", "xor_reduce()", 0),
    ];

    for (literal, method, expected) in cases {
        let source = format!(
            "mod RedTest({head} out y: bit[8]) {{
                let v: bit[4] = {literal};
                comb {{ y = v.{method}; }}
            }}",
            head = COUNTER_HEAD,
            literal = literal,
            method = method
        );

        let sim = run(&source, "RedTest", 2);
        assert_eq!(
            value_of(&sim, "y"),
            *expected,
            "{}.{} should be {}",
            literal,
            method,
            expected
        );
    }
}

#[test]
fn width_and_resize_and_is_power_of_two() {
    let cases: &[(&str, u64)] = &[
        ("v.width()", 8),
        ("v.resize(16)", 0xA5),
        ("v.is_power_of_two()", 0),
    ];

    for (expr, expected) in cases {
        let source = format!(
            "mod WidthTest2({head} out y: bit[16]) {{
                let v: bit[8] = 8'hA5;
                comb {{ y = {expr}; }}
            }}",
            head = COUNTER_HEAD,
            expr = expr
        );

        let sim = run(&source, "WidthTest2", 2);
        assert_eq!(value_of(&sim, "y"), *expected, "`{}` should be {}", expr, expected);
    }
}

/// Replication, spec 9.7.2, against the values 9.7.2 states.
///
/// The construct is in the specification with worked results and was in no
/// implementation: `iris2sv` accepted it and the reference did not.
#[test]
fn replication_repeats_its_operand() {
    let cases: &[(&str, u64)] = &[
        ("{16{1'b1}}", 0xFFFF),
        ("{4{8'hAB}}", 0xABAB_ABAB),
        ("{8{1'b0}}", 0),
        // The specification's own sign-extension idiom.
        ("{{8{1'b1}}, 8'h5A}", 0xFF5A),
    ];

    for (expr, expected) in cases {
        let source = format!(
            "mod RepTest({head} out y: bit[32]) {{
                comb {{ y = {expr}; }}
            }}",
            head = COUNTER_HEAD,
            expr = expr
        );

        let sim = run(&source, "RepTest", 2);
        assert_eq!(value_of(&sim, "y"), *expected, "`{}` should be {:#x}", expr, expected);
    }
}

/// `const` is in the EBNF at both file and module level, and shown in spec 4
/// as `const MAX_VAL: uint = 255;`. Nothing accepted it.
#[test]
fn a_constant_declaration_names_a_value() {
    let source = format!(
        "mod ConstTest({head} out y: bit[16]) {{
            const MAX_VAL: uint = 255;
            comb {{ y = MAX_VAL; }}
        }}",
        head = COUNTER_HEAD
    );

    let sim = run(&source, "ConstTest", 2);
    assert_eq!(value_of(&sim, "y"), 255);
}

/// `output encoding: onehot` is in spec 7 and in `tools/iris.ebnf`, and was
/// rejected with `expected output_block`.
#[test]
fn a_state_machine_may_name_its_encoding() {
    for encoding in ["binary", "onehot", "gray"] {
        let source = format!(
            "mod EncTest(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                in  go: bit,
                out y: bit,
            ) {{
                fsm m(clk.posedge, rst_n.async) {{
                    state enum {{ A, B }}
                    transitions {{ A => {{ when go {{ goto B; }} }} }}
                    output y {{ A => 0, B => 1, }}
                    output encoding: {encoding}
                }}
            }}",
            encoding = encoding
        );

        // Parsing at all is the point; the simulator holds states as integers
        // whatever the encoding says.
        let sim = run(&source, "EncTest", 2);
        assert_eq!(value_of(&sim, "y"), 0, "encoding '{}' should parse", encoding);
    }
}

/// Attributes, spec chapter 13.
///
/// `attribute = "#[" attr_path [ attr_input ] "]"` is in `tools/iris.ebnf`, and
/// `mod_def` begins with an optional one. `iris2sv` and `irisfmt` both parse
/// them; the reference had no rule for them at all, so a design carrying a
/// synthesis hint would not load.
///
/// They annotate the item that follows and carry no simulation meaning, so
/// parsing and passing over them is the whole job.
#[test]
fn attributes_are_accepted_where_the_grammar_puts_them() {
    let cases: &[&str] = &[
        // On a module, with and without arguments.
        "#[synthesis(ram_style = \"block\")]\nmod A({head} out y: bit) { comb { y = 0; } }",
        "#[test]\nmod A({head} out y: bit) { comb { y = 0; } }",
        // `false_path` starts with `false`, which a careless alternation reads
        // as a boolean and then chokes on the rest.
        "#[timing(false_path, from = \"clk_a\", to = \"clk_b\")]\nmod A({head} out y: bit) { comb { y = 0; } }",
        // On a signal inside a module.
        "mod A({head} out y: bit) {\n  #[synthesis(keep)]\n  var r: bit = 0;\n  comb { y = r; }\n}",
        // A path with `::`.
        "#[vendor::hint(fast)]\nmod A({head} out y: bit) { comb { y = 0; } }",
    ];

    for case in cases {
        let source = case.replace("{head}", COUNTER_HEAD);
        let sim = run(&source, "A", 2);
        assert_eq!(value_of(&sim, "y"), 0, "should parse: {}", case);
    }
}

/// Spec 13 writes a duration inside an attribute with a dot, as `1.ms`, where
/// a clock period is written `10ns`. Both spellings have to be read.
#[test]
fn an_attribute_may_carry_a_duration() {
    let source = format!(
        "#[timeout(1.ms)]\nmod TimeoutTest({head} out y: bit) {{ comb {{ y = 0; }} }}",
        head = COUNTER_HEAD
    );
    let sim = run(&source, "TimeoutTest", 2);
    assert_eq!(value_of(&sim, "y"), 0);
}
