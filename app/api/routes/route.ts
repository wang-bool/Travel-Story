import { assertLocalRequest, errorResponse } from '@/lib/server/localAccess';
import { getTravelService } from '@/lib/server/travelService';
import { readBodyWithinLimit } from '@/lib/server/requestSafety';
export const runtime='nodejs';
export async function POST(req:Request){try{await assertLocalRequest(req);const input=JSON.parse((await readBodyWithinLimit(req,32768)).toString('utf8'));return Response.json(await getTravelService().execute('calculate_routes',input,'web'));}catch(e){return errorResponse(e);}}
