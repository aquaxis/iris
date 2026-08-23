# IRIS標準ライブラリ

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。

## 置き場所

分類ごとにディレクトリを分ける。

| ディレクトリ | 分類 |
|---|---|
| `arith/` | 算術・演算 |
| `mem/` | 記憶・バッファ |
| `stream/` | ストリーム・フロー制御 |
| `arbiter/` | 調停 |
| `cdc/` | CDC・リセット・クロック |
| `timing/` | カウンタ・タイミング制御 |
| `util/` | ユーティリティ（関数） |

1部品は3点で構成する。

| 要素 | 置き場所 | 役目 |
|---|---|---|
| 実装 | `<分類>/<name>.iris` | 部品本体。ジェネリックでパラメタライズ |
| 試験 | `<分類>/<name>_tb.iris` | 振る舞いを`iris-sim`で確かめる`test`モジュール |
| 資料 | この`README.md` | 用途・パラメータ・注意点 |

## 規約

| 規約 | 決め方 |
|---|---|
| 命名 | モジュールはPascalCase、ポート・信号はsnake_case、パラメータはPascalCase（`Width`／`Depth`） |
| リセット | 非同期assert・同期deassert、能動High既定。`sync(clk.posedge, rst.async)`、リセット値は宣言の初期値 |
| ready/valid | validはready非依存で下げない（ストリーム部品で守る） |
| パラメータ | `Width`／`Depth`／`Stages`等に統一し、既定値を与える |
| 検証 | `assert`／`cover`と`iris-sim`／`iris sv`で確かめる。外部SDC／lintができない点は明記する |

## 使い方

部品を設計に取り込み、必要ならジェネリックで幅などを変える。

```
// 既定（Width=8）で使う
inst c8 = Counter { clk: clk, rst: rst, en: en };

// ジェネリックを上書きする
inst c4 = Counter[Width: 4, Saturate: 1] { clk: clk, rst: rst, en: en };
```

## 検証

1部品ごとに次を通す。

```
iris sim  -i <分類>/<name>.iris <分類>/<name>_tb.iris -c <cycles>
iris sv      <分類>/<name>.iris -o out/          # SystemVerilogへ変換できること
iris lint    <分類>/<name>.iris                  # 命名規約に沿うこと
```

## 部品一覧

### timing

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Counter` | 汎用カウンタ | `Width`（幅、既定8）、`Down`（0=加算/1=減算、既定0）、`Saturate`（0=ラップ/1=飽和、既定0） |

`Counter`はラップを幅の自然なあふれに任せ、飽和は上限（全ビット1）と下限（0）で値を保つ。
上限の判定は`count + 1 == 0`で行う（全ビット1に1を足すとWidthビットで0へ戻る）。

## IRISで表さないもの

テクノロジ依存のセル（`clk_gate`、`tc_sram`、level_shifter等）はPDK実装に紐づくので、
IRISの合成可能な論理としては表さない。
SystemVerilogのレジスタマクロ（`FF`等）は対応物を作らない。`sync`と`var`で足りる。
これらが要る場合は、各PDKの実装や実在ライブラリ（`instructions.md`のB節）を使う。
