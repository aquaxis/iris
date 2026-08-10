# 第19章 よくある質問（FAQ）

[<< 用語集](./18_glossary.md) | [目次](./iris_spec.md) | [チュートリアル >>](./20_tutorial.md)

---

## 19.1 言語設計について

### Q1: IRISはなぜRust風の構文を採用しているのですか？

**A:** Rustの構文を採用した理由は以下の通りです：

1. **型安全性**: Rustの型システムは暗黙の型変換を禁止し、明示的な変換を要求します。
これはハードウェア設計においてビット幅の不一致などのバグを防ぐのに有効です。

2. **モダンな構文**: `match`式、ジェネリクス、パターンマッチングなどの現代的な機能により、より表現力豊かなコードが書けます。

3. **ツールエコシステム**: Rust風の構文により、既存のエディタプラグインやフォーマッタとの親和性が高まります。

### Q2: なぜブロッキング代入とノンブロッキング代入を統一したのですか？

**A:** SystemVerilogでは`=`と`<=`の使い分けが多くのバグの原因となっています。IRISでは：

- すべての代入を`=`に統一
- **コンテキスト**によって合成結果を決定（`sync`ブロック内 → レジスタ更新）
- コンパイラが自動的に適切な合成を行う

これにより、設計者は意図に集中でき、代入演算子の選択ミスによるバグを排除できます。

### Q3: SystemVerilogの予約語が220語あるのに対し、IRISが58語に削減できた理由は？

**A:** 主な理由は以下の通りです：

1. **検証機能の分離**: アサーションやカバレッジは専用構文ではなく、一般的な構文とライブラリで実現
2. **型修飾子の削減**: `reg`/`wire`の区別を廃止し、コンテキストで判断
3. **重複の排除**: `always_ff`/`always_comb`を`sync`/`comb`に統一
4. **シンタックスシュガーの限定**: 複数の書き方を許容せず、一つの正しい書き方を推奨

---

## 19.2 信号宣言について

### Q4: `let`、`var`、`let mut`の違いは何ですか？

**A:**

| 宣言 | 使用可能コンテキスト | 用途 |
|------|---------------------|------|
| `let` | どこでも | 汎用信号宣言。コンテキストにより組み合わせ/順序回路を自動判定 |
| `var` | **sync/fsmのみ** | 順序回路専用。明示的にレジスタであることを示す |
| `let mut` | どこでも（sync/fsm推奨） | 可変信号。初期値がリセット値となる |

```rust
// 組み合わせ回路
let sum = a + b;  // 直接代入 → 組み合わせ回路

// 順序回路
var counter: bit[8] = 0;  // sync/fsmでのみ使用可能
sync(clk.posedge, rst.async) {
    counter = counter + 1;
}
```

### Q5: `var`を`comb`ブロックで使用するとどうなりますか？

**A:** コンパイルエラーになります。
`var`は順序回路専用であり、`sync`または`fsm`ブロック内でのみ使用可能です。

```rust
// エラー: varはsync/fsm外で使用不可
var counter: bit[8] = 0;
comb {
    counter = 0;  // コンパイルエラー O0002
}
```

組み合わせ論理には`let`を使用してください。

### Q6: 初期値を省略した場合、リセット時の値はどうなりますか？

**A:** 初期値を省略した場合、リセット値は**未定義**となります。
合成時にはドントケアとして扱われる可能性があります。
確定したリセット値が必要な場合は、必ず初期値を指定してください。

```rust
var reg1: bit[8];       // リセット値未定義
var reg2: bit[8] = 0;   // リセット時に0
```

---

## 19.3 組み合わせ論理について

### Q7: `comb`ブロックで`else`を省略するとどうなりますか？

**A:** コンパイルエラーになります。
IRISは組み合わせ論理での完全割り当てを要求し、ラッチの推論を防止します。

```rust
// エラー: 不完全な割り当て
comb {
    if sel {
        out = a;
    }
    // else がない → エラー O0001
}

// 正しい記述
comb {
    out = if sel { a } else { b };
}
```

### Q8: 同じ信号を複数の`comb`ブロックで駆動できますか？

**A:** できません。
IRISはマルチドライバを禁止しています。
一つの信号は一つのブロックからのみ駆動される必要があります。

```rust
// エラー: 複数ドライバ
comb { result = a + b; }
comb { result = a - b; }  // エラー O2003

// 正しい記述
comb {
    result = if op { a + b } else { a - b };
}
```

---

## 19.4 順序論理について

### Q9: 非同期リセットと同期リセットはどのように指定しますか？

**A:** `sync`ブロックのリセット指定で選択します：

