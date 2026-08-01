import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { XMLParser } from "fast-xml-parser";
import { decode } from "html-entities";
import { z } from "zod";

export interface ServerDependencies {
  fetch: typeof fetch;
  now?: () => Date;
}

const OUTDATED_AFTER_DAYS = 180;
const OUTDATED_WARNING =
  "This post was last modified more than 180 days ago and may be outdated. Verify the offer against the source before relying on it.";
const OUTDATED_RSS_WARNING =
  "This RSS post was published more than 180 days ago and may be outdated. RSS does not provide a modification date; verify the offer against the source before relying on it.";

class UnknownCategoryError extends Error {}

const wordpressCategorySchema = z.object({
  id: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  link: z.url(),
  name: z.string(),
  slug: z.string(),
});

const categorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  slug: z.string(),
  url: z.url(),
  postCount: z.number().int().nonnegative(),
});

const categoryListSchema = z.object({
  categories: z.array(categorySchema),
});

const wordpressPostSchema = z.object({
  id: z.number().int().positive(),
  link: z.url(),
  date_gmt: z.string(),
  modified_gmt: z.string(),
  title: z.object({ rendered: z.string() }),
  content: z.object({ rendered: z.string() }),
});

const postSchema = z.object({
  source: z.object({
    id: z.number().int().positive(),
    url: z.url(),
    title: z.string(),
    publishedAt: z.iso.datetime(),
    modifiedAt: z.iso.datetime().nullable(),
    articleText: z.string(),
  }),
  derived: z.object({
    outdatedWarning: z.string().nullable(),
  }),
});

const postResultSchema = z.object({ post: postSchema });
const postListResultSchema = z.object({ posts: z.array(postSchema) });

function cleanHtml(html: string): string {
  return decode(
    html
      .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordpressDate(value: string): string {
  return z.iso.datetime().parse(`${value}Z`);
}

function outdatedWarningFor(
  date: string,
  now: () => Date,
  warning = OUTDATED_WARNING,
) {
  const ageMilliseconds = now().getTime() - new Date(date).getTime();
  return ageMilliseconds > OUTDATED_AFTER_DAYS * 24 * 60 * 60 * 1000
    ? warning
    : null;
}

function normalizePost(
  post: z.infer<typeof wordpressPostSchema>,
  now: () => Date,
) {
  const modifiedAt = wordpressDate(post.modified_gmt);
  return {
    source: {
      id: post.id,
      url: post.link,
      title: cleanHtml(post.title.rendered),
      publishedAt: wordpressDate(post.date_gmt),
      modifiedAt,
      articleText: cleanHtml(post.content.rendered),
    },
    derived: { outdatedWarning: outdatedWarningFor(modifiedAt, now) },
  };
}

const rssItemSchema = z.object({
  title: z.string(),
  link: z.url(),
  pubDate: z.string(),
  guid: z.string(),
  "content:encoded": z.string(),
});

const rssFeedSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([rssItemSchema, z.array(rssItemSchema)]),
    }),
  }),
});

function normalizeRssPost(item: z.infer<typeof rssItemSchema>, now: () => Date) {
  const idMatch = /[?&]p=(\d+)/.exec(item.guid);
  if (idMatch?.[1] === undefined) {
    throw new Error("RSS item did not contain a stable post ID");
  }
  const publishedAt = new Date(item.pubDate).toISOString();
  return {
    source: {
      id: z.coerce.number().int().positive().parse(idMatch[1]),
      url: item.link,
      title: cleanHtml(item.title),
      publishedAt,
      modifiedAt: null,
      articleText: cleanHtml(item["content:encoded"]),
    },
    derived: {
      outdatedWarning: outdatedWarningFor(
        publishedAt,
        now,
        OUTDATED_RSS_WARNING,
      ),
    },
  };
}

async function fetchPost(
  fetcher: typeof fetch,
  urlOrId: number | string,
  now: () => Date,
) {
  const identifier = String(urlOrId);
  const requestedSlug =
    typeof urlOrId === "string"
      ? new URL(urlOrId).pathname.split("/").filter(Boolean)[0]
      : undefined;
  const upstreamUrl =
    typeof urlOrId === "number"
      ? `https://www.doctorofcredit.com/wp-json/wp/v2/posts/${urlOrId}`
      : `https://www.doctorofcredit.com/wp-json/wp/v2/posts?slug=${encodeURIComponent(
          new URL(urlOrId).pathname.split("/").filter(Boolean).at(-1) ?? "",
        )}`;
  let response: Response;
  try {
    response = await fetcher(upstreamUrl, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error(
      `Could not retrieve Doctor of Credit post ${identifier}: the upstream service could not be reached. Try again later.`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `Could not retrieve Doctor of Credit post ${identifier}: no matching post was found.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not retrieve Doctor of Credit post ${identifier}: upstream returned HTTP ${response.status}. Try again later.`,
    );
  }

  try {
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.length === 0) {
      throw new Error("not-found");
    }
    const post = Array.isArray(body)
      ? wordpressPostSchema.parse(body[0])
      : wordpressPostSchema.parse(body);
    const returnedSlug = new URL(post.link).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (requestedSlug !== undefined && returnedSlug !== requestedSlug) {
      throw new Error("not-found");
    }
    return normalizePost(post, now);
  } catch (error) {
    if (error instanceof Error && error.message === "not-found") {
      throw new Error(
        `Could not retrieve Doctor of Credit post ${identifier}: no matching post was found.`,
      );
    }
    throw new Error(
      `Could not retrieve Doctor of Credit post ${identifier}: the upstream response was invalid. Try again later.`,
    );
  }
}

