import { prisma } from '../../shared/db/prisma';
import type { UpdateClinicSettingsBody } from './clinic-settings.schema';

const SETTINGS_ID = 1;
const DEFAULT_NAME = 'Chowa Physio & Dental Care';

export async function getClinicSettings() {
  const settings = await prisma.clinicSettings.findUnique({ where: { id: SETTINGS_ID } });
  return (
    settings ?? {
      id: SETTINGS_ID,
      name: DEFAULT_NAME,
      nameBn: null,
      address: null,
      phone: null,
      email: null,
      logoKey: null,
      invoiceFooter: null,
      updatedAt: null,
    }
  );
}

export async function updateClinicSettings(data: UpdateClinicSettingsBody) {
  return prisma.clinicSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });
}
