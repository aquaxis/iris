# IRIS Language Server (irisfmt-ls) 超詳細解説

---

## 1. 概要

**irisfmt-ls**は、IRIS言語のための**Language Server Protocol (LSP)**サーバーです。エディタとプロセス間通信で連携し、リアルタイムの診断、フォーマット、補完などを提供します。

### 提供機能

| 機能 | LSPメソッド | 説明 |
|------|-------------|------|
| 診断 | `textDocument/publishDiagnostics` | リントエラー・警告のリアルタイム表示 |
| フォーマット | `textDocument/formatting` | ドキュメント全体のフォーマット |
| 範囲フォーマット | `textDocument/rangeFormatting` | 選択範囲のフォーマット |
| クイックフィックス | `textDocument/codeAction` | 自動修正の提案 |
| ホバー | `textDocument/hover` | キーワードのドキュメント表示 |
| 補完 | `textDocument/completion` | コンテキスト依存の補完 |
| 定義へ移動 | `textDocument/definition` | インスタンスからモジュールへ、信号から宣言へ |
| 参照検索 | `textDocument/references` | 名前を使っている箇所の一覧 |
| ドキュメントシンボル | `textDocument/documentSymbol` | モジュールと構成要素の一覧 |
| リネーム | `textDocument/rename` | 名前の一括変更 |

### 移動と検索について

後半の4つは`@irisfmt/core`のシンボルテーブルの上に載っている。
モジュール、ポート、信号、メモリ、インスタンス、ジェネリックパラメータを記録し、
階層名を辿って解決する。

```iris
mod Core(...) {
    inst rf = RegFile { ... };
    comb { y = rf.rdata1; }   // rf.rdata1 で定義へ飛ぶと RegFile の rdata1 に着く
}
```

`rf.rdata1`は1つの名前として読む。
カーソル下の語だけを見ると`rdata1`になり、別のモジュールで解決してしまう。

リネームは予約語への変更を拒否する。
`inst`へ改名すると解析できないファイルになるためである。

### テストベンチについて

設計だけでなく、隣に置くテストベンチも同じ機能が効く。

```iris
test TestAddi {
    let clk: clock(period: 10ns);
    inst core = RiscvCore { clk: clk };

    sync(clk.posedge, rst_n.async) {
        assert matched else error("register does not match");
    }
}
```

`test Name { ... }`の中の名前は`Name`に属する。
インスタンス`core`も信号`idx`も、定義へ飛べるし参照も引ける。

`example/`の`.iris`ファイルは、設計もテストベンチも
パースエラー0で読める。

---

## 2. インストールとビルド

### 2.1 ビルド

```bash
cd irisfmt
pnpm install
pnpm build
```

### 2.2 Language Serverの場所

ビルド後、以下にサーバー実行ファイルが生成されます：

```
irisfmt/packages/ls/dist/server.js
```

### 2.3 グローバルインストール（オプション）

```bash
cd irisfmt/packages/ls
pnpm link --global
```

これで`irisfmt-ls`コマンドが使用可能になります。

---

## 3. VSCodeでの使用方法

### 3.1 VSCode拡張のビルド

```bash
cd irisfmt/packages/vscode-iris
pnpm install
pnpm compile
```

### 3.2 開発モードで実行

1. VSCodeで`irisfmt`ディレクトリを開く
2. `F5`キーを押して拡張機能開発ホストを起動
3. 新しいVSCodeウィンドウで`.iris`ファイルを開く

### 3.3 拡張機能のパッケージ化

```bash
cd irisfmt/packages/vscode-iris
npx vsce package
```

`vscode-iris-0.1.0.vsix`が生成されます。

### 3.4 VSIXのインストール

```bash
code --install-extension vscode-iris-0.1.0.vsix
```

### 3.5 VSCode設定

`.vscode/settings.json`:

```json
{
  "[iris]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "irisfmt.vscode-iris"
  },
  "iris.format.indentWidth": 4,
  "iris.format.useTabs": false,
  "iris.format.maxLineLength": 100,
  "iris.lint.enable": true
}
```

---

## 4. 他のエディタでの使用方法

### 4.1 Neovim (nvim-lspconfig)

