# IRIS Tools Makefile
# iris2sv, irisfmt, sv2iris の統一ビルドファイル

.PHONY: all install build test lint clean help link unlink
.PHONY: iris2sv irisfmt sv2iris vscode
.PHONY: install-iris2sv install-irisfmt install-sv2iris
.PHONY: build-iris2sv build-irisfmt build-sv2iris build-vscode
.PHONY: test-iris2sv test-irisfmt test-sv2iris
.PHONY: lint-iris2sv lint-irisfmt lint-sv2iris
.PHONY: clean-iris2sv clean-irisfmt clean-sv2iris clean-vscode
.PHONY: link-iris2sv link-irisfmt link-sv2iris
.PHONY: package-vscode install-vscode

# プロジェクト定義
PROJECTS := iris2sv irisfmt sv2iris

# コマンド定義
#
# 各プロジェクトの package.json は packageManager に pnpm@9 を指定している。
# pnpm 10 で実行するとその版へ切り替えようとし、見つからなければ失敗する。
# 切り替えを無効にして、いま入っている pnpm をそのまま使う。
# pnpm 9 を使う場合は `make PNPM_FLAGS=` で外せる。
PNPM_FLAGS ?= --config.manage-package-manager-versions=false
PNPM := pnpm $(PNPM_FLAGS)

# VS Code 拡張
VSCODE_DIR := irisfmt/packages/vscode-iris
VSCE := npx --yes @vscode/vsce

# 削除対象
CLEAN_TARGETS := node_modules dist coverage .turbo

#===============================================================================
# メインターゲット
#===============================================================================

# デフォルトターゲット: install してから build を実行
all: install build

# ヘルプ表示
help:
	@echo "IRIS Tools Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Main targets:"
	@echo "  all      - Install and build all tools (default)"
	@echo "  install  - Install dependencies for all tools"
	@echo "  build    - Build all tools (requires install first)"
	@echo "  test     - Run tests for all tools"
	@echo "  lint     - Run linter for all tools"
	@echo "  clean    - Clean build artifacts for all tools"
	@echo "  link     - Link CLI tools globally (requires build first)"
	@echo "  unlink   - Unlink CLI tools from global"
	@echo "  help     - Show this help message"
	@echo ""
	@echo "Individual tool targets:"
	@echo "  iris2sv  - Install and build iris2sv"
	@echo "  irisfmt  - Install and build irisfmt"
	@echo "  sv2iris  - Install and build sv2iris"
	@echo "  vscode   - Build the VS Code extension"
	@echo ""
	@echo "VS Code extension:"
	@echo "  build-vscode    - Compile the extension and the language server"
	@echo "  package-vscode  - Produce a .vsix (needs network for @vscode/vsce)"
	@echo "  clean-vscode    - Remove the extension's build output"
	@echo ""
	@echo "Fine-grained targets:"
	@echo "  install-{tool}  - Install dependencies for specific tool"
	@echo "  build-{tool}    - Build specific tool"
	@echo "  test-{tool}     - Run tests for specific tool"
	@echo "  lint-{tool}     - Run linter for specific tool"
	@echo "  clean-{tool}    - Clean specific tool"
	@echo "  link-{tool}     - Link specific tool globally"
	@echo ""
	@echo "NOTE: Before using 'make link', run 'pnpm setup' and restart your shell."

#===============================================================================
# 全体ターゲット
#===============================================================================

install: install-iris2sv install-irisfmt install-sv2iris
	@echo "All dependencies installed."

build: install build-iris2sv build-irisfmt build-sv2iris
	@echo "All tools built."

test: build test-iris2sv test-irisfmt test-sv2iris
	@echo "All tests completed."

lint: build lint-iris2sv lint-irisfmt lint-sv2iris
	@echo "All linting completed."

clean: clean-iris2sv clean-irisfmt clean-sv2iris clean-vscode
	@echo "All tools cleaned."

#===============================================================================
# 個別ツールターゲット（build + install）
#===============================================================================

iris2sv: install-iris2sv build-iris2sv
	@echo "iris2sv ready."

irisfmt: install-irisfmt build-irisfmt
	@echo "irisfmt ready."

sv2iris: install-sv2iris build-sv2iris
	@echo "sv2iris ready."

vscode: install-vscode build-vscode
	@echo "VS Code extension ready."

#===============================================================================
# VS Code 拡張
#
# 拡張は irisfmt ワークスペースの中にある（packages/vscode-iris）。
# 動かすには Language Server（packages/ls/dist/server.js）が要るため、
# build-vscode は irisfmt 全体をビルドする。
#===============================================================================

install-vscode: install-irisfmt

build-vscode: build-irisfmt
	@echo "Building VS Code extension..."
	@cd $(VSCODE_DIR) && $(PNPM) build
	@echo ""
	@echo "Extension built:        tools/$(VSCODE_DIR)/out/extension.js"
	@echo "Language server:        tools/irisfmt/packages/ls/dist/server.js"
	@echo ""
	@echo "To try it, open tools/$(VSCODE_DIR) in VS Code and press F5."

