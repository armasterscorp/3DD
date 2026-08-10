import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import QRCode from 'qrcode';
import {
  Document,
  ExternalHyperlink,
  ImageRun,
  Packer,
  Paragraph,
  SectionType,
  TextRun,
} from 'docx';

import {
  GmailConnection,
  readGmailConnections,
  upsertGmailConnection,
} from '@/lib/gmail-oauth-store';

export const dynamic = 'force-dynamic';

type HtmlLinkBox = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

async function renderHtmlWithLinks(
  html: string
): Promise<{
  png: Buffer;
  links: HtmlLinkBox[];
  width: number;
  height: number;
}> {
  // Exact A4 portrait aspect ratio at a high-resolution CSS canvas.
  // deviceScaleFactor=2 makes the screenshot 2480 x 3508 pixels,
  // which is sharp enough for Word/PowerPoint while retaining browser rendering.
  const pageWidth = 1240;
  const pageHeight = 1754;
  const safeMargin = 28;

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: pageWidth,
        height: pageHeight,
      },
      deviceScaleFactor: 2,
    });

    await page.setContent(html, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    await page.waitForTimeout(900);

    await page.evaluate(
      ({ pageWidth, pageHeight, safeMargin }) => {
        const body = document.body;
        const htmlElement = document.documentElement;

        if (!body) return;

        // Create one wrapper around all original body content so we can
        // uniformly scale the completed HTML without stretching it.
        let wrapper = document.getElementById('__3d_suite_a4_content');

        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.id = '__3d_suite_a4_content';

          while (body.firstChild) {
            wrapper.appendChild(body.firstChild);
          }

          body.appendChild(wrapper);
        }

        htmlElement.style.margin = '0';
        htmlElement.style.padding = '0';
        htmlElement.style.width = `${pageWidth}px`;
        htmlElement.style.minWidth = `${pageWidth}px`;
        htmlElement.style.height = `${pageHeight}px`;
        htmlElement.style.minHeight = `${pageHeight}px`;
        htmlElement.style.overflow = 'hidden';

        body.style.margin = '0';
        body.style.padding = '0';
        body.style.width = `${pageWidth}px`;
        body.style.minWidth = `${pageWidth}px`;
        body.style.height = `${pageHeight}px`;
        body.style.minHeight = `${pageHeight}px`;
        body.style.overflow = 'hidden';
        body.style.position = 'relative';

        wrapper.style.position = 'absolute';
        wrapper.style.left = '0';
        wrapper.style.top = '0';
        wrapper.style.transformOrigin = 'top left';
        wrapper.style.transform = 'none';
        wrapper.style.width = 'max-content';
        wrapper.style.maxWidth = 'none';

        // Measure the natural rendered content.
        const rect = wrapper.getBoundingClientRect();

        const contentWidth = Math.max(
          rect.width,
          wrapper.scrollWidth,
          1
        );

        const contentHeight = Math.max(
          rect.height,
          wrapper.scrollHeight,
          1
        );

        const usableWidth = pageWidth - safeMargin * 2;
        const usableHeight = pageHeight - safeMargin * 2;

        // Scale both UP and DOWN. This is the key difference from the
        // previous version, which often left small HTML designs tiny.
        const scale = Math.min(
          usableWidth / contentWidth,
          usableHeight / contentHeight
        );

        const finalWidth = contentWidth * scale;
        const finalHeight = contentHeight * scale;

        const offsetX =
          safeMargin + Math.max(0, (usableWidth - finalWidth) / 2);

        const offsetY =
          safeMargin + Math.max(0, (usableHeight - finalHeight) / 2);

        wrapper.style.left = `${offsetX}px`;
        wrapper.style.top = `${offsetY}px`;
        wrapper.style.transform = `scale(${scale})`;
      },
      { pageWidth, pageHeight, safeMargin }
    );

    await page.waitForTimeout(250);

    const links = await page.evaluate(
      ({ pageWidth, pageHeight }) =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((anchor) => {
            const rect = anchor.getBoundingClientRect();
            const href = (anchor as HTMLAnchorElement).href || '';

            return {
              href,
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
              pageWidth,
              pageHeight,
            };
          })
          .filter(
            (item) =>
              item.href &&
              item.width > 0 &&
              item.height > 0
          ),
      { pageWidth, pageHeight }
    );

    const png = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      },
    });

    return {
      png,
      links,
      width: pageWidth,
      height: pageHeight,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function renderHtmlToPng(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);
  return rendered.png;
}

