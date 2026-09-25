export interface DashboardConfig {
  baseUrl: string;
  apiKey?: string;
}

export function getConfig(): DashboardConfig {
  return {
    baseUrl: process.env.AUTOMATE_DASHBOARD_URL ?? 'http://localhost:4000',
    apiKey: process.env.AUTOMATE_DASHBOARD_API_KEY,
  };
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const config = getConfig();
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  };

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Dashboard API error (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}
