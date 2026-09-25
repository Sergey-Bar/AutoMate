export interface HubEvent {
  type: string;
  payload: Record<string, unknown>;
}

export type Logger = {
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export class EventHub {
  private listeners = new Set<(event: HubEvent) => void>();
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  subscribe(listener: (event: HubEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  broadcast(event: HubEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        if (this.logger) {
          this.logger.error(
            { err, eventType: event.type },
            'EventHub listener threw during broadcast',
          );
        } else {
          // Ensure errors are never completely silent when no logger is configured
          const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
          process.stderr.write(`EventHub listener error (no logger configured): ${detail} eventType: ${event.type}\n`);
        }
      }
    }
  }
}
