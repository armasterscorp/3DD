'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

interface CaptchaConfig {
  configured: boolean;
  isActive: boolean;
  lastTestAt?: string;
  lastTestStatus?: string;
  testError?: string;
}

export function CaptchaSettings() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<CaptchaConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getRequestConfig = () => ({
    headers: {
      'x-user-id':
        typeof window !== 'undefined' ? localStorage.getItem('userId') || 'test-user' : 'test-user',
    },
  });

  useEffect(() => {
    loadConfig();
  }, []);

  // Load current config
  const loadConfig = async () => {
    try {
      const response = await axios.get('/api/captcha/config', getRequestConfig());
      setConfig(response.data);
    } catch (err: any) {
      console.error('Failed to load config:', err);
      if (err.response?.status === 401) {
        setError('Unauthorized - User ID not found');
      }
    }
  };

  // Save API key
  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await axios.post(
        '/api/captcha/config',
        {
          apiKey: apiKey.trim(),
        },
        getRequestConfig()
      );

      setSuccess('✓ 2Captcha API key saved and tested successfully');
      setApiKey('');
      await loadConfig();
    } catch (err: any) {
      console.error('Save API key error:', err.response?.data);
      const msg = err.response?.data?.error || err.message || 'Failed to save API key';
      setError(`✗ ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  // Status badge
  const getStatusBadge = () => {
    if (!config?.configured) {
      return (
        <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
          Not Configured
        </span>
      );
    }

    if (config.lastTestStatus === 'success') {
      return (
        <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
          ✓ Active
        </span>
      );
    }

    if (config.lastTestStatus === 'failed') {
      return (
        <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
          ⚠ Connection Issue
        </span>
      );
    }

    return (
      <span className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
        Unchecked
      </span>
    );
  };

  return (
    <div className="border rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">2Captcha Configuration</h3>
          <p className="text-sm text-gray-500 mt-1">
            Automatic CAPTCHA solving for inquiry campaigns
          </p>
        </div>
        {config && getStatusBadge()}
      </div>

      {/* Current Config Status */}
      {config?.configured && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-600">Last Tested</p>
              <p className="text-sm text-gray-900 mt-1">
                {formatDate(config.lastTestAt)}
              </p>
            </div>
            {config.testError && (
              <div>
                <p className="text-xs font-medium text-red-600">Last Error</p>
                <p className="text-sm text-red-700 mt-1">{config.testError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* API Key Input */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            2Captcha API Key
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your 2Captcha API key"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showKey ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Get your free API key from{' '}
            <a
              href="https://2captcha.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              2captcha.com
            </a>
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={handleSaveApiKey}
          disabled={loading || !apiKey.trim()}
          className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Testing & Saving...' : 'Save & Test Connection'}
        </button>
      </div>

      {/* Info Box */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h4 className="font-medium text-gray-900 mb-2">How it works</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>✓ Automatically detects CAPTCHAs during inquiry campaigns</li>
          <li>✓ Supports reCAPTCHA v2, v3, Cloudflare Turnstile, and image CAPTCHAs</li>
          <li>✓ Per-license isolation - your key is securely stored</li>
          <li>✓ Failed CAPTCHAs are moved to a separate review queue</li>
          <li>✓ Costs are tracked and displayed in campaign results</li>
        </ul>
      </div>
    </div>
  );
}
