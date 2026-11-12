import { z } from 'zod';
import { toolDefinitions } from '../mcp/tools.mjs';
console.log(JSON.stringify(toolDefinitions.map(({ name, description, schema, outputSchema, annotations }) => ({ name, description, inputSchema: z.toJSONSchema(schema), outputSchema: z.toJSONSchema(outputSchema), annotations })), null, 2));
