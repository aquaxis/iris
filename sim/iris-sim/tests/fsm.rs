//! Tests for finite state machines (spec 07)
//!
//! An FSM must behave the same wherever it is declared, keep its state separate
//! per instance, and advance only on the clock it names.

use iris_sim::parser::Parser;
use iris_sim::project::Project;
use iris_sim::sim::HierarchicalSimulator;

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
    project.set_top(top).expect("top module should exist");
    project.elaborate();

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

/// A three-state ring: Idle -> Run -> Done -> Idle
const CTRL_MODULE: &str = "
    mod Ctrl(
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
    }";

const TOP_FSM: &str = "
    test FsmTop {
        let clk: clock(period: 10ns);
        let rst_n: reset(active_low: true);
        var go: bit = 1;
        var out_v: bit[8] = 0;

        fsm ctrl(clk.posedge, rst_n.async) {
            state enum { Idle, Run, Done }
            transitions {
                Idle => { when go { goto Run; } }
                Run  => { when go { goto Done; } }
                Done => { when go { goto Idle; } }
            }
            output out_v { Idle => 0, Run => 1, Done => 2, }
        }
    }";

const INSTANCE_FSM: &str = "
    test FsmInstTB {
        let clk: clock(period: 10ns);
        let rst_n: reset(active_low: true);
        var go: bit = 1;
        inst c = Ctrl { clk: clk, rst_n: rst_n, go: go };
    }";

#[test]
fn a_top_level_fsm_walks_its_states() {
    // Reset lasts five cycles, so one transition happens per cycle after that
    for (cycles, state) in [(6u64, 1u64), (7, 2), (8, 0), (9, 1)] {
        let sim = run(TOP_FSM, "FsmTop", cycles);
        assert_eq!(
            value_of(&sim, "ctrl_state"),
            state,
            "after {} cycles",
            cycles
        );
        assert_eq!(value_of(&sim, "out_v"), state, "the output tracks the state");
    }
}

#[test]
fn an_fsm_inside_an_instance_behaves_the_same() {
    let source = format!("{}\n{}", CTRL_MODULE, INSTANCE_FSM);
    for (cycles, state) in [(6u64, 1u64), (7, 2), (8, 0)] {
        let sim = run(&source, "FsmInstTB", cycles);
        assert_eq!(
            value_of(&sim, "c.ctrl_state"),
            state,
            "an instantiated FSM should advance like a top-level one, after {} cycles",
            cycles
        );
        assert_eq!(value_of(&sim, "c.out_v"), state);
    }
}

#[test]
fn fsm_outputs_take_the_declared_width() {
    let sim = run(TOP_FSM, "FsmTop", 7);
    assert_eq!(
        sim.get_signal("out_v").unwrap().width(),
        8,
        "an FSM output should be as wide as its declaration, not the literal"
    );
}

#[test]
fn each_instance_keeps_its_own_state() {
    let testbench = "
        test TwoFsmTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var always_on: bit = 1;
            var never: bit = 0;

            inst running = Ctrl { clk: clk, rst_n: rst_n, go: always_on };
            inst held = Ctrl { clk: clk, rst_n: rst_n, go: never };
        }";

    let source = format!("{}\n{}", CTRL_MODULE, testbench);
    let sim = run(&source, "TwoFsmTB", 7);

    assert_eq!(value_of(&sim, "running.ctrl_state"), 2, "two transitions");
    assert_eq!(
        value_of(&sim, "held.ctrl_state"),
        0,
        "the second instance must not follow the first"
    );
}

#[test]
fn an_fsm_advances_only_on_its_own_clock() {
    let testbench = "
        test ClockedTB {
            let fast: clock(period: 10ns);
            let slow: clock(period: 30ns);
            let rst_n: reset(active_low: true);
            var go: bit = 1;

            inst quick = Ctrl { clk: fast, rst_n: rst_n, go: go };
            inst slug  = Ctrl { clk: slow, rst_n: rst_n, go: go };
        }";

    let source = format!("{}\n{}", CTRL_MODULE, testbench);
    let sim = run(&source, "ClockedTB", 20);

    // 200 ns total, reset released at 50 ns.
    // fast rises every 10 ns from 55 ns: 15 transitions, 15 % 3 == 0
    // slow rises every 30 ns from 75 ns:  5 transitions,  5 % 3 == 2
    assert_eq!(value_of(&sim, "quick.ctrl_state"), 0);
    assert_eq!(
        value_of(&sim, "slug.ctrl_state"),
        2,
        "the slower domain must not be driven by the fast clock"
    );
}

