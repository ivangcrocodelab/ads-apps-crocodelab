import db from "../app/db.server";
import { maintenance } from "../app/services/maintenance.server";
try {
  const result = await maintenance();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
