'use client';

import { useEffect } from 'react';
import axios from 'axios';
import { CaptchaSettings } from '@/components/captcha-settings';
import { CaptchaQueue } from '@/components/captcha-queue';
import Link from 'next/link';

// Add x-user-id header to all outbound API requests so per-license endpoints
// can isolate data without requiring an explicit auth session.
axios.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Read license id from cookie if available; fall back to a stable key
    const licenseId =
      document.cookie
        .split('; ')
        .find((row) => row.startsWith('3d_suite_license='))
        ?.split('=')[1] || 'default';
    config.headers = config.headers ?? {};
    config.headers['x-user-id'] = licenseId;
  }
  return config;
});

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 mt-1">Manage your inquiry settings and integrations</p>
          </div>
          <Link
            href="/campaigns"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            View Campaigns
          </Link>
        </div>

        {/* CAPTCHA Solving Section */}
        <div className="border-t pt-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">CAPTCHA Solving</h2>
          <p className="text-gray-500 mb-6 text-sm">
            Configure 2Captcha automatic solving. CAPTCHAs encountered during inquiry
            campaigns will be resolved automatically; failures are queued below for review.
          </p>
          <div className="space-y-6">
            <CaptchaSettings />
            <div className="mt-8">
              <CaptchaQueue />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

