import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors/AppError';
import { clinicDateString, clinicDayRange, dateOnly } from '../../shared/lib/dates';
import { compressPhoto } from '../../shared/lib/images';
import { nextPrescriptionNo } from '../../shared/lib/numbering';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import type { AuthUser } from '../../shared/middleware/authenticate';
import { storage } from '../../shared/storage';
import type { CreatePrescriptionFields, ListPrescriptionsQuery } from './prescriptions.schema';

type UploadedFile = Express.Multer.File;
interface StoredImage {
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
}

// ─── Storage helpers ────────────────────────────────────────────────────────

/** Compresses and stores each photo; if any fails, removes the ones already stored. */
async function storeImages(files: UploadedFile[], appointmentId: string): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];
  try {
    for (const file of files) {
      const image = await compressPhoto(file.buffer, file.originalname);
      const fileKey = `prescriptions/${clinicDateString().slice(0, 7)}/${appointmentId}-${randomUUID()}.jpg`;
      await storage.put(fileKey, image.data, image.contentType);
      stored.push({ fileKey, mimeType: image.contentType, sizeBytes: image.data.length });
    }
    return stored;
  } catch (err) {
    await removeStored(stored);
    throw err;
  }
}

async function removeStored(images: Array<{ fileKey: string }>) {
  await Promise.all(
    images.map((i) => storage.delete(i.fileKey).catch((e) => console.error(`Could not delete ${i.fileKey}`, e))),
  );
}

// ─── Permissions ────────────────────────────────────────────────────────────

/** A practitioner may only write prescriptions for their own patients' visits. */
function assertCanWrite(user: AuthUser, practitionerUserId: string | null) {
  if (user.role === 'PRACTITIONER' && practitionerUserId !== user.id) {
    throw forbidden("You can only add prescriptions for your own patients' visits");
  }
}

// ─── Create & change ────────────────────────────────────────────────────────

export async function createPrescription(fields: CreatePrescriptionFields, files: UploadedFile[], user: AuthUser) {
  if (files.length === 0) throw badRequest('Add at least one photo of the prescription');

  const appt = await prisma.appointment.findUnique({
    where: { id: fields.appointmentId },
    include: { practitioner: { select: { userId: true } }, prescription: { select: { id: true, rxNo: true } } },
  });
  if (!appt) throw notFound('Visit');
  if (appt.status === 'CANCELLED') throw conflict('Cannot add a prescription to a cancelled visit');
  assertCanWrite(user, appt.practitioner.userId);
  if (appt.prescription) {
    throw conflict(`This visit already has prescription ${appt.prescription.rxNo}. Add pages to it instead.`, {
      prescriptionId: appt.prescription.id,
    });
  }

  const stored = await storeImages(files, appt.id);
  try {
    const prescription = await prisma.$transaction(async (tx) =>
      tx.prescription.create({
        data: {
          rxNo: await nextPrescriptionNo(tx),
          patientId: appt.patientId,
          appointmentId: appt.id,
          practitionerId: appt.practitionerId,
          diagnosis: fields.diagnosis,
          advice: fields.advice,
          nextVisitDate: fields.nextVisitDate ? dateOnly(fields.nextVisitDate) : undefined,
          createdById: user.id,
          images: {
            create: stored.map((s, i) => ({ ...s, pageNo: i + 1, uploadedById: user.id })),
          },
        },
      }),
    );
    return getPrescription(prescription.id);
  } catch (err) {
    // e.g. another desk saved a prescription for this visit at the same moment
    await removeStored(stored);
    throw err;
  }
}

async function loadForWrite(id: string, user: AuthUser) {
  const prescription = await prisma.prescription.findUnique({
    where: { id },
    include: { practitioner: { select: { userId: true } } },
  });
  if (!prescription) throw notFound('Prescription');
  assertCanWrite(user, prescription.practitioner.userId);
  return prescription;
}

