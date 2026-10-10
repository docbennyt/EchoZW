import { cleanupEligibleStaticTimetableRawSources } from "./staticTimetableRawCleanup.js";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;

const result = await cleanupEligibleStaticTimetableRawSources({ limit });
console.log(JSON.stringify(result));
