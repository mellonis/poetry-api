import { z } from 'zod';
import { voteValueSchema } from '../../lib/voteValue.js';
import { COMMENT_MAX_LENGTH, COMMENT_MIN_LENGTH } from './sanitizeCommentText.js';

export const COMMENT_STATUS = {
	visible: 1,
	hidden: 2,
	deleted: 3,
} as const;

export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

const commentParams = z.object({
	commentId: z.coerce.number().int().positive(),
});

const commentVotes = z.object({
	likes: z.number().int().min(0),
	dislikes: z.number().int().min(0),
});

const commentBaseSchema = z.object({
	id: z.number().int().positive(),
	parentId: z.number().int().positive().nullable(),
	thingId: z.number().int().positive().nullable(),
	userId: z.number().int().positive().nullable(),
	authorLogin: z.string().nullable(),
	text: z.string().nullable(),
	statusId: z.number().int().min(1).max(3),
	createdAt: z.string(),
	updatedAt: z.string(),
	votes: commentVotes,
	userVote: z.optional(voteValueSchema),
});

const commentWithRepliesSchema = commentBaseSchema.extend({
	replies: z.optional(z.array(commentBaseSchema)),
});

const commentListQuery = z.object({
	thingId: z.optional(z.coerce.number().int().positive()),
	scope: z.optional(z.enum(['site', 'thing'])),
	limit: z.optional(z.coerce.number().int().min(1).max(100)),
	offset: z.optional(z.coerce.number().int().min(0)),
});

const commentListResponse = z.object({
	items: z.array(commentWithRepliesSchema),
	total: z.number().int().min(0),
	hasMore: z.boolean(),
});

const createCommentRequest = z.object({
	thingId: z.optional(z.number().int().positive().nullable()),
	parentId: z.optional(z.number().int().positive().nullable()),
	text: z.string().min(COMMENT_MIN_LENGTH).max(COMMENT_MAX_LENGTH),
});

const updateCommentRequest = z.object({
	text: z.string().min(COMMENT_MIN_LENGTH).max(COMMENT_MAX_LENGTH),
});

const voteCommentRequest = z.object({
	vote: voteValueSchema,
});

const voteCommentResponse = commentVotes.extend({
	userVote: voteValueSchema,
});

const reportCommentRequest = z.object({
	reason: z.optional(z.string().max(500)),
});

const cmsCommentListQuery = z.object({
	status: z.optional(z.enum(['visible', 'hidden', 'deleted', 'reported'])),
	thingId: z.optional(z.coerce.number().int().positive()),
	userId: z.optional(z.coerce.number().int().positive()),
	scope: z.optional(z.enum(['site', 'thing'])),
	limit: z.optional(z.coerce.number().int().min(1).max(100)),
	offset: z.optional(z.coerce.number().int().min(0)),
});

const cmsCommentRow = commentBaseSchema.extend({
	reportCount: z.number().int().min(0),
	statusChangedAt: z.string(),
	statusChangedByUserId: z.number().int().positive().nullable(),
});

const cmsCommentListResponse = z.object({
	items: z.array(cmsCommentRow),
	total: z.number().int().min(0),
	hasMore: z.boolean(),
});

const okResponse = z.object({ ok: z.literal(true) });

export {
	commentParams,
	commentBaseSchema,
	commentWithRepliesSchema,
	commentListQuery,
	commentListResponse,
	createCommentRequest,
	updateCommentRequest,
	voteCommentRequest,
	voteCommentResponse,
	reportCommentRequest,
	cmsCommentListQuery,
	cmsCommentListResponse,
	okResponse,
};

export type CommentParams = z.infer<typeof commentParams>;
export type CommentBase = z.infer<typeof commentBaseSchema>;
export type CommentWithReplies = z.infer<typeof commentWithRepliesSchema>;
export type CommentListQuery = z.infer<typeof commentListQuery>;
export type CreateCommentRequest = z.infer<typeof createCommentRequest>;
export type UpdateCommentRequest = z.infer<typeof updateCommentRequest>;
export type VoteCommentRequest = z.infer<typeof voteCommentRequest>;
export type ReportCommentRequest = z.infer<typeof reportCommentRequest>;
export type CmsCommentListQuery = z.infer<typeof cmsCommentListQuery>;
