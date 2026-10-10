import { z } from "zod";
import { properties } from "../dashboard.config.js";

const propertyIds = properties.map((property) => property.id);
const reviewSchema = z.object({
  propertyId: z.enum(propertyIds),
  source: z.literal("booking"),
  sourceReviewId: z.string().nullable(),
  dedupeKey: z.string().min(1).max(128),
  contentHash: z.string().length(64),
  rating10: z.number().finite().min(0).max(10),
  ratingScale: z.union([z.literal(5), z.literal(10)]),
  ratingPrecision: z.enum(["exact", "rounded"]),
  title: z.string().nullable(),
  likedText: z.string().nullable(),
  dislikedText: z.string().nullable(),
  reviewDate: z.string().datetime(),
  stayDate: z.string().nullable(),
  reviewerCountry: z.string().nullable(),
  travellerType: z.string().nullable(),
  roomName: z.string().nullable(),
  nights: z.union([z.number().int().positive(), z.null()]),
  replyText: z.string().nullable(),
  reviewUrl: z.string().url().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
});

export function validateReview(review, now = new Date()) {
  const parsed = reviewSchema.safeParse(review);
  if (!parsed.success)
    return { ok: false, reason: parsed.error.issues[0].message };
  if (new Date(parsed.data.reviewDate).getTime() > now.getTime() + 86_400_000)
    return { ok: false, reason: "review_date_in_future" };
  return {
    ok: true,
    value: parsed.data,
    enrichable: Boolean(
      parsed.data.title || parsed.data.likedText || parsed.data.dislikedText,
    ),
  };
}
