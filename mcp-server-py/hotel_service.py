import json
import os
import re
import secrets
import tempfile
import threading
import uuid
from datetime import date, datetime, timezone
from math import floor
from pathlib import Path
from typing import Any


TAX_NOTICE = (
    "Taxes are estimates from sample data and may differ from the final "
    "amount charged by a hotel."
)
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class HotelReservationService:
    def __init__(
        self,
        catalog_path: Path | None = None,
        reservations_path: Path | None = None,
    ) -> None:
        project_directory = Path(__file__).resolve().parent
        self.catalog_path = catalog_path or project_directory.parent / "data.json"
        self.reservations_path = reservations_path or Path(
            os.environ.get(
                "HOTEL_RESERVATIONS_FILE",
                str(project_directory / "reservations.json"),
            )
        )
        self.hotels = self._load_catalog()
        self._reservation_lock = threading.Lock()
        self.reservations = self._load_reservations()

    def get_catalog(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "hotels": [self._hotel_summary(hotel) for hotel in self.hotels],
            "rooms": [
                {"hotel": self._hotel_summary(hotel), "room": room}
                for hotel in self.hotels
                for room in hotel["rooms"]
            ],
        }

    def get_room(self, room_id: str) -> dict[str, Any]:
        hotel, room = self._find_room(room_id)
        return {"hotel": self._hotel_summary(hotel), "room": room}

    def search_rooms(
        self,
        check_in: str,
        check_out: str,
        city: str | None = None,
        guests: int = 1,
        required_facilities: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        self._validate_upcoming_stay(check_in, check_out)
        self._validate_guest_count(guests, 20)
        normalized_city = city.strip().casefold() if city else ""
        facilities = {
            facility.strip().casefold() for facility in required_facilities or []
        }
        results = []

        for hotel in self.hotels:
            if normalized_city and normalized_city not in hotel["location"]["city"].casefold():
                continue
            for room in hotel["rooms"]:
                if room["maxGuests"] < guests:
                    continue
                available = {
                    facility.casefold()
                    for facility in hotel["facilities"] + room["facilities"]
                }
                if not facilities.issubset(available):
                    continue
                availability = self._availability(room, check_in, check_out)
                if availability["availableRooms"] > 0:
                    results.append(
                        {
                            "hotel": self._hotel_summary(hotel),
                            "room": room,
                            "availableRooms": availability["availableRooms"],
                        }
                    )
        return results

    def calculate_quote(
        self, room_id: str, check_in: str, check_out: str, guests: int
    ) -> dict[str, Any]:
        night_count = self._validate_stay_dates(check_in, check_out)
        hotel, room = self._find_room(room_id)
        self._validate_guest_count(guests, room["maxGuests"])
        subtotal = self._round_currency(room["pricePerNight"] * night_count)
        estimated_tax = self._round_currency(subtotal * hotel["taxRate"])
        availability = self._availability(room, check_in, check_out)

        return {
            "roomId": room_id,
            "hotelName": hotel["name"],
            "roomName": room["name"],
            "checkIn": check_in,
            "checkOut": check_out,
            "nightCount": night_count,
            "guests": guests,
            "nightlyRate": room["pricePerNight"],
            "subtotal": subtotal,
            "estimatedTaxRate": hotel["taxRate"],
            "estimatedTax": estimated_tax,
            "total": self._round_currency(subtotal + estimated_tax),
            "currency": hotel["currency"],
            "availableRooms": availability["availableRooms"],
            "taxNotice": TAX_NOTICE,
        }

    def book_room(
        self,
        room_id: str,
        check_in: str,
        check_out: str,
        guests: int,
        guest_name: str,
        guest_email: str,
    ) -> dict[str, Any]:
        self._validate_upcoming_stay(check_in, check_out)
        hotel, room = self._find_room(room_id)
        self._validate_guest_count(guests, room["maxGuests"])
        normalized_name = guest_name.strip()
        if not normalized_name:
            raise ValueError("Guest name must not be empty.")
        if not EMAIL_PATTERN.fullmatch(guest_email):
            raise ValueError("A valid guest email address is required.")

        with self._reservation_lock:
            if self._availability(room, check_in, check_out)["availableRooms"] < 1:
                raise ValueError(
                    "No rooms of this type are available for the requested dates."
                )

            quote = self.calculate_quote(room_id, check_in, check_out, guests)
            reservation = {
                "id": str(uuid.uuid4()),
                "confirmationCode": secrets.token_hex(3).upper(),
                "roomId": room["id"],
                "hotelName": hotel["name"],
                "roomName": room["name"],
                "guestName": normalized_name,
                "guestEmail": guest_email,
                "checkIn": check_in,
                "checkOut": check_out,
                "guests": guests,
                "nightCount": quote["nightCount"],
                "nightlyRate": quote["nightlyRate"],
                "subtotal": quote["subtotal"],
                "estimatedTax": quote["estimatedTax"],
                "total": quote["total"],
                "currency": quote["currency"],
                "createdAt": datetime.now(timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
                "status": "confirmed",
            }
            self.reservations.append(reservation)
            try:
                self._persist_reservations()
            except Exception:
                self.reservations.pop()
                raise
            return reservation

    def _load_catalog(self) -> list[dict[str, Any]]:
        with self.catalog_path.open(encoding="utf-8") as catalog_file:
            catalog = json.load(catalog_file)
        hotels = catalog.get("hotels") if isinstance(catalog, dict) else None
        if not isinstance(hotels, list) or not hotels:
            raise ValueError("Hotel catalog must contain a non-empty hotels list.")
        room_ids = [
            room["id"]
            for hotel in hotels
            for room in hotel.get("rooms", [])
            if isinstance(room, dict) and isinstance(room.get("id"), str)
        ]
        if len(room_ids) != len(set(room_ids)):
            raise ValueError("Hotel catalog contains duplicate room IDs.")
        return hotels

    def _load_reservations(self) -> list[dict[str, Any]]:
        try:
            with self.reservations_path.open(encoding="utf-8") as reservation_file:
                reservations = json.load(reservation_file)
        except FileNotFoundError:
            self.reservations_path.parent.mkdir(parents=True, exist_ok=True)
            self.reservations_path.write_text("[]\n", encoding="utf-8")
            return []
        if not isinstance(reservations, list) or any(
            not isinstance(reservation, dict) for reservation in reservations
        ):
            raise ValueError("Reservations file must contain a JSON array of objects.")
        return reservations

    def _persist_reservations(self) -> None:
        self.reservations_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.reservations_path.parent,
                prefix=".reservations-",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = temporary_file.name
                json.dump(self.reservations, temporary_file, indent=2)
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self.reservations_path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)

    def _find_room(self, room_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        for hotel in self.hotels:
            for room in hotel["rooms"]:
                if room["id"] == room_id:
                    return hotel, room
        raise ValueError(f'Room "{room_id}" was not found.')

    @staticmethod
    def _hotel_summary(hotel: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in hotel.items() if key != "rooms"}

    @staticmethod
    def _validate_date(value: str) -> date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError(
                "Check-in and check-out must be valid dates in YYYY-MM-DD format."
            )
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise ValueError(
                "Check-in and check-out must be valid dates in YYYY-MM-DD format."
            ) from error
        if parsed.isoformat() != value:
            raise ValueError(
                "Check-in and check-out must be valid dates in YYYY-MM-DD format."
            )
        return parsed

    def _validate_stay_dates(self, check_in: str, check_out: str) -> int:
        arrival = self._validate_date(check_in)
        departure = self._validate_date(check_out)
        night_count = (departure - arrival).days
        if night_count < 1:
            raise ValueError("Check-out must be at least one night after check-in.")
        return night_count

    def _validate_upcoming_stay(self, check_in: str, check_out: str) -> int:
        night_count = self._validate_stay_dates(check_in, check_out)
        if self._validate_date(check_in) < datetime.now(timezone.utc).date():
            raise ValueError("Check-in must be today or a future date.")
        return night_count

    @staticmethod
    def _validate_guest_count(guests: int, maximum: int) -> None:
        if isinstance(guests, bool) or not isinstance(guests, int) or not 1 <= guests <= maximum:
            raise ValueError(f"This room accommodates between 1 and {maximum} guests.")

    def _availability(
        self, room: dict[str, Any], check_in: str, check_out: str
    ) -> dict[str, int]:
        events: list[tuple[str, int]] = []
        for reservation in self.reservations:
            if (
                reservation.get("roomId") == room["id"]
                and reservation.get("status") == "confirmed"
                and reservation.get("checkIn", "") < check_out
                and check_in < reservation.get("checkOut", "")
            ):
                events.append((max(check_in, reservation["checkIn"]), 1))
                events.append((min(check_out, reservation["checkOut"]), -1))

        occupied = 0
        peak_occupancy = 0
        for _, change in sorted(events):
            occupied += change
            peak_occupancy = max(peak_occupancy, occupied)

        return {
            "totalRooms": room["inventory"],
            "bookedRooms": peak_occupancy,
            "availableRooms": max(0, room["inventory"] - peak_occupancy),
        }

    @staticmethod
    def _round_currency(amount: float) -> float:
        return floor((amount + 1e-10) * 100 + 0.5) / 100
