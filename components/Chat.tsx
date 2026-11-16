"use client";

import { useEffect, useRef, useState } from "react";
import Answer, { type SourceRef } from "./Answer";

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; sources: SourceRef[]; status: "streaming" | "done" | "error" };

const FAQ = [
  "Bagaimana pelayanan MBG pada saat hari libur sekolah?",
  "Berapa kali susu harus diberikan kepada peserta didik dalam seminggu?",
  "Berapa besaran insentif ketersediaan dan mutu layanan SPPG?",
  "Apa tugas penanggung jawab pelaksanaan MBG di satuan pendidikan?",
  "Bagaimana aturan jadwal distribusi dan penyajian makanan MBG?",
  "Apa saja pemenuhan minimal pelayanan untuk kelompok 3B?",
];

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  function patchLast(fn: (t: Extract<Turn, { role: "assistant" }>) => Partial<Extract<Turn, { role: "assistant" }>>) {
    setTurns((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { ...last, ...fn(last) };
      return next;
    });
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);

    const history = [...turns, { role: "user", content: q } as Turn]
      .filter((t) => t.role === "user" || t.status === "done")
      .map((t) => ({ role: t.role, content: t.content }));

    setTurns((prev) => [
      ...prev,
      { role: "user", content: q },
      { role: "assistant", content: "", sources: [], status: "streaming" },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Layanan sedang tidak dapat dihubungi.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "sources") patchLast(() => ({ sources: ev.sources }));
          else if (ev.type === "delta") patchLast((t) => ({ content: t.content + ev.text }));
          else if (ev.type === "done") patchLast(() => ({ status: "done" }));
          else if (ev.type === "error") patchLast(() => ({ content: ev.message, status: "error" }));
        }
      }
      patchLast((t) => (t.status === "streaming" ? { status: "done" } : {}));
    } catch (e) {
      if ((e as Error).name === "AbortError") patchLast((t) => ({ status: t.content ? "done" : "error", content: t.content || "Dibatalkan." }));
      else patchLast(() => ({ content: (e as Error).message, status: "error" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function reset() {
    abortRef.current?.abort();
    setTurns([]);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <section className="chat" aria-label="Layanan tanya jawab">
      <div className="chat-head">
        <div>
          <h2>Layanan Tanya Jawab</h2>
          <p>Jawaban bersumber dari dokumen rujukan yang terdaftar</p>
        </div>
        {turns.length > 0 && (
          <button type="button" className="btn-ghost" onClick={reset}>
            Pertanyaan baru
          </button>
        )}
      </div>

      <div className="chat-body" aria-live="polite">
        {turns.length === 0 ? (
          <div className="faq">
            <h3>Pertanyaan yang sering diajukan</h3>
            <ul>
              {FAQ.map((q, i) => (
                <li key={q}>
                  <button type="button" onClick={() => ask(q)}>
                    <span className="faq-no">{String(i + 1).padStart(2, "0")}</span>
                    <span>{q}</span>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="q">
                <span className="q-label">Pertanyaan</span>
                <p>{t.content}</p>
              </div>
            ) : (
              <Answer key={i} text={t.content} sources={t.sources} status={t.status} />
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label htmlFor="q" className="sr-only">
          Tulis pertanyaan
        </label>
        <textarea
          id="q"
          ref={inputRef}
          value={input}
          rows={2}
          maxLength={1500}
          placeholder="Tulis pertanyaan Anda, misalnya: apakah MBG tetap dibagikan saat hari Sabtu?"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn-primary" onClick={() => abortRef.current?.abort()}>
            Hentikan
          </button>
        ) : (
          <button type="submit" className="btn-primary" disabled={!input.trim()}>
            Kirim
          </button>
        )}
      </form>
    </section>
  );
}
