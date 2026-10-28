import { z } from "zod";
import { addressSchema } from "../validators/schemas.js";
import { db, transaction } from "../repositories/db.js";
import { owned } from "../repositories/owned.js";
import { assert } from "../utils/errors.js";
export const addresses = {
  list: (userId: string) =>
    db.userAddress.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
  create: (userId: string, data: z.infer<typeof addressSchema>) =>
    db.userAddress.create({ data: { ...data, userId } }),
  update: (userId: string, id: string, data: z.infer<typeof addressSchema>) =>
    transaction(async (tx) => {
      await owned.address(userId, id, tx);
      await tx.userAddress.updateMany({ where: { id, userId }, data });
      return owned.address(userId, id, tx);
    }),
  remove: (userId: string, id: string) =>
    transaction(async (tx) => {
      await owned.address(userId, id, tx);
      assert(
        (await tx.booking.count({ where: { addressId: id, userId } })) === 0,
        409,
        "ADDRESS_IN_USE",
        "This address is part of an order and cannot be deleted.",
      );
      await tx.userAddress.deleteMany({ where: { id, userId } });
    }),
};
