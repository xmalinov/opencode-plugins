import { Rpc } from "@opencode/plugin/rpc"

const price = {
  type: "object",
  properties: {
    input: { type: "number" },
    output: { type: "number" },
    cacheRead: { type: "number" },
    cacheWrite: { type: "number" },
  },
  required: ["input", "output", "cacheRead"],
  additionalProperties: false,
} as const

export const TariffRpc = Rpc.define({
  id: "tariff_pulse",
  methods: {
    status: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          modelID: { type: "string" },
          at: { type: "number" },
        },
        required: ["providerID", "modelID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          matched: { type: "boolean" },
          tariffID: { type: "string" },
          tariffLabel: { type: "string" },
          modelKey: { type: "string" },
          tier: { type: "string", enum: ["peak", "offPeak"] },
          reason: { type: "string" },
          nextChangeAt: { type: "number" },
          confidence: { type: "string" },
          peakMultiplier: { type: "number" },
          prices: price,
        },
        required: ["matched"],
        additionalProperties: false,
      },
    },
    setHolidays: {
      input: {
        type: "object",
        properties: {
          dates: { type: "array", items: { type: "string" } },
          validUntil: { type: "string" },
          source: { type: "string" },
        },
        required: ["dates", "validUntil"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          count: { type: "number" },
        },
        required: ["ok", "count"],
        additionalProperties: false,
      },
    },
    schedule: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          tariffID: { type: "string" },
          label: { type: "string" },
          providers: { type: "array", items: { type: "string" } },
          peakMultiplier: { type: "number" },
          pricesAsOf: { type: "string" },
          sourceURL: { type: "string" },
          windows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                days: { type: "array", items: { type: "number" } },
                from: { type: "string" },
                to: { type: "string" },
              },
              required: ["days", "from", "to"],
              additionalProperties: false,
            },
          },
          holidays: {
            type: "object",
            properties: {
              count: { type: "number" },
              validUntil: { type: "string" },
              source: { type: "string" },
            },
            required: ["count", "validUntil"],
            additionalProperties: false,
          },
        },
        required: ["tariffID", "label", "providers", "windows"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
