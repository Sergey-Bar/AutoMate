export interface WebwrightTask {
  id: string;
  url: string;
  actions: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  url: string;
  actions: string[];
}

export interface TaskStreamHandle {
  onMessage: (handler: (task: WebwrightTask) => void) => void;
  onError: (handler: (error: Event) => void) => void;
  close: () => void;
}

const BASE_URL = '/api/webwright';

export async function createTask(url: string, actions: string[]): Promise<WebwrightTask> {
  const payload: CreateTaskPayload = { url, actions };
  const response = await fetch(`${BASE_URL}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<WebwrightTask>;
}

export async function getTask(id: string): Promise<WebwrightTask> {
  const response = await fetch(`${BASE_URL}/tasks/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to get task: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<WebwrightTask>;
}

export function connectTaskStream(id: string): TaskStreamHandle {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/webwright/tasks/${id}`;
  const ws = new WebSocket(wsUrl);

  let messageHandler: ((task: WebwrightTask) => void) | null = null;
  let errorHandler: ((error: Event) => void) | null = null;

  ws.onmessage = (event: MessageEvent) => {
    if (messageHandler) {
      try {
        const task = JSON.parse(event.data as string) as WebwrightTask;
        messageHandler(task);
      } catch {
        // ignore malformed messages
      }
    }
  };

  ws.onerror = (event: Event) => {
    if (errorHandler) {
      errorHandler(event);
    }
  };

  return {
    onMessage(handler) {
      messageHandler = handler;
    },
    onError(handler) {
      errorHandler = handler;
    },
    close() {
      ws.close();
    },
  };
}
