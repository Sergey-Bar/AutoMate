import { z } from 'zod';
import { DEFAULT_QUERY_LIMIT } from '../constants.js';

export const MCP_CONTRACT_VERSION = '1.1.0' as const;

export const MCP_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
} as const);

type _MCPErrorCode = (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES];

type JsonSchema = Record<string, unknown>;

export interface MCPToolContract<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny> {
  inputSchema: TInput;
  outputSchema: TOutput;
  inputSchemaJson: JsonSchema;
  outputSchemaJson: JsonSchema;
}

const runSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  startedAt: z.string().min(1),
  duration: z.number().min(0),
  totalTests: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
});

const runSummaryJson = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'status', 'startedAt', 'duration', 'totalTests', 'passed', 'failed'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    status: { type: 'string', minLength: 1 },
    startedAt: { type: 'string', minLength: 1 },
    duration: { type: 'number', minimum: 0 },
    totalTests: { type: 'integer', minimum: 0 },
    passed: { type: 'integer', minimum: 0 },
    failed: { type: 'integer', minimum: 0 },
  },
} as const;

const runDetailsSchema = runSummarySchema.extend({
  skipped: z.number().int().min(0),
  suites: z.number().int().min(0),
  environment: z.string().min(1).optional(),
});

const runDetailsJson = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'status', 'startedAt', 'duration', 'totalTests', 'passed', 'failed', 'skipped', 'suites'],
  properties: {
    ...runSummaryJson.properties,
    skipped: { type: 'integer', minimum: 0 },
    suites: { type: 'integer', minimum: 0 },
    environment: { type: 'string', minLength: 1 },
  },
} as const;

