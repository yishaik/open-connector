import type { ProviderDefinition } from "../../core/types.ts";
import { actions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "whatsapp_personal",
  displayName: "WhatsApp Personal",
  categories: ["Communication"],
  authTypes: ["api_key"],
  auth: [{
    type: "api_key",
    label: "Bridge access token",
    description: "The private bridge runtime token, not a WhatsApp credential. Pair the bridge as an owner before connecting.",
    extraFields: [{
      key: "baseUrl", label: "Bridge HTTPS origin", inputType: "text",
      required: true, secret: false, placeholder: "https://wa-bridge.example.com",
    }],
  }],
  actions,
};