import Chat from "@/components/Chat";
import { SOURCES, docUrl } from "@/lib/sources";

const UPDATED = "16 November 2026";

function Emblem() {
  return (
    <svg className="emblem" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="var(--navy-800)" />
      <circle cx="32" cy="32" r="26.5" fill="none" stroke="var(--gold-500)" strokeWidth="1.6" />
      <path d="M16 23c6.5-2.6 12-1.8 16 1.8v20.4c-4-3.4-9.5-4.2-16-1.8z" fill="var(--gold-500)" />
      <path d="M48 23c-6.5-2.6-12-1.8-16 1.8v20.4c4-3.4 9.5-4.2 16-1.8z" fill="#fff" />
    </svg>
  );
}

export default function Home() {
  const grouped = SOURCES.reduce<Record<string, typeof SOURCES>>((acc, s) => {
    const key = s.jenis.startsWith("Surat Edaran")
      ? "Surat Edaran"
      : /^(juknis|pedoman)/.test(s.slug)
        ? "Petunjuk Teknis & Pedoman"
        : "Keputusan";
    (acc[key] ??= []).push(s);
    return acc;
  }, {});

  return (
    <>
      <div className="topbar">
        <div className="wrap topbar-inner">
          <span>Layanan Rujukan Program Makan Bergizi Gratis</span>
          <span className="topbar-meta">
            {SOURCES.length} dokumen rujukan · diperbarui {UPDATED}
          </span>
        </div>
      </div>

      <header className="masthead">
        <div className="wrap masthead-inner">
          <a href="#" className="brand">
            <Emblem />
            <span>
              <strong>Tanya Koordinator BGN</strong>
              <small>Rujukan Surat Edaran &amp; Petunjuk Teknis</small>
            </span>
          </a>
          <nav className="mainnav" aria-label="Navigasi utama">
            <a href="#tanya">Tanya</a>
            <a href="#dokumen">Dokumen Rujukan</a>
            <a href="#cara">Cara Pakai</a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <p className="crumbs">
            Beranda <span>/</span> Layanan <span>/</span> Tanya Koordinator
          </p>
          <h1>Tanya jawab Surat Edaran dan Juknis MBG</h1>
          <p className="lead">
            Ajukan pertanyaan seputar pelaksanaan Program Makan Bergizi Gratis. Jawaban disusun
            hanya dari dokumen resmi yang terdaftar, dan setiap jawaban menyebutkan dokumen serta
            halaman yang menjadi dasarnya.
          </p>
        </div>
      </section>

      <main className="wrap layout" id="tanya">
        <Chat />

        <aside className="side">
          <section className="panel" id="dokumen">
            <h2 className="panel-title">Dokumen Rujukan</h2>
            {Object.entries(grouped).map(([group, list]) => (
              <div key={group} className="doc-group">
                <h3>{group}</h3>
                <ol className="doclist">
                  {list.map((s) => (
                    <li key={s.slug}>
                      <a href={docUrl(s)} target="_blank" rel="noopener noreferrer">
                        <span className="doc-no">
                          {s.nomor.startsWith("Tahun")
                            ? `${s.jenis} ${s.nomor.replace("Tahun ", "")}`
                            : `${s.jenis.replace(" Kepala BGN", "")} No. ${s.nomor}`}
                        </span>
                        <span className="doc-title">{s.judul}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>

          <section className="panel notice" id="cara">
            <h2 className="panel-title">Cara Pakai</h2>
            <ol className="steps">
              <li>Tulis pertanyaan dengan kalimat biasa, misalnya “Bagaimana pembagian MBG saat libur sekolah?”.</li>
              <li>Periksa nomor rujukan di dalam jawaban, lalu buka dokumennya bila perlu.</li>
              <li>Jika jawabannya tidak ada di dokumen, layanan ini akan menyampaikannya dan tidak menebak.</li>
            </ol>
            <p className="fineprint">
              Layanan ini alat bantu, bukan pengganti dokumen resmi. Untuk keputusan operasional,
              pastikan kembali dengan naskah asli dan arahan KPPG.
            </p>
          </section>
        </aside>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div>
            <div className="footer-brand">
              <Emblem />
              <strong>Tanya Koordinator BGN</strong>
            </div>
            <p>
              Alat bantu rujukan bagi koordinator dan pelaksana Program Makan Bergizi Gratis. Bukan
              kanal resmi Badan Gizi Nasional.
            </p>
          </div>
          <div>
            <h4>Sumber Resmi</h4>
            <ul>
              <li>
                <a href="https://www.bgn.go.id" target="_blank" rel="noopener noreferrer">
                  Situs Badan Gizi Nasional
                </a>
              </li>
              <li>
                <a href="https://www.bgn.go.id/juknis" target="_blank" rel="noopener noreferrer">
                  Halaman Juknis BGN
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Catatan</h4>
            <p>
              Jawaban dibuat otomatis oleh model AI dari dokumen yang terdaftar dan dapat keliru.
              Selalu periksa naskah asli melalui tautan rujukan.
            </p>
          </div>
        </div>
        <div className="wrap footer-base">© 2026 Tanya Koordinator BGN</div>
      </footer>
    </>
  );
}