async function htmlToPdfBuffer(
  html: string
): Promise<Buffer> {
  // Reuse the exact same A4 high-resolution render used by PPTX/DOCX.
  // This guarantees that the PDF shows the full document both vertically
  // and horizontally instead of applying a second independent scale.
  const rendered = await renderHtmlWithLinks(html);

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: rendered.width,
        height: rendered.height,
      },
      deviceScaleFactor: 1,
    });

    const imageDataUri =
      `data:image/png;base64,${rendered.png.toString('base64')}`;

    const linkOverlays = rendered.links
      .map((link) => {
        const safeHref = link.href
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        return `
          <a
            href="${safeHref}"
            style="
              position:absolute;
              left:${link.x}px;
              top:${link.y}px;
              width:${link.width}px;
              height:${link.height}px;
              display:block;
              opacity:0.001;
              z-index:10;
              text-decoration:none;
            "
          >&nbsp;</a>
        `;
      })
      .join('\n');

    await page.setContent(
      `
      <html>
        <head>
          <style>
            @page {
              size: A4 portrait;
              margin: 0;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              width: ${rendered.width}px;
              height: ${rendered.height}px;
              overflow: hidden;
              background: white;
            }

            #page {
              position: relative;
              width: ${rendered.width}px;
              height: ${rendered.height}px;
            }

            #page-image {
              position: absolute;
              inset: 0;
              width: ${rendered.width}px;
              height: ${rendered.height}px;
              display: block;
            }
          </style>
        </head>
        <body>
          <div id="page">
            <img id="page-image" src="${imageDataUri}" />
            ${linkOverlays}
          </div>
        </body>
      </html>
      `,
      {
        waitUntil: 'load',
      }
    );

    await page.waitForTimeout(200);

    return Buffer.from(
      await page.pdf({
        width: '210mm',
        height: '297mm',
        printBackground: true,
        preferCSSPageSize: true,
        pageRanges: '1',
        margin: {
          top: '0mm',
          right: '0mm',
          bottom: '0mm',
          left: '0mm',
        },
      })
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function htmlToSvgBuffer(html: string): Buffer {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="794"
     height="1123"
     viewBox="0 0 794 1123"
     preserveAspectRatio="xMidYMid meet">
  <foreignObject x="0" y="0" width="794" height="1123">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="width:794px;height:1123px;box-sizing:border-box;overflow:hidden;">
      ${html}
    </div>
  </foreignObject>
</svg>`;

  return Buffer.from(svg, 'utf8');
}

async function sliceRenderedPng(
  png: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  pageAspect: number
): Promise<Array<{
  data: Buffer;
  sourceY: number;
  sourceHeight: number;
}>> {
  // Use Playwright itself to crop the rendered PNG into page/slide-sized pieces.
  // This avoids introducing an additional image-processing dependency.
  const browser = await chromium.launch({ headless: true });

  try {
    const slices: Array<{
      data: Buffer;
      sourceY: number;
      sourceHeight: number;
    }> = [];

    const sliceHeight = Math.max(
      1,
      Math.floor(sourceWidth / pageAspect)
    );

    for (
      let sourceY = 0;
      sourceY < sourceHeight;
      sourceY += sliceHeight
    ) {
      const currentHeight = Math.min(
        sliceHeight,
        sourceHeight - sourceY
      );

      const page = await browser.newPage({
        viewport: {
          width: sourceWidth,
          height: currentHeight,
        },
      });

      const dataUri =
        `data:image/png;base64,${png.toString('base64')}`;

      await page.setContent(
        `<html><body style="margin:0;overflow:hidden;">
          <img src="${dataUri}"
               style="position:absolute;left:0;top:-${sourceY}px;width:${sourceWidth}px;height:${sourceHeight}px;max-width:none;">
        </body></html>`,
        { waitUntil: 'load' }
      );

      slices.push({
        data: await page.screenshot({
          type: 'png',
          clip: {
            x: 0,
            y: 0,
            width: sourceWidth,
            height: currentHeight,
          },
        }),
        sourceY,
        sourceHeight: currentHeight,
      });

      await page.close();
    }

    return slices;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function htmlToDocxBuffer(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  // A4 page with very small margins.
  // The source PNG is already exactly A4-shaped and high resolution,
  // so use nearly the entire Word page without another fit calculation.
  const imageWidth = 780;
  const imageHeight = Math.round(
    imageWidth * (rendered.height / rendered.width)
  );

  const children: Paragraph[] = [
    new Paragraph({
      alignment: 'center',
      spacing: {
        before: 0,
        after: 0,
        line: 1,
      },
      children: [
        new ImageRun({
          data: rendered.png,
          transformation: {
            width: imageWidth,
            height: imageHeight,
          },
          type: 'png',
        }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
          page: {
            size: {
              width: 11906,
              height: 16838,
            },
            margin: {
              top: 80,
              right: 80,
              bottom: 80,
              left: 80,
            },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

async function htmlToPptxBuffer(
  html: string
): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: 'A4_PORTRAIT',
    width: 8.27,
    height: 11.69,
  });
  pptx.layout = 'A4_PORTRAIT';

  const slideW = 8.27;
  const slideH = 11.69;

  const slide = pptx.addSlide();

  // The rendered PNG already has the exact A4 aspect ratio.
  // Fill the full portrait slide without any extra letterboxing.
  slide.addImage({
    data:
      `data:image/png;base64,${rendered.png.toString('base64')}`,
    x: 0,
    y: 0,
    w: slideW,
    h: slideH,
  });

  // Link bounds are already measured after the A4 scaling.
  for (const link of rendered.links) {
    const x =
      (link.x / rendered.width) * slideW;

    const y =
      (link.y / rendered.height) * slideH;

    const w =
      (link.width / rendered.width) * slideW;

    const h =
      (link.height / rendered.height) * slideH;

    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      line: {
        transparency: 100,
      },
      fill: {
        transparency: 100,
      },
      hyperlink: {
        url: link.href,
      },
    });
  }

  const output = await pptx.write({
    outputType: 'nodebuffer',
  });

  return Buffer.from(output as Buffer);
}

function base64Url(value: Buffer | string): string {
  const buffer =
    typeof value === 'string' ? Buffer.from(value, 'utf8') : value;

  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomDigits(length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String(Math.floor(Math.random() * 10));
  }
  return result;
}

async function buildQrCodeDataUri(value: string): Promise<string> {
  const data = String(value || '').trim();
  if (!data) return '';

  return await QRCode.toDataURL(data, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
  });
}

function resolveQrSource(args: {
  enabled: boolean;
  source: 'attachment-link' | 'cta-link' | 'custom';
  attachmentLink: string;
  ctaLink: string;
  customData: string;
}): string {
  if (!args.enabled) return '';
  if (args.source === 'cta-link') return args.ctaLink.trim();
  if (args.source === 'custom') return args.customData.trim();
  return args.attachmentLink.trim();
}

function buildLogoDevUrl(args: {
  domain: string;
  publishableKey: string;
  size: number;
  format: 'png' | 'webp';
  theme: 'light' | 'dark' | 'auto';
}): string {
  const domain = args.domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];

  if (!domain || !args.publishableKey.trim()) return '';

  const params = new URLSearchParams({
    token: args.publishableKey.trim(),
    size: String(Math.min(800, Math.max(16, Math.floor(args.size || 128)))),
    format: args.format,
    theme: args.theme,
  });

  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params.toString()}`;
}


function placeholders(
  template: string,
  email: string,
  originalFilename = '',
  extra: {
    attachmentLink?: string;
    ctaLink?: string;
  } = {}
): string {
  const at = email.lastIndexOf('@');
  const localPart = at > 0 ? email.slice(0, at) : email;
  const domain = at > 0 ? email.slice(at + 1) : '';
  const domainName = domain.split('.')[0] || domain;

  const dot = originalFilename.lastIndexOf('.');
  const originalName =
    dot > 0 ? originalFilename.slice(0, dot) : originalFilename;
  const ext =
    dot > 0 ? originalFilename.slice(dot + 1) : '';

  const values: Record<string, string> = {
    Email: email,
    LocalPart: localPart,
    Domain: domain,
    DomainName: domainName,
    Date: new Date().toISOString().slice(0, 10),
    Random6: randomDigits(6),
    Random8: randomDigits(8),
    OriginalName: originalName,
    Ext: ext,
    AttachmentLink: extra.attachmentLink || '',
    CTA: extra.ctaLink || '',
  };

  return template.replace(
    /\{([A-Za-z0-9]+)\}/g,
    (match, key: string) => values[key] ?? match
  );
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureAccessToken(
  connection: GmailConnection
): Promise<GmailConnection> {
  if (
    connection.accessToken &&
    connection.expiresAt > Date.now() + 60_000
  ) {
    return connection;
  }

  const clientId = String(
    connection.googleClientId || ''
  ).trim();
  const clientSecret = String(
    connection.googleClientSecret || ''
  ).trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'This Gmail connection is missing its Google OAuth Client ID or Client Secret. Reconnect the account from the Gmail dashboard.'
    );
  }

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    }
  );

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        `Google token refresh failed: HTTP ${response.status}`
    );
  }

  const updated = {
    ...connection,
    accessToken: String(data.access_token),
    expiresAt:
      Date.now() + Number(data.expires_in || 3600) * 1000,
  };

  await upsertGmailConnection(updated);
  return updated;
}

