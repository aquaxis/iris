#!/usr/bin/env bash
# Conformance check across the IRIS toolchain.
#
# iris-sim is the reference. Every design in example/ is run through each tool
# and four invariants are enforced:
#
#   parse    every front-end accepts what iris-sim accepts
#   print    whatever a printer emits, iris-sim parses
#   behave   a design through a tool chain simulates to the same result
#   loud     unsupported input produces a diagnostic, never silence
#
# Usage: tools/conformance/run.sh [-v]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SIM="sim/iris-sim/target/release/iris-sim"
IRIS2SV="tools/iris2sv/packages/cli/dist/cli.js"
IRISFMT="tools/irisfmt/packages/format/dist/cli.js"
SV2IRIS="tools/sv2iris/dist/bin.js"
VERYL2IRIS="tools/veryl2iris/v2i/target/release/veryl2iris"
IRIS2VERYL="tools/veryl2iris/i2v/target/release/iris2veryl"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
declare -a FAILURES=()

report() {
    local status="$1" check="$2" subject="$3" detail="${4:-}"
    if [ "$status" = pass ]; then
        PASS=$((PASS + 1))
        [ "$VERBOSE" = 1 ] && printf '  ok    %-8s %s\n' "$check" "$subject"
    else
        FAIL=$((FAIL + 1))
        FAILURES+=("$check|$subject|$detail")
        printf '  FAIL  %-8s %-28s %s\n' "$check" "$subject" "$detail"
    fi
    return 0
}

# Designs whose modules resolve on their own. Testbenches and riscv_core need
# their dependencies supplied together, so they are simulated as groups below.
# The eleven designs in example/, plus fixtures covering constructs no design
# happens to use. Every one of these is accepted by iris-sim.
STANDALONE=()
while IFS= read -r f; do STANDALONE+=("$f"); done < <(
    { find example -name '*.iris'; find tools/conformance/fixtures -name '*.iris'; } | sort
)

# ------------------------------------------------------------------ grammar --
# The chapters of `spec/` each open with the part of the grammar they describe,
# and `spec/16_grammar.md` reproduces all of it. All of them are meant to say
# what `tools/iris.ebnf` says. When they drift, a reader learns a language the
# tools do not implement.
echo "== grammar: every chapter agrees with tools/iris.ebnf =="
if grammar_out=$(python3 tools/conformance/grammar_check.py 2>&1); then
    report pass grammar "spec/ vs tools/iris.ebnf"
else
    printf '%s\n' "$grammar_out" | grep '  FAIL' | head -20
    report fail grammar "spec/ vs tools/iris.ebnf" \
        "$(printf '%s' "$grammar_out" | grep -oE '[0-9]+ disagreement' | head -1)"
fi

# ---------------------------------------------------------------- reference --
# Which designs does iris-sim parse? Everything else is judged against this.
declare -A PARSES
SKIPPED=0
for f in "${STANDALONE[@]}"; do
    if err=$("$SIM" -i "$f" -c 2 2>&1); then
        PARSES["$f"]=1
    elif printf '%s' "$err" | grep -qE "Module not found|Failed to get top module|Top module not specified"; then
        # Parsed cleanly. Elaboration needs its siblings, or the file has no
        # single obvious top; neither says anything about the syntax.
        PARSES["$f"]=1
    else
        PARSES["$f"]=0
        SKIPPED=$((SKIPPED + 1))
        # A file the reference cannot read is not a judgement on the other
        # tools, but it also tests nothing. Saying so keeps a fixture from
        # sitting in the corpus doing no work.
        printf '  skip  %-8s %-28s %s\n' reference "$(basename "$f")" \
            "$(printf '%s' "$err" | grep -m1 -oE 'Syntax error.*|error\[.*' || echo 'iris-sim rejects it')"
    fi
done
[ "$SKIPPED" -eq 0 ] || echo "  ($SKIPPED file(s) skipped: the reference does not accept them)"

echo "== parse: every front-end accepts what iris-sim accepts =="
for f in "${STANDALONE[@]}"; do
    [ "${PARSES[$f]}" = 1 ] || continue
    b=$(basename "$f")

    if out=$(node "$IRISFMT" "$f" 2>&1 >/dev/null); then
        report pass parse "irisfmt $b"
    else
        report fail parse "irisfmt $b" "$(printf '%s' "$out" | head -1)"
    fi

    # Parsing and conversion are separate questions. A construct iris2sv can
    # parse but not yet convert reports one clear diagnostic; a construct it
    # cannot parse produces a cascade. Only the second is a parse failure.
    out=$(node "$IRIS2SV" "$f" -o "$WORK/sv" 2>&1)
    if printf '%s' "$out" | grep -q "message:"; then
        report fail parse "iris2sv $b" "$(printf '%s' "$out" | grep -m1 -oE 'message: .*')"
    else
        report pass parse "iris2sv $b"
    fi
done

echo "== convert: what iris2sv turns into SystemVerilog =="
UNCONVERTED=0
for f in "${STANDALONE[@]}"; do
    [ "${PARSES[$f]}" = 1 ] || continue
    b=$(basename "$f")
    out=$(node "$IRIS2SV" "$f" -o "$WORK/sv" 2>&1)
    if printf '%s' "$out" | grep -q "Compilation succeeded"; then
        report pass convert "$b"
    elif printf '%s' "$out" | grep -qE "is not supported and was not converted"; then
        # Reported, not dropped. Counted and named rather than passed over.
        UNCONVERTED=$((UNCONVERTED + 1))
        printf '  note  %-8s %-28s %s\n' convert "$b" \
            "$(printf '%s' "$out" | grep -m1 -oE "'[A-Za-z]+' is not supported")"
    else
        report fail convert "$b" "$(printf '%s' "$out" | grep -m1 -oE 'error: .*' || echo failed)"
    fi
