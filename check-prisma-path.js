const fs = require("fs");
const path = require("path");

console.log("Checking Prisma schema path resolution...");
console.log("Current working directory:", process.cwd());
console.log("Environment:", process.env.NODE_ENV || "development");
console.log("Platform:", process.platform);

// Check if running in Docker
const isDocker = fs.existsSync("/.dockerenv");
console.log("Running in Docker:", isDocker);

// Try different potential schema paths
const possiblePaths = [
  path.resolve(process.cwd(), "./prisma/schema.prisma"),
  path.resolve(process.cwd(), "./src/shared/database/prisma/schema.prisma"),
  path.resolve(process.cwd(), "./dist/shared/database/prisma/schema.prisma"),
  path.resolve(__dirname, "./prisma/schema.prisma"),
  path.resolve(__dirname, "./src/shared/database/prisma/schema.prisma"),
  "/app/src/shared/database/prisma/schema.prisma",
  "/app/dist/shared/database/prisma/schema.prisma",
];

console.log("\nChecking potential schema paths:");
possiblePaths.forEach((p) => {
  try {
    const exists = fs.existsSync(p);
    console.log(`- ${p}: ${exists ? "EXISTS" : "NOT FOUND"}`);
  } catch (err) {
    console.log(`- ${p}: ERROR (${err.message})`);
  }
});

// Check package.json prisma config
try {
  const packageJson = require("./package.json");
  console.log("\nPackage.json prisma config:", packageJson.prisma);
} catch (err) {
  console.log("\nFailed to read package.json:", err.message);
}

// Check for environment variables
console.log("\nEnvironment variables:");
console.log("PRISMA_SCHEMA_PATH:", process.env.PRISMA_SCHEMA_PATH || "not set");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "set" : "not set");

console.log("\nTry to load schema directly:");
try {
  const schemaPath = path.resolve(
    process.cwd(),
    "./src/shared/database/prisma/schema.prisma"
  );
  const schema = fs.readFileSync(schemaPath, "utf8");
  console.log(`Successfully read schema (${schema.length} bytes)`);
  console.log("First few lines:", schema.split("\n").slice(0, 3).join("\n"));
} catch (err) {
  console.log("Failed to read schema:", err.message);
}
