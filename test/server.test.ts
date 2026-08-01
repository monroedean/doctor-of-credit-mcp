import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

const connections: Array<{ close(): Promise<void> }> = [];

async function connectClient(fetcher: typeof fetch) {
  const server = createServer({ fetch: fetcher });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  connections.push(client, server);

  return client;
}

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

describe("Doctor of Credit MCP server", () => {
  it("initializes and advertises list_categories", async () => {
    const client = await connectClient(() =>
      Promise.reject(new Error("unexpected upstream request")),
    );

    const { tools } = await client.listTools();

    expect(tools).toEqual([
      expect.objectContaining({
        name: "list_categories",
        description: "List the categories available from Doctor of Credit.",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    ]);
  });

  it("lists categories from Doctor of Credit as structured content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 7,
            count: 42,
            description: "Bank account promotions",
            link: "https://www.doctorofcredit.com/category/bank-account-bonuses/",
            name: "Bank Account Bonuses",
            slug: "bank-account-bonuses",
            parent: 0,
          },
          {
            id: 12,
            count: 8,
            description: "Card promotions",
            link: "https://www.doctorofcredit.com/category/credit-card-bonuses/",
            name: "Credit Card Bonuses",
            slug: "credit-card-bonuses",
            parent: 0,
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-wp-totalpages": "1",
          },
        },
      ),
    );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "list_categories",
      arguments: {},
    });
    const expected = {
      categories: [
        {
          id: 7,
          name: "Bank Account Bonuses",
          slug: "bank-account-bonuses",
          url: "https://www.doctorofcredit.com/category/bank-account-bonuses/",
          postCount: 42,
        },
        {
          id: 12,
          name: "Credit Card Bonuses",
          slug: "credit-card-bonuses",
          url: "https://www.doctorofcredit.com/category/credit-card-bonuses/",
          postCount: 8,
        },
      ],
    };

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/categories?per_page=100&page=1",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result).toMatchObject({
      structuredContent: expected,
      content: [{ type: "text", text: JSON.stringify(expected, null, 2) }],
    });
  });

  it("returns an actionable MCP error when Doctor of Credit is unavailable", async () => {
    const client = await connectClient(() =>
      Promise.resolve(new Response("maintenance", { status: 503 })),
    );

    const result = await client.callTool({
      name: "list_categories",
      arguments: {},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit categories: upstream returned HTTP 503. Try again later.",
        },
      ],
    });
  });

  it("does not expose transport details or fabricate categories after a network failure", async () => {
    const client = await connectClient(() =>
      Promise.reject(new Error("connect ECONNRESET 192.0.2.10:443")),
    );

    const result = await client.callTool({
      name: "list_categories",
      arguments: {},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit categories: the upstream service could not be reached. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("retrieves every page of categories reported by Doctor of Credit", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 1,
              count: 5,
              link: "https://www.doctorofcredit.com/category/banking/",
              name: "Banking",
              slug: "banking",
            },
          ]),
          { status: 200, headers: { "x-wp-totalpages": "2" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 2,
              count: 3,
              link: "https://www.doctorofcredit.com/category/cards/",
              name: "Cards",
              slug: "cards",
            },
          ]),
          { status: 200, headers: { "x-wp-totalpages": "2" } },
        ),
      );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "list_categories",
      arguments: {},
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/categories?per_page=100&page=2",
      expect.any(Object),
    );
    expect(result.structuredContent).toMatchObject({
      categories: [{ id: 1 }, { id: 2 }],
    });
  });

  it("returns an actionable MCP error for an invalid upstream response", async () => {
    const client = await connectClient(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: "not-a-number" }]), {
          status: 200,
        }),
      ),
    );

    const result = await client.callTool({
      name: "list_categories",
      arguments: {},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit categories: the upstream response was invalid. Try again later.",
        },
      ],
    });
  });
});