function buildMimeMessage(args: {
  from: string;
  fromName?: string;
  replyTo?: string;
  to: string;
  subject: string;
  body: string;
  messageMode?: 'text' | 'html';
  attachment?: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
  } | null;
}): string {
  const boundary = `3d-suite-${crypto.randomUUID()}`;

  const safeFromName = String(args.fromName || '')
    .replace(/[\r\n"]/g, ' ')
    .trim();

  const fromHeader = safeFromName
    ? `From: "${safeFromName}" <${args.from}>`
    : `From: ${args.from}`;

  const headers = [
    fromHeader,
    ...(args.replyTo?.trim()
      ? [`Reply-To: ${args.replyTo.trim().replace(/[\r\n]/g, '')}`]
      : []),
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
  ];

  const bodyContentType =
    args.messageMode === 'html'
      ? 'text/html; charset="UTF-8"'
      : 'text/plain; charset="UTF-8"';

  if (!args.attachment) {
    return [
      ...headers,
      `Content-Type: ${bodyContentType}`,
      'Content-Transfer-Encoding: 8bit',
      '',
      args.body,
    ].join('\r\n');
  }

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: ${bodyContentType}`,
    'Content-Transfer-Encoding: 8bit',
    '',
    args.body,
    '',
    `--${boundary}`,
    `Content-Type: ${args.attachment.mimeType || 'application/octet-stream'}; name="${args.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${args.attachment.filename}"`,
    '',
    args.attachment.bytes.toString('base64'),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const accountEmail = String(
      formData.get('accountEmail') || ''
    ).trim();

    const rotateAccounts =
      String(formData.get('rotateAccounts') || 'false') === 'true';

    const fromName = String(
      formData.get('fromName') || ''
    ).trim();

    const replyTo = String(
      formData.get('replyTo') || ''
    ).trim();

    const accountPlanRaw = String(
      formData.get('accountPlan') || '[]'
    );

    let accountPlan: Array<{
      email: string;
      maxSends: number;
    }> = [];

    try {
      const parsed = JSON.parse(accountPlanRaw) as unknown[];
      accountPlan = parsed
        .map((item) => {
          const value = item as {
            email?: unknown;
            maxSends?: unknown;
          };

          return {
            email: String(value.email || '').trim(),
            maxSends: Math.max(
              0,
              Math.floor(Number(value.maxSends || 0))
            ),
          };
        })
        .filter(
          (item) => item.email && item.maxSends > 0
        );
    } catch {
      accountPlan = [];
    }

    const recipients = Array.from(
      new Set(
        (JSON.parse(
          String(formData.get('recipients') || '[]')
        ) as unknown[])
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(
            (email) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          )
      )
    );

    const subjectTemplate = String(
      formData.get('subjectTemplate') || ''
    );
    const attachmentLink = String(
      formData.get('attachmentLink') || ''
    ).trim();
    const ctaLink = String(
      formData.get('ctaLink') || ''
    ).trim();

    const qrEnabled =
      String(formData.get('qrEnabled') || 'false') === 'true';

    const qrSourceRaw = String(
      formData.get('qrSource') || 'attachment-link'
    ).trim();

    const qrSource:
      | 'attachment-link'
      | 'cta-link'
      | 'custom' =
      qrSourceRaw === 'cta-link' || qrSourceRaw === 'custom'
        ? qrSourceRaw
        : 'attachment-link';

    const qrCustomData = String(
      formData.get('qrCustomData') || ''
    ).trim();

    const bodyTemplate = String(
      formData.get('bodyTemplate') || ''
    );

    const messageMode =
      String(formData.get('messageMode') || 'text')
        .trim()
        .toLowerCase() === 'html'
        ? 'html'
        : 'text';

    const logoDevEnabled =
      String(formData.get('logoDevEnabled') || 'false') === 'true';
    const logoDevKey = String(formData.get('logoDevKey') || '').trim();
    const logoDevSize = Math.min(
      800,
      Math.max(16, Math.floor(Number(formData.get('logoDevSize') || 128)))
    );
    const logoDevFormat =
      String(formData.get('logoDevFormat') || 'png') === 'webp'
        ? 'webp'
        : 'png';
    const logoDevThemeRaw = String(
      formData.get('logoDevTheme') || 'auto'
    );
    const logoDevTheme =
      logoDevThemeRaw === 'light' || logoDevThemeRaw === 'dark'
        ? logoDevThemeRaw
        : 'auto';

    const attachmentNameTemplate = String(
      formData.get('attachmentNameTemplate') ||
        '{OriginalName}.{Ext}'
    );

    const attachmentEnabled =
      String(formData.get('attachmentEnabled') || 'false') === 'true';

    const attachmentModeRaw = String(
      formData.get('attachmentMode') || 'upload'
    ).trim();

    const attachmentMode:
      | 'upload'
      | 'html-pdf'
      | 'html-pptx'
      | 'html-docx'
      | 'html-svg' =
      attachmentModeRaw === 'html-pdf' ||
      attachmentModeRaw === 'html-pptx' ||
      attachmentModeRaw === 'html-docx' ||
      attachmentModeRaw === 'html-svg'
        ? attachmentModeRaw
        : 'upload';

    const attachmentHtml = String(
      formData.get('attachmentHtml') || ''
    );

    const attachmentValue = formData.get('attachment');

    if (!recipients.length) {
      return NextResponse.json(
        { success: false, error: 'At least one recipient is required.' },
        { status: 400 }
      );
    }

    if (!rotateAccounts && !accountEmail) {
      return NextResponse.json(
        { success: false, error: 'Connected Gmail account is required.' },
        { status: 400 }
      );
    }

    const connections = await readGmailConnections();

    const requestedPlan = rotateAccounts
      ? accountPlan
      : [
          {
            email: accountEmail,
            maxSends:
              accountPlan.find(
                (item) =>
                  item.email.toLowerCase() ===
                  accountEmail.toLowerCase()
              )?.maxSends || recipients.length,
          },
        ];

    if (!requestedPlan.length) {
      return NextResponse.json(
        {
          success: false,
          error: 'No Gmail accounts are enabled for sending.',
        },
        { status: 400 }
      );
    }

    const plan = requestedPlan.map((item) => {
      const connection = connections.find(
        (candidate) =>
          candidate.email.toLowerCase() ===
          item.email.toLowerCase()
      );

      if (!connection) {
        throw new Error(
          `Gmail account is not connected: ${item.email}`
        );
      }

      return {
        email: connection.email,
        maxSends: item.maxSends,
        used: 0,
        connection,
      };
    });

    const authorizedByEmail = new Map<string, GmailConnection>();

    for (const item of plan) {
      const authorized = await ensureAccessToken(item.connection);
      authorizedByEmail.set(
        item.email.toLowerCase(),
        authorized
      );
    }

    let attachmentBytes: Buffer | null = null;
    let originalFilename = '';
    let attachmentMimeType = 'application/octet-stream';

    if (
      attachmentEnabled &&
      attachmentMode === 'upload' &&
      attachmentValue instanceof File
    ) {
      attachmentBytes = Buffer.from(
        await attachmentValue.arrayBuffer()
      );
      originalFilename = attachmentValue.name || 'attachment';
      attachmentMimeType =
        attachmentValue.type || 'application/octet-stream';
    }

    const results: Array<{
      index: number;
      total: number;
      recipient: string;
      accountEmail?: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }> = [];

    let rotationCursor = 0;

    function nextAccount() {
      if (!plan.length) return null;

      if (!rotateAccounts) {
        const first = plan[0];
        if (first.used >= first.maxSends) return null;
        return first;
      }

      for (let attempt = 0; attempt < plan.length; attempt += 1) {
        const candidate =
          plan[rotationCursor % plan.length];
        rotationCursor =
          (rotationCursor + 1) % plan.length;

        if (candidate.used < candidate.maxSends) {
          return candidate;
        }
      }

      return null;
    }

    for (let index = 0; index < recipients.length; index += 1) {
      const recipient = recipients[index];
      const account = nextAccount();

      if (!account) {
        results.push({
          index: index + 1,
          total: recipients.length,
          recipient,
          success: false,
          error:
            'All configured Gmail account send caps have been reached.',
        });
        continue;
      }

      const authorized = authorizedByEmail.get(
        account.email.toLowerCase()
      );

      if (!authorized) {
        results.push({
          index: index + 1,
          total: recipients.length,
          recipient,
          accountEmail: account.email,
          success: false,
          error: 'Authorized Gmail connection is unavailable.',
        });
        continue;
      }

      account.used += 1;

      try {
        const subject = placeholders(
          subjectTemplate,
          recipient,
          originalFilename,
          {
            attachmentLink,
            ctaLink,
          }
        );

        const atIndex = recipient.lastIndexOf('@');
        const recipientDomain =
          atIndex > 0 ? recipient.slice(atIndex + 1) : '';

        const qrRawValue = resolveQrSource({
          enabled: qrEnabled,
          source: qrSource,
          attachmentLink,
          ctaLink,
          customData: qrCustomData,
        });

        const qrDataUri = qrEnabled
          ? await buildQrCodeDataUri(qrRawValue)
          : '';

        let bodySource = bodyTemplate;

        if (messageMode === 'html' && qrEnabled) {
          bodySource = bodySource.replace(
            /\{QRCode\}/gi,
            qrDataUri
          );
        }

        if (messageMode === 'html' && logoDevEnabled) {
          const companyLogoUrl = buildLogoDevUrl({
            domain: recipientDomain,
            publishableKey: logoDevKey,
            size: logoDevSize,
            format: logoDevFormat,
            theme: logoDevTheme,
          });

          bodySource = bodySource.replace(
            /\{CompanyLogo\}/gi,
            companyLogoUrl
          );

        }

        const body = placeholders(
          bodySource,
          recipient,
          originalFilename,
          {
            attachmentLink,
            ctaLink,
          }
        );

        let resolvedAttachment:
          | {
              filename: string;
              mimeType: string;
              bytes: Buffer;
            }
          | null = null;

        if (attachmentEnabled) {
          if (
            attachmentMode === 'upload' &&
            attachmentBytes &&
            originalFilename
          ) {
            resolvedAttachment = {
              filename: sanitizeFilename(
                placeholders(
                  attachmentNameTemplate,
                  recipient,
                  originalFilename,
                  {
                    attachmentLink,
                    ctaLink,
                  }
                )
              ),
              mimeType: attachmentMimeType,
              bytes: attachmentBytes,
            };
          } else if (attachmentMode !== 'upload') {
            let generatedHtml = attachmentHtml;

            if (logoDevEnabled) {
              const attachmentLogoUrl = buildLogoDevUrl({
                domain: recipientDomain,
                publishableKey: logoDevKey,
                size: logoDevSize,
                format: logoDevFormat,
                theme: logoDevTheme,
              });

              generatedHtml = generatedHtml.replace(
                /\{CompanyLogo\}/gi,
                attachmentLogoUrl
              );
            }

            if (qrEnabled) {
              generatedHtml = generatedHtml.replace(
                /\{QRCode\}/gi,
                qrDataUri
              );
            }

            generatedHtml = placeholders(
              generatedHtml,
              recipient,
              '',
              {
                attachmentLink,
                ctaLink,
              }
            );

            let generatedBytes: Buffer;
            let generatedExt: string;
            let generatedMimeType: string;

            if (attachmentMode === 'html-pdf') {
              generatedBytes =
                await htmlToPdfBuffer(generatedHtml);
              generatedExt = 'pdf';
              generatedMimeType = 'application/pdf';
            } else if (attachmentMode === 'html-pptx') {
              generatedBytes =
                await htmlToPptxBuffer(generatedHtml);
              generatedExt = 'pptx';
              generatedMimeType =
                'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            } else if (attachmentMode === 'html-docx') {
              generatedBytes =
                await htmlToDocxBuffer(generatedHtml);
              generatedExt = 'docx';
              generatedMimeType =
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            } else {
              generatedBytes =
                htmlToSvgBuffer(generatedHtml);
              generatedExt = 'svg';
              generatedMimeType = 'image/svg+xml';
            }

            const generatedBaseName =
              `${recipientDomain || 'document'}-Document.${generatedExt}`;

            let resolvedFilename = placeholders(
              attachmentNameTemplate,
              recipient,
              generatedBaseName,
              {
                attachmentLink,
                ctaLink,
              }
            );

            // Ensure the chosen converter's actual extension wins.
            resolvedFilename = resolvedFilename.replace(
              /\.[A-Za-z0-9]+$/,
              `.${generatedExt}`
            );

            if (!/\.[A-Za-z0-9]+$/.test(resolvedFilename)) {
              resolvedFilename += `.${generatedExt}`;
            }

            resolvedAttachment = {
              filename: sanitizeFilename(resolvedFilename),
              mimeType: generatedMimeType,
              bytes: generatedBytes,
            };
          }
        }

        const resolvedFromName = placeholders(
          fromName,
          recipient,
          originalFilename,
          {
            attachmentLink,
            ctaLink,
          }
        );

        const mime = buildMimeMessage({
          from: authorized.email,
          fromName: resolvedFromName,
          replyTo,
          to: recipient,
          subject,
          body,
          messageMode,
          attachment: resolvedAttachment,
        });

        const response = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${authorized.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              raw: base64Url(mime),
            }),
          }
        );

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
          throw new Error(
            data.error?.message ||
              `Gmail API send failed: HTTP ${response.status}`
          );
        }

        const messageId = String(data.id || '');

        if (!messageId) {
          throw new Error(
            'Gmail reported a successful send but did not return a message ID.'
          );
        }

        results.push({
          index: index + 1,
          total: recipients.length,
          recipient,
          accountEmail: authorized.email,
          success: true,
          messageId,
        });
      } catch (error) {
        results.push({
          index: index + 1,
          total: recipients.length,
          recipient,
          accountEmail: authorized.email,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const sentCount = results.filter((item) => item.success).length;
    const failedCount = results.length - sentCount;

    return NextResponse.json({
      success: failedCount === 0,
      sentCount,
      failedCount,
      results,
      accountUsage: plan.map((item) => ({
        email: item.email,
        used: item.used,
        maxSends: item.maxSends,
      })),
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
