export interface RunnerClientOptions {
  baseUrl: string;
  credential: string;
  fetchImpl?: typeof fetch;
}

export class RunnerClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: RunnerClientOptions) {
    this.fetcher = options.fetchImpl ?? fetch;
  }

  async enroll(enrollmentToken: string): Promise<{ credential: string; runnerId: string }> {
    const response = await this.fetcher(`${this.options.baseUrl}/api/v1/runner/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken }),
    });
    if (!response.ok) throw new Error(`Runner enrollment failed: ${response.status}`);
    return response.json() as Promise<{ credential: string; runnerId: string }>;
  }

  async sync(body: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.options.baseUrl}/api/v1/runner/v1/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Runner sync failed: ${response.status}`);
    return response.json();
  }
}
