#!/usr/bin/env node

function printUsage(): void {
  console.log('Usage: Automate <command>\n');
  console.log('Commands:');
  console.log('  init      Set up the Automate reporter in your project');
  console.log('  mcp       Manage MCP servers (list, status, start, stop)');
  console.log('  status    Show dashboard health and MCP server status');
  console.log('  help      Show this help message');
}

const command = process.argv[2];

switch (command) {
  case 'init':
    await import('./commands/init.js').then((m) => m.run());
    break;
  case 'mcp':
    await import('./commands/mcp.js').then((m) => m.run(process.argv.slice(3)));
    break;
  case 'status':
    await import('./commands/status.js').then((m) => m.run());
    break;
  case 'help':
  case '--help':
  case '-h':
    printUsage();
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
