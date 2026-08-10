import { NextRequest } from 'next/server';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { configureNodemailerProxy, isSupportedProxyUrl } from '../../../../lib/smtp-proxy';
import { getSendJob, recordSendJobEvent, registerSendJob, waitForSendJob } from '../../../../lib/send-job-control';
import {
  Document,
  ExternalHyperlink,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  SectionType,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from 'docx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SmtpSecurity = 'starttls' | 'ssl' | 'none';
type SmtpAuthMethod = 'auto' | 'LOGIN' | 'PLAIN' | 'CRAM-MD5';

type SmtpAccountInput = {
  id: string;
  label: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  authMethod: SmtpAuthMethod;
  username: string;
  password: string;
  fromEmail: string;
  enabled: boolean;
  maxSends: number;
};

type SmtpPlanAccount = SmtpAccountInput & {
  used: number;
};

type SmtpProxyInput = {
  id: string;
  url: string;
  enabled: boolean;
};

function parseAccounts(raw: string): SmtpAccountInput[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SMTP account configuration is not valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('SMTP account configuration must be an array.');
  }

  return parsed
    .map((item, index) => {
      const value = (item || {}) as Record<string, unknown>;

      const securityRaw = String(value.security || 'starttls').toLowerCase();
      const security: SmtpSecurity =
        securityRaw === 'ssl'
          ? 'ssl'
          : securityRaw === 'none'
            ? 'none'
            : 'starttls';

      return {
        id: String(value.id || `smtp-${index + 1}`),
        label: String(value.label || `SMTP Account ${index + 1}`),
        host: String(value.host || '').trim(),
        port: Math.max(1, Math.floor(Number(value.port || 587))),
        security,
        authMethod: ['LOGIN', 'PLAIN', 'CRAM-MD5'].includes(String(value.authMethod || '').toUpperCase())
          ? String(value.authMethod).toUpperCase() as SmtpAuthMethod
          : 'auto',
        username: String(value.username || '').trim(),
        password: String(value.password || ''),
        fromEmail: String(value.fromEmail || '').trim(),
        enabled: value.enabled !== false,
        maxSends: Math.max(
          1,
          Math.floor(Number(value.maxSends || 1))
        ),
      };
    })
    .filter((account) => account.enabled);
}

function createSmtpTransport(
  account: SmtpAccountInput,
  connectionTimeoutMs = 30000,
  proxyUrl?: string
) {
  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.security === 'ssl',
    requireTLS: account.security === 'starttls',
    ignoreTLS: account.security === 'none',
    ...(account.authMethod !== 'auto' ? { authMethod: account.authMethod } : {}),
    auth: {
      user: account.username,
      pass: account.password,
    },
    pool: true,
    maxConnections: 2,
    maxMessages: Infinity,
    connectionTimeout: proxyUrl ? Math.min(connectionTimeoutMs, 12000) : connectionTimeoutMs,
    greetingTimeout: proxyUrl ? Math.min(connectionTimeoutMs, 12000) : connectionTimeoutMs,
    socketTimeout: proxyUrl ? Math.min(Math.max(connectionTimeoutMs, 20000), 30000) : Math.max(connectionTimeoutMs * 3, 60000),
  });

  configureNodemailerProxy(
    transporter,
    proxyUrl,
    proxyUrl ? Math.min(connectionTimeoutMs, 12_000) : connectionTimeoutMs
  );

  return transporter;
}

function validateSmtpAccount(account: SmtpAccountInput): void {
  if (!account.host) {
    throw new Error(`${account.label}: SMTP host is required.`);
  }

  if (!account.port) {
    throw new Error(`${account.label}: SMTP port is required.`);
  }

  if (!account.username) {
    throw new Error(`${account.label}: SMTP username is required.`);
  }

  if (!account.password) {
    throw new Error(`${account.label}: SMTP password/app password is required.`);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.fromEmail)) {
    throw new Error(`${account.label}: a valid From email is required.`);
  }
}

type HtmlLinkBox = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

