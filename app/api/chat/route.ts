import { GoogleGenAI } from "@google/genai";
import { retrieve } from "@/lib/retrieve";
import { NOT_FOUND, SYSTEM_PROMPT, WEB_PROMPT, buildContext } from "@/lib/prompt";
import { SOURCE_BY_SLUG, docUrl, pageLabel } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 60;

type Msg = { role: "user" | "assistant"; content: string };

// Pembatas sederhana per IP agar kuota gratis Gemini tidak cepat habis.
const hits = new Map<string, number[]>();
const LIMIT = Number(process.env.RATE_LIMIT ?? 30);
const WINDOW = 10 * 60 * 1000;
function limited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  list.push(now);
  hits.set(ip, list);
  return list.length > LIMIT;
}

const DEFAULT_MODELS = "gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.5-flash";
const FIRST_TOKEN_TIMEOUT = 20_000;
const DEFAULT_WEB_MODELS = "gemini-flash-lite-latest,gemini-3.5-flash-lite";
const WEB_ON = process.env.WEB_SEARCH !== "off";

type WebSource = { n: number; uri: string; title: string };
type Grounding = {
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  groundingSupports?: { segment?: { endIndex?: number }; groundingChunkIndices?: number[] }[];
};

// Sisipkan nomor rujukan [n] ke teks jawaban berdasarkan groundingSupports.
function withWebCitations(text: string, g: Grounding | undefined) {
  const chunks = g?.groundingChunks ?? [];
  const srcs: WebSource[] = [];
  const idxMap = new Map<number, number>();
  chunks.forEach((c, i) => {
    if (!c.web?.uri) return;
    idxMap.set(i, srcs.length + 1);
    srcs.push({ n: srcs.length + 1, uri: c.web.uri, title: c.web.title || new URL(c.web.uri).hostname });
  });
  const bytes = Buffer.from(text, "utf8");
  const inserts = (g?.groundingSupports ?? [])
    .map((s) => ({
      end: s.segment?.endIndex ?? -1,
      tag: [...new Set((s.groundingChunkIndices ?? []).map((i) => idxMap.get(i)).filter(Boolean))]
        .slice(0, 3)
        .map((n) => `[${n}]`)
        .join(""),
    }))
    .filter((x) => x.end > 0 && x.tag)
    .sort((a, b) => b.end - a.end);
  let out = bytes;
  for (const { end, tag } of inserts) {
    out = Buffer.concat([out.subarray(0, end), Buffer.from(tag), out.subarray(end)]);
  }
  return { text: out.toString("utf8"), srcs };
}

const json = (status: number, message: string) =>
  Response.json({ error: message }, { status });

