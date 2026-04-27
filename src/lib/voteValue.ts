import { z } from 'zod';

// Wire-format value for thumbs-up/down across the API.
// `null` means "no vote" in responses and "remove the vote" in requests.
export const voteValueSchema = z.enum(['like', 'dislike']).nullable();
export type VoteValue = z.infer<typeof voteValueSchema>;

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
