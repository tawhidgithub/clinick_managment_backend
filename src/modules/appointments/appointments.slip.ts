import { formatDateTime } from '../../shared/lib/dates';
import { formatTaka } from '../../shared/lib/money';
import { COLORS, createPdf, MM, PAPER, pdfToBuffer, type Pdf } from '../../shared/pdf/pdf';
import type { getAppointment } from './appointments.service';

type AppointmentDetail = Awaited<ReturnType<typeof getAppointment>>;

const PAD = 4 * MM;

/** Draws the slip and returns the y where the content ends. */
function drawSlip(doc: Pdf, appt: AppointmentDetail, clinicName: string): number {
  const W = PAPER.THERMAL_80;
  const width = W - 2 * PAD;

  const dashed = () => {
    const y = doc.y + 3;
    doc.save().moveTo(PAD, y).lineTo(W - PAD, y).dash(2, { space: 2 }).lineWidth(0.6).strokeColor(COLORS.text).stroke().undash().restore();
    doc.y = y + 4;
  };
  const center = (text: string, font: string, size: number, color: string = COLORS.text) =>
    doc.font(font).fontSize(size).fillColor(color).text(text, PAD, doc.y, { width, align: 'center' });

  center(clinicName, 'bold', 11);
  center(formatDateTime(appt.createdAt), 'regular', 7.5, COLORS.muted);
  dashed();

  center('SERIAL NO', 'semibold', 8, COLORS.muted);
  center(String(appt.serialNo ?? '—'), 'bold', 46);
  center(appt.practitioner.name, 'semibold', 10.5);
  center(appt.department.name, 'regular', 8.5, COLORS.muted);
  dashed();

  doc.font('semibold').fontSize(9.5).fillColor(COLORS.text).text(appt.patient.name, PAD, doc.y, { width });
  doc.font('regular').fontSize(8).fillColor(COLORS.muted).text(`Patient ID  ${appt.patient.patientCode}`, PAD, doc.y, { width });
  doc.y += 3;

  for (const s of appt.services) {
    const y = doc.y;
    const label = s.quantity > 1 ? `${s.service.name} x${s.quantity}` : s.service.name;
    doc.font('regular').fontSize(8).fillColor(COLORS.text).text(label, PAD, y, { width: width * 0.68 });
    const after = doc.y;
    doc.text(formatTaka(s.price * s.quantity), PAD + width * 0.68, y, { width: width * 0.32, align: 'right' });
    doc.y = Math.max(after, doc.y);
  }
  doc.font('semibold').fontSize(8.5).text(`Total  ${formatTaka(appt.servicesTotal)}`, PAD, doc.y + 2, { width, align: 'right' });
  dashed();

  center('Please keep this slip and wait to be called.', 'regular', 7.5, COLORS.muted);
  return doc.y;
}

/**
 * Serial slip for an 80 mm thermal receipt printer. Laid out once on a tall
 * scratch page to measure it, then rendered at exactly the height it needs.
 */
export async function renderSerialSlip(appt: AppointmentDetail, clinicName: string): Promise<Buffer> {
  const W = PAPER.THERMAL_80;
  const probe = createPdf({ size: [W, 1000 * MM], margin: PAD, title: 'measure' });
  const contentBottom = drawSlip(probe, appt, clinicName);
  probe.end();

  // PDFKit's fit check for the last line is a few points stricter than the y it reports, hence + 2 mm.
  const doc = createPdf({ size: [W, contentBottom + PAD + 2 * MM], margin: PAD, title: `Serial ${appt.serialNo}` });
  drawSlip(doc, appt, clinicName);
  return pdfToBuffer(doc);
}
