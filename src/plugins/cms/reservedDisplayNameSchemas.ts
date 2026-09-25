import { z } from 'zod';

export const reservedNameRow = z.object({
	id: z.number().int().positive(),
	value: z.string(),
	reason: z.string().nullable(),
	createdAt: z.string(),
	createdByUserId: z.number().int().positive().nullable(),
});

export const reservedNameListResponse = z.object({
	items: z.array(reservedNameRow),
	total: z.number().int().min(0),
});

export const createReservedNameRequest = z.object({
	value: z.string().min(1).max(64),
	reason: z.string().max(255).optional(),
});

export const reservedNameIdParam = z.object({ id: z.coerce.number().int().positive() });
