#!/usr/bin/env bash
# Formal equivalence checking for IRIS designs.
#
# The vector benches in example/comparison/equiv/ can find a difference between
# two circuits. They cannot establish there is none: the ALU alone has a 2^68
# input space and they cover 33,024 points of it. This flow proves the absence.
#
# Usage:
#   tools/formal/run.sh [-v] [design ...]
#
# With no design named, every design in designs.sh is attempted.
#
# Prerequisites:
#   yosys      (0.52 or later; needs miter, sat, equiv_* and async2sync)
#   node       (to run iris2sv)
#   iris2sv    built:  make -C tools iris2sv
#
# Three verdicts, and nothing else:
#
#   proven      the two models agree for all inputs, all reachable states
#   disproven   they differ, and a counterexample was produced
#   skipped     no attempt was made, and the reason is printed
#
# A missing error is never read as success. `sat` without -prove-asserts and
# `equiv_status` without -assert both exit 0 on an unfinished proof, so both
# flags are mandatory below.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=designs.sh
source "$ROOT/tools/formal/designs.sh"

VERBOSE=0
if [ "${1:-}" = "-v" ]; then
    VERBOSE=1
    shift
fi
WANTED=("$@")

IRIS2SV="tools/iris2sv/packages/cli/dist/cli.js"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PROVEN=0
DISPROVEN=0
SKIPPED=0
declare -a PROBLEMS=()

report() {  # <verdict> <subject> <detail>
    local verdict="$1" subject="$2" detail="${3:-}"
    case "$verdict" in
        proven)
            PROVEN=$((PROVEN + 1))
            printf '  proven     %-14s %s\n' "$subject" "$detail"
            ;;
        disproven)
            DISPROVEN=$((DISPROVEN + 1))
            printf '  DISPROVEN  %-14s %s\n' "$subject" "$detail"
            PROBLEMS+=("disproven: $subject $detail")
            ;;
        skipped)
            SKIPPED=$((SKIPPED + 1))
            printf '  skipped    %-14s %s\n' "$subject" "$detail"
            PROBLEMS+=("skipped: $subject $detail")
            ;;
    esac
}

have() { command -v "$1" >/dev/null 2>&1; }

for tool in yosys node; do
    if ! have "$tool"; then
        echo "$tool not found. See the prerequisites at the top of this file."
        exit 1
    fi
done
if [ ! -f "$IRIS2SV" ]; then
    echo "iris2sv is not built. Run: make -C tools iris2sv"
    exit 1
fi

