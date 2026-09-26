# API Versioning Strategy — Decision Document

**Status:** Proposed
**Last Updated:** 2026-04-16
**Products:** Automate, Automate

## Context

Currently, both Automate and Automate APIs are unversioned. They serve several critical consumers including web clients, CLI tools, and a reporter package. As the ecosystem matures, we need a formal versioning strategy to prevent breaking changes from disrupting users while allowing rapid iteration.

### API Consumers

- **Automate Web Client:** React SPA communicating with the server on `:3000`.
- **Dashboard Web Client:** React SPA communicating with the server on `:4000`.
- **Reporter Package:** `@automate/reporter` npm package used in Playwright tests to stream results to the dashboard on `:4001`.
- **CLI Tool:** `@automate/cli` setup wizard.
- **Webhook Integrations:** Outgoing notifications to Slack, Jira, and GitHub.
- **MCP Server:** Model Context Protocol server for AI tool integration in the Dashboard.

## Decision: Header-Based Versioning (MVP)

For the MVP, we'll adopt **header-based versioning** using the `X-API-Version` header.

### Rationale

- **Zero URL disruption:** Existing clients can continue using current endpoints without path changes.
- **Granular control:** Headers allow for versioning specific requests without bloating the URL space.
- **Fastify compatibility:** Header-based versioning is trivial to implement via Fastify hooks and doesn't require complex route prefixing for the initial rollout.
- **Roadmap alignment:** This approach matches the specified requirement for a lightweight MVP versioning mechanism.

## Specification

### Versioning Scheme

We'll use **Semantic Versioning (SemVer)** for API versions:

- `1.0.0` (Major.Minor.Patch)
- Clients should generally request a major version (e.g., `1`) or a specific point release if needed.

### Request Header

Clients SHOULD include the following header:
`X-API-Version: 1.0.0`

If omitted, the server will default to the latest stable version (currently `1.0.0`).

### Response Header

The server MUST include the `X-API-Version` header in all responses to indicate which version processed the request.

## MVP Implementation Plan (Fastify)

To implement this across both products, we'll use a `preHandler` or `onSend` hook in Fastify.

### Step 1: Add Version Constant

Each server will define its current API version in a central constants file.

```typescript
// src/constants.ts
export const API_VERSION = '1.0.0';
```

### Step 2: Global Version Header Hook

Register a hook to inject the version header into every response.

```typescript
// src/plugins/versioning.ts
import { FastifyInstance } from 'fastify';
import { API_VERSION } from '../constants.js';

export async function registerVersioning(app: FastifyInstance) {
  app.addHook('onSend', async (_request, reply, _payload) => {
    reply.header('X-API-Version', API_VERSION);
  });
}
```

### Step 3: Register Plugin

Register this plugin early in the `buildServer` (Automate) or `bootstrap` (Dashboard) functions.

## Breaking Change Policy

### What Constitutes a Breaking Change?

- Removing an endpoint.
- Renaming a required field in a request body.
- Changing the data type of a response field.
- Removing a field from a response that consumers depend on.
- Changing HTTP status codes for specific error conditions (e.g., `400` to `403`).

### Deprecation Timeline

- **Major Versions:** Supported for at least 6 months after a new major version is released.
- **Deprecation Warnings:** Responses for deprecated versions will include a `Warning` header (RFC 7234) and log a server-side warning.

## Future Path: URL-Prefix Versioning

When we reach a point where multiple major versions must be maintained simultaneously for extended periods, or when structural changes make header-based routing too complex, we will transition to URL-prefix versioning (`/api/v1/`).

This transition will be handled by:

1. Aliasing `/api/v1/*` to the existing root routes.
2. Introducing `/api/v2/*` for the new implementation.
3. Maintaining the header-based check as a secondary validation mechanism.
