import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const workflowUrl = new URL("../.github/workflows/build-windows-x64.yml", import.meta.url);

function runBlocks(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)run:\s*\|\s*$/.exec(lines[i]);
    if (!match) continue;
    const indent = match[1].length;
    const body: string[] = [];
    for (i += 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length > 0 && line.length - line.trimStart().length <= indent) {
        i -= 1;
        break;
      }
      body.push(line);
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

describe("Windows 发布工作流", () => {
  it("锁定 17.0.8 稳定基线和对应发布补丁", async () => {
    const yaml = await readFile(workflowUrl, "utf8");
    assert.match(yaml, /default: "17\.0\.8-custom\.1"/);
    assert.match(
      yaml,
      /default: "5e362714fe3cdbecb16bc177067af20ba18d8c83"/
    );
    assert.match(
      yaml,
      /patches\/oh-my-pi\/17\.0\.8-release-windows-x64\.patch/
    );
  });

  it("不把 workflow_dispatch 输入直接插值进 PowerShell run 块", async () => {
    const yaml = await readFile(workflowUrl, "utf8");
    for (const block of runBlocks(yaml)) {
      assert.doesNotMatch(block, /\$\{\{\s*inputs\./);
    }
  });
});
