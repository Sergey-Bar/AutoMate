import Swagger from '@fastify/swagger';
import SwaggerUI from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export async function registerSwaggerPlugin(app: FastifyInstance) {
  await app.register(Swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Automate API',
        description: 'Self-hosted Playwright QA Dashboard — REST API documentation',
        version: '0.1.0',
      },
      tags: [
        { name: 'runs', description: 'Test run management' },
        { name: 'tests', description: 'Test results and details' },
        { name: 'analytics', description: 'Analytics and trends' },
        { name: 'config', description: 'Playwright configuration' },
        { name: 'settings', description: 'Application settings' },
        { name: 'integrations', description: 'Webhook and notification integrations' },
        { name: 'auth', description: 'API key authentication' },
        { name: 'system', description: 'Health checks and system status' },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key generated from Settings → Authentication',
          },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  });

  await app.register(SwaggerUI, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      filter: true,
    },
  });
}
