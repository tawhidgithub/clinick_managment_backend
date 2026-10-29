import QRCode from 'qrcode';
import { formatDate } from '../../shared/lib/dates';
import { COLORS, createPdf, MM, PAPER, pdfToBuffer, textAt } from '../../shared/pdf/pdf';
import type { getMembership } from './memberships.service';

type MembershipDetail = Awaited<ReturnType<typeof getMembership>>;

/**
 * CR80 card (85.6 x 54 mm): clinic band, patient, plan, validity and a QR
 * code of the card number for quick lookup at the desk.
 */
export async function renderMembershipCard(m: MembershipDetail, clinicName: string): Promise<Buffer> {
  const [W, H] = PAPER.CR80;
  const doc = createPdf({ size: [W, H], margin: 0, title: `Membership card ${m.cardNo}` });
  const pad = 4 * MM;
  const bandH = 11 * MM;
  const oneLine = { lineBreak: false, ellipsis: true } as const;

  // Clinic band
  doc.rect(0, 0, W, bandH).fill(COLORS.primary);
  doc.font('bold').fontSize(9).fillColor('#FFFFFF');
  textAt(doc, clinicName, pad, 2.2 * MM, { width: W - 2 * pad, ...oneLine });
  doc.font('regular').fontSize(6).fillColor(COLORS.primarySoft);
  textAt(doc, 'MEMBERSHIP CARD', pad, 6.6 * MM, { width: W - 2 * pad, characterSpacing: 1.2, lineBreak: false });

  // QR code on the right
  const qrSize = 20 * MM;
  const qr = await QRCode.toBuffer(m.cardNo, { errorCorrectionLevel: 'M', margin: 0, width: 300 });
  const qrX = W - pad - qrSize;
  const qrY = bandH + 3.5 * MM;
  doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('regular').fontSize(5.5).fillColor(COLORS.muted);
  textAt(doc, m.cardNo, qrX - 2 * MM, qrY + qrSize + 1, { width: qrSize + 4 * MM, align: 'center', lineBreak: false });

  // Patient and plan on the left
  const textW = qrX - pad - 3 * MM;
  let y = bandH + 3 * MM;
  doc.font('bold').fontSize(10.5).fillColor(COLORS.text);
  textAt(doc, m.patient.name, pad, y, { width: textW, ...oneLine });
  y += 14;
  doc.font('regular').fontSize(7).fillColor(COLORS.muted);
  textAt(doc, `Patient ID  ${m.patient.patientCode}`, pad, y, { width: textW, lineBreak: false });
  y += 13;
  doc.font('semibold').fontSize(9).fillColor(COLORS.primary);
  textAt(doc, `${m.plan.name} member`, pad, y, { width: textW, ...oneLine });
  y += 12;
  const scope = m.plan.department ? `${m.plan.discountPercent}% off ${m.plan.department.name}` : `${m.plan.discountPercent}% off all services`;
  doc.font('regular').fontSize(7).fillColor(COLORS.text);
  textAt(doc, scope, pad, y, { width: textW, ...oneLine });

  // Validity strip at the bottom
  const stripY = H - 8 * MM;
  doc.rect(0, stripY, W, 8 * MM).fill(COLORS.primarySoft);
  const column = (label: string, value: string, x: number) => {
    doc.font('regular').fontSize(6).fillColor(COLORS.muted);
    textAt(doc, label, x, stripY + 1.2 * MM, { lineBreak: false });
    doc.font('semibold').fontSize(8).fillColor(COLORS.text);
    textAt(doc, value, x, stripY + 3.6 * MM, { lineBreak: false });
  };
  column('VALID FROM', formatDate(m.startDate, true), pad);
  column('VALID TILL', formatDate(m.endDate, true), W / 2 - 4 * MM);

  return pdfToBuffer(doc);
}
