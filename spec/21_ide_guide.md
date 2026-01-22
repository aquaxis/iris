# 第21章 IDE連携ガイド

[<< チュートリアル](./20_tutorial.md) | [目次](./iris_spec_0.1.0.md)

---

このガイドでは、各種エディタ・IDEでIRIS言語を快適に使用するための設定方法を説明します。

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

1. VS Codeを開く
2. 拡張機能パネル（Ctrl+Shift+X）を開く
3. 「IRIS HDL」を検索
4. インストールをクリック

または、コマンドラインから：

```bash
code --install-extension iris-lang.iris-vscode
```

### 21.2.2 設定

`settings.json`に以下を追加：

```json
{
    "files.associations": {
        "*.iris": "iris",
        "*.irs": "iris"
    },
    "iris.lsp.enable": true,
    "iris.lsp.path": "iris-lsp",
    "iris.format.onSave": true,
    "iris.lint.enable": true,
    "iris.lint.level": "warning",
    "editor.tabSize": 4,
    "editor.insertSpaces": true,
    "[iris]": {
        "editor.defaultFormatter": "iris-lang.iris-vscode"
    }
}
```

> **注記**: IRISファイルは`.iris`（正式拡張子、推奨）と`.irs`（短縮形）の両方の拡張子をサポートしています。上記の`files.associations`設定により、両方の拡張子がIRIS言語として認識されます。

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

## 21.7 Language Server Protocol (LSP)

### 21.7.1 LSPサーバーのインストール

```bash
# cargoを使用
cargo install iris-lsp

# または、プリビルドバイナリをダウンロード
curl -L https://github.com/iris-lang/iris/releases/latest/download/iris-lsp-linux-x64 -o iris-lsp
chmod +x iris-lsp
sudo mv iris-lsp /usr/local/bin/
```

### 21.7.2 LSPの機能

| 機能 | 説明 |
|------|------|
| 補完 | モジュール、信号、型の自動補完 |
| 定義ジャンプ | シンボルの定義位置へ移動 |
| 参照検索 | シンボルの使用箇所を検索 |
| ホバー | 型情報とドキュメントを表示 |
| 診断 | エラーと警告をリアルタイム表示 |
| フォーマット | コードの自動整形 |
| リネーム | シンボル名の一括変更 |
| コードアクション | クイックフィックスの提案 |

### 21.7.3 LSP設定オプション

```json
{
    "iris": {
        "lint": {
            "enable": true,
            "level": "warning",
            "rules": {
                "W0001": "off",
                "W0006": "error"
            }
        },
        "format": {
            "tabWidth": 4,
            "useTabs": false,
            "maxLineLength": 100
        },
        "completion": {
            "snippets": true,
            "autoImport": true
        },
        "inlayHints": {
            "typeHints": true,
            "parameterHints": true
        }
    }
}
```

---

## 21.8 フォーマッタ（iris-fmt）

### 21.8.1 インストール

```bash
cargo install iris-fmt
```

### 21.8.2 使用方法

```bash
# ファイルをフォーマット
iris-fmt src/counter.iris

# インプレースで上書き
iris-fmt -i src/counter.iris

# ディレクトリ全体をフォーマット
iris-fmt -i src/

# チェックのみ（CI用）
iris-fmt --check src/
```

### 21.8.3 設定ファイル（iris.toml）

```toml
[format]
tab_width = 4
use_tabs = false
max_line_length = 100
trailing_comma = true
brace_style = "same_line"
```

---

## 21.9 リンター（iris-lint）

### 21.9.1 使用方法

```bash
# ファイルをリント
iris-lint src/counter.iris

# 警告レベルを指定
iris-lint --level error src/

# 特定のルールを無効化
iris-lint --disable W0001,W0002 src/
```

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
      - uses: iris-lang/setup-iris@v1
      - run: iris-lint --level warning src/
      - run: iris-fmt --check src/
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

1. `iris-lsp`がPATHに含まれているか確認：
   ```bash
   which iris-lsp
   ```

2. 手動で起動してエラーを確認：
   ```bash
   iris-lsp --version
   ```

3. エディタのログを確認

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

1. `iris-fmt`がインストールされているか確認
2. `iris.toml`の設定を確認
3. エディタの設定で「Format on Save」が有効か確認

---

[<< チュートリアル](./20_tutorial.md) | [目次](./iris_spec_0.1.0.md)
