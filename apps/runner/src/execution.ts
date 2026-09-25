export interface ExecutionContext {
  jobId: string;
  imageDigest: string;
  inputDirectory: string;
  outputDirectory: string;
  deadlineMs: number;
  signal: AbortSignal;
}

export interface ExecutionResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  resultPath: string;
  artifacts: Array<{ path: string; digest: string; bytes: number }>;
}

export interface ExecutionProvider {
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