export const MCP_V1_TOOLS = Object.freeze({
  'runs.list_recent': {
    inputSchema: z.object({
      workspaceId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    }),
    outputSchema: z.object({
      runs: z.array(runSummarySchema),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['runs'],
      properties: {
        runs: { type: 'array', items: runSummaryJson },
      },
    },
  },
  'runs.get_summary_by_id': {
    inputSchema: z.object({
      runId: z.string().min(1),
    }),
    outputSchema: z.object({
      run: runDetailsSchema,
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['run'],
      properties: {
        run: runDetailsJson,
      },
    },
  },
  'tests.get_failures_by_run': {
    inputSchema: z.object({
      runId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    }),
    outputSchema: z.object({
      failures: z.array(z.object({
        testId: z.string().min(1),
        name: z.string().min(1),
        suiteName: z.string().min(1),
        errorMessage: z.string().min(1),
        errorStack: z.string().min(1).optional(),
        duration: z.number().min(0),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['failures'],
      properties: {
        failures: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['testId', 'name', 'suiteName', 'errorMessage', 'duration'],
            properties: {
              testId: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              suiteName: { type: 'string', minLength: 1 },
              errorMessage: { type: 'string', minLength: 1 },
              errorStack: { type: 'string', minLength: 1 },
              duration: { type: 'number', minimum: 0 },
            },
          },
        },
      },
    },
  },
  'analytics.get_pass_rate': {
    inputSchema: z.object({
      workspaceId: z.string().min(1).optional(),
      days: z.number().int().min(1).max(365).default(30).optional(),
    }),
    outputSchema: z.object({
      passRate: z.number().min(0).max(1),
      totalRuns: z.number().int().min(0),
      period: z.object({
        from: z.string().min(1),
        to: z.string().min(1),
      }),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1 },
        days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['passRate', 'totalRuns', 'period'],
      properties: {
        passRate: { type: 'number', minimum: 0, maximum: 1 },
        totalRuns: { type: 'integer', minimum: 0 },
        period: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
  'analytics.get_duration_trend': {
    inputSchema: z.object({
      workspaceId: z.string().min(1).optional(),
      days: z.number().int().min(1).max(365).default(30).optional(),
    }),
    outputSchema: z.object({
      trend: z.array(z.object({
        date: z.string().min(1),
        avgDuration: z.number().min(0),
        runCount: z.number().int().min(0),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1 },
        days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['trend'],
      properties: {
        trend: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'avgDuration', 'runCount'],
            properties: {
              date: { type: 'string', minLength: 1 },
              avgDuration: { type: 'number', minimum: 0 },
              runCount: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
  'tests.get_error_clusters': {
    inputSchema: z.object({
      runId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    }),
    outputSchema: z.object({
      clusters: z.array(z.object({
        clusterId: z.string().min(1),
        pattern: z.string().min(1),
        count: z.number().int().min(1),
        severity: z.string().min(1),
        examples: z.array(z.string().min(1)),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        runId: { type: 'string', minLength: 1 },
        workspaceId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['clusters'],
      properties: {
        clusters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['clusterId', 'pattern', 'count', 'severity', 'examples'],
            properties: {
              clusterId: { type: 'string', minLength: 1 },
              pattern: { type: 'string', minLength: 1 },
              count: { type: 'integer', minimum: 1 },
              severity: { type: 'string', minLength: 1 },
              examples: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
  'tests.get_predictive_candidates': {
    inputSchema: z.object({
      changedFiles: z.array(z.string().min(1)).min(1),
      workspaceId: z.string().min(1).optional(),
    }),
    outputSchema: z.object({
      candidates: z.array(z.object({
        testId: z.string().min(1),
        testName: z.string().min(1),
        score: z.number().min(0).max(1),
        reason: z.string().min(1),
      })),
      mode: z.enum(['full', 'static_only']),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['changedFiles'],
      properties: {
        changedFiles: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        workspaceId: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['candidates', 'mode'],
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['testId', 'testName', 'score', 'reason'],
            properties: {
              testId: { type: 'string', minLength: 1 },
              testName: { type: 'string', minLength: 1 },
              score: { type: 'number', minimum: 0, maximum: 1 },
              reason: { type: 'string', minLength: 1 },
            },
          },
        },
        mode: { type: 'string', enum: ['full', 'static_only'] },
      },
    },
  },
  'quarantine.list_quarantined': {
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(DEFAULT_QUERY_LIMIT).optional(),
    }),
    outputSchema: z.object({
      tests: z.array(z.object({
        id: z.string().min(1),
        testTitle: z.string().min(1),
        testFile: z.string().min(1).optional(),
        reason: z.string().min(1),
        quarantinedAt: z.string().min(1),
        quarantinedBy: z.string().min(1),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: DEFAULT_QUERY_LIMIT },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['tests'],
      properties: {
        tests: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'testTitle', 'reason', 'quarantinedAt', 'quarantinedBy'],
            properties: {
              id: { type: 'string', minLength: 1 },
              testTitle: { type: 'string', minLength: 1 },
              testFile: { type: 'string', minLength: 1 },
              reason: { type: 'string', minLength: 1 },
              quarantinedAt: { type: 'string', minLength: 1 },
              quarantinedBy: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  },
  'quarantine.get_details': {
    inputSchema: z.object({
      testTitle: z.string().min(1),
    }),
    outputSchema: z.object({
      quarantine: z.object({
        id: z.string().min(1),
        testTitle: z.string().min(1),
        testFile: z.string().min(1).optional(),
        reason: z.string().min(1),
        quarantinedAt: z.string().min(1),
        quarantinedBy: z.string().min(1),
      }).nullable(),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['testTitle'],
      properties: {
        testTitle: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['quarantine'],
      properties: {
        quarantine: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['id', 'testTitle', 'reason', 'quarantinedAt', 'quarantinedBy'],
          properties: {
            id: { type: 'string', minLength: 1 },
            testTitle: { type: 'string', minLength: 1 },
            testFile: { type: 'string', minLength: 1 },
            reason: { type: 'string', minLength: 1 },
            quarantinedAt: { type: 'string', minLength: 1 },
            quarantinedBy: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
  'runs.compare': {
    inputSchema: z.object({
      baseRunId: z.string().min(1),
      headRunId: z.string().min(1),
    }),
    outputSchema: z.object({
      newFailures: z.array(z.object({
        testId: z.string().min(1),
        testName: z.string().min(1),
        errorMessage: z.string().min(1),
      })),
      fixed: z.array(z.object({
        testId: z.string().min(1),
        testName: z.string().min(1),
      })),
      regressions: z.array(z.object({
        testId: z.string().min(1),
        testName: z.string().min(1),
        baseStatus: z.string().min(1),
        headStatus: z.string().min(1),
      })),
      summary: z.object({
        baseTotal: z.number().int().min(0),
        headTotal: z.number().int().min(0),
        basePassed: z.number().int().min(0),
        headPassed: z.number().int().min(0),
      }),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['baseRunId', 'headRunId'],
      properties: {
        baseRunId: { type: 'string', minLength: 1 },
        headRunId: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['newFailures', 'fixed', 'regressions', 'summary'],
      properties: {
        newFailures: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['testId', 'testName', 'errorMessage'],
            properties: {
              testId: { type: 'string', minLength: 1 },
              testName: { type: 'string', minLength: 1 },
              errorMessage: { type: 'string', minLength: 1 },
            },
          },
        },
        fixed: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['testId', 'testName'],
            properties: {
              testId: { type: 'string', minLength: 1 },
              testName: { type: 'string', minLength: 1 },
            },
          },
        },
        regressions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['testId', 'testName', 'baseStatus', 'headStatus'],
            properties: {
              testId: { type: 'string', minLength: 1 },
              testName: { type: 'string', minLength: 1 },
              baseStatus: { type: 'string', minLength: 1 },
              headStatus: { type: 'string', minLength: 1 },
            },
          },
        },
        summary: {
          type: 'object',
          additionalProperties: false,
          required: ['baseTotal', 'headTotal', 'basePassed', 'headPassed'],
          properties: {
            baseTotal: { type: 'integer', minimum: 0 },
            headTotal: { type: 'integer', minimum: 0 },
            basePassed: { type: 'integer', minimum: 0 },
            headPassed: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  },
  'tests.get_flaky': {
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14).optional(),
      minFlipCount: z.number().int().min(2).max(100).default(3).optional(),
    }),
    outputSchema: z.object({
      flakyTests: z.array(z.object({
        stableId: z.string().min(1),
        testName: z.string().min(1),
        testFile: z.string().min(1),
        flakyCount: z.number().int().min(1),
        totalRuns: z.number().int().min(1),
        lastSeen: z.string().min(1),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 90, default: 14 },
        minFlipCount: { type: 'integer', minimum: 2, maximum: 100, default: 3 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['flakyTests'],
      properties: {
        flakyTests: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['stableId', 'testName', 'testFile', 'flakyCount', 'totalRuns', 'lastSeen'],
            properties: {
              stableId: { type: 'string', minLength: 1 },
              testName: { type: 'string', minLength: 1 },
              testFile: { type: 'string', minLength: 1 },
              flakyCount: { type: 'integer', minimum: 1 },
              totalRuns: { type: 'integer', minimum: 1 },
              lastSeen: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  },
  'schedules.list': {
    inputSchema: z.object({}),
    outputSchema: z.object({
      schedules: z.array(z.object({
        id: z.string().min(1),
        cronExpr: z.string().min(1),
        enabled: z.boolean(),
        lastRunAt: z.string().min(1).optional(),
        createdAt: z.string().min(1),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['schedules'],
      properties: {
        schedules: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'cronExpr', 'enabled', 'createdAt'],
            properties: {
              id: { type: 'string', minLength: 1 },
              cronExpr: { type: 'string', minLength: 1 },
              enabled: { type: 'boolean' },
              lastRunAt: { type: 'string', minLength: 1 },
              createdAt: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  },
  'schedules.get_by_id': {
    inputSchema: z.object({
      scheduleId: z.string().min(1),
    }),
    outputSchema: z.object({
      schedule: z.object({
        id: z.string().min(1),
        cronExpr: z.string().min(1),
        runOptions: z.string().optional(),
        enabled: z.boolean(),
        lastRunAt: z.string().min(1).optional(),
        createdAt: z.string().min(1),
      }).nullable(),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['scheduleId'],
      properties: {
        scheduleId: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['schedule'],
      properties: {
        schedule: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['id', 'cronExpr', 'enabled', 'createdAt'],
          properties: {
            id: { type: 'string', minLength: 1 },
            cronExpr: { type: 'string', minLength: 1 },
            runOptions: { type: 'string' },
            enabled: { type: 'boolean' },
            lastRunAt: { type: 'string', minLength: 1 },
            createdAt: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
  'integrations.get_status': {
    inputSchema: z.object({}),
    outputSchema: z.object({
      integrations: z.array(z.object({
        type: z.string().min(1),
        configured: z.boolean(),
      })),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['integrations'],
      properties: {
        integrations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'configured'],
            properties: {
              type: { type: 'string', minLength: 1 },
              configured: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
  'runs.get_gate_status': {
    inputSchema: z.object({
      runId: z.string().min(1),
    }),
    outputSchema: z.object({
      gateStatus: z.enum(['passed', 'failed', 'skipped']),
      passed: z.boolean(),
      passRate: z.number().min(0).max(100),
      threshold: z.number().min(0).max(100),
      failedTests: z.number().int().min(0),
      totalTests: z.number().int().min(0),
    }),
    inputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string', minLength: 1 },
      },
    },
    outputSchemaJson: {
      type: 'object',
      additionalProperties: false,
      required: ['gateStatus', 'passed', 'passRate', 'threshold', 'failedTests', 'totalTests'],
      properties: {
        gateStatus: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
        passed: { type: 'boolean' },
        passRate: { type: 'number', minimum: 0, maximum: 100 },
        threshold: { type: 'number', minimum: 0, maximum: 100 },
        failedTests: { type: 'integer', minimum: 0 },
        totalTests: { type: 'integer', minimum: 0 },
      },
    },
  },
} as const satisfies Record<string, MCPToolContract<z.ZodTypeAny, z.ZodTypeAny>>);

export type MCPV1ToolName = keyof typeof MCP_V1_TOOLS;

export const MCP_V1_TOOL_NAMES = Object.freeze(Object.keys(MCP_V1_TOOLS) as MCPV1ToolName[]);

export function getMcpV1ContractSnapshot() {
  const tools = Object.fromEntries(
    Object.entries(MCP_V1_TOOLS).map(([toolName, contract]) => [
      toolName,
      {
        inputSchema: contract.inputSchemaJson,
        outputSchema: contract.outputSchemaJson,
      },
    ]),
  );

  return {
    version: MCP_CONTRACT_VERSION,
    tools,
    errorCodes: Object.values(MCP_ERROR_CODES),
  };
}

type _MCPV1ContractSnapshot = ReturnType<typeof getMcpV1ContractSnapshot>;
