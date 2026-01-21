# IRIS-SIM 開発者ガイド

iris-simの内部構造と拡張方法について説明します。

## 目次

1. [アーキテクチャ概要](#1-アーキテクチャ概要)
2. [モジュール構成](#2-モジュール構成)
3. [パーサー（parser）](#3-パーサーparser)
4. [シミュレーションエンジン（sim）](#4-シミュレーションエンジンsim)
5. [波形出力（vcd）](#5-波形出力vcd)
6. [コンパイラ（compile）](#6-コンパイラcompile)
7. [型システム（types）](#7-型システムtypes)
8. [拡張ガイド](#8-拡張ガイド)
9. [テスト](#9-テスト)
10. [コントリビューション](#10-コントリビューション)

---

## 1. アーキテクチャ概要

### 全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                        iris-sim                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  parser  │───▶│   sim    │───▶│  writer  │              │
│  │          │    │          │    │          │              │
│  │ ・lexer  │    │ ・engine │    │ ・writer │              │
│  │ ・grammar│    │ ・eval   │    │ ・format │              │
│  │ ・ast    │    │ ・trace  │    │          │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│        │                                                     │
│        │         ┌──────────┐    ┌──────────┐              │
│        └────────▶│ compile  │───▶│ runtime  │              │
│                  │          │    │  (lib)   │              │
│                  │ ・codegen│    │          │              │
│                  └──────────┘    └──────────┘              │
│                                                              │
│  ┌──────────┐    ┌──────────┐                              │
│  │  types   │    │ project  │                              │
│  │          │    │          │                              │
│  │ ・signal │    │ ・config │                              │
│  │ ・time   │    │ ・multi  │                              │
│  └──────────┘    └──────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### データフロー

```
IRISソースファイル
       │
       ▼
   ┌───────┐
   │ Parser │  (pest パーサー)
   └───┬───┘
       │ AST (抽象構文木)
       ▼
   ┌────────────┐
   │ Elaborator │  (モジュール展開・インスタンス化)
   └─────┬──────┘
         │ Hierarchy
         ▼
   ┌────────────┐
   │ Simulator  │  (イベント駆動シミュレーション)
   └─────┬──────┘
         │ SignalTrace
         ▼
   ┌───────────┐
   │ VcdWriter │  (VCD波形出力)
   └───────────┘
```

---

## 2. モジュール構成

### ディレクトリ構造

```
iris-sim/src/
├── lib.rs              # ライブラリルート
├── main.rs             # CLIエントリポイント
├── project.rs          # プロジェクト管理
├── parser/             # パーサーモジュール
│   ├── mod.rs          # モジュールエクスポート
│   ├── ast.rs          # AST定義
│   ├── grammar.rs      # 文法パーサー
│   └── iris.pest       # PEG文法定義
├── sim/                # シミュレーションモジュール
│   ├── mod.rs          # モジュールエクスポート
│   ├── engine.rs       # シミュレーションエンジン
│   ├── eval.rs         # 式評価
│   ├── hierarchy.rs    # 階層シミュレータ
│   └── trace.rs        # シグナルトレース
├── fst/                # VCD波形出力モジュール
│   ├── mod.rs          # モジュールエクスポート
│   └── writer.rs       # VCD出力
├── compile/            # コンパイラモジュール
│   ├── mod.rs          # モジュールエクスポート
│   └── codegen.rs      # Rustコード生成
├── types/              # 型定義モジュール
│   ├── mod.rs          # モジュールエクスポート
│   ├── signal.rs       # 信号型
│   └── time.rs         # 時間型
└── bin/
    └── iris-compile.rs # コンパイラCLI
```

### モジュール依存関係

```
main.rs
  ├── parser
  ├── sim
  │     ├── parser::ast
  │     └── types
  ├── writer
  │     └── types
  ├── compile
  │     ├── parser::ast
  │     └── types
  └── project
        └── parser
```

---

## 3. パーサー（parser）

### 3.1 PEG文法（iris.pest）

IRISの文法はPEG（Parsing Expression Grammar）で定義されています。

```pest
// 主要な文法規則

// ソースファイル
file = { SOI ~ item* ~ EOI }

// アイテム
item = { module_def | test_def | interface_def }

// モジュール定義
module_def = {
    "mod" ~ identifier ~ "(" ~ port_list ~ ")" ~ "{" ~ module_body ~ "}"
}

// ポートリスト
port_list = { (port ~ ",")* ~ port? }
port = { port_dir ~ identifier ~ ":" ~ type_spec }
port_dir = { "in" | "out" | "inout" }

// 型
type_spec = {
    "bit" ~ ("[" ~ expr ~ "]")? |
    "clock" |
    "reset" |
    identifier
}

// 式
expr = { ... }  // 優先順位付き演算子
```

### 3.2 AST定義（ast.rs）

```rust
// 主要なAST構造体

/// モジュール定義
pub struct ModuleDef {
    pub name: String,
    pub ports: Vec<Port>,
    pub items: Vec<ModuleItem>,
    pub span: Span,
}

/// ポート定義
pub struct Port {
    pub direction: PortDirection,
    pub name: String,
    pub ty: TypeSpec,
    pub span: Span,
}

/// ポート方向
pub enum PortDirection {
    Input,
    Output,
    InOut,
}

/// 型指定
pub enum TypeSpec {
    Bit,
    BitVec(usize),
    Clock,
    Reset,
    Named(String),
}

/// モジュール内アイテム
pub enum ModuleItem {
    Let(LetDecl),      // 内部信号
    Var(VarDecl),      // レジスタ
    Inst(Instance),    // インスタンス
    Comb(CombBlock),   // 組み合わせロジック
    Sync(SyncBlock),   // 順序ロジック
    Fsm(FsmDef),       // FSM
    Mem(MemDecl),      // メモリ
}

/// 式
pub enum Expr {
    Literal(Literal),
    Ident(String),
    Binary(Box<Expr>, BinOp, Box<Expr>),
    Unary(UnaryOp, Box<Expr>),
    Index(Box<Expr>, Box<Expr>),
    Slice(Box<Expr>, Box<Expr>, Box<Expr>),
    Concat(Vec<Expr>),
    Field(Box<Expr>, String),
    Call(String, Vec<Expr>),
}
```

### 3.3 パーサーの使用方法

```rust
use iris_sim::parser::{Parser, ParseResult};

fn parse_file(source: &str) -> ParseResult<Vec<ModuleDef>> {
    let parser = Parser::new();
    parser.parse(source)
}
```

---

## 4. シミュレーションエンジン（sim）

### 4.1 シミュレータアーキテクチャ

```rust
/// イベント駆動シミュレーション

// シミュレータ構造
pub struct HierarchicalSimulator {
    /// モジュール階層
    hierarchy: ModuleHierarchy,
    /// シグナル値
    signals: SignalMap,
    /// イベントキュー
    event_queue: BinaryHeap<Event>,
    /// 現在時刻
    current_time: SimTime,
    /// トレース
    trace: SignalTrace,
}

// シミュレーションループ
impl HierarchicalSimulator {
    pub fn run(&mut self, cycles: u64) {
        for _ in 0..cycles {
            self.advance_cycle();
        }
    }

    fn advance_cycle(&mut self) {
        // 1. クロックエッジ処理
        self.process_clock_edges();

        // 2. 組み合わせロジック評価
        self.evaluate_combinational();

        // 3. イベント処理
        self.process_events();

        // 4. トレース記録
        self.record_trace();

        // 5. 時刻を進める
        self.current_time += self.clock_period;
    }
}
```

### 4.2 式評価（eval.rs）

```rust
/// 式評価器
pub struct Evaluator<'a> {
    signals: &'a SignalMap,
    memories: &'a MemoryMap,
}

impl<'a> Evaluator<'a> {
    /// 式を評価して値を返す
    pub fn eval(&self, expr: &Expr) -> Result<Value, EvalError> {
        match expr {
            Expr::Literal(lit) => self.eval_literal(lit),
            Expr::Ident(name) => self.eval_ident(name),
            Expr::Binary(lhs, op, rhs) => {
                let l = self.eval(lhs)?;
                let r = self.eval(rhs)?;
                self.eval_binary(l, *op, r)
            }
            Expr::Unary(op, e) => {
                let v = self.eval(e)?;
                self.eval_unary(*op, v)
            }
            // ...
        }
    }
}
```

### 4.3 階層処理（hierarchy.rs）

```rust
/// モジュール階層
pub struct ModuleHierarchy {
    /// ルートモジュール
    root: ModuleInstance,
    /// インスタンスマップ
    instances: HashMap<String, ModuleInstance>,
}

/// モジュールインスタンス
pub struct ModuleInstance {
    /// モジュール定義への参照
    def: Arc<ModuleDef>,
    /// インスタンス名
    name: String,
    /// 親へのパス
    parent_path: Option<String>,
    /// ポート接続
    port_connections: HashMap<String, SignalRef>,
    /// 子インスタンス
    children: Vec<ModuleInstance>,
}
```

---

## 5. 波形出力（vcd）

### 5.1 VCD出力

VCD（Value Change Dump）フォーマットは、IEEE 1364標準のテキスト形式で、GTKWaveなどで閲覧できます。

```rust
/// VCD波形ライター
pub struct VcdWriter {
    writer: BufWriter<File>,
    signals: HashMap<String, (char, usize)>,
    next_id: char,
    timescale: String,
}

impl VcdWriter {
    /// 新規作成
    pub fn new(path: &Path) -> Result<Self, WaveformError> {
        let file = File::create(path)?;
        Ok(Self {
            writer: BufWriter::new(file),
            signals: HashMap::new(),
            next_id: '!',
            timescale: "1ps".to_string(),
        })
    }

    /// 信号登録
    pub fn add_signal(&mut self, name: &str, width: usize) -> Result<char, WaveformError> {
        let id = self.next_id;
        self.signals.insert(name.to_string(), (id, width));
        self.next_id = (self.next_id as u8 + 1) as char;
        Ok(id)
    }

    /// 値記録
    pub fn write_value(&mut self, id: char, value: &SignalValue) -> Result<(), WaveformError> {
        // 値をVCD形式で出力
        // ...
        Ok(())
    }

    /// 終了処理
    pub fn close(self) -> Result<(), WaveformError> {
        self.writer.flush()?;
        Ok(())
    }
}
```

### 5.2 シグナルトレース

```rust
/// シグナルトレース
pub struct SignalTrace {
    /// シグナル名 → 変化履歴
    changes: HashMap<String, Vec<(SimTime, Value)>>,
    /// シグナル幅
    widths: HashMap<String, usize>,
}

impl SignalTrace {
    /// 変化を記録
    pub fn record(&mut self, name: &str, time: SimTime, value: Value) {
        let changes = self.changes.entry(name.to_string()).or_default();

        // 前回と同じ値なら記録しない（最適化）
        if let Some((_, last)) = changes.last() {
            if *last == value {
                return;
            }
        }

        changes.push((time, value));
    }

    /// VCDに出力
    pub fn write_vcd(&self, path: &Path) -> Result<(), WaveformError> {
        let mut writer = VcdWriter::new(path)?;

        // 信号登録
        for (name, width) in &self.widths {
            writer.add_signal(name, *width)?;
        }

        // 変化を時系列順に出力
        // ...

        writer.close()
    }
}
```

---

## 6. コンパイラ（compile）

### 6.1 コード生成

コンパイラはIRIS ASTからRustコードを生成します。

```rust
/// Rustコード生成器
pub struct CodeGenerator {
    output: String,
    indent: usize,
}

impl CodeGenerator {
    /// モジュールをRust構造体に変換
    pub fn generate_module(&mut self, module: &ModuleDef) {
        // 構造体定義
        self.emit_line(&format!("pub struct {} {{", module.name));
        self.indent();

        // ポート
        for port in &module.ports {
            let ty = self.rust_type(&port.ty);
            self.emit_line(&format!("pub {}: {},", port.name, ty));
        }

        // 内部信号
        for item in &module.items {
            if let ModuleItem::Let(decl) = item {
                let ty = self.rust_type(&decl.ty);
                self.emit_line(&format!("{}: {},", decl.name, ty));
            }
        }

        self.dedent();
        self.emit_line("}");

        // メソッド実装
        self.emit_line(&format!("impl {} {{", module.name));
        self.indent();

        // comb_eval: 組み合わせロジック評価
        self.generate_comb_eval(module);

        // sync_update: 順序ロジック更新
        self.generate_sync_update(module);

        self.dedent();
        self.emit_line("}");
    }
}
```

### 6.2 生成されるコード例

```rust
// 入力: IRIS
// mod Counter(in clk: clock, in rst: reset, in enable: bit, out count: bit[8]) { ... }

// 出力: Rust
pub struct Counter {
    pub clk: u64,
    pub rst: u64,
    pub enable: u64,
    pub count: u64,
    counter: u64,
}

impl Counter {
    pub fn new() -> Self {
        Self {
            clk: 0,
            rst: 0,
            enable: 0,
            count: 0,
            counter: 0,
        }
    }

    pub fn comb_eval(&mut self) {
        self.count = self.counter;
    }

    pub fn sync_update(&mut self, clk_posedge: bool, rst_active: bool) {
        if rst_active {
            self.counter = 0;
        } else if clk_posedge {
            if self.enable != 0 {
                self.counter = (self.counter + 1) & 0xFF;
            }
        }
    }
}
```

---

## 7. 型システム（types）

### 7.1 シグナル型

```rust
/// シミュレーション用信号値
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// 1ビット値
    Bit(bool),
    /// ビットベクタ（最大64ビット）
    BitVec64(u64, usize),  // (値, ビット幅)
    /// 大きなビットベクタ
    BitVecBig(BigUint, usize),
    /// 不定値
    X(usize),
    /// ハイインピーダンス
    Z(usize),
}

impl Value {
    /// ビット幅を取得
    pub fn width(&self) -> usize {
        match self {
            Value::Bit(_) => 1,
            Value::BitVec64(_, w) => *w,
            Value::BitVecBig(_, w) => *w,
            Value::X(w) => *w,
            Value::Z(w) => *w,
        }
    }

    /// u64に変換（64ビット以下の場合）
    pub fn to_u64(&self) -> Option<u64> {
        match self {
            Value::Bit(b) => Some(*b as u64),
            Value::BitVec64(v, _) => Some(*v),
            _ => None,
        }
    }

    /// バイト配列に変換
    pub fn to_bytes(&self) -> Vec<u8> {
        // VCD出力用
        // ...
    }
}
```

### 7.2 時間型

```rust
/// シミュレーション時間（ピコ秒単位）
pub type SimTime = u64;

/// 時間単位
pub enum TimeUnit {
    Ps,  // ピコ秒
    Ns,  // ナノ秒
    Us,  // マイクロ秒
    Ms,  // ミリ秒
    S,   // 秒
}

impl TimeUnit {
    /// ピコ秒への変換係数
    pub fn to_ps_factor(&self) -> u64 {
        match self {
            TimeUnit::Ps => 1,
            TimeUnit::Ns => 1_000,
            TimeUnit::Us => 1_000_000,
            TimeUnit::Ms => 1_000_000_000,
            TimeUnit::S => 1_000_000_000_000,
        }
    }
}
```

---

## 8. 拡張ガイド

### 8.1 新しい演算子の追加

1. **文法の追加（iris.pest）**
```pest
// 例: 新しい演算子 *** を追加
binary_op = { "+" | "-" | "*" | "/" | "***" }
```

2. **ASTの拡張（ast.rs）**
```rust
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    NewOp,  // 新しい演算子
}
```

3. **パーサーの更新（grammar.rs）**
```rust
fn parse_binary_op(&self, pair: Pair) -> BinOp {
    match pair.as_str() {
        "+" => BinOp::Add,
        "-" => BinOp::Sub,
        "***" => BinOp::NewOp,  // 新しい演算子
        _ => panic!("Unknown operator"),
    }
}
```

4. **評価器の更新（eval.rs）**
```rust
fn eval_binary(&self, lhs: Value, op: BinOp, rhs: Value) -> Result<Value, EvalError> {
    match op {
        BinOp::NewOp => {
            // 新しい演算子の実装
            Ok(Value::BitVec64(lhs.to_u64()? *** rhs.to_u64()?, width))
        }
        // ...
    }
}
```

### 8.2 新しい組み込み型の追加

1. **型の定義（types/）**
```rust
// types/my_type.rs
pub struct MyType {
    // フィールド
}

impl MyType {
    pub fn new() -> Self { ... }
    // メソッド
}
```

2. **TypeSpecへの追加（ast.rs）**
```rust
pub enum TypeSpec {
    Bit,
    BitVec(usize),
    Clock,
    Reset,
    MyType,  // 新しい型
}
```

3. **パーサーの更新**
```pest
type_spec = { "bit" | "clock" | "reset" | "my_type" }
```

### 8.3 新しいシミュレーション機能の追加

例：新しいアサーションタイプの追加

```rust
// sim/assertions.rs
pub enum AssertionKind {
    Immediate,
    Concurrent,
    Cover,     // 新しいアサーションタイプ
}

impl HierarchicalSimulator {
    fn check_cover(&mut self, assertion: &CoverAssertion) {
        if self.eval_condition(&assertion.condition) {
            self.cover_hits.insert(assertion.id);
            println!("Coverage point {} hit at time {}",
                assertion.id, self.current_time);
        }
    }
}
```

---

## 9. テスト

### 9.1 ユニットテスト

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parser() {
        let source = r#"
            mod Test(in a: bit, out y: bit) {
                comb { y = !a; }
            }
        "#;

        let parser = Parser::new();
        let result = parser.parse(source);
        assert!(result.is_ok());

        let modules = result.unwrap();
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].name, "Test");
    }

    #[test]
    fn test_evaluator() {
        let mut signals = SignalMap::new();
        signals.insert("a".to_string(), Value::BitVec64(10, 8));
        signals.insert("b".to_string(), Value::BitVec64(5, 8));

        let evaluator = Evaluator::new(&signals);

        let expr = Expr::Binary(
            Box::new(Expr::Ident("a".to_string())),
            BinOp::Add,
            Box::new(Expr::Ident("b".to_string())),
        );

        let result = evaluator.eval(&expr).unwrap();
        assert_eq!(result.to_u64(), Some(15));
    }
}
```

### 9.2 統合テスト

```rust
// tests/integration_test.rs
use iris_sim::{parser::Parser, sim::HierarchicalSimulator};

#[test]
fn test_counter_simulation() {
    let source = std::fs::read_to_string("tests/counter.iris").unwrap();

    let parser = Parser::new();
    let modules = parser.parse(&source).unwrap();

    let mut sim = HierarchicalSimulator::new(&modules, "Counter");
    sim.run(100);

    let count = sim.get_signal_value("count");
    assert_eq!(count.to_u64(), Some(100));
}
```

### 9.3 テストの実行

```bash
# 全テスト実行
cargo test

# 特定のテスト
cargo test test_parser

# ベンチマーク
cargo bench

# ドキュメントテスト
cargo test --doc
```

---

## 10. コントリビューション

### 10.1 開発環境セットアップ

```bash
# リポジトリクローン
git clone https://github.com/your-repo/iris-sim.git
cd iris-sim

# 依存関係インストール
cargo build

# 開発用ビルド（警告を有効化）
RUSTFLAGS="-W warnings" cargo build

# フォーマット
cargo fmt

# リント
cargo clippy
```

### 10.2 コーディング規約

1. **命名規則**
   - 構造体: `PascalCase`
   - 関数/メソッド: `snake_case`
   - 定数: `SCREAMING_SNAKE_CASE`
   - モジュール: `snake_case`

2. **ドキュメント**
   - 公開APIには必ずドキュメントコメントを付ける
   - 例：
   ```rust
   /// 式を評価して値を返す
   ///
   /// # Arguments
   /// * `expr` - 評価する式
   ///
   /// # Returns
   /// 評価結果の値、またはエラー
   ///
   /// # Examples
   /// ```
   /// let result = evaluator.eval(&expr)?;
   /// ```
   pub fn eval(&self, expr: &Expr) -> Result<Value, EvalError> {
       // ...
   }
   ```

3. **エラー処理**
   - `unwrap()` は本番コードでは使わない
   - カスタムエラー型を使用
   - `thiserror` クレートを活用

### 10.3 プルリクエスト

1. フィーチャーブランチを作成
2. テストを追加
3. `cargo fmt` と `cargo clippy` を実行
4. PRを作成

---

## 関連ドキュメント

- [チュートリアル](tutorial.md) - 基本的な使い方
- [言語リファレンス](reference.md) - IRIS言語仕様
- [サンプル集](examples.md) - 実践的なコード例
- [README](../README.md) - プロジェクト概要
