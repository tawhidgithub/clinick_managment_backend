import { formatDate, formatDateTime } from '../../shared/lib/dates';
import { formatTaka } from '../../shared/lib/money';
import { clinicHeader, COLORS, contentWidth, createPdf, hr, labelValue, PAPER, pdfToBuffer, textAt } from '../../shared/pdf/pdf';
import type { getInvoice } from './invoices.service';

type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;
interface Clinic {
  name: string;
  nameBn?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  invoiceFooter?: string | null;
}

const STATUS_COLOR = { PAID: COLORS.success, PARTIAL: COLORS.warning, DUE: COLORS.danger, VOID: COLORS.muted } as const;
const METHOD_LABEL = { CASH: 'Cash', BKASH: 'bKash', NAGAD: 'Nagad', CARD: 'Card', BANK: 'Bank' } as const;

export async function renderInvoicePdf(invoice: InvoiceDetail, clinic: Clinic, paper: 'a4' | 'a5'): Promise<Buffer> {
  const s = paper === 'a4' ? 1 : 0.85;
  const doc = createPdf({ size: paper === 'a4' ? PAPER.A4 : PAPER.A5, margin: paper === 'a4' ? 40 : 26, title: invoice.invoiceNo });
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

  clinicHeader(doc, clinic, 'INVOICE', s);

  // ── Meta: invoice / patient / visit ─────────────────────────────────────
  const colW = width / 3;
  const top = doc.y + 2;
  let y1 = labelValue(doc, 'Invoice no', invoice.invoiceNo, left, top, colW - 8, s);
  y1 = labelValue(doc, 'Date', formatDateTime(invoice.createdAt), left, y1 + 3, colW - 8, s);
  doc.font('regular').fontSize(7.5 * s).fillColor(COLORS.muted).text('STATUS', left, y1 + 3);
  doc.font('bold').fontSize(10 * s).fillColor(STATUS_COLOR[invoice.status]).text(invoice.status, left, doc.y);
  y1 = doc.y;

  let y2 = labelValue(doc, 'Patient', invoice.patient.name, left + colW, top, colW - 8, s);
  y2 = labelValue(doc, 'Patient ID', invoice.patient.patientCode, left + colW, y2 + 3, colW - 8, s);
  y2 = labelValue(doc, 'Phone', invoice.patient.phone, left + colW, y2 + 3, colW - 8, s);

  let y3 = top;
  if (invoice.appointment) {
    const a = invoice.appointment;
    y3 = labelValue(doc, 'Department', a.department.name, left + 2 * colW, top, colW, s);
    y3 = labelValue(doc, 'Doctor', a.practitioner.name, left + 2 * colW, y3 + 3, colW, s);
    y3 = labelValue(doc, 'Visit', `${formatDate(a.visitDate, true)} · Serial ${a.serialNo ?? '—'}`, left + 2 * colW, y3 + 3, colW, s);
  } else if (invoice.membership) {
    const m = invoice.membership;
    y3 = labelValue(doc, 'Membership', m.plan.name, left + 2 * colW, top, colW, s);
    y3 = labelValue(doc, 'Card no', m.cardNo, left + 2 * colW, y3 + 3, colW, s);
    y3 = labelValue(doc, 'Valid', `${formatDate(m.startDate, true)} – ${formatDate(m.endDate, true)}`, left + 2 * colW, y3 + 3, colW, s);
  }
  doc.y = Math.max(y1, y2, y3) + 10 * s;

  // ── Items table ─────────────────────────────────────────────────────────
  const cols = [
    { label: '#', w: 0.06, align: 'left' as const },
    { label: 'Description', w: 0.48, align: 'left' as const },
    { label: 'Qty', w: 0.1, align: 'right' as const },
    { label: 'Rate', w: 0.18, align: 'right' as const },
    { label: 'Amount', w: 0.18, align: 'right' as const },
  ];
  const pad = 5 * s;

  const drawHeader = () => {
    const y = doc.y;
    doc.save().rect(left, y, width, 18 * s).fill(COLORS.primarySoft).restore();
    let x = left;
    doc.font('semibold').fontSize(8.5 * s).fillColor(COLORS.text);
    for (const c of cols) {
      doc.text(c.label, x + pad, y + 4.5 * s, { width: c.w * width - 2 * pad, align: c.align });
      x += c.w * width;
    }
    doc.y = y + 18 * s;
  };

  drawHeader();
  invoice.items.forEach((item, index) => {
    const descW = cols[1]!.w * width - 2 * pad;
    doc.font('regular').fontSize(9 * s);
    const rowH = Math.max(doc.heightOfString(item.description, { width: descW }), 10 * s) + 2 * pad;
    if (doc.y + rowH > bottomLimit() - 140 * s) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    const values = [String(index + 1), item.description, String(item.quantity), formatTaka(item.unitPrice), formatTaka(item.lineTotal)];
    let x = left;
    cols.forEach((c, i) => {
      doc.font(i === 4 ? 'semibold' : 'regular').fontSize(9 * s).fillColor(COLORS.text);
      doc.text(values[i]!, x + pad, y + pad, { width: c.w * width - 2 * pad, align: c.align });
      x += c.w * width;
    });
    doc.y = y + rowH;
    doc.save().moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(COLORS.border).stroke().restore();
  });

  // ── Totals ──────────────────────────────────────────────────────────────
  doc.y += 8 * s;
  const tx = left + width * 0.5;
  const tw = width * 0.5;
  const totalRow = (label: string, value: string, opts: { bold?: boolean; color?: string; big?: boolean } = {}) => {
    const y = doc.y;
    const size = (opts.big ? 11 : 9) * s;
    doc.font(opts.bold ? 'bold' : 'regular').fontSize(size).fillColor(opts.color ?? COLORS.text);
    doc.text(label, tx, y, { width: tw * 0.6 });
    const labelBottom = doc.y;
    doc.text(value, tx + tw * 0.6, y, { width: tw * 0.4, align: 'right' });
    doc.y = Math.max(labelBottom, doc.y) + 2 * s;
  };

  totalRow('Subtotal', formatTaka(invoice.subtotal));
  if (invoice.memberDiscount) totalRow(`Member discount (${invoice.memberDiscountNote ?? 'membership'})`, `−${formatTaka(invoice.memberDiscount)}`, { color: COLORS.success });
  if (invoice.manualDiscount) totalRow('Discount', `−${formatTaka(invoice.manualDiscount)}`, { color: COLORS.success });
  doc.save().moveTo(tx, doc.y).lineTo(left + width, doc.y).lineWidth(0.7).strokeColor(COLORS.text).stroke().restore();
  doc.y += 3 * s;
  totalRow('Total', formatTaka(invoice.total), { bold: true, big: true });
  if (invoice.status !== 'VOID') {
    totalRow('Paid', formatTaka(invoice.paidAmount));
    totalRow('Due', formatTaka(invoice.due), { bold: true, color: invoice.due > 0 ? COLORS.danger : COLORS.success });
  }

  // ── Payments ────────────────────────────────────────────────────────────
  if (invoice.payments.length) {
    doc.x = left;
    doc.y += 8 * s;
    doc.font('semibold').fontSize(8.5 * s).fillColor(COLORS.muted).text('PAYMENTS', left, doc.y);
    for (const p of invoice.payments) {
      const parts = [
        formatDateTime(p.paidAt),
        METHOD_LABEL[p.method] + (p.reference ? ` (${p.reference})` : ''),
        p.amount < 0 ? `Refund ${formatTaka(-p.amount)}` : formatTaka(p.amount),
        `by ${p.receivedBy.name}`,
      ];
      doc.font('regular').fontSize(8.5 * s).fillColor(p.amount < 0 ? COLORS.danger : COLORS.text).text(parts.join('  ·  '), left, doc.y, { width });
    }
  }

  // ── Void notice ─────────────────────────────────────────────────────────
  if (invoice.status === 'VOID') {
    doc.y += 10 * s;
    doc.font('bold').fontSize(11 * s).fillColor(COLORS.danger).text('VOID', left, doc.y, { width, align: 'center' });
    doc.font('regular').fontSize(8.5 * s).text(
      `Voided ${invoice.voidedAt ? formatDateTime(invoice.voidedAt) : ''}${invoice.voidedBy ? ` by ${invoice.voidedBy.name}` : ''}: ${invoice.voidReason ?? ''}`,
      left,
      doc.y,
      { width, align: 'center' },
    );
    // Diagonal watermark on the first page
    doc.switchToPage(0);
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('bold').fontSize(90 * s).fillColor(COLORS.danger).opacity(0.08);
    doc.text('VOID', 0, doc.page.height / 2 - 50 * s, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.restore().opacity(1);
  }

  // ── Footer on every page ────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - doc.page.margins.bottom - 22 * s;
    doc.y = fy - 5 * s;
    hr(doc, COLORS.border, 0);
    doc.font('regular').fontSize(7.5 * s).fillColor(COLORS.muted);
    if (clinic.invoiceFooter) textAt(doc, clinic.invoiceFooter, left, fy, { width, align: 'center', lineBreak: false });
    textAt(
      doc,
      `Prepared by ${invoice.createdBy.name}  ·  Printed ${formatDateTime(new Date())}  ·  Page ${i - range.start + 1} of ${range.count}`,
      left,
      fy + 10 * s,
      { width, align: 'center', lineBreak: false },
    );
  }

  return pdfToBuffer(doc);
}
