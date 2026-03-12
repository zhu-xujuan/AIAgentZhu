'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Settings, Server, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLlmConfig, updateLlmConfig, LlmConfigUpdateResult } from '@/lib/api';

const defaultBaseUrl = 'https://ollama.kabu-ai.jp';
const defaultProvider = 'openai';

const presets = [
  { label: 'ollama.kabu-ai.jp', value: defaultBaseUrl },
  { label: '100.93.85.78:11434', value: 'http://100.93.85.78:11434' },
];

const providers = [
  { label: 'Ollama', value: 'ollama' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Azure OpenAI', value: 'azure' },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [currentBaseUrl, setCurrentBaseUrl] = useState(defaultBaseUrl);
  const [provider, setProvider] = useState(defaultProvider);
  const [currentProvider, setCurrentProvider] = useState(defaultProvider);
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<LlmConfigUpdateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presetValue = useMemo(() => {
    return presets.find((p) => p.value === baseUrl)?.value || 'custom';
  }, [baseUrl]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const config = await getLlmConfig();
        if (!mounted) return;
        setBaseUrl(config.base_url || defaultBaseUrl);
        setCurrentBaseUrl(config.base_url || defaultBaseUrl);
        setProvider(config.provider || defaultProvider);
        setCurrentProvider(config.provider || defaultProvider);
        setModel(config.model || '');
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async () => {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
      setError('Base URL is required');
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await updateLlmConfig(trimmed, true, provider || undefined);
      setStatus(result);
      setCurrentBaseUrl(trimmed);
      setCurrentProvider(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">LLM server switching and runtime status</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Server className="w-4 h-4" />
          LLM Server
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading configuration...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Preset</div>
                <select
                  value={presetValue}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === 'custom') return;
                    setBaseUrl(next);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                  disabled={saving}
                >
                  {presets.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Base URL</div>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                  placeholder="https://ollama.kabu-ai.jp"
                  disabled={saving}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Provider</div>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
                  disabled={saving}
                >
                  {providers.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                Provider: <span className="text-foreground">{currentProvider || 'unknown'}</span>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                Model: <span className="text-foreground">{model || 'unknown'}</span>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                Current URL: <span className="text-foreground">{currentBaseUrl || 'unknown'}</span>
              </div>
            </div>

            {status && (
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs flex items-center gap-2',
                  status.applied
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                )}
              >
                {status.applied ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                <span>
                  {status.message}
                  {status.error ? ` (${status.error})` : ''}
                </span>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
                disabled={saving || loading}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Apply & Save
              </button>
              <div className="text-[11px] text-muted-foreground">
                If runtime apply fails, it will be used after the next restart.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
