import {
  DeliveryReportSchema,
  DeliverySourceSchema,
  DeliverySyncQueuedSchema,
  PortfolioDeliverySchema,
  type DeliveryReport,
  type DeliverySource,
  type DeliverySourceBody,
  type DeliverySyncQueued,
  type PortfolioDelivery,
} from '@automate/shared-contracts';
import { createJsonTransport, projectPath, queryString } from './json-transport.js';

/** Delivery performance: DORA, pull-request flow, the GitHub source and its sync. */
export interface DeliveryClient {
  getReport(projectId: string, days: number): Promise<DeliveryReport>;
  getSource(projectId: string): Promise<DeliverySource>;
  /** Operator only. */
  setSource(projectId: string, body: DeliverySourceBody): Promise<DeliverySource>;
  /** Operator only. Answers 202: the sync is queued, and reports through the source. */
  sync(projectId: string): Promise<DeliverySyncQueued>;
  getPortfolio(days: number): Promise<PortfolioDelivery>;
}

export function createDeliveryClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): DeliveryClient {
  const http = createJsonTransport(baseUrl, fetchImpl);
  const days = (value: number) => queryString({ days: Math.trunc(value) });
  return {
    getReport: (projectId, window) =>
      http.get(`${projectPath(projectId)}/delivery${days(window)}`, DeliveryReportSchema),
    getSource: (projectId) =>
      http.get(`${projectPath(projectId)}/delivery/source`, DeliverySourceSchema),
    setSource: (projectId, body) =>
      http.put(`${projectPath(projectId)}/delivery/source`, body, DeliverySourceSchema),
    sync: (projectId) =>
      http.post(`${projectPath(projectId)}/delivery/sync`, {}, DeliverySyncQueuedSchema),
    getPortfolio: (window) =>
      http.get(`/api/v1/portfolio/delivery${days(window)}`, PortfolioDeliverySchema),
  };
}
