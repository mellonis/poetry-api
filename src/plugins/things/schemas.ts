import { z } from 'zod';
import { thingSchema } from '../../lib/schemas.js';

export const thingIdParams = z.object({
	thingId: z.coerce.number().int().positive(),
});

export const publicThingResponse = thingSchema.extend({
	sections: z.array(z.object({
		id: z.string(),
		position: z.number(),
	})),
});

export type ThingIdParams = z.infer<typeof thingIdParams>;
export type PublicThing = z.infer<typeof publicThingResponse>;
