import type { ActionDefinition } from "../../core/types.ts";

import { s } from "../../core/json-schema.ts";
import { defineProviderAction } from "../../core/provider-definition.ts";

const service = "fastcrw";

const looseObject = s.looseObject({}, { description: "A loose JSON object." });
const headersSchema = s.record(s.string("A custom HTTP header value."), {
  description: "Custom HTTP headers to send with the request.",
});
const outputFormatSchema = s.stringEnum("A fastCRW output format.", [
  "markdown",
  "html",
  "rawHtml",
  "plainText",
  "links",
  "images",
  "json",
  "summary",
  "changeTracking",
  "screenshot",
]);
const crawlOutputFormatSchema = s.stringEnum("A fastCRW crawl output format.", [
  "markdown",
  "html",
  "rawHtml",
  "plainText",
  "links",
  "images",
  "json",
]);
const searchScrapeOptionsSchema = s.looseRequiredObject(
  "Scrape options for search results.",
  {
    formats: s.array("The output formats to return for each search result.", outputFormatSchema),
    onlyMainContent: s.boolean("Whether to keep only the main content of each page."),
    timeout: s.integer("Per-result scrape timeout in milliseconds."),
  },
  { optional: ["formats", "onlyMainContent", "timeout"] },
);
const crawlScrapeOptionsSchema = s.looseRequiredObject(
  "Scrape options for crawl pages.",
  {
    formats: s.array("The output formats to return for each page.", crawlOutputFormatSchema),
    onlyMainContent: s.boolean("Whether to keep only the main content of each page."),
    jsonSchema: looseObject,
    renderJs: s.nullableBoolean("null = auto-detect, true = force JS rendering, false = skip JS rendering."),
    waitFor: s.integer("Milliseconds to wait after JS rendering on each page."),
  },
  { optional: ["formats", "onlyMainContent", "jsonSchema", "renderJs", "waitFor"] },
);
const chunkStrategySchema = s.looseRequiredObject(
  "Strategy for chunking extracted markdown.",
  {
    type: s.stringEnum("Chunking algorithm.", ["sentence", "regex", "topic"]),
    maxChars: s.integer("Maximum characters per chunk."),
    overlapChars: s.integer("Character overlap between adjacent chunks."),
    dedupe: s.boolean("Remove duplicate chunks."),
    pattern: s.string("Regex pattern to split on (required when type = regex)."),
  },
  { optional: ["maxChars", "overlapChars", "dedupe", "pattern"] },
);
const extractOptionsSchema = s.looseRequiredObject(
  "Firecrawl-compatible extraction options.",
  {
    schema: looseObject,
  },
  { optional: ["schema"] },
);
const parserSpecSchema = s.looseRequiredObject(
  "Document parser directive.",
  {
    type: s.stringEnum("Parser type.", ["pdf"]),
    mode: s.stringEnum("Parsing strategy.", ["auto", "fast", "ocr"]),
    maxPages: s.integer("Optional cap on the number of pages to parse."),
  },
  { optional: ["mode", "maxPages"] },
);
const changeTrackingSnapshotSchema = s.looseRequiredObject(
  "A change-tracking snapshot.",
  {
    markdown: s.string("Present for gitDiff/mixed mode."),
    json: looseObject,
    contentHash: s.string("Mode-aware hash; persist and supply on the next check."),
    capturedAt: s.string("Caller-stamped capture time, echoed untouched."),
  },
  { optional: ["markdown", "json", "contentHash", "capturedAt"] },
);
const changeTrackingOptionsSchema = s.looseRequiredObject(
  "Change tracking options.",
  {
    modes: s.array("Diff surfaces.", s.stringEnum("A diff mode.", ["gitDiff", "json"])),
    schema: looseObject,
    prompt: s.string("An optional prompt."),
    previous: changeTrackingSnapshotSchema,
    tag: s.string("Opaque caller tag echoed on the result."),
    contentType: s.string("MIME type; non-text content is hashed, not diffed."),
  },
  { optional: ["modes", "schema", "prompt", "previous", "tag", "contentType"] },
);
const pageMetadataSchema = s.looseRequiredObject(
  "Page metadata returned from scrape.",
  {
    title: s.string("The page title."),
    description: s.string("The page description."),
    sourceURL: s.string("The source URL."),
    statusCode: s.integer("The HTTP status code."),
  },
  { optional: ["title", "description", "sourceURL", "statusCode"] },
);
const scrapeDataSchema = s.looseRequiredObject(
  "The scraped data object.",
  {
    markdown: s.string("Markdown content."),
    html: s.string("HTML content."),
    rawHtml: s.string("Raw HTML content."),
    links: s.stringArray("Links discovered on the page."),
    json: looseObject,
    metadata: pageMetadataSchema,
    warning: s.string("A warning from fastCRW."),
    warnings: s.stringArray("Warnings from fastCRW."),
    creditCost: s.number("Credit cost for this request."),
    plainText: s.string("Plain text view."),
    summary: s.string("LLM summary."),
    screenshot: s.string("PNG capture as a data URL."),
    contentType: s.string("MIME type of the fetched resource."),
    changeTracking: looseObject,
  },
  {
    optional: [
      "markdown",
      "html",
      "rawHtml",
      "links",
      "json",
      "metadata",
      "warning",
      "warnings",
      "creditCost",
      "plainText",
      "summary",
      "screenshot",
      "contentType",
      "changeTracking",
    ],
  },
);
const scrapeResultSchema = s.looseRequiredObject(
  "A fastCRW scrape response.",
  {
    success: s.boolean("Whether the scrape request succeeded."),
    data: scrapeDataSchema,
    warning: s.string("A top-level warning."),
  },
  { optional: ["data", "warning"] },
);
const searchResultSchema = s.looseRequiredObject(
  "A search result item.",
  {
    url: s.nonEmptyString("The result URL."),
    title: s.string("The result title."),
    snippet: s.string("Result blurb."),
    description: s.string("Alias of snippet."),
    position: s.integer("Result position."),
    score: s.number("Result score."),
    category: s.string("Search backend result category."),
    markdown: s.string("Present when scrapeOptions.formats includes markdown."),
  },
  { optional: ["title", "snippet", "description", "position", "score", "category", "markdown"] },
);
const searchResponseSchema = s.looseRequiredObject(
  "A fastCRW search response.",
  {
    success: s.boolean("Whether the search request succeeded."),
    data: s.oneOf([s.array("Flat search results.", searchResultSchema), looseObject], {
      description: "Search results (flat array or grouped object).",
    }),
    answer: s.string("Synthesized answer over the top results."),
    citations: s.array("Sources for the answer.", looseObject),
    llmUsage: looseObject,
    warnings: s.stringArray("Soft-failure notices."),
  },
  { optional: ["data", "answer", "citations", "llmUsage", "warnings"] },
);
const mapResponseSchema = s.looseRequiredObject(
  "A fastCRW map response.",
  {
    success: s.boolean("Whether the map request succeeded."),
    data: s.looseRequiredObject(
      "Map result data.",
      {
        links: s.stringArray("The URLs discovered by the map request."),
        droppedActionCount: s.integer("Count of dropped action URLs."),
        strippedTrackingCount: s.integer("Count of stripped tracking parameters."),
        sitemaps: s.stringArray("Sitemap documents discovered."),
      },
      { optional: ["droppedActionCount", "strippedTrackingCount", "sitemaps"] },
    ),
  },
  { optional: ["data"] },
);
const crawlAcceptedSchema = s.looseRequiredObject(
  "A fastCRW crawl job accepted response.",
  {
    success: s.boolean("Whether the job was accepted."),
    id: s.nonEmptyString("The crawl job ID."),
    url: s.string("URL to poll with GET /v1/crawl/{id}."),
  },
  { optional: ["url"] },
);
const crawlStatusSchema = s.looseRequiredObject(
  "A fastCRW crawl job status response.",
  {
    success: s.boolean("Whether the request succeeded."),
    status: s.stringEnum("The job status.", ["scraping", "completed", "failed", "cancelled"]),
    total: s.integer("Total pages to crawl."),
    completed: s.integer("Number of completed pages."),
    data: s.array("The scraped pages.", scrapeResultSchema),
    error: s.string("An error message if the job failed."),
  },
  { optional: ["total", "completed", "data", "error"] },
);
const batchScrapeAcceptedSchema = s.looseRequiredObject(
  "A fastCRW batch scrape accepted response.",
  {
    success: s.boolean("Whether the job was accepted."),
    id: s.nonEmptyString("The batch job ID."),
    invalidUrls: s.stringArray("URLs rejected by parsing or the SSRF guard."),
  },
  { optional: ["invalidUrls"] },
);
const extractAcceptedSchema = s.looseRequiredObject(
  "A fastCRW extract job accepted response.",
  {
    success: s.boolean("Whether the job was accepted."),
    id: s.nonEmptyString("The extract job ID."),
    status: s.string("The initial job status."),
    urls: s.integer("Count of URLs enqueued for fetch."),
  },
  { optional: ["status", "urls"] },
);
const extractUrlResultSchema = s.looseRequiredObject(
  "A per-URL extract result.",
  {
    url: s.nonEmptyString("The URL that was extracted."),
    status: s.stringEnum("The extraction status.", ["processing", "completed", "failed", "cancelled"]),
    data: looseObject,
    error: s.string("An error message if extraction failed."),
    llmUsage: looseObject,
  },
  { optional: ["data", "error", "llmUsage"] },
);
const extractStatusSchema = s.looseRequiredObject(
  "A fastCRW extract job status response.",
  {
    success: s.boolean("Whether the request succeeded."),
    id: s.nonEmptyString("The extract job ID."),
    status: s.stringEnum("The job status.", ["processing", "cancelling", "completed", "failed", "cancelled"]),
    results: s.array("Per-URL extraction results.", extractUrlResultSchema),
    error: s.string("Job-level error."),
    expiresAt: s.string("ISO 8601 expiry timestamp."),
    creditsUsed: s.integer("Credits used by the job."),
    tokensUsed: s.integer("LLM tokens used by the job."),
  },
  { optional: ["results", "error", "expiresAt", "creditsUsed", "tokensUsed"] },
);
const cancelResultSchema = s.looseRequiredObject(
  "A fastCRW cancel response.",
  {
    success: s.boolean("Whether the cancellation succeeded."),
    status: s.string("The final job status."),
    message: s.string("A cancellation message."),
  },
  { optional: ["status", "message"] },
);

