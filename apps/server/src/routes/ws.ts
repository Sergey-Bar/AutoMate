import type { FastifyInstance } from 'fastify';
import type { EventHub } from '../services/event-hub.js';

export interface WsRouteDeps {
  eventHub: EventHub;
}

export async function wsRoutes(app: FastifyInstance, opts: WsRouteDeps): Promise<void> {
  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = opts.eventHub.subscribe((event) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(event));
      }
    });

    socket.on('error', (err: Error) => {
      app.log.warn({ err }, '[ws] WebSocket client error');
    });
    socket.on('close', () => unsubscribe());
  });
}
