import { NextRequest, NextResponse } from 'next/server';

// LOCAL BUILD:
// Licensing is enforced by the web app before requests are proxied here.
// When you move to the VPS, bind this API to 127.0.0.1 / firewall port 7201
// so it cannot be reached directly from the public internet.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
