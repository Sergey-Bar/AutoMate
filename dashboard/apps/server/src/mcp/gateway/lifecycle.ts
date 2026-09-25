export interface ProcessHandle {
  serverId: string;
  pid: number;
  kill: () => Promise<void>;
}

export interface ProcessStatus {
  serverId: string;
  pid: number;
  running: boolean;
}

export class McpProcessLifecycle {
  private readonly handles = new Map<string, ProcessHandle>();

  registerHandle(handle: ProcessHandle): void {
    this.handles.set(handle.serverId, handle);
  }

  isRunning(serverId: string): boolean {
    return this.handles.has(serverId);
  }

  getHandle(serverId: string): ProcessHandle | undefined {
    return this.handles.get(serverId);
  }

  async shutdown(serverId: string): Promise<void> {
    const handle = this.handles.get(serverId);
    if (!handle) return;

    try {
      await handle.kill();
    } catch (err) {
      process.stderr.write(`Failed to kill MCP server "${serverId}": ${(err as Error).message}\n`);
    }
    this.handles.delete(serverId);
  }

  async shutdownAll(): Promise<void> {
    const ids = Array.from(this.handles.keys());
    await Promise.allSettled(ids.map((id) => this.shutdown(id)));
  }

  getStatus(): ProcessStatus[] {
    return Array.from(this.handles.values()).map((handle) => ({
      serverId: handle.serverId,
      pid: handle.pid,
      running: true,
    }));
  }
}
