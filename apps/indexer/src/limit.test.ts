import { describe, expect, test } from "bun:test";
import { classify, createLimiter } from "./limit";

const clock = (start = 0) => {
  let ms = start;
  return { now: () => ms, advance: (by: number) => void (ms += by) };
};

describe("classify", () => {
  test("puts sign in calls in the auth class", () => {
    expect(classify("POST", "/v1/auth/nonce")).toBe("auth");
    expect(classify("POST", "/v1/auth/verify")).toBe("auth");
  });

  test("puts writes and uploads in the write class", () => {
    expect(classify("POST", "/v1/facilities/421614/0xabc/metadata/versions")).toBe("write");
    expect(classify("POST", "/v1/facilities/421614/0xabc/underwriting/approve")).toBe("write");
    expect(classify("POST", "/v1/facilities/421614/0xabc/documents/upload-url")).toBe("write");
    expect(classify("PUT", "/v1/uploads/abc")).toBe("write");
  });

  test("puts json-rpc proxy calls in their own class", () => {
    expect(classify("POST", "/rpc/421614")).toBe("rpc");
    expect(classify("POST", "/rpc/4663")).toBe("rpc");
    expect(classify("GET", "/rpc/4663")).toBe("rpc");
  });

  test("puts other reads in the read class and exempts health", () => {
    expect(classify("GET", "/v1/activity")).toBe("read");
    expect(classify("GET", "/v1/downloads/abc")).toBe("read");
    expect(classify("GET", "/v1/health")).toBe("exempt");
  });
});

describe("limiter", () => {
  test("allows the capacity and then answers with a retry delay", () => {
    const time = clock();
    const limiter = createLimiter({ now: time.now, rules: { auth: { capacity: 3, perMinute: 3 } } });
    for (let i = 0; i < 3; i += 1) expect(limiter.take("1.2.3.4", "auth").ok).toBe(true);
    const denied = limiter.take("1.2.3.4", "auth");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfter).toBe(20);
  });

  test("refills as time passes", () => {
    const time = clock();
    const limiter = createLimiter({ now: time.now, rules: { auth: { capacity: 3, perMinute: 3 } } });
    for (let i = 0; i < 3; i += 1) limiter.take("1.2.3.4", "auth");
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(false);
    time.advance(20_000);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(true);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(false);
  });

  test("never refills beyond the capacity", () => {
    const time = clock();
    const limiter = createLimiter({ now: time.now, rules: { auth: { capacity: 2, perMinute: 60 } } });
    limiter.take("1.2.3.4", "auth");
    time.advance(600_000);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(true);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(true);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(false);
  });

  test("keeps clients and classes apart", () => {
    const time = clock();
    const limiter = createLimiter({ now: time.now, rules: { auth: { capacity: 1, perMinute: 1 }, write: { capacity: 1, perMinute: 1 } } });
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(true);
    expect(limiter.take("1.2.3.4", "auth").ok).toBe(false);
    expect(limiter.take("5.6.7.8", "auth").ok).toBe(true);
    expect(limiter.take("1.2.3.4", "write").ok).toBe(true);
  });

  test("never limits the exempt class", () => {
    const limiter = createLimiter({ now: clock().now });
    for (let i = 0; i < 10_000; i += 1) expect(limiter.take("1.2.3.4", "exempt").ok).toBe(true);
    expect(limiter.size()).toBe(0);
  });

  test("uses separate default limits per class", () => {
    const limiter = createLimiter({ now: clock().now });
    const count = (cls: "auth" | "write" | "read") => {
      let allowed = 0;
      while (limiter.take(cls, cls).ok && allowed < 1000) allowed += 1;
      return allowed;
    };
    expect(count("auth")).toBe(10);
    expect(count("write")).toBe(20);
    expect(count("read")).toBe(240);
  });

  test("drops idle buckets so memory does not grow", () => {
    const time = clock();
    const limiter = createLimiter({ now: time.now, idleMs: 60_000 });
    for (let i = 0; i < 50; i += 1) limiter.take(`10.0.0.${i}`, "read");
    expect(limiter.size()).toBe(50);
    time.advance(120_000);
    limiter.take("9.9.9.9", "read");
    expect(limiter.size()).toBe(1);
  });
});

describe("rpc class", () => {
  test("has a larger default budget than plain reads", () => {
    const limiter = createLimiter({ now: () => 0 });
    let taken = 0;
    while (limiter.take("a", "rpc").ok && taken < 1000) taken += 1;
    expect(taken).toBe(600);
  });
});