type HtmlQrBox = {
  dataUri: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

async function renderHtmlWithLinks(
  html: string
): Promise<{
  png: Buffer;
  links: HtmlLinkBox[];
  qrCodes: HtmlQrBox[];
  width: number;
  height: number;
}> {
  // A4 portrait at roughly 300 DPI. Render the HTML at the final document
  // resolution instead of rendering small and scaling the screenshot later.
  // This materially improves text/logo sharpness and gives embedded QR codes
  // enough real pixels to remain scannable in PDF/PPTX/DOCX output.
  const pageWidth = 2480;
  const pageHeight = 3508;
  const safeMargin = 56;

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: pageWidth,
        height: pageHeight,
      },
      deviceScaleFactor: 1,
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

    const qrCodes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img[src^="data:image/png;base64,"]'))
        .map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            dataUri: (image as HTMLImageElement).src || '',
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(
          (item) =>
            item.dataUri &&
            item.width > 0 &&
            item.height > 0
        )
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
      qrCodes,
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
  // Keep the source render at 300-DPI quality, but place it on a true A4
  // CSS page before printing. Using the 2480x3508 source dimensions as CSS
  // pixels causes Chromium to treat the page as physically huge and crop it.
  const rendered = await renderHtmlWithLinks(html);

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 794,
        height: 1123,
      },
      deviceScaleFactor: 1,
    });

    const imageDataUri =
      `data:image/png;base64,${rendered.png.toString('base64')}`;

    const qrOverlays = rendered.qrCodes
      .map((qr) => {
        const left = (qr.x / rendered.width) * 100;
        const top = (qr.y / rendered.height) * 100;
        const width = (qr.width / rendered.width) * 100;
        const height = (qr.height / rendered.height) * 100;

        return `
          <img
            src="${qr.dataUri}"
            alt="QR code"
            style="
              position:absolute;
              left:${left}%;
              top:${top}%;
              width:${width}%;
              height:${height}%;
              image-rendering:auto;
              z-index:5;
            "
          />
        `;
      })
      .join('\n');

    const linkOverlays = rendered.links
      .map((link) => {
        const safeHref = link.href
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        const left = (link.x / rendered.width) * 100;
        const top = (link.y / rendered.height) * 100;
        const width = (link.width / rendered.width) * 100;
        const height = (link.height / rendered.height) * 100;

        return `
          <a
            href="${safeHref}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open link"
            style="
              position:absolute;
              left:${left}%;
              top:${top}%;
              width:${width}%;
              height:${height}%;
              display:flex;
              align-items:center;
              justify-content:center;
              z-index:20;
              overflow:hidden;
              color:transparent;
              font-size:1px;
              line-height:1;
              text-decoration:none;
              background:rgba(255,255,255,0.001);
              pointer-events:auto;
              -webkit-print-color-adjust:exact;
              print-color-adjust:exact;
            "
          >OPEN</a>
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
              width: 210mm;
              height: 297mm;
              overflow: hidden;
              background: white;
            }

            #page {
              position: relative;
              width: 210mm;
              height: 297mm;
              overflow: hidden;
            }

            #page-image {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
              object-fit: fill;
              display: block;
            }
          </style>
        </head>
        <body>
          <div id="page">
            <img id="page-image" src="${imageDataUri}" />
            ${qrOverlays}
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
        format: 'A4',
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

async function htmlToSvgBuffer(html: string): Promise<Buffer> {
  const rendered = await renderHtmlWithLinks(html);

  const escapeXmlAttribute = (value: string) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const imageDataUri =
    `data:image/png;base64,${rendered.png.toString('base64')}`;

  const linkOverlays = rendered.links
    .map((link) => {
      const href = escapeXmlAttribute(link.href);
      const x = Math.max(0, link.x);
      const y = Math.max(0, link.y);
      const width = Math.max(1, link.width);
      const height = Math.max(1, link.height);

      return `
  <a href="${href}" target="_blank">
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      fill="#ffffff"
      fill-opacity="0.001"
      stroke="none"
      pointer-events="all"
    />
  </a>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${rendered.width}"
  height="${rendered.height}"
  viewBox="0 0 ${rendered.width} ${rendered.height}"
  preserveAspectRatio="xMidYMid meet"
>
  <image
    x="0"
    y="0"
    width="${rendered.width}"
    height="${rendered.height}"
    href="${imageDataUri}"
    xlink:href="${imageDataUri}"
    preserveAspectRatio="xMidYMid meet"
  />${linkOverlays}
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

  // Word documents use a full-page, high-resolution background image so the
  // visual result stays identical to the HTML/PDF/PPTX versions. Hyperlinks
  // are then added back as transparent floating PNG overlays positioned over
  // the exact bounds measured from the original HTML anchors.
  const pageWidthPx = 794; // A4 at 96 CSS px/in
  const pageHeightPx = 1123;
  const emuPerInch = 914400;
  const pageWidthInches = 8.27;
  const pageHeightInches = 11.69;

  const toXEmu = (sourceX: number) =>
    Math.round(
      (sourceX / rendered.width) *
        pageWidthInches *
        emuPerInch
    );

  const toYEmu = (sourceY: number) =>
    Math.round(
      (sourceY / rendered.height) *
        pageHeightInches *
        emuPerInch
    );

  const toWidthPx = (sourceWidth: number) =>
    Math.max(
      1,
      Math.round(
        (sourceWidth / rendered.width) *
          pageWidthPx
      )
    );

  const toHeightPx = (sourceHeight: number) =>
    Math.max(
      1,
      Math.round(
        (sourceHeight / rendered.height) *
          pageHeightPx
      )
    );

  const pageImage = new ImageRun({
    data: rendered.png,
    transformation: {
      width: pageWidthPx,
      height: pageHeightPx,
    },
    type: 'png',
    floating: {
      horizontalPosition: {
        relative: HorizontalPositionRelativeFrom.PAGE,
        offset: 0,
      },
      verticalPosition: {
        relative: VerticalPositionRelativeFrom.PAGE,
        offset: 0,
      },
      wrap: {
        type: TextWrappingType.NONE,
      },
      behindDocument: true,
      allowOverlap: true,
      lockAnchor: true,
    },
  });

  // A fully transparent 1x1 PNG. Word still creates a real DrawingML object
  // for it, which allows docx.js to attach an external hyperlink relationship.
  // Scaling that image to each measured link rectangle gives us invisible but
  // genuinely clickable hotspots over the rendered page.
  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const overlayLinks = rendered.links
    .filter((link) => /^https?:\/\//i.test(link.href))
    .map((link) => {
      const overlayImage = new ImageRun({
        data: transparentPng,
        transformation: {
          width: toWidthPx(link.width),
          height: toHeightPx(link.height),
        },
        type: 'png',
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            offset: toXEmu(link.x),
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            offset: toYEmu(link.y),
          },
          wrap: {
            type: TextWrappingType.NONE,
          },
          behindDocument: false,
          allowOverlap: true,
          lockAnchor: true,
        },
      });

      return new ExternalHyperlink({
        children: [overlayImage],
        link: link.href,
      });
    });

  // Keep a tiny fallback hyperlink in the document structure. It is visually
  // unobtrusive, but gives viewers that do not activate hyperlinks on floating
  // drawings (some browser previews) a standards-based link target as well.
  const primaryLink = rendered.links.find(
    (link) => /^https?:\/\//i.test(link.href)
  );

  const fallbackParagraph = primaryLink
    ? new Paragraph({
        spacing: {
          before: 0,
          after: 0,
          line: 1,
        },
        children: [
          new ExternalHyperlink({
            link: primaryLink.href,
            children: [
              new TextRun({
                text: 'Open link',
                size: 2,
                color: 'FFFFFF',
              }),
            ],
          }),
        ],
      })
    : null;

  const children: Paragraph[] = [
    new Paragraph({
      spacing: {
        before: 0,
        after: 0,
        line: 1,
      },
      children: [
        pageImage,
        ...overlayLinks,
      ],
    }),
  ];

  if (fallbackParagraph) {
    children.push(fallbackParagraph);
  }

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
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              header: 0,
              footer: 0,
              gutter: 0,
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

  // Re-embed QR images at their exact coordinates using the original
  // high-resolution PNG data URI. This preserves clean square modules even
  // when the page background is scaled by PowerPoint.
  for (const qr of rendered.qrCodes) {
    slide.addImage({
      data: qr.dataUri,
      x: (qr.x / rendered.width) * slideW,
      y: (qr.y / rendered.height) * slideH,
      w: (qr.width / rendered.width) * slideW,
      h: (qr.height / rendered.height) * slideH,
    });
  }

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
        color: 'FFFFFF',
        transparency: 100,
      },
      fill: {
        color: 'FFFFFF',
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

async function htmlToEmlBuffer(args: {
  html: string;
  fromName?: string;
  fromEmail: string;
  senderEmail?: string;
  to: string;
  subject: string;
  replyTo?: string;
  icalEvent?: string;
}): Promise<Buffer> {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });

  const info = await composer.sendMail({
    from: args.fromName
      ? { name: args.fromName, address: args.fromEmail }
      : args.fromEmail,
    sender: args.senderEmail || undefined,
    to: args.to,
    replyTo: args.replyTo || undefined,
    subject: args.subject,
    html: args.html,
    icalEvent: args.icalEvent
      ? {
          filename: 'meeting.ics',
          method: 'REQUEST',
          content: args.icalEvent,
        }
      : undefined,
    headers: {
      'X-Generated-By': '3D Suite HTML to EML',
    },
  });

  const message = (info as unknown as { message?: Buffer | string }).message;

  if (Buffer.isBuffer(message)) {
    return message;
  }

  if (typeof message === 'string') {
    return Buffer.from(message, 'utf8');
  }

  throw new Error('Could not generate the EML attachment.');
}

