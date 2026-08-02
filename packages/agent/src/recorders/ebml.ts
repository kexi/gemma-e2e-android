/**
 * Just enough Matroska to hand ffmpeg a timestamped stream of JPEGs.
 *
 * The problem this solves: `Page.screencastFrame` fires only when the page
 * changes, so a case that sits on one screen for ten seconds produces no
 * frames at all for those ten seconds. Feeding the JPEGs to ffmpeg as raw
 * MJPEG would collapse that pause to nothing, and the recording would run
 * faster than the run it documents.
 *
 * Wrapping each frame in a Matroska block carrying its own timestamp lets
 * ffmpeg see the gaps. With a fixed output rate it then duplicates frames to
 * fill them, so a still screen stays on screen for as long as it really did.
 * The alternative -- re-emitting the last frame on a timer from here -- means
 * reimplementing that in userland and getting the drift wrong.
 *
 * Only the elements ffmpeg needs to start demuxing are written. This is not a
 * general Matroska writer and should not become one.
 */

const EBML_HEADER_ID = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const TRACKS_ID = [0x16, 0x54, 0xae, 0x6b];
const TRACK_ENTRY_ID = [0xae];
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];
const SIMPLE_BLOCK_ID = [0xa3];
const TIMECODE_ID = [0xe7];

/** Milliseconds, which is what the frame timestamps are already in. */
const TIMECODE_SCALE_NS = 1_000_000;

const VIDEO_TRACK = 1;

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * EBML's variable-length integer: the leading one-bit says how many bytes
 * follow, so small numbers cost one byte and large ones grow as needed.
 */
function vint(value: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    const capacity = 2 ** (7 * length) - 1;
    if (value < capacity) {
      const out = new Uint8Array(length);
      let remaining = value;
      for (let index = length - 1; index >= 0; index--) {
        out[index] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      // The marker bit lives in the top byte, at the position that encodes
      // the total length.
      out[0] = (out[0] as number) | (1 << (8 - length));
      return out;
    }
  }
  throw new RangeError(`cannot encode ${value} as an EBML length`);
}

/** An unsigned integer in the fewest bytes that hold it. */
function uint(value: number): Uint8Array {
  const out: number[] = [];
  let remaining = value;
  do {
    out.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return new Uint8Array(out);
}

function element(id: number[], payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array(id), vint(payload.length), payload]);
}

function uintElement(id: number[], value: number): Uint8Array {
  return element(id, uint(value));
}

function stringElement(id: number[], value: string): Uint8Array {
  return element(id, new TextEncoder().encode(value));
}

/**
 * The stream header: everything before the first frame.
 *
 * The segment is left unsized (`0x01` followed by all-ones) because the length
 * is unknowable while recording. ffmpeg reads that as "streaming", which is
 * exactly the situation.
 */
export function ebmlHeader(width: number, height: number): Uint8Array {
  // Values ffmpeg expects for a Matroska v2 stream; anything else and it
  // refuses the input rather than guessing.
  const header = element(
    EBML_HEADER_ID,
    concat([
      uintElement([0x42, 0x86], 1), // EBMLVersion
      uintElement([0x42, 0xf7], 1), // EBMLReadVersion
      uintElement([0x42, 0xf2], 4), // EBMLMaxIDLength
      uintElement([0x42, 0xf3], 8), // EBMLMaxSizeLength
      stringElement([0x42, 0x82], "matroska"), // DocType
      uintElement([0x42, 0x87], 2), // DocTypeVersion
      uintElement([0x42, 0x85], 2), // DocTypeReadVersion
    ]),
  );

  const info = element(
    INFO_ID,
    concat([
      uintElement([0x2a, 0xd7, 0xb1], TIMECODE_SCALE_NS), // TimecodeScale
      stringElement([0x4d, 0x80], "gemma-e2e"), // MuxingApp
      stringElement([0x57, 0x41], "gemma-e2e"), // WritingApp
    ]),
  );

  const track = element(
    TRACK_ENTRY_ID,
    concat([
      uintElement([0xd7], VIDEO_TRACK), // TrackNumber
      uintElement([0x73, 0xc5], VIDEO_TRACK), // TrackUID
      uintElement([0x83], 1), // TrackType: video
      stringElement([0x86], "V_MJPEG"), // CodecID
      element(
        [0xe0], // Video
        concat([
          uintElement([0xb0], width), // PixelWidth
          uintElement([0xba], height), // PixelHeight
        ]),
      ),
    ]),
  );

  return concat([
    header,
    new Uint8Array(SEGMENT_ID),
    // Unknown-size segment: 0x01 marks an 8-byte length, all-ones means
    // "until the stream ends".
    bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    // Info before Tracks: the timecode scale has to be known before anything
    // that carries a timecode is read.
    info,
    element(TRACKS_ID, track),
  ]);
}

/**
 * One frame, as a cluster of its own.
 *
 * A cluster per frame rather than many frames per cluster: a block's timecode
 * is a 16-bit signed offset from its cluster's, so a long still stretch would
 * overflow it. One cluster each keeps every offset at zero and costs a few
 * bytes a frame, which is nothing beside the JPEG.
 */
export function ebmlFrame(jpeg: Uint8Array, timecodeMs: number): Uint8Array {
  const block = concat([
    vint(VIDEO_TRACK),
    // Signed 16-bit offset from the cluster timecode, which is this frame's.
    bytes(0x00, 0x00),
    // Keyframe: every JPEG stands alone, so all of them are.
    bytes(0x80),
    jpeg,
  ]);

  return element(
    CLUSTER_ID,
    concat([
      uintElement(TIMECODE_ID, Math.max(0, Math.round(timecodeMs))),
      element(SIMPLE_BLOCK_ID, block),
    ]),
  );
}
