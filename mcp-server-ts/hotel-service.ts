import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const locationSchema = z.object({
  city: z.string().min(1),
  country: z.string().min(1),
  address: z.string().min(1),
})

const roomSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  bedType: z.string().min(1),
  maxGuests: z.number().int().positive(),
  pricePerNight: z.number().positive(),
  inventory: z.number().int().positive(),
  facilities: z.array(z.string().min(1)),
})

const hotelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: locationSchema,
  description: z.string().min(1),
  rating: z.number().min(0).max(5),
  currency: z.string().length(3),
  taxRate: z.number().min(0).max(1),
  facilities: z.array(z.string().min(1)),
  rooms: z.array(roomSchema).min(1),
})

const catalogSchema = z.object({ hotels: z.array(hotelSchema).min(1) })

const reservationSchema = z.object({
  id: z.string().uuid(),
  confirmationCode: z.string().min(1),
  roomId: z.string().min(1),
  hotelName: z.string().min(1),
  roomName: z.string().min(1),
  guestName: z.string().min(1),
  guestEmail: z.email(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number().int().positive(),
  nightCount: z.number().int().positive(),
  nightlyRate: z.number().positive(),
  subtotal: z.number().nonnegative(),
  estimatedTax: z.number().nonnegative(),
  total: z.number().positive(),
  currency: z.string().length(3),
  createdAt: z.string().datetime(),
  status: z.enum(['confirmed', 'cancelled']),
})

const reservationsSchema = z.array(reservationSchema)

export type StayDates = {
  checkIn: string
  checkOut: string
}

export type RoomSearch = StayDates & {
  city?: string
  guests: number
  requiredFacilities: string[]
}

export type ReservationRequest = StayDates & {
  roomId: string
  guests: number
  guestName: string
  guestEmail: string
}

export type Hotel = z.infer<typeof hotelSchema>
export type Room = z.infer<typeof roomSchema>
export type Reservation = z.infer<typeof reservationSchema>

export type RoomListing = {
  hotel: Omit<Hotel, 'rooms'>
  room: Room
}

export type SearchRoomListing = RoomListing & { availableRooms: number }

export type StayQuote = {
  roomId: string
  hotelName: string
  roomName: string
  checkIn: string
  checkOut: string
  nightCount: number
  guests: number
  nightlyRate: number
  subtotal: number
  estimatedTaxRate: number
  estimatedTax: number
  total: number
  currency: string
  availableRooms: number
  taxNotice: string
}

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const catalogPath = join(projectDirectory, '..', 'data.json')

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validateStayDates({ checkIn, checkOut }: StayDates): number {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) {
    throw new Error('Check-in and check-out must be valid dates in YYYY-MM-DD format.')
  }

  const nights = (Date.parse(`${checkOut}T00:00:00.000Z`) - Date.parse(`${checkIn}T00:00:00.000Z`)) / 86_400_000
  if (nights < 1) throw new Error('Check-out must be at least one night after check-in.')
  return nights
}

function validateUpcomingStay(dates: StayDates): number {
  const nights = validateStayDates(dates)
  if (dates.checkIn < new Date().toISOString().slice(0, 10)) {
    throw new Error('Check-in must be today or a future date.')
  }
  return nights
}

