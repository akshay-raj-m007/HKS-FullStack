export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs: number): void;
  clear(): void;
}
export class MemoryCache<T> implements Cache<T> {
  private values = new Map<string, { value: T; until: number }>();
  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return;
    if (entry.until <= Date.now()) {
      this.values.delete(key);
      return;
    }
    return entry.value;
  }
  set(key: string, value: T, ttlMs: number) {
    if (this.values.size >= 100) this.values.clear();
    this.values.set(key, { value, until: Date.now() + ttlMs });
  }
  clear() {
    this.values.clear();
  }
}
