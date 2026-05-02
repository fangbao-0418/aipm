#!/usr/bin/env node

import { createCli } from "./index.js";

async function main() {
  const program = createCli();
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[aipm] ${message}`);
  process.exitCode = 1;
});
