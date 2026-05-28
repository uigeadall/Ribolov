import { useEffect, useState } from 'react';
import { subscribeFeedVisibility } from '../services/feedVisibility';

/** Returns true when the given feed item id is currently visible in the
    parent FeedScreen list. Used inside FeedPost / PostCard to gate their
    own expensive subscriptions without their parent having to pass an
    `isVisible` prop (which would force the parent's renderItem closure to
    regenerate on every viewability tick — exactly the cost we're avoiding).

    Components that render a feed card OUTSIDE a feed list (catch detail,
    profile screen, etc.) should bypass this hook and pass `isVisible={true}`
    via the explicit prop — the FeedScreen pub-sub has no entries for those
    contexts, so this hook would return false there. */
export function useFeedItemVisibility(id: string): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    return subscribeFeedVisibility(id, setVisible);
  }, [id]);
  return visible;
}
