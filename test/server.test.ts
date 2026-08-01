import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServer } from "../src/server.js";

const connections: Array<{ close(): Promise<void> }> = [];

async function connectClient(fetcher: typeof fetch, now?: () => Date) {
  const server = createServer({
    fetch: fetcher,
    ...(now === undefined ? {} : { now }),
  });
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
      expect.objectContaining({
        name: "get_post",
        description: "Retrieve a Doctor of Credit post by ID or URL.",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    ]);
  });

  it("retrieves a post by ID with cleaned text and explicit provenance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 123,
          link: "https://www.doctorofcredit.com/example-bank-bonus/",
          date_gmt: "2026-07-20T14:30:00",
          modified_gmt: "2026-07-25T09:15:00",
          title: { rendered: "Example Bank $300 Bonus" },
          content: {
            rendered:
              "<style>.promo { display: none }</style><p>Open an account &amp; receive <strong>$300</strong>.</p><script>trackUser()</script><p>Terms apply&hellip; don&rsquo;t assume validity.</p>",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: 123 },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts/123",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toEqual({
      post: {
        source: {
          id: 123,
          url: "https://www.doctorofcredit.com/example-bank-bonus/",
          title: "Example Bank $300 Bonus",
          publishedAt: "2026-07-20T14:30:00Z",
          modifiedAt: "2026-07-25T09:15:00Z",
          articleText:
            "Open an account & receive $300.\n\nTerms apply… don’t assume validity.",
        },
        derived: {
          outdatedWarning: null,
        },
      },
    });
  });

  it("retrieves the same post contract by Doctor of Credit URL", async () => {
    const upstreamPost = {
      id: 123,
      link: "https://www.doctorofcredit.com/example-bank-bonus/",
      date_gmt: "2026-07-20T14:30:00",
      modified_gmt: "2026-07-25T09:15:00",
      title: { rendered: "Example Bank Bonus" },
      content: { rendered: "<p>Source terms.</p>" },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([upstreamPost]), { status: 200 }),
    );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_post",
      arguments: {
        url_or_id: "https://www.doctorofcredit.com/example-bank-bonus/",
      },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?slug=example-bank-bonus",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toEqual({
      post: {
        source: {
          id: 123,
          url: upstreamPost.link,
          title: "Example Bank Bonus",
          publishedAt: "2026-07-20T14:30:00Z",
          modifiedAt: "2026-07-25T09:15:00Z",
          articleText: "Source terms.",
        },
        derived: { outdatedWarning: null },
      },
    });
  });

  it("warns without claiming validity when a post has not been updated for 180 days", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 456,
          link: "https://www.doctorofcredit.com/older-offer/",
          date_gmt: "2025-12-01T12:00:00",
          modified_gmt: "2026-01-01T12:00:00",
          title: { rendered: "Older offer" },
          content: { rendered: "<p>Review the source terms.</p>" },
        }),
        { status: 200 },
      ),
    );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-07-01T12:00:01Z"),
    );

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: 456 },
    });

    expect(result.structuredContent).toMatchObject({
      post: {
        derived: {
          outdatedWarning:
            "This post was last modified more than 180 days ago and may be outdated. Verify the offer against the source before relying on it.",
        },
      },
    });
  });

  it("returns an actionable MCP error when a post does not exist", async () => {
    const client = await connectClient(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: "rest_post_invalid_id" }), {
          status: 404,
        }),
      ),
    );

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: 999999 },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit post 999999: no matching post was found.",
        },
      ],
    });
  });

  it.each([
    {
      label: "a non-positive ID",
      urlOrId: 0,
      error: "Invalid arguments for tool get_post",
    },
    { label: "a malformed URL", urlOrId: "not-a-url", error: "Invalid URL" },
    {
      label: "a URL from another site",
      urlOrId: "https://example.com/example-bank-bonus/",
      error: "Invalid arguments for tool get_post",
    },
    {
      label: "the Doctor of Credit home page",
      urlOrId: "https://www.doctorofcredit.com/",
      error: "Invalid arguments for tool get_post",
    },
    {
      label: "a Doctor of Credit category URL",
      urlOrId: "https://www.doctorofcredit.com/category/deals/",
      error: "Invalid arguments for tool get_post",
    },
  ])("rejects $label without contacting upstream", async ({ urlOrId, error }) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: urlOrId },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(error),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose transport details after a post network failure", async () => {
    const client = await connectClient(() =>
      Promise.reject(new Error("connect ECONNRESET 192.0.2.10:443")),
    );

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: 123 },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit post 123: the upstream service could not be reached. Try again later.",
        },
      ],
    });
  });

  it("returns an actionable MCP error for an invalid post response", async () => {
    const client = await connectClient(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "not-a-number" }), { status: 200 }),
      ),
    );

    const result = await client.callTool({
      name: "get_post",
      arguments: { url_or_id: 123 },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve Doctor of Credit post 123: the upstream response was invalid. Try again later.",
        },
      ],
    });
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

  it("rejects unexpected arguments without contacting Doctor of Credit", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "list_categories",
      arguments: { unexpected: true },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Invalid arguments for tool list_categories",
          ),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
