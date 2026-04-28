import { z } from 'zod';

// Wire-format value for thumbs-up/down across the API.
// `null` means "no vote" in responses and "remove the vote" in requests.
export const voteValueSchema = z.enum(['like', 'dislike']).nullable();
export type VoteValue = z.infer<typeof voteValueSchema>;

// Shared response shape for vote endpoints (thing votes + comment votes).
// Centralized so the two domains stay in lockstep — adding a field here
// updates both at once.
export const voteSummarySchema = z.object({
	likes: z.number().int().min(0),
	dislikes: z.number().int().min(0),
	userVote: voteValueSchema,
});
export type VoteSummary = z.infer<typeof voteSummarySchema>;

export const voteValueToDb = (v: VoteValue): -1 | 0 | 1 => {
	if (v === 'like') return 1;
	if (v === 'dislike') return -1;
	return 0;
};

export const dbToVoteValue = (n: number | null | undefined): VoteValue => {
	if (n === 1) return 'like';
	if (n === -1) return 'dislike';
	return null;
};
