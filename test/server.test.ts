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
      expect.objectContaining({
        name: "get_recent_posts",
        description:
          "Retrieve recent Doctor of Credit posts, optionally filtered by category slug (default limit: 10; maximum: 100).",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
      expect.objectContaining({
        name: "search_posts",
        description:
          "Search Doctor of Credit posts by text, optionally filtered by category slug and publication date (default limit: 10; maximum: 100).",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
      expect.objectContaining({
        name: "compare_offers",
        description:
          "Retrieve up to 10 selected Doctor of Credit posts together without merging or inferring their offer terms.",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
      expect.objectContaining({
        name: "get_big_deals",
        description:
          "Retrieve likely notable Doctor of Credit deal articles using documented amount-mention signals (default limit: 10; maximum: 25).",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    ]);
  });

  it("returns likely big deals using deterministic derived selection signals", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 701,
            link: "https://www.doctorofcredit.com/small-bonus/",
            date_gmt: "2026-07-31T14:00:00",
            modified_gmt: "2026-07-31T15:00:00",
            title: { rendered: "Small checking bonus" },
            content: { rendered: "<p>Get a $300 bonus.</p>" },
          },
          {
            id: 702,
            link: "https://www.doctorofcredit.com/points-offer/",
            date_gmt: "2026-07-30T14:00:00",
            modified_gmt: "2026-07-30T15:00:00",
            title: { rendered: "Card offer: 75,000 points" },
            content: { rendered: "<p>Terms may vary.</p>" },
          },
          {
            id: 703,
            link: "https://www.doctorofcredit.com/large-bank-offer/",
            date_gmt: "2026-07-29T14:00:00",
            modified_gmt: "2026-07-29T15:00:00",
            title: { rendered: "$1,000 bank promotion" },
            content: { rendered: "<p>Read the source requirements.</p>" },
          },
        ]),
        { status: 200 },
      ),
    );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "get_big_deals",
      arguments: {},
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=100&orderby=date&order=desc",
      expect.any(Object),
    );
    expect(result.structuredContent).toEqual({
      posts: [
        {
          source: {
            id: 703,
            url: "https://www.doctorofcredit.com/large-bank-offer/",
            title: "$1,000 bank promotion",
            publishedAt: "2026-07-29T14:00:00Z",
            modifiedAt: "2026-07-29T15:00:00Z",
            articleText: "Read the source requirements.",
          },
          derived: {
            outdatedWarning: null,
            selectionSignals: {
              largestDollarMention: 1000,
              largestPointsOrMilesMention: null,
              qualifyingSignalCount: 1,
            },
          },
        },
        {
          source: {
            id: 702,
            url: "https://www.doctorofcredit.com/points-offer/",
            title: "Card offer: 75,000 points",
            publishedAt: "2026-07-30T14:00:00Z",
            modifiedAt: "2026-07-30T15:00:00Z",
            articleText: "Terms may vary.",
          },
          derived: {
            outdatedWarning: null,
            selectionSignals: {
              largestDollarMention: null,
              largestPointsOrMilesMention: 75000,
              qualifyingSignalCount: 1,
            },
          },
        },
      ],
    });
  });

  it("defaults to the 10 highest-ranked big-deal candidates", async () => {
    const upstreamPosts = Array.from({ length: 12 }, (_, index) => ({
      id: 800 + index,
      link: `https://www.doctorofcredit.com/deal-${index + 1}/`,
      date_gmt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00`,
      modified_gmt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00`,
      title: { rendered: `$${500 + index * 100} promotion` },
      content: { rendered: "<p>Review the source.</p>" },
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(upstreamPosts), { status: 200 }),
      );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_big_deals",
      arguments: {},
    });

    const structuredContent = result.structuredContent as {
      posts: Array<{ source: { id: number } }>;
    };
    expect(structuredContent.posts.map((post) => post.source.id)).toEqual([
      811, 810, 809, 808, 807, 806, 805, 804, 803, 802,
    ]);
  });

  it("applies an explicit big-deal limit and preserves outdated warnings", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 711,
            link: "https://www.doctorofcredit.com/older-large-offer/",
            date_gmt: "2025-11-01T12:00:00",
            modified_gmt: "2026-01-01T12:00:00",
            title: { rendered: "$1,500 promotion" },
            content: { rendered: "<p>Verify the source terms.</p>" },
          },
          {
            id: 712,
            link: "https://www.doctorofcredit.com/newer-offer/",
            date_gmt: "2026-07-30T12:00:00",
            modified_gmt: "2026-07-30T12:00:00",
            title: { rendered: "$750 promotion" },
            content: { rendered: "<p>Verify the source terms.</p>" },
          },
        ]),
        { status: 200 },
      ),
    );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "get_big_deals",
      arguments: { limit: 1 },
    });

    expect(result.structuredContent).toMatchObject({
      posts: [
        {
          source: { id: 711 },
          derived: {
            outdatedWarning:
              "This post was last modified more than 180 days ago and may be outdated. Verify the offer against the source before relying on it.",
            selectionSignals: { largestDollarMention: 1500 },
          },
        },
      ],
    });
  });

  it.each([
    { label: "a zero limit", limit: 0 },
    { label: "a fractional limit", limit: 1.5 },
    { label: "a limit above 25", limit: 26 },
  ])("rejects $label for big deals without contacting upstream", async ({ limit }) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_big_deals",
      arguments: { limit },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Invalid arguments for tool get_big_deals",
          ),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns an actionable error without deals when all upstream sources fail", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockRejectedValueOnce(new Error("connect ECONNRESET 192.0.2.10:443"));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_big_deals",
      arguments: {},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve recent Doctor of Credit posts: WordPress and RSS were unavailable or returned invalid data. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("compares selected posts while preserving each article's shared contract", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 601,
            link: "https://www.doctorofcredit.com/acme-checking-bonus/",
            date_gmt: "2026-07-20T14:30:00",
            modified_gmt: "2026-07-25T09:15:00",
            title: { rendered: "Acme Checking $300 Bonus" },
            content: { rendered: "<p>Acme offers a <strong>$300</strong> bonus.</p>" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 602,
            link: "https://www.doctorofcredit.com/example-savings-bonus/",
            date_gmt: "2025-12-01T12:00:00",
            modified_gmt: "2026-01-01T12:00:00",
            title: { rendered: "Example Savings Bonus" },
            content: { rendered: "<p>Read the source terms &amp; restrictions.</p>" },
          }),
          { status: 200 },
        ),
      );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "compare_offers",
      arguments: { post_ids: [601, 602] },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts/601",
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts/602",
      expect.any(Object),
    );
    expect(result.structuredContent).toEqual({
      posts: [
        {
          source: {
            id: 601,
            url: "https://www.doctorofcredit.com/acme-checking-bonus/",
            title: "Acme Checking $300 Bonus",
            publishedAt: "2026-07-20T14:30:00Z",
            modifiedAt: "2026-07-25T09:15:00Z",
            articleText: "Acme offers a $300 bonus.",
          },
          derived: { outdatedWarning: null },
        },
        {
          source: {
            id: 602,
            url: "https://www.doctorofcredit.com/example-savings-bonus/",
            title: "Example Savings Bonus",
            publishedAt: "2025-12-01T12:00:00Z",
            modifiedAt: "2026-01-01T12:00:00Z",
            articleText: "Read the source terms & restrictions.",
          },
          derived: {
            outdatedWarning:
              "This post was last modified more than 180 days ago and may be outdated. Verify the offer against the source before relying on it.",
          },
        },
      ],
      failures: [],
    });
  });

  it.each([
    { label: "an empty list", postIds: [] },
    { label: "duplicate IDs", postIds: [601, 601] },
    { label: "a string ID", postIds: ["601"] },
    { label: "a non-positive ID", postIds: [0] },
    { label: "a fractional ID", postIds: [1.5] },
    { label: "more than 10 IDs", postIds: Array.from({ length: 11 }, (_, index) => index + 1) },
  ])("rejects $label without contacting upstream", async ({ postIds }) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "compare_offers",
      arguments: { post_ids: postIds },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Invalid arguments for tool compare_offers",
          ),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a missing identifier list without contacting upstream", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "compare_offers",
      arguments: {},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Invalid arguments for tool compare_offers",
          ),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns successful posts and attributable failures for a partial comparison", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 601,
            link: "https://www.doctorofcredit.com/acme-checking-bonus/",
            date_gmt: "2026-07-20T14:30:00",
            modified_gmt: "2026-07-25T09:15:00",
            title: { rendered: "Acme Checking Bonus" },
            content: { rendered: "<p>Source-backed terms.</p>" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "rest_post_invalid_id" }), {
          status: 404,
        }),
      );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "compare_offers",
      arguments: { post_ids: [601, 999999] },
    });

    expect(result.structuredContent).toMatchObject({
      posts: [{ source: { id: 601, articleText: "Source-backed terms." } }],
      failures: [
        {
          postId: 999999,
          error:
            "Could not retrieve Doctor of Credit post 999999: no matching post was found.",
        },
      ],
    });
    expect(result).not.toHaveProperty("isError");
  });

  it("returns one actionable error without comparison data when every post fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "rest_post_invalid_id" }), {
          status: 404,
        }),
      )
      .mockRejectedValueOnce(new Error("connect ECONNRESET 192.0.2.10:443"));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "compare_offers",
      arguments: { post_ids: [999998, 999999] },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not compare Doctor of Credit offers because none of the requested posts could be retrieved. Failures: 999998: Could not retrieve Doctor of Credit post 999998: no matching post was found.; 999999: Could not retrieve Doctor of Credit post 999999: the upstream service could not be reached. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("does not attribute a mismatched upstream post to the requested ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 602,
          link: "https://www.doctorofcredit.com/different-offer/",
          date_gmt: "2026-07-20T14:30:00",
          modified_gmt: "2026-07-25T09:15:00",
          title: { rendered: "Different offer" },
          content: { rendered: "<p>Unrequested source text.</p>" },
        }),
        { status: 200 },
      ),
    );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "compare_offers",
      arguments: { post_ids: [601] },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not compare Doctor of Credit offers because none of the requested posts could be retrieved. Failures: 601: Could not retrieve Doctor of Credit post 601: the upstream response was invalid. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("searches posts by text through WordPress with the shared post contract", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 501,
            link: "https://www.doctorofcredit.com/acme-bank-bonus/",
            date_gmt: "2026-07-30T14:00:00",
            modified_gmt: "2026-07-31T15:00:00",
            title: { rendered: "Acme Bank &amp; $500 Bonus" },
            content: {
              rendered: "<p>Open an Acme account and earn <strong>$500</strong>.</p>",
            },
          },
        ]),
        { status: 200 },
      ),
    );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "search_posts",
      arguments: { query: "Acme $500" },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?search=Acme%20%24500&per_page=10&orderby=relevance&order=desc",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toEqual({
      posts: [
        {
          source: {
            id: 501,
            url: "https://www.doctorofcredit.com/acme-bank-bonus/",
            title: "Acme Bank & $500 Bonus",
            publishedAt: "2026-07-30T14:00:00Z",
            modifiedAt: "2026-07-31T15:00:00Z",
            articleText: "Open an Acme account and earn $500.",
          },
          derived: { outdatedWarning: null },
        },
      ],
    });
  });

  it("combines category, publication-date, and limit search filters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 7,
              count: 42,
              link: "https://www.doctorofcredit.com/category/bank-account-bonuses/",
              name: "Bank Account Bonuses",
              slug: "bank-account-bonuses",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "search_posts",
      arguments: {
        query: "checking bonus",
        category: "bank-account-bonuses",
        after: "2026-07-01",
        limit: 3,
      },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://www.doctorofcredit.com/wp-json/wp/v2/categories?slug=bank-account-bonuses",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?search=checking%20bonus&per_page=3&orderby=relevance&order=desc&categories=7&after=2026-07-01T00%3A00%3A00.000Z",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toEqual({ posts: [] });
  });

  it.each([
    {
      label: "publication date",
      arguments: { query: "bonus", after: "2026-01-15" },
      expectedUrl:
        "https://www.doctorofcredit.com/wp-json/wp/v2/posts?search=bonus&per_page=10&orderby=relevance&order=desc&after=2026-01-15T00%3A00%3A00.000Z",
    },
    {
      label: "limit",
      arguments: { query: "bonus", limit: 2 },
      expectedUrl:
        "https://www.doctorofcredit.com/wp-json/wp/v2/posts?search=bonus&per_page=2&orderby=relevance&order=desc",
    },
  ])("applies the $label search filter independently", async ({ arguments: args, expectedUrl }) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "search_posts",
      arguments: args,
    });

    expect(fetcher).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    expect(result.structuredContent).toEqual({ posts: [] });
  });

  it("applies the category search filter independently", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 12,
              count: 8,
              link: "https://www.doctorofcredit.com/category/credit-card-bonuses/",
              name: "Credit Card Bonuses",
              slug: "credit-card-bonuses",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    const client = await connectClient(fetcher);

    await client.callTool({
      name: "search_posts",
      arguments: { query: "welcome offer", category: "credit-card-bonuses" },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?search=welcome%20offer&per_page=10&orderby=relevance&order=desc&categories=12",
      expect.any(Object),
    );
  });

  it.each([
    { label: "an empty query", arguments: { query: "" } },
    { label: "a whitespace-only query", arguments: { query: "   " } },
    { label: "a malformed date", arguments: { query: "bonus", after: "July 1" } },
    { label: "an impossible date", arguments: { query: "bonus", after: "2026-02-30" } },
    { label: "an empty category", arguments: { query: "bonus", category: "" } },
    { label: "a category name", arguments: { query: "bonus", category: "Bank Bonuses" } },
    { label: "a zero limit", arguments: { query: "bonus", limit: 0 } },
    { label: "a fractional limit", arguments: { query: "bonus", limit: 1.5 } },
    { label: "a limit above 100", arguments: { query: "bonus", limit: 101 } },
  ])("rejects $label for search without contacting upstream", async ({ arguments: args }) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "search_posts",
      arguments: args,
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining("Invalid arguments for tool search_posts"),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a clear search error for a category slug that does not exist", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "search_posts",
      arguments: { query: "bonus", category: "not-a-real-category" },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Unknown Doctor of Credit category slug: not-a-real-category. Use list_categories to discover valid category slugs.",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "category lookup HTTP failure",
      response: new Response("maintenance", { status: 503 }),
      error:
        "Could not search Doctor of Credit posts: upstream returned HTTP 503. Try again later.",
    },
    {
      label: "invalid category lookup response",
      response: new Response(JSON.stringify([{ id: "not-a-number" }]), {
        status: 200,
      }),
      error:
        "Could not search Doctor of Credit posts: the upstream response was invalid. Try again later.",
    },
  ])("accurately reports a $label", async ({ response, error }) => {
    const client = await connectClient(() => Promise.resolve(response));

    const result = await client.callTool({
      name: "search_posts",
      arguments: { query: "bonus", category: "banking" },
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: error }],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it.each([
    {
      label: "an upstream HTTP failure",
      response: new Response("maintenance", { status: 503 }),
      error:
        "Could not search Doctor of Credit posts: upstream returned HTTP 503. Try again later.",
    },
    {
      label: "an invalid upstream response",
      response: new Response(JSON.stringify([{ id: "not-a-number" }]), { status: 200 }),
      error:
        "Could not search Doctor of Credit posts: the upstream response was invalid. Try again later.",
    },
  ])("returns an actionable error for $label without results", async ({ response, error }) => {
    const client = await connectClient(() => Promise.resolve(response));

    const result = await client.callTool({
      name: "search_posts",
      arguments: { query: "bonus" },
    });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: error }],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("does not expose transport details or invent search results after a network failure", async () => {
    const client = await connectClient(() =>
      Promise.reject(new Error("connect ECONNRESET 192.0.2.10:443")),
    );

    const result = await client.callTool({
      name: "search_posts",
      arguments: { query: "bonus" },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not search Doctor of Credit posts: the upstream service could not be reached. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("retrieves the 10 most recent WordPress posts by default", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 201,
            link: "https://www.doctorofcredit.com/newer-deal/",
            date_gmt: "2026-07-31T14:00:00",
            modified_gmt: "2026-07-31T15:00:00",
            title: { rendered: "Newer deal" },
            content: { rendered: "<p>Newer source text.</p>" },
          },
          {
            id: 200,
            link: "https://www.doctorofcredit.com/earlier-deal/",
            date_gmt: "2026-07-30T14:00:00",
            modified_gmt: "2026-07-30T14:00:00",
            title: { rendered: "Earlier deal" },
            content: { rendered: "<p>Earlier source text.</p>" },
          },
        ]),
        { status: 200 },
      ),
    );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: {},
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toEqual({
      posts: [
        {
          source: {
            id: 201,
            url: "https://www.doctorofcredit.com/newer-deal/",
            title: "Newer deal",
            publishedAt: "2026-07-31T14:00:00Z",
            modifiedAt: "2026-07-31T15:00:00Z",
            articleText: "Newer source text.",
          },
          derived: { outdatedWarning: null },
        },
        {
          source: {
            id: 200,
            url: "https://www.doctorofcredit.com/earlier-deal/",
            title: "Earlier deal",
            publishedAt: "2026-07-30T14:00:00Z",
            modifiedAt: "2026-07-30T14:00:00Z",
            articleText: "Earlier source text.",
          },
          derived: { outdatedWarning: null },
        },
      ],
    });
  });

  it("filters recent posts by category slug and explicit limit", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 7,
              count: 42,
              link: "https://www.doctorofcredit.com/category/bank-account-bonuses/",
              name: "Bank Account Bonuses",
              slug: "bank-account-bonuses",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 301,
              link: "https://www.doctorofcredit.com/category-matched-deal/",
              date_gmt: "2026-07-31T10:00:00",
              modified_gmt: "2026-07-31T10:00:00",
              title: { rendered: "Category-matched deal" },
              content: { rendered: "<p>Matched source text.</p>" },
            },
          ]),
          { status: 200 },
        ),
      );
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: { category: "bank-account-bonuses", limit: 2 },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://www.doctorofcredit.com/wp-json/wp/v2/categories?slug=bank-account-bonuses",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=2&orderby=date&order=desc&categories=7",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
    expect(result.structuredContent).toMatchObject({
      posts: [{ source: { id: 301 } }],
    });
  });

  it("applies an explicit limit without a category", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: { limit: 2 },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=2&orderby=date&order=desc",
      expect.any(Object),
    );
    expect(result.structuredContent).toEqual({ posts: [] });
  });

  it("uses the default limit when only a category is provided", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 12,
              count: 8,
              link: "https://www.doctorofcredit.com/category/credit-card-bonuses/",
              name: "Credit Card Bonuses",
              slug: "credit-card-bonuses",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    const client = await connectClient(fetcher);

    await client.callTool({
      name: "get_recent_posts",
      arguments: { category: "credit-card-bonuses" },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc&categories=12",
      expect.any(Object),
    );
  });

  it("falls back to RSS with the shared post contract after WordPress fails", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <item>
            <title>RSS Bank Bonus &#8211; Updated</title>
            <link>https://www.doctorofcredit.com/rss-bank-bonus/</link>
            <pubDate>Thu, 01 Jan 2026 16:30:00 +0000</pubDate>
            <guid isPermaLink="false">https://www.doctorofcredit.com/?p=401?d=20260731</guid>
            <content:encoded><![CDATA[<p>Open an account &amp; earn <strong>$400</strong>.</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        }),
      );
    const client = await connectClient(
      fetcher,
      () => new Date("2026-08-01T12:00:00Z"),
    );

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: { limit: 1 },
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://www.doctorofcredit.com/feed/",
      expect.objectContaining({ headers: { accept: "application/rss+xml" } }),
    );
    expect(result.structuredContent).toEqual({
      posts: [
        {
          source: {
            id: 401,
            url: "https://www.doctorofcredit.com/rss-bank-bonus/",
            title: "RSS Bank Bonus – Updated",
            publishedAt: "2026-01-01T16:30:00.000Z",
            modifiedAt: null,
            articleText: "Open an account & earn $400.",
          },
          derived: {
            outdatedWarning:
              "This RSS post was published more than 180 days ago and may be outdated. RSS does not provide a modification date; verify the offer against the source before relying on it.",
          },
        },
      ],
    });
  });

  it("returns a clear error for a category slug that does not exist", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: { category: "not-a-real-category" },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Unknown Doctor of Credit category slug: not-a-real-category. Use list_categories to discover valid category slugs.",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns one actionable error when WordPress and RSS both fail", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("maintenance", { status: 503 }))
      .mockRejectedValueOnce(new Error("connect ECONNRESET 192.0.2.10:443"));
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: {},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not retrieve recent Doctor of Credit posts: WordPress and RSS were unavailable or returned invalid data. Try again later.",
        },
      ],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it.each([
    { label: "an empty category", arguments: { category: "" } },
    { label: "a category name", arguments: { category: "Bank Bonuses" } },
    { label: "a zero limit", arguments: { limit: 0 } },
    { label: "a fractional limit", arguments: { limit: 1.5 } },
    { label: "a limit above 100", arguments: { limit: 101 } },
  ])("rejects $label without contacting upstream", async ({ arguments: args }) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = await connectClient(fetcher);

    const result = await client.callTool({
      name: "get_recent_posts",
      arguments: args,
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining(
            "Invalid arguments for tool get_recent_posts",
          ),
        },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
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
