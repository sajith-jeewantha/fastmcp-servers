# Hotel Reservations MCP Server

A sample hotel discovery and reservation server built with TypeScript, FastMCP, and Zod. It serves 20 room offers across 10 fictional hotels. Each property includes a location, rating, facilities, room descriptions, guest capacity, nightly rate, and inventory.

## Requirements

- Node.js 22.18 or newer (for built-in TypeScript support)
- Dependencies installed with `npm install`

## Run

Start the HTTP MCP server:

```sh
npm start
```

The server listens on `http://127.0.0.1:3000/mcp`. Override the port with `MCP_PORT`, the bind address with `MCP_HOST`, or the reservation file location with `HOTEL_RESERVATIONS_FILE`.

In another terminal, run the read-only example client:

```sh
npm run client
```

Set `MCP_URL` to connect the example client to a different server URL.

## MCP capabilities

### Tools

- `search_hotels` filters available room offers by city, dates, guest capacity, and required facilities.
- `calculate_stay_price` returns the nightly rate, number of nights, subtotal, estimated tax, total, and availability.
- `book_room` checks date-specific inventory and saves a confirmed reservation with a confirmation code.

All stay dates use `YYYY-MM-DD`; check-out is exclusive, and search/booking check-in dates must be today or later. Booking is for one room. The sample rates and 12% tax values are illustrative estimates, not live hotel rates, tax advice, or payment processing.

### Resources

- `hotels://catalog` provides the hotel and room catalog.
- `hotel://room/{roomId}` provides details for one room offer.

Reservation guest details are not exposed through resources.

### Prompt

- `plan_hotel_stay` guides an assistant through availability search, estimate comparison, and guest confirmation before booking.

## Data and tests

Edit `data.json` to change the sample properties and room offers. New bookings are stored in `reservations.json` (or the path set by `HOTEL_RESERVATIONS_FILE`).

Run the MCP client integration tests with:

```sh
npm test
```

The tests launch an isolated server on a temporary port and use a temporary reservation file, so they do not alter the local booking data.
