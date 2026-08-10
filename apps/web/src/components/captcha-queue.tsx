'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

interface CaptchaItem {
  id: string;
  targetUrl: string;
  captchaType: string;
  status: string;
  attempts: number;
  error?: string;
  solution?: string;
  createdAt: string;
  solvedAt?: string;
}

interface QueueStats {
  total: number;
  pending: number;
  solving: number;
  solved: number;
  failed: number;
}

export function CaptchaQueue() {
  const [items, setItems] = useState<CaptchaItem[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load queue
  const loadQueue = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/captcha/queue');
      setItems(response.data.items);
      setStats(response.data.stats);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load queue:', err);
      setError(err.response?.data?.error || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  // Delete item
  const handleDelete = async (id: string) => {
    try {
      await axios.delete(`/api/captcha/queue?id=${id}`);
      await loadQueue();
    } catch (err: any) {
      console.error('Failed to delete:', err);
    }
  };

  // Clear all
  const handleClearAll = async () => {
    if (!confirm('Clear all CAPTCHAs from queue?')) return;

    try {
      await axios.post('/api/captcha/clear');
      await loadQueue();
    } catch (err: any) {
      console.error('Failed to clear:', err);
    }
  };

  // Load on mount and auto-refresh
  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  // Status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'solving':
        return 'bg-blue-100 text-blue-800';
      case 'solved':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Format type
  const formatType = (type: string) => {
    return type
      .replace(/([A-Z])/g, ' $1')
      .replace('_', ' ')
      .trim();
  };

  if (loading) {
    return (
      <div className="border rounded-lg p-6 bg-white">
        <p className="text-gray-500">Loading CAPTCHAs...</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6 bg-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">CAPTCHA Queue</h3>
          <p className="text-sm text-gray-500 mt-1">
            CAPTCHAs requiring solving or review
          </p>
        </div>
        {stats && stats.total > 0 && (
          <button
            onClick={handleClearAll}
            className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-2 mb-6">
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-xs text-gray-600 mt-1">Total</p>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-yellow-700">{stats.pending}</p>
            <p className="text-xs text-gray-600 mt-1">Pending</p>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-blue-700">{stats.solving}</p>
            <p className="text-xs text-gray-600 mt-1">Solving</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-green-700">{stats.solved}</p>
            <p className="text-xs text-gray-600 mt-1">Solved</p>
          </div>
          <div className="p-3 bg-red-50 rounded-lg text-center">
            <p className="text-2xl font-bold text-red-700">{stats.failed}</p>
            <p className="text-xs text-gray-600 mt-1">Failed</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Items List */}
      {items.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">No CAPTCHAs in queue</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-700">Website</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Attempts</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Created</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 truncate">
                    <a
                      href={item.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {new URL(item.targetUrl).hostname}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatType(item.captchaType)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusColor(item.status)}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.attempts}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 hover:text-red-800 font-medium text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
