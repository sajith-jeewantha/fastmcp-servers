import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastmcp import Client

from hotel_service import HotelReservationService
from server import create_server


CHECK_IN = "2099-05-01"
CHECK_OUT = "2099-05-04"
ROOM_ID = "casa-sol-double"


class HotelServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        reservation_path = Path(self.temporary_directory.name) / "reservations.json"
        self.service = HotelReservationService(reservations_path=reservation_path)
        self.server = create_server(self.service)
        self.client = await self.enterAsyncContext(Client(self.server))

    async def asyncTearDown(self) -> None:
        self.temporary_directory.cleanup()

    @staticmethod
    def _tool_json(result: object) -> dict[str, object]:
        content = getattr(result, "content")
        text = next(item.text for item in content if hasattr(item, "text"))
        return json.loads(text)

    async def test_publishes_search_price_and_booking_tools(self) -> None:
        tools = await self.client.list_tools()
        self.assertEqual(
            {tool.name for tool in tools},
            {"search_hotels", "calculate_stay_price", "book_room"},
        )

    async def test_searches_by_city_dates_capacity_and_facilities(self) -> None:
        result = self._tool_json(
            await self.client.call_tool(
                "search_hotels",
                {
                    "city": "lisbon",
                    "checkIn": CHECK_IN,
                    "checkOut": CHECK_OUT,
                    "guests": 2,
                    "requiredFacilities": ["Wi-Fi"],
                },
            )
        )

        self.assertEqual(result["resultCount"], 2)
        rooms = result["results"]
        self.assertTrue(any(item["room"]["id"] == ROOM_ID for item in rooms))
        self.assertTrue(all(item["availableRooms"] > 0 for item in rooms))

    async def test_exposes_catalog_room_details_and_trip_prompt(self) -> None:
        catalog_resource = await self.client.read_resource("hotels://catalog")
        catalog = json.loads(catalog_resource[0].text)
        self.assertEqual(len(catalog["hotels"]), 10)
        self.assertEqual(len(catalog["rooms"]), 20)

        room_resource = await self.client.read_resource(f"hotel://room/{ROOM_ID}")
        room = json.loads(room_resource[0].text)
        self.assertEqual(room["room"]["id"], ROOM_ID)
        self.assertEqual(room["hotel"]["name"], "Casa do Sol")

        prompt = await self.client.get_prompt(
            "plan_hotel_stay",
            {
                "city": "Lisbon",
                "checkIn": CHECK_IN,
                "checkOut": CHECK_OUT,
                "guests": "2",
                "preferences": "quiet room",
            },
        )
        self.assertIn("book_room", prompt.messages[0].content.text)

    async def test_calculates_an_itemized_multi_night_quote(self) -> None:
        quote = self._tool_json(
            await self.client.call_tool(
                "calculate_stay_price",
                {
                    "roomId": ROOM_ID,
                    "checkIn": CHECK_IN,
                    "checkOut": CHECK_OUT,
                    "guests": 2,
                },
            )
        )

        self.assertEqual(quote["nightCount"], 3)
        self.assertEqual(quote["nightlyRate"], 142)
        self.assertEqual(quote["subtotal"], 426)
        self.assertEqual(quote["estimatedTax"], 51.12)
        self.assertEqual(quote["total"], 477.12)
        self.assertEqual(quote["currency"], "USD")

    async def test_rounds_currency_midpoints_up(self) -> None:
        self.assertEqual(self.service._round_currency(2.675), 2.68)

    async def test_books_and_persists_a_reservation(self) -> None:
        reservation = self._tool_json(
            await self.client.call_tool(
                "book_room",
                {
                    "roomId": ROOM_ID,
                    "checkIn": CHECK_IN,
                    "checkOut": CHECK_OUT,
                    "guests": 2,
                    "guestName": " Taylor Guest ",
                    "guestEmail": "taylor@example.com",
                },
            )
        )

        self.assertEqual(reservation["guestName"], "Taylor Guest")
        self.assertEqual(reservation["status"], "confirmed")
        self.assertEqual(reservation["total"], 477.12)
        self.assertEqual(len(reservation["confirmationCode"]), 6)
        persisted = json.loads(self.service.reservations_path.read_text())
        self.assertEqual(persisted[0]["id"], reservation["id"])

    async def test_concurrent_bookings_do_not_oversell_inventory(self) -> None:
        async def book(index: int) -> object:
            return await self.client.call_tool(
                "book_room",
                {
                    "roomId": "casa-sol-terrace",
                    "checkIn": "2099-06-01",
                    "checkOut": "2099-06-03",
                    "guests": 2,
                    "guestName": f"Guest {index}",
                    "guestEmail": f"guest{index}@example.com",
                },
            )

        results = await asyncio.gather(
            *(book(index) for index in range(3)), return_exceptions=True
        )
        self.assertEqual(sum(not isinstance(result, Exception) for result in results), 2)
        self.assertEqual(sum(isinstance(result, Exception) for result in results), 1)

    async def test_rejects_invalid_dates_and_guest_counts(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one night"):
            self.service.calculate_quote(ROOM_ID, CHECK_IN, CHECK_IN, 2)
        with self.assertRaisesRegex(ValueError, "accommodates"):
            self.service.calculate_quote(ROOM_ID, CHECK_IN, CHECK_OUT, 3)
        with self.assertRaisesRegex(ValueError, "valid dates"):
            self.service.calculate_quote(ROOM_ID, "2099-02-30", CHECK_OUT, 2)


if __name__ == "__main__":
    unittest.main()
