export const findUserByLoginQuery = `
	SELECT user_id, user_login, user_password, user_email, user_rights,
		   user_key, group_id, group_rights, token_version
	FROM v_users_info
	WHERE user_login = ?
`;

export const insertRefreshTokenQuery = `
	INSERT INTO auth_refresh_token (r_user_id, token_hash, expires_at)
	VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
`;

export const findRefreshTokenWithUserQuery = `
	SELECT t.id AS token_id,
	       u.user_id, u.user_login, u.user_password, u.user_email, u.user_rights,
	       u.group_id, u.group_rights, u.token_version
	FROM auth_refresh_token t
	JOIN v_users_info u ON u.user_id = t.r_user_id
	WHERE t.token_hash = ? AND t.expires_at > NOW()
`;

export const deleteRefreshTokenQuery = `
	DELETE FROM auth_refresh_token WHERE id = ?
`;

export const deleteAllUserRefreshTokensQuery = `
	DELETE FROM auth_refresh_token WHERE r_user_id = ?
`;

export const rehashPasswordQuery = `
	UPDATE auth_user SET password_hash = ? WHERE id = ?
`;

export const updateLastLoginQuery = `
	UPDATE auth_user SET last_login = NOW() WHERE id = ?
`;

export const insertUserQuery = `
	INSERT INTO auth_user (r_group_id, rights, login, password_hash, email, \`key\`, key_created_at, display_name)
	VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
`;

export const updateUserRightsAndKeyQuery = `
	UPDATE auth_user SET rights = ?, \`key\` = ?, key_created_at = ? WHERE id = ?
`;

export const findUserByKeyQuery = `
	SELECT user_id, user_login, user_rights, group_id, group_rights, token_version
	FROM v_users_info
	WHERE user_key = ?
`;

export const resetPasswordQuery = `
	UPDATE auth_user SET password_hash = ?, \`key\` = NULL, key_created_at = NULL, rights = ? WHERE id = ?
`;

export const findUserByEmailQuery = `
	SELECT user_id, user_login, user_password, user_email, user_rights,
		   user_key, group_id, group_rights, token_version
	FROM v_users_info
	WHERE user_email = ?
`;

export const loginOrEmailExistsQuery = `
	SELECT 1 FROM v_users_info WHERE user_login = ? OR user_email = ? LIMIT 1
`;
