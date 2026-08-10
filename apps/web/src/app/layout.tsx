import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '3D Suite - WeTransfer Campaign Manager',
  description: 'Professional WeTransfer campaign management with real-time tracking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Navigation */}
        <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center font-bold text-white text-sm">3D</div>
              <span className="font-bold text-lg text-slate-900">3D Suite</span>
            </Link>
            <div className="flex gap-6">
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900 font-medium">
                Dashboard
              </Link>
              <Link href="/campaigns" className="text-slate-600 hover:text-slate-900 font-medium">
                Campaigns
              </Link>
            </div>
          </div>
        </nav>

        {children}
      </body>
    </html>
  );
}
