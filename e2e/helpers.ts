/**
 * Shared E2E helpers — Automate
 * ==============================
 * Centralised utilities used across all Playwright spec files.
 * Import what you need:
 *
 *   import { API } from './helpers.js';
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Automate API server base URL (Fastify). */
export const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/** Automate web client base URL (Vite dev server). */
export const BASE = process.env.WEB_URL ?? 'http://localhost:5173';

/** WebSocket URL for real-time events. */
export const WS_URL = process.env.WS_URL ?? 'ws://localhost:4000/ws';