```lua
-- ~/.config/nvim/lua/lspconfig.lua

local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- IRIS LSP設定を追加
if not configs.irisfmt then
  configs.irisfmt = {
    default_config = {
      cmd = { 'node', '/path/to/irisfmt/packages/ls/dist/server.js', '--stdio' },
      filetypes = { 'iris' },
      root_dir = function(fname)
        return lspconfig.util.find_git_ancestor(fname) or vim.fn.getcwd()
      end,
      settings = {},
    },
  }
end

lspconfig.irisfmt.setup({
  on_attach = function(client, bufnr)
    -- キーマッピング
    local opts = { noremap = true, silent = true, buffer = bufnr }
    vim.keymap.set('n', 'K', vim.lsp.buf.hover, opts)
    vim.keymap.set('n', 'gd', vim.lsp.buf.definition, opts)
    vim.keymap.set('n', '<leader>f', vim.lsp.buf.format, opts)
    vim.keymap.set('n', '<leader>ca', vim.lsp.buf.code_action, opts)
  end,
})
```

### 4.2 Neovim ファイルタイプ設定

```lua
-- ~/.config/nvim/ftdetect/iris.lua
vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = '*.iris',
  callback = function()
    vim.bo.filetype = 'iris'
  end,
})
```

### 4.3 Emacs (eglot)

```elisp
;; ~/.emacs.d/init.el

(require 'eglot)

;; IRISモードの定義
(define-derived-mode iris-mode prog-mode "IRIS"
  "Major mode for editing IRIS files.")

(add-to-list 'auto-mode-alist '("\\.iris\\'" . iris-mode))

;; eglotにIRIS LSPを登録
(add-to-list 'eglot-server-programs
             '(iris-mode . ("node" "/path/to/irisfmt/packages/ls/dist/server.js" "--stdio")))

;; iris-modeでeglotを自動起動
(add-hook 'iris-mode-hook 'eglot-ensure)
```

### 4.4 Emacs (lsp-mode)

```elisp
;; ~/.emacs.d/init.el

(require 'lsp-mode)

(add-to-list 'auto-mode-alist '("\\.iris\\'" . iris-mode))

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection
                   '("node" "/path/to/irisfmt/packages/ls/dist/server.js" "--stdio"))
  :major-modes '(iris-mode)
  :server-id 'irisfmt-ls))

(add-hook 'iris-mode-hook #'lsp)
```

### 4.5 Sublime Text (LSP)

1. Package ControlでLSPパッケージをインストール
2. `Preferences > Package Settings > LSP > Settings`を開く

```json
{
  "clients": {
    "irisfmt": {
      "enabled": true,
      "command": ["node", "/path/to/irisfmt/packages/ls/dist/server.js", "--stdio"],
      "selector": "source.iris"
    }
  }
}
```

3. IRISのシンタックス定義を作成（`.sublime-syntax`ファイル）

### 4.6 Helix

`~/.config/helix/languages.toml`:

```toml
[[language]]
name = "iris"
scope = "source.iris"
injection-regex = "iris"
file-types = ["iris"]
roots = []
comment-token = "//"
indent = { tab-width = 4, unit = "    " }
language-server = { command = "node", args = ["/path/to/irisfmt/packages/ls/dist/server.js", "--stdio"] }
```

---

## 5. 機能詳細

### 5.1 診断（Diagnostics）

リントルールに基づいてリアルタイムでエラー・警告を表示します。

**対応ルール:**
- `naming-convention` - 命名規則
- `unused-variable` - 未使用変数
- `unused-signal` - 未使用シグナル
- `unused-import` - 未使用インポート
- `no-empty-block` - 空ブロック
- `var-context-restriction` - var使用制限
- `import-order` - インポート順序
- `duplicate-import` - 重複インポート

**デバウンス機能:**
- 150ms遅延で過剰な再解析を防止
- キャッシュによる重複解析の回避

### 5.2 ホバー（Hover）

キーワードにカーソルを合わせるとドキュメントが表示されます。