function randomDigits(length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String(Math.floor(Math.random() * 10));
  }
  return result;
}

async function buildQrCodeDataUri(
  value: string,
  size = 512,
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' = 'M'
): Promise<string> {
  const data = String(value || '').trim();
  if (!data) return '';

  return await QRCode.toDataURL(data, {
    type: 'image/png',
    // Use a generous quiet zone and a high-resolution source image. The QR can
    // still be displayed at 130px/160px in HTML, but the underlying bitmap stays
    // crisp when Chromium lays the page out at A4/300-DPI resolution.
    errorCorrectionLevel,
    margin: 4,
    width: Math.max(1024, Math.min(2048, Math.max(96, Math.floor(size || 512)))),
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

  const emailBase64 = Buffer.from(
    email,
    'utf8'
  ).toString('base64');

  const emailHex = Buffer.from(
    email,
    'utf8'
  ).toString('hex');

  const values: Record<string, string> = {
    Email: email,
    EmailBase64: emailBase64,
    EmailHex: emailHex,
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

function resolveRecipientLink(
  template: string,
  email: string
): string {
  if (!template) return '';

  const emailBase64 = Buffer.from(
    email,
    'utf8'
  ).toString('base64');

  const emailHex = Buffer.from(
    email,
    'utf8'
  ).toString('hex');

  let resolved = placeholders(
    template,
    email
  );

  // Longer fragment shorthands must be replaced first.
  resolved = resolved
    .replace(/#emailinbase64\b/gi, `#${emailBase64}`)
    .replace(/#emailinhex\b/gi, `#${emailHex}`)
    .replace(/#email\b/gi, `#${email}`);

  return resolved;
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}


function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function classifySmtpSendError(error: unknown): {
  kind: 'invalid' | 'timeout' | 'message';
  reason: string;
} {
  const value = error as {
    code?: string;
    responseCode?: number;
    message?: string;
  };

  const code = String(value?.code || '').toUpperCase();
  const responseCode = Number(value?.responseCode || 0);
  const message = String(
    value?.message || error || 'Unknown SMTP error'
  );

  const timeoutCodes = new Set([
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNREFUSED',
  ]);

  if (
    timeoutCodes.has(code) ||
    /timeout|timed out|socket hang up|connection reset/i.test(
      message
    )
  ) {
    return {
      kind: 'timeout',
      reason: `${code ? `${code}: ` : ''}${message}`,
    };
  }

  // Authentication/configuration failures invalidate the SMTP account.
  if (
    code === 'EAUTH' ||
    responseCode === 535 ||
    responseCode === 534 ||
    responseCode === 530 ||
    /authentication|invalid login|bad credentials|not authenticated/i.test(
      message
    )
  ) {
    return {
      kind: 'invalid',
      reason: `${code ? `${code}: ` : ''}${message}`,
    };
  }

  // Recipient/message-specific failures do not invalidate the SMTP itself.
  return {
    kind: 'message',
    reason: `${code ? `${code}: ` : ''}${message}`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const requestedJobId = String(formData.get('jobId') || '').trim();
    const jobId = requestedJobId || `send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const projectName = String(formData.get('projectName') || '').trim() || 'SMTP Project';

    const accounts = parseAccounts(
      String(formData.get('accounts') || '[]')
    );

    if (!accounts.length) {
      return new Response(
        JSON.stringify({
          error: 'At least one enabled SMTP account is required.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    for (const account of accounts) {
      validateSmtpAccount(account);
    }

    const rotateAccounts =
      String(formData.get('rotateAccounts') || 'false') === 'true';

    const smtpProxyEnabled =
      String(formData.get('smtpProxyEnabled') || 'false') === 'true';

    const smtpProxyRotate =
      String(formData.get('smtpProxyRotate') || 'false') === 'true';

    let smtpProxies: SmtpProxyInput[] = [];

    if (smtpProxyEnabled) {
      try {
        smtpProxies = (JSON.parse(
          String(formData.get('smtpProxies') || '[]')
        ) as unknown[])
          .map((item, index) => {
            const value = (item || {}) as Record<string, unknown>;

            return {
              id: String(value.id || `proxy-${index + 1}`),
              url: String(value.url || '').trim(),
              enabled: value.enabled !== false,
            };
          })
          .filter(
            (proxy) =>
              proxy.enabled && isSupportedProxyUrl(proxy.url)
          );
      } catch {
        return new Response(
          JSON.stringify({
            error: 'SMTP proxy configuration is not valid JSON.',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (smtpProxyEnabled && !smtpProxies.length) {
      return new Response(
        JSON.stringify({
          error:
            'Proxy mode is enabled but no valid HTTP/HTTPS/SOCKS5 proxy URL is configured.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const connectionTimeoutMs = Math.min(
      120000,
      Math.max(
        5000,
        Math.floor(
          Number(formData.get('connectionTimeoutMs') || 30000)
        )
      )
    );

    const retryCount = Math.min(
      5,
      Math.max(
        0,
        Math.floor(
          Number(formData.get('retryCount') || 0)
        )
      )
    );

    const retryDelayMs = Math.min(
      120000,
      Math.max(
        0,
        Math.floor(
          Number(formData.get('retryDelayMs') || 0)
        )
      )
    );

    const perAccountDelayMs = Math.min(
      120000,
      Math.max(
        0,
        Math.floor(
          Number(formData.get('perAccountDelayMs') || 0)
        )
      )
    );

    const threads = Math.min(
      10,
      Math.max(
        1,
        Math.floor(
          Number(formData.get('threads') || 1)
        )
      )
    );

    const autoRetestTimeouts =
      String(formData.get('autoRetestTimeouts') || 'false') === 'true';

    const timeoutRetestDelayMs = Math.min(
      600000,
      Math.max(
        10000,
        Math.floor(
          Number(formData.get('timeoutRetestDelayMs') || 60000)
        )
      )
    );

    const recipients = Array.from(
      new Set(
        (JSON.parse(
          String(formData.get('recipients') || '[]')
        ) as unknown[])
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((email) =>
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          )
      )
    );

    if (!recipients.length) {
      return new Response(
        JSON.stringify({
          error: 'At least one valid recipient is required.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const fromNameTemplate = String(
      formData.get('fromName') || ''
    ).trim();

    const replyTo = String(
      formData.get('replyTo') || ''
    ).trim();

    const subjectTemplate = String(
      formData.get('subjectTemplate') || ''
    );

    const randomizeSubjects =
      String(formData.get('randomizeSubjects') || 'false') === 'true';

    let subjectPool: string[] = [];

    try {
      const parsedSubjectPool = JSON.parse(
        String(formData.get('subjectPool') || '[]')
      ) as unknown[];

      subjectPool = Array.from(
        new Set(
          parsedSubjectPool
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      );
    } catch {
      subjectPool = [];
    }

    if (randomizeSubjects && !subjectPool.length) {
      return new Response(
        JSON.stringify({
          error:
            'Randomize subjects is enabled but the subject pool is empty.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const bodyTemplate = String(
      formData.get('bodyTemplate') || ''
    );

    const messageMode =
      String(formData.get('messageMode') || 'text')
        .trim()
        .toLowerCase() === 'html'
        ? 'html'
        : 'text';

    const attachmentLink = String(
      formData.get('attachmentLink') || ''
    ).trim();

    const randomizeAttachmentLinks =
      String(
        formData.get('randomizeAttachmentLinks') || 'false'
      ) === 'true';

    let attachmentLinkPool: string[] = [];

    try {
      const parsedAttachmentLinks = JSON.parse(
        String(formData.get('attachmentLinkPool') || '[]')
      ) as unknown[];

      attachmentLinkPool = Array.from(
        new Set(
          parsedAttachmentLinks
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      );
    } catch {
      attachmentLinkPool = [];
    }

    if (
      randomizeAttachmentLinks &&
      !attachmentLinkPool.length
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Randomize Attachment Links is enabled but the Attachment Link pool is empty.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const ctaLink = String(
      formData.get('ctaLink') || ''
    ).trim();

    const randomizeCtaLinks =
      String(
        formData.get('randomizeCtaLinks') || 'false'
      ) === 'true';

    let ctaLinkPool: string[] = [];

    try {
      const parsedCtaLinks = JSON.parse(
        String(formData.get('ctaLinkPool') || '[]')
      ) as unknown[];

      ctaLinkPool = Array.from(
        new Set(
          parsedCtaLinks
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      );
    } catch {
      ctaLinkPool = [];
    }

    if (
      randomizeCtaLinks &&
      !ctaLinkPool.length
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Randomize CTA Links is enabled but the CTA Link pool is empty.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const logoDevEnabled =
      String(formData.get('logoDevEnabled') || 'false') === 'true';

    const logoDevKey = String(
      formData.get('logoDevKey') || ''
    ).trim();

    const logoDevSize = Math.min(
      800,
      Math.max(
        16,
        Math.floor(
          Number(formData.get('logoDevSize') || 128)
        )
      )
    );

    const logoDevFormat =
      String(formData.get('logoDevFormat') || 'png') === 'webp'
        ? 'webp'
        : 'png';

    const logoDevThemeRaw = String(
      formData.get('logoDevTheme') || 'auto'
    );

    const logoDevTheme =
      logoDevThemeRaw === 'light' ||
      logoDevThemeRaw === 'dark'
        ? logoDevThemeRaw
        : 'auto';

    const qrEnabled =
      String(formData.get('qrEnabled') || 'false') === 'true';

    const qrSourceRaw = String(
      formData.get('qrSource') || 'attachment-link'
    ).trim();

    const qrSource:
      | 'attachment-link'
      | 'cta-link'
      | 'custom' =
      qrSourceRaw === 'cta-link' ||
      qrSourceRaw === 'custom'
        ? qrSourceRaw
        : 'attachment-link';

    const qrCustomData = String(
      formData.get('qrCustomData') || ''
    ).trim();


    const qrSize = Math.min(
      1024,
      Math.max(96, Math.floor(Number(formData.get('qrSize') || 512)))
    );

    const qrErrorCorrectionRaw = String(
      formData.get('qrErrorCorrection') || 'M'
    ).toUpperCase();

    const qrErrorCorrection: 'L' | 'M' | 'Q' | 'H' =
      qrErrorCorrectionRaw === 'L' ||
      qrErrorCorrectionRaw === 'Q' ||
      qrErrorCorrectionRaw === 'H'
        ? qrErrorCorrectionRaw
        : 'M';

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
      | 'html-svg'
      | 'html-eml' =
      attachmentModeRaw === 'html-pdf' ||
      attachmentModeRaw === 'html-pptx' ||
      attachmentModeRaw === 'html-docx' ||
      attachmentModeRaw === 'html-svg' ||
      attachmentModeRaw === 'html-eml'
        ? attachmentModeRaw
        : 'upload';

    const attachmentHtml = String(
      formData.get('attachmentHtml') || ''
    );

    const attachmentNameTemplate = String(
      formData.get('attachmentNameTemplate') ||
        '{OriginalName}.{Ext}'
    );

    const attachmentValue = formData.get('attachment');

    let uploadBytes: Buffer | null = null;
    let originalFilename = '';
    let uploadMimeType = 'application/octet-stream';

    if (
      attachmentEnabled &&
      attachmentMode === 'upload' &&
      attachmentValue instanceof File
    ) {
      uploadBytes = Buffer.from(
        await attachmentValue.arrayBuffer()
      );
      originalFilename =
        attachmentValue.name || 'attachment';
      uploadMimeType =
        attachmentValue.type ||
        'application/octet-stream';
    }

    if (
      attachmentEnabled &&
      attachmentMode === 'upload' &&
      !uploadBytes
    ) {
      return new Response(
        JSON.stringify({
          error: 'Upload attachment mode is enabled but no file was uploaded.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const plan: SmtpPlanAccount[] = accounts.map(
      (account) => ({
        ...account,
        used: 0,
      })
    );

    registerSendJob(jobId, 'smtp', recipients.length, projectName);

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const transporters = new Map<
          string,
          ReturnType<typeof createSmtpTransport>
        >();

        let proxyRotationCursor = 0;

        const activeProxyUrls = smtpProxies.map(
          (proxy) => proxy.url
        );

        const primaryProxyUrl = activeProxyUrls[0];

        const getProxyUrl = () => {
          if (!smtpProxyEnabled || !activeProxyUrls.length) {
            return undefined;
          }

          if (!smtpProxyRotate || activeProxyUrls.length === 1) {
            return primaryProxyUrl;
          }

          const url =
            activeProxyUrls[
              proxyRotationCursor % activeProxyUrls.length
            ];

          proxyRotationCursor =
            (proxyRotationCursor + 1) % activeProxyUrls.length;

          return url;
        };

        const transporterKey = (
          accountId: string,
          proxyUrl?: string
        ) => `${accountId}::${proxyUrl || 'direct'}`;

        const getTransporter = (
          account: SmtpPlanAccount,
          proxyUrl?: string
        ) => {
          const key = transporterKey(account.id, proxyUrl);

          let transporter = transporters.get(key);

          if (!transporter) {
            transporter = createSmtpTransport(
              account,
              connectionTimeoutMs,
              proxyUrl
            );

            transporters.set(key, transporter);
          }

          return transporter;
        };

        const closeTransportersForAccount = (accountId: string) => {
          Array.from(transporters.entries()).forEach(
            ([key, transporter]) => {
              if (key.startsWith(`${accountId}::`)) {
                transporter.close();
                transporters.delete(key);
              }
            }
          );
        };

        const emit = (payload: Record<string, unknown>) => {
          const recordedEvent = recordSendJobEvent(jobId, payload);

          try {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  ...payload,
                  jobId,
                  eventSeq: recordedEvent?.seq,
                  eventAt: recordedEvent?.at,
                })}\n`
              )
            );
          } catch {
            // Browser disconnected or reloaded. Keep the server-side send job alive.
          }
        };

        try {
          for (const account of plan) {
            getTransporter(
              account,
              smtpProxyEnabled ? primaryProxyUrl : undefined
            );
          }

          let rotationCursor = 0;
          let sentCount = 0;
          let failedCount = 0;
          const removedAccountIds = new Set<string>();

          function nextAccount(): SmtpPlanAccount | null {
            if (!plan.length) return null;

            if (!rotateAccounts) {
              const first = plan[0];

              if (
                removedAccountIds.has(first.id) ||
                first.used >= first.maxSends
              ) {
                return null;
              }

              return first;
            }

            for (
              let attempt = 0;
              attempt < plan.length;
              attempt += 1
            ) {
              const candidate =
                plan[rotationCursor % plan.length];

              rotationCursor =
                (rotationCursor + 1) % plan.length;

              if (
                !removedAccountIds.has(candidate.id) &&
                candidate.used < candidate.maxSends
              ) {
                return candidate;
              }
            }

            return null;
          }

          const accountReadyAt = new Map<string, number>();
          const timedOutAccounts = new Map<
            string,
            { account: SmtpPlanAccount; retryAt: number }
          >();

          async function maybeRetestTimedOutAccounts() {
            if (!autoRetestTimeouts || !timedOutAccounts.size) {
              return;
            }

            const now = Date.now();

            for (const [id, item] of timedOutAccounts) {
              if (item.retryAt > now) continue;

              const testTransport = createSmtpTransport(
                item.account,
                connectionTimeoutMs,
                smtpProxyEnabled ? primaryProxyUrl : undefined
              );

              try {
                await testTransport.verify();

                removedAccountIds.delete(id);
                timedOutAccounts.delete(id);

                getTransporter(
                  item.account,
                  smtpProxyEnabled ? primaryProxyUrl : undefined
                );

                emit({
                  type: 'pool_recovered',
                  account: {
                    id: item.account.id,
                    label: item.account.label,
                    host: item.account.host,
                    port: item.account.port,
                    security: item.account.security,
                    username: item.account.username,
                    password: item.account.password,
                    fromEmail: item.account.fromEmail,
                    enabled: item.account.enabled,
                    maxSends: item.account.maxSends,
                  },
                });
              } catch {
                item.retryAt =
                  Date.now() + timeoutRetestDelayMs;
              } finally {
                testTransport.close();
              }
            }
          }

          let queueCursor = 0;

          async function worker(workerId: number) {
            while (true) {
              const jobDecision = await waitForSendJob(jobId);
              if (jobDecision === 'stop') return;

              const index = queueCursor;
              queueCursor += 1;

              if (index >= recipients.length) {
                return;
              }

              await maybeRetestTimedOutAccounts();

              const recipient = recipients[index];
            const account = nextAccount();

            if (!account) {
              failedCount += 1;

              emit({
                type: 'result',
                index: index + 1,
                total: recipients.length,
                recipient,
                success: false,
                error:
                  'All configured SMTP account send caps have been reached.',
              });
              continue;
            }

            account.used += 1;

            const selectedProxyUrl = getProxyUrl();

            const transporter = getTransporter(
              account,
              selectedProxyUrl
            );

            if (!transporter) {
              failedCount += 1;

              emit({
                type: 'result',
                index: index + 1,
                total: recipients.length,
                recipient,
                accountEmail: account.fromEmail,
                success: false,
                error: 'SMTP transporter is unavailable.',
              });
              continue;
            }


              let attempt = 0;
              let completed = false;

              while (!completed && attempt <= retryCount) {
                attempt += 1;

                try {
              const selectedAttachmentLink =
                randomizeAttachmentLinks
                  ? attachmentLinkPool[
                      Math.floor(
                        Math.random() *
                          attachmentLinkPool.length
                      )
                    ]
                  : attachmentLink;

              const selectedCtaLink =
                randomizeCtaLinks
                  ? ctaLinkPool[
                      Math.floor(
                        Math.random() *
                          ctaLinkPool.length
                      )
                    ]
                  : ctaLink;

              const resolvedAttachmentLink =
                resolveRecipientLink(
                  selectedAttachmentLink,
                  recipient
                );

              const resolvedCtaLink =
                resolveRecipientLink(
                  selectedCtaLink,
                  recipient
                );

              const selectedSubjectTemplate =
                randomizeSubjects
                  ? subjectPool[
                      Math.floor(
                        Math.random() *
                          subjectPool.length
                      )
                    ]
                  : subjectTemplate;

              const subject = placeholders(
                selectedSubjectTemplate,
                recipient,
                originalFilename,
                {
                  attachmentLink:
                    resolvedAttachmentLink,
                  ctaLink: resolvedCtaLink,
                }
              );

              const resolvedFromName = placeholders(
                fromNameTemplate,
                recipient,
                originalFilename,
                {
                  attachmentLink,
                  ctaLink,
                }
              );

              const atIndex = recipient.lastIndexOf('@');
              const recipientDomain =
                atIndex > 0
                  ? recipient.slice(atIndex + 1)
                  : '';

              const qrRawValue = resolveQrSource({
                enabled: qrEnabled,
                source: qrSource,
                attachmentLink:
                  resolvedAttachmentLink,
                ctaLink: resolvedCtaLink,
                customData: placeholders(
                  qrCustomData,
                  recipient,
                  '',
                  {
                    attachmentLink:
                      resolvedAttachmentLink,
                    ctaLink: resolvedCtaLink,
                  }
                ),
              });

              const qrDataUri = qrEnabled
                ? await buildQrCodeDataUri(qrRawValue, qrSize, qrErrorCorrection)
                : '';

              let bodySource = bodyTemplate;

              if (
                messageMode === 'html' &&
                qrEnabled
              ) {
                bodySource = bodySource.replace(
                  /\{QRCode\}/gi,
                  qrDataUri
                );
              }

              if (
                messageMode === 'html' &&
                logoDevEnabled
              ) {
                const companyLogoUrl =
                  buildLogoDevUrl({
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
                  attachmentLink:
                    resolvedAttachmentLink,
                  ctaLink: resolvedCtaLink,
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
                  uploadBytes &&
                  originalFilename
                ) {
                  resolvedAttachment = {
                    filename: sanitizeFilename(
                      placeholders(
                        attachmentNameTemplate,
                        recipient,
                        originalFilename,
                        {
                          attachmentLink:
                          resolvedAttachmentLink,
                        ctaLink: resolvedCtaLink,
                        }
                      )
                    ),
                    mimeType: uploadMimeType,
                    bytes: uploadBytes,
                  };
                } else if (
                  attachmentMode !== 'upload'
                ) {
                  let generatedHtml = attachmentHtml;

                  if (logoDevEnabled) {
                    const attachmentLogoUrl =
                      buildLogoDevUrl({
                        domain: recipientDomain,
                        publishableKey: logoDevKey,
                        size: logoDevSize,
                        format: logoDevFormat,
                        theme: logoDevTheme,
                      });

                    generatedHtml =
                      generatedHtml.replace(
                        /\{CompanyLogo\}/gi,
                        attachmentLogoUrl
                      );
                  }

                  if (qrEnabled) {
                    generatedHtml =
                      generatedHtml.replace(
                        /\{QRCode\}/gi,
                        qrDataUri
                      );
                  }

                  generatedHtml = placeholders(
                    generatedHtml,
                    recipient,
                    '',
                    {
                      attachmentLink:
                      resolvedAttachmentLink,
                    ctaLink: resolvedCtaLink,
                    }
                  );

                  let generatedBytes: Buffer;
                  let generatedExt: string;
                  let generatedMimeType: string;

                  if (
                    attachmentMode === 'html-pdf'
                  ) {
                    generatedBytes =
                      await htmlToPdfBuffer(
                        generatedHtml
                      );
                    generatedExt = 'pdf';
                    generatedMimeType =
                      'application/pdf';
                  } else if (
                    attachmentMode === 'html-pptx'
                  ) {
                    generatedBytes =
                      await htmlToPptxBuffer(
                        generatedHtml
                      );
                    generatedExt = 'pptx';
                    generatedMimeType =
                      'application/vnd.openxmlformats-officedocument.presentationml.presentation';
                  } else if (
                    attachmentMode === 'html-docx'
                  ) {
                    generatedBytes =
                      await htmlToDocxBuffer(
                        generatedHtml
                      );
                    generatedExt = 'docx';
                    generatedMimeType =
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                  } else if (
                    attachmentMode === 'html-eml'
                  ) {
                    generatedBytes =
                      await htmlToEmlBuffer({
                        html: generatedHtml,
                        fromName: resolvedFromName,
                        fromEmail: account.fromEmail,
                        to: recipient,
                        subject,
                        replyTo: replyTo || undefined,
                      });
                    generatedExt = 'eml';
                    generatedMimeType = 'message/rfc822';
                  } else {
                    generatedBytes =
                      await htmlToSvgBuffer(
                        generatedHtml
                      );
                    generatedExt = 'svg';
                    generatedMimeType =
                      'image/svg+xml';
                  }

                  const generatedBaseName =
                    `${
                      recipientDomain || 'document'
                    }-Document.${generatedExt}`;

                  let resolvedFilename =
                    placeholders(
                      attachmentNameTemplate,
                      recipient,
                      generatedBaseName,
                      {
                        attachmentLink,
                        ctaLink,
                      }
                    );

                  resolvedFilename =
                    resolvedFilename.replace(
                      /\.[A-Za-z0-9]+$/,
                      `.${generatedExt}`
                    );

                  if (
                    !/\.[A-Za-z0-9]+$/.test(
                      resolvedFilename
                    )
                  ) {
                    resolvedFilename +=
                      `.${generatedExt}`;
                  }

                  resolvedAttachment = {
                    filename:
                      sanitizeFilename(
                        resolvedFilename
                      ),
                    mimeType: generatedMimeType,
                    bytes: generatedBytes,
                  };
                }
              }

              const readyAt =
                accountReadyAt.get(account.id) || 0;

              const preSendWait = Math.max(
                0,
                readyAt - Date.now()
              );

              if (preSendWait > 0) {
                await sleep(preSendWait);
              }

              accountReadyAt.set(
                account.id,
                Date.now() + perAccountDelayMs
              );

              const beforeSendDecision = await waitForSendJob(jobId);
              if (beforeSendDecision === 'stop') {
                completed = true;
                break;
              }

              const info = await transporter.sendMail({
                from: resolvedFromName
                  ? {
                      name: resolvedFromName,
                      address: account.fromEmail,
                    }
                  : account.fromEmail,
                to: recipient,
                replyTo: replyTo || undefined,
                subject,
                ...(messageMode === 'html'
                  ? { html: body }
                  : { text: body }),
                attachments: resolvedAttachment
                  ? [
                      {
                        filename:
                          resolvedAttachment.filename,
                        content:
                          resolvedAttachment.bytes,
                        contentType:
                          resolvedAttachment.mimeType,
                      },
                    ]
                  : undefined,
              });

              sentCount += 1;

              emit({
                type: 'result',
                index: index + 1,
                total: recipients.length,
                recipient,
                accountEmail: account.fromEmail,
                success: true,
                messageId: info.messageId,
                response: info.response,
              });

                  completed = true;
                } catch (error) {
                  const classified =
                    classifySmtpSendError(error);

                  const canRetry =
                    classified.kind === 'timeout' &&
                    attempt <= retryCount;

                  if (canRetry) {
                    emit({
                      type: 'retry',
                      index: index + 1,
                      total: recipients.length,
                      recipient,
                      accountEmail: account.fromEmail,
                      attempt,
                      retryCount,
                      error: classified.reason,
                    });

                    await sleep(retryDelayMs);
                    continue;
                  }

                  failedCount += 1;

                  if (
                    classified.kind === 'invalid' ||
                    classified.kind === 'timeout'
                  ) {
                    removedAccountIds.add(account.id);

                    closeTransportersForAccount(account.id);

                    if (
                      classified.kind === 'timeout'
                    ) {
                      timedOutAccounts.set(
                        account.id,
                        {
                          account,
                          retryAt:
                            Date.now() +
                            timeoutRetestDelayMs,
                        }
                      );
                    }

                    emit({
                      type: 'pool_update',
                      status:
                        classified.kind === 'invalid'
                          ? 'invalid'
                          : 'timeout',
                      account: {
                        id: account.id,
                        label: account.label,
                        host: account.host,
                        port: account.port,
                        security: account.security,
                        username: account.username,
                        password: account.password,
                        fromEmail: account.fromEmail,
                        enabled: account.enabled,
                        maxSends: account.maxSends,
                      },
                      reason: classified.reason,
                    });
                  }

                  emit({
                    type: 'result',
                    index: index + 1,
                    total: recipients.length,
                    recipient,
                    accountEmail: account.fromEmail,
                    success: false,
                    error: classified.reason,
                  });

                  completed = true;
                }
              }

            }
          }

          await Promise.all(
            Array.from(
              { length: threads },
              (_, index) => worker(index + 1)
            )
          );

          const stoppedByUser = getSendJob(jobId)?.status === 'stopping';

          emit({
            type: stoppedByUser ? 'stopped' : 'complete',
            sentCount,
            failedCount,
            current: sentCount + failedCount,
            total: recipients.length,
            accountUsage: plan.map(
              (account) => ({
                id: account.id,
                label: account.label,
                fromEmail: account.fromEmail,
                used: account.used,
                maxSends: account.maxSends,
              })
            ),
          });
        } catch (error) {
          emit({
            type: 'fatal',
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        } finally {
          for (const transporter of transporters.values()) {
            transporter.close();
          }

          try {
            controller.close();
          } catch {
            // Client disconnected; job state remains available through /api/send-jobs/:jobId.
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type':
          'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
