'use client';

import React from 'react';

type AdobeRemoteBrowserProps = {
  connected: boolean;
};

/**
 * Lightweight dashboard companion for the Adobe Playwright browser session.
 * The API launches Adobe in a normal Chrome/Chromium window, so this component
 * intentionally does not attempt to embed that authenticated page in an iframe.
 */
export function AdobeRemoteBrowser({ connected }: AdobeRemoteBrowserProps) {
  return (
    <div className="space-y-3 text-sm">
      <div
        className={`rounded border px-3 py-3 ${
          connected
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}
      >
        <div className="font-semibold">
          {connected ? 'Adobe browser session is open' : 'Adobe browser is not open'}
        </div>
        <div className="mt-1 text-xs leading-5">
          {connected
            ? 'Use the Chrome/Chromium window opened by 3D-SUITE to complete or review the Adobe login. This dashboard will detect the session automatically.'
            : 'Click “Open Adobe & Connect” below. 3D-SUITE will launch a normal browser window for Adobe login.'}
        </div>
      </div>
    </div>
  );
}
