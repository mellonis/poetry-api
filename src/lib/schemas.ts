import { z } from 'zod';
import { voteValueSchema } from './voteValue.js';

export enum ThingCategory {
	Poetry = 1,
	Prose,
	Tlya,
	Thought
}

export const errorResponse = z.object({ error: z.string() });

export const thingSchema = z.object({
	id: z.number(),
	categoryId: z.enum(ThingCategory),
	title: z.optional(z.string()),
	firstLines: z.optional(z.array(z.string())),
	startDate: z.optional(z.string()),
	finishDate: z.string(),
	lastModified: z.optional(z.date()),
	text: z.string(),
	notes: z.optional(z.array(z.string())),
	seoDescription: z.optional(z.string()),
	seoKeywords: z.optional(z.string()),
	info: z.optional(z.object({
		attachments: z.optional(z.object({
			audio: z.optional(z.array(z.object({
				preload: z.optional(z.enum(['none'])),
				title: z.optional(z.string()),
				sources: z.array(z.object({ src: z.string(), type: z.enum(['audio/mpeg']) })),
			}))),
		})),
	})),
	votes: z.object({
		likes: z.number().int().min(0),
		dislikes: z.number().int().min(0),
	}),
	userVote: z.optional(voteValueSchema),
});
