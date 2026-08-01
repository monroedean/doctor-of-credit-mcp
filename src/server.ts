import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ServerDependencies {
  fetch: typeof fetch;
}

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
      inputSchema: z.object({}),
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

  return server;
}
