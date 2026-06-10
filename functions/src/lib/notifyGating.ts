// Pure notification-gating helpers — no firebase-admin dependency, so they can
// be unit-tested directly. The db-coupled getNotifPrefs() stays in index.ts.

/** The subset of notification preferences that gate whether a push fires. */
export type NotifGatingPrefs = {
  likes: boolean;
  comments: boolean;
  follows: boolean;
  messages: boolean;
  storyReactions: boolean;
  mentions: boolean;
};

/** Does the user's per-type preference allow a push of this `type`? Unknown
    types default to true — system / transactional notifications always send. */
export function shouldNotify(type: string | undefined, prefs: NotifGatingPrefs): boolean {
  switch (type) {
    case "like": return prefs.likes;
    case "comment": return prefs.comments;
    case "follow": return prefs.follows;
    case "message": return prefs.messages;
    case "mention": return prefs.mentions;
    case "storyLike":
    case "storyComment": return prefs.storyReactions;
    default: return true;
  }
}

/** True when the current wall-clock time in the user's timezone falls inside
    their quiet-hours window. Same-day windows (13→18) and cross-midnight
    windows (22→7) are both handled. Disabled, missing bounds, or an empty
    window (start === end) all yield false. */
export function quietHoursActive(args: {
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  timezone?: string;
}): boolean {
  if (!args.quietHoursEnabled) return false;
  const start = args.quietHoursStart;
  const end = args.quietHoursEnd;
  if (typeof start !== "number" || typeof end !== "number") return false;
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: args.timezone || "Europe/Sofia",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10,
  );
  if (!Number.isFinite(hour)) return false;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
