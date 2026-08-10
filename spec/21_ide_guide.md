# 第21章 IDE連携ガイド

[<< チュートリアル](./20_tutorial.md) | [目次](./iris_spec.md)

---

このガイドでは、各種のエディタとIDEでIRIS言語を快適に使用するための設定方法を説明します。

**これ以降は将来用の仕様です**

---

## 21.1 概要

IRIS言語は以下のIDE/エディタをサポートしています：

| エディタ | シンタックスハイライト | LSP対応 | フォーマッタ | リンター |
|----------|----------------------|---------|-------------|---------|
| VS Code | ○ | ○ | ○ | ○ |
| Neovim | × | × | × | × |
| Vim | × | × | × | × |
| Emacs | × | × | × | × |
| IntelliJ IDEA | × | × | × | × |

---

## 21.2 VS Code

### 21.2.1 拡張機能のインストール

拡張はマーケットプレイスにまだ出していない。
リポジトリから`.vsix`を作って入れる。

```bash
make -C tools vscode          # 拡張と言語サーバをビルドする
make -C tools package-vscode  # .vsix を作る
code --install-extension tools/irisfmt/packages/vscode-iris/vscode-iris-0.1.0.vsix
```

開発中は`tools/irisfmt/packages/vscode-iris`をVS Codeで開き、F5で起動してもよい。

### 21.2.2 設定

拡張が持つ設定項目は次の4つである。

```json
{
    "files.associations": {
        "*.iris": "iris",
        "*.irs": "iris"
    },
    "iris.format.indentWidth": 4,
    "iris.format.useTabs": false,
    "iris.format.maxLineLength": 100,
    "iris.lint.enable": true
}
```

保存時の整形はVS Code側の`editor.formatOnSave`で指定する。
言語サーバを入れ直したいときは、コマンドパレットから`iris.restartServer`を実行する。

> **注記**: IRISファイルは`.iris`（正式拡張子、推奨）と`.irs`（短縮形）の両方をサポートしています。
> 上記の`files.associations`設定により、両方の拡張子がIRIS言語として認識されます。

### 21.2.3 キーバインド

| キー | 機能 |
|------|------|
| F12 | 定義へジャンプ |
| Shift+F12 | 参照を検索 |
| F2 | シンボル名変更 |
| Ctrl+Shift+F | フォーマット |
| Ctrl+. | クイックフィックス |

### 21.2.4 スニペット

IRIS拡張機能には以下のスニペットが含まれています：

| プレフィックス | 展開 |
|---------------|------|
| `mod` | モジュールテンプレート |
| `comb` | combブロック |
| `sync` | syncブロック |
| `fsm` | FSMテンプレート |
| `inst` | インスタンス化 |

---

## 21.3 Language Server Protocol (LSP)

### 21.3.1 LSPサーバーのビルド

サーバーは`tools/irisfmt`にある。
TypeScriptで書かれており、Node.jsで動く。

```bash
cd tools/irisfmt
pnpm install
pnpm -r build
```

ビルドすると`packages/ls/dist/server.js`ができる。
VS Code拡張（`packages/vscode-iris`）はこれを起動する。

`package.json`の`packageManager`がpnpm 9を指しているため、
pnpm 10で実行すると切り替えに失敗することがある。
その場合は`--config.manage-package-manager-versions=false`を付ける。

### 21.3.2 LSPの機能

| 機能 | LSPメソッド | 説明 |
|------|-------------|------|
| 診断 | `textDocument/publishDiagnostics` | エラーと警告をリアルタイム表示 |
| フォーマット | `textDocument/formatting` | コードの自動整形 |
| 範囲フォーマット | `textDocument/rangeFormatting` | 選択範囲の整形 |
| コードアクション | `textDocument/codeAction` | クイックフィックスの提案 |
| ホバー | `textDocument/hover` | キーワードのドキュメントを表示 |
| 補完 | `textDocument/completion` | 予約語と文脈に応じた補完 |
| 定義ジャンプ | `textDocument/definition` | インスタンスからモジュールへ、信号から宣言へ |
| 参照検索 | `textDocument/references` | 名前を使っている箇所を検索 |
| ドキュメントシンボル | `textDocument/documentSymbol` | モジュールと構成要素の一覧 |
| リネーム | `textDocument/rename` | 名前の一括変更 |

