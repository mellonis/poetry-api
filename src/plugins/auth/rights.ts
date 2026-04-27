const RIGHT_BITS = {
	emailActivated: 0,
	passwordResetRequested: 1,
	banned: 2,
	canVote: 3,
	canComment: 4,
	canEditContent: 12,
	canEditUsers: 14,
} as const;

export interface ResolvedRights {
	canVote: boolean;
	canComment: boolean;
	canEditContent: boolean;
	canEditUsers: boolean;
}

const hasBit = (value: number, bit: number): boolean => (value & (1 << bit)) !== 0;

// Per-bit rules combining group and user rights. See ../CLAUDE.md → Auth Rights Bitmask.
// - bits 0, 1: user-level only
// - bit 2 (banned): OR
// - bits 3..10: (!group) && user — user opt-in, group can BLOCK
// - bits 11..15: XOR — group default, per-user override
const resolveBit = (groupRights: number, userRights: number, bit: number): boolean => {
	const g = hasBit(groupRights, bit);
	const u = hasBit(userRights, bit);

	if (bit < 2) return u;
	if (bit === 2) return g || u;
	if (bit <= 10) return !g && u;
	return g !== u;
};

export const resolveRights = (userRights: number, groupRights: number): ResolvedRights => {
	// If banned at either level, zero out both inputs so every resolved right is false.
	// This applies the "banned overrides everything" rule once, regardless of how many
	// rights are added to ResolvedRights in the future.
	const banned = resolveBit(groupRights, userRights, RIGHT_BITS.banned);
	const u = banned ? 0 : userRights;
	const g = banned ? 0 : groupRights;

	return {
		canVote: resolveBit(g, u, RIGHT_BITS.canVote),
		canComment: resolveBit(g, u, RIGHT_BITS.canComment),
		canEditContent: resolveBit(g, u, RIGHT_BITS.canEditContent),
		canEditUsers: resolveBit(g, u, RIGHT_BITS.canEditUsers),
	};
};

export const isEmailActivated = (userRights: number): boolean =>
	hasBit(userRights, RIGHT_BITS.emailActivated);

export const isBanned = (userRights: number): boolean =>
	hasBit(userRights, RIGHT_BITS.banned);

export const isPasswordResetRequested = (userRights: number): boolean =>
	hasBit(userRights, RIGHT_BITS.passwordResetRequested);

export const setEmailActivated = (userRights: number): number =>
	userRights | (1 << RIGHT_BITS.emailActivated);

export const setPasswordResetRequested = (userRights: number): number =>
	userRights | (1 << RIGHT_BITS.passwordResetRequested);

export const clearPasswordResetRequested = (userRights: number): number =>
	userRights & ~(1 << RIGHT_BITS.passwordResetRequested);
