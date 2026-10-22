// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 dootaang — LogPapa. Licensed under GNU GPL v3 (see LICENSE).
// web/src/saveStream.ts — 큰 파일(백업 zip)을 메모리에 다 만들지 않고 "조각째" 저장하는 곳(sink).
//   ① 데스크탑: 메인 프로세스가 저장 대화상자 → 고른 파일에 조각을 바로 씀(window.desktop.saveStream*).
//   ② 웹(크롬·엣지): showSaveFilePicker → createWritable 로 디스크에 흘려 씀.
//   ③ 그 외 브라우저: 조각마다 작은 Blob으로 바꿔 모은 뒤 마지막에 다운로드(Blob 데이터는 브라우저가 렌더러 밖·디스크로 옮김).
// 2026-10-22: 전체 백업이 zip 전체를 메모리에 만들어 1GB+ 사용자에게서 메모리 부족으로 죽던 것 수정의 일부.

export type SaveSink = {
  kind: 'desktop' | 'picker' | 'blob';
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

const IPC_PIECE = 8 * 1024 * 1024;   // 데스크탑 IPC 한 번에 보낼 크기(큰 그림 하나도 8MB씩 — 복사 피크 제한)

/** 저장할 곳을 연다. 사용자가 취소하면 null. */
export async function openSaveSink(suggestedName: string, mime = 'application/zip'): Promise<SaveSink | null> {
  const d: any = (window as any).desktop;
  if (d && typeof d.saveStreamOpen === 'function') {
    const r = await d.saveStreamOpen(suggestedName);
    if (!r || !r.ok) return null;
    const token = r.token;
    return {
      kind: 'desktop',
      async write(chunk) {
        // ★slice(복사)로 보낸다 — subarray를 보내면 IPC 직렬화가 원본 버퍼 전체를 복사한다.
        for (let i = 0; i < chunk.length; i += IPC_PIECE) await d.saveStreamWrite(token, chunk.slice(i, Math.min(i + IPC_PIECE, chunk.length)));
      },
      async close() { await d.saveStreamClose(token, false); },
      async abort() { try { await d.saveStreamClose(token, true); } catch (_) {} },
    };
  }
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker === 'function') {
    let handle: any;
    try { handle = await picker({ suggestedName, types: [{ description: 'ZIP', accept: { [mime]: ['.zip'] } }] }); }
    catch (e: any) { if (e && e.name === 'AbortError') return null; handle = null; }   // 취소=null, 그 외(권한 등)=폴백
    if (handle) {
      const ws = await handle.createWritable();
      return {
        kind: 'picker',
        async write(chunk) { await ws.write(chunk); },
        async close() { await ws.close(); },
        async abort() { try { await ws.abort(); } catch (_) {} },
      };
    }
  }
  // 폴백: 조각 → 작은 Blob(렌더러 메모리에서 바로 떠남) → 마지막에 하나의 Blob으로 다운로드.
  const parts: Blob[] = [];
  return {
    kind: 'blob',
    async write(chunk) { parts.push(new Blob([chunk])); },
    async close() {
      const blob = new Blob(parts, { type: mime }); parts.length = 0;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = suggestedName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (_) {} }, 60000);
    },
    async abort() { parts.length = 0; },
  };
}

// ── 작업 중 표식(크래시 진단) — 백업처럼 무거운 작업을 시작할 때 남기고 끝나면 지운다.
//   화면이 메모리 부족으로 죽으면 표식이 남아, 비상 복구 화면이 "백업 중에 메모리가 부족했다"고 정확히 알려 준다.
const BUSY_KEY = 'pro2-busy-op';
export function markBusy(op: string): void { try { localStorage.setItem(BUSY_KEY, JSON.stringify({ op, t: Date.now() })); } catch (_) {} }
export function clearBusy(): void { try { localStorage.removeItem(BUSY_KEY); } catch (_) {} }
/** 최근(15분 안) 남은 표식을 읽고 지운다. 없으면 null. */
export function takeBusy(): { op: string; t: number } | null {
  try {
    const raw = localStorage.getItem(BUSY_KEY); localStorage.removeItem(BUSY_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return (o && typeof o.op === 'string' && Date.now() - (+o.t || 0) < 15 * 60 * 1000) ? o : null;
  } catch (_) { return null; }
}
