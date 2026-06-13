import { readFileSync } from "node:fs";

type PackageMetadata = {
  version?: string;
};

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageMetadata;

export const packageVersion = packageJson.version ?? "0.0.0";
