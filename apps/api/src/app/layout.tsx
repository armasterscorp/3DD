import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '3D Suite API',
  description: 'WeTransfer Campaign Manager REST API',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f8fafc', color: '#111827' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: 32 }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>3D Suite API</h1>
          <p style={{ color: '#4b5563', marginBottom: 32 }}>WeTransfer Campaign Manager REST API</p>

          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Endpoints</h2>
            <ul style={{ paddingLeft: 20, color: '#374151', lineHeight: 1.8 }}>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>GET /api/health</code> - Health check</li>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>GET /api/campaigns</code> - List campaigns</li>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>POST /api/campaigns</code> - Create campaign</li>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>POST /api/campaigns/[id]/leads</code> - Import leads</li>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>POST /api/campaigns/[id]/send</code> - Start campaign</li>
              <li><code style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 6 }}>GET /api/campaigns/[id]/logs</code> - Get logs</li>
            </ul>
          </div>

          <div style={{ marginTop: 32, padding: 16, background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 12 }}>
            <p style={{ fontSize: 14, color: '#1e3a8a', margin: 0 }}>
              📖 Full documentation: <Link href="https://github.com/emilysanders0018/3D-Suite" style={{ textDecoration: 'underline', color: '#1d4ed8' }}>GitHub Repository</Link>
            </p>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
