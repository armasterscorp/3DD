import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, PDFTextField } from 'pdf-lib';
import {
  sendLeadViaWeTransfer,
  sendSequentialLeadBatchViaWeTransfer,
  WeTransferExecutionStep,
} from '@/lib/wetransfer-engine';
import {
  getWeTransferSessionLocal,
  setWeTransferSessionLocal,
  getBrowserProxyConfigLocal,
} from '@/lib/local-store';
import { getBrowserProxyDiagnostics } from '@/lib/browser-proxy';




type BatchPlaceholderValues = {
  Date: string;
  Time: string;
  DateTime: string;
  Reference: string;
  Random6: string;
  Random8: string;
  UUID: string;
  BatchId: string;
};

function randomDigits(length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String(Math.floor(Math.random() * 10));
  }
  return value;
}

function randomToken(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function createBatchPlaceholderValues(): BatchPlaceholderValues {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const dateTime = `${date} ${time}`;
  const uuid = crypto.randomUUID();

  return {
    Date: date,
    Time: time,
    DateTime: dateTime,
    Reference: `REF-${randomToken(8)}`,
    Random6: randomDigits(6),
    Random8: randomDigits(8),
    UUID: uuid,
    BatchId: `BATCH-${randomToken(8)}`,
  };
}

function replaceBatchPlaceholders(
  input: string,
  values: BatchPlaceholderValues
): string {
  let output = input;

  for (const [key, value] of Object.entries(values)) {
    output = output
      .replace(new RegExp(`\\\\{\\\\{${key}\\\\}\\\\}`, 'gi'), value)
      .replace(new RegExp(`\\\\{${key}\\\\}`, 'gi'), value);
  }

  return output;
}

function batchPlaceholderForField(
  fieldName: string,
  currentValue: string,
  values: BatchPlaceholderValues
): string | null {
  const candidates = [fieldName.trim(), currentValue.trim()];

  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(values)) {
      const normalized = candidate
        .replace(/^\{\{?/, '')
        .replace(/\}\}?$/, '')
        .trim()
        .toLowerCase();

      if (normalized === key.toLowerCase()) {
        return value;
      }
    }
  }

  return null;
}

async function replaceBatchPlaceholdersInPdfFormFields(
  pdfBuffer: Buffer,
  values: BatchPlaceholderValues
): Promise<{ buffer: Buffer; replacedCount: number }> {
  const pdf = await PDFDocument.load(pdfBuffer, {
    ignoreEncryption: false,
  });

  const form = pdf.getForm();
  const fields = form.getFields();
  let replacedCount = 0;

  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;

    const currentValue = field.getText() || '';
    const replacement = batchPlaceholderForField(
      field.getName(),
      currentValue,
      values
    );

    if (!replacement) continue;

    field.setText(replacement);
    replacedCount += 1;
  }

  if (replacedCount > 0) {
    // Flatten so the generated batch values are visible and no longer editable.
    form.flatten();
  }

  const bytes = await pdf.save();
  return {
    buffer: Buffer.from(bytes),
    replacedCount,
  };
}

function buildLeadContentPlaceholders(
  leadEmail: string,
  leadName: string,
  ctaLink: string,
  batchValues: BatchPlaceholderValues
): Record<string, string> {
  const email = leadEmail.trim();
  const at = email.lastIndexOf('@');
  const localPart = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at + 1) : '';
  const parts = domain.split('.').filter(Boolean);
  const domainName = parts[0] || domain;
  const tld = parts.length > 1 ? parts[parts.length - 1] : '';

  return {
    Email: email,
    email,
    LocalPart: localPart,
    localpart: localPart,
    Domain: domain,
    domain,
    DomainName: domainName,
    domainname: domainName,
    TLD: tld,
    tld,
    Name: leadName.trim(),
    name: leadName.trim(),
    Link: ctaLink.trim(),
    link: ctaLink.trim(),
    ...batchValues,
  };
}

