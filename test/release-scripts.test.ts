import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const installScript = fileURLToPath(new URL("../scripts/install-release.ps1", import.meta.url));
const uninstallScript = fileURLToPath(new URL("../scripts/uninstall-release.ps1", import.meta.url));
const tempPaths: string[] = [];

async function tempDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempPaths.push(path);
  return path;
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeBundleFile(root: string, name: string, content: string | Buffer): Promise<void> {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function createValidationBundle(): Promise<string> {
  const root = await tempDirectory("message-nav-release-");
  await copyFile(installScript, join(root, "install.ps1"));
  await copyFile(uninstallScript, join(root, "uninstall.ps1"));
  await writeBundleFile(root, "omp.exe", "fake-omp");
  await writeBundleFile(root, "README.txt", "readme");
  await writeBundleFile(root, "LICENSES/oh-my-pi-LICENSE.txt", "license");
  await writeBundleFile(root, "extension/message-nav-rail.mjs", "export default function () {}\n");
  await writeBundleFile(root, "extension/package.json", JSON.stringify({
    name: "message-nav-rail",
    type: "module",
    main: "./message-nav-rail.mjs",
  }));
  await writeBundleFile(root, "manifest.json", JSON.stringify({
    schemaVersion: 1,
    bundleVersion: "17.0.1-custom.1",
    upstreamVersion: "17.0.1",
    platform: "windows",
    architecture: "x64",
  }));
  return root;
}

async function writeChecksums(root: string, mutate?: (lines: string[]) => Promise<void> | void): Promise<void> {
  const names = [
    "LICENSES/oh-my-pi-LICENSE.txt",
    "README.txt",
    "extension/message-nav-rail.mjs",
    "extension/package.json",
    "install.ps1",
    "manifest.json",
    "omp.exe",
    "uninstall.ps1",
  ];
  const lines: string[] = [];
  for (const name of names) {
    const content = await readFile(join(root, name));
    lines.push(`${sha256(content)}  ${name}`);
  }
  await mutate?.(lines);
  await writeFile(join(root, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "ascii");
}

function runPowerShell(
  script: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  executable = "pwsh",
) {
  const childEnv = { ...process.env, ...env };
  if (basename(executable).toLowerCase() === "powershell.exe") {
    for (const key of Object.keys(childEnv)) {
      if (key.toLowerCase() === "psmodulepath") delete childEnv[key];
    }
  }
  return spawnSync(
    executable,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    {
      encoding: "utf8",
      env: childEnv,
    },
  );
}

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("发布安装脚本", { skip: process.platform !== "win32" }, () => {
  it("仅校验模式接受完整且一致的发布包", async () => {
    const root = await createValidationBundle();
    await writeChecksums(root);

    const result = runPowerShell(join(root, "install.ps1"), ["-ValidateOnly"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it("仅校验模式兼容 Windows PowerShell 5.1", async (t) => {
    const windowsPowerShell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    if (!existsSync(windowsPowerShell)) {
      t.skip("Windows PowerShell 5.1 不可用");
      return;
    }
    const root = await createValidationBundle();
    await writeChecksums(root);

    const result = runPowerShell(
      join(root, "install.ps1"),
      ["-ValidateOnly"],
      undefined,
      windowsPowerShell,
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it("拒绝校验清单遗漏包内文件", async () => {
    const root = await createValidationBundle();
    await writeChecksums(root, (lines) => {
      const ompLine = lines.findIndex((line) => line.endsWith("  omp.exe"));
      lines.splice(ompLine, 1);
    });

    const result = runPowerShell(join(root, "install.ps1"), ["-ValidateOnly"]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /missing checksum entry.*omp\.exe/i);
  });

  it("拒绝不受支持的 manifest schema", async () => {
    const root = await createValidationBundle();
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.schemaVersion = 2;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeChecksums(root);

    const result = runPowerShell(join(root, "install.ps1"), ["-ValidateOnly"]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /unsupported manifest schemaVersion/i);
  });

  it("拒绝重复和目录越界的校验条目", async () => {
    const duplicateRoot = await createValidationBundle();
    await writeChecksums(duplicateRoot, (lines) => {
      lines.push(lines[0]);
    });
    const duplicate = runPowerShell(join(duplicateRoot, "install.ps1"), ["-ValidateOnly"]);
    assert.notEqual(duplicate.status, 0);
    assert.match(`${duplicate.stderr}\n${duplicate.stdout}`, /duplicate checksum entry/i);

    const traversalRoot = await createValidationBundle();
    const outside = `${traversalRoot}-outside`;
    tempPaths.push(outside);
    await mkdir(outside);
    const outsideFile = join(outside, "payload.bin");
    await writeFile(outsideFile, "outside");
    await writeChecksums(traversalRoot, (lines) => {
      const relativeOutside = relative(traversalRoot, outsideFile).replaceAll("\\", "/");
      lines.push(`${sha256("outside")}  ${relativeOutside}`);
    });
    const traversal = runPowerShell(join(traversalRoot, "install.ps1"), ["-ValidateOnly"]);
    assert.notEqual(traversal.status, 0);
    assert.match(`${traversal.stderr}\n${traversal.stdout}`, /unsafe checksum path/i);
  });

  it("覆盖升级回滚后恢复上一版 installation.json", async () => {
    const root = await tempDirectory("message-nav-uninstall-");
    const profile = join(root, "profile");
    const installRoot = join(root, "install");
    const backupDir = join(installRoot, "backups", "latest");
    const targetOmp = join(root, "bin", "omp.exe");
    const extensionRoot = join(installRoot, "extension");
    const statePath = join(installRoot, "installation.json");
    await mkdir(backupDir, { recursive: true });
    await mkdir(dirname(targetOmp), { recursive: true });
    await mkdir(extensionRoot, { recursive: true });
    await mkdir(profile, { recursive: true });
    await copyFile(process.execPath, targetOmp);
    await copyFile(process.execPath, join(backupDir, "omp.exe"));

    const previousState = {
      schemaVersion: 1,
      bundleVersion: "17.0.1-custom.1",
      backupDir: join(installRoot, "backups", "previous"),
      marker: "previous-installation",
    };
    await writeFile(join(backupDir, "installation.json"), JSON.stringify(previousState));
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1,
      bundleVersion: "17.0.1-custom.2",
      targetOmp,
      extensionRoot,
      backupDir,
    }));

    const result = runPowerShell(uninstallScript, [
      "-InstallRoot",
      installRoot,
      "-RestorePrevious",
    ], { USERPROFILE: profile });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const restoredState = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(restoredState.marker, "previous-installation");
  });
});
