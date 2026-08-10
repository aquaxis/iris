//! End-to-end tests for the asynchronous FIFO example
//!
//! The first test runs the shipped example exactly as `run.sh` does. The second
//! reuses the same design source with different generic arguments, which is what
//! makes the parameterization meaningful rather than decorative.

use std::path::Path;

use iris_sim::parser::Parser;
use iris_sim::project::Project;
use iris_sim::sim::HierarchicalSimulator;

fn example_dir() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../example/async_fifo"))
}

/// Build a project from source text and run it as a testbench
fn run_testbench(source: &str, top: &str, cycles: u64) -> HierarchicalSimulator {
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
    project.set_top(top).expect("top module should exist");
    project.elaborate();

    // A test module drives its own reset from the declared configuration
    let mut sim = HierarchicalSimulator::new(project);
    sim.run_cycles(cycles);
    sim
}

fn value_of(sim: &HierarchicalSimulator, name: &str) -> u64 {
    sim.get_signal(name)
        .unwrap_or_else(|| panic!("signal '{}' should exist", name))
        .to_u64()
        .unwrap_or_else(|| panic!("signal '{}' should be fully defined", name))
}

fn design_source() -> String {
    std::fs::read_to_string(example_dir().join("src/async_fifo.iris"))
        .expect("the example design should be readable")
}

#[test]
fn shipped_example_transfers_every_word_in_order() {
    let design = design_source();
    let testbench = std::fs::read_to_string(example_dir().join("src/async_fifo_tb.iris"))
        .expect("the example testbench should be readable");
    let source = format!("{}\n{}", design, testbench);

    let sim = run_testbench(&source, "AsyncFifoTB", 200);

    assert_eq!(value_of(&sim, "mismatch"), 0, "no word may differ from the expected value");
    assert_eq!(value_of(&sim, "wr_count"), 40, "all 40 words should be accepted");
    assert_eq!(value_of(&sim, "rd_count"), 40, "all 40 words should be read back");
}

#[test]
fn the_full_flag_asserts_during_the_shipped_run() {
    // The reader is slower than the writer, so the FIFO must fill up at some
    // point. Without this the Gray-code full detection would never be exercised.
    let design = design_source();
    let testbench = std::fs::read_to_string(example_dir().join("src/async_fifo_tb.iris")).unwrap();
    let source = format!("{}\n{}", design, testbench);

    let sim = run_testbench(&source, "AsyncFifoTB", 200);
    let changes = sim
        .get_trace()
        .get_changes("dut.full")
        .expect("the DUT's full flag should be traced");
    let asserted_at: Vec<u64> = changes
        .iter()
        .filter(|(_, value)| value.to_u64() == Some(1))
        .map(|(time, _)| *time)
        .collect();

    assert!(
        !asserted_at.is_empty(),
        "the FIFO should fill up while the slower reader drains it"
    );
    // Sixteen words at a 10 ns write period cannot fill before roughly 160 ns
    assert!(
        asserted_at[0] > 100_000,
        "full asserted implausibly early, at {} ps",
        asserted_at[0]
    );
}

#[test]
fn the_same_design_works_at_another_size() {
    // Depth 4 and 4-bit data, instantiated from the same source file
    let testbench = "
        test SmallFifoTB {
            let wr_clk: clock(period: 10ns);
            let rd_clk: clock(period: 25ns);
            let wr_rst_n: reset(active_low: true);
            let rd_rst_n: reset(active_low: true);

            var wr_en: bit = 0;
            var wr_data: bit[4] = 1;
            var wr_count: bit[8] = 0;

            var rd_en: bit = 0;
            var expected: bit[4] = 1;
            var rd_count: bit[8] = 0;
            var mismatch: bit = 0;

            inst dut = AsyncFifo[DataWidth: 4, Depth: 4] {
                wr_clk: wr_clk,
                wr_rst_n: wr_rst_n,
                wr_en: wr_en,
                wr_data: wr_data,
                rd_clk: rd_clk,
                rd_rst_n: rd_rst_n,
                rd_en: rd_en,
            };

            sync(wr_clk.posedge, wr_rst_n.async) {
                if ~wr_rst_n {
                    wr_en = 0;
                    wr_data = 1;
                    wr_count = 0;
                } else {
                    if wr_en {
                        if ~dut.full {
                            wr_data = wr_data + 1;
                            wr_count = wr_count + 1;
                            if (wr_count + 1) < 10 {
                                wr_en = 1;
                            } else {
                                wr_en = 0;
                            }
                        } else {
                            wr_en = 1;
                        }
                    } else {
                        if wr_count < 10 {
                            wr_en = 1;
                        } else {
                            wr_en = 0;
                        }
                    }
                }
            }

            sync(rd_clk.posedge, rd_rst_n.async) {
                if ~rd_rst_n {
                    rd_en = 0;
                    expected = 1;
                    rd_count = 0;
                    mismatch = 0;
                } else {
                    if rd_en {
                        if ~dut.empty {
                            if dut.rd_data != expected {
                                mismatch = 1;
                            }
                            expected = expected + 1;
                            rd_count = rd_count + 1;
                        }
                    }
                    rd_en = 1;
                }
            }
        }";

    let source = format!("{}\n{}", design_source(), testbench);
    let sim = run_testbench(&source, "SmallFifoTB", 120);

    assert_eq!(value_of(&sim, "mismatch"), 0, "a depth-4 FIFO must also preserve order");
    assert_eq!(value_of(&sim, "wr_count"), 10);
    assert_eq!(value_of(&sim, "rd_count"), 10);
}

#[test]
fn generic_arguments_size_the_ports_and_the_memory() {
    let testbench = "
        test SizesTB {
            let wr_clk: clock(period: 10ns);
            let rd_clk: clock(period: 25ns);
            let wr_rst_n: reset(active_low: true);
            let rd_rst_n: reset(active_low: true);
            var wr_en: bit = 0;
            var rd_en: bit = 0;
            var wr_data: bit[16] = 0;

            inst dut = AsyncFifo[DataWidth: 16, Depth: 64] {
                wr_clk: wr_clk,
                wr_rst_n: wr_rst_n,
                wr_en: wr_en,
                wr_data: wr_data,
                rd_clk: rd_clk,
                rd_rst_n: rd_rst_n,
                rd_en: rd_en,
            };
        }";

    let source = format!("{}\n{}", design_source(), testbench);
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
    project.set_top("SizesTB").unwrap();
    project.elaborate();

    let top = project.get_top_module().unwrap();
    let dut_module = &top.instances[0].module_name;
    let fifo = project.get_module(dut_module).expect("specialized module");

    let rd_data = fifo.ports.iter().find(|p| p.name == "rd_data").unwrap();
    assert_eq!(rd_data.ty.width(), Some(16), "DataWidth should size the data ports");

    let storage = &fifo.memories[0];
    assert_eq!(storage.depth, 64, "Depth should size the memory");
    assert_eq!(storage.element_type.width(), Some(16));

    // PtrWidth is $clog2(64) + 1 = 7
    let wr_ptr = fifo.signals.iter().find(|s| s.name == "wr_ptr").unwrap();
    assert_eq!(
        wr_ptr.ty.width(),
        Some(7),
        "the derived pointer width should follow the overridden depth"
    );
}