function personalizeHtml(
  html: string,
  leadEmail: string,
  leadName: string,
  ctaLink: string,
  batchValues: BatchPlaceholderValues
): string {
  const values = buildLeadContentPlaceholders(
    leadEmail,
    leadName,
    ctaLink,
    batchValues
  );

  return html
    .replace(/\{\{([A-Za-z]+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : match
    )
    .replace(/\{([A-Za-z]+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : match
    );
}

async function htmlToPdfBuffer(
  html: string,
  leadEmail: string,
  leadName: string,
  ctaLink: string,
  batchValues: BatchPlaceholderValues
): Promise<Buffer> {
  const personalized = personalizeHtml(
    html,
    leadEmail,
    leadName,
    ctaLink,
    batchValues
  );
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });

    await page.setContent(personalized, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '12mm',
        right: '12mm',
        bottom: '12mm',
        left: '12mm',
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function splitOriginalFilename(filename: string): {
  originalFile: string;
  originalName: string;
  ext: string;
} {
  const clean = filename.trim() || 'attachment';
  const lastDot = clean.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === clean.length - 1) {
    return {
      originalFile: clean,
      originalName: clean,
      ext: '',
    };
  }

  return {
    originalFile: clean,
    originalName: clean.slice(0, lastDot),
    ext: clean.slice(lastDot + 1),
  };
}

function resolveAttachmentNameTemplate(
  template: string,
  originalFilename: string,
  leadEmail: string,
  leadName: string,
  batchValues: BatchPlaceholderValues
): string {
  const normalizedEmail = leadEmail.trim();
  const atIndex = normalizedEmail.lastIndexOf('@');
  const localPart = atIndex >= 0 ? normalizedEmail.slice(0, atIndex) : normalizedEmail;
  const domain = atIndex >= 0 ? normalizedEmail.slice(atIndex + 1) : '';
  const domainParts = domain.split('.').filter(Boolean);
  const domainName = domainParts[0] || domain;
  const tld = domainParts.length > 1 ? domainParts[domainParts.length - 1] : '';

  const {
    originalFile,
    originalName,
    ext,
  } = splitOriginalFilename(originalFilename);

  const replacements: Record<string, string> = {
    Email: normalizedEmail,
    email: normalizedEmail,
    LocalPart: localPart,
    localpart: localPart,
    Domain: domain,
    domain,
    DomainName: domainName,
    domainname: domainName,
    TLD: tld,
    tld,
    Name: leadName.trim(),
    name: leadName.trim(),
    OriginalName: originalName,
    originalname: originalName,
    OriginalFile: originalFile,
    originalfile: originalFile,
    Ext: ext,
    ext,
    ...batchValues,
  };

  let resolved = (template || '{OriginalFile}')
    .replace(
      /\{\{([A-Za-z]+)\}\}/g,
      (match, key: string) =>
        Object.prototype.hasOwnProperty.call(replacements, key)
          ? replacements[key]
          : match
    )
    .replace(
      /\{([A-Za-z]+)\}/g,
      (match, key: string) =>
        Object.prototype.hasOwnProperty.call(replacements, key)
          ? replacements[key]
          : match
    );

  // If the user omitted an extension entirely, preserve the uploaded file extension.
  if (ext && !/\.[A-Za-z0-9]{1,10}$/.test(resolved)) {
    resolved = `${resolved}.${ext}`;
  }

  // Keep useful filename characters, including spaces and @, while removing
  // characters that are invalid on Windows or unsafe as path separators.
  resolved = resolved
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return resolved || originalFile || 'attachment';
}

type AttachmentDebugPayload = {
  name: string;
  source: 'uploaded' | 'generated';
  mimeType: string | null;
  sizeBytes: number;
  ready: boolean;
};

type WeTransferSendLeadResponse = {
  success?: boolean;
  confirmationStatus?: 'confirmed' | 'failed';
  leadEmail?: string;
  transferUrl?: string | null;
  detail?: string | null;
  fileSource?: 'upload' | 'generated';
  filename?: string;
  attachmentBytes?: number;
  attachment?: AttachmentDebugPayload | null;
  steps?: WeTransferExecutionStep[];
  logs?: string[];
  mailboxUsed?: string | null;
  mailboxMessageCount?: number | null;
  latestError?: string | null;
  error?: string;
};

/**
 * POST /api/wetransfer/send-lead
 *
 * Send a file to a single lead using an existing WeTransfer session.
 *
 * REAL: Uploads and sends using live WeTransfer browser automation with confirmation-based status.
 *
 * Body: {
 *   campaignId: string;
 *   leadEmail: string;
 *   fileSource: 'upload' | 'generated';
 * }
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  let body: Record<string, unknown>;
  let uploadedFile: File | null = null;

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      body = Object.fromEntries(
        Array.from(formData.entries()).filter(([, value]) => typeof value === 'string')
      ) as Record<string, unknown>;
      const maybeFile = formData.get('uploadedFile');
      uploadedFile = maybeFile instanceof File ? maybeFile : null;
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const campaignId = body.campaignId ? String(body.campaignId).trim() : '';
  const leadEmail = body.leadEmail ? String(body.leadEmail).trim() : '';
  const leadName = body.leadName ? String(body.leadName).trim() : '';

  let leadEmails: string[] = [];

  try {
    if (body.leadEmails) {
      const parsed = Array.isArray(body.leadEmails)
        ? body.leadEmails
        : JSON.parse(String(body.leadEmails));
      if (Array.isArray(parsed)) {
        leadEmails = parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    }
  } catch {
    leadEmails = [];
  }

  if (!leadEmails.length && leadEmail) {
    leadEmails = [leadEmail];
  }

  leadEmails = Array.from(new Set(leadEmails)).slice(0, 10);
  const batchValues = createBatchPlaceholderValues();
  const fileSource = body.fileSource === 'upload' ? 'upload' : 'generated';
  const ctaLink = body.ctaLink ? String(body.ctaLink).trim() : '';
  const attachmentNameTemplate = body.attachmentNameTemplate
    ? String(body.attachmentNameTemplate).trim()
    : '{OriginalFile}';
  const convertHtmlToPdf =
    String(body.convertHtmlToPdf ?? 'false').toLowerCase() === 'true';
  const replaceBatchPlaceholdersInPdf =
    String(body.replaceBatchPlaceholdersInPdf ?? 'false').toLowerCase() === 'true';
  const dolphinProfileId = body.dolphinProfileId
    ? String(body.dolphinProfileId).trim()
    : '';

  if (!campaignId || !leadEmails.length) {
    return NextResponse.json(
      { error: 'campaignId and at least one lead email are required' },
      { status: 400 }
    );
  }

  const session = getWeTransferSessionLocal(campaignId);
  if (!session) {
    return NextResponse.json(
      {
        error:
          'No active WeTransfer session for this campaign. ' +
          'Call POST /api/wetransfer/session first.',
      },
      { status: 404 }
    );
  }

  if (session.status === 'failed') {
    return NextResponse.json(
      { error: 'WeTransfer session is in a failed state. Re-initialise the session.' },
      { status: 400 }
    );
  }

  const logs: string[] = [];
  const stepSnapshots: WeTransferExecutionStep[] = [];
  let attachmentBuffer: Buffer;
  let filename = 'generated-proposal.pdf';
  let attachmentPath: string | null = null;
  let attachmentDir: string | null = null;
  let attachmentDebug: AttachmentDebugPayload | null = null;

  try {
    if (fileSource === 'upload') {
      const uploadedName = body.uploadedFileName
        ? String(body.uploadedFileName).trim()
        : 'uploaded-document.pdf';
      const uploadedMimeType = body.uploadedFileMimeType
        ? String(body.uploadedFileMimeType).trim()
        : '';

      if (uploadedFile) {
        attachmentBuffer = Buffer.from(await uploadedFile.arrayBuffer());
        const originalFilename =
          uploadedFile.name || uploadedName || 'uploaded-document';

        const isHtml =
          uploadedFile.type === 'text/html' ||
          /\.html?$/i.test(originalFilename);

        if (convertHtmlToPdf && isHtml) {
          const html = attachmentBuffer.toString('utf8');
          attachmentBuffer = await htmlToPdfBuffer(
            html,
            leadEmail,
            leadName,
            ctaLink,
            batchValues
          );

          const originalParts = splitOriginalFilename(originalFilename);
          const pdfOriginal = `${originalParts.originalName}.pdf`;
          const pdfTemplate = attachmentNameTemplate
            .replace(/\{Ext\}/gi, 'pdf')
            .replace(/\{OriginalFile\}/gi, pdfOriginal);

          filename = resolveAttachmentNameTemplate(
            pdfTemplate,
            pdfOriginal,
            leadEmail,
            leadName,
            batchValues
          );

          attachmentDebug = {
            name: filename,
            source: 'uploaded',
            mimeType: 'application/pdf',
            sizeBytes: attachmentBuffer.length,
            ready: attachmentBuffer.length > 0,
          };

          logs.push(
            `[Attachment] HTML_TO_PDF: ${originalFilename} -> ${filename} | personalized for ${leadEmail}`
          );
        } else {
          const isPdf =
            uploadedFile.type === 'application/pdf' ||
            /\.pdf$/i.test(originalFilename);

          if (replaceBatchPlaceholdersInPdf && isPdf) {
            try {
              const processed = await replaceBatchPlaceholdersInPdfFormFields(
                attachmentBuffer,
                batchValues
              );
              attachmentBuffer = processed.buffer;
              logs.push(
                `[Attachment] PDF_BATCH_PLACEHOLDERS: replaced ${processed.replacedCount} form field(s) | BatchId=${batchValues.BatchId} | Reference=${batchValues.Reference}`
              );
            } catch (error: unknown) {
              const message =
                error instanceof Error ? error.message : String(error);
              logs.push(
                `[Attachment] PDF_BATCH_PLACEHOLDERS_SKIPPED: ${message}`
              );
            }
          }

          filename = resolveAttachmentNameTemplate(
            attachmentNameTemplate,
            originalFilename,
            leadEmail,
            leadName,
            batchValues
          );

          attachmentDebug = {
            name: filename,
            source: 'uploaded',
            mimeType: uploadedFile.type || uploadedMimeType || null,
            sizeBytes: attachmentBuffer.length,
            ready: attachmentBuffer.length > 0,
          };
        }
      } else {
        const uploadedBase64 = body.uploadedFileBase64
          ? String(body.uploadedFileBase64).trim()
          : '';

        if (!uploadedBase64) {
          return NextResponse.json(
            { error: 'No uploaded attachment was provided. Re-select the file and try again.' },
            { status: 400 }
          );
        }

        attachmentBuffer = Buffer.from(uploadedBase64, 'base64');
        const originalFilename = uploadedName || 'uploaded-document';
        const isHtml = /\.html?$/i.test(originalFilename);

        if (convertHtmlToPdf && isHtml) {
          const html = attachmentBuffer.toString('utf8');
          attachmentBuffer = await htmlToPdfBuffer(
            html,
            leadEmail,
            leadName,
            ctaLink,
            batchValues
          );

          const originalParts = splitOriginalFilename(originalFilename);
          const pdfOriginal = `${originalParts.originalName}.pdf`;
          const pdfTemplate = attachmentNameTemplate
            .replace(/\{Ext\}/gi, 'pdf')
            .replace(/\{OriginalFile\}/gi, pdfOriginal);

          filename = resolveAttachmentNameTemplate(
            pdfTemplate,
            pdfOriginal,
            leadEmail,
            leadName,
            batchValues
          );

          attachmentDebug = {
            name: filename,
            source: 'uploaded',
            mimeType: 'application/pdf',
            sizeBytes: attachmentBuffer.length,
            ready: attachmentBuffer.length > 0,
          };

          logs.push(
            `[Attachment] HTML_TO_PDF: ${originalFilename} -> ${filename} | personalized for ${leadEmail}`
          );
        } else {
          const isPdf = /\.pdf$/i.test(originalFilename);

          if (replaceBatchPlaceholdersInPdf && isPdf) {
            try {
              const processed = await replaceBatchPlaceholdersInPdfFormFields(
                attachmentBuffer,
                batchValues
              );
              attachmentBuffer = processed.buffer;
              logs.push(
                `[Attachment] PDF_BATCH_PLACEHOLDERS: replaced ${processed.replacedCount} form field(s) | BatchId=${batchValues.BatchId} | Reference=${batchValues.Reference}`
              );
            } catch (error: unknown) {
              const message =
                error instanceof Error ? error.message : String(error);
              logs.push(
                `[Attachment] PDF_BATCH_PLACEHOLDERS_SKIPPED: ${message}`
              );
            }
          }

          filename = resolveAttachmentNameTemplate(
            attachmentNameTemplate,
            originalFilename,
            leadEmail,
            leadName,
            batchValues
          );

          attachmentDebug = {
            name: filename,
            source: 'uploaded',
            mimeType: uploadedMimeType || null,
            sizeBytes: attachmentBuffer.length,
            ready: attachmentBuffer.length > 0,
          };
        }
      }

      if (!attachmentBuffer.length) {
        return NextResponse.json(
          { error: 'Uploaded file content is empty. Attach a valid file before sending.' },
          { status: 400 }
        );
      }

      logs.push(
        `[Attachment] READY: ${filename} | source=uploaded | template=${attachmentNameTemplate} | size=${attachmentBuffer.length} bytes | mime=${attachmentDebug.mimeType ?? 'unknown'}`
      );
    } else {
      // Temporary fixed-document mode:
      // Use the Clearwater Tender Pack PDF as the default attachment instead of
      // generating a per-lead proposal. Put the PDF at:
      // apps/api/assets/clearwater-tender-pack-2026-27.pdf
      const fixedPdfPath = path.join(
        process.cwd(),
        'assets',
        'clearwater-tender-pack-2026-27.pdf'
      );

      try {
        attachmentBuffer = await fs.readFile(fixedPdfPath);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
          {
            error:
              'Fixed Clearwater PDF could not be loaded. ' +
              `Expected file at ${fixedPdfPath}. ${message}`,
          },
          { status: 500 }
        );
      }

      filename = replaceBatchPlaceholders(
        'Clearwater Holdings - Tender Pack 2026-27.pdf',
        batchValues
      );

      attachmentDebug = {
        name: filename,
        source: 'generated',
        mimeType: 'application/pdf',
        sizeBytes: attachmentBuffer.length,
        ready: attachmentBuffer.length > 0,
      };

      if (!attachmentBuffer.length) {
        return NextResponse.json(
          { error: 'Fixed Clearwater PDF is empty and cannot be sent.' },
          { status: 500 }
        );
      }

      logs.push(
        `[Attachment] READY: ${filename} | source=fixed-clearwater-pdf | size=${attachmentBuffer.length} bytes | mime=application/pdf`
      );
    }

    logs.push(
      `[Batch] ${batchValues.BatchId} | ${batchValues.Reference} | ${batchValues.DateTime} | ` +
        `${leadEmails.length} sequential one-recipient transfer(s)`
    );

    attachmentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), '3d-suite-wetransfer-')
    );

    const sequentialJobs: Array<{
      recipientEmail: string;
      filename: string;
      fileBuffer: Buffer;
      attachmentPath: string;
      leadName?: string;
      ctaLink?: string;
    }> = [];

    // Build one attachment filename/file entry per recipient.
    // The content buffer is reused for ordinary uploaded PDFs/documents,
    // while the filename placeholders are resolved separately per lead.
    for (
      let recipientIndex = 0;
      recipientIndex < leadEmails.length;
      recipientIndex += 1
    ) {
      const recipientEmail = leadEmails[recipientIndex];

      let recipientFilename = filename;
      let recipientBuffer = attachmentBuffer;

      if (fileSource === 'upload') {
        const originalFilename =
          uploadedFile?.name ||
          (body.uploadedFileName
            ? String(body.uploadedFileName).trim()
            : filename);

        const isHtml =
          uploadedFile?.type === 'text/html' ||
          /\.html?$/i.test(originalFilename);

        if (convertHtmlToPdf && isHtml) {
          const sourceHtml = uploadedFile
            ? Buffer.from(
                await uploadedFile.arrayBuffer()
              ).toString('utf8')
            : Buffer.from(
                String(body.uploadedFileBase64 || ''),
                'base64'
              ).toString('utf8');

          recipientBuffer = await htmlToPdfBuffer(
            sourceHtml,
            recipientEmail,
            leadName,
            ctaLink,
            batchValues
          );

          const originalParts =
            splitOriginalFilename(originalFilename);
          const pdfOriginal =
            `${originalParts.originalName}.pdf`;
          const pdfTemplate = attachmentNameTemplate
            .replace(/\{Ext\}/gi, 'pdf')
            .replace(/\{OriginalFile\}/gi, pdfOriginal);

          recipientFilename =
            resolveAttachmentNameTemplate(
              pdfTemplate,
              pdfOriginal,
              recipientEmail,
              leadName,
              batchValues
            );
        } else {
          recipientFilename =
            resolveAttachmentNameTemplate(
              attachmentNameTemplate,
              originalFilename,
              recipientEmail,
              leadName,
              batchValues
            );
        }
      }

      const safeRecipientFilename =
        recipientFilename || `attachment-${recipientIndex + 1}`;

      const recipientPath = path.join(
        attachmentDir,
        `${recipientIndex + 1}-${safeRecipientFilename}`
      );

      await fs.writeFile(
        recipientPath,
        recipientBuffer
      );

      logs.push(
        `[Attachment] SEQUENTIAL_READY ${recipientIndex + 1}/${leadEmails.length} | ` +
          `${recipientEmail} | ${safeRecipientFilename} | ${recipientBuffer.length} bytes`
      );

      sequentialJobs.push({
        recipientEmail,
        filename: safeRecipientFilename,
        fileBuffer: recipientBuffer,
        attachmentPath: recipientPath,
        leadName: leadName || undefined,
        ctaLink: ctaLink || undefined,
      });
    }

    const proxyConfig = getBrowserProxyConfigLocal();

    console.log(
      `[wetransfer/send-lead] ${getBrowserProxyDiagnostics(
        proxyConfig,
        'launchWeTransferBrowser',
        'POST /api/wetransfer/send-lead'
      )}`
    );

    const result =
      await sendSequentialLeadBatchViaWeTransfer(
        session,
        sequentialJobs,
        {
          fileSource,
          proxyConfig,
          dolphinProfileId:
            dolphinProfileId || undefined,
        },
        (step, logLine) => {
          stepSnapshots.push({ ...step });
          logs.push(logLine);
        }
      );

    setWeTransferSessionLocal(campaignId, session);

    const successfulResults = result.results.filter(
      (item) => item.success
    );
    const failedResults = result.results.filter(
      (item) => !item.success
    );

    for (let index = 0; index < result.results.length; index += 1) {
      const item = result.results[index];

      logs.push(
        item.success
          ? `[Sequential] ${index + 1}/${leadEmails.length} SENT | ${item.recipientEmail} | ${item.filename}`
          : `[Sequential] ${index + 1}/${leadEmails.length} FAILED | ${item.recipientEmail} | ${item.filename} | ${item.error || 'unknown error'}`
      );
    }

    return NextResponse.json(
      {
        success:
          successfulResults.length === leadEmails.length,
        confirmationStatus:
          failedResults.length === 0
            ? 'confirmed'
            : successfulResults.length > 0
              ? 'submitted'
              : 'failed',
        leadEmail: leadEmails[0],
        leadEmails,
        transferUrl:
          successfulResults[0]?.transferUrl ?? null,
        detail:
          `${successfulResults.length}/${leadEmails.length} sequential one-recipient transfer(s) completed`,
        fileSource,
        filename:
          sequentialJobs[0]?.filename || filename,
        attachmentBytes:
          sequentialJobs[0]?.fileBuffer.length ||
          attachmentBuffer.length,
        attachment: attachmentDebug,
        steps: stepSnapshots,
        logs,
        mailboxUsed:
          session.tempMailbox?.email ?? null,
        mailboxMessageCount:
          session.mailboxMessageCount,
        latestError:
          session.latestError,
        sequentialResults: result.results,
        sentCount:
          successfulResults.length,
        failedCount:
          failedResults.length,
        error:
          failedResults.length > 0
            ? result.detail ||
              `${failedResults.length} sequential transfer(s) failed`
            : undefined,
      },
      {
        status:
          successfulResults.length > 0 ? 200 : 500,
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'WeTransfer send failed unexpectedly';
    session.latestError = message;
    setWeTransferSessionLocal(campaignId, session);
    return NextResponse.json(
      { error: message, latestError: message } satisfies WeTransferSendLeadResponse,
      {
        status: 500,
      }
    );
  } finally {
    if (attachmentDir) {
      await fs.rm(attachmentDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
