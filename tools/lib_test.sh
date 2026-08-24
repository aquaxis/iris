#!/usr/bin/env bash
# 標準ライブラリ(lib/)の全テストベンチをiris-simで実行し、振る舞い(assert)を確かめる。
#
# conformance(tools/conformance/run.sh)は各部品の変換・往復・verilatorを守るが、
# 各部品の`_tb.iris`のassertは実行しない。この runner がその穴を埋める
# ＝部品の「振る舞い」の回帰を捕まえる。
#
# 各 <分類>/<name>_tb.iris について、その分類の全 .iris（_tb以外）を一緒に渡して
# iris-sim を回す（secded の enc/dec 同居や scrambler/descrambler の相互参照に対応）。
# iris-sim は assert 失敗で exit 1、成功で exit 0。
#
# 使い方: bash tools/lib_test.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM="$ROOT/sim/iris-sim/target/release/iris-sim"
LIB="$ROOT/lib"
CYCLES=200000

if [ ! -x "$SIM" ]; then
    echo "error: iris-sim not built at $SIM (cd sim/iris-sim && cargo build --release)" >&2
    exit 2
fi

pass=0
fail=0
failed_list=""

for tb in "$LIB"/*/*_tb.iris; do
    [ -e "$tb" ] || continue
    dir="$(dirname "$tb")"
    name="$(basename "$tb" _tb.iris)"
    # その分類の部品本体を全部渡す（相互参照・同居モジュールを解決するため）
    parts=()
    for f in "$dir"/*.iris; do
        case "$f" in
            *_tb.iris) ;;
            *) parts+=("$f") ;;
        esac
    done
    out="$("$SIM" -i "${parts[@]}" "$tb" -c "$CYCLES" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
        pass=$((pass + 1))
        printf '  pass  %s\n' "$name"
    else
        fail=$((fail + 1))
        failed_list="$failed_list $name"
        printf '  FAIL  %-20s %s\n' "$name" "$(printf '%s' "$out" | grep -m1 -iE 'assert|error' || echo 'nonzero exit')"
    fi
done

echo
echo "pass $pass   fail $fail"
if [ "$fail" -ne 0 ]; then
    echo "failed:$failed_list"
    exit 1
fi