const idInput = s.requiredObject("The input payload for this action.", {
  id: s.nonEmptyString("The fastCRW job ID."),
});
const scrapeInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    url: s.nonEmptyString("The URL to scrape."),
    formats: s.array("The output formats to return.", outputFormatSchema),
    onlyMainContent: s.boolean("Whether to keep only the main content of the page."),
    renderJs: s.nullableBoolean("null = auto-detect, true = force JS rendering, false = skip JS rendering."),
    waitFor: s.integer("Milliseconds to wait after JS rendering before extracting content."),
    includeTags: s.stringArray("CSS selectors / HTML tags to include in extraction."),
    excludeTags: s.stringArray("CSS selectors / HTML tags to remove before extraction."),
    jsonSchema: looseObject,
    basis: s.boolean("Return per-field evidence alongside the json format."),
    headers: headersSchema,
    cssSelector: s.string("CSS selector to narrow content extraction."),
    xpath: s.string("XPath expression to narrow content extraction."),
    chunkStrategy: chunkStrategySchema,
    query: s.string("Query string for BM25/cosine chunk filtering."),
    filterMode: s.stringEnum("Filtering algorithm.", ["bm25", "cosine"]),
    topK: s.integer("Number of top chunks to return after filtering."),
    proxy: s.string("Per-request proxy URL."),
    proxyList: s.stringArray("Per-request proxy pool to rotate among."),
    proxyRotation: s.stringEnum("Rotation strategy for proxyList.", ["round_robin", "random", "sticky_per_host"]),
    country: s.string("2-letter ISO country code for residential proxy egress."),
    stealth: s.boolean("Override stealth mode for this request."),
    extract: extractOptionsSchema,
    llmApiKey: s.string("BYOK LLM provider API key for structured extraction."),
    llmProvider: s.stringEnum("Per-request LLM provider override.", [
      "anthropic",
      "openai",
      "deepseek",
      "azure",
      "openai-compatible",
      "openai-responses",
    ]),
    llmModel: s.string("Per-request LLM model identifier override."),
    baseUrl: s.string("Per-request LLM base URL override."),
    summaryPrompt: s.string("User-supplied instructions for summary."),
    maxContentChars: s.integer("Maximum bytes of scraped content sent to LLM for summary format."),
    renderer: s.stringEnum("Pin this request to a specific renderer.", [
      "auto",
      "lightpanda",
      "chrome",
      "chrome_proxy",
      "playwright",
      "camoufox",
    ]),
    deadlineMs: s.integer("End-to-end deadline budget in milliseconds."),
    debug: s.boolean("Include debugExtraction trace."),
    changeTracking: changeTrackingOptionsSchema,
    goal: s.string("Plain-language monitor goal for the meaningful-change judge."),
    judgeEnabled: s.boolean("Run the LLM meaningful-change judge on a changed page."),
    parsers: s.array("Document parser directives.", parserSpecSchema),
    screenshotFullPage: s.boolean("Capture the whole page rather than the viewport."),
  },
  {
    optional: [
      "formats",
      "onlyMainContent",
      "renderJs",
      "waitFor",
      "includeTags",
      "excludeTags",
      "jsonSchema",
      "basis",
      "headers",
      "cssSelector",
      "xpath",
      "chunkStrategy",
      "query",
      "filterMode",
      "topK",
      "proxy",
      "proxyList",
      "proxyRotation",
      "country",
      "stealth",
      "extract",
      "llmApiKey",
      "llmProvider",
      "llmModel",
      "baseUrl",
      "summaryPrompt",
      "maxContentChars",
      "renderer",
      "deadlineMs",
      "debug",
      "changeTracking",
      "goal",
      "judgeEnabled",
      "parsers",
      "screenshotFullPage",
    ],
  },
);
const mapInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    url: s.nonEmptyString("The root URL to map."),
    maxDepth: s.integer("Maximum link-follow depth from the start URL."),
    useSitemap: s.boolean("Fetch and parse sitemap.xml first."),
    crawlFallback: s.boolean("Fall back to BFS crawl when sitemap is missing or sparse."),
    timeout: s.integer("Custom timeout in seconds."),
  },
  { optional: ["maxDepth", "useSitemap", "crawlFallback", "timeout"] },
);
const searchInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    query: s.nonEmptyString("The search query text."),
    limit: s.integer("The maximum number of search results to return."),
    lang: s.string("The language code used to localize search results."),
    tbs: s.stringEnum("Time-based search filter.", ["qdr:h", "qdr:d", "qdr:w", "qdr:m", "qdr:y"]),
    sources: s.array("Search sources.", s.stringEnum("A search source.", ["web", "news", "images"])),
    categories: s.stringArray("Search categories."),
    scrapeOptions: searchScrapeOptionsSchema,
  },
  { optional: ["limit", "lang", "tbs", "sources", "categories", "scrapeOptions"] },
);
const crawlInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    url: s.nonEmptyString("The seed URL for the crawl."),
    maxPages: s.integer("Maximum number of pages to crawl."),
    maxDepth: s.integer("Maximum traversal depth."),
    scrapeOptions: crawlScrapeOptionsSchema,
    formats: s.array("Output formats for each page.", crawlOutputFormatSchema),
    onlyMainContent: s.boolean("Whether to keep only the main content of each page."),
    jsonSchema: looseObject,
    renderJs: s.nullableBoolean("null = auto-detect, true = force JS, false = never use a browser tier."),
    waitFor: s.integer("Milliseconds to wait after JS rendering on each page."),
    renderer: s.stringEnum("Pin this request to a specific renderer.", [
      "auto",
      "lightpanda",
      "chrome",
      "chrome_proxy",
      "playwright",
      "camoufox",
    ]),
    country: s.string("2-letter ISO proxy egress country."),
    proxyList: s.stringArray("Per-request proxy pool."),
    proxyRotation: s.stringEnum("Rotation strategy.", ["round_robin", "random", "sticky_per_host"]),
  },
  {
    optional: [
      "maxPages",
      "maxDepth",
      "scrapeOptions",
      "formats",
      "onlyMainContent",
      "jsonSchema",
      "renderJs",
      "waitFor",
      "renderer",
      "country",
      "proxyList",
      "proxyRotation",
    ],
  },
);
const batchScrapeInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    urls: s.stringArray("The URLs to scrape."),
    ignoreInvalidUrls: s.boolean("When false, a single invalid URL rejects the whole submit."),
    maxConcurrency: s.integer("How many URLs the job scrapes concurrently."),
    formats: s.array("The output formats to return.", outputFormatSchema),
    onlyMainContent: s.boolean("Whether to keep only the main content of each page."),
  },
  { optional: ["ignoreInvalidUrls", "maxConcurrency", "formats", "onlyMainContent"] },
);
const extractInput = s.looseRequiredObject(
  "The input payload for this action.",
  {
    urls: s.stringArray("The URLs to extract from."),
    prompt: s.string("Free-text extraction objective."),
    schema: looseObject,
    llmApiKey: s.string("BYOK LLM API key."),
    llmProvider: s.string("LLM provider."),
    llmModel: s.string("LLM model."),
    basis: s.boolean("Return per-field evidence."),
  },
  { optional: ["prompt", "schema", "llmApiKey", "llmProvider", "llmModel", "basis"] },
);

