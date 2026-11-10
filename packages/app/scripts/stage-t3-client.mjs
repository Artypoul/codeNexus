import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(appRoot, "dist", "t3-client");
const expectedTreeHash = "5469645ebb80d18cd023dc38a8deb5905b44c98bfeeec3ead90bb4b9d038cf39";
const expectedLicenseHash = "935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43";
const defaultLicense = "D:/Development/CodeNexus/build-cache/t3-contract/LICENSE-T3-0.1.7";
const defaultDonorDist = "D:/GitHub/t3code-donor/apps/web/dist";
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function listFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`T3 client contains a non-regular file: ${path}`);
  }
  return files;
}

export async function stageT3Client(source = process.env.T3_CODE_CLIENT_DIR) {
  source ??= existsSync(defaultDonorDist) ? defaultDonorDist : undefined;
  if (!source) {
    await rm(destination, { recursive: true, force: true });
    return false;
  }
  const root = resolve(source);
  const files = await listFiles(root);
  const name = (path) => relative(root, path).replaceAll("\\", "/");
  files.sort((a, b) => name(a).localeCompare(name(b), "en"));
  const manifest =
    (await Promise.all(files.map(async (path) => `${hash(await readFile(path))}  ${name(path)}`))).join("\n") + "\n";
  const isVerifiedRelease = files.length === 1178 && hash(manifest) === expectedTreeHash;
  const isLocalT3Donor = root.replaceAll("\\", "/").endsWith("/t3code-donor/apps/web/dist");
  if (!isVerifiedRelease && !isLocalT3Donor) {
    throw new Error("T3 client does not match the verified release or the local t3code-donor build");
  }
  if (isLocalT3Donor) {
    const donorPackage = JSON.parse(await readFile(join(root, "..", "package.json"), "utf8"));
    if (donorPackage.version !== "0.1.7") throw new Error("Local T3 donor must be version 0.1.7");
  }
  const license = await readFile(process.env.T3_CODE_LICENSE_FILE || defaultLicense);
  if (!isLocalT3Donor && hash(license) !== expectedLicenseHash) {
    throw new Error("T3 v0.1.7 license hash does not match");
  }
  const index = await readFile(join(root, "index.html"), "utf8");
  const moduleTagMatch = index.match(/<script type="module" crossorigin\s+src="[^"]+"><\/script>/);
  if (!moduleTagMatch) throw new Error("Expected T3 entry module not found");
  const moduleTag = moduleTagMatch[0];
  const publicConfigFile = (await readdir(join(root, "assets"))).find((name) => /^publicConfig-.*\.js$/.test(name));
  if (!publicConfigFile) throw new Error("Expected T3 public config module not found");
  const cloudConfigPath = join("assets", publicConfigFile);
  const cloudConfig = await readFile(join(root, cloudConfigPath), "utf8");
  const publicConfig = /function _\(\)\{return\{clerkPublishableKey:.*?\}\}\}function v\(\)/;
  if (!publicConfig.test(cloudConfig)) throw new Error("Expected T3 public config module not found");

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(root, destination, { recursive: true, dereference: false });
  await writeFile(join(destination, "LICENSE-T3"), license);
  await writeFile(
    join(destination, cloudConfigPath),
    cloudConfig.replace(
      publicConfig,
      "function _(){return{clerkPublishableKey:null,clerkJwtTemplate:null,relayUrl:null,relayTracing:{tracesUrl:null,tracesDataset:null,tracesToken:null}}}function v()"
    )
  );
  await writeFile(
    join(destination, "index.html"),
    index.replace(moduleTag, `<script src="/codenexus-adapter.js"></script>\n    ${moduleTag}`)
  );
  return true;
}
