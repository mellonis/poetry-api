import { z } from 'zod';

export const setupStatusResponseSchema = z.object({
  schema: z.object({
    db_reachable: z.boolean(),
    auth_user_table: z.boolean(),
    display_name_col: z.boolean(),
  }),
  has_active_admins: z.boolean(),
  setup_secret_configured: z.boolean(),
  needs_setup: z.boolean(),
});

export const setupAdminBodySchema = z.object({
  secret: z.string().min(1),
  email: z.string().email().max(50),
  password: z.string().min(6),
});

export type SetupAdminBody = z.infer<typeof setupAdminBodySchema>;

export const setupAdminSuccessSchema = z.object({
  id: z.literal(1),
});

export const setupAdminErrorSchema = z.object({
  error: z.enum([
    'wrong_secret',
    'already_initialized',
    'setup_disabled',
    'insert_failed',
    'validation',
  ]),
  issues: z.array(z.unknown()).optional(),
});
