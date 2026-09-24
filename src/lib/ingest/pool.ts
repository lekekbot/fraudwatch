/**
 * Run `worker` over `items` with at most `concurrency` in flight. The first
 * rejection stops new work from starting and is rethrown once in-flight work settles.
 */
export async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const run = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run));
  if (failure) throw (failure as { error: unknown }).error;
}
