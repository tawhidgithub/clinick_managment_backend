import path from 'node:path';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';

// Hind Siliguri covers Latin and Bangla (including the ৳ sign). Its shaping in
// PDFKit was checked against HarfBuzz for conjuncts, reph, ya/ra-phala and
// split vowels, so Bangla names print correctly.
const FONT_DIR = path.resolve(__dirname, '../../../assets/fonts');
export const FONTS = {
  regular: path.join(FONT_DIR, 'HindSiliguri-Regular.ttf'),
  semibold: path.join(FONT_DIR, 'HindSiliguri-SemiBold.ttf'),
  bold: path.join(FONT_DIR, 'HindSiliguri-Bold.ttf'),
} as const;

export const MM = 72 / 25.4; // points per millimetre

export const PAPER = {
  A4: [595.28, 841.89] as [number, number],
  A5: [419.53, 595.28] as [number, number],
  CR80: [85.6 * MM, 54 * MM] as [number, number], // credit-card size
  THERMAL_80: 80 * MM, // width only; height is chosen per document
};

export const COLORS = {
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  primary: '#0F766E',
  primarySoft: '#CCFBF1',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
};

export type Pdf = PDFKit.PDFDocument;

export function createPdf(options: PDFKit.PDFDocumentOptions & { title: string }): Pdf {
  const { title, ...rest } = options;
  // bufferPages lets documents go back and stamp footers / page numbers on every page.
  const doc = new PDFDocument({ margin: 36, bufferPages: true, ...rest, info: { Title: title, Creator: 'Chowa Clinic' } });
  doc.registerFont('regular', FONTS.regular);
  doc.registerFont('semibold', FONTS.semibold);
  doc.registerFont('bold', FONTS.bold);
  doc.font('regular');
  // Colour is written into page content, so only set it once a page exists.
  if (rest.autoFirstPage !== false) doc.fillColor(COLORS.text);
  return doc;
}

/** Finishes the document and collects it into a Buffer. */
export function pdfToBuffer(doc: Pdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Sends a PDF. `download=true` makes the browser save it instead of opening it. */
export function sendPdf(res: Response, pdf: Buffer, filename: string, download = false) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
}

/**
 * Writes text at a fixed position and never starts a new page, even when it
 * sits inside the bottom margin. For fixed layouts: cards, slips, footers.
 */
export function textAt(doc: Pdf, text: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}) {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = -doc.page.height; // PDFKit breaks pages at height - margins.bottom
  try {
    doc.text(text, x, y, options);
  } finally {
    doc.page.margins.bottom = bottom;
  }
  return doc;
}

/** Draws a horizontal rule across the content width at the current y. */
export function hr(doc: Pdf, color = COLORS.border, gap = 6) {
  const y = doc.y + gap / 2;
  doc
    .save()
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.7)
    .strokeColor(color)
    .stroke()
    .restore();
  doc.y = y + gap / 2;
}

export function contentWidth(doc: Pdf) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

interface ClinicInfo {
  name: string;
  nameBn?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Clinic name and contact lines, left aligned, with a title on the right. */
export function clinicHeader(doc: Pdf, clinic: ClinicInfo, title: string, scale = 1) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.y;

  doc.font('bold').fontSize(15 * scale).fillColor(COLORS.primary).text(clinic.name, left, top, { width: width * 0.65 });
  doc.font('regular').fontSize(8.5 * scale).fillColor(COLORS.muted);
  if (clinic.nameBn) doc.text(clinic.nameBn, { width: width * 0.65 });
  const contact = [clinic.address, clinic.phone, clinic.email].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact, { width: width * 0.65 });
  const afterLeft = doc.y;

  doc
    .font('bold')
    .fontSize(13 * scale)
    .fillColor(COLORS.text)
    .text(title, left + width * 0.6, top + 2 * scale, { width: width * 0.4, align: 'right' });

  doc.y = Math.max(afterLeft, doc.y) + 4 * scale;
  doc.x = left;
  hr(doc, COLORS.primary, 8 * scale);
  doc.fillColor(COLORS.text);
}

/** "Label: value" pair laid out in a column. */
export function labelValue(doc: Pdf, label: string, value: string, x: number, y: number, width: number, scale = 1) {
  doc.font('regular').fontSize(7.5 * scale).fillColor(COLORS.muted).text(label.toUpperCase(), x, y, { width });
  doc.font('semibold').fontSize(9.5 * scale).fillColor(COLORS.text).text(value || '—', x, doc.y, { width });
  return doc.y;
}
