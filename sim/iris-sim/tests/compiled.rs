//! The compiled backend must agree with the interpreter
//!
//! Each test writes a design, runs it both ways, and requires the two to agree
//! on every signal and on the whole waveform. A difference means `iris-compile`
//! and `iris-sim` disagree about what the design means, which is the one thing
//! a second backend must never do.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Where the generated crates and their build artefacts go
fn work_dir(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("compiled-tests")
        .join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("work directory");
    dir
}

/// A cargo target directory shared by every test, so the runtime is built once
fn shared_target() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("compiled-tests")
        .join("_target")
}

fn runtime_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("iris-runtime")
}

/// The section of a verbose run that lists every signal's final value
fn final_values(output: &str) -> String {
    match output.find("Final signal values:") {
        Some(pos) => output[pos..].to_string(),
        None => String::new(),
    }
}

/// The lines a run printed, with blank lines dropped
fn lines(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect()
}

/// Run a design through both backends and require them to agree
fn both_ways(name: &str, sources: &[(&str, &str)], top: Option<&str>, cycles: u64) {
    let dir = work_dir(name);

    let mut paths: Vec<PathBuf> = Vec::new();
    for (file, source) in sources {
        let path = dir.join(file);
        std::fs::write(&path, source).expect("write source");
        paths.push(path);
    }

    let interp_vcd = dir.join("interpreted.vcd");
    let run_interpreter = |verbose: bool, vcd: &Path| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_iris-sim"));
        for path in &paths {
            command.arg("-i").arg(path);
        }
        if let Some(top) = top {
            command.arg("-t").arg(top);
        }
        if verbose {
            command.arg("-v");
        }
        command
            .arg("-o")
            .arg(vcd)
            .arg("-c")
            .arg(cycles.to_string())
            .output()
            .expect("run iris-sim")
    };
    let interpreted = run_interpreter(false, &interp_vcd);
    let interpreted_verbose = run_interpreter(true, &dir.join("interpreted-verbose.vcd"));

    let binary = dir.join("compiled");
    let mut compiler = Command::new(env!("CARGO_BIN_EXE_iris-compile"));
    for path in &paths {
        compiler.arg("-i").arg(path);
    }
    if let Some(top) = top {
        compiler.arg("-t").arg(top);
    }
    let built = compiler
        .arg("-o")
        .arg(&binary)
        .arg("--runtime-path")
        .arg(runtime_path())
        .env("CARGO_TARGET_DIR", shared_target())
        .output()
        .expect("run iris-compile");
    assert!(
        built.status.success(),
        "{}: iris-compile failed\n{}\n{}",
        name,
        String::from_utf8_lossy(&built.stdout),
        String::from_utf8_lossy(&built.stderr)
    );

    let compiled_vcd = dir.join("compiled.vcd");
    let run_compiled = |verbose: bool, vcd: &Path| {
        let mut command = Command::new(&binary);
        command.arg("-c").arg(cycles.to_string()).arg("-o").arg(vcd);
        if verbose {
            command.arg("-v");
        }
        command.output().expect("run compiled simulation")
    };
    let compiled = run_compiled(false, &compiled_vcd);
    let compiled_verbose = run_compiled(true, &dir.join("compiled-verbose.vcd"));

    assert_eq!(
        final_values(&String::from_utf8_lossy(&interpreted_verbose.stdout)),
        final_values(&String::from_utf8_lossy(&compiled_verbose.stdout)),
        "{}: final signal values differ",
        name
    );
    assert_eq!(
        lines(&String::from_utf8_lossy(&interpreted.stdout)),
        lines(&String::from_utf8_lossy(&compiled.stdout)),
        "{}: the design printed different output",
        name
    );
    assert_eq!(
        lines(&String::from_utf8_lossy(&interpreted.stderr)),
        lines(&String::from_utf8_lossy(&compiled.stderr)),
        "{}: the two backends reported different diagnostics",
        name
    );
    assert_eq!(
        interpreted.status.code(),
        compiled.status.code(),
        "{}: exit status differs",
        name
    );
    assert_eq!(
        read(&interp_vcd),
        read(&compiled_vcd),
        "{}: waveforms differ",
        name
    );
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

