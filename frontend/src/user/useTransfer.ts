import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getFaceContext, startFaceAuth, presentFaceChallenge, sendFaceFrame, verifyFaceAuth, consumeFaceToken, cancelFaceSession } from '../api';
import type { FaceContext, FaceAuthStartResponse, FaceAuthVerifyResponse } from '../api';
import { captureFrames, captureScheduleOrigin, waitForPaint } from '../faceCapture';
import { TransferLedger, validateDraft } from './transfer';
import type { Draft, Receipt } from './transfer';

type Screen = 'home' | 'input' | 'confirm' | 'capture' | 'receipt' | 'profile';
type Attempt = { controller: AbortController; csrf: string; stream?: MediaStream; session?: FaceAuthStartResponse; timer?: number };
export function useTransfer() {
  const ledger = useRef(new TransferLedger());
  const [screen, changeScreen] = useState<Screen>('home');
  const [draft, changeDraft] = useState<Draft>({ recipient: '', account: '', amount: '' });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [context, setContext] = useState<FaceContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [challenge, setChallenge] = useState('');
  const [illumination, setIllumination] = useState('');
  const [result, setResult] = useState<FaceAuthVerifyResponse | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const active = useRef<Attempt | null>(null);
  const contextRequest = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    ledger.current.cancel();
    const attempt = active.current;
    active.current = null;
    if (!attempt) return;
    attempt.controller.abort();
    window.clearTimeout(attempt.timer);
    attempt.stream?.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (attempt.session) void cancelFaceSession(attempt.session, attempt.csrf).catch(() => undefined);
  }, []);
  const cancel = useCallback(() => {
    stop(); setWorking(false); setIllumination(''); setChallenge(''); setResult(null);
    setError('송금을 취소했어요. 잔액은 그대로예요.'); changeScreen('confirm');
  }, [stop]);
  const reloadContext = useCallback(async () => {
    contextRequest.current?.abort();
    const controller = new AbortController();
    contextRequest.current = controller;
    setLoadingContext(true); setError(null);
    try {
      const value = await getFaceContext(controller.signal);
      if (!controller.signal.aborted) setContext(value);
    } catch {
      if (!controller.signal.aborted) { setContext(null); setError('인증 서버에 연결하지 못했어요. 다시 연결해 주세요.'); }
    } finally { if (!controller.signal.aborted) setLoadingContext(false); }
  }, []);
  useEffect(() => {
    void reloadContext();
    const onPageHide = () => { if (active.current) cancel(); };
    window.addEventListener('pagehide', onPageHide);
    return () => { contextRequest.current?.abort(); stop(); window.removeEventListener('pagehide', onPageHide); };
  }, [reloadContext, stop, cancel]);

  function setScreen(next: Screen) {
    stop(); setWorking(false); setIllumination(''); setError(null); setResult(null); changeScreen(next);
  }
  function setDraft(next: Draft) { stop(); changeDraft(next); setError(null); }
  function submitDraft() {
    const message = validateDraft(draft, ledger.current.balance);
    setError(message);
    if (!message) setScreen('confirm');
  }
  function openCapture() {
    const message = validateDraft(draft, ledger.current.balance);
    if (message) { setError(message); return; }
    setScreen('capture');
  }
  async function capture(operation: 'enroll' | 'authenticate') {
    if (active.current || screen !== 'capture' || !context?.ready || (operation === 'authenticate' && !context.registered)) return;
    const validation = validateDraft(draft, ledger.current.balance);
    if (validation) { setError(validation); return; }
    const request = ledger.current.begin(draft);
    const attempt: Attempt = { controller: new AbortController(), csrf: context.csrf_token };
    active.current = attempt;
    const { signal } = attempt.controller;
    const ensureCurrent = () => { signal.throwIfAborted(); if (active.current !== attempt) throw new DOMException('취소됨', 'AbortError'); };
    setWorking(true); setError(null); setResult(null); setChallenge('카메라를 준비하고 있어요.');
    attempt.timer = window.setTimeout(() => {
      if (active.current !== attempt) return;
      stop(); setWorking(false); setIllumination(''); setError('촬영 시간이 초과되었어요. 다시 시도해 주세요.');
    }, 90000);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라를 사용할 수 없어요. HTTPS 또는 localhost에서 열어 주세요.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (signal.aborted || active.current !== attempt) { stream.getTracks().forEach(track => track.stop()); ensureCurrent(); }
      attempt.stream = stream;
      const video = videoRef.current;
      if (!video) throw new Error('카메라 화면을 열지 못했어요.');
      video.srcObject = stream;
      await video.play(); ensureCurrent();
      const session = await startFaceAuth(operation, attempt.csrf, signal);
      attempt.session = session;
      if (signal.aborted || active.current !== attempt) { void cancelFaceSession(session, attempt.csrf).catch(() => undefined); ensureCurrent(); }
      if (!ledger.current.bind(request, session.session_id)) throw new Error('현재 송금의 인증 세션을 확인하지 못했어요.');
      // Commit the actual instruction DOM before the shared two-animation-frame ACK protocol.
      flushSync(() => setChallenge(session.challenge));
      const displayedAt = await waitForPaint(signal);
      ensureCurrent();
      const plan = await presentFaceChallenge(session, displayedAt, attempt.csrf, signal);
      ensureCurrent();
      const origin = captureScheduleOrigin(plan, displayedAt, performance.now());
      await captureFrames(video, plan, origin, signal, color => {
        if (active.current === attempt && !signal.aborted) flushSync(() => setIllumination(color));
      }, async frame => {
        ensureCurrent();
        const response = await sendFaceFrame(session, frame, attempt.csrf, signal);
        ensureCurrent();
        if (!response.accepted) throw new Error('촬영 전송이 중단되었어요. 다시 시도해 주세요.');
      });
      ensureCurrent();
      stream.getTracks().forEach(track => track.stop()); video.srcObject = null;
      const outcome = await verifyFaceAuth(session, attempt.csrf, signal);
      ensureCurrent();
      if (operation === 'enroll') {
        if (!('status' in outcome) || outcome.status !== 'ENROLLED' || outcome.registered !== true) throw new Error('얼굴 등록을 확인하지 못했어요.');
        const updated = await getFaceContext(signal); ensureCurrent();
        setContext(updated); setChallenge('얼굴 등록이 완료됐어요. 송금을 승인하려면 별도로 얼굴 인증을 시작해 주세요.');
      } else {
        if ('status' in outcome) throw new Error('등록 결과로 송금을 승인할 수 없어요. 다시 인증해 주세요.');
        if (outcome.session.session_id !== session.session_id) throw new Error('현재 인증과 일치하지 않는 응답이에요. 송금하지 않았어요.');
        setResult(outcome);
        if (!ledger.current.accept(request, outcome)) throw new Error(outcome.session.final_decision === 'STEP_UP' ? '추가 확인이 필요해 송금하지 않았어요. 추가 인증 수단은 아직 연결되지 않았어요.' : '얼굴 인증을 승인받지 못했어요. 송금하지 않았어요.');
        const token = outcome.token_id!;
        const consumed = await consumeFaceToken(session.session_id, token, attempt.csrf, signal);
        ensureCurrent();
        const completed = ledger.current.complete(request, token, consumed);
        if (!completed) throw new Error('인증 승인 확인에 실패했어요. 송금하지 않았어요.');
        setReceipt(completed); changeScreen('receipt');
      }
    } catch (cause) {
      if (active.current === attempt) setError(cause instanceof Error ? cause.message : '인증 처리에 실패했어요. 송금하지 않았어요.');
    } finally {
      window.clearTimeout(attempt.timer);
      attempt.stream?.getTracks().forEach(track => track.stop());
      if (active.current === attempt) {
        stop(); setWorking(false); setIllumination('');
      }
    }
  }
  return { screen, setScreen, draft, setDraft, receipt, balance: ledger.current.balance, transactions: ledger.current.transactions, context, loadingContext, reloadContext, error, working, challenge, illumination, result, videoRef, submitDraft, openCapture, capture, cancel };
}
