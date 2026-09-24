export const insertPersonalAccessTokenQuery = `
	INSERT INTO auth_personal_access_token (r_user_id, name, token_hash, scope)
	VALUES (?, ?, ?, ?)
`;

export const listPersonalAccessTokensQuery = `
	SELECT id, name, scope, created_at, last_used_at
	FROM auth_personal_access_token
	WHERE r_user_id = ?
	ORDER BY created_at DESC, id DESC
`;

export const findPersonalAccessTokenWithUserQuery = `
	SELECT t.id AS token_id, t.scope,
	       u.user_id, u.user_login, u.user_rights, u.group_id, u.group_rights, u.token_version
	FROM auth_personal_access_token t
	JOIN v_users_info u ON u.user_id = t.r_user_id
	WHERE t.token_hash = ?
`;

export const deletePersonalAccessTokenQuery = `
	DELETE FROM auth_personal_access_token WHERE id = ? AND r_user_id = ?
`;

export const deleteAllUserPersonalAccessTokensQuery = `
	DELETE FROM auth_personal_access_token WHERE r_user_id = ?
`;

export const touchPersonalAccessTokenQuery = `
	UPDATE auth_personal_access_token SET last_used_at = NOW() WHERE id = ?
`;