done
[ "$UNCONVERTED" -eq 0 ] || echo "  ($UNCONVERTED design(s) parse but do not convert; each says so)"

echo "== print: printer output parses under iris-sim =="
for f in "${STANDALONE[@]}"; do
    [ "${PARSES[$f]}" = 1 ] || continue
    b=$(basename "$f")

    if node "$IRISFMT" "$f" > "$WORK/$b" 2>/dev/null; then
        err=$("$SIM" -i "$WORK/$b" -c 2 2>&1)
        if printf '%s' "$err" | grep -qE "Parse error|Syntax error|^error\[|could not evaluate"; then
            report fail print "irisfmt $b" "$(printf '%s' "$err" | grep -m1 -oE 'Syntax error.*|error\[.*')"
        else
            report pass print "irisfmt $b"
        fi
    fi
done

echo "== print: iris2sv output is accepted by sv2iris =="
UNCHAINED=0
for f in "${STANDALONE[@]}"; do
    [ "${PARSES[$f]}" = 1 ] || continue
    b=$(basename "$f" .iris)
    rm -rf "$WORK/sv"; mkdir -p "$WORK/sv"
    node "$IRIS2SV" "$f" -o "$WORK/sv" >/dev/null 2>&1 || continue
    [ -f "$WORK/sv/$b.sv" ] || continue

    if out=$(node "$SV2IRIS" "$WORK/sv/$b.sv" -o "$WORK/sv/$b.rt.iris" 2>&1); then
        report pass chain "$b.sv"
        # sv2iris accepting the file is only half of it: what it writes back has
        # to be IRIS. Checking only the first half let it emit instances as
        # `inst u0: sub(.a(a));`, which no front-end reads.
        err=$("$SIM" -i "$WORK/sv/$b.rt.iris" -c 2 2>&1)
        if printf '%s' "$err" | grep -qE "Parse error|Syntax error|^error\[|could not evaluate"; then
            report fail print "sv2iris $b.iris" "$(printf '%s' "$err" | grep -m1 -oE 'Syntax error.*')"
        else
            report pass print "sv2iris $b.iris"
        fi
    elif printf '%s' "$out" | grep -q "was not converted"; then
        # Parsed, and said plainly what it could not carry back. A testbench's
        # clock generator and stimulus have no IRIS counterpart: IRIS drives
        # both from the declarations. Counted, not passed over.
        UNCHAINED=$((UNCHAINED + 1))
        printf '  note  %-8s %-28s %s\n' chain "$b.sv" \
            "$(printf '%s' "$out" | grep -m1 -oE '[a-z ]*was not converted[a-z; ]*')"
    else
        report fail chain "$b.sv" "$(printf '%s' "$out" | grep -m1 -oE 'error: .*' || echo failed)"
    fi
done
[ "$UNCHAINED" -eq 0 ] || echo "  ($UNCHAINED file(s) parse but do not convert back; each says so)"