#[test]
fn an_fsm_holds_its_initial_state_during_reset() {
    let source = format!("{}\n{}", CTRL_MODULE, INSTANCE_FSM);
    // Reset is asserted for the first five cycles
    let sim = run(&source, "FsmInstTB", 4);
    assert_eq!(value_of(&sim, "c.ctrl_state"), 0);
}

#[test]
fn the_declared_initial_state_is_used() {
    // `go` is held low, so the FSM stays wherever it starts
    let source = "
        test InitTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var go: bit = 0;
            var out_v: bit[8] = 0;
            fsm m(clk.posedge, rst_n.async) {
                state enum { Idle, Run, Done }
                initial: Run
                transitions {
                    Idle => { when go { goto Run; } }
                    Run  => { when go { goto Done; } }
                    Done => { when go { goto Idle; } }
                }
                output out_v { Idle => 0, Run => 1, Done => 2, }
            }
        }";

    let sim = run(source, "InitTB", 8);
    assert_eq!(
        value_of(&sim, "m_state"),
        1,
        "`initial: Run` should select Run, not the first state"
    );
    assert_eq!(value_of(&sim, "out_v"), 1);
}

#[test]
fn an_fsm_may_declare_local_signals() {
    // Spec 7.1 allows signal declarations inside the FSM body
    let source = "
        test LocalTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var go: bit = 1;
            var out_v: bit[8] = 0;
            fsm m(clk.posedge, rst_n.async) {
                state enum { A, B }
                initial: A
                var ticks: bit[8] = 0;
                transitions {
                    A => { when go { ticks = ticks + 1; goto B; } }
                    B => { when go { ticks = ticks + 1; goto A; } }
                }
                output out_v { A => 0, B => 1, }
            }
        }";

    let sim = run(source, "LocalTB", 9);
    assert_eq!(
        value_of(&sim, "m.ticks"),
        4,
        "the local belongs to the FSM and is updated by the transitions"
    );
    assert!(
        sim.get_signal("ticks").is_none(),
        "an FSM's own signal must not appear in the module's scope"
    );
}

#[test]
fn an_fsm_local_does_not_disturb_a_module_signal_of_the_same_name() {
    // The module and the FSM each have a `count`; they must stay separate
    let source = "
        test ShadowTB {
            let clk: clock(period: 10ns);
            let rst_n: reset(active_low: true);
            var go: bit = 1;
            var count: bit[8] = 100;

            sync(clk.posedge, rst_n.async) { count = count + 1; }

            fsm m(clk.posedge, rst_n.async) {
                state enum { A, B }
                initial: A
                var count: bit[8] = 0;
                transitions {
                    A => { when go { count = count + 1; goto B; } }
                    B => { when go { count = count + 1; goto A; } }
                }
            }
        }";

    let sim = run(source, "ShadowTB", 9);
    let module_count = value_of(&sim, "count");
    let fsm_count = value_of(&sim, "m.count");
    assert_eq!(fsm_count, 4, "the FSM counts its own transitions");
    assert!(
        module_count > 100,
        "the module's own counter kept counting from 100, got {}",
        module_count
    );
}

#[test]
fn a_when_clause_may_branch_with_if() {
    // tools/iris.ebnf allows a statement as a transition action
    let source = "
        test FsmIfTB {
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
                            if ped {
                                goto Walk;
                                walked = 1;
                            } else {
                                goto Red;
                            }
                            timer = 0;
                        }
                    }
                }
            }
        }";

    let walking = run(source, "FsmIfTB", 10);
    assert_eq!(value_of(&walking, "walked"), 1, "the taken branch ran");
    assert_eq!(value_of(&walking, "light_state"), 3, "goto Walk was taken");

    let source_no_ped = source.replace("var ped: bit = 1;", "var ped: bit = 0;");
    let waiting = run(&source_no_ped, "FsmIfTB", 10);
    assert_eq!(value_of(&waiting, "walked"), 0, "the other branch ran");
    assert_eq!(value_of(&waiting, "light_state"), 0, "goto Red was taken");
}
