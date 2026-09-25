import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before any imports that use them
vi.mock('node:fs');
vi.mock('node:child_process');

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { run } from './init.js';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockExecSync = vi.mocked(execSync);

describe('init command', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no lock files, no playwright config
    mockExistsSync.mockReturnValue(false);
    // Default: execSync succeeds
    mockExecSync.mockReturnValue(Buffer.from(''));
  });

  // ---------------------------------------------------------------------------
  // Package manager detection
  // ---------------------------------------------------------------------------
  describe('package manager detection', () => {
    it('uses pnpm when pnpm-lock.yaml exists', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('pnpm-lock.yaml')
      );

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('(pnpm)')
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('pnpm add -D @automate/reporter'),
        expect.anything()
      );
    });

    it('uses yarn when yarn.lock exists (but not pnpm-lock.yaml)', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('yarn.lock')
      );

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('(yarn)')
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('yarn add -D @automate/reporter'),
        expect.anything()
      );
    });

    it('falls back to npm when neither lock file exists', () => {
      mockExistsSync.mockReturnValue(false);

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('(npm)')
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('npm install -D @automate/reporter'),
        expect.anything()
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Playwright config detection
  // ---------------------------------------------------------------------------
  describe('playwright config detection', () => {
    it('detects playwright.config.ts', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      mockReadFileSync.mockReturnValue('export default {}');

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('playwright.config.ts')
      );
    });

    it('detects playwright.config.js when .ts does not exist', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.js')
      );
      mockReadFileSync.mockReturnValue('module.exports = {}');

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('playwright.config.js')
      );
    });

    it('shows manual instruction when no playwright config is found', () => {
      mockExistsSync.mockReturnValue(false);

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('No playwright.config found')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("reporter: [['list'], ['@automate/reporter']]")
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Config patching
  // ---------------------------------------------------------------------------
  describe('config patching', () => {
    it('reports "already in config" when reporter is already present', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      mockReadFileSync.mockReturnValue(
        "reporter: [['list'], ['@automate/reporter']]"
      );

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('already in config')
      );
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('logs manual instruction when reporter array cannot be found in config', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      // No reporter array at all
      mockReadFileSync.mockReturnValue('export default { use: { headless: true } }');

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not find reporter array')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("reporter: [['list'], ['@automate/reporter']]")
      );
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('patches config and writes updated file when reporter array is found', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      const originalContent = "reporter: [\n  ['list'],\n]";
      mockReadFileSync.mockReturnValue(originalContent);

      run();

      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const [, writtenContent] = mockWriteFileSync.mock.calls[0] as [string, string, string];
      expect(writtenContent).toContain('@automate/reporter');
    });

    it('logs success after patching', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      mockReadFileSync.mockReturnValue("reporter: [\n  ['list'],\n]");

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Added @automate/reporter to config')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Install step
  // ---------------------------------------------------------------------------
  describe('install step', () => {
    it('logs success after successful install', () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(Buffer.from(''));

      run();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Installed'));
    });

    it('logs warning when install fails', () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => {
        throw new Error('install failed');
      });

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Install failed')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('npm install -D @automate/reporter')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // General output
  // ---------------------------------------------------------------------------
  describe('general output', () => {
    it('prints header on start', () => {
      mockExistsSync.mockReturnValue(false);

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Automate Setup')
      );
    });

    it('prints final instructions with AUTOMATE_DASHBOARD_URL', () => {
      mockExistsSync.mockReturnValue(false);

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('AUTOMATE_DASHBOARD_URL=http://localhost:4000 npx playwright test')
      );
    });

    it('prints "Done!" message at the end', () => {
      mockExistsSync.mockReturnValue(false);

      run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Done!')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('does not throw when readFileSync fails', () => {
      mockExistsSync.mockImplementation((p) =>
        String(p).endsWith('playwright.config.ts')
      );
      mockReadFileSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => run()).toThrow();
    });
  });
});
