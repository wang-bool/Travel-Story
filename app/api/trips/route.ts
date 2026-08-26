// 行程整库：GET 读全库，PUT 整体替换（单用户量级，整库最简可靠）
import { NextRequest } from "next/server";
import { readTripsDB, writeTripsDB } from "@/lib/server/db";
import {
  RequestTooLargeError,
  getLimitBytes,
  readBodyWithinLimit,
} from "@/lib/server/requestSafety";

const MAX_BODY_BYTES = getLimitBytes(process.env.MAX_TRIPS_BODY_MB, 10);

export async function GET() {
  return Response.json(await readTripsDB());
}

export async function PUT(req: NextRequest) {
  try {
    const raw = await readBodyWithinLimit(req, MAX_BODY_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return Response.json({ error: "invalid-json" }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("trips" in body) ||
      !Array.isArray(body.trips)
    ) {
      return Response.json({ error: "invalid-trips" }, { status: 400 });
    }
    await writeTripsDB({ trips: body.trips });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof RequestTooLargeError) {
      return Response.json({ error: "request-too-large" }, { status: 413 });
    }
    console.error("[trips] 写入失败", e);
    return Response.json({ error: "write-failed" }, { status: 500 });
  }
}
