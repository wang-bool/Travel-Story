import { getTravelService } from '@/lib/server/travelService';
import { assertLocalRequest, errorResponse } from '@/lib/server/localAccess';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{await assertLocalRequest(req);return Response.json(await getTravelService().snapshot(),{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
export async function PUT(){return Response.json({error:{code:'LEGACY_WRITE_DISABLED',message:'Reload Travel Story; whole-database writes are disabled in V2'}},{status:410});}
