import { seedRbac } from "../modules/rbac/seed";
import { seedPlans } from "../modules/billing/plans";
import { scriptDb } from "./db.mts";

const { db, close } = scriptDb();
try {
  await seedRbac(db);
  console.log("RBAC permissions and system roles are in sync.");
  await seedPlans(db);
  console.log("Plans present (existing plans are never overwritten).");
} finally {
  await close();
}
