import argparse
import json
import os

from fastmcp import FastMCP

from hotel_service import HotelReservationService


def create_server(service: HotelReservationService | None = None) -> FastMCP:
    reservation_service = service or HotelReservationService()
    mcp = FastMCP(name="hotel-reservations", version="1.0.0")

    @mcp.tool
    def search_hotels(
        checkIn: str,
        checkOut: str,
        city: str | None = None,
        guests: int = 1,
        requiredFacilities: list[str] | None = None,
    ) -> dict[str, object]:
        """Find available hotel rooms by city, dates, capacity, and facilities."""
        results = reservation_service.search_rooms(
            checkIn, checkOut, city, guests, requiredFacilities or []
        )
        return {
            "search": {
                "city": city,
                "checkIn": checkIn,
                "checkOut": checkOut,
                "guests": guests,
                "requiredFacilities": requiredFacilities or [],
            },
            "resultCount": len(results),
            "results": results,
        }

    @mcp.tool
    def calculate_stay_price(
        roomId: str, checkIn: str, checkOut: str, guests: int = 1
    ) -> dict[str, object]:
        """Calculate an itemized sample price estimate for a hotel stay."""
        return reservation_service.calculate_quote(roomId, checkIn, checkOut, guests)

    @mcp.tool
    def book_room(
        roomId: str,
        checkIn: str,
        checkOut: str,
        guests: int,
        guestName: str,
        guestEmail: str,
    ) -> dict[str, object]:
        """Book one room after checking date-specific inventory."""
        return reservation_service.book_room(
            roomId, checkIn, checkOut, guests, guestName, guestEmail
        )

    @mcp.resource(
        "hotels://catalog",
        name="Hotel and room catalog",
        description="The sample hotel catalog and all available room offers.",
        mime_type="application/json",
    )
    def hotel_catalog() -> str:
        return json.dumps(reservation_service.get_catalog(), indent=2)

    @mcp.resource(
        "hotel://room/{roomId}",
        name="Hotel room details",
        description="Detailed hotel and room information for one room offer.",
        mime_type="application/json",
    )
    def room_details(roomId: str) -> str:
        return json.dumps(reservation_service.get_room(roomId), indent=2)

    @mcp.prompt
    def plan_hotel_stay(
        city: str,
        checkIn: str,
        checkOut: str,
        guests: str,
        preferences: str = "",
    ) -> str:
        """Plan a stay by searching, comparing prices, and confirming before booking."""
        preference_text = f" Preferences: {preferences}." if preferences else ""
        return (
            f"Help plan a hotel stay in {city} from {checkIn} through {checkOut} "
            f"for {guests} guest(s).{preference_text} Use search_hotels to find "
            "available rooms, then calculate_stay_price for comparable estimates. "
            "Explain that taxes are estimates and present the total and nightly "
            "rate. Ask the guest to choose an option and provide their name and "
            "email before calling book_room. Never claim a reservation is confirmed "
            "until book_room succeeds."
        )

    return mcp


mcp = create_server()


def parse_server_options() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the hotel reservations MCP server.")
    default_transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if default_transport not in ("stdio", "http"):
        parser.error('MCP_TRANSPORT must be either "stdio" or "http".')
    parser.add_argument(
        "--transport",
        choices=("stdio", "http"),
        default=default_transport,
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("MCP_PORT", "3001")),
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_server_options()
    if arguments.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        host = os.environ.get("MCP_HOST", "127.0.0.1")
        mcp.run(transport="http", host=host, port=arguments.port, path="/mcp")
