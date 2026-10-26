import { Client, StdioTransport } from '@prefecthq/fastmcp-ts/client'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = dirname(fileURLToPath(import.meta.url))

function dateFromToday(daysAhead: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

const transport = process.env.MCP_TRANSPORT ?? 'http'
if (transport !== 'stdio' && transport !== 'http') {
  throw new Error(`Invalid MCP_TRANSPORT "${transport}". Expected "stdio" or "http".`)
}

function getEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

const clientTransport =
  transport === 'stdio'
    ? new StdioTransport(process.execPath, ['server.ts'], {
        cwd: projectDirectory,
        env: { ...getEnvironment(), MCP_TRANSPORT: 'stdio' },
      })
    : process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp'

await using client = await Client.connect(clientTransport)

const tools = await client.listTools()
const search = await client.callTool('search_hotels', {
  city: 'Seattle',
  checkIn: dateFromToday(30),
  checkOut: dateFromToday(32),
  guests: 2,
})

console.log({
  tools: tools.map(({ name, description }) => ({ name, description })),
  search,
})
