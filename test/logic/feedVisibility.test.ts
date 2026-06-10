import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publishFeedVisibility,
  subscribeFeedVisibility,
  _resetFeedVisibility,
} from '../../src/services/feedVisibility';

const ids = (...xs: string[]) => new Set(xs);

describe('feedVisibility pub-sub', () => {
  afterEach(() => _resetFeedVisibility());

  it('fires immediately with current state on subscribe (false when nothing visible)', () => {
    const cb = vi.fn();
    subscribeFeedVisibility('a', cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('subscribing to an already-visible id fires true immediately', () => {
    publishFeedVisibility(ids('a'));
    const cb = vi.fn();
    subscribeFeedVisibility('a', cb);
    expect(cb).toHaveBeenLastCalledWith(true);
  });

  it('dispatches true when an id becomes visible and false when it leaves', () => {
    const cb = vi.fn();
    subscribeFeedVisibility('a', cb);   // initial false
    publishFeedVisibility(ids('a'));    // -> true
    publishFeedVisibility(ids());       // -> false
    expect(cb.mock.calls.map((c) => c[0])).toEqual([false, true, false]);
  });

  it('does not re-dispatch when visibility is unchanged across ticks', () => {
    const cb = vi.fn();
    subscribeFeedVisibility('a', cb);   // false
    publishFeedVisibility(ids('a'));    // true
    publishFeedVisibility(ids('a'));    // still visible -> no new call
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('only notifies ids whose visibility actually flipped', () => {
    const a = vi.fn();
    const b = vi.fn();
    publishFeedVisibility(ids('a'));    // a visible (no listeners yet)
    subscribeFeedVisibility('a', a);    // immediate true
    subscribeFeedVisibility('b', b);    // immediate false
    a.mockClear();
    b.mockClear();
    publishFeedVisibility(ids('a', 'b')); // a unchanged, b -> true
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(true);
  });

  it('unsubscribe stops further callbacks', () => {
    const cb = vi.fn();
    const off = subscribeFeedVisibility('a', cb);
    cb.mockClear();
    off();
    publishFeedVisibility(ids('a'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('a throwing listener does not block others', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    subscribeFeedVisibility('a', bad);
    subscribeFeedVisibility('a', good);
    good.mockClear();
    publishFeedVisibility(ids('a'));
    expect(good).toHaveBeenCalledWith(true);
  });
});
