import { z } from 'zod';

const loginSchema = z.string()
	.min(2).max(16)
	.transform((v) => v.toLowerCase())
	.pipe(z.string().regex(/^[a-z][a-z0-9_]{1,15}$/, 'Login must start with a letter and contain only lowercase letters, digits, and underscores'));

export const resolvedRightsSchema = z.object({
	canVote: z.boolean(),
	canComment: z.boolean(),
	canEditContent: z.boolean(),
	canEditUsers: z.boolean(),
});

export const userInfoSchema = z.object({
	id: z.number(),
	login: z.string(),
	rights: resolvedRightsSchema,
});

export const loginRequest = z.object({
	login: loginSchema,
	password: z.string().min(1),
});

export const loginResponse = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	user: userInfoSchema,
});

export const refreshRequest = z.object({
	refreshToken: z.string().length(64),
});

export const refreshResponse = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
});

export const logoutRequest = z.object({
	refreshToken: z.string().length(64),
});

export const registerRequest = z.object({
	login: loginSchema,
	password: z.string().min(6),
	email: z.email().max(50),
});

export const activateRequest = z.object({
	key: z.string(),
});

export const requestPasswordResetRequest = z.object({
	email: z.email().max(50),
});

export const resetPasswordRequest = z.object({
	key: z.string(),
	newPassword: z.string().min(6),
});

export const resendActivationRequest = z.object({
	login: loginSchema,
});

export const authErrorResponse = z.object({
	error: z.string(),
	message: z.string(),
});

export type LoginRequest = z.infer<typeof loginRequest>;
export type RefreshRequest = z.infer<typeof refreshRequest>;
export type LogoutRequest = z.infer<typeof logoutRequest>;
export type RegisterRequest = z.infer<typeof registerRequest>;
export type ActivateRequest = z.infer<typeof activateRequest>;
export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetRequest>;
export type ResendActivationRequest = z.infer<typeof resendActivationRequest>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>;
