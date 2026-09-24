import { describe, expect, it } from 'vitest';
import { effectiveLevel, levelAtLeast, resolveAccountLevel, scopeFromDb, scopeToDb } from './scope.js';

const ADMIN_GROUP = { groupId: 1, groupRights: 63488 };
const EDITOR_GROUP = { groupId: 2, groupRights: 14336 };
const USER_GROUP = { groupId: 3, groupRights: 0 };

describe('scope ↔ db', () => {
	it('maps read/editor/admin to 1/2/3 and back', () => {
		expect(scopeToDb('read')).toBe(1);
		expect(scopeToDb('editor')).toBe(2);
		expect(scopeToDb('admin')).toBe(3);
		expect(scopeFromDb(2)).toBe('editor');
		expect(() => scopeFromDb(9)).toThrow(/scope/);
	});
});

describe('resolveAccountLevel', () => {
	it('admin group with canEditUsers → admin', () => {
		const a = resolveAccountLevel({ userRights: 25, ...ADMIN_GROUP });
		expect(a.level).toBe('admin');
		expect(a.isAdmin).toBe(true);
		expect(a.rights.canEditUsers).toBe(true);
	});

	it('editor group with canEditContent → editor', () => {
		const a = resolveAccountLevel({ userRights: 25, ...EDITOR_GROUP });
		expect(a.level).toBe('editor');
		expect(a.isEditor).toBe(true);
		expect(a.isAdmin).toBe(false);
	});

	it('editor whose per-user override clears bit 12 → read', () => {
		// XOR rule: group sets bit 12, user bit 12 toggles it off.
		const a = resolveAccountLevel({ userRights: 25 | (1 << 12), ...EDITOR_GROUP });
		expect(a.level).toBe('read');
		expect(a.isEditor).toBe(true);
		expect(a.rights.canEditContent).toBe(false);
	});

	it('plain user → read', () => {
		expect(resolveAccountLevel({ userRights: 25, ...USER_GROUP }).level).toBe('read');
	});

	it('banned zeroes everything', () => {
		const a = resolveAccountLevel({ userRights: 25 | (1 << 2), ...ADMIN_GROUP });
		expect(a.banned).toBe(true);
		expect(a.level).toBe('read');
		expect(a.isAdmin).toBe(false);
		expect(a.rights.canEditUsers).toBe(false);
	});
});

describe('effectiveLevel', () => {
	it('is the lower of scope and account level', () => {
		const editor = resolveAccountLevel({ userRights: 25, ...EDITOR_GROUP });
		const admin = resolveAccountLevel({ userRights: 25, ...ADMIN_GROUP });
		const user = resolveAccountLevel({ userRights: 25, ...USER_GROUP });
		expect(effectiveLevel('admin', editor)).toBe('editor');
		expect(effectiveLevel('read', admin)).toBe('read');
		expect(effectiveLevel('editor', admin)).toBe('editor');
		expect(effectiveLevel('editor', user)).toBe('read');
	});

	it('levelAtLeast orders read < editor < admin', () => {
		expect(levelAtLeast('admin', 'editor')).toBe(true);
		expect(levelAtLeast('read', 'editor')).toBe(false);
		expect(levelAtLeast('editor', 'editor')).toBe(true);
	});
});
