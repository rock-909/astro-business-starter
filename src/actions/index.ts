import { defineAction } from 'astro:actions';
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
      return submitInquiry(input, context.request, context.locals);
    },
  }),
};
