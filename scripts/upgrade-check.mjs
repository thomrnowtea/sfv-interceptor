// Verify a real same-folder update using an isolated, persistent Chrome profile.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { projectRoot, releaseFileNames } from "./package-release.mjs";

const artifacts = resolve(
  process.env.SFVI_TEST_ARTIFACTS || ".artifacts/upgrade",
);
mkdirSync(artifacts, { recursive: true });
const checks = [];
const errors = [];
const report = { checks, errors };
let context;

function archive(path) {
  const bytes = readFileSync(path);
  const files = unzipSync(bytes);
  for (const name of Object.keys(files)) {
    assert.ok(
      !name.includes("\\") &&
        !name.includes(":") &&
        name.split("/").every((part) => part && part !== "." && part !== ".."),
      "Unsafe archive path: " + name,
    );
  }
  return {
    files,
    version: JSON.parse(Buffer.from(files["manifest.json"]).toString()).version,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

function install(files, directory, previous = {}) {
  const target = (name) => {
    const path = resolve(directory, name);
    assert.ok(
      path.startsWith(directory + sep),
      "Archive target escaped the isolated extension folder",
    );
    return path;
  };
  for (const name of Object.keys(previous))
    if (!Object.hasOwn(files, name)) unlinkSync(target(name));
  for (const [name, bytes] of Object.entries(files)) {
    const path = target(name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
}

function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  return readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .flatMap((name) =>
      ["chrome-win64", "chrome-win"].map((folder) =>
        join(cache, name, folder, "chrome.exe"),
      ),
    )
    .find(existsSync);
}

async function launch(profile, extension) {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: executable(),
    args: [
      "--disable-extensions-except=" + extension,
      "--load-extension=" + extension,
    ],
  });
  context.on("weberror", (event) => errors.push(event.error().message));
  context.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto("chrome-extension://" + id + "/dashboard/dashboard.html");
  await page.locator("#btn-new").waitFor();
  return { worker, page, id };
}

async function message(page, request) {
  const result = await page.evaluate(
    (request) => chrome.runtime.sendMessage(request),
    request,
  );
  assert.equal(result.error, undefined, JSON.stringify(result));
  return result;
}

async function feed(worker, rule) {
  await worker.evaluate((rule) => {
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) =>
      String(input) === "https://upgrade.sfvi.test/rules"
        ? new Response(JSON.stringify({ rules: [rule] }), {
            headers: {
              "Content-Type": "application/json",
              ETag: '"' + rule.version + '"',
            },
          })
        : nativeFetch(input, options);
  }, rule);
}

async function stored(worker) {
  return worker.evaluate(() =>
    chrome.storage.local.get([
      "sfvi_rules",
      "sfvi_sources",
      "sfvi_theme",
      "sfvi_custom_order",
      "sfvi_sort_key",
      "sfvi_sort_dir",
    ]),
  );
}

