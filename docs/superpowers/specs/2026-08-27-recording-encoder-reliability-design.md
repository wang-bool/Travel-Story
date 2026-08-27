# Recording encoder reliability design

## Goal

Produce a clear, smooth, broadly playable travel video without H.264 macroblocking or corrupted reference frames, while keeping normal recording time close to the current offline-render path.

## Context

The recording page renders frames offline and currently selects WebCodecs H.264 whenever available. It asks for `prefer-hardware`, muxes encoded chunks with `mp4-muxer`, then uploads an MP4 directly. The recording upload endpoint does not transcode MP4 uploads.

The affected MP4 reports H.264 `sps_id out of range` errors during FFmpeg decode, so a successful browser encode is not sufficient evidence that a file is safe to deliver.

## Design

### Primary encoder

Keep the existing offline, frame-exact renderer and WebCodecs MP4 output path. Configure the encoder with `hardwareAcceleration: "prefer-software"` rather than `prefer-hardware`. This avoids the corrupted hardware H.264 path while preserving Canvas-to-VideoFrame encoding and a single MP4 upload.

### Reliable fallback

If the software WebCodecs configuration is unavailable, emits an encoding error, or produces an invalid MP4, use the existing JPEG frame-sequence sink. It encodes JPEG at quality 0.95, uploads one-second batches concurrently, and asks the server to produce a standards-compatible H.264 MP4.

The server attempts NVENC first and falls back to x264 at CRF 18, so the fallback prioritizes visual quality and hardware speed where available.

### Scope boundary

This change does not alter map timing, frame count, compositor rendering, timeline construction, media playback, output dimensions, or FFmpeg quality settings. It only changes the output-sink selection policy.

## Failure handling

WebCodecs configuration failure selects JPEG/FFmpeg before any frames are rendered. The upload endpoint validates browser-generated MP4s by decoding keyframes with FFmpeg and rejects streams that report decode errors. A WebCodecs runtime failure or rejected MP4 automatically restarts the offline render using the JPEG/FFmpeg sink. This costs a second render only for an abnormal output and prevents it from being delivered.

## Tests

Add source-level regression tests that verify the recorder requests software H.264, validates direct MP4 uploads, and retries through the JPEG/FFmpeg fallback. Run the full Node test suite and TypeScript typecheck after the change.

## Success criteria

- The recorder no longer requests hardware H.264 encoding.
- A browser without a supported software WebCodecs configuration uses JPEG/FFmpeg fallback.
- A browser-generated MP4 with FFmpeg decode errors is rejected and re-rendered through JPEG/FFmpeg.
- The existing offline renderer and output quality settings remain unchanged.
- Automated tests and typechecking pass.
