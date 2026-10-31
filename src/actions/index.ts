import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { assertInquiryAdmission } from '../lib/admission';
import { submitInquiry } from '../lib/inquiry';

export const server = {
  inquiry: defineAction({
    accept: 'json',
    // The actual lead schema runs after honeypot detection, preserving the source
    // contract that bots receive synthetic success even with invalid buyer data.
    input: z.record(z.string(), z.unknown()),
    handler: async (input, context) => {
      assertInquiryAdmission(context.request);
      try {
        return await submitInquiry(input, context.request, context.locals);
      } catch (error) {
        if (error instanceof ActionError) throw error;
        // Astro would return the raw message to the caller; it may name a provider or credential.
        console.error('inquiry.unexpected_error');
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'INTERNAL_ERROR' });
      }
    },
  }),
};
