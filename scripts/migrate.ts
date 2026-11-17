// Applies migrations explicitly (the app also applies them on first database use).
import { getDb } from "../src/db/client";

await getDb();
console.log("Migrations applied.");
process.exit(0);
