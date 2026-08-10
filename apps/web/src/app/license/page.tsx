'use client';

import React from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';

export default function LicensePage() {
  const [licenseKey, setLicenseKey] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function activate() {
    const key = licenseKey.trim();
    if (!key || loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || 'License activation failed');
      }

      window.location.assign('/dashboard');
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100">
      <div className="mx-auto flex min-h-[70vh] max-w-lg items-center">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-400">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">3D Suite License</h1>
              <p className="text-sm text-slate-400">
                A valid license is required to access the dashboard.
              </p>
            </div>
          </div>

          <label className="block text-sm font-medium" htmlFor="license-key">
            License key
          </label>
          <div className="mt-2 flex items-center rounded-xl border border-slate-700 bg-slate-950 px-3 focus-within:border-blue-500">
            <KeyRound className="mr-2 h-4 w-4 text-slate-500" />
            <input
              id="license-key"
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void activate();
              }}
              placeholder="3DS1..."
              autoComplete="off"
              className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-600"
            />
          </div>

          {error ? (
            <div className="mt-3 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void activate()}
            disabled={loading || !licenseKey.trim()}
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Validating license…' : 'Activate license'}
          </button>
        </section>
      </div>
    </main>
  );
}
