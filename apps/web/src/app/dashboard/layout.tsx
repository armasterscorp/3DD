import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LicenseProfileBar from '@/components/LicenseProfileBar';
import {
  LICENSE_COOKIE_NAME,
  verifyLicenseSession,
} from '@/lib/license';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = cookies().get(LICENSE_COOKIE_NAME)?.value;
  const session = verifyLicenseSession(token, { touch: true });

  if (!session) {
    redirect('/license');
  }

  return (
    <>
      <LicenseProfileBar
        licenseId={session.licenseId}
        name={session.name}
        expiresAt={session.expiresAt}
        daysRemaining={session.daysRemaining}
        permanent={session.permanent}
      />
      {children}
    </>
  );
}
