import type { NextRequest } from "next/server";
import { commitState, persistenceMode, readState } from "@/app/lib/blob-store";
import { normalizeState } from "@/app/lib/tracker";

// Never cache: this route reads/writes live cross-device state.
export const dynamic = "force-dynamic";

function responseHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "X-Tracker-Storage": persistenceMode(),
  };
}

export async function GET() {
  const state = await readState();
  return Response.json(state, {
    headers: responseHeaders(),
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merged = await commitState(normalizeState(body));
  return Response.json(merged, {
    headers: responseHeaders(),
  });
}
