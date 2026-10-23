import type { CapturePlan } from './api';

export function validateCapturePlan(plan: CapturePlan): void {
  if (!Number.isFinite(plan.capture_duration_ms) || plan.capture_duration_ms < 1000 || plan.capture_duration_ms > 30000
    || !Number.isInteger(plan.max_frames) || plan.max_frames < 10 || plan.max_frames > 360
    || plan.max_frames < Math.ceil(plan.capture_duration_ms / 90) || !Array.isArray(plan.illumination)) {
    throw new Error('서버 촬영 계획이 허용 범위를 벗어났습니다.');
  }
  for (const step of plan.illumination) {
    if (!Number.isFinite(step.offset_ms) || step.offset_ms < 0 || !Number.isFinite(step.duration_ms) || step.duration_ms <= 0
      || step.offset_ms + step.duration_ms > plan.capture_duration_ms || step.color.length !== 3
      || step.color.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('서버 조명 챌린지가 올바르지 않습니다.');
    }
  }
}

export function captureScheduleOrigin(plan: CapturePlan, displayedAt: number, receivedAt: number): number {
  validateCapturePlan(plan);
  const elapsed = receivedAt - displayedAt;
  const firstIllumination = Math.min(...plan.illumination.map((step) => step.offset_ms));
  if (!Number.isFinite(displayedAt) || !Number.isFinite(receivedAt) || elapsed < 0 || elapsed > 250
    || elapsed >= firstIllumination) {
    throw new Error('챌린지 응답이 지연되어 촬영을 취소했습니다. 다시 시도하세요.');
  }
  return displayedAt;
}

export function illuminationAt(plan: CapturePlan, elapsed: number): string {
  const step = plan.illumination.find((item) => elapsed >= item.offset_ms && elapsed < item.offset_ms + item.duration_ms);
  return step ? `rgb(${step.color.join(',')})` : 'rgb(255,255,255)';
}

export function isConsumableResult(result: { session: { final_decision: string }; token_id: string | null }): boolean {
  return result.session.final_decision === 'ACCEPT' && typeof result.token_id === 'string' && result.token_id.length > 0;
}

export function waitForPaint(signal: AbortSignal, paints = 2): Promise<number> {
  return new Promise((resolve, reject) => {
    let frame = 0;
    const abort = () => { cancelAnimationFrame(frame); reject(new DOMException('촬영 취소', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    const painted = () => {
      if (--paints > 0) { frame = requestAnimationFrame(painted); return; }
      signal.removeEventListener('abort', abort);
      resolve(performance.now());
    };
    frame = requestAnimationFrame(painted);
  });
}

export async function captureFrames(
  video: HTMLVideoElement,
  plan: CapturePlan,
  startedAt: number,
  signal: AbortSignal,
  setIllumination: (color: string) => void,
  send: (frame: { frame_id: number; timestamp_ms: number; image: string }) => Promise<unknown>,
): Promise<void> {
  captureScheduleOrigin(plan, startedAt, performance.now());
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 320 || sourceHeight < 240) {
    throw new Error('카메라 영상 해상도가 부족합니다. 320×240 이상으로 다시 촬영하세요.');
  }
  const scale = Math.min(1, 640 / sourceWidth, 480 / sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(sourceWidth * scale);
  canvas.height = Math.floor(sourceHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('카메라 프레임을 처리할 수 없습니다.');
  let illuminationFrame = 0;
  const renderIllumination = () => {
    setIllumination(illuminationAt(plan, performance.now() - startedAt));
    illuminationFrame = requestAnimationFrame(renderIllumination);
  };
  renderIllumination();
  let frameId = 0;
  let nextFrame = startedAt;
  try {
    while (performance.now() - startedAt < plan.capture_duration_ms) {
      await waitForPaint(signal, 1);
      const now = performance.now();
      if (now < nextFrame) continue;
      if (frameId >= plan.max_frames) throw new Error('촬영 프레임 제한을 초과했습니다.');
      if (video.readyState < 2 || !video.videoWidth) throw new Error('카메라 영상이 준비되지 않았습니다.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      if (!image) throw new Error('카메라 프레임 인코딩에 실패했습니다.');
      await send({ frame_id: frameId++, timestamp_ms: now, image });
      nextFrame = now + 90;
    }
    if (frameId < 10) throw new Error('촬영 프레임이 부족합니다. 연결 상태를 확인하고 다시 시도하세요.');
  } finally {
    cancelAnimationFrame(illuminationFrame);
    canvas.width = 0;
    canvas.height = 0;
    setIllumination('');
  }
}
