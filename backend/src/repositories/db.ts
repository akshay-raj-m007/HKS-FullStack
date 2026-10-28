import { Prisma, PrismaClient } from "@prisma/client";
export const db = new PrismaClient({
  transactionOptions: { maxWait: 10000, timeout: 10000 },
});
export async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P1008", "P2028"].includes(error.code)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
