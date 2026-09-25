# Secret Rotation Guide

This guide describes procedures for rotating secrets across Automate and Automate. Rotate secrets regularly to minimize the impact of leaks and maintain security.

## Quick Reference

| Secret Name | Product | Location | Frequency | Impact |
| :--- | :--- | :--- | :--- | :--- |
| `AUTOMATE_DASHBOARD_API_KEY` | Dashboard | `.automate/auth.json` | 90 days | High |
| `COOKIE_SECRET` | Dashboard | Environment Variable | 180 days | Medium |
| `REPORTER_SECRET` | Dashboard | Environment Variable | 90 days | Medium |
| `VAULT_PASSWORD` | Automate | Environment Variable / CLI | 90 days | Critical |
| `AUTOMATE_API_KEY` | Automate | Environment Variable | 90 days | High |

---

## Automate: API Key Rotation

The Dashboard API key controls web interface access.

### Procedure
1. Generate a new API key in **Settings > Access Control**.
2. Distribute the new key to users or automated systems.
3. Log out and log back in with the new key to verify.
4. Revoke the old key in the **Settings > Access Control** menu.

### Impact
Existing sessions stay valid until they expire. New logins require the new key immediately.

### Verification
Confirm the new key works for login. Ensure the revoked key no longer allows access.

---

## Automate: COOKIE_SECRET Rotation

The `COOKIE_SECRET` signs session cookies.

### Procedure
1. Generate a random 32-character string.
2. Update the `COOKIE_SECRET` environment variable.
3. Restart the Dashboard server.

### Impact
All users will be logged out. They must log in again to start a new session.

### Verification
Confirm the server starts without errors. Access the dashboard to verify the login prompt appears.

---

## Automate: REPORTER_SECRET Rotation

The `REPORTER_SECRET` secures the WebSocket connection for Playwright reporters.

### Procedure
1. Update the `REPORTER_SECRET` environment variable on the Dashboard server.
2. Restart the server.
3. Update the `AUTOMATE_DASHBOARD_API_KEY` in your Playwright CI configuration.
4. Run a test job to confirm results appear.

### Impact
Reporters using the old secret will fail to connect. Test results will not reach the dashboard until the CI configuration is updated.

### Verification
Check server logs for `[reporter] ws-reporter connected` messages.

---

## Automate: VAULT_PASSWORD Rotation

The `VAULT_PASSWORD` protects connector credentials. Changing it requires re-encrypting the vault.

### Procedure
1. Unlock the vault with the current password.
2. Document current credentials for all enabled connectors.
3. Update the `VAULT_PASSWORD` environment variable.
4. Restart the Automate server.
5. Log in, unlock with the new password, and re-save connector credentials.

### Impact
Automate cannot use connectors until you unlock the vault and re-save credentials. AI chat tools will fail during this window.

### Verification
Unlock the vault in the UI. Test a connector tool like "List Jira issues" to confirm it works.

---

## Automate: AUTOMATE_API_KEY Rotation

The `AUTOMATE_API_KEY` secures the Automate API.

### Procedure
1. Update the `AUTOMATE_API_KEY` environment variable.
2. Restart the Automate server.

### Impact
Scripts or integrations calling the API will fail until they use the new key.

### Verification
Call the `/health` endpoint or send a chat request using the new key.

---

## Container Secret Rotation

Use these steps for Docker deployments.

1. Update the `.env` file or secret store.
2. Force a restart of the containers:
   `docker compose up -d --force-recreate`
3. Check logs for authentication errors.
