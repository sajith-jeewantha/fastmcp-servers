# Hotel Reservations MCP Server (Python)

A hotel discovery and reservation server built with Python and FastMCP. It uses the shared repository-root catalog of 10 fictional hotels and 20 room offers.

## Requirements

- Python 3.11 or newer
- pip

## Install

From this directory, create and activate a virtual environment, then install the dependencies:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows, activate the environment with `.venv\Scripts\activate`.

## Run

Start the HTTP MCP server:

```sh
python server.py
```

The server listens at `http://127.0.0.1:3001/mcp`. Override the port with `MCP_PORT`, the bind address with `MCP_HOST`, or the reservation file location with `HOTEL_RESERVATIONS_FILE`.

In another terminal, run the read-only example client:

```sh
python client.py
```

Set `MCP_URL` to connect the example client to a different server URL.

## MCP capabilities

### Tools

- `search_hotels` filters available room offers by city, dates, guest capacity, and required facilities.
- `calculate_stay_price` returns the nightly rate, night count, subtotal, estimated tax, total, and availability.
- `book_room` checks date-specific inventory and saves a confirmed reservation with a confirmation code.

All stay dates use `YYYY-MM-DD`; check-out is exclusive, and check-in for search and booking must be today or later. Booking is for one room. Sample rates and tax values are estimates, not live hotel rates, tax advice, or payment processing.

### Resources and prompt

- `hotels://catalog` provides the hotel and room catalog.
- `hotel://room/{roomId}` provides details for one room offer.
- `plan_hotel_stay` guides an assistant through availability search, estimate comparison, and guest confirmation before booking.

Reservation guest details are not exposed through resources. Bookings are stored in `reservations.json` in this project directory (or at the path set by `HOTEL_RESERVATIONS_FILE`). Edit `../data.json` in the repository root to change the shared catalog.

## Tests

Run the isolated MCP integration tests with:

```sh
python -m unittest discover -s tests -v
```

The tests use a temporary reservation file and do not modify local booking data.
