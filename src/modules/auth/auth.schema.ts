import { z } from 'zod';

export const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Username is required').max(50),
  password: z.string().min(1, 'Password is required').max(200),
});

export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200);

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordRule,
});

export type LoginBody = z.infer<typeof loginBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
