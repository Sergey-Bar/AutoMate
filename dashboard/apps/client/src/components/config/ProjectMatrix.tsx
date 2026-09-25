import { useQuery } from '@tanstack/react-query';
import { Globe, Monitor, Smartphone, Tablet, RefreshCw, Shield, Play, Settings2 } from 'lucide-react';

interface ProjectUse {
  browserName?: string;
  baseURL?: string;
  viewport?: { width: number; height: number };
  headless?: boolean;
  trace?: string;
  screenshot?: string;
  video?: string;
}

interface Project {
  name: string;
  testDir?: string;
  use?: ProjectUse;
  retries?: number;
  timeout?: number;
  grep?: string;
  grepInvert?: string;
  dependencies?: string[];
}

interface ParsedConfigResponse {
  path: string;
  projects: Project[];
  globalTimeout?: number;
  retries?: number;
  workers?: number | string;
  testDir?: string;
  outputDir?: string;
  reporter?: string;
  fullyParallel?: boolean;
  forbidOnly?: boolean;
  webServer?: {
    command?: string;
    url?: string;
    port?: number;
    reuseExistingServer?: boolean;
  };
}

function useParsedConfig() {
  return useQuery<ParsedConfigResponse>({
    queryKey: ['playwright-config-parsed'],
    queryFn: async () => {
      const res = await fetch('/api/config/parsed');
      if (!res.ok) throw new Error('Could not parse config');
      return res.json();
    },
    staleTime: 30_000,
  });
}

function browserIcon(name?: string) {
  switch (name?.toLowerCase()) {
    case 'chromium':
    case 'chrome':
      return <Globe size={18} className="text-blue-400" />;
    case 'firefox':
      return <Globe size={18} className="text-orange-400" />;
    case 'webkit':
    case 'safari':
      return <Globe size={18} className="text-purple-400" />;
    default:
      return <Globe size={18} className="text-text-tertiary" />;
  }
}

function viewportIcon(vp?: { width: number; height: number }) {
  if (!vp) return <Monitor size={14} />;
  if (vp.width <= 430) return <Smartphone size={14} />;
  if (vp.width <= 820) return <Tablet size={14} />;
  return <Monitor size={14} />;
}

export function ProjectMatrix() {
  const { data, isLoading, error } = useParsedConfig();

  if (isLoading) {
    return (
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-48 rounded-xl border border-border-subtle bg-bg-elevated animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-2 text-text-secondary">
        <p className="text-sm">Could not parse playwright config.</p>
        <p className="text-xs text-text-tertiary">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Global Settings */}
      <div
        className="p-4 rounded-xl border border-border-default bg-bg-surface"
      >
        <div className="flex items-center gap-2 mb-3">
          <Settings2 size={15} className="text-text-tertiary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Global Settings
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SettingChip label="Workers" value={data.workers ?? '—'} />
          <SettingChip label="Retries" value={data.retries ?? 0} />
          <SettingChip label="Timeout" value={data.globalTimeout ? `${data.globalTimeout / 1000}s` : '—'} />
          <SettingChip label="Test Dir" value={data.testDir ?? './tests'} />
          <SettingChip label="Reporter" value={data.reporter ?? '—'} />
          <SettingChip label="Parallel" value={data.fullyParallel ? 'Yes' : 'No'} />
          <SettingChip label="Output" value={data.outputDir ?? 'test-results'} />
          <SettingChip label="Forbid Only" value={data.forbidOnly ? 'Yes' : 'No'} />
        </div>

        {data.webServer && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <p className="text-xs font-medium mb-1 text-text-secondary">Web Server</p>
            <p className="text-xs font-mono text-text-tertiary">
              {data.webServer.command} → {data.webServer.url ?? `port ${data.webServer.port}`}
            </p>
          </div>
        )}
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.projects.map((project) => (
          <ProjectCard key={project.name} project={project} globalRetries={data.retries} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, globalRetries }: { project: Project; globalRetries?: number }) {
  const retries = project.retries ?? globalRetries ?? 0;
  const browser = project.use?.browserName ?? 'default';
  const vp = project.use?.viewport;

  return (
    <div
      className="p-4 rounded-xl border border-border-default bg-bg-surface transition-colors hover:border-border-focus"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        {browserIcon(browser)}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate text-text-primary">
            {project.name}
          </p>
          <p className="text-[11px] capitalize text-text-tertiary">
            {browser}
          </p>
        </div>
        {project.use?.headless === false && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-flaky-bg text-flaky"
          >
            headed
          </span>
        )}
      </div>

      {/* Properties */}
      <div className="space-y-1.5">
        {project.use?.baseURL && (
          <PropRow icon={<Globe size={12} />} label="Base URL" value={project.use.baseURL} />
        )}
        {vp && (
          <PropRow
            icon={viewportIcon(vp)}
            label="Viewport"
            value={`${vp.width} × ${vp.height}`}
          />
        )}
        <PropRow icon={<RefreshCw size={12} />} label="Retries" value={String(retries)} />
        {project.timeout && (
          <PropRow icon={<Play size={12} />} label="Timeout" value={`${project.timeout / 1000}s`} />
        )}
        {project.use?.trace && (
          <PropRow icon={<Shield size={12} />} label="Trace" value={project.use.trace} />
        )}
        {project.testDir && (
          <PropRow icon={<Settings2 size={12} />} label="Test Dir" value={project.testDir} />
        )}
      </div>

      {/* Dependencies */}
      {project.dependencies && project.dependencies.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border-subtle">
          <p className="text-[11px] mb-1 text-text-tertiary">
            Depends on:
          </p>
          <div className="flex flex-wrap gap-1">
            {project.dependencies.map((dep) => (
              <span
                key={dep}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-running-bg text-running"
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Grep filter */}
      {project.grep && (
        <div className="mt-2">
          <p className="text-[10px] font-mono px-1.5 py-0.5 rounded inline-block bg-bg-elevated text-text-tertiary">
            grep: {project.grep}
          </p>
        </div>
      )}
    </div>
  );
}

function PropRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-text-tertiary">{icon}</span>
      <span className="text-text-secondary">{label}</span>
      <span className="ml-auto font-mono truncate max-w-40 text-text-primary">
        {value}
      </span>
    </div>
  );
}

function SettingChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-bg-elevated">
      <p className="text-[10px] uppercase tracking-wider mb-0.5 text-text-tertiary">
        {label}
      </p>
      <p className="text-xs font-medium font-mono truncate text-text-primary">
        {String(value)}
      </p>
    </div>
  );
}
