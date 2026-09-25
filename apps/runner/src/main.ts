import { pathToFileURL } from 'node:url';
import { RunnerApiClient } from './client.js';
import { parseRunnerConfig } from './config.js';
import { PlaywrightExecutionAdapter } from './execution.js';
import { HealthServer } from './health-server.js';
import { RunnerService } from './runner-service.js';

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const config = parseRunnerConfig(env);
  let token = config.credential ?? '';
  let runnerId = config.instanceId;
  let client = new RunnerApiClient({
    baseUrl: config.apiUrl,
    runnerId,
    token,
    registrationSecret: config.registrationSecret,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  const registrationRequest = {
    protocolVersion: '1' as const,
    runnerId: config.instanceId,
    name: config.name,
    version: config.version,
    os: process.platform,
    arch: process.arch,
    capabilities: config.capabilities,
    labels: config.labels,
    slots: Math.min(config.slots, config.maxConcurrentJobs),
  };
  if (!config.credential) {
    const registration = await client.register(registrationRequest);
    runnerId = registration.runnerId;
    token = registration.token;
    client = new RunnerApiClient({
      baseUrl: config.apiUrl,
      runnerId,
      token,
      registrationSecret: config.registrationSecret,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  }

  const executor = new PlaywrightExecutionAdapter({
    projectRoot: config.playwrightProjectRoot,
    allowedProjects: config.allowedPlaywrightProjects,
    allowedTargetUrls: config.allowedTargetUrls,
    workspaceRoot: config.workspaceRoot,
    artifactMaxBytes: config.artifactMaxBytes,
    logMaxBytes: config.logMaxBytes,
    redactions: config.redactions,
  });
  const service = new RunnerService({
    runnerId,
    capabilities: config.capabilities,
    labels: config.labels,
    slots: Math.min(config.slots, config.maxConcurrentJobs),
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    redactions: [
      ...config.redactions,
      config.registrationSecret ?? '',
      config.credential ?? '',
      token,
    ],
    protocol: client,
    executor,
  });
  const health = new HealthServer({
    host: config.healthHost,
    port: config.healthPort,
    service: 'automate-runner',
    version: config.version,
    isReady: () => service.isReady(),
  });
  const port = await health.listen();
  console.info(`automate-runner listening on http://${config.healthHost}:${port}`);

  const lifecycle = new AbortController();
  const shutdown = (): void => {
    lifecycle.abort();
    service.stop();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const registrationRefresh = config.credential
    ? undefined
    : setInterval(() => {
        void client.register(registrationRequest).catch((error: unknown) => {
          console.error(
            `automate-runner registration refresh failed (${error instanceof Error ? error.name : 'REGISTRATION_ERROR'})`,
          );
        });
      }, 10 * 60_000);
  try {
    await service.run(lifecycle.signal);
  } finally {
    if (registrationRefresh) clearInterval(registrationRefresh);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await health.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.name : 'RUNNER_START_FAILED';
    console.error(`automate-runner failed (${code})`);
    process.exitCode = 1;
  });
}
