// 行程整库：GET 读全库，PUT 整体替换（单用户量级，整库最简可靠）
import { NextRequest } from "next/server";
import { readTripsDB, writeTripsDB } from "@/lib/server/db";

export async function GET() {
  return Response.json(await readTripsDB());
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.trips)) {
      return Response.json({ error: "格式不对：需要 { trips: [...] }" }, { status: 400 });
    }
    await writeTripsDB({ trips: body.trips });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