定義ジャンプは階層名を辿る。
`rf.rdata1`はインスタンス`rf`が指すモジュールの`rdata1`に解決される。

これらの機能は`mod`と`test`の両方で効く。
`test Name { ... }`の中の名前は`Name`に属するものとして解決される。

詳細は[irisfmt-lsのドキュメント](../tools/irisfmt-ls.md)を参照のこと。

### 21.3.3 サーバの設定

サーバは整形とリントの設定を`.irisfmtrc.json`から読む。
エディタ側の設定項目は21.2.2節に挙げた4つである。

---

## 21.8 フォーマッタ

### 21.8.1 ビルド

フォーマッタは`tools/irisfmt`にある。
TypeScriptで書かれており、リンターや言語サーバと同じワークスペースに入っている。

```bash
cd tools/irisfmt
pnpm install
pnpm -r build
```

### 21.8.2 使用方法

```bash
# 整形されているか確かめる
node packages/format/dist/cli.js --check src/counter.iris

# 書き戻す
node packages/format/dist/cli.js --write src/counter.iris

# ディレクトリ全体
node packages/format/dist/cli.js --write "src/**/*.iris"
```

`--check`は整形が必要なファイルがあると終了コード1を返す。

### 21.8.3 設定ファイル

設定は`.irisfmtrc.json`で与える。
指定できる項目は[irisfmtの設定](../tools/irisfmt/docs/configuration.md)にある。

---

## 21.9 リンター

### 21.9.1 使用方法

リンターも`tools/irisfmt`にあり、フォーマッタと同じビルドで用意できる。

```bash
# ファイルを検査する
node packages/lint/dist/cli.js src/counter.iris

# 除外する
node packages/lint/dist/cli.js --ignore "test/**" "src/**/*.iris"
```

規則の一覧は[リント規則](../tools/irisfmt/docs/lint-rules.md)にある。

### 21.9.2 CI/CD統合

**GitHub Actions例：**

```yaml
name: IRIS Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: cd tools/irisfmt && pnpm install && pnpm -r build
      - run: node tools/irisfmt/packages/lint/dist/cli.js "src/**/*.iris"
      - run: node tools/irisfmt/packages/format/dist/cli.js --check "src/**/*.iris"
```

---

## 21.10 プロジェクト構成

### 21.10.1 推奨ディレクトリ構造

```
my_project/
├── iris.toml           # プロジェクト設定
├── src/
│   ├── lib.iris        # ライブラリルート
│   ├── top.iris        # トップモジュール
│   └── modules/
│       ├── counter.iris
│       └── uart.iris
├── test/
│   ├── counter_test.iris
│   └── uart_test.iris
└── build/
    └── output/
```

### 21.10.2 iris.toml

```toml
[package]
name = "my_project"
version = "0.1.0"

[dependencies]
iris_std = "0.1"

[build]
top_module = "Top"
output_dir = "build/output"
target = "systemverilog"

[synthesis]
target_device = "xc7a35t"
clock_period_ns = 10.0
```

---

## 21.11 トラブルシューティング

### 問題：LSPが起動しない

1. サーバがビルドされているか確認する。

   ```bash
   ls tools/irisfmt/packages/ls/dist/server.js
   ```

2. 無ければビルドする。

   ```bash
   cd tools/irisfmt && pnpm install && pnpm -r build
   ```

3. エディタのログを確認する。

### 問題：シンタックスハイライトが効かない

1. ファイル拡張子が`.iris`または`.irs`であることを確認
2. `files.associations`設定で両拡張子がiris言語に関連付けられているか確認：
   ```json
   {
       "files.associations": {
           "*.iris": "iris",
           "*.irs": "iris"
       }
   }
   ```
3. ファイルタイプが正しく設定されているか確認
4. プラグイン/拡張機能を再インストール

### 問題：フォーマットが適用されない

1. `tools/irisfmt`がビルドされているか確認する。
2. `.irisfmtrc.json`の設定を確認する。
3. エディタの設定で「Format on Save」が有効か確認する。

---

[<< チュートリアル](./20_tutorial.md) | [目次](./iris_spec.md)
