// @automate/connector-sdk
// MCP connector SDK — base classes and types for building connectors
export const SDK_VERSION = '0.1.0';

export * from './types.js';
export { BaseConnector } from './base-connector.js';
export * from './errors.js';
export * from './resilience.js';
export * from './rate-limiter.js';
export * from './cache.js';
