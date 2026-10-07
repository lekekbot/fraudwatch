export type WorkQueue<T> = {
  /** Add work; it starts as soon as a slot is free, even while earlier work is running. */
  push(items: Iterable<T>): void;
  /** Resolves once everything pushed so far has finished; rejects with the first worker error. */
  drain(): Promise<void>;
  readonly pending: number;
  readonly active: number;
};

/**
 * A worker pool that accepts new items while it runs, with at most
 * `concurrency` in flight. The first rejection stops new work from starting.
 */
export function createWorkQueue<T>(concurrency: number, worker: (item: T) => Promise<void>): WorkQueue<T> {
  const limit = Math.max(1, concurrency);
  let items: T[] = [];
  let head = 0;
  let active = 0;
  let failure: { error: unknown } | null = null;
  let waiters: Array<() => void> = [];

  const pump = () => {
    while (failure === null && active < limit && head < items.length) {
      const item = items[head++];
      active++;
      worker(item)
        .catch((error: unknown) => {
          failure ??= { error };
        })
        .finally(() => {
          active--;
          pump();
        });
    }
    // Release the consumed prefix so a long run doesn't keep every item alive.
    if (head === items.length) {
      items = [];
      head = 0;
    }
    if (active === 0 && (head === items.length || failure)) {
      for (const resolve of waiters) resolve();
      waiters = [];
    }
  };

  return {
    push(more) {
      for (const item of more) items.push(item);
      pump();
    },
    async drain() {
      if (active > 0 || (head < items.length && !failure)) await new Promise<void>((resolve) => waiters.push(resolve));
      if (failure) throw failure.error;
    },
    get pending() {
      return failure ? 0 : items.length - head;
    },
    get active() {
      return active;
    },
  };
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. The first
 * rejection stops new work from starting and is rethrown once in-flight work settles.
 */
export async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = createWorkQueue(concurrency, worker);
  queue.push(items);
  await queue.drain();
}
