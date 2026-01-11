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

function startLanguageClient(context: vscode.ExtensionContext): void {
  // Path to the language server
  // In development, use the workspace path
  // In production, use the bundled server
  const serverModule = context.asAbsolutePath(
    path.join('..', 'ls', 'dist', 'server.js')
  );

  // Server options
  const serverOptions: ServerOptions = {
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
