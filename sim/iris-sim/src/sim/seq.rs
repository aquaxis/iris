//! Sequential blocks as a resumable program
//!
//! A `seq` block cannot run straight through: `await` has to stop it, let the
//! design advance, and resume where it left off. Control flow makes that
//! awkward to do by walking the syntax tree, so the block is flattened into a
//! list of instructions with jumps. Suspending is then just a matter of
//! remembering the index.
//!
//! Both the interpreter and the code generator use this flattening, so a
//! testbench means the same thing either way.

use crate::parser::{AssertStmt, BinOp, Expression, Literal, SeqStatement};
use crate::types::SimTime;

/// One step of a flattened sequential block
#[derive(Clone, Debug)]
pub enum SeqInstr {
    /// `target = value`
    Assign {
        target: String,
        value: Expression,
    },
    /// `path.set(value)`
    SignalWrite {
        path: String,
        value: Expression,
    },
    /// `mem[addr] = value`
    MemWrite {
        mem_name: String,
        addr: Expression,
        value: Expression,
    },
    /// `assert ...`
    Assert(AssertStmt),
    /// `cover ...`
    Cover(crate::parser::CoverStmt),
    /// `$display(...)`, `$finish`
    SysCall(Expression),
    /// `#10ns` — resume once this much time has passed
    Delay(SimTime),
    /// `await clk.posedge` / `await clk.cycles(n)` — resume after n edges
    AwaitEdges(Expression),
    /// `await until(cond)` — resume when the condition holds, or on timeout
    AwaitUntil {
        condition: Expression,
        timeout: Option<SimTime>,
    },
    /// Continue at `target` when the condition is false
    JumpIfFalse {
        condition: Expression,
        target: usize,
    },
    /// Continue at `target`
    Jump(usize),
}

/// What a suspended program is waiting for.
///
/// `await until(...)` does not appear here: it suspends for one edge at a
/// time and re-runs its own instruction, so the condition is re-checked by the
/// same code that first evaluated it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeqWait {
    /// Nothing; the next instruction may run
    Ready,
    /// This many more clock edges
    Edges(u64),
    /// This point in time
    Time(SimTime),
    /// The program has run to the end
    Done,
}

/// The loop a `break` or `continue` belongs to
#[derive(Default)]
struct LoopCtx {
    /// Jumps waiting for the address after the loop
    breaks: Vec<usize>,
    /// Jumps waiting for the address of the next iteration
    continues: Vec<usize>,
}

/// Flatten sequential statements into a program
pub fn compile(statements: &[SeqStatement]) -> Vec<SeqInstr> {
    let mut program = Vec::new();
    let mut loops: Vec<LoopCtx> = Vec::new();
    emit_all(statements, &mut program, &mut loops);
    program
}

fn emit_all(statements: &[SeqStatement], out: &mut Vec<SeqInstr>, loops: &mut Vec<LoopCtx>) {
    for statement in statements {
        emit(statement, out, loops);
    }
}

