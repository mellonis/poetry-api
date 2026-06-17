import { z } from 'zod';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const NOTIFICATION_TYPE = {
	commentReply: 1,
	commentVote: 2,
} as const;

export const notificationTypeCode = z.enum(['comment_reply', 'comment_vote']);

export const errorBody = (code: string, message?: string) =>
	({ error: code, ...(message ? { message } : {}) });

const subjectCommentSchema = z.object({
	id: z.number().int().positive(),
	text: z.string(),
	threadCommentId: z.number().int().positive(),
	thingId: z.number().int().positive().nullable(),
	sectionIdentifier: z.string().nullable(),
	positionInSection: z.number().int().positive().nullable(),
});

const objectCommentSchema = z.object({
	id: z.number().int().positive(),
	text: z.string(),
	authorDisplayName: z.string().nullable(),
	authorIsAuthor: z.boolean(),
});

export const notificationItemSchema = z.object({
	id: z.number().int().positive(),
	type: notificationTypeCode,
	eventCount: z.number().int().min(1),
	isRead: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
	subjectComment: subjectCommentSchema,
	objectComment: objectCommentSchema.nullable(),
});

export const notificationParams = z.object({
	notificationId: z.coerce.number().int().positive(),
});

export const notificationListQuery = z.object({
	cursor: z.optional(z.string().min(1).max(256)),
	limit: z.optional(z.coerce.number().int().min(1).max(MAX_LIMIT)),
	unreadOnly: z.optional(z.coerce.boolean()),
});

export const notificationListResponse = z.object({
	items: z.array(notificationItemSchema),
	nextCursor: z.string().nullable(),
});

export const summaryResponse = z.object({
	unreadCount: z.number().int().min(0),
});

export const okResponse = z.object({
	ok: z.literal(true),
});

export const markAllReadResponse = z.object({
	ok: z.literal(true),
	marked: z.number().int().min(0),
});

export const settingsResponse = z.object({
	notifyAuthorOnCommentReply: z.boolean(),
	notifyAuthorOnCommentVote: z.boolean(),
});

export const updateSettingsRequest = settingsResponse;

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuery>;
export type NotificationParams = z.infer<typeof notificationParams>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequest>;
export type SettingsResponse = z.infer<typeof settingsResponse>;
