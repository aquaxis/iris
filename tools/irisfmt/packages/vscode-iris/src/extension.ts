import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(loading~spin) IRIS';
  statusBarItem.tooltip = 'IRIS Language Server starting...';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Start the language client
  startLanguageClient(context);

  // Register restart command
  const restartCommand = vscode.commands.registerCommand(
    'iris.restartServer',
    async () => {
      if (client) {
        await client.stop();
      }
      startLanguageClient(context);
    }
  );
  context.subscriptions.push(restartCommand);
}

/**
 * Where the language server lives
 *
 * Packaged, it is bundled into the extension under `server/`. In the monorepo
 * it is a sibling package that has just been built. The sibling path is not in
 * the .vsix, so an installed extension must find the bundled copy or it will
 * try to start a file that is not there.
 */
function resolveServerModule(context: vscode.ExtensionContext): string {
  const bundled = context.asAbsolutePath(path.join('server', 'server.js'));
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return context.asAbsolutePath(path.join('..', 'ls', 'dist', 'server.js'));
}

/**
 * Where the Rust language server binary is, if present.
 *
 * In order: the `iris.server.path` setting (trusted as given), a copy bundled
 * with the extension under `server-bin/`, then the repository build (relative to
 * this package). Returns undefined when none is found, so the caller falls back
 * to the bundled Node server. A binary on `PATH` only is not auto-detected; set
 * `iris.server.path` to use one.
 */
function resolveRustServer(context: vscode.ExtensionContext): string | undefined {
  const exe = process.platform === 'win32' ? 'irisfmt-lsp.exe' : 'irisfmt-lsp';

  const configured = vscode.workspace
    .getConfiguration('iris')
    .get<string>('server.path');
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  const bundled = context.asAbsolutePath(path.join('server-bin', exe));
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // Repository layout: tools/irisfmt/packages/vscode-iris -> tools/irisfmt-lsp-rs
  const repoBuilt = context.asAbsolutePath(
    path.join('..', '..', '..', 'irisfmt-lsp-rs', 'target', 'release', exe)
  );
  if (fs.existsSync(repoBuilt)) {
    return repoBuilt;
  }

  return undefined;
}

function startLanguageClient(context: vscode.ExtensionContext): void {
  // Prefer the Rust server (`irisfmt-lsp`, over stdio); fall back to the
  // bundled Node server so an install without the Rust binary still works.
  const rustServer = resolveRustServer(context);
  let serverOptions: ServerOptions;
  if (rustServer) {
    const executable = {
      command: rustServer,
      transport: TransportKind.stdio,
    };
    serverOptions = { run: executable, debug: executable };
  } else {
    const serverModule = resolveServerModule(context);
    serverOptions = {
      run: {
        module: serverModule,
        transport: TransportKind.ipc,
      },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: {
          execArgv: ['--nolazy', '--inspect=6009'],
        },
      },
    };
  }

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'iris' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.irisfmtrc.json'),
    },
    outputChannelName: 'IRIS Language Server',
  };

  // Create and start the client
  client = new LanguageClient(
    'irisLanguageServer',
    'IRIS Language Server',
    serverOptions,
    clientOptions
  );

  // Update status bar based on client state
  client.onDidChangeState((event) => {
    switch (event.newState) {
      case 1: // Stopped
        statusBarItem.text = '$(circle-slash) IRIS';
        statusBarItem.tooltip = 'IRIS Language Server stopped';
        statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground'
        );
        break;
      case 2: // Starting
        statusBarItem.text = '$(loading~spin) IRIS';
        statusBarItem.tooltip = 'IRIS Language Server starting...';
        statusBarItem.backgroundColor = undefined;
        break;
      case 3: // Running
        statusBarItem.text = '$(check) IRIS';
        statusBarItem.tooltip = 'IRIS Language Server running';
        statusBarItem.backgroundColor = undefined;
        break;
    }
  });

  // Start the client
  client.start().catch((error) => {
    statusBarItem.text = '$(error) IRIS';
    statusBarItem.tooltip = `IRIS Language Server error: ${error.message}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    vscode.window.showErrorMessage(
      `Failed to start IRIS Language Server: ${error.message}`
    );
  });

  context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
