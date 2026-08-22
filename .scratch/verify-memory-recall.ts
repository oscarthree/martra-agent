import "dotenv/config";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { SessionMemory } from "../src/mastra/agents/shared";

const storage = new LibSQLStore({
  id: "verify-memory",
  url: "file:.scratch/verify-memory.db",
});

const base = new Memory({ storage });
try {
  await base.recall({ threadId: "missing-thread", resourceId: "resource-1" });
  console.log("base Memory: no throw (unexpected)");
} catch (error) {
  console.log("base Memory throws:", (error as Error).message);
}

const sessionMemory = new SessionMemory({ storage });
const result = await sessionMemory.recall({
  threadId: "missing-thread",
  resourceId: "resource-1",
});
console.log("SessionMemory recall:", JSON.stringify(result));
