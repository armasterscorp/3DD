'use client';

import * as React from 'react';

type Props = {
  licenseId: string;
  name: string;
  expiresAt: number | null;
  daysRemaining: number | null;
  permanent: boolean;
};

function clearPreviousLicenseBrowserData(licenseId: string) {
  try {
    const markerKey = '3d-suite-active-license-id';
    const previous = window.localStorage.getItem(markerKey);

    if (previous && previous !== licenseId) {
      window.sessionStorage.clear();

      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('3d-suite-') && key !== markerKey) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        window.localStorage.removeItem(key);
      }
    }

    window.localStorage.setItem(markerKey, licenseId);
  } catch {
    // Storage may be unavailable in a restrictive browser mode.
  }
}

export default function LicenseProfileBar(props: Props) {
  const [loggingOut, setLoggingOut] = React.useState(false);

  React.useEffect(() => {
    clearPreviousLicenseBrowserData(props.licenseId);

    // Refreshes the persistent cookie and confirms the server-side session.
    void fetch('/api/license/status', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  }, [props.licenseId]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await fetch('/api/license/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      try {
        window.sessionStorage.clear();
        window.localStorage.removeItem('3d-suite-active-license-id');
      } catch {
        // Ignore storage cleanup errors.
      }

      window.location.href = '/license';
    }
  }

  const expiryText = props.permanent
    ? 'Permanent licence'
    : props.daysRemaining === 1
      ? '1 day remaining'
      : `${props.daysRemaining ?? 0} days remaining`;

  const expiresText = props.expiresAt
    ? new Date(props.expiresAt * 1000).toLocaleDateString()
    : 'No expiry';

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-2">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {props.name.trim().slice(0, 1).toUpperCase() || 'U'}
          </div>

          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">
              {props.name}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>{expiryText}</span>
              <span>Expires: {expiresText}</span>
              <span>Licence: {props.licenseId}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </div>
  );
}
