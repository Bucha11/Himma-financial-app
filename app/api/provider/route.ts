import { NextResponse } from "next/server";

export function GET() {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json({
    configured,
    model: configured ? process.env.OPENAI_MODEL || "gpt-4o-mini" : null
  });
}
