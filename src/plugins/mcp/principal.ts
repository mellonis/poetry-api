import type { PatScope } from '../auth/pat/scope.js';
import type { ResolvedRights } from '../auth/rights.js';

// Who is calling /mcp. A token principal carries the account's *current*
// resolved rights and the effective level (scope ∩ account level); the bridge
// cuts JWT claims from it and never widens them. See docs/auth.md (personal
// access tokens).
export interface McpPrincipal {
	userId: number;
	login: string;
	tokenId: number;
	tokenVersion: number;
	level: PatScope;
	isAdmin: boolean;
	isEditor: boolean;
	rights: ResolvedRights;
}

export type McpCaller =
	| { kind: 'anonymous' }
	| { kind: 'token'; principal: McpPrincipal };

// Catalogue levels: 'public' tools are visible to anonymous and read tokens.
export type ToolLevel = 'public' | 'editor' | 'admin';

const TOOL_LEVEL_RANK: Record<ToolLevel, number> = { public: 0, editor: 1, admin: 2 };

export const callerToolLevel = (caller: McpCaller): ToolLevel => {
	if (caller.kind === 'anonymous' || caller.principal.level === 'read') return 'public';
	return caller.principal.level;
};

export const toolLevelAtLeast = (level: ToolLevel, required: ToolLevel): boolean =>
	TOOL_LEVEL_RANK[level] >= TOOL_LEVEL_RANK[required];
