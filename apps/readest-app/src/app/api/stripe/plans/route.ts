import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'OpenReadest has disabled payment and subscription services.' },
    { status: 410 },
  );
}
