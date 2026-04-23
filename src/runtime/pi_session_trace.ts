import { randomUUID } from "node:crypto";
import type { PiEvent } from "./pi_json_protocol";

type SessionTranscriptOptions = {
  cwd?: string;
  sessionId?: string;
  startedAtMs?: number;
};

type SessionHeaderEntry = {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
};

type SessionMessageEntry = {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: Record<string, unknown>;
};

type PendingToolResult = {
  toolCallId: string;
  message: Record<string, unknown>;
  timestampIso: string;
};

function toIsoTimestamp(value: unknown, fallbackMs: number): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(fallbackMs).toISOString();
}

function cloneMessage(
  message: Record<string, unknown>,
  timestampIso: string,
): Record<string, unknown> {
  const cloned = { ...message };
  if (typeof cloned.timestamp !== "number") {
    cloned.timestamp = Date.parse(timestampIso);
  }
  return cloned;
}

function buildToolResultMessage(
  event: PiEvent,
  timestampIso: string,
): Record<string, unknown> | null {
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
  const toolName = typeof event.toolName === "string" ? event.toolName : null;
  const result = event.result;
  if (toolCallId === null || toolName === null || result === null || typeof result !== "object") {
    return null;
  }

  const resultRecord = result as Record<string, unknown>;
  const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
  const details = resultRecord.details;
  const isError = resultRecord.isError;
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    ...(details === undefined ? {} : { details }),
    isError: typeof isError === "boolean" ? isError : false,
    timestamp: Date.parse(timestampIso),
  };
}

export class PiSessionTranscriptWriter {
  private readonly writeLine: (line: string) => void;
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly startedAtMs: number;
  private nextMessageId = 1;
  private lastEntryId: string | null = null;
  private pendingToolResultOrder: string[] = [];
  private pendingToolResults = new Map<string, PendingToolResult>();

  constructor(writeLine: (line: string) => void, options: SessionTranscriptOptions = {}) {
    this.writeLine = writeLine;
    this.sessionId = options.sessionId ?? randomUUID();
    this.cwd = options.cwd ?? process.cwd();
    this.startedAtMs = options.startedAtMs ?? Date.now();
    this.writeHeader();
  }

  appendEvent(event: PiEvent): void {
    if (event.type === "message_end") {
      const message = event.message;
      if (message && typeof message === "object") {
        const messageRecord = message as Record<string, unknown>;
        const timestampIso = toIsoTimestamp(messageRecord.timestamp, this.startedAtMs);
        const toolCallId =
          messageRecord.role === "toolResult" && typeof messageRecord.toolCallId === "string"
            ? messageRecord.toolCallId
            : null;
        if (toolCallId !== null) {
          this.pendingToolResults.delete(toolCallId);
        }
        this.writeMessage(cloneMessage(messageRecord, timestampIso), timestampIso);
      }
      return;
    }

    if (event.type === "tool_execution_end") {
      const timestampIso = toIsoTimestamp(event.timestamp, this.startedAtMs);
      const message = buildToolResultMessage(event, timestampIso);
      if (message === null) return;
      const toolCallId = message.toolCallId as string;
      if (!this.pendingToolResults.has(toolCallId)) {
        this.pendingToolResultOrder.push(toolCallId);
      }
      this.pendingToolResults.set(toolCallId, {
        toolCallId,
        message,
        timestampIso,
      });
    }
  }

  finalize(): void {
    for (const toolCallId of this.pendingToolResultOrder) {
      const pending = this.pendingToolResults.get(toolCallId);
      if (!pending) continue;
      this.writeMessage(pending.message, pending.timestampIso);
      this.pendingToolResults.delete(toolCallId);
    }
  }

  private writeHeader(): void {
    const header: SessionHeaderEntry = {
      type: "session",
      version: 3,
      id: this.sessionId,
      timestamp: new Date(this.startedAtMs).toISOString(),
      cwd: this.cwd,
    };
    this.writeLine(JSON.stringify(header));
  }

  private writeMessage(message: Record<string, unknown>, timestampIso: string): void {
    const entry: SessionMessageEntry = {
      type: "message",
      id: this.formatEntryId(this.nextMessageId),
      parentId: this.lastEntryId,
      timestamp: timestampIso,
      message,
    };
    this.nextMessageId += 1;
    this.lastEntryId = entry.id;
    this.writeLine(JSON.stringify(entry));
  }

  private formatEntryId(value: number): string {
    return value.toString(16).padStart(8, "0").slice(-8);
  }
}

export function serializePiEventsAsSessionTranscript(
  events: PiEvent[],
  options: SessionTranscriptOptions = {},
): string {
  const lines: string[] = [];
  const writer = new PiSessionTranscriptWriter((line) => lines.push(line), options);
  for (const event of events) {
    writer.appendEvent(event);
  }
  writer.finalize();
  return lines.join("\n");
}
