/** A small LRU with both entry and weight limits. Oversized values are not retained. */
export function createLruCache<K, V>(maxEntries: number, maxWeight = Infinity, weigh: (value: V) => number = () => 1) {
  const entries = new Map<K, { value: V; weight: number }>();
  let totalWeight = 0;
  const remove = (key: K) => {
    const entry = entries.get(key);
    if (!entry) return;
    totalWeight -= entry.weight;
    entries.delete(key);
  };
  return {
    get size() {
      return entries.size;
    },
    get(key: K): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: K, value: V) {
      remove(key);
      const weight = Math.max(0, weigh(value));
      if (maxEntries <= 0 || weight > maxWeight) return;
      entries.set(key, { value, weight });
      totalWeight += weight;
      while (entries.size > maxEntries || totalWeight > maxWeight) remove(entries.keys().next().value!);
    },
    delete: remove,
    clear() {
      entries.clear();
      totalWeight = 0;
    },
    values(): V[] {
      return [...entries.values()].map((entry) => entry.value);
    },
  };
}
