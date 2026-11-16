const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// Starts as a child of a same-machine agent and forwards its music tools to the running desktop.
async function main() {
    const token = process.env.FOLIA_MCP_TOKEN;
    const port = Number(process.env.FOLIA_MCP_PORT || 38451);
    if (!token || token.length < 32 || !Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('Set FOLIA_MCP_TOKEN and, if changed in Folia, FOLIA_MCP_PORT');
    }
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + port + '/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
    });
    const client = new Client({ name: 'folia-music-stdio', version: '0.1.0' });
    await client.connect(transport);
    const server = new Server({ name: 'folia-music', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, request => client.listTools(request.params));
    server.setRequestHandler(CallToolRequestSchema, (request, extra) => client.callTool(request.params, undefined, {
        signal: extra.signal, timeout: 95_000,
    }));
    server.onclose = () => void client.close();
    await server.connect(new StdioServerTransport());
}

main().catch(() => {
    process.stderr.write('[MusicMcp] Cannot connect. Start Folia with the same MCP token and port.\n');
    process.exitCode = 1;
});
