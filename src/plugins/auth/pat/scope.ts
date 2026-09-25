import { resolveAccountRoles, type AccountRoles } from '../rights.js';

// A token's scope is a ceiling, not a grant: the effective level on every use
// is the lower of the token's scope and what the account holds right now.
// See docs/auth.md (personal access tokens).
export const PAT_SCOPES = ['read', 'editor', 'admin'] as const;
export type PatScope = (typeof PAT_SCOPES)[number];

const SCOPE_TO_DB: Record<PatScope, number> = { read: 1, editor: 2, admin: 3 };
const LEVEL_RANK: Record<PatScope, number> = { read: 0, editor: 1, admin: 2 };

export const scopeToDb = (scope: PatScope): number => SCOPE_TO_DB[scope];

export const scopeFromDb = (value: number): PatScope => {
	const found = PAT_SCOPES.find((scope) => SCOPE_TO_DB[scope] === value);

	if (!found) {
		throw new Error(`Unknown personal access token scope: ${value}`);
	}

	return found;
};

export const levelAtLeast = (level: PatScope, required: PatScope): boolean =>
	LEVEL_RANK[level] >= LEVEL_RANK[required];

export interface AccountRightsInput {
	userRights: number;
	groupRights: number;
	groupId: number;
}

export interface AccountLevel extends AccountRoles {
	level: PatScope;
}

// Each scope has its own requirement rather than a rank: an admin-group account
// whose per-user override clears canEditContent can hold `admin` but not `editor`.
export const canHoldScope = (scope: PatScope, roles: AccountRoles): boolean => {
	switch (scope) {
		case 'read':
			return !roles.banned;
		case 'editor':
			return roles.isEditor && roles.rights.canEditContent;
		case 'admin':
			return roles.isAdmin && roles.rights.canEditUsers;
	}
};

// Roles come from rights.ts (shared with login sessions); this only adds the level,
// which is the highest scope the account can hold.
export const resolveAccountLevel = ({ userRights, groupRights, groupId }: AccountRightsInput): AccountLevel => {
	const roles = resolveAccountRoles(userRights, groupRights, groupId);
	const level: PatScope = canHoldScope('admin', roles)
		? 'admin'
		: canHoldScope('editor', roles)
			? 'editor'
			: 'read';

	return { ...roles, level };
};

export const effectiveLevel = (scope: PatScope, account: AccountLevel): PatScope => {
	if (scope === 'admin' && canHoldScope('admin', account)) {
		return 'admin';
	}

	if ((scope === 'editor' || scope === 'admin') && canHoldScope('editor', account)) {
		return 'editor';
	}

	return 'read';
};