wanted() {  # <design name>
    [ ${#WANTED[@]} -eq 0 ] && return 0
    local w
    for w in "${WANTED[@]}"; do [ "$w" = "$1" ] && return 0; done
    return 1
}

#==============================================================================
# The guard
#
# Yosys does not stop when it cannot resolve a name. It invents a wire, warns,
# and carries on, so a design with a cross-module hierarchical reference reads
# as a model whose submodule outputs are undriven. A proof against that model
# would be a proof about a different circuit, and it would look exactly like a
# proof about the right one.
#
# Nothing downstream runs until a design passes this.
#==============================================================================

read_log() {  # <top> <sv files...>
    local top="$1"; shift
    yosys -p "read_verilog -sv $*; hierarchy -check -top $top; proc; opt; memory_map; opt" 2>&1
}

guard() {  # <name> <top> <sv files...>  -> 0 readable, 1 not
    local name="$1" top="$2"; shift 2
    local log
    log="$(read_log "$top" "$@")"

    if grep -q '^ERROR' <<<"$log"; then
        report skipped "$name" "yosys: $(grep -m1 '^ERROR' <<<"$log")"
        return 1
    fi

    local implicit
    implicit="$(grep -c 'implicitly declared' <<<"$log")"
    if [ "$implicit" -gt 0 ]; then
        report skipped "$name" \
            "$implicit implicitly declared wire(s); the model would be wrong, not merely unproven"
        [ "$VERBOSE" = 1 ] && grep 'implicitly declared' <<<"$log" | head -5
        return 1
    fi

    return 0
}

#==============================================================================
# Building the two sides
#
# Each side is elaborated on its own, given a name, and stashed; the two are
# then copied into one design and compared.
#
# The obvious alternative -- write each side out with write_verilog and read
# both back -- is wrong, and quietly so. write_verilog cannot spell yosys's
# internal `$auto$...` names, so it renames them `_000_`, `_001_`, ... per file.
# Two unrelated wires then carry the same name, and equiv_make, which pairs
# wires by name, pairs them. On the RV32I core that produced two unproven cells
# on `_016_`, which is `~halt_reg` in one netlist and `~dec.is_system` in the
# other: a false pairing reported as an unproven equivalence.
#
# A false pairing cannot turn a difference into a proof, but it can quietly
# shrink what the proof covers, so the round trip is not used at all.
#==============================================================================

# `hierarchy` is deliberately absent between the copies and equiv_make. Without
# a -top it picks one of the two modules and removes the other as unused.
side_script() {  # <stash name> <module name to give it> <top> <sv files...>
    local stash="$1" as="$2" top="$3"; shift 3
    cat <<EOS
design -reset
read_verilog -sv $*
hierarchy -check -top $top
proc; opt; memory_map; opt
flatten; opt
rename $top $as
design -stash $stash
EOS
}

#==============================================================================
# The proof
#
# Combinational designs go through miter and SAT, which proves the function
# outright. Anything with a register goes through equiv_make and temporal
# induction, which carries the state correspondence and closes without a bound.
#
# async2sync runs on both sides. It replaces "clears while reset is high" with
# "clears at the next edge while reset is high", which changes what is being
# proven; both sides get the same treatment, and AI_PRJ_DESIGN.md 6.1 records
# what that costs.
#==============================================================================

has_registers() {  # <sv file>
    grep -q 'always_ff\|always @' "$1"
}

# A proof that does not finish is not a proof, and a driver that waits forever
# on one reports nothing at all. The budget turns "still running" into a stated
# verdict. Raise it with FORMAL_TIMEOUT=<seconds> when a design needs longer.
FORMAL_TIMEOUT="${FORMAL_TIMEOUT:-240}"

run_yosys() {  # <script text>  -> 0 proven, 1 disproven, 2 out of time
    printf '%s\n' "$1" >"$WORK/proof.ys"
    timeout "$FORMAL_TIMEOUT" yosys -q "$WORK/proof.ys" >"$WORK/proof.log" 2>&1
    local status=$?
    [ "$status" -eq 124 ] && return 2
    return "$status"
}

# <kind> <gold top> <gold files> <gate top> <gate files>
prove() {
    local kind="$1" gold_top="$2" gold_files="$3" gate_top="$4" gate_files="$5"
    local script
    # shellcheck disable=SC2086
    script="$(side_script G gold "$gold_top" $gold_files)
$(side_script I gate "$gate_top" $gate_files)
design -reset
design -copy-from G gold
design -copy-from I gate
"
    if [ "$kind" = comb ]; then
        script="$script
opt -full
miter -equiv -flatten -make_assert gold gate miter
hierarchy -top miter
flatten; opt -full
sat -verify -prove-asserts -show-ports miter"
    else
        script="$script
async2sync
opt -full
equiv_make gold gate equiv
prep -top equiv
equiv_simple
equiv_induct
equiv_status -assert"
    fi
    run_yosys "$script"
}

#==============================================================================
# 1. Can the generated SystemVerilog be read at all
#==============================================================================

echo "=============================================="
echo " 1. readable  -- does a faithful model exist"
echo "=============================================="

declare -A IMPL_SV=()
declare -A IMPL_KIND=()

for entry in "${DESIGNS[@]}"; do
    IFS='|' read -r name top srcs <<<"$entry"
    wanted "$name" || continue

    out="$WORK/$name"
    mkdir -p "$out"
    # shellcheck disable=SC2086
    if ! node "$IRIS2SV" $srcs -o "$out" >"$WORK/gen.log" 2>&1; then
        report skipped "$name" "iris2sv: $(head -1 "$WORK/gen.log")"
        continue
    fi

    svs=("$out"/*.sv)
    if [ ! -e "${svs[0]}" ]; then
        report skipped "$name" "iris2sv produced no SystemVerilog"
        continue
    fi

    if ! guard "$name" "$top" "${svs[@]}"; then
        continue
    fi

    IMPL_SV[$name]="${svs[*]}"
    if has_registers "$out/$(basename "${srcs##* }" .iris).sv" 2>/dev/null ||
       grep -lq 'always_ff' "${svs[@]}" >/dev/null 2>&1; then
        IMPL_KIND[$name]=seq
    else
        IMPL_KIND[$name]=comb
    fi
    printf '  readable   %-14s %s\n' "$name" "${IMPL_KIND[$name]}"
done

#==============================================================================
# 2. Does the prover reject a design that is wrong
#
# A flow that reports success is indistinguishable from a flow that reports
# success unconditionally. Every mutation below has to be caught. One that is
# proven equivalent is a defect in this script, not in the design.
#==============================================================================

echo
echo "=============================================="
echo " 2. mutations -- does the prover say no"
echo "=============================================="

for entry in "${MUTATIONS[@]}"; do
    IFS='|' read -r design desc expr <<<"$entry"
    wanted "$design" || continue
    [ -z "${IMPL_SV[$design]:-}" ] && continue

    read -r -a files <<<"${IMPL_SV[$design]}"
    top="$(for e in "${DESIGNS[@]}"; do IFS='|' read -r n t _ <<<"$e"; [ "$n" = "$design" ] && echo "$t"; done)"

    mut="$WORK/${design}_mut"
    rm -rf "$mut"; mkdir -p "$mut"
    changed=0
    for f in "${files[@]}"; do
        sed "$expr" "$f" >"$mut/$(basename "$f")"
        cmp -s "$f" "$mut/$(basename "$f")" || changed=1
    done
    if [ "$changed" = 0 ]; then
        report skipped "$design" "mutation did not apply: $desc"
        continue
    fi

    prove "${IMPL_KIND[$design]}" "$top" "${files[*]}" "$top" "$mut/*.sv"
    case $? in
        0) report disproven "$design" "mutation was PROVEN equivalent, which is a defect in this flow: $desc" ;;
        2) report skipped "$design" "mutation got no verdict within ${FORMAL_TIMEOUT}s: $desc" ;;
        *) printf '  rejected   %-14s %s\n' "$design" "$desc" ;;
    esac
done

#==============================================================================
# 3. Equivalence
#
# The second model is emitted from iris-sim, which shares no front end with
# iris2sv: one parses IRIS in TypeScript, the other in Rust through
# src/parser/iris.pest. Building the reference from iris2sv's own IR would make
# a lowering bug appear identically on both sides, and the miter would be
# satisfied by construction.
#==============================================================================

echo
echo "=============================================="
echo " 3. equivalence -- IRIS against its SystemVerilog"
echo "=============================================="

IRIS_FORMAL="sim/iris-sim/target/release/iris-formal"

for entry in "${DESIGNS[@]}"; do
    IFS='|' read -r name top srcs <<<"$entry"
    wanted "$name" || continue
    [ -z "${IMPL_SV[$name]:-}" ] && continue

    if [ ! -x "$IRIS_FORMAL" ]; then
        report skipped "$name" "iris-formal is not built: cargo build --release --manifest-path sim/iris-sim/Cargo.toml"
        continue
    fi

    case " $EXCLUDED " in
        *" $name "*)
            report skipped "$name" "excluded; see designs.sh for the reason"
            continue
            ;;
    esac

    gold="$WORK/${name}_gold"
    mkdir -p "$gold"
    # shellcheck disable=SC2086
    if ! "$IRIS_FORMAL" -i $srcs -o "$gold" >"$WORK/gold.log" 2>&1; then
        report skipped "$name" "iris-formal: $(head -1 "$WORK/gold.log")"
        continue
    fi

    if ! guard "$name(gold)" "$top" "$gold"/*.sv; then
        continue
    fi

    read -r -a files <<<"${IMPL_SV[$name]}"
    prove "${IMPL_KIND[$name]}" "$top" "$gold/*.sv" "$top" "${files[*]}"
    case $? in
        0) report proven "$name" "${IMPL_KIND[$name]}, unbounded" ;;
        2) report skipped "$name" "no verdict within ${FORMAL_TIMEOUT}s; raise FORMAL_TIMEOUT to attempt it" ;;
        *)
            report disproven "$name" "see the counterexample below"
            grep -iE 'Signal Name|Value|unproven' "$WORK/proof.log" | head -20
            ;;
    esac
done

#==============================================================================
# 4. The round trip
#
# IRIS -> iris2sv -> sv2iris -> iris2sv. The two SystemVerilog files should
# describe the same circuit; whether they are the same text is not the
# question, and comparing them as text answers a different one. The ALU's round
# trip differs only by a redundant `32'(32'(...))`, which a diff calls a change
# and a miter calls nothing at all.
#
# This is reading B of the instruction. It checks the two tools against each
# other; it cannot stand in for reading A, because both could agree and both be
# wrong.
#==============================================================================

echo
echo "=============================================="
echo " 4. round trip -- iris2sv against sv2iris"
echo "=============================================="

SV2IRIS="tools/sv2iris/dist/bin.js"

for entry in "${DESIGNS[@]}"; do
    IFS='|' read -r name top srcs <<<"$entry"
    wanted "$name" || continue
    [ -z "${IMPL_SV[$name]:-}" ] && continue

    if [ ! -f "$SV2IRIS" ]; then
        report skipped "$name(rt)" "sv2iris is not built: make -C tools sv2iris"
        continue
    fi

    read -r -a files <<<"${IMPL_SV[$name]}"
    rt="$WORK/${name}_rt"
    rm -rf "$rt"; mkdir -p "$rt/iris" "$rt/sv"

    ok=1
    for f in "${files[@]}"; do
        node "$SV2IRIS" "$f" -o "$rt/iris/$(basename "$f" .sv).iris" >"$WORK/rt.log" 2>&1 || ok=0
    done
    if [ "$ok" = 0 ]; then
        report skipped "$name(rt)" "sv2iris: $(head -1 "$WORK/rt.log")"
        continue
    fi

    if ! node "$IRIS2SV" "$rt"/iris/*.iris -o "$rt/sv" >"$WORK/rt.log" 2>&1; then
        report skipped "$name(rt)" "iris2sv on the round trip: $(grep -m1 error "$WORK/rt.log")"
        continue
    fi

    # sv2iris preserves the module name, so the top comes back under the name it
    # went out with. Taking the first module found in the directory instead
    # picked `Alu` out of the four files a core round trip produces, and the
    # miter then compared RiscvCore against Alu and called it a difference. A
    # design that names its own top is not a design to guess about.
    rt_top="$top"
    if ! grep -qE "^module[[:space:]]+$rt_top\b" "$rt"/sv/*.sv; then
        report skipped "$name(rt)" "the round trip produced no module named '$rt_top'"
        continue
    fi

    if ! guard "$name(rt)" "$rt_top" "$rt"/sv/*.sv; then
        continue
    fi

    prove "${IMPL_KIND[$name]}" "$top" "${files[*]}" "$rt_top" "$rt/sv/*.sv"
    case $? in
        0) report proven "$name(rt)" "round trip, ${IMPL_KIND[$name]}" ;;
        2) report skipped "$name(rt)" "no verdict within ${FORMAL_TIMEOUT}s" ;;
        *)
            report disproven "$name(rt)" "the round trip changed the circuit"
            grep -iE 'Signal Name|unproven' "$WORK/proof.log" | head -10
            ;;
    esac
done

#==============================================================================

echo
echo "=============================================="
printf ' proven %d   disproven %d   skipped %d\n' "$PROVEN" "$DISPROVEN" "$SKIPPED"
echo "=============================================="

if [ ${#PROBLEMS[@]} -gt 0 ]; then
    echo
    echo "Not proven:"
    for p in "${PROBLEMS[@]}"; do echo "  $p"; done
fi

# A skip is not a pass. It is a design this flow could not speak about, and it
# is reported as loudly as a failure so that a green line never stands in for
# an absent one.
[ "$DISPROVEN" -eq 0 ] && [ "$SKIPPED" -eq 0 ]
