import { z } from 'zod';

export const userIdParam = z.object({
	userId: z.coerce.number().int().positive(),
});

export const changePasswordRequest = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(6),
});

export const deleteUserRequest = z.object({
	password: z.string().min(1),
});

export const notificationSettingsResponse = z.object({
	notifyAuthorOnCommentReply: z.boolean(),
	notifyAuthorOnCommentVote: z.boolean(),
});

export const updateNotificationSettingsRequest = z.object({
	notifyAuthorOnCommentReply: z.boolean(),
	notifyAuthorOnCommentVote: z.boolean(),
});

export type UserIdParam = z.infer<typeof userIdParam>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;
export type DeleteUserRequest = z.infer<typeof deleteUserRequest>;
export type NotificationSettingsResponse = z.infer<typeof notificationSettingsResponse>;
export type UpdateNotificationSettingsRequest = z.infer<typeof updateNotificationSettingsRequest>;