async function searchWeb(ai: GoogleGenAI, messages: Msg[], question: string) {
  const models = (process.env.GEMINI_SEARCH_MODEL || DEFAULT_WEB_MODELS).split(",").map((m) => m.trim()).filter(Boolean);
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  for (const model of models) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [...history, { role: "user", parts: [{ text: question }] }],
        config: {
          systemInstruction: WEB_PROMPT,
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
          maxOutputTokens: 2048,
          abortSignal: AbortSignal.timeout(25_000),
        },
      });
      const text = r.text?.trim();
      const g = r.candidates?.[0]?.groundingMetadata as Grounding | undefined;
      if (!text || !g?.groundingChunks?.length) continue;
      const out = withWebCitations(text, g);
      return {
        text: out.text,
        srcs: out.srcs.map((w) => ({
          n: w.n,
          slug: `web-${w.n}`,
          jenis: "Sumber internet",
          nomor: w.title,
          judul: w.title,
          singkat: w.title,
          web: true,
          halaman: "",
          url: w.uri,
          kutipan: "",
        })),
      };
    } catch (err) {
      console.error("Pencarian internet gagal:", model, String(err).slice(0, 200));
    }
  }
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, "Server belum dikonfigurasi: GEMINI_API_KEY belum diisi.");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "lokal";
  if (limited(ip)) return json(429, "Terlalu banyak pertanyaan. Silakan coba lagi beberapa menit lagi.");

  let messages: Msg[];
  try {
    ({ messages } = await req.json());
    if (!Array.isArray(messages) || !messages.length) throw new Error();
  } catch {
    return json(400, "Format permintaan tidak valid.");
  }
  messages = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  const last = messages.at(-1);
  if (!last || last.role !== "user" || !last.content.trim())
    return json(400, "Pertanyaan kosong.");

  // Pertanyaan lanjutan yang pendek ("kalau untuk balita?") digabung dengan pertanyaan sebelumnya.
  const prevUser = messages.slice(0, -1).filter((m) => m.role === "user").at(-1);
  const query =
    last.content.trim().split(/\s+/).length < 7 && prevUser
      ? `${prevUser.content}\n${last.content}`
      : last.content;

  const { chunks } = await retrieve(query, { apiKey });

  const sources = chunks.map((c, i) => {
    const s = SOURCE_BY_SLUG[c.slug];
    return {
      n: i + 1,
      slug: c.slug,
      jenis: s.jenis,
      nomor: s.nomor,
      judul: s.judul,
      singkat: s.singkat,
      belumBerlaku: !!s.belumBerlaku,
      halaman: pageLabel(c.pageStart, c.pageEnd),
      url: docUrl(s),
      kutipan: c.text.length > 420 ? `${c.text.slice(0, 420).trimEnd()}…` : c.text,
    };
  });

  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  // Beberapa model dicoba berurutan: jika satu sedang penuh (503/429) atau lambat,
  // otomatis pindah ke model berikutnya.
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const contents = [
    ...history,
    {
      role: "user",
      parts: [
        {
          text: `KUTIPAN DOKUMEN:\n\n${chunks.length ? buildContext(chunks) : "(tidak ada kutipan yang relevan)"}\n\n=====\n\nPERTANYAAN: ${last.content}`,
        },
      ],
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sentText = false;
      const send = (obj: { type: string; [k: string]: unknown }) => {
        if (obj.type === "delta") sentText = true;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      send({ type: "sources", sources });
      let lastErr = "";
      try {
        for (const model of models) {
          let started = false;
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), FIRST_TOKEN_TIMEOUT);
          try {
            const res = await ai.models.generateContentStream({
              model,
              contents,
              config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.1,
                maxOutputTokens: 4096,
                abortSignal: abort.signal,
              },
            });
            // Tahan awal jawaban sampai jelas apakah model menjawab "tidak ditemukan".
            // Jika ya, jawaban dokumen tidak dikirim dan pencarian internet dijalankan.
            const probe = NOT_FOUND.slice(0, 40);
            let held = "";
            let decided = !WEB_ON;
            let notFound = false;
            for await (const part of res) {
              const text = part.text;
              if (!text) continue;
              if (!started) {
                started = true;
                clearTimeout(timer);
              }
              if (decided) {
                if (notFound) held += text;
                else send({ type: "delta", text });
                continue;
              }
              held += text;
              const head = held.trimStart();
              if (head.length >= probe.length || !probe.startsWith(head)) {
                decided = true;
                notFound = head.startsWith(probe);
                if (!notFound) send({ type: "delta", text: held });
              }
            }
            clearTimeout(timer);
            if (started && !decided) {
              notFound = held.trimStart().startsWith(probe);
              if (!notFound) send({ type: "delta", text: held });
            }
            if (started && notFound) {
              const searchKey = process.env.GEMINI_SEARCH_API_KEY;
              const web = await searchWeb(searchKey ? new GoogleGenAI({ apiKey: searchKey, apiVersion: "v1beta" }) : ai, messages, last.content);
              if (web) {
                send({ type: "web", sources: web.srcs });
                send({ type: "delta", text: web.text });
              } else {
                send({ type: "delta", text: held });
              }
            }
            if (started) {
              send({ type: "done" });
              return;
            }
            lastErr = `${model}: jawaban kosong`;
          } catch (err) {
            clearTimeout(timer);
            lastErr = `${model}: ${err instanceof Error ? err.message : String(err)}`;
            console.error("Gemini error:", lastErr.slice(0, 300));
            // Jika jawaban sudah separuh terkirim, jangan ulang dengan model lain.
            if (sentText) throw err;
          }
        }
        throw new Error(lastErr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({
          type: "error",
          message: /429|quota|RESOURCE_EXHAUSTED/i.test(msg)
            ? "Kuota layanan AI sedang penuh. Silakan coba lagi sebentar lagi."
            : "Terjadi gangguan saat menghubungi layanan AI. Silakan coba lagi.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
