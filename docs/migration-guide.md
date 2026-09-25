# Migration Guide: v1 to v2 (Unified Platform)

This guide outlines the steps required to migrate from the standalone Dashboard and AutoMate installations to the unified platform.

## 1. Database Migration

The platform has moved from SQLite to PostgreSQL 16.

1. Install PostgreSQL 16.
2. Create a new database for the platform.
3. Use the provided migration script to port legacy data:
   `pnpm --filter @automate/db run db:migrate` (apply the Postgres schema), then `pnpm --filter @automate/migrate-cli build && pnpm --filter @automate/migrate-cli exec migrate` (import legacy SQLite data)
4. Verify data integrity in the new Postgres instance.

## 2. Environment Variables

Update your `.env` files to reflect the new unified structure.

### Server
- Rename `SQLITE_PATH` to `DATABASE_URL` (format: `postgres://user:password@localhost:5432/dbname`).
- Add `AUTH_SECRET` for session cookie signing.
- Update `OLLAMA_BASE_URL` if using external AI providers.

### Web
- Update `VITE_API_URL` to point to the unified API (default: `http://localhost:3000`).

## 3. Route Changes

All API endpoints are now prefixed with `/api/v1`.

- Old: `/runs`, `/conversations`
- New: `/api/v1/runs`, `/api/v1/conversations`

Ensure any custom scripts or external integrations are updated to use the new base path.

## 4. Reporter Configuration

If you use `@automate/reporter` in your Playwright tests, update the configuration.

```typescript
// playwright.config.ts
export default {
  reporter: [
    ['@automate/reporter', {
      server: 'http://localhost:3000',
      apiKey: process.env.AUTOMATE_API_KEY,
    }],
  ],
};
```

The reporter now requires an API key for authentication. Generate this in the Dashboard settings.