/** Adds more pages (photos) to an existing prescription. */
export async function addImages(id: string, files: UploadedFile[], user: AuthUser) {
  if (files.length === 0) throw badRequest('Add at least one photo');
  const prescription = await loadForWrite(id, user);

  const stored = await storeImages(files, prescription.appointmentId ?? prescription.id);
  try {
    const { _max } = await prisma.prescriptionImage.aggregate({ where: { prescriptionId: id }, _max: { pageNo: true } });
    const start = (_max.pageNo ?? 0) + 1;
    await prisma.prescriptionImage.createMany({
      data: stored.map((s, i) => ({ ...s, prescriptionId: id, pageNo: start + i, uploadedById: user.id })),
    });
  } catch (err) {
    await removeStored(stored);
    throw err;
  }
  return getPrescription(id);
}

export async function deleteImage(id: string, imageId: string) {
  const image = await prisma.prescriptionImage.findFirst({ where: { id: imageId, prescriptionId: id } });
  if (!image) throw notFound('Prescription page');
  await prisma.prescriptionImage.delete({ where: { id: imageId } });
  await removeStored([image]);
  return getPrescription(id);
}

export async function updatePrescription(
  id: string,
  body: { diagnosis?: string | null; advice?: string | null; nextVisitDate?: string | null },
  user: AuthUser,
) {
  await loadForWrite(id, user);
  const { nextVisitDate, ...rest } = body;
  await prisma.prescription.update({
    where: { id },
    data: {
      ...rest,
      ...(nextVisitDate !== undefined ? { nextVisitDate: nextVisitDate ? dateOnly(nextVisitDate) : null } : {}),
    },
  });
  return getPrescription(id);
}

// ─── Read ───────────────────────────────────────────────────────────────────

const detailInclude = {
  patient: { select: { id: true, patientCode: true, name: true, phone: true } },
  practitioner: { select: { id: true, name: true, title: true } },
  appointment: {
    select: { id: true, visitDate: true, serialNo: true, department: { select: { id: true, name: true, color: true } } },
  },
  images: { orderBy: [{ pageNo: 'asc' as const }, { uploadedAt: 'asc' as const }] },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.PrescriptionInclude;

export async function getPrescription(id: string) {
  const prescription = await prisma.prescription.findUnique({ where: { id }, include: detailInclude });
  if (!prescription) throw notFound('Prescription');
  const images = await Promise.all(
    prescription.images.map(async ({ fileKey, ...img }) => ({ ...img, url: await storage.signedUrl(fileKey) })),
  );
  return { ...prescription, images };
}

/** Raw data for the printable PDF (image bytes, in page order). */
export async function getPrescriptionForPrint(id: string) {
  const prescription = await prisma.prescription.findUnique({ where: { id }, include: detailInclude });
  if (!prescription) throw notFound('Prescription');
  const pages = await Promise.all(prescription.images.map((img) => storage.get(img.fileKey)));
  return { prescription, pages };
}

export async function listPrescriptions(query: ListPrescriptionsQuery) {
  const created = clinicDayRange(query.from, query.to);
  const where: Prisma.PrescriptionWhereInput = {
    patientId: query.patientId,
    practitionerId: query.practitionerId,
    appointmentId: query.appointmentId,
    ...(created ? { createdAt: created } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.prescription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      include: {
        patient: { select: { id: true, patientCode: true, name: true } },
        practitioner: { select: { id: true, name: true } },
        appointment: { select: { id: true, visitDate: true, department: { select: { name: true, color: true } } } },
        images: { orderBy: { pageNo: 'asc' }, take: 1, select: { fileKey: true } },
        _count: { select: { images: true } },
      },
    }),
    prisma.prescription.count({ where }),
  ]);

  const items = await Promise.all(
    rows.map(async ({ images, _count, ...p }) => ({
      ...p,
      pageCount: _count.images,
      thumbnailUrl: images[0] ? await storage.signedUrl(images[0].fileKey) : null,
    })),
  );
  return paginated(items, total, query);
}
