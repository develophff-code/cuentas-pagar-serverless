import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // La URL real se inyecta por entorno; este valor sólo permite generar tipos en CI.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/cuentas_pagar_serverless",
  },
});