const COUNTER_HEAD: &str = "in clk: clock, in rst_n: reset(active_low: true),";

#[test]
fn floating_point_arithmetic_agrees() {
    // The compiled backend must evaluate f32/f64 the same as the interpreter,
    // including a real literal taking its operand's format and a comparison
    // yielding one bit. Inputs default to zero, so a = 0.0.
    both_ways(
        "float_math",
        &[(
            "float_math.iris",
            "mod FMath(
                in a: f32,
                in b: f64,
                out y: f32,
                out d: f64,
                out lt: bit,
            ) {
                comb {
                    y = a + 1.5;
                    d = b * 2.0;
                    lt = a < 1.5;
                }
            }",
        )],
        None,
        3,
    );
}

#[test]
fn floating_point_literals_agree() {
    // A bare real literal and a real-literal-only expression take the target's
    // format in both backends.
    both_ways(
        "float_literals",
        &[(
            "float_literals.iris",
            "mod FLit(
                out y: f32,
                out z: f64,
            ) {
                comb {
                    y = 1.5 + 2.25;
                    z = 3.25;
                }
            }",
        )],
        None,
        3,
    );
}

#[test]
fn a_floating_point_memory_agrees() {
    // A memory of f32 elements must read back as a float in both backends,
    // waveform included.
    both_ways(
        "float_memory",
        &[(
            "float_memory.iris",
            "mod FMem(
                in clk: clock,
                in we: bit,
                in addr: bit[8],
                in wdata: f32,
                out rdata: f32,
            ) {
                mem storage: f32[4];
                sync(clk.posedge) {
                    if we { storage[addr] = wdata; }
                }
                comb { rdata = storage[addr]; }
            }",
        )],
        None,
        4,
    );
}

#[test]
fn a_single_clock_counter_agrees() {
    both_ways(
        "counter",
        &[(
            "counter.iris",
            "mod Counter(
                in clk: clock,
                in rst: reset,
                in enable: bit,
                out count: bit[8],
            ) {
                var counter: bit[8] = 0;
                sync(clk.posedge, rst.async) {
                    if enable { counter = counter + 1; }
                }
                comb { count = counter; }
            }",
        )],
        None,
        20,
    );
}

#[test]
fn memories_and_block_locals_agree() {
    both_ways(
        "memory",
        &[(
            "memory.iris",
            &format!(
                "mod Ram({head} out q: bit[8]) {{
                    mem storage: bit[8][8];
                    var addr: bit[3] = 0;
                    var out_v: bit[8] = 0;
                    sync(clk.posedge, rst_n.async) {{
                        storage[addr] = addr + 100;
                        addr = addr + 1;
                    }}
                    comb {{
                        let word: bit[8] = storage[addr];
                        out_v = word;
                        q = out_v;
                    }}
                }}",
                head = COUNTER_HEAD
            ),
        )],
        None,
        12,
    );
}

#[test]
fn match_and_part_select_agree() {
    both_ways(
        "match",
        &[(
            "match.iris",
            &format!(
                "mod Alu({head} out result: bit[8]) {{
                    var a: bit[8] = 12;
                    var b: bit[8] = 5;
                    var op: bit[2] = 0;
                    var field: bit[8] = 0;
                    var wide: bit[16] = 16'hbeef;
                    sync(clk.posedge, rst_n.async) {{ op = op + 1; }}
                    comb {{
                        result = match op {{
                            2'b00 => a + b,
                            2'b01 => a - b,
                            2'b10 => a & b,
                            _     => a | b,
                        }};
                        field = wide[4 +: 8];
                    }}
                }}",
                head = COUNTER_HEAD
            ),
        )],
        None,
        6,
    );
}

#[test]
fn signed_arithmetic_agrees() {
    both_ways(
        "signed",
        &[(
            "signed.iris",
            &format!(
                "mod Signed({head} out q: bit[8]) {{
                    var a: i8 = -50;
                    var b: i8 = 30;
                    var less: bit = 0;
                    var quotient: i8 = 0;
                    var shifted: i8 = 0;
                    sync(clk.posedge, rst_n.async) {{
                        less = a < b;
                        quotient = a / b;
                        shifted = a >>> 2;
                    }}
                    comb {{ q = quotient; }}
                }}",
                head = COUNTER_HEAD
            ),
        )],
        None,
        6,
    );
}