**対応キーワード:**
- モジュール: `mod`, `pub`
- 変数: `let`, `var`, `const`
- 型: `type`, `struct`, `enum`, `interface`
- プリミティブ型: `bit`, `int`, `uint`, `bool`, `clock`, `reset`
- ポート: `in`, `out`, `inout`
- 制御フロー: `if`, `else`, `match`, `for`, `while`, `return`
- ロジックブロック: `comb`, `sync`
- FSM: `fsm`, `state`, `transitions`, `when`, `goto`
- その他: `mem`, `fn`, `import`, `package`

### 5.3 補完（Completion）

**トリガー文字:** `.`, `:`, `<`

**コンテキスト別補完:**

| コンテキスト | 補完内容 |
|-------------|----------|
| トップレベル | `mod`, `fn`, `struct`, `enum`, `type`, `interface`, `import` |
| 型位置（`:`の後） | `bit`, `int`, `uint`, `bool`, `clock`, `reset` |
| 型パラメータ（`<`の後） | `8`, `16`, `32`, `64` |
| ポート方向 | `in`, `out`, `inout` |
| モジュール内 | `comb`, `sync`, `fsm`, `let`, `var`, `mem`, `if`, `match`, `for` |
| 関数内 | `let`, `return`, `if`, `match`, `for`, `while` |

### 5.4 フォーマット（Formatting）

`@irisfmt/format`パッケージを使用してコードを整形します。

**フォーマット設定:**
- `indentWidth`: インデント幅（デフォルト: 4）
- `useTabs`: タブ使用（デフォルト: false）
- `maxLineLength`: 最大行長（デフォルト: 100）
- `braceStyle`: ブレーススタイル（`same-line` / `new-line`）
- `trailingComma`: 末尾カンマ（`none` / `all` / `multi-line`）

### 5.5 クイックフィックス（Code Actions）

リントエラーに対する自動修正を提案します。

**対応する自動修正:**
- 未使用インポートの削除
- インポート順序の修正
- 重複インポートの削除
- 命名規則の修正提案

---

## 6. 通信プロトコル

### 6.1 起動モード

| モード | 引数 | 説明 |
|--------|------|------|
| stdio | `--stdio` | 標準入出力で通信（推奨） |
| IPC | なし | Node.js IPCで通信（VSCode用） |

### 6.2 手動起動テスト

```bash
# stdioモードで起動
node /path/to/irisfmt/packages/ls/dist/server.js --stdio
```

### 6.3 LSP初期化シーケンス

```
Client → Server: initialize
Server → Client: initialize result (capabilities)
Client → Server: initialized
Server → Client: (ready)
```

### 6.4 サーバー能力（Capabilities）

```json
{
  "capabilities": {
    "textDocumentSync": "Incremental",
    "documentFormattingProvider": true,
    "documentRangeFormattingProvider": true,
    "codeActionProvider": {
      "codeActionKinds": ["quickfix"]
    },
    "hoverProvider": true,
    "completionProvider": {
      "triggerCharacters": [".", ":", "<"],
      "resolveProvider": false
    }
  }
}
```

---

## 7. トラブルシューティング

### 7.1 サーバーが起動しない

```bash
# ビルド確認
cd irisfmt && pnpm build

# 直接実行テスト
node packages/ls/dist/server.js --stdio
```

### 7.2 VSCodeでログを確認

1. `Ctrl+Shift+U`で出力パネルを開く
2. ドロップダウンから「IRIS Language Server」を選択

### 7.3 サーバー再起動（VSCode）

コマンドパレット（`Ctrl+Shift+P`）→「IRIS: Restart Language Server」

### 7.4 デバッグモード

```bash
# デバッグポート付きで起動
node --inspect=6009 packages/ls/dist/server.js --stdio
```

Chrome DevToolsで`chrome://inspect`からデバッグ可能。

---

## 8. 設定ファイル

### 8.1 .irisfmtrc.json

プロジェクトルートに配置：

```json
{
  "format": {
    "indentWidth": 2,
    "useTabs": false,
    "maxLineLength": 100,
    "braceStyle": "same-line",
    "trailingComma": "multi-line"
  },
  "lint": {
    "rules": {
      "naming-convention": "warning",
      "unused-variable": "error",
      "unused-signal": "warning"
    },
    "ignore": ["**/generated/**"]
  }
}
```

Language Serverは`.irisfmtrc.json`の変更を自動検出します（VSCode使用時）。
