import { Rpc } from "@opencode/plugin/rpc"

const point = {
  type: "object",
  properties: {
    t: { type: "number" },
    monthly: { type: "number" },
    weekly: { type: "number" },
    rolling: { type: "number" },
  },
  required: ["t", "monthly", "weekly", "rolling"],
  additionalProperties: false,
} as const

const forecast = {
  type: "object",
  properties: {
    ratePerHour: { type: "number" },
    etaDays: { type: "number" },
    spanHours: { type: "number" },
    points: { type: "number" },
    confidence: { type: "string" },
  },
  required: ["ratePerHour", "spanHours", "points"],
  additionalProperties: false,
} as const

export const UsageRpc = Rpc.define({
  id: "usage_lens",
  methods: {
    ingest: {
      input: {
        type: "object",
        properties: { point },
        required: ["point"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          points: { type: "number" },
          forecast,
        },
        required: ["ok", "points"],
        additionalProperties: false,
      },
    },
    history: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          points: { type: "number" },
          forecast,
        },
        required: ["points"],
        additionalProperties: false,
      },
    },
    reset: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          points: { type: "number" },
        },
        required: ["ok", "points"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
