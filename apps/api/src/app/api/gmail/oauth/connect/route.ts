import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  cleanupExpiredGmailPending,
  gmailPendingStore,
} from '@/lib/gmail-oauth-store';

export const dynamic = 'force-dynamic';



function chromiumUserDataDir(
  requestedPath?: string
): string {
  if (requestedPath?.trim()) {
    return requestedPath.trim();
  }

  const home = os.homedir();

  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      'Chromium',
      'User Data'
    );
  }

  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Chromium');
  }

  return path.join(home, '.config', 'chromium');
}

async function findChromiumExecutable(
  requestedPath?: string
): Promise<string> {
  const candidates = [
    requestedPath?.trim() || '',
    process.platform === 'win32'
      ? path.join(
          process.env.LOCALAPPDATA || '',
          'Chromium',
          'Application',
          'chrome.exe'
        )
      : '',
    process.platform === 'win32'
      ? path.join(
          process.env.PROGRAMFILES || 'C:\\Program Files',
          'Chromium',
          'Application',
          'chrome.exe'
        )
      : '',
    process.platform === 'win32'
      ? path.join(
          process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
          'Chromium',
          'Application',
          'chrome.exe'
        )
      : '',
    process.platform === 'darwin'
      ? '/Applications/Chromium.app/Contents/MacOS/Chromium'
      : '',
    process.platform === 'linux' ? '/usr/bin/chromium' : '',
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    'Chromium executable was not found. Set CHROMIUM_EXECUTABLE_PATH.'
  );
}

export async function POST(request: NextRequest) {
  try {
    cleanupExpiredGmailPending();

    const body = await request.json();
    const profileDirectory = String(
      body.profileDirectory || ''
    ).trim();
    const extensionPath = String(body.extensionPath || '').trim();
    const googleClientId = String(
      body.googleClientId || ''
    ).trim();
    const googleClientSecret = String(
      body.googleClientSecret || ''
    ).trim();
    const googleRedirectUri = String(
      body.googleRedirectUri ||
        'http://localhost:7201/api/gmail/oauth/callback'
    ).trim();
    const requestedUserDataDir = String(
      body.chromiumUserDataDir || ''
    ).trim();
    const requestedExecutablePath = String(
      body.chromiumExecutablePath || ''
    ).trim();
    const requestedMode = String(
      body.connectionMode || 'chromium'
    )
      .trim()
      .toLowerCase();

    const connectionMode =
      requestedMode === 'manual'
        ? 'manual'
        : requestedMode === 'chromium-extension'
          ? 'chromium-extension'
          : 'chromium';

    if (!googleClientId) {
      return NextResponse.json(
        { success: false, error: 'Google Client ID is required.' },
        { status: 400 }
      );
    }

    if (!googleClientSecret) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google Client Secret is required.',
        },
        { status: 400 }
      );
    }

    if (!googleRedirectUri) {
      return NextResponse.json(
        {
          success: false,
          error: 'Google OAuth Redirect URI is required.',
        },
        { status: 400 }
      );
    }

    if (connectionMode !== 'manual' && !profileDirectory) {
      return NextResponse.json(
        { success: false, error: 'Chromium profile is required.' },
        { status: 400 }
      );
    }

    if (
      connectionMode === 'chromium-extension' &&
      !extensionPath
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Extension folder is required for Chromium profile + extension mode.',
        },
        { status: 400 }
      );
    }

    if (connectionMode === 'chromium-extension' && extensionPath) {
      const manifestPath = path.join(extensionPath, 'manifest.json');
      try {
        await fs.access(manifestPath);
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: `Extension folder does not contain manifest.json: ${extensionPath}`,
          },
          { status: 400 }
        );
      }
    }

    const clientId = googleClientId;
    const redirectUri = googleRedirectUri;

    const state = crypto.randomBytes(24).toString('hex');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope:
        'openid email https://www.googleapis.com/auth/gmail.modify',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });

    const authorizationUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    gmailPendingStore().set(state, {
      state,
      profileDirectory:
        connectionMode !== 'manual' ? profileDirectory : '',
      extensionPath:
        connectionMode === 'chromium-extension'
          ? extensionPath || null
          : null,
      googleClientId,
      googleClientSecret,
      googleRedirectUri,
      chromiumUserDataDir:
        requestedUserDataDir || null,
      chromiumExecutablePath:
        requestedExecutablePath || null,
      createdAt: Date.now(),
    });

    if (connectionMode === 'manual') {
      return NextResponse.json({
        success: true,
        mode: 'manual',
        authorizationUrl,
        state,
      });
    }

    const executable = await findChromiumExecutable(
      requestedExecutablePath
    );
    const args = [
      `--user-data-dir=${chromiumUserDataDir(
        requestedUserDataDir
      )}`,
      `--profile-directory=${profileDirectory}`,
    ];

    if (
      connectionMode === 'chromium-extension' &&
      extensionPath
    ) {
      args.push(`--load-extension=${extensionPath}`);
    }

    args.push(authorizationUrl);

    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    child.unref();

    return NextResponse.json({
      success: true,
      mode: connectionMode,
      state,
      profileDirectory,
      extensionLoaded: Boolean(extensionPath),
      authorizationUrl,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
