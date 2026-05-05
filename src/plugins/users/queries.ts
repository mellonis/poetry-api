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

export const getDisplayNameQuery = `
  SELECT display_name AS displayName, display_name_changed_at AS displayNameChangedAt
  FROM auth_user WHERE id = ?
`;

export const updateDisplayNameQuery = `
  UPDATE auth_user
  SET display_name = ?, display_name_changed_at = NOW()
  WHERE id = ?
`;

export const getAllReservedValuesQuery = `
  SELECT value FROM reserved_display_name
`;
