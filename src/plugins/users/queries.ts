export const getUserPasswordAndEmailQuery = `
	SELECT id, password_hash, email
	FROM auth_user
	WHERE id = ?
`;

export const updatePasswordQuery = `
	UPDATE auth_user
	SET password_hash = ?
	WHERE id = ?
`;

export const deleteUserQuery = `
	DELETE
	FROM auth_user
	WHERE id = ?
`;

export const getNotificationSettingsQuery = `
	SELECT notify_author_on_comment_reply, notify_author_on_comment_vote
	FROM auth_user
	WHERE id = ?
`;

export const updateNotificationSettingsQuery = `
	UPDATE auth_user
	SET notify_author_on_comment_reply = ?, notify_author_on_comment_vote = ?
	WHERE id = ?
`;
