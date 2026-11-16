"use client";

import { Fragment, useId, useState, type ReactNode } from "react";

export type SourceRef = {
  n: number;
  slug: string;
  jenis: string;
  nomor: string;
  judul: string;
  singkat: string;
  halaman: string;
  url: string;
  kutipan: string;
};

// Ubah teks jawaban (markdown sederhana) menjadi elemen React tanpa innerHTML.
function inline(text: string, cite: (n: number) => ReactNode, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[\d+\](?:\s*\[\d+\])*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyBase}b${k++}`}>{tok.slice(2, -2)}</strong>);
    else
      out.push(
        <span key={`${keyBase}c${k++}`} className="cites">
          {[...tok.matchAll(/\d+/g)].map((d) => (
            <Fragment key={d[0]}>{cite(Number(d[0]))}</Fragment>
          ))}
        </span>,
      );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBlocks(text: string, cite: (n: number) => ReactNode) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const key = `p${blocks.length}`;
      blocks.push(<p key={key}>{inline(para.join(" "), cite, key)}</p>);
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const key = `l${blocks.length}`;
      const items = list.items.map((it, i) => <li key={i}>{inline(it, cite, `${key}-${i}`)}</li>);
      blocks.push(list.type === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*•]\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(<h4 key={`h${blocks.length}`}>{h[1].replace(/\*\*/g, "")}</h4>);
    } else if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += " " + line;
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export default function Answer({
  text,
  sources,
  status,
}: {
  text: string;
  sources: SourceRef[];
  status: "streaming" | "done" | "error";
}) {
  const id = useId();
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
    .filter((n) => sources.some((s) => s.n === n))
    .sort((a, b) => a - b);
  const shown = sources.filter((s) => cited.includes(s.n));

  const cite = (n: number) =>
    sources.some((s) => s.n === n) ? (
      <a
        href={`#${id}-src-${n}`}
        className="cite"
        onClick={() => setOpen(n)}
        title={sources.find((s) => s.n === n)?.singkat}
      >
        {n}
      </a>
    ) : null;

  async function copy() {
    const refs = shown.map((s) => `[${s.n}] ${s.jenis} Nomor ${s.nomor} tentang ${s.judul}${s.halaman ? `, ${s.halaman}` : ""}`);
    await navigator.clipboard.writeText([text, "", "Rujukan:", ...refs].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article className={`a a-${status}`}>
      <span className="a-label">Jawaban</span>
      <div className="a-text">
        {text ? renderBlocks(text, cite) : <p className="typing">Menelusuri dokumen rujukan<span>…</span></p>}
        {status === "streaming" && text && <span className="caret" aria-hidden="true" />}
      </div>

      {status === "done" && shown.length > 0 && (
        <div className="refs">
          <h4>Dasar rujukan</h4>
          <ol>
            {shown.map((s) => (
              <li key={s.n} id={`${id}-src-${s.n}`} className={open === s.n ? "is-open" : ""}>
                <div className="ref-row">
                  <span className="ref-n">{s.n}</span>
                  <div className="ref-main">
                    <span className="ref-doc">
                      {s.jenis} Nomor {s.nomor}
                      {s.halaman && <em> · {s.halaman}</em>}
                    </span>
                    <span className="ref-title">{s.judul}</span>
                  </div>
                </div>
                <div className="ref-actions">
                  <button type="button" onClick={() => setOpen(open === s.n ? null : s.n)} aria-expanded={open === s.n}>
                    {open === s.n ? "Tutup kutipan" : "Lihat kutipan"}
                  </button>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    Buka dokumen
                  </a>
                </div>
                {open === s.n && <blockquote>{s.kutipan}</blockquote>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {status === "done" && text && (
        <div className="a-foot">
          <button type="button" className="btn-link" onClick={copy}>
            {copied ? "Tersalin" : "Salin jawaban beserta rujukan"}
          </button>
        </div>
      )}
    </article>
  );
}
