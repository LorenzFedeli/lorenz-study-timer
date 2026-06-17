// Server-only persistence layer for the tracker state, backed by Upstash Redis.
import { Redis } from "@upstash/redis";
import { defaultState, mergeServerState, normalizeState, type TrackerState } from "./tracker";

const REDIS_KEY = process.env.TRACKER_REDIS_KEY ?? "time-tracker:state:v1";

let memoryState = defaultState();
let redisClient: Redis | null = null;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || value === "\"\"") return undefined;
  return value;
}

function redisConfig(): { url: string; token: string } | null {
  const url = envValue("UPSTASH_REDIS_REST_URL") ?? envValue("KV_REST_API_URL");
  const token = envValue("UPSTASH_REDIS_REST_TOKEN") ?? envValue("KV_REST_API_TOKEN");

  if (!url || !token) return null;
  return { url, token };
}

function getRedis(): Redis | null {
  const config = redisConfig();
  if (!config) return null;

  redisClient ??= new Redis(config);
  return redisClient;
}

export function persistenceMode(): "redis" | "memory" {
  return redisConfig() ? "redis" : "memory";
}

export async function readState(): Promise<TrackerState> {
  const redis = getRedis();
  if (!redis) return normalizeState(memoryState);

  try {
    const stored = await redis.get<unknown>(REDIS_KEY);
    const state = stored === null ? defaultState() : normalizeState(stored);
    memoryState = state;
    return state;
  } catch (error) {
    console.error("[state-store] readState failed:", error);
    return normalizeState(memoryState);
  }
}

async function writeState(state: TrackerState): Promise<void> {
  const normalized = normalizeState(state);
  memoryState = normalized;

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(REDIS_KEY, normalized);
  } catch (error) {
    console.error("[state-store] writeState failed:", error);
  }
}

export async function commitState(patch: TrackerState): Promise<TrackerState> {
  const current = await readState();
  const merged = mergeServerState(current, normalizeState(patch));
  await writeState(merged);
  return merged;
}
