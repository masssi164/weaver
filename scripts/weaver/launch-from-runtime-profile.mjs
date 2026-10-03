#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const protocolVersion = "weaver.profile-projection/v2";
const contractVersion = "weave.runtime-profile/v2";
const maxProfileBytes = 1024 * 1024;
const maxProjectionBytes = 2 * 1024 * 1024;
const projectorTimeoutMs = 30_000;
const credentialKeys = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "password",
  "refreshtoken",
  "token",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, field) {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireOnlyKeys(record, keys, field) {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${field} contains unknown key ${JSON.stringify(key)}`);
    }
  }
}

function isSecretRef(value) {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).toSorted();
  if (
    keys.length !== 3 ||
    keys.join(",") !== "id,provider,source" ||
    typeof value.provider !== "string" ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(value.provider) ||
    typeof value.id !== "string"
  ) {
    return false;
  }
  if (value.source === "env") {
    return /^[A-Z][A-Z0-9_]{0,127}$/.test(value.id);
  }
  if (value.source === "file") {
    return value.id === "value" || (value.id.startsWith("/") && /^(?:[^~]|~[01])*$/.test(value.id));
  }
  return (
    value.source === "exec" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/.test(value.id) &&
    !value.id.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function rejectLiteralCredentials(value, path = "openclawConfig") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectLiteralCredentials(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (credentialKeys.has(key.toLowerCase()) && child !== undefined && !isSecretRef(child)) {
      throw new Error(`${childPath} must be an OpenClaw SecretRef, not a literal credential`);
    }
    rejectLiteralCredentials(child, childPath);
  }
}

function requireHttpsUrl(value, field) {
  const raw = requireString(value, field);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${field} must be an HTTPS URL without user info, query, or fragment`);
  }
}

export function validateProjectedConfig(value, workspacePath) {
  const config = requireRecord(value, "openclawConfig");
  const agents = requireRecord(config.agents, "openclawConfig.agents");
  const defaults = requireRecord(agents.defaults, "openclawConfig.agents.defaults");
  if (defaults.workspace !== workspacePath) {
    throw new Error("openclawConfig.agents.defaults.workspace must equal the ephemeral workspace");
  }

  const channels = requireRecord(config.channels, "openclawConfig.channels");
  requireOnlyKeys(channels, ["matrix"], "openclawConfig.channels");
  const matrix = requireRecord(channels.matrix, "openclawConfig.channels.matrix");
  if (matrix.enabled !== true || matrix.encryption !== true) {
    throw new Error("the official Matrix channel must be enabled with encryption required");
  }
  requireHttpsUrl(matrix.homeserver, "openclawConfig.channels.matrix.homeserver");
  if (!isSecretRef(matrix.accessToken)) {
    throw new Error("openclawConfig.channels.matrix.accessToken must be an OpenClaw SecretRef");
  }
  if (matrix.password !== undefined) {
    throw new Error("Matrix password authentication is not allowed in a Weaver cell");
  }
  if (matrix.accounts !== undefined) {
    throw new Error("named or additional Matrix accounts are not allowed in a Weaver cell");
  }

  if (config.mcp !== undefined) {
    throw new Error(
      "MCP projection is disabled until upstream supports the client-credentials extension",
    );
  }

  rejectLiteralCredentials(config);
  return config;
}

export function validateProjectionEnvelope(
  value,
  profileBytes,
  workspacePath,
  expectedCellRef,
  expectedWorkloadClientId,
) {
  const envelope = requireRecord(value, "projector output");
  requireOnlyKeys(
    envelope,
    [
      "protocolVersion",
      "contractVersion",
      "profileId",
      "cellRef",
      "workloadClientId",
      "profileSha256",
      "signatureVerified",
      "disabledCapabilities",
      "openclawConfig",
    ],
    "projector output",
  );
  if (envelope.protocolVersion !== protocolVersion) {
    throw new Error(`projector output must use ${protocolVersion}`);
  }
  if (envelope.contractVersion !== contractVersion) {
    throw new Error(`projector output must use ${contractVersion}`);
  }
  if (!/^rp_[A-Za-z0-9_-]+$/.test(envelope.profileId ?? "")) {
    throw new Error("projector output must identify one RuntimeProfile v2 profileId");
  }
  if (envelope.cellRef !== expectedCellRef) {
    throw new Error("projector output cellRef does not match the orchestrator binding");
  }
  if (envelope.workloadClientId !== expectedWorkloadClientId) {
    throw new Error("projector output workloadClientId does not match the orchestrator binding");
  }
  if (
    !Array.isArray(envelope.disabledCapabilities) ||
    envelope.disabledCapabilities.length !== 1 ||
    envelope.disabledCapabilities[0] !== "mcp"
  ) {
    throw new Error(
      "projector output must keep MCP disabled until client-credentials is supported",
    );
  }
  if (envelope.signatureVerified !== true) {
    throw new Error("projector did not assert successful RuntimeProfile signature verification");
  }
  const expectedHash = `sha256:${createHash("sha256").update(profileBytes).digest("hex")}`;
  if (envelope.profileSha256 !== expectedHash) {
    throw new Error("projector output does not match the exact RuntimeProfile bytes");
  }
  return validateProjectedConfig(envelope.openclawConfig, workspacePath);
}