```rust
// 非同期リセット
sync(clk.posedge, rst.async) {
    count = count + 1;
}

// 同期リセット
sync(clk.posedge, rst.sync) {
    count = count + 1;
}
```

### Q10: Active Lowリセットはどのように指定しますか？

**A:** ポート宣言時に`reset(active_low: true)`を指定します：
`reset(active_low)`は`reset(active_low: true)`の短縮形として使用可能です。

```rust
mod Example(
    in rst_n: reset(active_low: true),
) {
    sync(clk.posedge, rst_n.async) {
        // rst_n=0でリセット
    }
}
```

### Q11: 複数のクロックドメインを使う場合の注意点は？

**A:** 異なるクロックドメイン間で直接信号を渡すとCDC（クロックドメイン交差）の問題が発生します。
コンパイラは警告（O2005）を出力します。

```rust
// 警告: CDC検出
sync(clk_b.posedge) {
    data_b = data_a;  // data_aはclk_aドメイン
}

// 正しい記述: シンクロナイザを使用
sync(clk_b.posedge) {
    data_b = sync_ff(data_a, stages: 2);
}
```

---

## 19.5 FSMについて

### Q12: FSMの状態エンコーディングを指定できますか？

**A:** はい、アトリビュートで指定できます：

```rust
#[fsm_encoding(one_hot)]
fsm Controller(clk.posedge, rst.async) {
    state enum { Idle, Run, Done }
    // ...
}
```

利用可能なエンコーディング：
- `binary`: バイナリエンコーディング（デフォルト）
- `one_hot`: ワンホットエンコーディング
- `gray`: グレイコードエンコーディング

### Q13: Moore出力とMealy出力の違いは？

**A:**
- **Moore出力**: 状態のみに依存。状態宣言時に指定
- **Mealy出力**: 状態と入力に依存。遷移記述内で指定

```rust
fsm Controller(clk.posedge, rst.async) {
    state enum {
        Idle [busy = 0],    // Moore出力
        Run  [busy = 1],
    }

    transitions {
        Idle => {
            when start {
                done = 0;    // Mealy出力
                goto Run;
            }
        }
    }
}
```

---

## 19.6 インターフェースについて

### Q14: インターフェースのビュー（initiator/target）の使い分けは？

**A:**
- **initiator**: バスマスター側（リクエストを発行する側）
- **target**: バススレーブ側（リクエストを受け取る側）
- **monitor**: 観測専用（デバッグと検証のため）

```rust
mod Master(
    initiator axi: AxiLite,  // マスター側
) {}

mod Slave(
    target axi: AxiLite,     // スレーブ側
) {}
```

---

## 19.7 移行について

### Q15: 既存のVerilog/SystemVerilogモジュールをIRISから使えますか？

**A:** はい、`extern mod`で宣言することで使用できます：

```rust
extern mod legacy_uart(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    in  tx_data: bit[8],
    out tx: bit,
);

mod Top(
    in  sys_clk: clock,
    in  sys_rst: reset,
    in  data: bit[8],
    out tx_out: bit,
) {
    inst uart0 = legacy_uart {
        clk: sys_clk,
        rst_n: ~sys_rst,
        tx_data: data,
        tx: tx_out
    };
}
```

### Q16: IRISからSystemVerilogへの変換は可能ですか？

**A:** はい、IRISコンパイラはSystemVerilogを出力します。
これにより、既存のEDAツールチェーン（Vivado、Quartus、Synopsys DCなど）でそのまま使用できます。

---

## 19.8 ツールについて

### Q17: IRISのエラーメッセージの読み方は？

**A:** IRISのエラーメッセージは以下の構造です：

```
error[O1001]: type mismatch
  --> src/counter.iris:15:12
   |
15 |     count = count + 1;
   |             ^^^^^^^^^ expected `bit[8]`, found `bit[9]`
   |
   = help: use explicit truncation: `(count + 1).truncate[8]()`
   = note: IRIS does not allow implicit narrowing conversions
```

- **[O1001]**: エラーコード（ドキュメント検索用）
- **-->**: 問題の場所（ファイル:行:列）
- **help**: 修正方法の提案
- **note**: 追加の背景情報

### Q18: 警告を抑制するにはどうすればよいですか？

**A:** `#[allow(WXXX)]`アトリビュートを使用します：

```rust
// 特定の信号の警告を抑制
#[allow(W0001)]
let _unused_debug: bit[32];

// ファイル全体で抑制
#![allow(W0001)]
```

---

[<< 用語集](./18_glossary.md) | [目次](./iris_spec.md) | [チュートリアル >>](./20_tutorial.md)