fn emit(statement: &SeqStatement, out: &mut Vec<SeqInstr>, loops: &mut Vec<LoopCtx>) {
    match statement {
        SeqStatement::Assign { target, value } => out.push(SeqInstr::Assign {
            target: target.clone(),
            value: value.clone(),
        }),
        SeqStatement::SignalWrite { path, value } => out.push(SeqInstr::SignalWrite {
            path: path.to_string(),
            value: value.clone(),
        }),
        SeqStatement::MemWrite {
            mem_name,
            addr,
            value,
        } => out.push(SeqInstr::MemWrite {
            mem_name: mem_name.clone(),
            addr: addr.clone(),
            value: value.clone(),
        }),
        SeqStatement::Assert(assert) => out.push(SeqInstr::Assert(assert.clone())),
        SeqStatement::Cover(cover) => out.push(SeqInstr::Cover(cover.clone())),
        SeqStatement::SysCall(call) => out.push(SeqInstr::SysCall(call.clone())),
        SeqStatement::Delay(duration) => out.push(SeqInstr::Delay(duration.to_picoseconds())),
        SeqStatement::Await(await_expr) => emit_await(await_expr, out),
        SeqStatement::If {
            condition,
            then_branch,
            else_branch,
        } => {
            // JumpIfFalse -> else; then; Jump -> end; else; end
            let branch = out.len();
            out.push(SeqInstr::Jump(0)); // patched below
            emit_all(then_branch, out, loops);

            match else_branch {
                Some(else_branch) => {
                    let skip = out.len();
                    out.push(SeqInstr::Jump(0)); // patched below
                    let else_start = out.len();
                    emit_all(else_branch, out, loops);
                    let end = out.len();
                    out[branch] = SeqInstr::JumpIfFalse {
                        condition: condition.clone(),
                        target: else_start,
                    };
                    out[skip] = SeqInstr::Jump(end);
                }
                None => {
                    let end = out.len();
                    out[branch] = SeqInstr::JumpIfFalse {
                        condition: condition.clone(),
                        target: end,
                    };
                }
            }
        }
        SeqStatement::While { condition, body } => {
            let top = out.len();
            let exit = out.len();
            out.push(SeqInstr::Jump(0)); // patched below
            loops.push(LoopCtx::default());
            emit_all(body, out, loops);
            let ctx = loops.pop().unwrap_or_default();
            out.push(SeqInstr::Jump(top));
            let end = out.len();
            out[exit] = SeqInstr::JumpIfFalse {
                condition: condition.clone(),
                target: end,
            };
            patch(out, &ctx.breaks, end);
            patch(out, &ctx.continues, top);
        }
        SeqStatement::For { var, range, body } => {
            // var = start; while var < end { body; var = var + 1 }
            out.push(SeqInstr::Assign {
                target: var.clone(),
                value: range.start.clone(),
            });
            let top = out.len();
            let exit = out.len();
            out.push(SeqInstr::Jump(0)); // patched below
            loops.push(LoopCtx::default());
            emit_all(body, out, loops);
            let ctx = loops.pop().unwrap_or_default();
            // `continue` still has to advance the loop variable
            let step = out.len();
            out.push(SeqInstr::Assign {
                target: var.clone(),
                value: Expression::BinOp {
                    op: BinOp::Add,
                    lhs: Box::new(Expression::Ident(var.clone())),
                    rhs: Box::new(Expression::Literal(Literal::Decimal {
                        width: None,
                        value: 1,
                    })),
                },
            });
            out.push(SeqInstr::Jump(top));
            let end = out.len();
            out[exit] = SeqInstr::JumpIfFalse {
                condition: Expression::BinOp {
                    op: if range.inclusive { BinOp::Le } else { BinOp::Lt },
                    lhs: Box::new(Expression::Ident(var.clone())),
                    rhs: Box::new(range.end.clone()),
                },
                target: end,
            };
            patch(out, &ctx.breaks, end);
            patch(out, &ctx.continues, step);
        }
        SeqStatement::Break => {
            if let Some(ctx) = loops.last_mut() {
                ctx.breaks.push(out.len());
            }
            out.push(SeqInstr::Jump(0)); // patched when the loop closes
        }
        SeqStatement::Continue => {
            if let Some(ctx) = loops.last_mut() {
                ctx.continues.push(out.len());
            }
            out.push(SeqInstr::Jump(0)); // patched when the loop closes
        }
    }
}

/// Point every recorded jump at an address now that it is known
fn patch(out: &mut [SeqInstr], sites: &[usize], target: usize) {
    for &site in sites {
        out[site] = SeqInstr::Jump(target);
    }
}

fn emit_await(await_expr: &crate::parser::AwaitExpr, out: &mut Vec<SeqInstr>) {
    use crate::parser::AwaitExpr;
    match await_expr {
        AwaitExpr::ClockEdge { .. } => out.push(SeqInstr::AwaitEdges(Expression::Literal(
            Literal::Decimal {
                width: None,
                value: 1,
            },
        ))),
        AwaitExpr::ClockCycles { count, .. } => {
            out.push(SeqInstr::AwaitEdges(count.clone()));
        }
        AwaitExpr::Until { condition, timeout } => out.push(SeqInstr::AwaitUntil {
            condition: condition.clone(),
            timeout: timeout.as_ref().map(|d| d.to_picoseconds()),
        }),
    }
}

/// How many instructions one resumption may run before giving up.
///
/// A `while` loop with no `await` inside it would otherwise never yield.
pub const STEP_BUDGET: usize = 100_000;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::Parser;

    fn program_of(body: &str) -> Vec<SeqInstr> {
        let source = format!(
            "test T {{
                let clk: clock(period: 10ns);
                let rst: reset;
                var i: bit[8] = 0;
                var n: bit[8] = 0;
                seq {{ {} }}
            }}",
            body
        );
        let parsed = Parser::new().parse_all(&source).expect("parse");
        let module = parsed.modules.into_iter().next().expect("module");
        compile(&module.seq_blocks[0].statements)
    }

    #[test]
    fn a_loop_jumps_back_to_its_test() {
        let program = program_of("for i in 0..4 { n = n + 1; }");
        // assign, test, body, increment, jump back
        assert!(matches!(program[0], SeqInstr::Assign { .. }));
        assert!(matches!(program[1], SeqInstr::JumpIfFalse { .. }));
        assert!(matches!(program.last(), Some(SeqInstr::Jump(1))));
    }

    #[test]
    fn a_branch_skips_the_other_arm() {
        let program = program_of("if n == 0 { n = 1; } else { n = 2; }");
        let SeqInstr::JumpIfFalse { target, .. } = program[0] else {
            panic!("expected a conditional jump, got {:?}", program[0]);
        };
        // The false branch starts after the `then` arm and its skip
        assert!(target > 1, "the false arm must be past the true arm");
        assert!(matches!(program[target], SeqInstr::Assign { .. }));
    }

    #[test]
    fn await_becomes_a_suspension_point() {
        let program = program_of("await clk.cycles(10); n = 1;");
        assert!(matches!(program[0], SeqInstr::AwaitEdges(_)));
        assert!(matches!(program[1], SeqInstr::Assign { .. }));
    }
}
