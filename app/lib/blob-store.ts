// Server-only persistence layer for the tracker state, backed by Vercel Blob.
// The whole app state lives in ONE public JSON file at a fixed path.
// Must never be imported from a Client Component (uses the write token).

import { put, head, BlobNotFoundError } from "@vercel/blob";
import {
  defaultState,
  mergeServerState,
  normalizeState,
  type TrackerState,
} from "./tracker";

const BLOB_PATH = "tracker-state.json";

function hasToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Read the freshest state. Blob is CDN-cached, so we resolve the URL via head()
// and fetch it with `no-store`. Missing file or missing token → default state.
export async function readState(): Promise<TrackerState> {
  if (!hasToken()) return defaultState();
  try {
    const meta = await head(BLOB_PATH);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return defaultState();
    return normalizeState(await res.json());
  } catch (error) {
    if (error instanceof BlobNotFoundError) return defaultState();
    // Any other Blob/network failure: degrade gracefully, never crash the app.
    console.error("[blob-store] readState failed:", error);
    return defaultState();
  }
}

async function writeState(state: TrackerState): Promise<void> {
  if (!hasToken()) return;
  try {
    await put(BLOB_PATH, JSON.stringify(state), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
  } catch (error) {
    console.error("[blob-store] writeState failed:", error);
  }
}

// Merge an incoming patch into the stored state and persist the result.
export async function commitState(patch: TrackerState): Promise<TrackerState> {
  const current = await readState();
  const merged = mergeServerState(current, normalizeState(patch));
  await writeState(merged);
  return merged;
}
