import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: process.env.PORT ? Number(process.env.PORT) : 4100,
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "dev_jwt_secret_change_me",
};

if (!env.databaseUrl) {
  // In dev we allow this to be empty, but log loudly to avoid confusion.
  // The app will crash on first DB use if this isn't set.
  // eslint-disable-next-line no-console
  console.warn("[env] DATABASE_URL is not set. Configure it in a .env file.");
}