async function fetchRecentWordpressPosts(
  fetcher: typeof fetch,
  limit: number,
  now: () => Date,
  category?: string,
) {
  let categoryId: number | undefined;
  if (category !== undefined) {
    const categoryResponse = await fetcher(
      `https://www.doctorofcredit.com/wp-json/wp/v2/categories?slug=${encodeURIComponent(category)}`,
      { headers: { accept: "application/json" } },
    );
    if (!categoryResponse.ok) {
      throw new Error(`WordPress returned HTTP ${categoryResponse.status}`);
    }
    const categories = z
      .array(wordpressCategorySchema)
      .parse(await categoryResponse.json());
    if (categories.length === 0) {
      throw new UnknownCategoryError(
        `Unknown Doctor of Credit category slug: ${category}. Use list_categories to discover valid category slugs.`,
      );
    }
    categoryId = categories[0]!.id;
  }
  const categoryQuery =
    categoryId === undefined ? "" : `&categories=${categoryId}`;
  const response = await fetcher(
    `https://www.doctorofcredit.com/wp-json/wp/v2/posts?per_page=${limit}&orderby=date&order=desc${categoryQuery}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`WordPress returned HTTP ${response.status}`);
  }
  return z
    .array(wordpressPostSchema)
    .parse(await response.json())
    .map((post) => normalizePost(post, now));
}

async function fetchRecentRssPosts(
  fetcher: typeof fetch,
  limit: number,
  now: () => Date,
  category?: string,
) {
  const feedUrl =
    category === undefined
      ? "https://www.doctorofcredit.com/feed/"
      : `https://www.doctorofcredit.com/category/${encodeURIComponent(category)}/feed/`;
  const response = await fetcher(feedUrl, {
    headers: { accept: "application/rss+xml" },
  });
  if (!response.ok) {
    throw new Error(`RSS returned HTTP ${response.status}`);
  }
  const parsed: unknown = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
  }).parse(await response.text());
  const feed = rssFeedSchema.parse(parsed);
  const items = Array.isArray(feed.rss.channel.item)
    ? feed.rss.channel.item
    : [feed.rss.channel.item];
  return items.slice(0, limit).map((item) => normalizeRssPost(item, now));
}

async function fetchRecentPosts(
  fetcher: typeof fetch,
  limit: number,
  now: () => Date,
  category?: string,
) {
  try {
    return await fetchRecentWordpressPosts(fetcher, limit, now, category);
  } catch (error) {
    if (error instanceof UnknownCategoryError) {
      throw error;
    }
    try {
      return await fetchRecentRssPosts(fetcher, limit, now, category);
    } catch {
      throw new Error(
        "Could not retrieve recent Doctor of Credit posts: WordPress and RSS were unavailable or returned invalid data. Try again later.",
      );
    }
  }
}

async function fetchCategoryPage(fetcher: typeof fetch, page: number) {
  let response: Response;
  try {
    response = await fetcher(
      `https://www.doctorofcredit.com/wp-json/wp/v2/categories?per_page=100&page=${page}`,
      { headers: { accept: "application/json" } },
    );
  } catch {
    throw new Error(
      "Could not retrieve Doctor of Credit categories: the upstream service could not be reached. Try again later.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not retrieve Doctor of Credit categories: upstream returned HTTP ${response.status}. Try again later.`,
    );
  }

  try {
    const totalPages = z.coerce
      .number()
      .int()
      .positive()
      .parse(response.headers.get("x-wp-totalpages") ?? "1");
    return {
      categories: z.array(wordpressCategorySchema).parse(await response.json()),
      totalPages,
    };
  } catch {
    throw new Error(
      "Could not retrieve Doctor of Credit categories: the upstream response was invalid. Try again later.",
    );
  }
}

export function createServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer({
    name: "doctor-of-credit-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "list_categories",
    {
      description: "List the categories available from Doctor of Credit.",
      inputSchema: z.strictObject({}),
      outputSchema: categoryListSchema,
    },
    async () => {
      const firstPage = await fetchCategoryPage(dependencies.fetch, 1);
      const upstreamCategories = [...firstPage.categories];
      for (let page = 2; page <= firstPage.totalPages; page += 1) {
        const nextPage = await fetchCategoryPage(dependencies.fetch, page);
        upstreamCategories.push(...nextPage.categories);
      }
      const structuredContent = {
        categories: upstreamCategories.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          url: category.link,
          postCount: category.count,
        })),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "get_post",
    {
      description: "Retrieve a Doctor of Credit post by ID or URL.",
      inputSchema: z.strictObject({
        url_or_id: z.union([
          z.number().int().positive(),
          z
            .url()
            .refine((value) => {
              const url = new URL(value);
              return (
                url.protocol === "https:" &&
                ["doctorofcredit.com", "www.doctorofcredit.com"].includes(
                  url.hostname,
                ) &&
                url.pathname.split("/").filter(Boolean).length === 1
              );
            }, "Must be an HTTPS Doctor of Credit post URL"),
        ]),
      }),
      outputSchema: postResultSchema,
    },
    async ({ url_or_id }) => {
      const structuredContent = {
        post: await fetchPost(
          dependencies.fetch,
          url_or_id,
          dependencies.now ?? (() => new Date()),
        ),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "get_recent_posts",
    {
      description:
        "Retrieve recent Doctor of Credit posts, optionally filtered by category slug (default limit: 10; maximum: 100).",
      inputSchema: z.strictObject({
        category: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
        limit: z.number().int().positive().max(100).optional().default(10),
      }),
      outputSchema: postListResultSchema,
    },
    async ({ category, limit }) => {
      const structuredContent = {
        posts: await fetchRecentPosts(
          dependencies.fetch,
          limit,
          dependencies.now ?? (() => new Date()),
          category,
        ),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(structuredContent, null, 2),
          },
        ],
        structuredContent,
      };
    },
  );

  return server;
}
