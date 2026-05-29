/**
 * Returns a function that runs async tasks one at a time in arrival order.
 * Each call waits for the previous call's promise to settle (resolve or
 * reject) before starting. Used to serialise read-modify-write sequences
 * that would otherwise race when fired concurrently.
 *
 * Note: this is a per-instance serialiser, not a shared lock. For
 * coalescing parallel callers onto a single in-flight promise (single-flight
 * by key), use a different pattern.
 */
export function makePromiseChain(): <T>(task: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.then(
      () => {},
      () => {},
    );
    return next as Promise<T>;
  };
}
