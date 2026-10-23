import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import ts from "typescript";

const parsed = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync("wrangler.jsonc", "utf8"),
);
if (parsed.error) throw new Error("TRUSTED_CONFIG_INVALID");
for (const path of [
  "candidate",
  "candidate/bundle",
  "candidate/bundle/index.js",
  "candidate/dist",
]) {
  if (lstatSync(path).isSymbolicLink())
    throw new Error("CANDIDATE_SYMLINK_REJECTED");
}
const config = parsed.config;
delete config.$schema;
delete config.build;
config.main = "./candidate/bundle/index.js";
config.assets.directory = "./candidate/dist";
config.no_bundle = true;
writeFileSync("staging-deploy.json", JSON.stringify(config));
