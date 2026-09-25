import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwaggerPlugin(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Automate API',
        version: '1.0.0',
        description: 'AI-native QA orchestration platform API',
      },
      servers: [{ url: '/' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
  });
}
