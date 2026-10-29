import { z } from 'zod';
import { bdPhone, nullableText } from '../../shared/lib/validation';

export const updateClinicSettingsBody = z.object({
  name: z.string().trim().min(1, 'Clinic name is required').max(150),
  nameBn: nullableText(150),
  address: nullableText(300),
  phone: bdPhone.nullable().optional(),
  email: z.email().nullable().optional(),
  invoiceFooter: nullableText(500),
});

export type UpdateClinicSettingsBody = z.infer<typeof updateClinicSettingsBody>;
