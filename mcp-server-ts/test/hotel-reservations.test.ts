import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { Client } from '@prefecthq/fastmcp-ts/client'

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const roomId = 'casa-sol-double'
const checkIn = '2099-05-01'
const checkOut = '2099-05-04'

let client: Client
let serverProcess: ChildProcessWithoutNullStreams
let serverOutput = ''
let reservationFile: string
let temporaryDirectory: string
let serverUrl: string

async function findAvailablePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })

  const address = probe.address()
  assert.ok(address && typeof address !== 'string')
  const { port } = address
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()))
  })
  return port
}

async function waitForServer(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`MCP server exited during startup.\n${serverOutput}`)
    }

    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for MCP server startup.\n${serverOutput}`)
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((item) => item.type === 'text')?.text
  assert.ok(text, 'Expected a text response from the MCP server.')
  return text
}

function objectContent(result: {
  content: Array<{ type: string; text?: string }>
  structuredContent: unknown
}): Record<string, unknown> {
  const value = result.structuredContent ?? JSON.parse(textContent(result))
  assert.ok(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'hotel-mcp-test-'))
  reservationFile = join(temporaryDirectory, 'reservations.json')

  const port = await findAvailablePort()
  serverUrl = `http://127.0.0.1:${port}/mcp`
  serverProcess = spawn(process.execPath, ['server.ts'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(port),
      HOTEL_RESERVATIONS_FILE: reservationFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString()
  })
  serverProcess.stderr.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString()
  })

  await waitForServer(port)
  client = await Client.connect(serverUrl)
})

after(async () => {
  if (client?.isConnected()) await client.close()
  if (serverProcess?.exitCode === null) {
    const exited = once(serverProcess, 'exit')
    serverProcess.kill('SIGTERM')
    await exited
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

test('publishes hotel search, pricing, and booking tools', async () => {
  const names = (await client.listTools()).map((tool) => tool.name)
  assert.deepEqual(names.sort(), ['book_room', 'calculate_stay_price', 'search_hotels'])
})

test('searches rooms by city, dates, capacity, and facilities', async () => {
  const result = await client.callTool('search_hotels', {
    city: 'lisbon',
    checkIn,
    checkOut,
    guests: 2,
    requiredFacilities: ['Wi-Fi'],
  })

  assert.equal(result.isError, false)
  const search = objectContent(result)
  assert.equal(search.resultCount, 2)
  const rooms = search.results as Array<{ room: { id: string }; availableRooms: number }>
  assert.ok(rooms.some(({ room }) => room.id === roomId))
  assert.ok(rooms.every(({ availableRooms }) => availableRooms > 0))
})

test('provides a catalog resource with 10 hotels and 20 room offers', async () => {
  const catalog = await client.readResource('hotels://catalog')
  const data = JSON.parse(catalog[0].text ?? '{}') as {
    hotels: unknown[]
    rooms: unknown[]
  }
  assert.equal(data.hotels.length, 10)
  assert.equal(data.rooms.length, 20)
})

test('calculates a multi-night itemized price estimate', async () => {
  const result = await client.callTool('calculate_stay_price', {
    roomId,
    checkIn,
    checkOut,
    guests: 2,
  })

  assert.equal(result.isError, false)
  const quote = objectContent(result)
  assert.equal(quote.nightCount, 3)
  assert.equal(quote.nightlyRate, 142)
  assert.equal(quote.subtotal, 426)
  assert.equal(quote.estimatedTax, 51.12)
  assert.equal(quote.total, 477.12)
  assert.equal(quote.currency, 'USD')
})

test('books and persists a reservation', async () => {
  const result = await client.callTool('book_room', {
    roomId,
    checkIn,
    checkOut,
    guests: 2,
    guestName: 'Taylor Guest',
    guestEmail: 'taylor@example.com',
  })

  assert.equal(result.isError, false)
  const reservation = objectContent(result)
  assert.equal(reservation.roomId, roomId)
  assert.equal(reservation.status, 'confirmed')
  assert.equal(reservation.total, 477.12)
  assert.match(reservation.id as string, /^[0-9a-f-]{36}$/)

  const saved = JSON.parse(await readFile(reservationFile, 'utf8')) as Array<{ id: string }>
  assert.ok(saved.some(({ id }) => id === reservation.id))
})

test('prevents concurrent bookings from overselling inventory', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 3 }, (_, index) =>
      client.callTool('book_room', {
        roomId: 'casa-sol-terrace',
        checkIn: '2099-06-01',
        checkOut: '2099-06-03',
        guests: 2,
        guestName: `Concurrent Guest ${index}`,
        guestEmail: `guest${index}@example.com`,
      }),
    ),
  )

  const successes = attempts.filter((result) => result.status === 'fulfilled')
  const failures = attempts.filter((result) => result.status === 'rejected')
  assert.equal(successes.length, 2)
  assert.equal(failures.length, 1)
  assert.match(String(failures[0]?.reason), /No rooms of this type are available/)
})

test('exposes room details as a resource and a booking assistant prompt', async () => {
  const [room, prompt] = await Promise.all([
    client.readResource(`hotel://room/${roomId}`),
    client.getPrompt('plan_hotel_stay', {
      city: 'Lisbon',
      checkIn,
      checkOut,
      guests: '2',
      preferences: 'quiet room',
    }),
  ])

  const roomDocument = JSON.parse(room[0].text ?? '{}') as { room: { id: string }; hotel: { name: string } }
  assert.equal(roomDocument.room.id, roomId)
  assert.equal(roomDocument.hotel.name, 'Casa do Sol')
  assert.match(JSON.stringify(prompt), /book_room/)
})

test('reports invalid stays instead of returning a successful quote', async () => {
  await assert.rejects(
    client.callTool('calculate_stay_price', {
      roomId,
      checkIn: '2099-05-04',
      checkOut: '2099-05-04',
      guests: 2,
    }),
    /at least one night/,
  )
})
