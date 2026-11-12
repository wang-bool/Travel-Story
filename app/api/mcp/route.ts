import { assertLocalRequest, bridgeToken, errorResponse } from '@/lib/server/localAccess';
import { getToolDispatcher } from '@/lib/server/toolDispatcher';
import { readBodyWithinLimit } from '@/lib/server/requestSafety';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{await assertLocalRequest(req);await bridgeToken();return Response.json({running:true,transport:'stdio-bridge'});}catch(e){return errorResponse(e);}}
export async function POST(req:Request){try{await assertLocalRequest(req,{mcp:true});const body=JSON.parse((await readBodyWithinLimit(req,262144)).toString('utf8'));return Response.json(await getToolDispatcher()(body.name,body.arguments??{},`http://${req.headers.get('host')}`));}catch(e){return errorResponse(e);}}
