import { seedRbac } from "../modules/rbac/seed";
import { scriptDb } from "./db.mts";

const { db, close } = scriptDb();
try {
  await seedRbac(db);
  console.log("RBAC permissions and system roles are in sync.");
} finally {
  await close();
}
