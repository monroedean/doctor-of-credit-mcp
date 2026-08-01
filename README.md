# doctor-of-credit-mcp

MCP is the better abstraction because an AI client can interpret the articles at request time instead of forcing them into a rigid API schema.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm run build
npm start
```

The process communicates using MCP over stdio. Configure an MCP client to run
`node /absolute/path/to/doctor-of-credit-mcp/dist/cli.js`.

The initial `list_categories` tool retrieves every category from Doctor of
Credit's WordPress API and returns a structured category list. Upstream HTTP,
network, and response-validation failures are returned as actionable MCP tool
errors rather than empty or fabricated results.

## Development

```sh
npm run typecheck
npm test
```

Tests exercise behavior through an MCP client. Most use an in-memory MCP
transport with controlled upstream HTTP fixtures; a smoke test launches the
compiled stdio entry point.

## Planned tools

I’d design the server around a few dependable retrieval tools:
search_posts(query, category?, after?, limit?)
get_recent_posts(category?, limit?)
get_post(url_or_id) — returns cleaned article text and metadata
get_big_deals(limit?)
list_categories()
Then add higher-level research tools:
find_bank_bonuses(bank?, state?, amount_min?)
find_credit_card_offers(issuer?, card?, bonus_min?)
compare_offers(post_ids[])
Those higher-level tools would search and collect likely articles, but let the connected model interpret restrictions, expiration dates, direct-deposit rules, and similar prose. Results should always include:
Original article URL
Publication and modification dates
Cleaned article text
An explicit distinction between source data and AI-derived fields
Warnings when an offer may be outdated
Internally, it can use the WordPress endpoint first, RSS as a fallback, and a small SQLite cache. No separate public REST service is necessary—the MCP server itself becomes the interface.
A TypeScript implementation using the official MCP SDK would make a clean local server that works over stdio, with optional remote HTTP support later.
