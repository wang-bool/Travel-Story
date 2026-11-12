import { assertLocalRequest, errorResponse } from '@/lib/server/localAccess';
import { getTravelService } from '@/lib/server/travelService';
import { check } from '@/lib/domain/itinerary';
import { readBodyWithinLimit, getLimitBytes } from '@/lib/server/requestSafety';
export const runtime='nodejs';
export async function POST(req:Request){try{await assertLocalRequest(req);const body=JSON.parse((await readBodyWithinLimit(req,getLimitBytes(process.env.MAX_TRIPS_BODY_MB,10))).toString('utf8'));check(['create_trip','update_trip','delete_trip','edit_itinerary','import_legacy'].includes(body.action),'INVALID_INPUT','Unsupported web action');return Response.json(await getTravelService().execute(body.action,body.input,'web'));}catch(e){return errorResponse(e);}}
