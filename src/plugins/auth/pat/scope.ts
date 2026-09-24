import { GROUP_ADMINS, GROUP_EDITORS, isBanned, resolveRights, type ResolvedRights } from '../rights.js';

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

export interface AccountLevel {
	banned: boolean;
	isAdmin: boolean;
	isEditor: boolean;
	rights: ResolvedRights;
	level: PatScope;
}

// Same inputs and the same isAdmin/isEditor rule as issueTokens.ts, so a
// token can never unlock more than a login session would.
export const resolveAccountLevel = ({ userRights, groupRights, groupId }: AccountRightsInput): AccountLevel => {
	const banned = isBanned(userRights) || isBanned(groupRights);
	const rights = resolveRights(userRights, groupRights);
	const isAdmin = !banned && groupId === GROUP_ADMINS;
	const isEditor = !banned && (groupId === GROUP_ADMINS || groupId === GROUP_EDITORS);
	const level: PatScope = isAdmin && rights.canEditUsers
		? 'admin'
		: isEditor && rights.canEditContent
			? 'editor'
			: 'read';

	return { banned, isAdmin, isEditor, rights, level };
};

export const effectiveLevel = (scope: PatScope, account: AccountLevel): PatScope =>
	levelAtLeast(account.level, scope) ? scope : account.level;