#[test]
fn a_state_machine_inside_an_instance_agrees() {
    both_ways(
        "fsm",
        &[(
            "fsm.iris",
            "mod Ctrl(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                in  go: bit,
                out out_v: bit[8],
            ) {
                fsm ctrl(clk.posedge, rst_n.async) {
                    state enum { Idle, Run, Done }
                    transitions {
                        Idle => { when go { goto Run; } }
                        Run  => { when go { goto Done; } }
                        Done => { when go { goto Idle; } }
                    }
                    output out_v { Idle => 0, Run => 1, Done => 2, }
                }
            }

            test FsmInstTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                var go: bit = 1;
                inst c = Ctrl { clk: clk, rst_n: rst_n, go: go };
            }",
        )],
        Some("FsmInstTB"),
        12,
    );
}

#[test]
fn an_fsm_with_its_own_signals_agrees() {
    both_ways(
        "fsm_locals",
        &[(
            "fsm_locals.iris",
            "test ShadowTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                var go: bit = 1;
                var count: bit[8] = 100;

                sync(clk.posedge, rst_n.async) { count = count + 1; }

                fsm m(clk.posedge, rst_n.async) {
                    state enum { A[phase = 0], B[phase = 1] }
                    initial: A
                    var count: bit[8] = 0;
                    transitions {
                        A => { when go { count = count + 1; goto B; } }
                        B => { when go { count = count + 1; goto A; } }
                    }
                }
            }",
        )],
        Some("ShadowTB"),
        12,
    );
}

#[test]
fn a_branching_when_clause_agrees() {
    both_ways(
        "fsm_if",
        &[(
            "fsm_if.iris",
            "test FsmIfTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                var ped: bit = 1;
                var timer: bit[8] = 0;
                var walked: bit = 0;

                sync(clk.posedge, rst_n.async) { timer = timer + 1; }

                fsm light(clk.posedge, rst_n.async) {
                    state enum { Red, Green, Yellow, Walk }
                    initial: Yellow
                    transitions {
                        Yellow => {
                            when timer >= 8'd2 {
                                if ped { goto Walk; walked = 1; } else { goto Red; }
                                timer = 0;
                            }
                        }
                        Walk => { when timer >= 8'd4 { goto Red; } }
                    }
                }
            }",
        )],
        Some("FsmIfTB"),
        16,
    );
}