# .vsix を作る
#
# Language Server を拡張の中へ複製してから固める。
# 拡張は開発時には隣の packages/ls を見るが、その場所は .vsix に入らない。
# 同梱しないと、インストールした拡張がサーバーを起動できない。
#
# vsce は依存に入れていないので npx が取りに行く。ネットワークが要る。
package-vscode: build-vscode
	@echo "Bundling the language server into the extension..."
	@rm -rf $(VSCODE_DIR)/server
	@mkdir -p $(VSCODE_DIR)/server
	@cp -r irisfmt/packages/ls/dist/. $(VSCODE_DIR)/server/
	@echo "Packaging VS Code extension..."
	@cd $(VSCODE_DIR) && $(VSCE) package --no-dependencies
	@echo ""
	@echo "Package written to tools/$(VSCODE_DIR)/*.vsix"
	@echo "Install it with: code --install-extension <file>.vsix"

clean-vscode:
	@echo "Cleaning VS Code extension..."
	@rm -rf $(VSCODE_DIR)/out $(VSCODE_DIR)/server $(VSCODE_DIR)/*.vsix 2>/dev/null || true

#===============================================================================
# iris2sv
#===============================================================================

install-iris2sv:
	@echo "Installing iris2sv dependencies..."
	@cd iris2sv && $(PNPM) install

build-iris2sv:
	@echo "Building iris2sv..."
	@cd iris2sv && $(PNPM) build

test-iris2sv:
	@echo "Testing iris2sv..."
	@cd iris2sv && $(PNPM) test

lint-iris2sv:
	@echo "Linting iris2sv..."
	@cd iris2sv && $(PNPM) lint

clean-iris2sv:
	@echo "Cleaning iris2sv..."
	@cd iris2sv && $(PNPM) clean 2>/dev/null || true
	@for target in $(CLEAN_TARGETS); do \
		rm -rf iris2sv/$$target 2>/dev/null || true; \
	done

#===============================================================================
# irisfmt
#===============================================================================

install-irisfmt:
	@echo "Installing irisfmt dependencies..."
	@cd irisfmt && $(PNPM) install

build-irisfmt:
	@echo "Building irisfmt..."
	@cd irisfmt && $(PNPM) build

test-irisfmt:
	@echo "Testing irisfmt..."
	@cd irisfmt && $(PNPM) test

lint-irisfmt:
	@echo "Linting irisfmt..."
	@cd irisfmt && $(PNPM) lint

clean-irisfmt:
	@echo "Cleaning irisfmt..."
	@cd irisfmt && $(PNPM) clean 2>/dev/null || true
	@for target in $(CLEAN_TARGETS); do \
		rm -rf irisfmt/$$target 2>/dev/null || true; \
	done

#===============================================================================
# sv2iris
#===============================================================================

install-sv2iris:
	@echo "Installing sv2iris dependencies..."
	@cd sv2iris && $(PNPM) install

build-sv2iris:
	@echo "Building sv2iris..."
	@cd sv2iris && $(PNPM) build

test-sv2iris:
	@echo "Testing sv2iris..."
	@cd sv2iris && $(PNPM) test

lint-sv2iris:
	@echo "Linting sv2iris..."
	@cd sv2iris && $(PNPM) lint

clean-sv2iris:
	@echo "Cleaning sv2iris..."
	@cd sv2iris && $(PNPM) clean 2>/dev/null || true
	@for target in $(CLEAN_TARGETS); do \
		rm -rf sv2iris/$$target 2>/dev/null || true; \
	done

#===============================================================================
# グローバルリンク（オプション）
# 注意: 初回実行前に `pnpm setup` を実行し、シェルを再起動してください
#===============================================================================

# 全ツールをグローバルにリンク
link: build link-iris2sv link-irisfmt link-sv2iris
	@echo ""
	@echo "All tools linked globally."
	@echo "Available commands: iris2sv, irisfmt-format, irisfmt-lint, irisfmt-ls, sv2iris"
	@echo ""
	@echo "NOTE: You may need to restart your shell or run 'source ~/.bashrc' (or ~/.zshrc)"

# 全ツールのグローバルリンクを解除
unlink:
	@echo "Unlinking all tools..."
	-@$(PNPM) unlink --global @iris2sv/cli 2>/dev/null || true
	-@$(PNPM) unlink --global @irisfmt/format 2>/dev/null || true
	-@$(PNPM) unlink --global @irisfmt/lint 2>/dev/null || true
	-@$(PNPM) unlink --global @irisfmt/ls 2>/dev/null || true
	-@$(PNPM) unlink --global @aquaxis/sv2iris 2>/dev/null || true
	@echo "All tools unlinked."

# iris2sv をグローバルにリンク
link-iris2sv:
	@echo "Linking iris2sv globally..."
	@cd iris2sv/packages/cli && $(PNPM) link --global

# irisfmt ツール群をグローバルにリンク
link-irisfmt:
	@echo "Linking irisfmt tools globally..."
	@cd irisfmt/packages/format && $(PNPM) link --global
	@cd irisfmt/packages/lint && $(PNPM) link --global
	@cd irisfmt/packages/ls && $(PNPM) link --global

# sv2iris をグローバルにリンク
link-sv2iris:
	@echo "Linking sv2iris globally..."
	@cd sv2iris && $(PNPM) link --global
