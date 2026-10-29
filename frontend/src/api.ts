import type { HcSessionResult, HcSessionSummary, HcSystemStatusRow } from './types';

const API_BASE = '/api';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === 'string' ? detail : detail?.message ?? `${path} API 요청에 실패했습니다. (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'demo';
  role: 'user' | 'admin';
  display_name: string;
}

export interface FaceContext {
  mode: 'local';
  user_label: string;
  registered: boolean;
  ready: boolean;
  blockers: string[];
  csrf_token: string;
}

export interface FaceAuthStartResponse {
  session_id: string;
  nonce: string;
  challenge: string;
  expires_in_sec: number;
}

export interface CapturePlan {
  illumination: Array<{ offset_ms: number; duration_ms: number; color: [number, number, number] }>;
  capture_duration_ms: number;
  max_frames: number;
}

export interface RuntimeIdentity {
  backend_commit: string;
  backend_dirty: boolean | null;
  web_commit: string;
  web_dirty: boolean | null;
}

export interface FaceAuthVerifyResponse {
  session: Omit<HcSessionResult, 'schema_version' | 'query_budget' | 'decision_provenance' | 'audit'> & {
    schema_version: '1.0';
    query_budget: { used: number | null; limit: number | null; exceeded: boolean | null };
    decision_provenance: {
      source: 'hc160_runtime';
      security_profile: 'FULL';
      runtime_identity: RuntimeIdentity;
      calibration_artifact_id?: string | null;
    };
    audit?: Record<string, unknown>;
  };
  user_message: string;
  next_action: 'continue' | 'step_up' | 'retry' | 'contact_support';
  solutions: string[];
  attack_detected: boolean;
  authorized: false;
  account_authenticated: false;
  token_id: string | null;
}

export interface EnrollResponse {
  status: 'ENROLLED';
  registered: true;
  user_message?: string;
  captured_frames?: number | null;
  valid_frames?: number | null;
  excluded_frames?: number | null;
  exclusion_reasons?: Record<string, number> | null;
  registration_calibration_id?: string | null;
}

export function login(username: string, password: string) {
  return requestJson<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getFaceContext(signal?: AbortSignal) {
  return requestJson<FaceContext>('/face/context', { signal });
}

function facePost<T>(path: string, body: object, csrf: string, signal?: AbortSignal) {
  return requestJson<T>(path, {
    method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(body), signal,
  });
}

export function startFaceAuth(operation: 'enroll' | 'authenticate', csrf: string, signal: AbortSignal) {
  return facePost<FaceAuthStartResponse>('/face/start', { operation }, csrf, signal);
}

export function presentFaceChallenge(session: FaceAuthStartResponse, displayedAt: number, csrf: string, signal: AbortSignal) {
  return facePost<CapturePlan>('/face/present', {
    session_id: session.session_id, nonce: session.nonce, displayed_at_ms: displayedAt,
  }, csrf, signal);
}

export function sendFaceFrame(session: FaceAuthStartResponse, frame: { frame_id: number; timestamp_ms: number; image: string }, csrf: string, signal: AbortSignal) {
  return facePost<{ accepted: boolean }>('/face/frame', {
    session_id: session.session_id, nonce: session.nonce, ...frame,
  }, csrf, signal);
}

export function verifyFaceAuth(session: FaceAuthStartResponse, csrf: string, signal: AbortSignal) {
  return facePost<FaceAuthVerifyResponse | EnrollResponse>('/face/verify', {
    session_id: session.session_id, nonce: session.nonce,
  }, csrf, signal);
}

export function consumeFaceToken(sessionId: string, tokenId: string, csrf: string, signal: AbortSignal) {
  return facePost<{ consumed: boolean; account_authenticated: boolean }>('/face/consume', {
    session_id: sessionId, token_id: tokenId,
  }, csrf, signal);
}

export function cancelFaceSession(session: FaceAuthStartResponse, csrf: string) {
  return facePost('/face/cancel', { session_id: session.session_id, nonce: session.nonce }, csrf);
}

export async function getHc160SessionResult(fallback: () => Promise<HcSessionResult>) {
  try {
    return await requestJson<HcSessionResult>('/dashboard/hc160/session-result');
  } catch {
    return fallback();
  }
}

export async function getHc160SessionSummaries(fallback: () => Promise<HcSessionSummary[]>) {
  try {
    return await requestJson<HcSessionSummary[]>('/dashboard/hc160/session-summaries');
  } catch {
    return fallback();
  }
}

export async function getHc160SystemStatus(fallback: () => Promise<HcSystemStatusRow[]>) {
  try {
    return await requestJson<HcSystemStatusRow[]>('/dashboard/hc160/system-status');
  } catch {
    return fallback();
  }
}

export async function getDashboardText(dataset: 'forensics' | 'defense' | 'hc160', fileName: string, fallbackPath: string) {
  try {
    const response = await fetch(`${API_BASE}/dashboard/static/${dataset}/${fileName}`);
    if (!response.ok) {
      throw new Error('API static file unavailable');
    }
    return await response.text();
  } catch {
    const response = await fetch(fallbackPath);
    if (!response.ok) {
      throw new Error(`${fallbackPath} 파일을 불러오지 못했습니다.`);
    }
    return response.text();
  }
}
