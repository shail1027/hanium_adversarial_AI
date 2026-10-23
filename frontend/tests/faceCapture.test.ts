import assert from 'node:assert/strict';
import test from 'node:test';
import { captureScheduleOrigin, illuminationAt, isConsumableResult, validateCapturePlan } from '../src/faceCapture.ts';

const plan = { capture_duration_ms: 1000, max_frames: 12, illumination: [{ offset_ms: 500, duration_ms: 300, color: [12, 40, 255] as [number, number, number] }] };

test('bounded capture plan rejects excessive duration, insufficient frame capacity, invalid colors', () => {
  assert.doesNotThrow(() => validateCapturePlan(plan));
  assert.throws(() => validateCapturePlan({ ...plan, capture_duration_ms: 90000 }));
  assert.throws(() => validateCapturePlan({ ...plan, max_frames: 3 }));
  assert.throws(() => validateCapturePlan({ ...plan, illumination: [{ offset_ms: 0, duration_ms: 100, color: [256, 0, 0] }] }));
});

test('illumination follows issued offsets without inventing challenge colors', () => {
  assert.equal(illuminationAt(plan, 499), 'rgb(255,255,255)');
  assert.equal(illuminationAt(plan, 500), 'rgb(12,40,255)');
  assert.equal(illuminationAt(plan, 800), 'rgb(255,255,255)');
});

test('only ACCEPT with a token can request consumption, never STEP_UP/REJECT/errors', () => {
  for (const decision of ['STEP_UP', 'REJECT', 'ERROR']) {
    assert.equal(isConsumableResult({ session: { final_decision: decision }, token_id: 'opaque' }), false);
  }
  assert.equal(isConsumableResult({ session: { final_decision: 'ACCEPT' }, token_id: null }), false);
  assert.equal(isConsumableResult({ session: { final_decision: 'ACCEPT' }, token_id: '' }), false);
  assert.equal(isConsumableResult({ session: { final_decision: 'ACCEPT' }, token_id: 'opaque' }), true);
});

test('camera frames are captured after presentation with sequential IDs and no data prefix', async () => {
  const { captureFrames } = await import('../src/faceCapture.ts');
  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let draws = 0;
  const dimensions: number[][] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => { draws++; dimensions.push(args.slice(3) as number[]); } }),
    toDataURL: () => 'data:image/jpeg;base64,anBlZw==',
  };
  Object.assign(globalThis, {
    document: { createElement: () => canvas },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 8),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  try {
    const frames: Array<{ frame_id: number; timestamp_ms: number; image: string }> = [];
    const started = performance.now() - 100;
    const colors: Array<{ timestamp: number; color: string }> = [];
    await captureFrames({ readyState: 2, videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement, plan, started,
      new AbortController().signal, (color) => colors.push({ timestamp: performance.now(), color }), async (frame) => { frames.push(frame); });
    assert.ok(frames.length >= 10);
    assert.equal(draws, frames.length);
    assert.ok(dimensions.every(([width, height]) => width === 640 && height === 360));
    assert.deepEqual(frames.map((frame) => frame.frame_id), frames.map((_, index) => index));
    assert.ok(frames.every((frame) => frame.timestamp_ms > started && frame.image === 'anBlZw=='));
    assert.equal(canvas.width, 0);
    const colored = colors.find((entry) => entry.color === 'rgb(12,40,255)');
    assert.ok(colored);
    assert.ok(colored.timestamp - started >= 500 && colored.timestamp - started < 580);
  } finally {
    Object.assign(globalThis, { document: originalDocument, requestAnimationFrame: originalRaf, cancelAnimationFrame: originalCancel });
  }
});

test('aborted presentation never starts capture', async () => {
  const { waitForPaint } = await import('../src/faceCapture.ts');
  const originalCancel = globalThis.cancelAnimationFrame;
  Object.assign(globalThis, { cancelAnimationFrame: () => undefined });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(waitForPaint(controller.signal), { name: 'AbortError' });
  } finally {
    Object.assign(globalThis, { cancelAnimationFrame: originalCancel });
  }
});


test('presentation response preserves displayed clock origin and rejects stale or missed illumination', () => {
  assert.equal(captureScheduleOrigin(plan, 1000, 1150), 1000);
  assert.equal(illuminationAt(plan, 1500 - captureScheduleOrigin(plan, 1000, 1150)), 'rgb(12,40,255)');
  assert.throws(() => captureScheduleOrigin(plan, 1000, 1251), /지연/);
  assert.throws(() => captureScheduleOrigin({ ...plan, illumination: [{ offset_ms: 100, duration_ms: 100, color: [0, 0, 0] }] }, 1000, 1150), /지연/);
  assert.throws(() => captureScheduleOrigin({ ...plan, illumination: [] }, 1000, 1251), /지연/);
});


test('capture rejects undersized source before canvas or frame upload', async () => {
  const { captureFrames } = await import('../src/faceCapture.ts');
  let sent = false;
  await assert.rejects(captureFrames({ videoWidth: 160, videoHeight: 120 } as HTMLVideoElement,
    plan, performance.now(), new AbortController().signal, () => undefined, async () => { sent = true; }), /해상도/);
  assert.equal(sent, false);
});
