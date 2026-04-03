import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getAuthState } from "@/lib/auth";
import { logRound } from "@/lib/repository";

export async function POST(request: Request) {
  try {
    const auth = await getAuthState();

    if (!auth.configured) {
      return NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 });
    }

    if (!auth.user) {
      return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    }

    const body = await request.json();
    const result = await logRound(auth.user.id, body);

    return NextResponse.json({
      ok: true,
      roundId: result.id,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid round submission.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to save the round.",
      },
      { status: 500 },
    );
  }
}
