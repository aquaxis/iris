#!/bin/bash
# RV32I Processor SystemVerilog Simulation Runner
# RV32Iプロセッサ SystemVerilogシミュレーション実行スクリプト
#
# Usage / 使い方:
#   ./run.sh [--regenerate]
#
#   --regenerate  IRISソースから.svを変換し直す
#
# IRISからSystemVerilogへ変換したコアを、Verilatorで実行する。
# 期待する結果はIRIS版（../sim/run.sh）と同じである。
#   40命令すべてを検証し、不一致0
#
# 変換するのはコア4ファイルと命令ROM3ファイルである。
# テストベンチ（riscv_tb.sv）は手書きのままにしてある。
#
# iris2svは`test`モジュールを変換できるが、ここでは使わない。
# 変換したコアを、変換に使っていない経路で検証したいからである。
# トランスパイラの不具合がテストベンチ側にも同じ形で現れて
# 打ち消し合うことがない。
#
# 変換したテストベンチとの突き合わせは tools/conformance/run.sh が行う。
#
# Prerequisites / 前提条件:
#   - verilator がインストールされていること
#   - --regenerate を使う場合は node と pnpm も必要

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SRC="$SCRIPT_DIR/../src"
IRIS2SV="$PROJECT_ROOT/tools/iris2sv"
LOG="$SCRIPT_DIR/output.log"

SOURCES="regfile.sv alu.sv decoder.sv riscv_core.sv rom_alu.sv rom_mem.sv rom_sys.sv riscv_tb.sv"

echo "=== RV32I SystemVerilog Simulation ==="
echo ""

# ===== 変換（任意） =====
if [ "${1:-}" = "--regenerate" ]; then
    if [ ! -f "$IRIS2SV/packages/cli/dist/cli.js" ]; then
        echo "Building iris2sv..."
        (cd "$IRIS2SV" && \
         pnpm install --config.manage-package-manager-versions=false && \
         pnpm -r --config.manage-package-manager-versions=false build) || exit 1
    fi

    echo "Converting the core..."
    node "$IRIS2SV/packages/cli/dist/cli.js" \
        "$SRC/regfile.iris" "$SRC/alu.iris" "$SRC/decoder.iris" "$SRC/riscv_core.iris" \
        -o "$SCRIPT_DIR" || exit 1

    # 命令ROMはtestモジュールと同じファイルにあるので、切り出してから変換する
    echo "Converting the instruction ROMs..."
    TMP=$(mktemp -d)
    for t in alu mem sys; do
        python3 - "$SRC/test_$t.iris" "$TMP/rom_$t.iris" <<'PY' || exit 1
import sys
src = open(sys.argv[1]).read()
i = src.index("mod Rom")
depth, j, started = 0, i, False
while j < len(src):
    if src[j] == "{":
        depth += 1; started = True
    elif src[j] == "}":
        depth -= 1
        if started and depth == 0:
            j += 1; break
    j += 1
open(sys.argv[2], "w").write(src[i:j] + "\n")
PY
        node "$IRIS2SV/packages/cli/dist/cli.js" "$TMP/rom_$t.iris" -o "$SCRIPT_DIR" || exit 1
    done
    rm -rf "$TMP"
    echo ""
fi

if ! command -v verilator >/dev/null 2>&1; then
    echo "verilator not found. Install it and try again."
    exit 1
fi

: > "$LOG"
STATUS=0
TOTAL=0

for t in Alu Mem Sys; do
    echo "--- Test${t} ---"
    # shellcheck disable=SC2086
    if ! (cd "$SCRIPT_DIR" && verilator --binary --timing -Wno-fatal \
            -o "sim_$t" --Mdir "obj_$t" $SOURCES \
            --top-module "Test${t}Sv" > /dev/null 2>&1); then
        echo "  build failed"
        STATUS=1
        echo ""
        continue
    fi

    OUT=$("$SCRIPT_DIR/obj_$t/sim_$t" 2>&1)
    echo "$OUT" | tee -a "$LOG"

    if ! echo "$OUT" | grep -q "RESULT: PASS"; then
        STATUS=1
    fi
    N=$(echo "$OUT" | sed -n 's/.*instructions verified: *\([0-9]*\).*/\1/p' | head -1)
    TOTAL=$((TOTAL + ${N:-0}))
    echo ""
done

echo "=== Summary ==="
echo "  instructions verified: $TOTAL / 40"
if [ "$STATUS" -eq 0 ] && [ "$TOTAL" -eq 40 ]; then
    echo "  RESULT: PASS - the converted core behaves as the specification requires"
else
    echo "  RESULT: FAIL"
    STATUS=1
fi

exit $STATUS
