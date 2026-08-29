import type { ProviderDefinition } from "../../core/types.ts";

import { fastcrwActions } from "./actions.ts";

const service = "fastcrw";

/**
 * fastCRW provider backed by the fastCRW REST API (Firecrawl-compatible).
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "fastCRW",
  description:
    "Firecrawl-compatible web scraping, crawling, mapping, and search API. Hosted at api.fastcrw.com or self-hosted.",
  categories: ["Data", "Developer Tools"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "Enter your fastCRW API key",
      description:
        "fastCRW API key used with the Authorization Bearer header. Get one at https://fastcrw.com/register.",
      extraFields: [
        {
          key: "baseUrl",
          label: "API Base URL",
          inputType: "text",
          required: false,
          secret: false,
          placeholder: "https://api.fastcrw.com",
          description:
            "The HTTP or HTTPS API base URL. Defaults to https://api.fastcrw.com for hosted usage. Self-hosted instances (Docker Compose, LAN) require the deployment to enable OOMOL_CONNECT_ALLOW_PRIVATE_NETWORK; reserved, loopback, link-local, and cloud-metadata targets always remain blocked.",
        },
      ],
    },
  ],
  homepageUrl: "https://fastcrw.com",
  actions: fastcrwActions,
};
