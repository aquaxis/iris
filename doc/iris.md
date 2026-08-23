# irisコマンド

IRISのツールを1つの入口にまとめたコマンドである。
`iris sim`のようにサブコマンドで各ツールを呼ぶ。

置き場所は`tools/iris`。Rustで書かれ、依存を持たない。

## なぜ1つにまとめるか

これまで入口が散らばっていた。
シミュレーションは`iris-sim`、整形は`irisfmt-format`、変換は`iris2sv`と、
別々のコマンドを覚える必要があった。

`iris`はそれらをサブコマンドに束ねる。
`cargo`が`cargo build`や`cargo test`を束ねるのと同じ形である。

## 使い方

```bash
iris sim -i design.iris -o out.vcd -c 100    # iris-sim
iris compile -i design.iris -o sim --release # iris-compile
iris formal -i design.iris -o out/           # iris-formal
iris veryl import design.veryl               # veryl2iris（Veryl → IRIS）
iris veryl export design.iris                # iris2veryl（IRIS → Veryl）
```

**コマンドの後ろの引数はそのまま各ツールへ渡る。**
`iris sim -i design.iris -c 100`は`iris-sim -i design.iris -c 100`を呼ぶ。
だから各ツールのオプションはそのまま使える。

## サブコマンドの一覧

### サブコマンド（すべてRust製）

| サブコマンド | 呼ぶツール | 役割 |
|---|---|---|
| `iris sim` | `iris-sim` | シミュレータ（インタプリタ） |
| `iris compile` | `iris-compile` | シミュレータ（コンパイル） |
| `iris formal` | `iris-formal` | 形式的等価性の基準モデル生成 |
| `iris veryl import` | `veryl2iris` | Veryl → IRIS |
| `iris veryl export` | `iris2veryl` | IRIS → Veryl |
| `iris sv` | `iris2sv` | IRIS → SystemVerilog |
| `iris from-sv` | `sv2iris` | SystemVerilog → IRIS |
| `iris fmt` | `irisfmt` | IRISの整形 |
| `iris lint` | `irisfmt-lint` | IRISのスタイル検査 |
| `iris lsp` | `irisfmt-lsp` | Language Server |

`veryl`は向きが2つあるので、`import`と`export`の孫サブコマンドで分ける。
`sv`／`from-sv`はRustへ移植済み（段A4）。`fmt`／`lint`／`lsp`もRustへ移植済み（段A5）。
いずれもTS版とパリティである（`fmt`はconformanceが通り、`lint`／`lsp`はTS版と同じ
規則・機能を持つ）。**どのサブコマンドももうnodeを起動しない。**
`fmt`はコメントを保ったまま字句解析し、`iris-sim`の解析器で構文を確かめてから、
トークン列を規定の空白で並べ直す（IRISは空白に依存しないので、意味は変わらない）。
`lint`は規則を`iris-sim`のASTの上で走らせる。このASTはシミュレーション用で、
定義（モジュール・enum・struct・関数）にしか位置情報を持たないので、指摘の位置は
TS版より粗い（近くの定義に寄せる）。名前・未使用のimport／信号／変数・空ブロック・
複雑度・seqのtimeout無しawaitなどを検査する。ASTに表せない2規則（関数本体は式1つで
return文がない`dead-code`、モジュールレベルの`var`が現行IRISでは正当な
`var-context-restriction`）は、前者を`break`／`continue`後の到達不能コード検査に
読み替え、後者は出さない。
`lsp`はstdio上のJSON-RPCサーバで、`irisfmt`の整形・lintと`iris-sim`のASTを再利用する。
診断（lint）・整形・補完・ホバー・定義ジャンプ・参照・シンボル一覧・リネームを提供する。
定義ジャンプとシンボル一覧はspanを持つ定義（モジュール等）に、参照・リネームは
字句単位の全語一致に基づく。

### ブラウザの前面（npm）

| サブコマンド | 対応するもの | 起動方法 |
|---|---|---|
| `iris schematic` | ブロック図ビューア | `npm run dev`で開発サーバを起動 |

`schematic`はWebアプリなのでCLIには畳めない。ここだけnpmが要る。

**入口は`iris`に1つにまとまった。** 引数はそのままツールへ渡す。
`iris sv design.iris`や`iris fmt design.iris`がそのまま動く。

## ツールの場所

`iris`は各ツールのバイナリを次の順で探す。

1. 環境変数`IRIS_<TOOL>_BIN`（例: `IRIS_IRIS_SIM_BIN`）
2. `iris`自身の隣
3. リポジトリのtarget（`sim/iris-sim/target/release/iris-sim`など）
4. `PATH`

リポジトリのルートから実行すると、ビルド済みのツールがそのまま見つかる。
すべてのサブコマンドがRustのバイナリなので、`node`はもう要らない
（`iris schematic`のブラウザ開発サーバだけがnpmを使う）。

## なぜ依存を持たないか

`iris`はツールをライブラリとして結線せず、サブプロセスで呼ぶ。

理由は依存の衝突である。
`iris-sim`はclap 4.4.18を厳密固定し、`veryl-parser`はclap ^4.6を要る。
両方を同じ依存グラフに置けない。
`iris`が両方を結線すると、この衝突を持ち込む。
だから結線せず、引数を自分で解いて、ビルド済みのバイナリへ渡す。
これでオフラインでもビルドできる。

## まだやっていないこと

- CLIのツール移植は完了した。`sv`（iris2sv）・`from-sv`（sv2iris）・
  `fmt`／`lint`／`lsp`（irisfmt）はすべてRust製で、nodeを起動しない
- `iris schematic`はブラウザの開発サーバを起動するだけで、CLIには畳めない（npmが要る）
- `lsp`の位置精度は`iris-sim`のASTのspanに依存し、TS版より粗い。より細かくするには
  ASTに識別子ごとのspanを持たせる必要がある（今後の課題）
