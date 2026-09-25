import { createServer, type Server } from 'node:http';

export interface HealthServerOptions {
  host: string;
  port: number;
  service: string;
  version: string;
  isReady: () => boolean | Promise<boolean>;
}

export class HealthServer {
  private server: Server | undefined;
  private boundPort: number | undefined;

  constructor(private readonly options: HealthServerOptions) {}

  async listen(): Promise<number> {
    if (this.server) return this.boundPort ?? this.options.port;
    this.server = createServer((request, response) => {
      const path = request.url?.split('?', 1)[0];
      if (path === '/health') {
        this.json(response, this.server ? 200 : 503, {
          status: this.server ? 'healthy' : 'starting',
          service: this.options.service,
          version: this.options.version,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (path === '/ready') {
        void this.readiness(response);
        return;
      }
      this.json(response, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      const server = this.server;
      if (!server) {
        rejectListen(new Error('Health server was not created'));
        return;
      }
      server.once('error', rejectListen);
      server.listen(this.options.port, this.options.host, () => {
        server.off('error', rejectListen);
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : this.options.port;
        resolveListen();
      });
    });
    return this.boundPort ?? this.options.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.boundPort = undefined;
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }

  private async readiness(response: import('node:http').ServerResponse): Promise<void> {
    let ready = false;
    try {
      ready = await this.options.isReady();
    } catch {
      ready = false;
    }
    this.json(response, ready ? 200 : 503, {
      status: ready ? 'ready' : 'not_ready',
      service: this.options.service,
      version: this.options.version,
      timestamp: new Date().toISOString(),
    });
  }

  private json(
    response: import('node:http').ServerResponse,
    status: number,
    body: Record<string, unknown>,
  ): void {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  }
}