function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export class HotelReservationService {
  private readonly hotels: Hotel[]
  private reservations: Reservation[]
  private reservationQueue: Promise<void> = Promise.resolve()
  private readonly reservationsPath: string

  private constructor(hotels: Hotel[], reservations: Reservation[], reservationsPath: string) {
    this.hotels = hotels
    this.reservations = reservations
    this.reservationsPath = reservationsPath
  }

  static async create(reservationsPath = process.env.HOTEL_RESERVATIONS_FILE ?? join(projectDirectory, 'reservations.json')): Promise<HotelReservationService> {
    const catalogData: unknown = JSON.parse(await readFile(catalogPath, 'utf8'))
    const { hotels } = catalogSchema.parse(catalogData)
    const roomIds = hotels.flatMap((hotel) => hotel.rooms.map((room) => room.id))
    if (new Set(roomIds).size !== roomIds.length) {
      throw new Error('Hotel catalog contains duplicate room IDs.')
    }

    let reservations: Reservation[]
    try {
      reservations = reservationsSchema.parse(JSON.parse(await readFile(reservationsPath, 'utf8')))
    } catch (error) {
      if (!isMissingFile(error)) throw error
      reservations = []
      await writeFile(reservationsPath, `${JSON.stringify(reservations, null, 2)}\n`, 'utf8')
    }

    return new HotelReservationService(hotels, reservations, reservationsPath)
  }

  listHotels(): Omit<Hotel, 'rooms'>[] {
    return this.hotels.map(({ rooms: _rooms, ...hotel }) => hotel)
  }

  listRooms(): RoomListing[] {
    return this.hotels.flatMap((hotel) =>
      hotel.rooms.map((room) => ({
        hotel: this.hotelSummary(hotel),
        room,
      })),
    )
  }

  getRoom(roomId: string): RoomListing {
    const { hotel, room } = this.findRoom(roomId)
    return {
      hotel: this.hotelSummary(hotel),
      room,
    }
  }

  searchRooms(criteria: RoomSearch): SearchRoomListing[] {
    validateUpcomingStay(criteria)

    const normalizedCity = criteria.city?.trim().toLocaleLowerCase()
    const requiredFacilities = criteria.requiredFacilities.map((facility) => facility.trim().toLocaleLowerCase())

    return this.hotels.flatMap((hotel) => {
      if (normalizedCity && !hotel.location.city.toLocaleLowerCase().includes(normalizedCity)) return []

      return hotel.rooms.flatMap((room) => {
        if (room.maxGuests < criteria.guests) return []
        const allFacilities = [...hotel.facilities, ...room.facilities].map((facility) => facility.toLocaleLowerCase())
        if (!requiredFacilities.every((facility) => allFacilities.includes(facility))) return []

        const availableRooms = this.getAvailability(room, criteria).availableRooms
        return availableRooms > 0
          ? [{ hotel: this.hotelSummary(hotel), room, availableRooms }]
          : []
      })
    })
  }

  calculateQuote(roomId: string, dates: StayDates, guests: number): StayQuote {
    const nightCount = validateStayDates(dates)
    const { hotel, room } = this.findRoom(roomId)
    this.validateGuestCount(room, guests)

    const subtotal = roundCurrency(room.pricePerNight * nightCount)
    const estimatedTax = roundCurrency(subtotal * hotel.taxRate)

    return {
      roomId,
      hotelName: hotel.name,
      roomName: room.name,
      ...dates,
      nightCount,
      guests,
      nightlyRate: room.pricePerNight,
      subtotal,
      estimatedTaxRate: hotel.taxRate,
      estimatedTax,
      total: roundCurrency(subtotal + estimatedTax),
      currency: hotel.currency,
      availableRooms: this.getAvailability(room, dates).availableRooms,
      taxNotice: 'Taxes are estimates from sample data and may differ from the final amount charged by a hotel.',
    }
  }

  async bookRoom(request: ReservationRequest): Promise<Reservation> {
    validateUpcomingStay(request)
    const { hotel, room } = this.findRoom(request.roomId)
    this.validateGuestCount(room, request.guests)

    return this.withReservationLock(async () => {
      if (this.getAvailability(room, request).availableRooms < 1) {
        throw new Error('No rooms of this type are available for the requested dates.')
      }

      const quote = this.calculateQuote(request.roomId, request, request.guests)
      const reservation = reservationSchema.parse({
        id: randomUUID(),
        confirmationCode: randomBytes(3).toString('hex').toUpperCase(),
        roomId: room.id,
        hotelName: hotel.name,
        roomName: room.name,
        guestName: request.guestName.trim(),
        guestEmail: request.guestEmail,
        checkIn: request.checkIn,
        checkOut: request.checkOut,
        guests: request.guests,
        nightCount: quote.nightCount,
        nightlyRate: quote.nightlyRate,
        subtotal: quote.subtotal,
        estimatedTax: quote.estimatedTax,
        total: quote.total,
        currency: quote.currency,
        createdAt: new Date().toISOString(),
        status: 'confirmed',
      })

      this.reservations.push(reservation)
      try {
        await this.persistReservations()
      } catch (error) {
        this.reservations.pop()
        throw error
      }
      return reservation
    })
  }

  private hotelSummary(hotel: Hotel): Omit<Hotel, 'rooms'> {
    const { rooms: _rooms, ...summary } = hotel
    return summary
  }

  private findRoom(roomId: string): { hotel: Hotel; room: Room } {
    for (const hotel of this.hotels) {
      const room = hotel.rooms.find((candidate) => candidate.id === roomId)
      if (room) return { hotel, room }
    }
    throw new Error(`Room "${roomId}" was not found.`)
  }

  private validateGuestCount(room: Room, guests: number): void {
    if (!Number.isInteger(guests) || guests < 1 || guests > room.maxGuests) {
      throw new Error(`This room accommodates between 1 and ${room.maxGuests} guests.`)
    }
  }

  private getAvailability(room: Room, dates: StayDates): { totalRooms: number; bookedRooms: number; availableRooms: number } {
    const overlaps = this.reservations.filter(
      (reservation) =>
        reservation.roomId === room.id &&
        reservation.status === 'confirmed' &&
        reservation.checkIn < dates.checkOut &&
        dates.checkIn < reservation.checkOut,
    )

    const events = overlaps
      .flatMap((reservation) => [
        { date: reservation.checkIn < dates.checkIn ? dates.checkIn : reservation.checkIn, change: 1 },
        { date: reservation.checkOut > dates.checkOut ? dates.checkOut : reservation.checkOut, change: -1 },
      ])
      .sort((left, right) => left.date.localeCompare(right.date) || left.change - right.change)

    let occupiedRooms = 0
    let peakOccupancy = 0
    for (const event of events) {
      occupiedRooms += event.change
      peakOccupancy = Math.max(peakOccupancy, occupiedRooms)
    }

    return {
      totalRooms: room.inventory,
      bookedRooms: peakOccupancy,
      availableRooms: Math.max(0, room.inventory - peakOccupancy),
    }
  }

  private async withReservationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.reservationQueue
    let release = (): void => {}
    this.reservationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async persistReservations(): Promise<void> {
    const temporaryPath = join(dirname(this.reservationsPath), `.reservations-${randomUUID()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(this.reservations, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.reservationsPath)
  }
}
