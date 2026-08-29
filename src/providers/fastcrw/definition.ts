import type { ProviderDefinition } from "../../core/types.ts";

import { fastcrwActions } from "./actions.ts";

const service = "fastcrw";

/**
 * fastCRW provider backed by the fastCRW REST API (Firecrawl-compatible).
 */
export const provider: ProviderDefinition = {
  service,
  displayName: "fastCRW",
  description: "Firecrawl-compatible web scraping, crawling, mapping, and search API hosted at api.fastcrw.com.",
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
            "Optional public HTTPS API base URL. Defaults to https://api.fastcrw.com. Use only for alternate hosted instances.",
        },
      ],
    },
  ],
  homepageUrl: "https://fastcrw.com",
  actions: fastcrwActions,
};
