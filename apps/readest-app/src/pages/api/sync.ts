import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { corsAllMethods, runMiddleware } from '@/utils/cors';

const disabledSyncPayload = {
  error: 'OpenReadest has disabled the original cloud sync service.',
};

export async function GET(_req: NextRequest) {
  return NextResponse.json(disabledSyncPayload, { status: 410 });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(disabledSyncPayload, { status: 410 });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  return res.status(410).json(disabledSyncPayload);
}
