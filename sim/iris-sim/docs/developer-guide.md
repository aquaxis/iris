# IRIS-SIM 開発者ガイド

iris-simの内部構造と拡張方法について説明する。
本書のコードはすべて実際のソースから採ったものである。

## 目次

1. [アーキテクチャ概要](#1-アーキテクチャ概要)
2. [モジュール構成](#2-モジュール構成)
3. [パーサー（parser）](#3-パーサーparser)
4. [プロジェクトとエラボレーション（project）](#4-プロジェクトとエラボレーションproject)
5. [静的検査（check）](#5-静的検査check)
6. [シミュレーションエンジン（sim）](#6-シミュレーションエンジンsim)
7. [値と演算（iris-runtime）](#7-値と演算iris-runtime)
8. [波形出力](#8-波形出力)
9. [コード生成（compile）](#9-コード生成compile)
10. [拡張ガイド](#10-拡張ガイド)
11. [テスト](#11-テスト)
12. [コントリビューション](#12-コントリビューション)

---

## 1. アーキテクチャ概要

### 全体構成

iris-simは2つの実行方式を持つ。
インタプリタは構文木をたどって実行し、コンパイラは同じ設計をRustプログラムに変換する。

値の意味（演算、幅、符号）と波形の記録は`iris-runtime`にあり、両方がこれを呼ぶ。
このため同じ設計はどちらで実行しても同じ結果になる。

```
                                       ┌── check ──┐
IRISソース ─→ parser ─→ project ───────┤           ├──→ sim ────────────→ fst ─→ VCD
              (pest)   (エラボレー     │ (仕様14章 │  (インタプリタ)
                        ション)         └───────────┘        │
                          │                                  │
                          └─→ compile ─→ Rustソース ─→ cargo ─→ 実行ファイル ─→ VCD
                                                                 │
                                    iris-runtime ────────────────┘
                                    （値・演算・波形。両方が使う）
```

### データフロー

```
IRISソースファイル
       │
       ▼  Parser::parse_all
   ParseResult { modules, interfaces, enums }
       │
       ▼  Project::elaborate
   ジェネリックを解決した Project
       │      （AsyncFifo__DataWidth8_Depth16 のように特殊化される）
       ▼  check::check_project
   Vec<Diagnostic>      ← エラーがあればここで停止する
       │
       ├─→ HierarchicalSimulator::run_cycles ─→ SignalTrace ─→ VcdWriter
       │
       └─→ SimGenerator::generate ─→ Rustソース
```

エラボレーションを経ていないプロジェクトを検査してはならない。
ジェネリックモジュールの雛形は幅や境界にパラメータが残っており、
実行されないコードに対して誤検出する。

---

## 2. モジュール構成

### ディレクトリ構造

```
sim/
├── iris-sim/src/
│   ├── lib.rs              # ライブラリルート
│   ├── main.rs             # iris-sim CLI
│   ├── project.rs          # プロジェクト管理とエラボレーション
│   ├── check.rs            # 仕様第14章の静的検査
│   ├── parser/
│   │   ├── mod.rs
│   │   ├── ast.rs          # AST定義
│   │   ├── grammar.rs      # pestの構文木からASTを組み立てる
│   │   └── iris.pest       # PEG文法定義
│   ├── sim/
│   │   ├── mod.rs
│   │   ├── eval.rs         # 式評価と演算子の対応付け
│   │   ├── seq.rs          # seqブロックを再開可能な命令列にする
│   │   ├── hierarchy.rs    # 階層シミュレータ（唯一の実行エンジン）
│   │   └── trace.rs        # SignalTraceの再エクスポート
│   ├── fst/
│   │   ├── mod.rs
│   │   └── writer.rs       # VcdWriter
│   ├── compile/
│   │   ├── mod.rs
│   │   └── codegen.rs      # SimGenerator
│   ├── types/
│   │   ├── mod.rs
│   │   ├── signal.rs       # SignalValueの再エクスポート
│   │   └── time.rs         # SimTime、TimeUnit
│   └── bin/
│       └── iris-compile.rs # iris-compile CLI
└── iris-runtime/src/
    ├── lib.rs
    ├── value.rs            # SignalValue、BitValue
    ├── ops.rs              # 演算の意味
    ├── trace.rs            # SignalTraceとVCD出力
    ├── engine.rs           # Runtime（生成コードの実行時状態）
    ├── clock.rs            # Clock（互換のため）
    ├── reset.rs            # Reset（互換のため）
    ├── bitvec.rs           # BitVec（互換のため）
    └── tracer.rs           # WaveTracer（互換のため）
```

`iris-sim`は`iris-runtime`に依存する。
`types/signal.rs`と`sim/trace.rs`は再エクスポートだけを行う。

```rust
// src/types/signal.rs
pub use iris_runtime::value::{BitValue, SignalValue};
```

### 実行エンジンは1つ

かつては、インスタンスやメモリの有無で「フラットエンジン」と階層シミュレータを
選び分けていた。
フラットエンジンは分岐ごとに最初の代入しか返さず、メモリ、`let`、`match`、`assert`を
すべて無視するため、同じソースが判定条件次第で違う挙動になっていた。

現在はすべての設計を`HierarchicalSimulator`で実行する。
フラットエンジンは削除した。

---

## 3. パーサー（parser）

### 3.1 構成

文法は`iris.pest`にPEGで書き、`grammar.rs`がpestの構文木からASTを組み立てる。

```rust
use iris_sim::parser::Parser;

let parser = Parser::new();
let result = parser.parse_all(source)?;   // ParseResult { modules, interfaces }
let module = parser.parse(source)?;       // 最初のモジュールだけ
```

```rust
/// Parse result containing both modules and interfaces
#[derive(Debug, Default)]
pub struct ParseResult {
    pub modules: Vec<Module>,
    pub interfaces: Vec<Interface>,
    pub enums: Vec<EnumDecl>,
}
```

### 3.2 ASTの形

`ast.rs`の主要な型である。

```rust
pub struct Module {
    pub name: String,
    pub generics: Vec<GenericParam>,
    pub where_constraints: Vec<Constraint>,
    pub ports: Vec<Port>,
    pub signals: Vec<Signal>,
    pub logic_blocks: Vec<LogicBlock>,     // comb / sync
    pub instances: Vec<Instance>,
    pub span: Option<Span>,
    pub is_test: bool,
    pub seq_blocks: Vec<SeqBlock>,
    pub initial_blocks: Vec<InitialBlock>,
    pub fsm_blocks: Vec<FsmBlock>,
    pub memories: Vec<MemDecl>,
}
```

文には2種類ある。
`Statement`は`comb` / `sync`ブロックの中身、`SeqStatement`は`seq` / `initial`ブロックの
中身で、`await`や`#10ns`のように時間を進める文はこちらにしかない。

```rust
pub enum Statement {
    Assign { target: String, value: Expression },
    MemWrite { mem_name: String, addr: Expression, value: Expression },
    If { condition: Expression, then_branch: Vec<Statement>, else_branch: Option<Vec<Statement>> },
    Match { expr: Expression, arms: Vec<MatchArm> },
    For { var: String, range: RangeExpr, body: Vec<Statement> },
    While { condition: Expression, body: Vec<Statement> },
    LetLocal { name: String, ty: Option<Type>, value: Option<Expression> },
    Assert(AssertStmt),
    SysCall(Expression),
    SliceWrite { target: String, low: Expression, width: Expression, value: Expression },
}
```

式は次のとおりである。

```rust
pub enum Expression {
    Literal(Literal),
    Ident(String),
    BinOp { op: BinOp, lhs: Box<Expression>, rhs: Box<Expression> },
    UnaryOp { op: UnaryOp, expr: Box<Expression> },
    Index { base: Box<Expression>, index: Box<Expression> },
    Slice { base: Box<Expression>, high: Box<Expression>, low: Box<Expression> },
    PartSelect { base: Box<Expression>, index: Box<Expression>, width: Box<Expression>, upward: bool },
    SysFunc { name: String, args: Vec<SysFuncArg> },
    MethodCall { receiver: Box<Expression>, method: String, args: Vec<Expression> },
    If { condition: Box<Expression>, then_expr: Box<Expression>, else_expr: Box<Expression> },
    Concat(Vec<Expression>),
    MemRead { mem_name: String, addr: Box<Expression> },
    Match { scrutinee: Box<Expression>, arms: Vec<MatchExprArm> },
}
```

`Slice`の両端は定数式でなければならない。
実行時に変わる位置を選ぶには`PartSelect`（`v[i +: 8]`）を使う。
この区別は静的検査O2007が守る。

### 3.3 文法規則を足すときの落とし穴

このプロジェクトで見つかった不具合の多くは同じ形をしている。
**文法規則は解析されるが、それを受け取る処理がなく、何も言わずに捨てられる。**

過去に実際に起きた例である。

| 規則 | 症状 |
|---|---|
| `else_clause` | `else`節が捨てられ、リセット解除後の処理が存在しない状態になっていた |
| `reset_param` | `reset(active_low: true)`が解析されず、常に負論理でなくなっていた |
| 整数型 | 型パーサーに`uint`のアームがなく、`uint[16]`が1ビットになっていた |
| 配列サフィックス | `bit[8][4]`のサフィックスを読まず、幅が8ビットのままだった |
| FSMの`initial:` | 規則はあるが`parse_fsm_block`にアームがなく、無視されていた |

文法規則を足したら、`grammar.rs`がその規則を照合しているか、
そして照合した結果を実際に使っているかを必ず確認すること。
`iris.pest`の全規則と`grammar.rs`が照合している規則を突き合わせると、
この種の抜けを一度に洗い出せる。

---

## 4. プロジェクトとエラボレーション（project）

`Project`は全モジュールを保持し、ジェネリックを解決する。

```rust
pub struct Project {
    pub modules: HashMap<String, Module>,
    pub interfaces: HashMap<String, Interface>,
    pub enums: HashMap<String, EnumDecl>,
    pub top_module: Option<String>,
}
```

主なAPIである。

| 関数 | 役割 |
|---|---|
| `load_single(path)` / `load_files(paths)` | 読み込み、トップの自動検出、エラボレーションまで行う |
| `set_top(name)` | トップモジュールを指定する。指定後はエラボレーションをやり直す |
| `elaborate()` | ジェネリックを解決する |
| `validate_references()` | 参照されているモジュールが存在するか調べる |
| `check_circular_instantiation()` | インスタンスの循環を調べる |
| `const_value(...)` | 定数式を畳み込む |

### 前処理: 列挙型とインターフェース

エラボレーションの最初に、言語の2つの機能を平らにする。
どちらも「後段が知らなくて済む」形に落とすのが狙いである。

**列挙型**。`Colour::Red`はリテラルになり、`var c: Colour`は
`Type::Enum { name, width }`になる。
`Type::width()`が値を返すので、幅を扱う既存の処理はそのまま動く。
名前を残すのは、`match`の網羅性をバリアント数で判定するためである。

**インターフェース**。`initiator bus: Simple`というポートは、
メンバごとのポート（`bus.valid`、`bus.data`……）に展開される。
向きはポートの方向が指すビューから決まる。
`bus: link`という接続も、メンバごとの接続に展開される。
展開後はただの信号なので、シミュレータもコード生成もインターフェースを知らない。

### エラボレーションの動き

トップモジュールから辿り、各インスタンスの環境を子モジュールの既定値と
インスタンスのジェネリック引数から求め、環境ごとに特殊化したモジュールを生成して
インスタンスを付け替える。

```
mod Ram[Depth: uint = 8](...)     inst a = Ram[Depth: 16] { ... }
                                  inst b = Ram { ... }
        ↓
Ram__Depth16   （aが指す）
Ram__Depth8    （bが指す）
```

既定値はインスタンス引数を適用したあとに宣言順で埋める。
そのため`Depth`を上書きすると、それから導かれる
`AddrWidth: uint = $clog2(Depth)`も追従する。

パラメータは型だけでなく、信号の初期値、文中の式、メモリの深さにも代入される。
論理中で使ったパラメータ（`if count < Depth`）はリテラルになる。

---

## 5. 静的検査（check）

`check.rs`はエラボレーション済みのプロジェクトを検査し、仕様第14章の形式で報告する。

```rust
pub enum Severity { Error, Warning }

pub struct Diagnostic {
    /// Spec 14 code, such as "O1005"
    pub code: &'static str,
    pub severity: Severity,
    /// Module the finding belongs to
    pub module: String,
    pub message: String,
    pub span: Option<Span>,
    /// Extra context, rendered as `= note:` lines
    pub notes: Vec<String>,
    /// Suggested fix, rendered as a `= help:` line
    pub help: Option<String>,
}

pub fn check_project(project: &Project) -> Vec<Diagnostic>;
pub fn format_diagnostics(diagnostics: &[Diagnostic]) -> String;
pub fn has_errors(diagnostics: &[Diagnostic]) -> bool;
```

実装済みの検査である。

| コード | 内容 | 仕様 |
|---|---|---|
| O1005 | ジェネリックパラメータの制約違反（`where`句の3形式） | 3.3.3 |
| O2006 | `match`の網羅性（幅、または列挙型のバリアント） | 5.6.2 |
| O2007 | 定数でないスライス境界・ビットフィールド幅 | 9.6.3 |
| O7009 | 検証専用システム関数を合成可能な論理で使用 | 3.3.4 |

`$display`、`$finish`、`$isunknown`、`$onehot`が検証専用である。
`$clog2`と`$bits`は合成可能なので制限しない。
検証コンテキストは`test`モジュール、`seq`ブロック、`initial`ブロックである。

O2006とO7009は、仕様第14章が範囲を定めながら番号を与えていない箇所に割り当てた。

`iris-sim`と`iris-compile`はどちらもこの検査を実行し、エラーがあれば先へ進まない。

---

## 6. シミュレーションエンジン（sim）

### 6.1 HierarchicalSimulator

状態はすべて階層名をキーにした表に持つ。

```rust
pub struct HierarchicalSimulator {
    project: Project,
    top_module: String,
    /// All signal values (hierarchical names like "top.dut.count")
    signals: HashMap<String, SignalValue>,
    instances: HashMap<String, InstanceState>,
    time: SimTime,
    clock_period: SimTime,
    trace: SignalTrace,
    reset_signals: Vec<ResetInfo>,
    clock_signals: Vec<ClockInfo>,
    reset_active: bool,
    is_test_mode: bool,
    reset_duration: u64,
    /// FSM current states (fsm_name -> current_state_name)
    fsm_states: HashMap<String, String>,
    memories: HashMap<String, MemoryState>,
    finished: bool,
    // ...
}
```

公開APIである。

```rust
let mut sim = HierarchicalSimulator::new(project);
sim.assert_reset();
sim.run_cycles(5);
sim.deassert_reset();
sim.run_cycles(100);

sim.get_signal("dut.count");            // Option<&SignalValue>
sim.get_memory("dut.storage");          // Option<&MemoryState>
sim.get_trace();                        // &SignalTrace
sim.get_assertion_failures();           // &[AssertionFailure]
sim.get_metastability_warnings();       // &[MetastabilityWarning]
sim.get_time();                         // SimTime（ピコ秒）
```

### 6.2 seqブロックは中断できる

`seq`ブロックは上から下まで一息に実行できない。`await`が来たら止まり、
設計を進め、続きから再開する必要がある。
構文木を歩いたままでは中断点を覚えられないので、
`sim/seq.rs`がブロックを**ジャンプ付きの命令列**に平らにする。

```rust
pub enum SeqInstr {
    Assign { .. }, SignalWrite { .. }, MemWrite { .. },
    Assert(..), SysCall(..),
    Delay(SimTime),
    AwaitEdges(Expression),
    AwaitUntil { condition, timeout },
    JumpIfFalse { condition, target },
    Jump(usize),
}
```

`if`は条件ジャンプに、`for`と`while`は前置判定のループになり、
`break`と`continue`はループを閉じるときに backpatch されるジャンプになる。
中断は「次に実行する添字を覚えておく」だけで済む。

待ち状態は3つしかない。

```rust
pub enum SeqWait { Ready, Edges(u64), Time(SimTime), Done }
```

`await until(...)`はここに現れない。
条件が成立しなければ**自分の命令に戻ってから**1エッジ待つので、
次の再開時に同じ命令が条件を測り直す。
これにより待ち状態から式を持たずに済み、生成コードと同じ表現になる。

`iris-compile`はこの命令列をそのままRustの`match rt.seq_pc { ... }`にする。
つまり平坦化は両方で共有され、テストベンチの意味が2つに分かれない。

### 6.3 2つの実行ループ

`run_cycles`はクロックの数で経路を選ぶ。

```rust
if self.clock_signals.len() <= 1 {
    // 単一クロック: サイクル単位に進む
} else {
    // 複数クロック: 最も早いエッジ時刻へ時刻を進める
}
```

`clock_signals`はテストモジュールが`let clk: clock(period: ...)`と宣言したときに
埋まる。外から駆動する設計では空になり、単一クロックの経路を通る。

複数クロックの1エッジで行うことは次の順である。

1. `propagate_port_connections` — インスタンスの入力ポートを駆動する
2. `execute_sync_blocks_for_clock` — そのクロックで動く`sync`ブロックだけを実行
3. FSM — リセット中は初期状態に戻し、そうでなければそのクロックのFSMだけ進める
4. `execute_all_comb_blocks` — 組み合わせ論理を不動点まで回す

### 6.4 クロックはポートを通ってしか伝わらない

インスタンスの`sync`ブロックは、そのクロックポートに実際に接続されている
親側クロックのエッジでのみ実行する。

```rust
let driven_ports: Vec<String> = inst
    .port_connections
    .iter()
    .filter_map(|(port_name, expr)| match expr {
        // The clock named in the connection belongs to the parent's scope
        Expression::Ident(id)
            if self.make_signal_name(parent_prefix, id) == parent_clock_name =>
        {
            Some(port_name.clone())
        }
        _ => None,
    })
    .collect();
```

これを省くと、最初に見つかったクロックポートが常に発火し、
両ドメインが毎エッジ進んでしまう。

### 6.5 スコープの扱い

ポート接続式は**親モジュールの本体**に書かれているため、親のプレフィックスで評価する。
インスタンスを浅い順に処理するのは、親のポートが新しい値を持ってから
その下のインスタンスが読むようにするためである。

```rust
// Shallow instances first, so a parent's own ports carry their new value
// before the instances below it read them
let mut instances: Vec<String> = self.instances.keys().cloned().collect();
instances.sort_by_key(|path| (path.matches('.').count(), path.clone()));
```

信号名の解決は「インスタンスのプレフィックスを付けた名前」→「書かれたままの名前」の順で、
`HierarchicalEvaluator::resolve_signal`が行う。
後者があるため`dut.count`のような階層参照が書ける。

### 6.6 リセットの範囲

リセットは`sync`ブロック単位である。
そのブロックが駆動する信号だけを初期値に戻し、そのブロックが書き込むメモリだけを消す。
一方のドメインのリセットが、もう一方のドメインのレジスタを巻き込むことはない。

負論理かどうかは宣言（`reset(active_low: true)`）から判定する。
`_n`サフィックスは、素の`reset`と宣言した設計のための後方互換のフォールバックである。

### 6.7 幅の合わせ方

式評価は中間結果を広げる（整数リテラルは32ビットになる）ため、
格納する前に宣言幅へ収める。

```rust
fn coerce_to_signal_width(&self, name: &str, value: SignalValue) -> SignalValue {
    match self.signals.get(name) {
        // The declaration decides both the width and how the bits are read
        Some(existing) => {
            iris_runtime::ops::coerce(value, existing.width(), existing.is_signed())
        }
        None => value,
    }
}
```

これを省くと`bit[5]`のカウンタが31を超えて数え続ける。

---

## 7. 値と演算（iris-runtime）

### 7.1 SignalValue

4値論理（0、1、X、Z）のビット列に、符号として読むかどうかの印を添えたものである。

```rust
pub enum BitValue { Zero, One, X, Z }

pub struct SignalValue {
    /// Bits stored LSB first (index 0 = LSB)
    bits: Vec<BitValue>,
    /// Whether the bits are to be read as two's complement.
    /// This is an interpretation, not part of the value, so it is excluded
    /// from equality.
    signed: bool,
}
```

同じビット列は読み方が違っても同じ値であるため、等価比較では`signed`を見ない。

```rust
SignalValue::from_u64(value, width)
SignalValue::from_i64(value, width)
value.to_u64()        // Option<u64>。X/Zがあれば None
value.to_i64()        // 最上位ビットから符号拡張して読む
value.with_signed(b)  // 同じビットを別の読み方にする
value.sign_extend(w)  // 符号ビットを複製して広げる
```

### 7.2 ops — 言語の意味はここにしかない

インタプリタは構文木をたどりながら、生成コードはオペランドを解決した状態で、
**同じ関数**を呼ぶ。だから設計の意味が2つに分かれることがない。

```rust
pub fn binop(op: BinOp, lhs: &SignalValue, rhs: &SignalValue,
             lhs_unsized: bool, rhs_unsized: bool) -> SignalValue;
pub fn unop(op: UnaryOp, value: &SignalValue) -> SignalValue;
pub fn concat(parts: &[SignalValue]) -> SignalValue;
pub fn slice(base: &SignalValue, high: usize, low: usize) -> SignalValue;
pub fn bit(base: &SignalValue, index: usize) -> SignalValue;
pub fn part_select(base: &SignalValue, index: usize, width: usize, upward: bool) -> SignalValue;
pub fn merge_field(base: &SignalValue, low: usize, width: usize, field: u64) -> SignalValue;
pub fn coerce(value: SignalValue, width: usize, signed: bool) -> SignalValue;
pub fn truthy(value: &SignalValue) -> bool;
```

覚えておくべき規則が3つある。

**無幅リテラルは相手側の幅を取る。** `ptr + 1`は`ptr`の幅で折り返す。32ビットではない。

```rust
pub fn binop_width(op: BinOp, lhs: &SignalValue, rhs: &SignalValue,
                   lhs_unsized: bool, rhs_unsized: bool) -> usize {
    if op.is_relational() {
        return 1;
    }
    match (lhs_unsized, rhs_unsized) {
        (false, true) => lhs.width(),
        (true, false) => rhs.width(),
        _ => lhs.width().max(rhs.width()),
    }
}
```

**符号付きになるのは両辺が符号付きのときだけ。** ただしシフトは例外で、
シフト量は大きさであり、シフトされる側だけが決める。

**符号を見る演算は限られる。** 加算、減算、乗算、ビット演算はどちらの読み方でも
同じビットになるため、符号なしの経路のままでよい。
比較、除算、剰余、算術右シフト`>>>`だけが符号付きの経路を通る。

演算子を足すときは`ops::BinOp`に追加し、`sim/eval.rs`の`runtime_binop`で
パーサーの`BinOp`と対応づける。この2か所だけである。

---

## 8. 波形出力

`SignalTrace`は信号ごとの変化を、記録された順に持つ。
同じ値を続けて記録しても増えない。

```rust
pub fn record(&mut self, name: &str, time: SimTime, value: SignalValue);
pub fn get_changes(&self, name: &str) -> Option<&Vec<(SimTime, SignalValue)>>;
pub fn signal_names(&self) -> impl Iterator<Item = &String>;   // 最初に記録された順
pub fn write_vcd(&self, path: &Path, module_name: &str) -> std::io::Result<()>;
```

`signal_names`が**記録順**であることは重要である。
かつては`HashMap`の反復順で返していたため、VCDの`$var`の並びが実行ごとに変わり、
2つの実行方式の出力を比べられなかった。

`iris-sim`側の`fst::VcdWriter`は`WaveWriter`トレイトの実装で、
内部では同じ`iris_runtime::trace`の出力を使う。

---

## 9. コード生成（compile）

### 9.1 考え方

インタプリタが毎ステップ名前で解決していることを、生成の時点で決めてしまう。

| インタプリタが実行時に解決 | 生成時に決定 |
|---|---|
| 階層名をキーにした`HashMap` | 固定のスロット番号 |
| ある名前がメモリかレジスタか | 文を出力する時点で形が決まる |
| どのトップクロックが`sync`ブロックに届くか | クロックごとの関数 |
| 式がどのスコープで解決されるか | スロット番号を式に埋め込む |

演算は書き直さない。生成コードは`iris_runtime::ops`を呼ぶ。

### 9.2 API

```rust
use iris_sim::compile::SimGenerator;

let code = SimGenerator::new(project)?      // 走査してスロットを割り当てる
    .with_source("design.iris")             // assert失敗時に表示する名前
    .generate()?;                           // Rustソース

let manifest = SimGenerator::cargo_toml("counter", "../iris-runtime");
```

### 9.3 スロットの割り当て順

割り当て順はインタプリタの初期化順に一致させる。
これがVCDの信号の並びになるためである。

```
initialize_module(top, "")   ポート → 信号 → 型付きlet → インスタンス（深さ優先）
initialize_fsms(top, "")     FSMのローカル → {fsm}_state
initialize_memories(top, "") {mem}_rdata
```

最初に記録される値も合わせる必要がある。
生成した`build()`は初期値を直接格納し、そのあとで`record_initial()`を呼び、
変化にあたるもの（FSMのMoore出力、リセットの水準）はさらにそのあとで適用する。
この順を誤ると、リセット信号が波形の先頭に現れてしまう。

### 9.4 生成される関数

```rust
fn build() -> Runtime;              // スロット、メモリ、クロック、リセット、初期値
fn apply_reset(rt: &mut Runtime);   // 全レジスタを初期値へ
fn propagate_ports(rt: &mut Runtime);
fn comb_pass(rt: &mut Runtime) -> bool;
fn comb_settle(rt: &mut Runtime);   // 不動点まで最大10回
fn sync_N(rt: &mut Runtime);        // (スコープ, クロック)の組ごと
fn fsm_N(rt: &mut Runtime);         // FSMごと
fn run_cycles(rt: &mut Runtime, cycles: u64);
fn main();
```

複数クロックのときは`sync_clock_N` / `fsm_clock_N` / `rising_N`が加わり、
単一クロックのときは`sync_all` / `fsm_all` / `step`になる。
どちらを出すかは生成の時点で決まるため、不要な方は出力しない。

### 9.5 Runtime

```rust
pub struct Runtime {
    pub sig: Vec<SignalValue>,
    pub names: Vec<String>,
    pub mems: Vec<Memory>,
    pub clocks: Vec<ClockState>,
    pub resets: Vec<ResetState>,
    pub trace: SignalTrace,
    pub time: SimTime,
    pub finished: bool,
    pub reset_active: bool,
    pub initial_executed: bool,
    pub cycle_count: u64,
    pub failures: Vec<Failure>,
    // ...
}
```

`set`は、そのスロットに前に入っていた値の幅へ収める。
宣言のない名前（代入先にしか現れない名前）は最初に入れた値の幅を採用する。
これはインタプリタの`coerce_to_signal_width`と同じ挙動である。

### 9.6 生成できないもの

定数式（スライスの境界など）は生成の時点で畳み込む。
畳み込めない場合はそこでエラーになる。インタプリタは実行時に評価する。

---

## 10. 拡張ガイド

### 10.1 新しい演算子を足す

1. `iris.pest`の演算子一覧に追加する
2. `ast.rs`の`BinOp`に追加する
3. `grammar.rs`の`parse_bin_op`にアームを足す
   （ここを忘れるとパースエラーになる。`>>>`が実際にそうだった）
4. `iris_runtime::ops::BinOp`に追加し、`ops::binop`に意味を書く
5. `sim/eval.rs`の`runtime_binop`で対応づける
6. 符号で結果が変わるなら`ops`の`signed_binop`にも足す

生成コードは`ops::binop`を呼ぶだけなので、`codegen.rs`の変更は要らない。

### 10.2 新しい文を足す

1. `iris.pest`に規則を足す
2. `ast.rs`の`Statement`（または`SeqStatement`）にバリアントを足す
3. `grammar.rs`で規則を照合し、バリアントを組み立てる
4. `hierarchy.rs`の`execute_statement_collect`に処理を足す
5. `compile/codegen.rs`の`emit_statement`に出力を足す
6. 必要なら`check.rs`の走査に足す
7. 回帰テストを`tests/`に足す

4か5のどちらかを忘れると、**2つの実行方式が食い違う**。
`tests/compiled.rs`はこれを検出するために両方で実行して結果を比べている。

Rustのコンパイラも助けになる。`Statement`は`match`で網羅的に扱っているため、
バリアントを足せば処理の抜けている箇所がコンパイルエラーになる。

### 10.3 新しい静的検査を足す

`check.rs`の`check_module_statements`に走査を足し、`Diagnostic`を返す。
コードは仕様第14章の範囲から選ぶ。
検査はエラボレーション済みのモジュールにだけ適用される。

---

## 11. テスト

### 11.1 構成

```
sim/iris-sim/tests/
├── language_features.rs   # 言語機能（29件）
├── static_checks.rs       # 静的検査（17件）
├── fsm.rs                 # FSM（8件）
├── signed.rs              # 符号付き演算（7件）
├── compiled.rs            # 2つの実行方式の一致（8件）
└── async_fifo_example.rs  # Exampleの通し実行（4件）
```

`sim/iris-runtime`にも18件のユニットテストがある。

```bash
cd sim/iris-sim && cargo test
cd sim/iris-runtime && cargo test
```

### 11.2 設計の書き方

多くのテストはソースから直接プロジェクトを組み立てる。

```rust
fn run(source: &str, top: &str, cycles: u64) -> HierarchicalSimulator {
    let parser = Parser::new();
    let result = parser.parse_all(source).expect("source should parse");

    let mut project = Project::new();
    for module in result.modules {
        project.modules.insert(module.name.clone(), module);
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
```

### 11.3 2つの実行方式の一致

`tests/compiled.rs`は同じ設計を両方で実行し、
**波形全体、全信号の最終値、設計自身の出力、診断、終了コード**の
すべてが一致することを要求する。

新しい構文を足したら、ここに1件足すこと。
片方だけ実装した場合、これがなければ誰も気付かない。

### 11.4 何をテストするか

過去に見つかった不具合はほとんどが「黙って間違う」種類だった。
パースエラーは目に見えるが、静かに違う結果を出すものは見えない。
そのため、次のような点を確かめるテストを優先する。

- 宣言した幅がそのまま使われているか（`uint[16]`が1ビットになっていないか）
- 書いた分岐が実行されているか（`else`が捨てられていないか）
- インスタンスごとに状態が分かれているか（FSMの状態を共有していないか）
- 符号付きの比較が符号付きの答えを返すか

---

## 12. コントリビューション

### 12.1 コーディング規約

```bash
cargo fmt        # 整形
cargo clippy     # 静的解析
cargo test       # テスト
```

- 公開する型と関数にはドキュメンテーションコメントを書く
- コメントは「何をしているか」ではなく「なぜそうするか」を書く
- 警告のない状態を保つ

### 12.2 変更を入れる前に

- `cargo test`が全件通ること
- `example/async_fifo/sim/run.sh`と`run_compiled.sh`が両方PASSすること
- 言語の意味に触れる変更なら`tests/compiled.rs`に1件足すこと
- READMEやドキュメントに書いた例は、実際に実行して確かめること

言語の意味を変えた場合は、`example/async_fifo/sv/run.sh`（SystemVerilogへ変換して
Verilatorで実行する経路）も確認する。
`iris2sv`はIRISの意味に依存しており、たとえば算術をオペランドの幅で計算するという
規則が変われば、生成されるサイズキャストも変わる。

### 12.3 プルリクエスト

1. ブランチを切る（`feature/...`、`fix/...`）
2. 変更とテストを入れる
3. 上の3点を確認する
4. 何をどう変えたかと、なぜそうしたかを説明する

---

## 関連ドキュメント

- [README.md](../README.md) — インストールと使い方
- [tutorial.md](tutorial.md) — チュートリアル
- [reference.md](reference.md) — 言語リファレンス
- [examples.md](examples.md) — サンプル集
- IRIS言語仕様書 — `spec/iris_spec.md`
