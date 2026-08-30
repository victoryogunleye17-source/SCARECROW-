import { Redis } from "@upstash/redis";

export type StoreKind = "memory" | "redis";

type KvEntry = { value: string; exp: number | null };
type ListEntry = { values: string[]; exp: number | null };
type SetEntry = { values: Set<string>; exp: number | null };

type MemoryBag = {
  kv: Map<string, KvEntry>;
  lists: Map<string, ListEntry>;
  sets: Map<string, SetEntry>;
};

const g = globalThis as unknown as { __scarecrowStore?: MemoryBag };

function memoryBag(): MemoryBag {
  if (!g.__scarecrowStore) {
    g.__scarecrowStore = {
      kv: new Map(),
      lists: new Map(),
      sets: new Map(),
    };
  }
  return g.__scarecrowStore;
}

function alive(exp: number | null): boolean {
  return exp === null || exp > Date.now();
}

function redisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, automaticDeserialization: false });
}

export function storeKind(): StoreKind {
  return process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
    ? "redis"
    : "memory";
}

export type KvStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  expire(key: string, ttlSec: number): Promise<void>;
  rpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, end: number): Promise<string[]>;
  ltrim(key: string, start: number, end: number): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
};

function memoryStore(): KvStore {
  const bag = memoryBag();

  function kvGet(key: string): string | null {
    const row = bag.kv.get(key);
    if (!row) return null;
    if (!alive(row.exp)) {
      bag.kv.delete(key);
      return null;
    }
    return row.value;
  }

  function listGet(key: string): ListEntry | null {
    const row = bag.lists.get(key);
    if (!row) return null;
    if (!alive(row.exp)) {
      bag.lists.delete(key);
      return null;
    }
    return row;
  }

  function setGet(key: string): SetEntry | null {
    const row = bag.sets.get(key);
    if (!row) return null;
    if (!alive(row.exp)) {
      bag.sets.delete(key);
      return null;
    }
    return row;
  }

  return {
    async get(key) {
      return kvGet(key);
    },
    async set(key, value, ttlSec) {
      bag.kv.set(key, {
        value,
        exp: Date.now() + ttlSec * 1000,
      });
    },
    async del(key) {
      bag.kv.delete(key);
      bag.lists.delete(key);
      bag.sets.delete(key);
    },
    async expire(key, ttlSec) {
      const exp = Date.now() + ttlSec * 1000;
      const kv = bag.kv.get(key);
      if (kv) kv.exp = exp;
      const list = bag.lists.get(key);
      if (list) list.exp = exp;
      const set = bag.sets.get(key);
      if (set) set.exp = exp;
    },
    async rpush(key, value) {
      const row = listGet(key) ?? { values: [], exp: null };
      row.values.push(value);
      bag.lists.set(key, row);
    },
    async lrange(key, start, end) {
      const row = listGet(key);
      if (!row) return [];
      const len = row.values.length;
      const from = start < 0 ? Math.max(0, len + start) : start;
      const to = end < 0 ? len + end + 1 : end + 1;
      return row.values.slice(from, to);
    },
    async ltrim(key, start, end) {
      const row = listGet(key);
      if (!row) return;
      const len = row.values.length;
      const from = start < 0 ? Math.max(0, len + start) : start;
      const to = end < 0 ? len + end + 1 : end + 1;
      row.values = row.values.slice(from, to);
    },
    async sadd(key, member) {
      const row = setGet(key) ?? { values: new Set(), exp: null };
      row.values.add(member);
      bag.sets.set(key, row);
    },
    async smembers(key) {
      const row = setGet(key);
      return row ? [...row.values] : [];
    },
  };
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function redisStore(redis: Redis): KvStore {
  return {
    async get(key) {
      return asString(await redis.get(key));
    },
    async set(key, value, ttlSec) {
      await redis.set(key, value, { ex: ttlSec });
    },
    async del(key) {
      await redis.del(key);
    },
    async expire(key, ttlSec) {
      await redis.expire(key, ttlSec);
    },
    async rpush(key, value) {
      await redis.rpush(key, value);
    },
    async lrange(key, start, end) {
      const list = (await redis.lrange(key, start, end)) as unknown[];
      return (list || []).map((item) => asString(item) ?? "");
    },
    async ltrim(key, start, end) {
      await redis.ltrim(key, start, end);
    },
    async sadd(key, member) {
      await redis.sadd(key, member);
    },
    async smembers(key) {
      const list = (await redis.smembers(key)) as unknown[];
      return (list || []).map((item) => asString(item) ?? "");
    },
  };
}

let cached: KvStore | null = null;
let cachedKind: StoreKind | null = null;

export function getStore(): KvStore {
  const kind = storeKind();
  if (cached && cachedKind === kind) return cached;
  const redis = redisClient();
  cached = redis ? redisStore(redis) : memoryStore();
  cachedKind = kind;
  return cached;
}
