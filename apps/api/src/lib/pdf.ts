import PDFDocument from 'pdfkit';
import fs from 'node:fs';

interface PlaceholderMap {
  [key: string]: string;
}

type WeTransferPdfLayoutMode = 'classic' | 'highlight';

interface WeTransferPdfInput {
  campaignName?: string;
  title?: string;
  subtitle?: string;
  bodyText?: string;
  ctaLink?: string;
  layoutMode?: WeTransferPdfLayoutMode;
  leadName?: string;
  leadEmail?: string;
}

function safeText(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed || fallback;
}

function resolveRuntimeFontPath(): string | null {
  const candidates = [
    process.env.PDF_FONT_PATH,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ].filter(Boolean) as string[];

  for (const fontPath of candidates) {
    if (fs.existsSync(fontPath)) {
      return fontPath;
    }
  }
  return null;
}

function applyRuntimeSafeFont(doc: PDFKit.PDFDocument) {
  const fontPath = resolveRuntimeFontPath();
  if (fontPath) {
    doc.font(fontPath);
  }
}

/**
 * Generate a personalized PDF by replacing placeholders in a template
 * This is a simplified version - for production, consider using a library like pdf-lib
 */
export async function generatePersonalizedPdf(
  templatePath: string,
  placeholders: PlaceholderMap,
  outputPath: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      applyRuntimeSafeFont(doc);

      // Keep parameters explicit for future template-backed implementation
      void templatePath;
      void outputPath;

      // Add header
      doc.fontSize(24).text('Personalized Document', { align: 'center' });
      doc.moveDown();

      // Add content with replaced placeholders
      for (const [key, value] of Object.entries(placeholders)) {
        doc.fontSize(12).text(`${key}: ${value}`, { align: 'left' });
        doc.moveDown(0.5);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function generateWeTransferBusinessPdf(
  input: WeTransferPdfInput
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      applyRuntimeSafeFont(doc);

      const accent = input.layoutMode === 'highlight' ? '#4338CA' : '#0F172A';
      const accentSoft = input.layoutMode === 'highlight' ? '#EEF2FF' : '#F1F5F9';

      const title = safeText(input.title, 'Business Proposal Pack');
      const subtitle = safeText(
        input.subtitle,
        'Prepared package aligned to your tender/document workflow.'
      );
      const bodyText = safeText(
        input.bodyText,
        'This document contains a concise overview, key scope points, and required follow-up actions.'
      );
      const leadName = safeText(input.leadName, 'Valued Contact');
      const leadEmail = safeText(input.leadEmail, 'email-not-provided');
      const ctaLink = (input.ctaLink || '').trim();

      // Header band
      doc.roundedRect(42, 42, 511, 112, 10).fill(accentSoft);
      doc.fillColor(accent).fontSize(11).text('3D SUITE · TENDER PACK', 58, 60);
      doc
        .fontSize(24)
        .fillColor('#0F172A')
        .text(title, 58, 80, { width: 350, align: 'left' });
      doc
        .fontSize(10)
        .fillColor('#334155')
        .text(safeText(input.campaignName, 'Campaign Document'), 58, 128);

      // Visual placeholder block
      doc.roundedRect(428, 62, 109, 74, 8).fill('#FFFFFF');
      doc.strokeColor('#CBD5E1').lineWidth(1).roundedRect(428, 62, 109, 74, 8).stroke();
      doc.fillColor('#64748B').fontSize(8).text('Layout visual', 456, 96);

      doc.moveTo(42, 170).lineTo(553, 170).strokeColor('#E2E8F0').stroke();

      // Intro
      doc.fillColor('#111827').fontSize(12).text(subtitle, 42, 184, {
        width: 511,
        align: 'left',
      });
      doc.moveDown(1);
      doc.fillColor('#334155').fontSize(10).text(bodyText, {
        width: 511,
        align: 'left',
      });

      // Lead details area
      doc.roundedRect(42, 286, 511, 106, 8).fill('#FAFAFA');
      doc.strokeColor('#E2E8F0').lineWidth(1).roundedRect(42, 286, 511, 106, 8).stroke();
      doc.fillColor(accent).fontSize(10).text('CONTACT', 58, 302);
      doc.fillColor('#0F172A').fontSize(16).text(leadName, 58, 320, { width: 320 });
      doc.fillColor('#334155').fontSize(10).text(`Email: ${leadEmail}`, 58, 345);

      // CTA area
      doc.roundedRect(42, 412, 511, 120, 10).fill(accentSoft);
      doc.fillColor('#0F172A').fontSize(13).text('Next step', 58, 430);
      doc
        .fillColor('#334155')
        .fontSize(10)
        .text('Use the secure access link below to review and proceed:', 58, 450);

      if (ctaLink) {
        doc
          .fillColor(accent)
          .fontSize(11)
          .text('Open secure link', 58, 474, {
            link: ctaLink,
            underline: true,
          });
        doc.fillColor('#475569').fontSize(8).text(ctaLink, 58, 492, { width: 480 });
      } else {
        doc
          .fillColor('#B91C1C')
          .fontSize(10)
          .text('No CTA link was provided in the WeTransfer settings.', 58, 474);
      }

      doc.fillColor('#64748B').fontSize(8).text(`Generated ${new Date().toISOString()}`, 42, 792);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Extract placeholders from template text (e.g., {{email}}, {{company}})
 */
export function extractPlaceholders(text: string): string[] {
  const regex = /{{(\w+)}}/g;
  const placeholders: string[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (!placeholders.includes(match[1])) {
      placeholders.push(match[1]);
    }
  }

  return placeholders;
}

/**
 * Replace placeholders in text with values
 */
export function replacePlaceholders(
  text: string,
  placeholders: PlaceholderMap
): string {
  let result = text;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}
