import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      status: "ready",
      commit: process.env.APP_COMMIT_SHA,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
