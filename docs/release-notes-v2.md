# Release Notes - v2.0.0 (Unified Platform)

This release marks the unification of Dashboard and AutoMate into a single, cohesive QA orchestration platform.

## Pillars

### 1. Dashboard
- Unified view for test runs, suites, and traces.
- Improved performance for large test suites.
- Real-time updates via WebSockets.

### 2. AutoMate
- AI-native QA orchestration with local LLM support.
- Native integration with Ollama for privacy-first AI.
- Advanced connector system for GitHub, Jira, and Slack.

### 3. Webwright
- Integrated browser automation sidecar.
- Real-time browser state inspection.
- Recorded interaction playback within the dashboard.

### 4. Observability
- Detailed trace analysis for every test run.
- Resource usage monitoring for automation agents.
- Error logs correlated with browser screenshots and traces.

### 5. Collaboration
- Shared vault for team-wide secret management.
- Audit logs for all AI-generated actions.
- Team-based workspace isolation.

### 6. AI Authoring
- AI-assisted test generation from natural language.
- Automatic self-healing for brittle selectors.
- Intelligent test data generation.

## Breaking Changes

### Infrastructure
- Database: Migrated from SQLite to PostgreSQL 16 for better concurrency and scaling.
- Runtime: Node.js 22+ is now required.

### Authentication
- Transitioned to API key login with signed httpOnly session cookies.
- Legacy token-based authentication is deprecated.

### Networking
- Unified API routes under a single base path.
- Default ports changed: API now runs on 3000, Web on 5173.
