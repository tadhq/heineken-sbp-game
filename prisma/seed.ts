import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { DEFAULT_CONFIG } from "../src/lib/config";
import { hashPin } from "../src/server/pin-hash";

/**
 * Idempotent: creates config v1 and the admin PIN hash only when missing.
 * The PIN comes from ADMIN_PIN and is stored hashed; there is no default.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  console.log(`Seeding database on host ${new URL(url).host}`);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  if (!(await db.configVersion.findFirst())) {
    await db.configVersion.create({ data: { version: 1, data: DEFAULT_CONFIG, note: "Initial defaults" } });
    console.log("Created config version 1");
  }

  if (!(await db.setting.findUnique({ where: { key: "adminPin" } }))) {
    const pin = process.env.ADMIN_PIN;
    if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error("ADMIN_PIN (4-8 digits) is required to create the admin PIN");
    await db.setting.create({ data: { key: "adminPin", value: { hash: hashPin(pin), version: 1 } } });
    console.log("Created admin PIN hash");
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
