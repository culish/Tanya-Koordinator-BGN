import { GoogleGenAI } from "@google/genai";
import { retrieve } from "@/lib/retrieve";
import { SYSTEM_PROMPT, buildContext } from "@/lib/prompt";
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

const json = (status: number, message: string) =>
  Response.json({ error: message }, { status });

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
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
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
            for await (const part of res) {
              const text = part.text;
              if (!text) continue;
              if (!started) {
                started = true;
                clearTimeout(timer);
              }
              send({ type: "delta", text });
            }
            clearTimeout(timer);
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
            if (started) throw err;
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
