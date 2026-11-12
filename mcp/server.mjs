import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolDefinitions } from './tools.mjs';
export function createMcpServer(call) {
    const server = new McpServer({ name: 'travel-story', version: '0.3.0' });
    for (const tool of toolDefinitions) {
        server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema, outputSchema: tool.outputSchema, annotations: tool.annotations }, async (input) => {
            try {
                const result = await call(tool.name, input);
                return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
            }
            catch (error) {
                const result = { error: { code: error.code ?? 'SERVICE_UNAVAILABLE', message: error.message ?? 'Local service failed' } };
                return { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
        });
    }
    return server;
}
