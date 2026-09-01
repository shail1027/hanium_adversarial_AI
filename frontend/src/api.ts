import type { HcSessionResult, HcSessionSummary, HcSystemStatusRow } from './types';

const API_BASE = '/api';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`${path} API 요청에 실패했습니다.`);
  }

  return response.json() as Promise<T>;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'demo';
  role: 'user' | 'admin';
  display_name: string;
}

export interface FaceAuthStartResponse {
  session_id: string;
  challenge: string;
  expires_in_sec: number;
  remaining_attempts: number;
}

export interface FaceAuthVerifyResponse {
  session: HcSessionResult;
  user_message: string;
  next_action: 'continue' | 'step_up' | 'retry' | 'contact_support';
  solutions: string[];
  attack_detected: boolean;
}

export function login(username: string, password: string) {
  return requestJson<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function startFaceAuth(userId: string) {
  return requestJson<FaceAuthStartResponse>('/face/start', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, purpose: 'LOGIN' }),
  });
}

export function verifyFaceAuth(sessionId: string, scenario: 'normal' | 'attack' | 'quality_fail' | 'timeout') {
  return requestJson<FaceAuthVerifyResponse>('/face/verify', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, scenario }),
  });
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
