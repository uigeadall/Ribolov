// Pub-sub for feed-item visibility. Used by FeedPost / PostCard to opt
// themselves in / out of expensive subscriptions (reactions, comment counts,
// saved-state) based on whether they're actually on screen.
//
// Why a separate pub-sub instead of a React context: the visible set changes
// on every viewability tick during a scroll — putting it in state and into a
// context provider would re-render every consumer of that context on every
// tick, even consumers whose visibility status didn't change. The pub-sub
// dispatches per-id, so a card that flips invisible→visible fires exactly
// one callback for its own id; the other 19 visible cards see nothing.

type Listener = (visible: boolean) => void;

const _listenersById = new Map<string, Set<Listener>>();
const _visibleSet = new Set<string>();

/** FeedScreen's onViewableItemsChanged callback calls this with the current
    set of visible item ids. We diff against the previous set and dispatch
    callbacks only for ids whose visibility flipped. */
export function publishFeedVisibility(nextIds: Set<string>): void {
  // Find ids that were visible and aren't anymore — emit visible=false.
  for (const id of _visibleSet) {
    if (!nextIds.has(id)) {
      _listenersById.get(id)?.forEach((cb) => {
        try { cb(false); } catch { /* per-listener errors don't propagate */ }
      });
    }
  }
  // Find ids that are now visible and weren't before — emit visible=true.
  for (const id of nextIds) {
    if (!_visibleSet.has(id)) {
      _listenersById.get(id)?.forEach((cb) => {
        try { cb(true); } catch { /* per-listener errors don't propagate */ }
      });
    }
  }
  // Swap the cached set. We replace contents rather than the reference so
  // future calls into this module can use `_visibleSet.has(...)` against the
  // same long-lived Set.
  _visibleSet.clear();
  for (const id of nextIds) _visibleSet.add(id);
}

/** Subscribe to visibility for a single feed item. The callback fires once
    immediately with the current state, then again whenever the item's
    visibility flips. Returns an unsubscribe function — callers are expected
    to call it from a useEffect cleanup. */
export function subscribeFeedVisibility(id: string, cb: Listener): () => void {
  let set = _listenersById.get(id);
  if (!set) {
    set = new Set();
    _listenersById.set(id, set);
  }
  set.add(cb);
  // Push the current state synchronously so the subscriber doesn't see an
  // initial flicker of "false" before the next viewability tick.
  try { cb(_visibleSet.has(id)); } catch { /* swallow */ }

  return () => {
    const s = _listenersById.get(id);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) _listenersById.delete(id);
  };
}

/** Test/dev seam: clears the entire registry. Not used by production code. */
export function _resetFeedVisibility(): void {
  _listenersById.clear();
  _visibleSet.clear();
}