function parseArguments(argv) {
  const options = { check: false, launchArgs: [] };
  const valueFlags = new Set([
    "--profile",
    "--projector",
    "--ephemeral-root",
    "--config",
    "--state-dir",
    "--workspace",
    "--cell-ref",
    "--workload-client-id",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.launchArgs = argv.slice(index + 1);
      break;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (!valueFlags.has(arg)) {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return options;
}

function assertRegularFile(path, field, executable = false) {
  if (!isAbsolute(path)) {
    throw new Error(`${field} must be an absolute path`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${field} must be a regular, non-symlink file`);
  }
  if (executable) {
    accessSync(path, constants.X_OK);
  }
}

function assertDirectory(path, field) {
  if (!isAbsolute(path)) {
    throw new Error(`${field} must be an absolute path`);
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${field} must be a non-symlink directory`);
  }
}

function assertInsideRoot(path, root, field) {
  if (!isAbsolute(path)) {
    throw new Error(`${field} must be an absolute path`);
  }
  const relation = relative(resolve(root), resolve(path));
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`${field} must be a child of the ephemeral root`);
  }
}

function writeGeneratedConfig(configPath, ephemeralRoot, config) {
  if (existsSync(configPath)) {
    throw new Error("generated config path already exists; refusing overwrite or stale reuse");
  }
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  assertInsideRoot(realpathSync(dirname(configPath)), realpathSync(ephemeralRoot), "config parent");
  const descriptor = openSync(
    configPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function runProjector(
  projector,
  profilePath,
  stateDir,
  workspacePath,
  cellRef,
  workloadClientId,
  profileBytes,
) {
  const result = spawnSync(
    projector,
    [
      "--profile",
      profilePath,
      "--state-dir",
      stateDir,
      "--workspace",
      workspacePath,
      "--cell-ref",
      cellRef,
      "--workload-client-id",
      workloadClientId,
    ],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: maxProjectionBytes,
      stdio: ["ignore", "pipe", "inherit"],
      timeout: projectorTimeoutMs,
    },
  );
  if (result.error) {
    throw new Error(`RuntimeProfile projector failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`RuntimeProfile projector exited with status ${result.status ?? "unknown"}`);
  }
  if (Buffer.byteLength(result.stdout ?? "", "utf8") > maxProjectionBytes) {
    throw new Error("RuntimeProfile projector output exceeds the size limit");
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error("RuntimeProfile projector did not emit one valid JSON object");
  }
  return validateProjectionEnvelope(
    envelope,
    profileBytes,
    workspacePath,
    cellRef,
    workloadClientId,
  );
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    for (const field of [
      "profile",
      "projector",
      "ephemeral_root",
      "config",
      "state_dir",
      "workspace",
      "cell_ref",
      "workload_client_id",
    ]) {
      requireString(options[field], `--${field.replaceAll("_", "-")}`);
    }
    if (options.check && options.launchArgs.length > 0) {
      throw new Error("--check cannot be combined with a launch command");
    }
    if (
      !options.check &&
      (options.launchArgs.length !== 1 || options.launchArgs[0] !== "gateway")
    ) {
      throw new Error("managed Weaver cells may launch only the fixed upstream gateway command");
    }

    assertRegularFile(options.profile, "--profile");
    assertRegularFile(options.projector, "--projector", true);
    assertDirectory(options.ephemeral_root, "--ephemeral-root");
    assertDirectory(options.state_dir, "--state-dir");
    assertDirectory(options.workspace, "--workspace");
    assertInsideRoot(options.config, options.ephemeral_root, "--config");
    assertInsideRoot(options.state_dir, options.ephemeral_root, "--state-dir");
    assertInsideRoot(options.workspace, options.ephemeral_root, "--workspace");
    assertInsideRoot(
      realpathSync(options.state_dir),
      realpathSync(options.ephemeral_root),
      "resolved --state-dir",
    );
    assertInsideRoot(
      realpathSync(options.workspace),
      realpathSync(options.ephemeral_root),
      "resolved --workspace",
    );

    const profileBytes = readFileSync(options.profile);
    if (profileBytes.length === 0 || profileBytes.length > maxProfileBytes) {
      throw new Error("RuntimeProfile must be non-empty and no larger than 1 MiB");
    }
    const config = runProjector(
      options.projector,
      options.profile,
      options.state_dir,
      options.workspace,
      options.cell_ref,
      options.workload_client_id,
      profileBytes,
    );
    writeGeneratedConfig(options.config, options.ephemeral_root, config);
    console.log("weaver-runtime-profile: RuntimeProfile verified and projected");

    if (options.check) {
      console.log("weaver-runtime-profile: config projection check passed; runtime not started");
      return;
    }
    const child = spawn(
      process.execPath,
      [resolve(repoRoot, "openclaw.mjs"), ...options.launchArgs],
      {
        env: {
          ...process.env,
          OPENCLAW_CONFIG_PATH: options.config,
          OPENCLAW_STATE_DIR: options.state_dir,
        },
        stdio: "inherit",
      },
    );
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    process.on("SIGINT", forwardSigint);
    process.on("SIGTERM", forwardSigterm);
    const result = await new Promise((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveResult({ code, signal }));
    });
    process.off("SIGINT", forwardSigint);
    process.off("SIGTERM", forwardSigterm);
    if (result.signal) {
      console.error(`weaver-runtime-profile: OpenClaw stopped by ${result.signal}`);
    }
    process.exitCode = result.code ?? 1;
  } catch (error) {
    console.error(`weaver-runtime-profile: failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
