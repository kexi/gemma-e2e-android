import { describe, expect, test } from "bun:test";
import { ebmlFrame, ebmlHeader } from "./ebml.ts";

/** Reads a big-endian unsigned integer, for checking encoded values. */
function readUint(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index++) {
    value = value * 256 + (bytes[offset + index] as number);
  }
  return value;
}

function indexOfSequence(haystack: Uint8Array, needle: number[]): number {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * Reads the element whose id starts at `idEnd`, returning its payload.
 * The length is an EBML vint, so its leading marker bit has to be stripped
 * before the value means anything -- getting that wrong is how a reader ends
 * up parsing the payload as a length.
 */
function payloadAt(bytes: Uint8Array, idEnd: number): Uint8Array {
  const first = bytes[idEnd] as number;
  let lengthBytes = 1;
  while (lengthBytes <= 8 && (first & (1 << (8 - lengthBytes))) === 0) {
    lengthBytes++;
  }

  let size = first & ((1 << (8 - lengthBytes)) - 1);
  for (let index = 1; index < lengthBytes; index++) {
    size = size * 256 + (bytes[idEnd + index] as number);
  }

  const start = idEnd + lengthBytes;
  return bytes.slice(start, start + size);
}

/** The timecode a frame's cluster declares. */
function timecodeOf(frame: Uint8Array): number {
  const marker = indexOfSequence(frame, [0xe7]);
  const payload = payloadAt(frame, marker + 1);
  return readUint(payload, 0, payload.length);
}

describe("ebmlHeader", () => {
  test("opens with the EBML magic ffmpeg looks for", () => {
    const header = ebmlHeader(320, 240);

    expect(Array.from(header.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  test("declares matroska, which is the demuxer the pipe is opened with", () => {
    const header = ebmlHeader(320, 240);

    expect(new TextDecoder().decode(header)).toContain("matroska");
  });

  test("leaves the segment unsized, because a recording has no known length", () => {
    // 0x01 followed by all-ones is EBML for "streaming"; a real length would
    // have to be known before the first frame, which it never is.
    const header = ebmlHeader(320, 240);
    const segment = indexOfSequence(header, [0x18, 0x53, 0x80, 0x67]);

    expect(segment).toBeGreaterThan(-1);
    expect(Array.from(header.slice(segment + 4, segment + 12))).toEqual([
      0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
  });

  test("declares the frame size it was given", () => {
    const header = ebmlHeader(1280, 900);
    const width = payloadAt(header, indexOfSequence(header, [0xb0]) + 1);
    const height = payloadAt(header, indexOfSequence(header, [0xba]) + 1);

    expect(readUint(width, 0, width.length)).toBe(1280);
    expect(readUint(height, 0, height.length)).toBe(900);
  });

  test("puts Info before Tracks, so the timecode scale is known first", () => {
    const header = ebmlHeader(320, 240);
    const info = indexOfSequence(header, [0x15, 0x49, 0xa9, 0x66]);
    const tracks = indexOfSequence(header, [0x16, 0x54, 0xae, 0x6b]);

    expect(info).toBeGreaterThan(-1);
    expect(tracks).toBeGreaterThan(info);
  });
});

describe("ebmlFrame", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  test("carries the frame's own timestamp, which is what fills a still stretch", () => {
    // The whole reason this file exists: a page that does not change emits no
    // frames, so the gap has to be stated rather than inferred from arrival.
    expect(timecodeOf(ebmlFrame(jpeg, 2500))).toBe(2500);
  });

  test("gives each frame a cluster of its own", () => {
    // A block's timecode is a 16-bit offset from its cluster's, so batching
    // frames into one cluster would overflow across a long still stretch.
    const frame = ebmlFrame(jpeg, 0);

    expect(Array.from(frame.slice(0, 4))).toEqual([0x1f, 0x43, 0xb6, 0x75]);
  });

  test("marks every frame a keyframe, which each JPEG is", () => {
    const frame = ebmlFrame(jpeg, 0);
    const block = indexOfSequence(frame, [0xa3]);

    // track vint, then the 16-bit offset, then the flags byte.
    expect(frame[block + 2 + 1 + 2]).toBe(0x80);
  });

  test("rounds and clamps the timestamp, since a negative one cannot be encoded", () => {
    // Asserting the value rather than merely that it does not throw: a clamp
    // that silently produced the wrong timecode would pass the weaker check
    // while shifting every frame after it.
    expect(timecodeOf(ebmlFrame(jpeg, -50))).toBe(0);
    expect(timecodeOf(ebmlFrame(jpeg, 12.7))).toBe(13);
    expect(timecodeOf(ebmlFrame(jpeg, 12.2))).toBe(12);
  });

  test("holds the JPEG unaltered, so what was captured is what is muxed", () => {
    const frame = ebmlFrame(jpeg, 0);

    expect(indexOfSequence(frame, Array.from(jpeg))).toBeGreaterThan(-1);
  });

  test("encodes a timestamp past a single byte, which any real case reaches", () => {
    // 300 needs two bytes; a case running longer than 255ms is every case.
    expect(timecodeOf(ebmlFrame(jpeg, 300))).toBe(300);
    // And a minute in, which any real case reaches.
    expect(timecodeOf(ebmlFrame(jpeg, 60_000))).toBe(60_000);
  });
});
