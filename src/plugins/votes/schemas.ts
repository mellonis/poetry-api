import { z } from 'zod';
import { voteSummarySchema, voteValueSchema } from '../../lib/voteValue.js';

export const voteParams = z.object({
	thingId: z.coerce.number().int().positive(),
});

export const voteRequest = z.object({
	vote: voteValueSchema,
});

// PUT response mirrors the comment-vote PUT shape — same `{ likes, dislikes,
// userVote }` everywhere across the API.
export const voteSummaryResponse = voteSummarySchema;

// `thingIds` is a comma-separated list of positive integers; capped to keep
// the IN-clause bounded. Larger sections should query by `sectionId` instead.
const thingIdsField = z
	.string()
	.transform((v, ctx) => {
		const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
		if (parts.length === 0 || parts.length > 100) {
			ctx.addIssue({ code: 'custom', message: 'thingIds must contain 1..100 entries' });
			return z.NEVER;
		}
		const out = new Set<number>();
		for (const p of parts) {
			const n = Number(p);
			if (!Number.isInteger(n) || n <= 0) {
				ctx.addIssue({ code: 'custom', message: 'thingIds must be positive integers' });
				return z.NEVER;
			}
			out.add(n);
		}
		return Array.from(out);
	});

// `sectionId` is the public string identifier (`section.identifier`, e.g.
// `nnils`). Same character set the URL accepts; loose enough to cover legacy
// section slugs.
const sectionIdField = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

// Caller must provide exactly one of `thingIds` or `sectionId`.
// thingIds → batch by id; sectionId → all things in that section,
// zero-filled for unvoted ones.
export const voteListQuery = z
	.object({
		thingIds: thingIdsField.optional(),
		sectionId: sectionIdField.optional(),
	})
	.superRefine((val, ctx) => {
		const hasIds = val.thingIds !== undefined;
		const hasSection = val.sectionId !== undefined;
		if (hasIds === hasSection) {
			ctx.addIssue({ code: 'custom', message: 'Provide exactly one of `thingIds` (up to 100) or `sectionId`' });
		}
	});

// Map keyed by thingId-as-string (JSON object keys are always strings on the
// wire). Clients re-key on number when consuming.
export const voteListResponse = z.record(z.string(), voteSummarySchema);

export type VoteParams = z.infer<typeof voteParams>;
export type VoteRequest = z.infer<typeof voteRequest>;
export type VoteListQuery = z.infer<typeof voteListQuery>;
export type { VoteSummary } from '../../lib/voteValue.js';
