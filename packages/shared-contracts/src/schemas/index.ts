import triggerRunRequestSchema from './trigger-run-request.schema.json' assert { type: 'json' };
import triggerRunResponseSchema from './trigger-run-response.schema.json' assert { type: 'json' };
import runResultCallbackSchema from './run-result-callback.schema.json' assert { type: 'json' };
import serviceHealthStatusSchema from './service-health-status.schema.json' assert { type: 'json' };

export {
  triggerRunRequestSchema,
  triggerRunResponseSchema,
  runResultCallbackSchema,
  serviceHealthStatusSchema,
};

// Zod v4 schemas — canonical validation source for TypeScript consumers
export * from './zod.js';

// Domain schemas — expanded Automate contract surface
export * from './auth.js';
export * from './ai.js';
export * from './conversations.js';
export * from './connectors.js';
export * from './test-results.js';
export * from './reporter-events.js';
export * from './realtime-events.js';
export * from './agents.js';
