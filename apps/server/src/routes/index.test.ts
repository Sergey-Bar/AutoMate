import { describe, expect, it } from 'vitest';
import * as routesIndex from './index.js';

describe('routes/index barrel', () => {
  it('re-exports chatRoutes from chat module', () => {
    expect(routesIndex.chatRoutes).toBeTypeOf('function');
  });

  it('re-exports toSseEvent from chat module', () => {
    expect(routesIndex.toSseEvent).toBeTypeOf('function');
  });

  it('re-exports modelConfigRoutes from model-config module', () => {
    expect(routesIndex.modelConfigRoutes).toBeTypeOf('function');
  });

  it('re-exports ModelConfigUpdateSchema from model-config module', () => {
    expect(routesIndex.ModelConfigUpdateSchema).toBeDefined();
  });
});