# sv2iris is also used on SystemVerilog that iris2sv did not write, so it gets
# its own inputs covering constructs the round trip never produces.
echo "== print: sv2iris output parses, on SystemVerilog of its own =="
SV_FIXTURES="tools/conformance/fixtures/sv"
if [ -d "$SV_FIXTURES" ]; then
    for sv in "$SV_FIXTURES"/*.sv; do
        [ -e "$sv" ] || continue
        b=$(basename "$sv" .sv)
        if out=$(node "$SV2IRIS" "$sv" -o "$WORK/$b.iris" 2>&1); then
            err=$("$SIM" -i "$WORK/$b.iris" -c 2 2>&1)
            if printf '%s' "$err" | grep -qE "Parse error|Syntax error|^error\[|could not evaluate"; then
                report fail print "sv2iris $b" "$(printf '%s' "$err" | grep -m1 -oE 'Syntax error.*|error\[.*')"
            else
                report pass print "sv2iris $b"
            fi
        else
            report fail print "sv2iris $b" "$(printf '%s' "$out" | grep -m1 -oE 'error: .*' || echo failed)"
        fi
    done
fi

# ------------------------------------------------------------------ behave --
# Simulation must survive formatting. Groups list every file a run needs.
echo "== behave: formatting preserves simulation results =="
R=example/riscv/src
A=example/async_fifo/src
SIM_GROUPS=(
  "counter|example/counter/src/counter.iris"
  "async_fifo|$A/async_fifo.iris $A/async_fifo_tb.iris"
  "test_alu|$R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris $R/test_alu.iris"
  "test_addi|$R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris $R/test_addi.iris"
  "test_mem|$R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris $R/test_mem.iris"
  "test_sys|$R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris $R/test_sys.iris"
)
for entry in "${SIM_GROUPS[@]}"; do
    name="${entry%%|*}"; files="${entry#*|}"
    before=$("$SIM" -i $files -c 400 2>&1)

    fmtd=""
    ok=1
    for f in $files; do
        out="$WORK/fmt_$(basename "$f")"
        node "$IRISFMT" "$f" > "$out" 2>/dev/null || ok=0
        fmtd="$fmtd $out"
    done
    [ "$ok" = 1 ] || { report fail behave "$name" "formatter failed"; continue; }

    after=$("$SIM" -i $fmtd -c 400 2>&1)
    if [ "$before" = "$after" ]; then
        report pass behave "$name"
    else
        report fail behave "$name" "$(printf '%s' "$after" | grep -m1 -oE 'Syntax error.*|Error.*' || echo 'output differs')"
    fi
done

# ------------------------------------------------------- behave, round trip --
# The strongest check here: take a design through iris2sv and back through
# sv2iris, then run it against its own unmodified testbench. Everything above
# only asks whether the result parses and evaluates. This asks whether it still
# computes the same thing.
#
# It found four defects the parse-level checks could not: a memory collapsed to
# a single register, a signed type silently unsigned, a sign-extending cast
# turned into a truncation, and a reversed bit slice.
echo "== behave: a design still works after iris2sv then sv2iris =="
RT="$WORK/roundtrip"
mkdir -p "$RT/sv" "$RT/back"
RT_OK=1
for f in $R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris; do
    b=$(basename "$f" .iris)
    node "$IRIS2SV" "$f" -o "$RT/sv" >/dev/null 2>&1 || { RT_OK=0; break; }
    node "$SV2IRIS" "$RT/sv/$b.sv" -o "$RT/back/$b.iris" >/dev/null 2>&1 || { RT_OK=0; break; }
done

if [ "$RT_OK" = 1 ]; then
    for t in test_addi test_alu test_mem test_sys; do
        before=$("$SIM" -i $R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris "$R/$t.iris" -c 600 2>&1)
        after=$("$SIM" -i "$RT/back/alu.iris" "$RT/back/decoder.iris" "$RT/back/regfile.iris" "$RT/back/riscv_core.iris" "$R/$t.iris" -c 600 2>&1)
        if [ "$before" = "$after" ]; then
            report pass roundtrip "rv32i $t"
        else
            report fail roundtrip "rv32i $t" \
                "$(printf '%s' "$after" | grep -m1 -oE 'mismatches: +[0-9]+|assertion failure.*|Syntax error.*|error\[.*' || echo 'output differs')"
        fi
    done
else
    report fail roundtrip "rv32i" "the round trip did not complete"
fi

# The async FIFO exercises a clock-domain crossing, which the RV32I core does not.
if node "$IRIS2SV" "$A/async_fifo.iris" -o "$RT/sv" >/dev/null 2>&1 &&
   node "$SV2IRIS" "$RT/sv/async_fifo.sv" -o "$RT/back/async_fifo.iris" >/dev/null 2>&1; then
    before=$("$SIM" -i "$A/async_fifo.iris" "$A/async_fifo_tb.iris" -c 400 2>&1)
    after=$("$SIM" -i "$RT/back/async_fifo.iris" "$A/async_fifo_tb.iris" -c 400 2>&1)
    if [ "$before" = "$after" ]; then
        report pass roundtrip "async_fifo"
    else
        report fail roundtrip "async_fifo" \
            "$(printf '%s' "$after" | grep -m1 -oE 'Syntax error.*|error\[.*|verified.*' || echo 'output differs')"
    fi
else
    report fail roundtrip "async_fifo" "the round trip did not complete"
fi

# ----------------------------------------------------- behave, under Verilator --
# The end of the line: convert a design and its testbench to SystemVerilog, run
# the result under Verilator, and compare what it reports against iris-sim.
#
# Nothing else checks that the converted SystemVerilog computes the same thing
# as the IRIS it came from. Skipped when Verilator is not installed.
if command -v verilator >/dev/null 2>&1; then
    echo "== behave: the converted testbench agrees with iris-sim under Verilator =="
    for t in test_addi test_alu test_mem test_sys; do
        VDIR="$WORK/verilator_$t"
        mkdir -p "$VDIR"
        ok=1
        for f in alu decoder regfile riscv_core "$t"; do
            node "$IRIS2SV" "$R/$f.iris" -o "$VDIR" >/dev/null 2>&1 || { ok=0; break; }
        done
        [ "$ok" = 1 ] || { report fail verilator "$t" "conversion failed"; continue; }

        top=$(grep -oE '^module [A-Za-z0-9_]+;' "$VDIR/$t.sv" | head -1 | sed 's/module //; s/;//')
        if [ -z "$top" ]; then
            report fail verilator "$t" "no testbench module in the output"
            continue
        fi

        expected=$("$SIM" -i $R/alu.iris $R/decoder.iris $R/regfile.iris $R/riscv_core.iris "$R/$t.iris" -c 600 2>&1 |
            grep -oE 'mismatches: +[0-9]+' | head -1)
        actual=$(cd "$VDIR" && verilator --binary --top-module "$top" \
                    -Wno-fatal -Wno-PINMISSING -Wno-WIDTH -Mdir obj ./*.sv >/dev/null 2>&1 &&
                 timeout 120 "./obj/V$top" 2>&1 | grep -oE 'mismatches: +[0-9]+' | head -1)

        if [ -n "$expected" ] && [ "$expected" = "$actual" ]; then
            report pass verilator "$t"
        else
            report fail verilator "$t" "iris-sim said '$expected', Verilator said '${actual:-nothing}'"
        fi
    done
else
    echo "  skip  verilator   (not installed)"
fi

# -------------------------------------------------------------------- loud --
# Input a tool cannot handle must produce a diagnostic, not silence.
echo "== loud: unsupported input is reported, never dropped =="
cat > "$WORK/reset.sv" <<'EOF'
module reset_probe (
    input  logic clk,
    input  logic rst_n,
    input  logic en,
    output logic [7:0] count
);
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) count <= 8'd0;
        else if (en) count <= count + 8'd1;
    end
endmodule
EOF
printf 'this is not iris at all !!!\n' > "$WORK/broken.iris"
node "$IRISFMT" -w "$WORK/broken.iris" >/dev/null 2>&1
if [ -s "$WORK/broken.iris" ]; then
    report pass loud "irisfmt -w keeps an unparseable file"
else
    report fail loud "irisfmt -w keeps an unparseable file" "file truncated to zero bytes"
fi

out=$(node "$SV2IRIS" "$WORK/reset.sv" 2>&1)
if printf '%s' "$out" | grep -q "count = 0\|count = 8'd0\|count = 8d0"; then
    report pass loud "sv2iris reset branch"
elif printf '%s' "$out" | grep -qi "error\|warning\|unsupported"; then
    report pass loud "sv2iris reset branch" # reported rather than dropped
else
    report fail loud "sv2iris reset branch" "reset assignment dropped with no diagnostic"
fi

# ---------------------------------------------------------------------------
# Veryl interworking
#
# Only the subset both languages share converts. What lies outside it must be
# refused with a diagnostic, never dropped: `veryl translate` drops assignments
# from SystemVerilog silently, losing 26 of 27 in one design, and a converter
# that inherits the habit produces a design that builds, simulates and is
# wrong.
#
# These checks are skipped rather than failed when the converters are not
# built, so a checkout without them still reports the rest honestly.
# ---------------------------------------------------------------------------
if [ -x "$VERYL2IRIS" ] && [ -x "$IRIS2VERYL" ]; then
    echo "== veryl: the round trip preserves behaviour =="

    # Veryl -> IRIS -> Veryl -> IRIS, compared by simulation rather than text.
    # Formatting differs between the two passes; meaning must not.
    if "$VERYL2IRIS" example/comparison/veryl/counter.veryl > "$WORK/rt1.iris" 2>/dev/null \
       && "$IRIS2VERYL" "$WORK/rt1.iris" > "$WORK/rt2.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/rt2.veryl" > "$WORK/rt3.iris" 2>/dev/null; then
        cat > "$WORK/rt_tb.iris" <<'TBEOF'
test RoundTrip {
    let clk: clock(period: 10ns);
    let rst: reset;
    var enable: bit = 1;
    inst dut = Counter { clk: clk, rst: rst, enable: enable, };
    initial { #100; enable = 0; #100; enable = 1; #50; $display("count=%0d", dut.count); }
}
TBEOF
        a=$("$SIM" -i "$WORK/rt1.iris" "$WORK/rt_tb.iris" -o /dev/null -c 40 2>&1 | grep -oE 'count=[0-9]+')
        b=$("$SIM" -i "$WORK/rt3.iris" "$WORK/rt_tb.iris" -o /dev/null -c 40 2>&1 | grep -oE 'count=[0-9]+')
        if [ -n "$a" ] && [ "$a" = "$b" ]; then
            report pass veryl "counter round trip"
        else
            report fail veryl "counter round trip" "first pass $a, second pass $b"
        fi

        # The control. Without it a check that compared nothing would pass.
        sed 's/+ 1/+ 2/' "$WORK/rt3.iris" > "$WORK/rt_mutant.iris"
        m=$("$SIM" -i "$WORK/rt_mutant.iris" "$WORK/rt_tb.iris" -o /dev/null -c 40 2>&1 | grep -oE 'count=[0-9]+')
        if [ -n "$m" ] && [ "$m" != "$a" ]; then
            report pass veryl "round trip control rejects a mutation"
        else
            report fail veryl "round trip control rejects a mutation" "mutation gave $m, same as $a"
        fi
    else
        report fail veryl "counter round trip" "a conversion step failed"
    fi

    # The ALU exercises the shapes that differ between the languages: a case
    # expression and two conditionals. Its own comment notes that SLT against
    # SLTU and SRA against SRL still run when swapped, so the checks are
    # chosen where sign matters.
    if "$VERYL2IRIS" example/comparison/veryl/alu.veryl > "$WORK/alu1.iris" 2>/dev/null \
       && "$IRIS2VERYL" "$WORK/alu1.iris" > "$WORK/alu2.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/alu2.veryl" > "$WORK/alu3.iris" 2>/dev/null; then
        cat > "$WORK/alu_tb.iris" <<'ATBEOF'
test AluRoundTrip {
    let clk: clock(period: 10ns);
    var op: bit[4] = 0;
    var a: bit[32] = 0;
    var b: bit[32] = 0;
    var fails: bit[8] = 0;
    inst dut = Alu { op: op, a: a, b: b, };
    initial {
        op = 4'd3; a = 32'hFFFFFFFF; b = 32'd1; #10;
        if dut.y != 32'd1 { fails = fails + 1; }
        op = 4'd4; a = 32'hFFFFFFFF; b = 32'd1; #10;
        if dut.y != 32'd0 { fails = fails + 1; }
        op = 4'd7; a = 32'hFFFFFFF0; b = 32'd1; #10;
        if dut.y != 32'hFFFFFFF8 { fails = fails + 1; }
        op = 4'd6; a = 32'hFFFFFFF0; b = 32'd1; #10;
        if dut.y != 32'h7FFFFFF8 { fails = fails + 1; }
        $display("fails=%0d", fails);
    }
}
ATBEOF
        r=$("$SIM" -i "$WORK/alu3.iris" "$WORK/alu_tb.iris" -o /dev/null -c 60 2>&1 | grep -oE 'fails=[0-9]+')
        if [ "$r" = "fails=0" ]; then
            report pass veryl "alu round trip keeps the signed operations"
        else
            report fail veryl "alu round trip keeps the signed operations" "got $r"
        fi

        # The control: making SLT unsigned must be caught.
        sed "s/if (sa < sb)/if (a < b)/" "$WORK/alu3.iris" > "$WORK/alu_mutant.iris"
        if ! cmp -s "$WORK/alu3.iris" "$WORK/alu_mutant.iris"; then
            m=$("$SIM" -i "$WORK/alu_mutant.iris" "$WORK/alu_tb.iris" -o /dev/null -c 60 2>&1 | grep -oE 'fails=[0-9]+')
            if [ "$m" != "fails=0" ]; then
                report pass veryl "alu control rejects an unsigned SLT"
            else
                report fail veryl "alu control rejects an unsigned SLT" "mutation was not caught"
            fi
        else
            report fail veryl "alu control rejects an unsigned SLT" "the mutation did not apply"
        fi
    else
        report fail veryl "alu round trip keeps the signed operations" "a conversion step failed"
    fi

    # The register file exercises memory. Its write side guards x0 and its
    # read side forces x0 to zero, so a mutation on the write guard alone is
    # invisible: the value written is mutated instead.
    if "$IRIS2VERYL" example/riscv/src/regfile.iris > "$WORK/rf1.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/rf1.veryl" > "$WORK/rf2.iris" 2>/dev/null; then
        cat > "$WORK/rf_tb.iris" <<'RFEOF'
test RfRoundTrip {
    let clk: clock(period: 10ns);
    let rst_n: reset(active_low: true);
    var we: bit = 0;
    var waddr: bit[5] = 0;
    var wdata: bit[32] = 0;
    var raddr1: bit[5] = 0;
    var fails: bit[8] = 0;
    inst dut = RegFile { clk: clk, rst_n: rst_n, we: we, waddr: waddr, wdata: wdata,
                         raddr1: raddr1, raddr2: raddr1, dbg_addr: raddr1, };
    initial {
        #20;
        we = 1; waddr = 5'd3; wdata = 32'hDEADBEEF; #20; we = 0;
        raddr1 = 5'd3; #20;
        if dut.rdata1 != 32'hDEADBEEF { fails = fails + 1; }
        we = 1; waddr = 5'd0; wdata = 32'hFFFFFFFF; #20; we = 0;
        raddr1 = 5'd0; #20;
        if dut.rdata1 != 32'd0 { fails = fails + 1; }
        $display("fails=%0d", fails);
    }
}
RFEOF
        r=$("$SIM" -i "$WORK/rf2.iris" "$WORK/rf_tb.iris" -o /dev/null -c 40 2>&1 | grep -oE 'fails=[0-9]+')
        if [ "$r" = "fails=0" ]; then
            report pass veryl "regfile round trip carries the memory"
        else
            report fail veryl "regfile round trip carries the memory" "got $r"
        fi

        sed "s/regs \[waddr\] = wdata;/regs [waddr] = wdata + 1;/" "$WORK/rf2.iris" > "$WORK/rf_mutant.iris"
        if ! cmp -s "$WORK/rf2.iris" "$WORK/rf_mutant.iris"; then
            m=$("$SIM" -i "$WORK/rf_mutant.iris" "$WORK/rf_tb.iris" -o /dev/null -c 40 2>&1 | grep -oE 'fails=[0-9]+')
            if [ "$m" != "fails=0" ]; then
                report pass veryl "regfile control rejects a corrupted write"
            else
                report fail veryl "regfile control rejects a corrupted write" "mutation was not caught"
            fi
        else
            report fail veryl "regfile control rejects a corrupted write" "the mutation did not apply"
        fi
    else
        report fail veryl "regfile round trip carries the memory" "a conversion step failed"
    fi

    # The decoder exercises sign extension in all four immediate forms. The
    # round trip is compared against the original decoder rather than against
    # values written out by hand, so the check tests what it claims to test
    # and does not depend on the instruction encodings being retyped correctly.
    if "$IRIS2VERYL" example/riscv/src/decoder.iris > "$WORK/dec1.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/dec1.veryl" > "$WORK/dec2.iris" 2>/dev/null; then
        cat > "$WORK/dec_tb.iris" <<'DECEOF'
test DecRoundTrip {
    var instr: bit[32] = 0;
    inst dut = Decoder { instr: instr, };
    initial {
        instr = 32'hFFF00093; #10; $display("i_neg=%h", dut.imm);
        instr = 32'h00100093; #10; $display("i_pos=%h", dut.imm);
        instr = 32'hFE112E23; #10; $display("s_neg=%h", dut.imm);
        instr = 32'hFE000EE3; #10; $display("b_neg=%h", dut.imm);
        instr = 32'hFFDFF06F; #10; $display("j_neg=%h", dut.imm);
        instr = 32'h000102B7; #10; $display("u_pos=%h", dut.imm);
    }
}
DECEOF
        "$SIM" -i example/riscv/src/decoder.iris "$WORK/dec_tb.iris" -o /dev/null -c 20 2>&1 \
            | grep -E '^[a-z]_(neg|pos)=' > "$WORK/dec_before.txt"
        "$SIM" -i "$WORK/dec2.iris" "$WORK/dec_tb.iris" -o /dev/null -c 20 2>&1 \
            | grep -E '^[a-z]_(neg|pos)=' > "$WORK/dec_after.txt"

        # A sign extension has to have actually happened, or two runs that
        # both did nothing would agree with each other and pass.
        if ! grep -q 'i_neg=ffffffff' "$WORK/dec_before.txt"; then
            report fail veryl "decoder round trip keeps the sign extensions" \
                "the original decoder did not sign extend"
        elif cmp -s "$WORK/dec_before.txt" "$WORK/dec_after.txt"; then
            report pass veryl "decoder round trip keeps the sign extensions"
        else
            report fail veryl "decoder round trip keeps the sign extensions" \
                "$(diff "$WORK/dec_before.txt" "$WORK/dec_after.txt" | tr '\n' ' ')"
        fi

        # The control zero-extends instead of repeating the sign bit, which is
        # exactly what Veryl's `as i32` cast would have produced. It shows the
        # check would have caught that mapping.
        sed "s/{\([0-9]*\){instr \[31\]}}/{\1{1'b0}}/g" "$WORK/dec2.iris" > "$WORK/dec_mutant.iris"
        if ! cmp -s "$WORK/dec2.iris" "$WORK/dec_mutant.iris"; then
            "$SIM" -i "$WORK/dec_mutant.iris" "$WORK/dec_tb.iris" -o /dev/null -c 20 2>&1 \
                | grep -E '^[a-z]_(neg|pos)=' > "$WORK/dec_mutated.txt"
            if cmp -s "$WORK/dec_before.txt" "$WORK/dec_mutated.txt"; then
                report fail veryl "decoder control rejects a zero extension" "mutation was not caught"
            else
                report pass veryl "decoder control rejects a zero extension"
            fi
        else
            report fail veryl "decoder control rejects a zero extension" "the mutation did not apply"
        fi
    else
        report fail veryl "decoder round trip keeps the sign extensions" "a conversion step failed"
    fi

    # The async FIFO exercises generic parameters: widths and a memory depth
    # written over them, and two of the four derived from $clog2.
    if "$IRIS2VERYL" example/async_fifo/src/async_fifo.iris > "$WORK/af1.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/af1.veryl" > "$WORK/af2.iris" 2>/dev/null; then
        # The testbench prints its summary line whether or not the assertions
        # held, so the exit status is what says pass or fail here.
        if "$SIM" -i "$WORK/af2.iris" example/async_fifo/src/async_fifo_tb.iris \
                  -o /dev/null -c 200 >/dev/null 2>&1; then
            report pass veryl "async fifo round trip carries the parameters"
        else
            report fail veryl "async fifo round trip carries the parameters" "the round trip does not verify"
        fi

        # Narrowing DataWidth must break the design. If it does not, the
        # parameter did not survive the round trip and nothing was tested.
        sed 's/DataWidth: uint\[32\] = 8/DataWidth: uint[32] = 4/' "$WORK/af2.iris" > "$WORK/af_mutant.iris"
        if ! cmp -s "$WORK/af2.iris" "$WORK/af_mutant.iris"; then
            if "$SIM" -i "$WORK/af_mutant.iris" example/async_fifo/src/async_fifo_tb.iris \
                      -o /dev/null -c 200 >/dev/null 2>&1; then
                report fail veryl "async fifo control rejects a narrowed parameter" "mutation was not caught"
            else
                report pass veryl "async fifo control rejects a narrowed parameter"
            fi
        else
            report fail veryl "async fifo control rejects a narrowed parameter" "the mutation did not apply"
        fi
    else
        report fail veryl "async fifo round trip carries the parameters" "a conversion step failed"
    fi

    # A width written over a parameter once became a plain one-bit signal on
    # the way to IRIS. The result parsed and simulated, so only a value catches
    # it: eight bits give 201, one bit gives 1.
    cat > "$WORK/pw.veryl" <<'PWEOF'
module ParamWidth #(
    param Width: u32 = 8,
) (
    a: input logic<Width>,
    y: output logic<Width>,
) {
    always_comb {
        y = a + 1;
    }
}
PWEOF
    cat > "$WORK/pw_tb.iris" <<'PWTBEOF'
test ParamWidthTb {
    var a: bit[8] = 0;
    inst dut = ParamWidth { a: a, };
    initial { a = 8'd200; #10; $display("y=%0d", dut.y); }
}
PWTBEOF
    if "$VERYL2IRIS" "$WORK/pw.veryl" > "$WORK/pw.iris" 2>/dev/null; then
        r=$("$SIM" -i "$WORK/pw.iris" "$WORK/pw_tb.iris" -o /dev/null -c 5 2>&1 | grep -oE 'y=[0-9]+')
        if [ "$r" = "y=201" ]; then
            report pass veryl "a width written over a parameter is not dropped"
        else
            report fail veryl "a width written over a parameter is not dropped" "got $r, expected y=201"
        fi
    else
        report fail veryl "a width written over a parameter is not dropped" "the conversion failed"
    fi

    # The processor is the whole of it: four modules across four files, an
    # instance whose outputs are read straight out of it, and both widenings.
    # It is converted as one project, because what `dec.rd` is comes from a
    # different file than the one that reads it.
    RVSRC=example/riscv/src
    if "$IRIS2VERYL" "$RVSRC/decoder.iris" "$RVSRC/regfile.iris" "$RVSRC/alu.iris" \
                     "$RVSRC/riscv_core.iris" > "$WORK/rv1.veryl" 2>/dev/null \
       && "$VERYL2IRIS" "$WORK/rv1.veryl" > "$WORK/rv2.iris" 2>/dev/null; then
        rv_same=yes
        for t in addi alu mem sys; do
            "$SIM" -i "$RVSRC/regfile.iris" -i "$RVSRC/alu.iris" -i "$RVSRC/decoder.iris" \
                   -i "$RVSRC/riscv_core.iris" -i "$RVSRC/test_$t.iris" \
                   -o /dev/null -c 400 2>&1 | grep -v '^$' > "$WORK/rv_before_$t.txt"
            "$SIM" -i "$WORK/rv2.iris" -i "$RVSRC/test_$t.iris" \
                   -o /dev/null -c 400 2>&1 | grep -v '^$' > "$WORK/rv_after_$t.txt"
            cmp -s "$WORK/rv_before_$t.txt" "$WORK/rv_after_$t.txt" || rv_same=no
        done
        # The original has to have got the right answer, or two runs that both
        # went wrong would agree with each other.
        if ! grep -q 'mismatches:        0' "$WORK/rv_before_addi.txt"; then
            report fail veryl "processor round trip runs the same programs" "the original did not verify"
        elif [ "$rv_same" = yes ]; then
            report pass veryl "processor round trip runs the same programs"
        else
            report fail veryl "processor round trip runs the same programs" "a test program differs"
        fi

        # The control breaks the wiring that carries an instance's output.
        sed 's/rdata1: rf_rdata1/rdata1: rf_rdata2/' "$WORK/rv2.iris" > "$WORK/rv_mutant.iris"
        if ! cmp -s "$WORK/rv2.iris" "$WORK/rv_mutant.iris"; then
            "$SIM" -i "$WORK/rv_mutant.iris" -i "$RVSRC/test_addi.iris" \
                   -o /dev/null -c 400 2>&1 | grep -v '^$' > "$WORK/rv_mutated.txt"
            if cmp -s "$WORK/rv_before_addi.txt" "$WORK/rv_mutated.txt"; then
                report fail veryl "processor control rejects a crossed wire" "mutation was not caught"
            else
                report pass veryl "processor control rejects a crossed wire"
            fi
        else
            report fail veryl "processor control rejects a crossed wire" "the mutation did not apply"
        fi
    else
        report fail veryl "processor round trip runs the same programs" "a conversion step failed"
    fi

    # One round trip per row of the correspondence table that claims to cross
    # exactly. `tools/veryl2iris/mapping` holds the list and its own tests
    # refuse to let a row exist with neither a sample nor a stated reason.
    #
    # The comparison starts at the second pass, not the first. The first pass
    # normalises: `b < c` becomes `(b < c)` and stays there. A check that
    # failed on that would be checking formatting rather than meaning. What
    # must hold is that the round trip reaches a fixed point -- once it stops
    # moving, it never moves again.
    samples=0
    sample_fails=""
    for sample in tools/veryl2iris/samples/*.veryl; do
        [ -e "$sample" ] || continue
        samples=$((samples + 1))
        row=$(basename "$sample" .veryl)
        if "$VERYL2IRIS" "$sample"        > "$WORK/s.i1" 2>/dev/null \
        && "$IRIS2VERYL" "$WORK/s.i1"     > "$WORK/s.v1" 2>/dev/null \
        && "$VERYL2IRIS" "$WORK/s.v1"     > "$WORK/s.i2" 2>/dev/null \
        && "$IRIS2VERYL" "$WORK/s.i2"     > "$WORK/s.v2" 2>/dev/null \
        && "$VERYL2IRIS" "$WORK/s.v2"     > "$WORK/s.i3" 2>/dev/null; then
            cmp -s "$WORK/s.i2" "$WORK/s.i3" || sample_fails="$sample_fails $row(drifts)"
        else
            sample_fails="$sample_fails $row(refused)"
        fi
    done
    if [ "$samples" -eq 0 ]; then
        report fail veryl "every exact row of the table round trips" "no samples were found"
    elif [ -z "$sample_fails" ]; then
        report pass veryl "every exact row of the table round trips"
    else
        report fail veryl "every exact row of the table round trips" "$sample_fails"
    fi

    # The control. Without it the loop above would pass on an empty sample.
    cat > "$WORK/drift.veryl" <<'DRIFTEOF'
module Drift (
    a: input logic,
    y: output logic<8>,
) {
    always_comb {
        y = {a repeat 8};
    }
}
DRIFTEOF
    if "$VERYL2IRIS" "$WORK/drift.veryl" > "$WORK/d.i1" 2>/dev/null \
    && "$IRIS2VERYL" "$WORK/d.i1"        > "$WORK/d.v1" 2>/dev/null \
    && "$VERYL2IRIS" "$WORK/d.v1"        > "$WORK/d.i2" 2>/dev/null; then
        # A replication that gained a brace on every pass is what this catches:
        # the value never changed and the text grew without bound.
        if grep -q '{{8{a}}}' "$WORK/d.i2"; then
            report fail veryl "a replication does not gain a brace on every pass" "it grew: $(grep -o 'y = .*' "$WORK/d.i2")"
        else
            report pass veryl "a replication does not gain a brace on every pass"
        fi
    else
        report fail veryl "a replication does not gain a brace on every pass" "a conversion step failed"
    fi

    # A definition on a declaration used to be dropped on the way to Veryl:
    # `const K = 8'd3` lost its value, `let w = a` lost its assignment, and a
    # `var` with a starting value began at zero. Every one of those produced
    # Veryl that elaborated and computed something else, so only a value
    # catches it. 10 + 3 + 5 = 18; anything dropped gives less.
    cat > "$WORK/defs.veryl" <<'DEFSEOF'
module Defs (
    a: input logic<8>,
    y: output logic<8>,
) {
    const K: logic<8> = 8'd3;
    let w: logic<8> = a;
    var acc: logic<8>;
    initial {
        acc = 8'd5;
    }
    always_comb {
        y = w + K + acc;
    }
}
DEFSEOF
    cat > "$WORK/defs_tb.iris" <<'DEFSTBEOF'
test DefsTb {
    var a: bit[8] = 0;
    inst dut = Defs { a: a, };
    initial { a = 8'd10; #10; $display("y=%0d", dut.y); }
}
DEFSTBEOF
    if "$VERYL2IRIS" "$WORK/defs.veryl" > "$WORK/defs1.iris" 2>/dev/null \
    && "$IRIS2VERYL" "$WORK/defs1.iris" > "$WORK/defs.v" 2>/dev/null \
    && "$VERYL2IRIS" "$WORK/defs.v" > "$WORK/defs2.iris" 2>/dev/null; then
        r=$("$SIM" -i "$WORK/defs2.iris" -i "$WORK/defs_tb.iris" -o /dev/null -c 5 2>&1 | grep -oE 'y=[0-9]+')
        if [ "$r" = "y=18" ]; then
            report pass veryl "a definition on a declaration survives the round trip"
        else
            report fail veryl "a definition on a declaration survives the round trip" "got $r, expected y=18"
        fi
    else
        report fail veryl "a definition on a declaration survives the round trip" "a conversion step failed"
    fi

    # `type` is the second construct the grammar carries and the reference does
    # not implement. `tools/iris.ebnf` admits `type_alias` both at the top level
    # and inside a module, and `iris-sim` has no rule for it in either place.
    # That is why the correspondence table's `type` row has no round trip.
    cat > "$WORK/alias.iris" <<'ALIASEOF'
type Byte = bit[8];

mod AliasTest(
    in a: Byte,
    out y: Byte,
) {
    comb { y = a; }
}
ALIASEOF
    # Captured first, not piped: `set -o pipefail` makes a pipeline fail when
    # iris-sim exits non-zero, which it does precisely when it rejects the file.
    alias_out=$("$SIM" -i "$WORK/alias.iris" -c 2 2>&1)
    if printf '%s' "$alias_out" | grep -q "Syntax error"; then
        report pass veryl "the type alias row has no round trip, and the reason still holds"
    else
        report fail veryl "the type alias row has no round trip, and the reason still holds" \
            "iris-sim now accepts a type alias; the row can have a sample"
    fi

    # `as` is refused, and this records why rather than leaving it as a note in
    # someone's head. Both halves are checked together: the converter refuses
    # it, and iris-sim rejects the IRIS cast it would have to convert to.
    #
    # If iris-sim ever accepts `a as bit[32]`, the second half fails and points
    # at a refusal that can then be lifted.
    cat > "$WORK/iris_cast.iris" <<'CASTEOF'
mod AsTest(
    in a: bit[8],
    out y: bit[32],
) {
    comb { y = a as bit[32]; }
}
CASTEOF
    cat > "$WORK/cast_probe.veryl" <<'VCASTEOF'
module Cast (
    a: input logic<8>,
    y: output logic<32>,
) {
    always_comb { y = a as 32; }
}
VCASTEOF
    cast_out=$("$VERYL2IRIS" "$WORK/cast_probe.veryl" 2>&1 >/dev/null)
    iris_cast=$("$SIM" -i "$WORK/iris_cast.iris" -c 2 2>&1)
    if ! printf '%s' "$cast_out" | grep -q "a cast written with .as."; then
        report fail veryl "a Veryl cast is refused, and the reason still holds" \
            "veryl2iris no longer refuses it"
    elif printf '%s' "$iris_cast" | grep -q "Syntax error"; then
        # The specification and tools/iris.ebnf both describe IRIS' `as`; the
        # simulator does not implement it. That is why there is nothing to
        # convert to.
        report pass veryl "a Veryl cast is refused, and the reason still holds"
    else
        report fail veryl "a Veryl cast is refused, and the reason still holds" \
            "iris-sim now accepts IRIS' cast; the refusal can be lifted"
    fi

    echo "== veryl: what neither language shares is refused, not dropped =="

    # A type IRIS has no counterpart for.
    printf 'module M (y: output f32,) { always_comb { y = 0; } }\n' > "$WORK/float.veryl"
    out=$("$VERYL2IRIS" "$WORK/float.veryl" 2>&1 >/dev/null)
    if printf '%s' "$out" | grep -q "no counterpart in the target language"; then
        report pass veryl "f32 refused as a language limit"
    else
        report fail veryl "f32 refused as a language limit" "got: $(printf '%s' "$out" | head -1)"
    fi

    # A construct Veryl has no counterpart for.
    cat > "$WORK/fsm.iris" <<'FSMEOF'
mod M(in clk: clock, in rst: reset, in go: bit, out y: bit,) {
    fsm main(clk.posedge, rst.async) {
        state enum { Idle, Run }
        initial: Idle
        transitions { Idle => { when go { goto Run; } } Run => { when go { goto Idle; } } }
    }
    comb { y = 0; }
}
FSMEOF
    out=$("$IRIS2VERYL" "$WORK/fsm.iris" 2>&1 >/dev/null)
    if printf '%s' "$out" | grep -q "no counterpart in the target language"; then
        report pass veryl "fsm refused as a language limit"
    else
        report fail veryl "fsm refused as a language limit" "got: $(printf '%s' "$out" | head -1)"
    fi

    # A refused conversion writes nothing. Half a design looks whole.
    if [ ! -s "$WORK/nothing.iris" ] && ! "$VERYL2IRIS" "$WORK/float.veryl" > "$WORK/nothing.iris" 2>/dev/null; then
        if [ ! -s "$WORK/nothing.iris" ]; then
            report pass veryl "a refusal emits nothing"
        else
            report fail veryl "a refusal emits nothing" "output was written despite the refusal"
        fi
    else
        report fail veryl "a refusal emits nothing" "the conversion did not fail"
    fi
fi

echo
echo "pass $PASS   fail $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
