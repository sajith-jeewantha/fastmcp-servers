import { FastMCP } from '@prefecthq/fastmcp-ts/server'
import { z } from 'zod'
import { HotelReservationService } from './hotel-service.ts'

const service = await HotelReservationService.create()
const server = new FastMCP({
  name: 'hotel-reservations',
  version: '1.0.0',
})

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.')

const searchHotelsInput = z
  .object({
    city: z.string().trim().min(1).optional().describe('Optional city name; matching is case-insensitive.'),
    checkIn: dateSchema.describe('Arrival date, inclusive, in YYYY-MM-DD format.'),
    checkOut: dateSchema.describe('Departure date, exclusive, in YYYY-MM-DD format.'),
    guests: z.number().int().min(1).max(20).default(1).describe('Number of guests staying in one room.'),
    requiredFacilities: z
      .array(z.string().trim().min(1))
      .default([])
      .describe('Every listed facility must be offered by the hotel or room.'),
  })
  .describe('Filters hotel room offers by city, dates, guest capacity, and facilities.')

const quoteInput = z.object({
  roomId: z.string().min(1).describe('Room offer identifier from search_hotels or the hotel catalog.'),
  checkIn: dateSchema.describe('Arrival date, inclusive, in YYYY-MM-DD format.'),
  checkOut: dateSchema.describe('Departure date, exclusive, in YYYY-MM-DD format.'),
  guests: z.number().int().min(1).max(20).default(1).describe('Number of guests staying in the room.'),
})

const bookingInput = quoteInput.extend({
  guestName: z.string().trim().min(1).max(120).describe('Name of the lead guest.'),
  guestEmail: z.email().describe('Email address for the reservation confirmation.'),
})

server.tool(
  {
    name: 'search_hotels',
    description:
      'Find available hotel room offers for a city and future date range. Supports guest-capacity and required-facility filters. Dates use YYYY-MM-DD; check-out is exclusive. Returns hotel details, room facilities, nightly rates, and remaining inventory.',
    input: searchHotelsInput,
  },
  (criteria) => {
    const results = service.searchRooms(criteria)
    return {
      search: criteria,
      resultCount: results.length,
      results,
    }
  },
)

server.tool(
  {
    name: 'calculate_stay_price',
    description:
      'Calculate an itemized stay estimate for a room. Multiplies its listed nightly rate by the number of nights, then applies the sample property tax rate. Returns the tax assumption and current availability; this is an estimate, not a live hotel quote.',
    input: quoteInput,
  },
  ({ roomId, checkIn, checkOut, guests }) => service.calculateQuote(roomId, { checkIn, checkOut }, guests),
)

server.tool(
  {
    name: 'book_room',
    description:
      'Create and persist a confirmed reservation for one room after checking date-specific inventory. Check-in must be today or later. Requires lead guest name and email. Returns a reservation ID and confirmation code; payment is not collected by this demo server.',
    input: bookingInput,
  },
  (request) => service.bookRoom(request),
)

server.resource(
  {
    uri: 'hotels://catalog',
    name: 'Hotel and room catalog',
    description:
      'The sample hotel catalog, including property locations, hotel facilities, room descriptions, capacities, nightly rates, currencies, and inventory.',
    mimeType: 'application/json',
  },
  () => JSON.stringify({ hotels: service.listHotels(), rooms: service.listRooms() }, null, 2),
)

server.resource(
  {
    uri: 'hotel://room/{roomId}',
    name: 'Hotel room details',
    description: 'Detailed hotel and room information for a room offer ID. Does not expose guest reservation records.',
    mimeType: 'application/json',
  },
  ({ roomId }) => JSON.stringify(service.getRoom(roomId ?? ''), null, 2),
)

server.prompt(
  {
    name: 'plan_hotel_stay',
    description:
      'A hotel booking assistant prompt that searches suitable stays, compares complete estimated prices, and asks for confirmation before creating a reservation.',
    arguments: [
      { name: 'city', description: 'Destination city', required: true },
      { name: 'checkIn', description: 'Arrival date (YYYY-MM-DD)', required: true },
      { name: 'checkOut', description: 'Departure date (YYYY-MM-DD)', required: true },
      { name: 'guests', description: 'Number of guests', required: true },
      { name: 'preferences', description: 'Optional budget, facilities, or room preferences', required: false },
    ],
  },
  ({ city, checkIn, checkOut, guests, preferences }) =>
    `Help plan a hotel stay in ${city} from ${checkIn} through ${checkOut} for ${guests} guest(s). ${
      preferences ? `Preferences: ${preferences}. ` : ''
    }Use search_hotels to find available rooms, then calculate_stay_price for comparable all-in estimates. Explain that taxes are estimates and present the total and nightly rate. Ask the guest to choose an option and provide their name and email before calling book_room. Never claim a reservation is confirmed until book_room succeeds.`,
)

const port = Number(process.env.MCP_PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid MCP_PORT "${process.env.MCP_PORT}". Expected an integer from 1 to 65535.`)
}

await server.run({
  transport: 'http',
  host: process.env.MCP_HOST ?? '127.0.0.1',
  port,
  path: '/mcp',
})
