import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { notFound } from "../utils/errors.js";
export const bookingInclude = {
  wasteTypes: true,
  payment: true,
} satisfies Prisma.BookingInclude;
export const owned = {
  async address(
    userId: string,
    id: string,
    client: Prisma.TransactionClient = db,
  ) {
    const address = await client.userAddress.findFirst({
      where: { id, userId },
    });
    if (!address) throw notFound();
    return address;
  },
  async booking(
    userId: string,
    id: string,
    client: Prisma.TransactionClient = db,
  ) {
    const booking = await client.booking.findFirst({
      where: { id, userId },
      include: bookingInclude,
    });
    if (!booking) throw notFound();
    return booking;
  },
  async payment(
    userId: string,
    id: string,
    client: Prisma.TransactionClient = db,
  ) {
    const payment = await client.payment.findFirst({
      where: { id, booking: { userId } },
      include: { booking: true },
    });
    if (!payment) throw notFound();
    return payment;
  },
};
