import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe("stdio entry point", () => {
  it("starts, initializes, and exposes the supported tools", async () => {
    client = new Client({ name: "stdio-smoke-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js"],
      cwd: process.cwd(),
      stderr: "pipe",
    });

    await client.connect(transport);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_categories",
      "get_post",
      "get_recent_posts",
      "search_posts",
      "compare_offers",
      "get_big_deals",
      "find_bank_bonuses",
    ]);
  });
});
