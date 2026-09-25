import { z } from 'zod';
import { PAT_SCOPES } from './scope.js';

export const patScopeSchema = z.enum(PAT_SCOPES);

export const createPersonalAccessTokenRequest = z.object({
	name: z.string().trim().min(1).max(64),
	scope: patScopeSchema,
});

export const personalAccessTokenListItem = z.object({
	id: z.number().int(),
	name: z.string(),
	scope: patScopeSchema,
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
});

export const personalAccessTokenListResponse = z.array(personalAccessTokenListItem);

// The raw token appears here and nowhere else.
export const createPersonalAccessTokenResponse = personalAccessTokenListItem
	.omit({ lastUsedAt: true })
	.extend({ token: z.string() });

export const personalAccessTokenIdParam = z.object({
	tokenId: z.coerce.number().int().positive(),
});

export type CreatePersonalAccessTokenRequest = z.infer<typeof createPersonalAccessTokenRequest>;
export type PersonalAccessTokenIdParam = z.infer<typeof personalAccessTokenIdParam>;
