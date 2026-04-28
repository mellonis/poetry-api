import { z } from 'zod';
import { thingSchema } from '../../lib/schemas.js';

enum SectionType {
	Common = 1,
	Ring,
	CollectionOfPoems
}

enum SectionThingsOrder {
	Asc = 1,
	Original = 0,
	Desc = -1,
}

const annotationSchema = z.object({
	text: z.string(),
	author: z.optional(z.string()),
});

export const sectionsResponse = z.array(
	z.object({
		id: z.string(),
		typeId: z.enum(SectionType),
		title: z.string(),
		description: z.optional(z.string()),
		annotation: z.optional(annotationSchema),
		settings: z.object({
			showAll: z.boolean(),
			thingsOrder: z.enum(SectionThingsOrder),
		}),
		thingsCount: z.number().int().min(0),
	}),
);

export const thingsRequest = z.object({
	identifier: z.string(),
});

export const thingsResponse = z.array(
	thingSchema.extend({
		position: z.number(),
	}),
);

export type Section = z.infer<typeof sectionsResponse>[number];
export type Thing = z.infer<typeof thingsResponse>[number];
export type ThingsRequest = z.infer<typeof thingsRequest>;
