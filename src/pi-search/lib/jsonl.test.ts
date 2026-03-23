import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { attachJsonlLineReader } from "./jsonl";

void test("attachJsonlLineReader routes an unterminated trailing line to onTrailingLine", async () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  const trailing: string[] = [];

  attachJsonlLineReader(
    stream,
    (line) => {
      lines.push(line);
    },
    {
      onTrailingLine: (line) => {
        trailing.push(line);
      },
    },
  );

  stream.write('{"type":"session"}\n');
  stream.end('{"type":"message_start"');
  await new Promise((resolve) => stream.once("end", resolve));

  assert.deepEqual(lines, ['{"type":"session"}']);
  assert.deepEqual(trailing, ['{"type":"message_start"']);
});

void test("attachJsonlLineReader preserves legacy behavior when onTrailingLine is omitted", async () => {
  const stream = new PassThrough();
  const lines: string[] = [];

  attachJsonlLineReader(stream, (line) => {
    lines.push(line);
  });

  stream.end('{"type":"session"}');
  await new Promise((resolve) => stream.once("end", resolve));

  assert.deepEqual(lines, ['{"type":"session"}']);
});
