/** Tiny TTL'd in-memory key→value map. Shared by the read-cost caches
    (blocked-uids, saved-state) that trade a bounded staleness window for
    not re-reading the same Firestore data on every card mount. The nowFn
    parameter exists for deterministic tests. */
export class TtlMap<K, V> {
  private readonly map = new Map<K, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly nowFn: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.nowFn() - entry.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.map.set(key, { value, at: this.nowFn() });
  }

  delete(key: K): void {
    this.map.delete(key);
  }
}