export const fastcrwActions: ActionDefinition[] = [
  defineProviderAction(service, {
    name: "scrape",
    description: "Scrape a single URL with fastCRW and return the extracted page content in the requested formats.",
    inputSchema: scrapeInput,
    outputSchema: scrapeResultSchema,
  }),
  defineProviderAction(service, {
    name: "map",
    description: "Discover URLs on a website without full scraping.",
    inputSchema: mapInput,
    outputSchema: mapResponseSchema,
  }),
  defineProviderAction(service, {
    name: "search",
    description: "Search the web and optionally scrape the top results.",
    inputSchema: searchInput,
    outputSchema: searchResponseSchema,
  }),
  defineProviderAction(service, {
    name: "crawl",
    description: "Start an async crawl job for a website.",
    inputSchema: crawlInput,
    outputSchema: crawlAcceptedSchema,
  }),
  defineProviderAction(service, {
    name: "crawl_get",
    description: "Get the current status and results of a fastCRW crawl job by job ID.",
    inputSchema: idInput,
    outputSchema: crawlStatusSchema,
  }),
  defineProviderAction(service, {
    name: "batch_scrape",
    description: "Start an async batch scrape job for multiple URLs.",
    inputSchema: batchScrapeInput,
    outputSchema: batchScrapeAcceptedSchema,
  }),
  defineProviderAction(service, {
    name: "batch_scrape_get",
    description: "Get the current status and results of a fastCRW batch scrape job by job ID.",
    inputSchema: idInput,
    outputSchema: crawlStatusSchema,
  }),
  defineProviderAction(service, {
    name: "batch_scrape_cancel",
    description: "Cancel a running fastCRW batch scrape job by job ID.",
    inputSchema: idInput,
    outputSchema: cancelResultSchema,
  }),
  defineProviderAction(service, {
    name: "extract",
    description: "Start an async multi-URL structured extraction job.",
    inputSchema: extractInput,
    outputSchema: extractAcceptedSchema,
  }),
  defineProviderAction(service, {
    name: "extract_get",
    description: "Get the current status and results of a fastCRW extract job by job ID.",
    inputSchema: idInput,
    outputSchema: extractStatusSchema,
  }),
  defineProviderAction(service, {
    name: "extract_cancel",
    description: "Cancel a running fastCRW extract job by job ID.",
    inputSchema: idInput,
    outputSchema: extractStatusSchema,
  }),
];