#[test]
fn a_sequential_testbench_agrees() {
    // `await` has to suspend the block and let the design advance, in both
    both_ways(
        "sequential",
        &[(
            "sequential.iris",
            "test SeqTB {
                let clk: clock;
                let rst: reset;
                var value: bit[8] = 0;
                var i: bit[8] = 0;
                var acc: bit[8] = 0;

                sync(clk.posedge, rst.async) { value = value + 1; }

                seq {
                    $display(\"start: value = %0d\", value);
                    for i in 0..3 {
                        await clk.cycles(2);
                        acc = acc + i;
                        $display(\"loop i=%0d value=%0d acc=%0d\", i, value, acc);
                    }
                    #50ns;
                    $display(\"after delay: value = %0d\", value);
                    await until(value >= 8'd30);
                    $display(\"condition met at value = %0d\", value);
                    assert value >= 8'd30, \"the condition must hold on resume\";
                    $finish;
                }
            }",
        )],
        Some("SeqTB"),
        80,
    );
}

#[test]
fn an_enum_typed_design_agrees() {
    both_ways(
        "enums",
        &[(
            "enums.iris",
            "enum Colour { Red, Green, Blue }

            mod Painter(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out y: bit[8],
            ) {
                var c: Colour = Colour::Red;
                var out_v: bit[8] = 0;
                sync(clk.posedge, rst_n.async) { c = Colour::Green; }
                comb {
                    match c {
                        Colour::Red => { out_v = 10; },
                        Colour::Green => { out_v = 20; },
                        Colour::Blue => { out_v = 30; },
                    }
                    y = out_v;
                }
            }",
        )],
        None,
        8,
    );
}

#[test]
fn an_interface_design_agrees() {
    both_ways(
        "interface",
        &[("interface.iris", "interface Simple {
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
            }")],
        Some("IfaceTB"),
        12,
    );
}

#[test]
fn loop_control_in_a_sequential_block_agrees() {
    both_ways(
        "loop_control",
        &[(
            "loop_control.iris",
            "test BreakTB {
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
                        $display(\"i=%0d acc=%0d\", i, acc);
                    }
                    $display(\"done: i=%0d acc=%0d\", i, acc);
                    $finish;
                }
            }",
        )],
        Some("BreakTB"),
        40,
    );
}

#[test]
fn loop_control_in_a_logic_block_agrees() {
    both_ways(
        "loop_control_comb",
        &[(
            "loop_control_comb.iris",
            "mod LoopCtl(
                in  clk: clock,
                in  rst_n: reset(active_low: true),
                out y: bit[16],
            ) {
                var i: bit[8] = 0;
                var mask: bit[16] = 0;
                comb {
                    for i in 0..10 {
                        if i == 2 { continue; }
                        if i == 5 { break; }
                        mask[i] = 1;
                    }
                    y = mask;
                }
            }",
        )],
        None,
        6,
    );
}

#[test]
fn a_tagged_union_agrees() {
    both_ways(
        "tagged_union",
        &[("tagged_union.iris", "enum Packet {
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
            }")],
        None,
        6,
    );
}

#[test]
fn coverage_and_soft_checks_agree() {
    both_ways(
        "verification",
        &[("verification.iris", "test VerifTB {
                let clk: clock;
                let rst: reset;
                var count: bit[8] = 0;

                sync(clk.posedge, rst.async) {
                    count = count + 1;
                    expect count < 8'd200, \"soft check\";
                    assume count != 8'd255, \"premise\";
                    cover count == 8'd5, \"reached five\";
                    cover count > 8'd100, \"over a hundred\";
                }
            }")],
        Some("VerifTB"),
        20,
    );
}

#[test]
fn an_inherited_interface_agrees() {
    both_ways(
        "interface_extends",
        &[("interface_extends.iris", "interface StreamBase {
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
            }")],
        Some("ExtTB"),
        12,
    );
}

#[test]
fn structures_and_unions_agree() {
    both_ways(
        "composites",
        &[("composites.iris", "struct Header {
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
            }")],
        None,
        6,
    );
}

#[test]
fn randomisation_agrees() {
    // Both backends draw from the same generator, so the values match
    both_ways(
        "randomize",
        &[("randomize.iris", "test RandTB {
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
                        $display(\"draw %0d: size=%0d kind=%0d\", draws, size, kind);
                        assert size >= 16'd64, \"constraint held\";
                        assert size <= 16'd1518, \"constraint held\";
                        assert kind < 4'd8, \"constraint held\";
                        await clk.cycles(1);
                    }
                    $finish;
                }
            }")],
        Some("RandTB"),
        40,
    );
}

#[test]
fn a_match_expression_with_a_binding_agrees() {
    both_ways(
        "match_binding",
        &[("match_binding.iris", "enum Packet { Header, Payload(bit[8]), Footer }

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
            }")],
        None,
        6,
    );
}

#[test]
fn nested_instances_agree() {
    both_ways(
        "nested",
        &[(
            "nested.iris",
            "mod Leaf(
                in clk: clock,
                in rst_n: reset(active_low: true),
                in step: bit[8],
                out total: bit[8],
            ) {
                var acc: bit[8] = 0;
                sync(clk.posedge, rst_n.async) { acc = acc + step; }
                comb { total = acc; }
            }

            mod Middle(
                in clk: clock,
                in rst_n: reset(active_low: true),
                in step: bit[8],
                out total: bit[8],
            ) {
                inst leaf = Leaf { clk: clk, rst_n: rst_n, step: step };
                comb { total = leaf.total; }
            }

            test NestedTB {
                let clk: clock(period: 10ns);
                let rst_n: reset(active_low: true);
                var step: bit[8] = 3;
                var seen: bit[8] = 0;
                inst mid = Middle { clk: clk, rst_n: rst_n, step: step };
                comb { seen = mid.total; }
            }",
        )],
        Some("NestedTB"),
        12,
    );
}

#[test]
fn a_failing_assertion_agrees() {
    both_ways(
        "assert",
        &[(
            "assert.iris",
            &format!(
                "mod AssertTest({head} out y: bit[8]) {{
                    var c: bit[8] = 0;
                    sync(clk.posedge, rst_n.async) {{
                        c = c + 1;
                        assert c < 3, \"counter overflow\";
                    }}
                    comb {{ y = c; }}
                }}",
                head = COUNTER_HEAD
            ),
        )],
        None,
        8,
    );
}

#[test]
fn the_shipped_example_agrees() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("example")
        .join("async_fifo")
        .join("src");
    let design = std::fs::read_to_string(root.join("async_fifo.iris")).expect("design");
    let bench = std::fs::read_to_string(root.join("async_fifo_tb.iris")).expect("testbench");

    both_ways(
        "async_fifo",
        &[
            ("async_fifo.iris", design.as_str()),
            ("async_fifo_tb.iris", bench.as_str()),
        ],
        None,
        200,
    );
}

#[test]
fn slicing_an_instance_output_agrees() {
    // `u.y[1:0]` used to return zero under the interpreter and be refused by
    // the compiled backend. Reading the whole value always worked, so the two
    // disagreed only once a slice was taken — which is how an RV32I core came
    // to address the wrong memory word.
    both_ways(
        "instance_output_slice",
        &[(
            "slice.iris",
            "mod Adder(in a: bit[32], in b: bit[32], out y: bit[32]) {
                comb { y = a + b; }
            }
            test SliceTop {
                let clk: clock(period: 10ns);
                var pa: bit[32] = 32'h100;
                var pb: bit[32] = 32'h3;
                var whole: bit[32] = 0;
                var sliced: bit[2] = 0;
                var bitsel: bit = 0;
                var upper: bit[4] = 0;

                inst u = Adder { a: pa, b: pb };

                comb {
                    whole  = u.y;
                    sliced = u.y[1:0];
                    bitsel = u.y[0];
                    upper  = u.y[11:8];
                }
                sync(clk.posedge) { pa = 32'h100; pb = 32'h3; }
            }",
        )],
        None,
        10,
    );
}

#[test]
fn a_module_level_let_follows_its_inputs() {
    // Spec 2.4.3 calls `let` an immutable signal declaration whose
    // SystemVerilog equivalent is `wire` + `assign`. Both backends used to
    // evaluate it once at elaboration and freeze it, so `let sum = a + b;`
    // stayed at whatever a and b held at time zero.
    both_ways(
        "module_level_let",
        &[(
            "let_wire.iris",
            "mod Wire(in a: bit[8], out via_let: bit[8], out via_var: bit[8]) {
                let copied: bit[8] = a;
                var assigned: bit[8] = 0;
                comb {
                    via_let = copied;
                    assigned = a;
                    via_var = assigned;
                }
            }
            test LetTop {
                let clk: clock(period: 10ns);
                var src: bit[8] = 0;
                inst u = Wire { a: src };
                sync(clk.posedge) { src = src + 1; }
            }",
        )],
        None,
        10,
    );
}

#[test]
fn reading_a_memory_through_an_instance_agrees() {
    // `u.m[1]` parses the same way a method call does, so the memory has to be
    // looked up before the name is treated as a method. The interpreter used to
    // return zero in silence; the compiled backend refused it outright.
    both_ways(
        "hierarchical_memory_read",
        &[(
            "hier_mem.iris",
            "mod Store(in clk: clock, in we: bit, in addr: bit[3], in data: bit[8]) {
                mem m: bit[8][8];
                sync(clk.posedge) {
                    if we { m[addr] = data; }
                }
            }
            test HierMemTop {
                let clk: clock(period: 10ns);
                var we: bit = 1;
                var seen: bit[8] = 0;
                var other: bit[8] = 0;

                inst u = Store { clk: clk, we: we, addr: 3'd1, data: 8'd42 };

                comb {
                    seen = u.m[1];
                    other = u.m[2];
                }
                sync(clk.posedge) { we = 0; }
            }",
        )],
        None,
        10,
    );
}

#[test]
fn an_untyped_let_takes_its_width_from_the_initialiser() {
    // `let sum = a + b;` writes no type. Both backends used to make it one bit,
    // truncating every value assigned to it. The width comes from the
    // expression: the interpreter settles it once the signals exist, the
    // compiled backend infers it when the slot is allocated.
    both_ways(
        "untyped_let_width",
        &[(
            "untyped_let.iris",
            "mod Sum(in a: bit[8], in b: bit[8], out y: bit[8]) {
                let total = a + b;
                comb { y = total; }
            }
            test UntypedLetTop {
                let clk: clock(period: 10ns);
                var x: bit[8] = 200;
                var z: bit[8] = 55;
                inst u = Sum { a: x, b: z };
                sync(clk.posedge) { x = 200; z = 55; }
            }",
        )],
        None,
        10,
    );
}

