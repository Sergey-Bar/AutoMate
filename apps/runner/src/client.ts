import { z } from 'zod/v4';
import {
  ArtifactDescriptorSchema,
  JobClaimSchema,
  JobEventBatchResponseSchema,
  JobEventBatchSchema,
  RunnerClaimRequestSchema,
  RunnerHeartbeatRequestSchema,
  RunnerHeartbeatSchema,
  RunnerRegistrationRequestSchema,
  RunnerRegistrationSchema,
  type ArtifactDescriptor,
  type ArtifactUpload,
  type EventApplyResult,
  type ExecutionEventInput,
  type JobClaim,
  type JobCompletion,
  type RunnerClaimRequest,
  type RunnerHeartbeat,
  type RunnerHeartbeatRequest,
  type RunnerRegistration,
  type RunnerRegistrationRequest,
  RunnerApiError,
} from './protocol.js';

const CompletionResponseSchema = z
  .object({
    accepted: z.boolean().optional(),
    duplicate: z.boolean().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export interface RunnerApiClientOptions {
  baseUrl: string;
  runnerId: string;
  token: string;
  registrationSecret?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface ArtifactBytesUpload extends Omit<
  ArtifactUpload,
  'contentBase64' | 'sizeBytes' | 'checksum'
> {
  bytes: Uint8Array;
  checksum: string;
}

export class RunnerApiClient {
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;
  private token: string;

  constructor(private readonly options: RunnerApiClientOptions) {
    this.fetcher = options.fetchImpl ?? fetch;
    this.token = options.token;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  }

  async register(
    request: RunnerRegistrationRequest,
    registrationSecret = this.options.registrationSecret,
  ): Promise<RunnerRegistration> {
    const parsedRequest = RunnerRegistrationRequestSchema.parse(request);
    if (!registrationSecret) throw new Error('Runner registration secret is required');
    const response = await this.request(
      '/api/v1/runners/register',
      {
        method: 'POST',
        headers: { 'x-runner-registration-secret': registrationSecret },
        body: JSON.stringify(parsedRequest),
      },
      RunnerRegistrationSchema,
    );
    this.options.runnerId = response.runnerId;
    this.token = response.token;
    return response;
  }

  async heartbeat(request: RunnerHeartbeatRequest): Promise<RunnerHeartbeat> {
    const body = RunnerHeartbeatRequestSchema.parse(request);
    return this.request(
      `/api/v1/runners/${encodeURIComponent(this.options.runnerId)}/heartbeat`,
      { method: 'POST', body: JSON.stringify(body) },
      RunnerHeartbeatSchema,
    );
  }

  async claim(request: Partial<RunnerClaimRequest> = {}): Promise<JobClaim | null> {
    const body = RunnerClaimRequestSchema.parse(request);
    const response = await this.send(
      `/api/v1/runners/${encodeURIComponent(this.options.runnerId)}/jobs/claim`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (response.status === 204) return null;
    return this.parseResponse(response, JobClaimSchema);
  }

  async sendEventBatch(
    jobId: string,
    leaseId: string,
    fencingToken: number,
    events: ExecutionEventInput[],
  ): Promise<{ results: EventApplyResult[] }> {
    const body = JobEventBatchSchema.parse({
      jobId,
      runId: events[0]?.runId,
      leaseId,
      fencingToken,
      events,
      sentAt: new Date().toISOString(),
    });
    return this.request(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/events`,
      { method: 'POST', body: JSON.stringify(body) },
      JobEventBatchResponseSchema,
    );
  }

  async uploadArtifact(jobId: string, upload: ArtifactBytesUpload): Promise<ArtifactDescriptor> {
    const body = {
      leaseId: upload.leaseId,
      fencingToken: upload.fencingToken,
      kind: upload.kind,
      name: upload.name,
      testId: upload.testId,
      contentType: upload.contentType,
      sizeBytes: upload.bytes.byteLength,
      checksum: upload.checksum,
      metadata: upload.metadata,
      contentBase64: Buffer.from(upload.bytes).toString('base64'),
    };
    return this.request(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/artifacts`,
      { method: 'POST', body: JSON.stringify(body) },
      ArtifactDescriptorSchema,
    );
  }

  async complete(
    jobId: string,
    completion: JobCompletion,
  ): Promise<z.infer<typeof CompletionResponseSchema>> {
    return this.request(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/complete`,
      { method: 'POST', body: JSON.stringify(completion) },
      CompletionResponseSchema,
    );
  }

  private async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    return this.parseResponse(await this.send(path, init), schema);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!response.ok) {
      let code = 'HTTP_ERROR';
      try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object') {
          const value = (body as Record<string, unknown>)['code'];
          if (typeof value === 'string') code = value;
        }
      } catch {
        code = response.statusText || 'HTTP_ERROR';
      }
      throw new RunnerApiError(response.status, code);
    }
    return response;
  }

  private async parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    const body: unknown = await response.json();
    return schema.parse(body);
  }
}
