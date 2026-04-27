import { z } from 'zod';
import { voteValueSchema } from '../../lib/voteValue.js';

export const voteParams = z.object({
	thingId: z.coerce.number().int().positive(),
});

export const voteRequest = z.object({
	vote: voteValueSchema,
});

export const voteCountsResponse = z.object({
	plus: z.number().int().min(0),
	minus: z.number().int().min(0),
});

export type VoteParams = z.infer<typeof voteParams>;
export type VoteRequest = z.infer<typeof voteRequest>;