#[test]
fn reading_a_memory_two_levels_down_agrees() {
    // `top.mid.m[1]` parses as a method call whose receiver is itself a method
    // call. Only the one-level form worked at first, which is why the RV32I
    // example had to expose its register file through a debug port.
    both_ways(
        "hierarchical_memory_two_levels",
        &[(
            "deep_mem.iris",
            "mod Store(in clk: clock, in we: bit, in addr: bit[3], in data: bit[8]) {
                mem m: bit[8][8];
                sync(clk.posedge) {
                    if we { m[addr] = data; }
                }
            }
            mod Middle(in clk: clock, in we: bit, in addr: bit[3], in data: bit[8]) {
                inst inner = Store { clk: clk, we: we, addr: addr, data: data };
            }
            test DeepMemTop {
                let clk: clock(period: 10ns);
                var we: bit = 1;
                var one_level: bit[8] = 0;
                var two_levels: bit[8] = 0;

                inst mid = Middle { clk: clk, we: we, addr: 3'd1, data: 8'd42 };

                comb {
                    two_levels = mid.inner.m[1];
                }
                sync(clk.posedge) { we = 0; }
            }",
        )],
        None,
        10,
    );
}

/// The width and bit methods of spec 3.4.2, 9.2.3 and 9.2.4 must give the same
/// answers whichever backend runs them.
///
/// The interpreter gained them first, and the compiled backend knew only
/// `signed`, `unsigned`, `sign_extend` and `extend`. A design using any of the
/// rest ran one way and failed to build the other, which is the one thing a
/// second backend must never do.
#[test]
fn both_backends_agree_on_the_width_and_bit_methods() {
    both_ways(
        "method_parity",
        &[(
            "methods.iris",
            r#"
mod Methods(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    out a: bit[16], out b: bit[16], out c: bit[16], out d: bit[16],
    out e: bit[16], out f: bit[16], out g: bit[16], out h: bit[16],
    out i: bit[16], out j: bit[16], out k: bit[16],
) {
    let v: bit[8] = 8'b1110_0001;
    comb {
        a = v.count_ones();
        b = v.count_zeros();
        c = v.leading_zeros();
        d = v.trailing_zeros();
        e = v.reverse_bits();
        f = v.and_reduce();
        g = v.or_reduce();
        h = v.xor_reduce();
        i = v.width();
        j = v.truncate(4);
        k = v.saturate(4);
    }
}
"#,
        )],
        Some("Methods"),
        4,
    );
}

/// Spec 9.8 gives a precedence table, and both backends have to honour it.
#[test]
fn both_backends_agree_on_operator_precedence() {
    both_ways(
        "precedence_parity",
        &[(
            "prec.iris",
            r#"
mod Prec(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    out w: bit[16], out x: bit[16], out y: bit[16], out z: bit[16],
) {
    let a: bit[16] = 16'd2;
    let b: bit[16] = 16'd3;
    let c: bit[16] = 16'd4;
    comb {
        w = a + b * c;
        x = a & b | c;
        y = a + b << 1;
        z = a ^ b >> 1;
    }
}
"#,
        )],
        Some("Prec"),
        4,
    );
}
