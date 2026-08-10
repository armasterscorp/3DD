import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const dynamic = 'force-dynamic';

function candidateUserDataDirs(): string[] {
  const home = os.homedir();

  return Array.from(
    new Set(
      [
        process.env.CHROMIUM_USER_DATA_DIR || '',
        process.platform === 'win32'
          ? path.join(
              process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
              'Chromium',
              'User Data'
            )
          : '',
        process.platform === 'win32'
          ? path.join(
              process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
              'Google',
              'Chrome',
              'User Data'
            )
          : '',
        process.platform === 'darwin'
          ? path.join(home, 'Library', 'Application Support', 'Chromium')
          : '',
        process.platform === 'linux'
          ? path.join(home, '.config', 'chromium')
          : '',
      ].filter(Boolean)
    )
  );
}

async function readFriendlyNames(
  userDataDir: string
): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(
      path.join(userDataDir, 'Local State'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as any;
    const infoCache = parsed?.profile?.info_cache || {};

    const names: Record<string, string> = {};
    for (const [directory, info] of Object.entries(infoCache)) {
      const item = info as any;
      names[directory] =
        String(item?.name || item?.gaia_name || directory).trim() ||
        directory;
    }
    return names;
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const requestedUserDataDir =
      request.nextUrl.searchParams.get('userDataDir')?.trim() || '';

    const directories = requestedUserDataDir
      ? [
          requestedUserDataDir,
          ...candidateUserDataDirs().filter(
            (item) => item !== requestedUserDataDir
          ),
        ]
      : candidateUserDataDirs();

    for (const userDataDir of directories) {
      try {
        const stat = await fs.stat(userDataDir);
        if (!stat.isDirectory()) continue;

        const friendlyNames = await readFriendlyNames(userDataDir);
        const entries = await fs.readdir(userDataDir, {
          withFileTypes: true,
        });

        const profileDirectories = entries
          .filter(
            (entry) =>
              entry.isDirectory() &&
              (entry.name === 'Default' ||
                /^Profile \d+$/i.test(entry.name))
          )
          .map((entry) => entry.name);

        const allDirectories = Array.from(
          new Set([
            ...Object.keys(friendlyNames),
            ...profileDirectories,
          ])
        );

        const profiles = allDirectories
          .map((directory) => ({
            directory,
            name: friendlyNames[directory] || directory,
            userDataDir,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({
          success: true,
          userDataDir,
          profiles,
        });
      } catch {
        continue;
      }
    }

    return NextResponse.json(
      {
        success: false,
        profiles: [],
        error:
          'Chromium user-data directory was not found. Set CHROMIUM_USER_DATA_DIR to your Chromium "User Data" folder.',
      },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        profiles: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
