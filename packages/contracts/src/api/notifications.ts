import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

/**
 * The notification kinds this platform actually produces. Each one is a projection of a durable
 * event, so the list is short by design: a kind appears here when a producer exists.
 */
export const NOTIFICATION_KINDS = ['approval.required', 'review.created'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationSchema = z.object({
  id: idSchema,
  org_id: idSchema,
  project_id: idSchema.nullable(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  severity: z.enum(['info', 'warning']),
  /** Read state is per member, not per organization. */
  read: z.boolean(),
  created_at: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

/**
 * The inbox plus the total unread count, which can exceed the page: the feed is bounded so a long
 * history cannot turn one request into the whole archive.
 */
export const notificationFeedSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;
