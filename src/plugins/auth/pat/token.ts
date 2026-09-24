import { randomBytes } from 'node:crypto';

// Personal access token wire format: `pat_` + 32 random bytes as base64url
// (43 chars, no padding) = 47 chars. The prefix lets /mcp reject a non-PAT
// bearer before any DB lookup. See docs/auth.md (personal access tokens).
export const PAT_PREFIX = 'pat_';
const PAT_RANDOM_BYTES = 32;
const PAT_RANDOM_LENGTH = 43;

export const generatePersonalAccessToken = (): string =>
	`${PAT_PREFIX}${randomBytes(PAT_RANDOM_BYTES).toString('base64url')}`;

export const isPersonalAccessToken = (value: string): boolean =>
	value.startsWith(PAT_PREFIX)
	&& value.length === PAT_PREFIX.length + PAT_RANDOM_LENGTH
	&& /^[A-Za-z0-9_-]+$/.test(value.slice(PAT_PREFIX.length));
