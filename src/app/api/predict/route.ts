import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getAuthState } from "@/lib/auth";
import { getPrediction } from "@/lib/repository";
import { predictionQuerySchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const auth = await getAuthState();

    if (!auth.configured) {
      return NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 });
    }

    if (!auth.user) {
      return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    }

    const searchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
    const query = predictionQuerySchema.parse(searchParams);
    const prediction = await getPrediction(auth.user.id, query.mineCount, query.predictionCount);

    return NextResponse.json(prediction);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid prediction request.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to generate predictions.",
      },
      { status: 500 },
    );
  }
}
