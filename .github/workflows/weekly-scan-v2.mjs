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

// Fonti autorevoli per categoria — media, account, newsletter
const SOURCES_BY_CATEGORY = {
  musica: {
    media: ['Pitchfork', 'Rolling Stone', 'NME', 'Billboard', 'Resident Advisor', 'The Wire', 'Bandcamp Daily', 'Crack Magazine', 'Rumore', 'XL Repubblica'],
    accounts: ['@pitchfork', '@residentadvisor', '@crackmagazine', '@bandcamp', '@factmag'],
    youtube: ['Pitchfork', 'Boiler Room', 'KEXP', 'NPR Music', 'Colors', 'Cercle', 'The Needle Drop'],
    newsletters: ['Bandcamp Daily', 'The Wire'],
  },
  visual: {
    media: ['Vogue', 'WWD', 'Business of Fashion', 'Wallpaper', 'Dazed', 'i-D', '032c', 'Highsnobiety', 'Vogue Italia', 'System Magazine'],
    accounts: ['@dazed', '@i_d_magazine', '@032c', '@highsnobiety', '@dietprada', '@thefashionlaw', '@eugbrandstrat'],
    youtube: ['Business of Fashion', 'Vogue', 'SydeWayz'],
    newsletters: ['The Sociology of Business (Ana Andjelic)', 'Blackbird Spyplane', '2PM'],
  },
  linguaggio: {
    media: ['The Atlantic', 'New York Magazine', 'Wired', 'Know Your Meme', 'Lercio'],
    accounts: ['@garbageday', '@eugbrandstrat', '@joelmarli'],
    youtube: ['Nerdwriter1', 'Drew Gooden', 'Danny Gonzalez', 'Internet Historian', 'Sarah Z'],
    newsletters: ['Garbage Day (Ryan Broderick)', 'Platformer (Casey Newton)'],
  },
  serie: {
    media: ['Variety', 'Hollywood Reporter', 'IndieWire', 'Letterboxd editorial', 'Reverse Shot', 'Film Comment', 'Little White Lies', 'Cinematografo', 'Filmtv'],
    accounts: ['@indiewire', '@variety', '@a24', '@mubi', '@criterion', '@letterboxd'],
    youtube: ['Nerdwriter1', 'Just Write', 'Like Stories of Old', 'Thomas Flight', 'Tom Nicholas'],
    newsletters: ['Letterboxd', 'Film Comment'],
  },
  libri: {
    media: ['New York Review of Books', 'Times Literary Supplement', 'Literary Hub', 'Electric Literature', 'The Millions', 'Il Libraio', 'Satisfiction', 'Minima&Moralia', 'La Balena Bianca'],
    accounts: ['@literaryhub', '@electricliterature', '@penguinbooks', '@fsgbooks', '@thebookslut'],
    youtube: ['Like Stories of Old', 'Tom Nicholas', 'Merphy Napier', 'Jack Edwards'],
    newsletters: ['Literary Hub', 'The Millions'],
  },
  arte: {
    media: ['Artforum', 'Frieze', 'Dezeen', 'Domus', 'Frame', 'e-flux', 'It's Nice That', 'Eye on Design', 'Artribune', 'Exibart', 'Icon Design'],
    accounts: ['@artforum', '@frieze_magazine', '@dezeen', '@domusweb', '@its_nice_that', '@eflux'],
    youtube: ['The Art Assignment', 'Nerdwriter1', 'Architectural Digest'],
    newsletters: ['e-flux', 'It's Nice That'],
  },
  sociale: {
    media: ['The Guardian', 'Le Monde Diplomatique', 'Al Jazeera', 'Jacobin', 'The Intercept', 'Internazionale', 'openDemocracy', 'Il Manifesto', 'Scomodo'],
    accounts: ['@internazionale', '@jacobinmag', '@theguardian', '@scomodo_it', '@rivistastudio', '@doppiozero'],
    youtube: ['Contrapoints', 'Philosophy Tube', 'Big Joel', 'Tom Nicholas'],
    newsletters: ['Internazionale', 'Jacobin'],
  },
};

// Fonti trasversali — brand strategy & analisi culturale
const CROSS_SOURCES = {
  accounts: ['@eugbrandstrat (Eugene Healey)', '@ashwinn', '@joelmarli', '@teoherzkovich', '@dietprada', '@thefashionlaw', '@scomodo_it', '@rivistastudio'],
  newsletters: ['The Sociology of Business (Ana Andjelic)', 'Garbage Day (Ryan Broderick)', 'Platformer (Casey Newton)', 'Blackbird Spyplane (Jonah Weiner)', '2PM (Web Smith)'],
  youtube: ['Nerdwriter1', 'Tom Nicholas', 'Like Stories of Old', 'Thomas Flight', 'Sarah Z', 'Contrapoints'],
};

async function getCustomSources() {
  // Recupera fonti personalizzate dal database
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/custom_sources?order=created_at.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch(e) {
    return [];
  }
}

function buildSourceContext(catKey) {
  const s = SOURCES_BY_CATEGORY[catKey];
  if (!s) return '';
  const custom = []; // le fonti custom vengono passate separatamente
  return `
Fonti autorevoli da monitorare per questa categoria:
- Media: ${s.media.join(', ')}
- Account social: ${s.accounts.join(', ')}
- YouTube: ${s.youtube.join(', ')}
- Newsletter: ${s.newsletters.join(', ')}
- Analisti trasversali: ${CROSS_SOURCES.accounts.join(', ')}

Usa queste fonti come riferimento prioritario nella tua ricerca. Se trovi segnali su questi canali, citali.`;
}

function buildSocialSourceContext() {
  return `
Fonti e voci autorevoli da monitorare sui social:
- Account analisti: ${CROSS_SOURCES.accounts.join(', ')}
- Newsletter di riferimento: ${CROSS_SOURCES.newsletters.join(', ')}
- YouTube: ${CROSS_SOURCES.youtube.join(', ')}`;
}

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
      max_tokens: 3000,
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

  const sourceContext = buildSourceContext(cat.key);
  const prompt = `Sei un analista culturale esperto di cultura pop contemporanea. Analizza i trend attuali nella categoria "${cat.label}" — sia in Italia che a livello internazionale.

${existingTitles ? `Trend già nel radar: ${existingTitles}` : ''}

${sourceContext}

Cerca segnali specificamente su queste fonti, poi integra con qualsiasi altra fonte rilevante che trovi. Usa anche la tua conoscenza aggiornata del settore quando le fonti web sono limitate.

Restituisci SEMPRE almeno 2-3 trend nuovi. JSON puro:
{
  "nuovi": [
    {
      "titolo": "nome trend 4-6 parole",
      "descrizione": "2-3 frasi osservative concrete — cosa sta succedendo, chi lo guida, perché è culturalmente rilevante",
      "status": "ascesa | evidenza",
      "momentum": "salita | stabile",
      "sources": [{"name": "Nome fonte", "url": "https://url-se-trovato.com"}]
    }
  ],
  "aggiornamenti": [
    {
      "titolo": "titolo esatto trend esistente",
      "momentum": "salita | stabile | discesa",
      "status": "ascesa | evidenza | archivio"
    }
  ]
}

Includi URL reali solo se li hai trovati. Non inventare URL. Restituisci sempre almeno 2 trend nuovi.`;

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

  const socialContext = buildSocialSourceContext();
  const prompt = `Sei un analista culturale esperto di social media e cultura pop. Analizza i trend culturali su ${platform}.

${existingTitles ? `Trend già monitorati su ${platform}: ${existingTitles}` : ''}

${socialContext}

Cerca segnali specificamente da questi analisti e account, poi integra con qualsiasi altro segnale rilevante su ${platform}. Restituisci SEMPRE almeno 2-3 trend nuovi.

JSON puro:
{
  "nuovi": [
    {
      "titolo": "nome trend 4-6 parole",
      "descrizione": "2-3 frasi osservative concrete su cosa sta succedendo su ${platform} e perché è culturalmente rilevante",
      "categoria": "musica | visual | linguaggio | serie | libri | arte | sociale",
      "status": "ascesa | evidenza",
      "momentum": "salita | stabile",
      "sources": [{"name": "Nome fonte o account", "url": "https://url-se-trovato.com"}]
    }
  ],
  "aggiornamenti": [
    {
      "titolo": "titolo esatto trend esistente",
      "momentum": "salita | stabile | discesa",
      "status": "ascesa | evidenza | archivio"
    }
  ]
}

Includi URL reali solo se trovati. Non inventare URL. Restituisci sempre almeno 2 trend nuovi.`;

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