try {
  assert.ok(
    process.argv[2],
    "Usage: npm run test:upgrade -- <previous-release.zip>",
  );
  const previous = archive(resolve(process.argv[2]));
  const version = JSON.parse(
    readFileSync(join(projectRoot, "manifest.json"), "utf8"),
  ).version;
  const candidate = archive(
    join(projectRoot, "dist", "sfv-interceptor-v" + version + ".zip"),
  );
  assert.notEqual(
    previous.version,
    candidate.version,
    "Upgrade requires different release versions",
  );
  assert.equal(candidate.version, version);
  assert.deepEqual(Object.keys(candidate.files).sort(), releaseFileNames());
  const directory = mkdtempSync(join(artifacts, "run-"));
  const extension = join(directory, "extension");
  const profile = join(directory, "profile");
  install(previous.files, extension);
  const before = await launch(profile, extension);
  assert.equal(
    await before.worker.evaluate(() => chrome.runtime.getManifest().version),
    previous.version,
  );
  const local = {
    id: "upgrade-local",
    name: "Local upgrade fixture",
    version: "3.2.1",
    enabled: true,
    resourceType: "rest",
    pairs: [
      {
        id: "local-pair",
        urlPattern: "/api/local-fixture",
        urlOperator: "Contains",
      },
    ],
    request: { type: "static", body: "", customHeaders: "" },
    response: {
      type: "static",
      body: '{"local":true}',
      statusCode: "200",
      delay: 0,
      customHeaders: "",
    },
  };
  await message(before.page, { type: "SAVE_RULE", rule: local });
  await message(before.page, {
    type: "SAVE_RULE",
    rule: { ...local, id: "upgrade-disabled", enabled: false },
  });
  const remote = {
    ...local,
    name: "Remote upgrade fixture",
    version: "2.0.0",
    response: { ...local.response, body: '{"remote":true}' },
  };
  await feed(before.worker, remote);
  const { source } = await message(before.page, {
    type: "ADD_SOURCE",
    source: {
      name: "Upgrade fixture",
      url: "https://upgrade.sfvi.test/rules",
      intervalMinutes: 1440,
    },
  });
  assert.equal(source.lastError, "");
  const originalRules = (await message(before.page, { type: "GET_RULES" }))
    .rules;
  const remoteId = originalRules.find((rule) => rule.readOnly).id;
  await message(before.page, { type: "TOGGLE_RULE", id: remoteId });
  await before.worker.evaluate(() =>
    chrome.storage.local.set({
      sfvi_theme: "light",
      sfvi_custom_order: ["upgrade-disabled", "upgrade-local"],
      sfvi_sort_key: "name",
      sfvi_sort_dir: "desc",
    }),
  );
  const saved = await stored(before.worker);
  assert.equal(saved.sfvi_sources[0].enabledOverrides[remote.id], false);
  checks.push(
    "previous release populated through real worker APIs with local/remote same-ID isolation and activation override",
  );
  await context.close();
  context = null;

  install(candidate.files, extension, previous.files);
  const after = await launch(profile, extension);
  assert.equal(
    after.id,
    before.id,
    "Updating the same folder must retain extension identity",
  );
  assert.equal(
    await after.worker.evaluate(() => chrome.runtime.getManifest().version),
    candidate.version,
  );
  assert.deepEqual(
    await stored(after.worker),
    saved,
    "Update must preserve rules, source snapshots, overrides and settings",
  );
  checks.push(
    "same folder/profile retains extension identity, local rules, disabled state, source URL/interval/ETag, activation override, theme and ordering",
  );
  await after.page.waitForFunction(
    async (id) =>
      (await chrome.alarms.get("sfvi_source:" + id))?.periodInMinutes === 1440,
    source.id,
  );
  await after.page.waitForFunction(
    () => document.documentElement.dataset.scheme === "light",
  );
  checks.push(
    "subscription alarm restored and stored theme applied after restart",
  );
  const effective = (await message(after.page, { type: "GET_RULES" })).rules;
  assert.equal(effective.length, 3);
  assert.equal(effective.find((rule) => rule.id === remoteId).enabled, false);
  const rejected = await after.page.evaluate(
    (rule) => chrome.runtime.sendMessage({ type: "SAVE_RULE", rule }),
    effective.find((rule) => rule.id === remoteId),
  );
  assert.match(rejected.error, /read.only/i);
  await message(after.page, { type: "TOGGLE_RULE", id: remoteId });
  const nextRemote = {
    ...remote,
    version: "2.1.0",
    response: { ...remote.response, body: '{"remote":"updated"}' },
  };
  await feed(after.worker, nextRemote);
  const synced = await message(after.page, {
    type: "SYNC_SOURCE",
    id: source.id,
  });
  assert.equal(synced.source.lastError, "");
  const updated = (await message(after.page, { type: "GET_RULES" })).rules;
  assert.equal(updated.find((rule) => rule.id === remoteId).enabled, true);
  assert.equal(updated.find((rule) => rule.id === remoteId).version, "2.1.0");
  assert.equal(
    updated.find((rule) => rule.id === remoteId).response.body,
    nextRemote.response.body,
  );
  assert.deepEqual((await stored(after.worker)).sfvi_rules, saved.sfvi_rules);
  const exported = await message(after.page, { type: "EXPORT_RULES" });
  assert.equal(exported.rules.length, 3);
  assert.ok(
    exported.rules.every(
      (rule) =>
        !Object.hasOwn(rule, "readOnly") && !Object.hasOwn(rule, "sourceId"),
    ),
  );
  checks.push(
    "remote content remains read-only, toggling/syncing works, local rules remain unchanged and exports are portable",
  );
  assert.deepEqual(errors, []);
  Object.assign(report, {
    previousVersion: previous.version,
    version: candidate.version,
    previousChecksum: previous.checksum,
    checksum: candidate.checksum,
    extensionId: after.id,
    extensionRoot: extension,
    profile,
    passed: true,
  });
  console.log(
    "Upgrade smoke passed: " +
      previous.version +
      " -> " +
      candidate.version +
      "; stored rules, sources and preferences preserved.",
  );
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  try {
    await context?.close();
  } finally {
    writeFileSync(
      join(artifacts, "results.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
