// weekly-scan-v2.mjs
// Radar Culturale — scansione settimanale con logica classifica
// Ogni lunedì: aggiorna trend esistenti + cerca nuovi segnali emergenti

import fetch from 'node-fetch';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const CATEGORIES = [
  { key: 'musica',     label: 'Musica e audio' },
  { key: 'visual',     label: 'Visual e moda' },
  { key: 'linguaggio', label: 'Linguaggio e meme' },
  { key: 'serie',      label: 'Serie e cinema' },
  { key: 'libri',      label: 'Libri e narrativa' },
  { key: 'arte',       label: 'Arte e design' },
  { key: 'sociale',    label: 'Movimenti sociali' },
];

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube'];

// ── Anthropic ─────────────────────────────────────────────
async function callAnthropic(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Supabase ──────────────────────────────────────────────
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ── Scan categoria ────────────────────────────────────────
async function scanCategory(cat) {
  console.log(`  Scansione: ${cat.label}`);

  // Recupera trend esistenti attivi per questa categoria
  const existing = await sbFetch(
    `trends?category=eq.${cat.key}&status=in.(ascesa,evidenza)&select=id,title,status,update_count`
  );
  const existingTitles = existing.map(t => t.title).join(', ');

  const prompt = `Sei un analista culturale con accesso al web. Analizza i trend attuali nella categoria "${cat.label}".

${existingTitles ? `Trend già monitorati: ${existingTitles}` : ''}

Cerca e restituisci:
1. Trend NUOVI emergenti (non presenti nella lista sopra) — massimo 3
2. Aggiornamenti sui trend esistenti (sono cresciuti, calati, o stabili?) — solo quelli che conosci

Restituisci solo JSON puro:
{
  "nuovi": [
    {
      "titolo": "nome trend 4-6 parole",
      "descrizione": "2-3 frasi osservative concrete su cosa sta succedendo e perché è rilevante",
      "status": "ascesa",
      "momentum": "salita",
      "sources": [{"name": "Nome fonte", "url": "https://url-reale.com"}]
    }
  ],
  "aggiornamenti": [
    {
      "titolo": "titolo esatto del trend esistente",
      "momentum": "salita | stabile | discesa",
      "status": "ascesa | evidenza | archivio",
      "nota": "una frase su cosa è cambiato"
    }
  ]
}

Per momentum: "salita" = sta crescendo, "stabile" = mantiene posizione, "discesa" = sta calando.
Per status: "ascesa" = emerso di recente, "evidenza" = al picco/consolidato, "archivio" = in declino.
Solo URL reali trovati durante la ricerca.`;

  try {
    const text = await callAnthropic(prompt);
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) { console.log(`    Nessun JSON per ${cat.label}`); return; }
    const result = JSON.parse(match[0]);

    // Inserisci nuovi trend
    if (result.nuovi && result.nuovi.length) {
      const rows = result.nuovi.map(t => ({
        category: cat.key,
        platform: null,
        title: t.titolo,
        description: t.descrizione,
        status: t.status || 'ascesa',
        momentum: t.momentum || 'salita',
        sources: JSON.stringify((t.sources || []).filter(s => s.url && s.url !== 'https://url-reale.com')),
        source: 'auto-scan',
        first_seen_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      }));
      await sbFetch('trends', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(rows)
      });
      console.log(`    ${rows.length} nuovi trend aggiunti`);
    }

    // Aggiorna trend esistenti
    if (result.aggiornamenti && result.aggiornamenti.length) {
      for (const upd of result.aggiornamenti) {
        const match = existing.find(e =>
          e.title.toLowerCase().includes(upd.titolo.toLowerCase().substring(0, 15))
        );
        if (!match) continue;

        const newStatus = upd.status || match.status;
        const updateData = {
          momentum: upd.momentum || 'stabile',
          status: newStatus,
          last_updated_at: new Date().toISOString(),
          update_count: (match.update_count || 1) + 1,
        };
        if (newStatus === 'archivio' && match.status !== 'archivio') {
          updateData.archived_at = new Date().toISOString();
        }

        await sbFetch(`trends?id=eq.${match.id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify(updateData)
        });
      }
      console.log(`    ${result.aggiornamenti.length} trend aggiornati`);
    }

  } catch(e) {
    console.error(`    Errore ${cat.label}:`, e.message);
  }
}

// ── Scan social ───────────────────────────────────────────
async function scanSocialPlatform(platform) {
  console.log(`  Social: ${platform}`);

  const existing = await sbFetch(
    `trends?platform=eq.${platform}&status=in.(ascesa,evidenza)&select=id,title,status,update_count`
  );
  const existingTitles = existing.map(t => t.title).join(', ');

  const prompt = `Sei un analista culturale. Ricerca i trend culturali recenti su ${platform}.

${existingTitles ? `Trend già monitorati su ${platform}: ${existingTitles}` : ''}

Restituisci solo JSON puro:
{
  "nuovi": [
    {
      "titolo": "nome trend 4-6 parole",
      "descrizione": "2-3 frasi osservative su cosa sta succedendo su ${platform}",
      "categoria": "musica | visual | linguaggio | serie | libri | arte | sociale",
      "status": "ascesa | evidenza",
      "momentum": "salita | stabile",
      "sources": [{"name": "Nome fonte", "url": "https://url-reale.com"}]
    }
  ],
  "aggiornamenti": [
    {
      "titolo": "titolo esatto trend esistente",
      "momentum": "salita | stabile | discesa",
      "status": "ascesa | evidenza | archivio"
    }
  ]
}`;

  try {
    const text = await callAnthropic(prompt);
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!match) return;
    const result = JSON.parse(match[0]);

    if (result.nuovi && result.nuovi.length) {
      const rows = result.nuovi.map(t => ({
        category: t.categoria || 'sociale',
        platform: platform,
        title: t.titolo,
        description: t.descrizione,
        status: t.status || 'ascesa',
        momentum: t.momentum || 'salita',
        sources: JSON.stringify((t.sources || []).filter(s => s.url && s.url !== 'https://url-reale.com')),
        source: platform,
        first_seen_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      }));
      await sbFetch('trends', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(rows)
      });
      console.log(`    ${rows.length} nuovi trend ${platform}`);
    }

    if (result.aggiornamenti && result.aggiornamenti.length) {
      for (const upd of result.aggiornamenti) {
        const match = existing.find(e =>
          e.title.toLowerCase().includes(upd.titolo.toLowerCase().substring(0, 15))
        );
        if (!match) continue;
        await sbFetch(`trends?id=eq.${match.id}`, {
          method: 'PATCH',
          headers: { 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            momentum: upd.momentum || 'stabile',
            status: upd.status || match.status,
            last_updated_at: new Date().toISOString(),
            update_count: (match.update_count || 1) + 1,
          })
        });
      }
    }
  } catch(e) {
    console.error(`    Errore ${platform}:`, e.message);
  }
}

// ── Genera lettura ────────────────────────────────────────
async function generateReading() {
  console.log('  Generazione lettura mensile...');
  const now = new Date();
  const periodKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const trends = await sbFetch('trends?status=in.(ascesa,evidenza)&order=last_updated_at.desc&limit=20&select=category,title,description,status,momentum');
  if (!trends.length) return;

  const lines = trends.map(t => `[${t.category}|${t.status}|${t.momentum}] ${t.title} — ${t.description}`).join('\n');

  const prompt = `Sei una consulente strategica che osserva la cultura contemporanea. Questi sono i trend culturali attivi in questo momento:\n\n${lines}\n\nScrivi una lettura culturale (250-320 parole) che nomini quello che sta succedendo — senza spiegare, senza insegnare. Privilegia i trend in salita e quelli in evidenza. Stile osservatorio, denso, punto di vista preciso. Inizia con il segnale più interessante. Prosa continua, nessun elenco.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    await sbFetch('readings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ period_key: periodKey, content: text, updated_at: new Date().toISOString() })
    });
    console.log(`    Lettura ${periodKey} salvata`);
  } catch(e) {
    console.error('    Errore lettura:', e.message);
  }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const now = new Date();
  console.log(`\nRadar Culturale v2 — Scansione ${now.toLocaleDateString('it-IT')}`);
  console.log('='.repeat(60));

  console.log('\n[1/3] Categorie culturali...');
  for (const cat of CATEGORIES) {
    await scanCategory(cat);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n[2/3] Piattaforme social...');
  for (const platform of PLATFORMS) {
    await scanSocialPlatform(platform);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n[3/3] Lettura periodica...');
  await generateReading();

  console.log('\nScansione completata.');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
