import { describe, expect, it } from "vitest";
import { createLruCache } from "./lruCache";

describe("bounded LRU", () => {
  it("evicts the least recently used value and accounts for replacements", () => {
    const cache = createLruCache<string, string>(2, 6, (value) => value.length);
    cache.set("a", "aa");
    cache.set("b", "bb");
    expect(cache.get("a")).toBe("aa");
    cache.set("c", "cc");
    expect(cache.get("b")).toBeUndefined();
    cache.set("a", "aaaaa");
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")).toBe("aaaaa");
    cache.set("large", "1234567");
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
    cache.set("d", "123456");
    expect(cache.get("d")).toBe("123456");
  });
});
