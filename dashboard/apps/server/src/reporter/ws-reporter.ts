/**
 * ws-reporter.ts — Re-exports from @automate/reporter package
 * 
 * This file exists for backward compatibility. New consumers should
 * use the `@automate/reporter` package directly in playwright.config.ts.
 */
export { default } from '@automate/reporter';
export { WsReporter, extractPRMetadata } from '@automate/reporter';
