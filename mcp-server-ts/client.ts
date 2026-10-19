import { Client } from '@prefecthq/fastmcp-ts/client'

function dateFromToday(daysAhead: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

await using client = await Client.connect(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp')

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
