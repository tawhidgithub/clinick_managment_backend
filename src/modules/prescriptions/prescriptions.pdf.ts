import { formatDate, formatDateTime } from '../../shared/lib/dates';
import { COLORS, contentWidth, createPdf, PAPER, pdfToBuffer } from '../../shared/pdf/pdf';
import type { getPrescriptionForPrint } from './prescriptions.service';

type PrintData = Awaited<ReturnType<typeof getPrescriptionForPrint>>;

/** One A4 page per photo, each with a small header identifying the patient. */
export async function renderPrescriptionPdf({ prescription: rx, pages }: PrintData, clinicName: string): Promise<Buffer> {
  const doc = createPdf({ size: PAPER.A4, margin: 32, title: rx.rxNo, autoFirstPage: false });

  const header = (page: number) => {
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const top = doc.page.margins.top;
    doc.font('bold').fontSize(11).fillColor(COLORS.primary).text(clinicName, left, top, { width: width * 0.6 });
    doc.font('regular').fontSize(8.5).fillColor(COLORS.muted).text(`${rx.rxNo}  ·  Page ${page} of ${pages.length}`, left + width * 0.6, top + 2, {
      width: width * 0.4,
      align: 'right',
    });
    const line2 = [
      `${rx.patient.name} (${rx.patient.patientCode})`,
      `${rx.practitioner.name}${rx.appointment ? ` · ${rx.appointment.department.name}` : ''}`,
      rx.appointment ? formatDate(rx.appointment.visitDate, true) : formatDateTime(rx.createdAt),
    ].join('   ·   ');
    doc.font('regular').fontSize(9).fillColor(COLORS.text).text(line2, left, doc.y + 2, { width });
    if (rx.nextVisitDate && page === 1) {
      doc.font('semibold').fontSize(9).fillColor(COLORS.primary).text(`Next visit: ${formatDate(rx.nextVisitDate, true)}`, left, doc.y, { width });
    }
    const y = doc.y + 4;
    doc.save().moveTo(left, y).lineTo(left + width, y).lineWidth(0.7).strokeColor(COLORS.border).stroke().restore();
    return y + 6;
  };

  pages.forEach((image, i) => {
    doc.addPage();
    const top = header(i + 1);
    const left = doc.page.margins.left;
    const maxW = contentWidth(doc);
    const maxH = doc.page.height - doc.page.margins.bottom - top;
    doc.image(image, left, top, { fit: [maxW, maxH], align: 'center' });
  });

  if (pages.length === 0) {
    doc.addPage();
    header(1);
    doc.font('regular').fontSize(11).fillColor(COLORS.muted).text('This prescription has no pages.', { align: 'center' });
  }

  return pdfToBuffer(doc);
}
