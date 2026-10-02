export type LimitClass = "auth" | "approve" | "write" | "read" | "rpc" | "exempt";
type Limited = Exclude<LimitClass, "exempt">;

export interface Rule {
  capacity: number;
  perMinute: number;
}

export type Take = { ok: true } | { ok: false; retryAfter: number };

export interface LimiterOptions {
  now: () => number;
  rules?: Partial<Record<Limited, Rule>>;
  idleMs?: number;
}

const DEFAULT_RULES: Record<Limited, Rule> = {
  auth: { capacity: 10, perMinute: 10 },
  approve: { capacity: 5, perMinute: 5 },
  write: { capacity: 20, perMinute: 20 },
  read: { capacity: 240, perMinute: 240 },
  rpc: { capacity: 600, perMinute: 600 },
};

const DEFAULT_IDLE_MS = 10 * 60_000;

export function classify(method: string, pathname: string): LimitClass {
  if (pathname === "/v1/health") return "exempt";
  if (pathname.startsWith("/rpc/")) return "rpc";
  if (method === "POST" && pathname.startsWith("/v1/auth/")) return "auth";
  if (method === "POST" && pathname === "/v1/originator-approvals") return "approve";
  if (method === "POST" || method === "PUT") return "write";
  return "read";
}

export function createLimiter(options: LimiterOptions) {
  const rules = { ...DEFAULT_RULES, ...options.rules };
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const buckets = new Map<string, { tokens: number; at: number }>();
  let sweptAt = options.now();

  const sweep = (now: number) => {
    if (now - sweptAt < idleMs) return;
    sweptAt = now;
    for (const [key, bucket] of buckets) if (now - bucket.at >= idleMs) buckets.delete(key);
  };

  return {
    take(client: string, cls: LimitClass): Take {
      if (cls === "exempt") return { ok: true };
      const now = options.now();
      sweep(now);
      const rule = rules[cls];
      const key = `${cls}:${client}`;
      const bucket = buckets.get(key) ?? { tokens: rule.capacity, at: now };
      const refilled = Math.min(rule.capacity, bucket.tokens + ((now - bucket.at) * rule.perMinute) / 60_000);
      if (refilled < 1) {
        buckets.set(key, { tokens: refilled, at: now });
        return { ok: false, retryAfter: Math.ceil(((1 - refilled) * 60) / rule.perMinute) };
      }
      buckets.set(key, { tokens: refilled - 1, at: now });
      return { ok: true };
    },
    size: () => buckets.size,
  };
}
