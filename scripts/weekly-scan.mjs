// weekly-scan.mjs
// Radar Culturale — scansione settimanale automatica
// Gira ogni lunedì via GitHub Actions

import fetch from 'node-fetch';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Calcola la chiave settimana corrente
function getWeekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

function getWeekLabel() {
  const d = new Date();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay()+6)%7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = dt => dt.toLocaleDateString('it-IT',{day:'numeric',month:'long'});
  return `${fmt(mon)} – ${fmt(sun)}`;
}

const CATEGORIES = [
  { key: 'musica',     label: 'Musica e audio' },
  { key: 'visual',     label: 'Visual e moda' },
  { key: 'linguaggio', label: 'Linguaggio e meme' },
  { key: 'serie',      label: 'Serie, film, libri' },
  { key: 'arte',       label: 'Arte e design' },
  { key: 'sociale',    label: 'Movimenti sociali' },
];

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube'];

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
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function supabaseInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase insert error (${table}): ${err}`);
  }
}

async function scanCategory(cat, weekKey) {
  console.log(`  Scansione categoria: ${cat.label}`);
  const prompt = `Sei un analista culturale. Ricerca i 4 trend più rilevanti e recenti (ultimi 30 giorni) nella categoria "${cat.label}" nella cultura pop italiana e internazionale.

Restituisci solo JSON puro, nessun testo fuori:
[
  {
    "titolo": "nome del trend in 4-6 parole",
    "descrizione": "2-3 frasi osservative e concrete su cosa sta succedendo e perché è rilevante",
    "intensità": "emergente | in crescita | al picco"
  }
]`;

  try {
    const text = await callAnthropic(prompt);
    const match = text.replace(/```json|```/g,'').match(/\[[\s\S]*\]/);
    if (!match) { console.log(`    Nessun JSON trovato per ${cat.label}`); return; }
    const trends = JSON.parse(match[0]);
    const rows = trends.map(t => ({
      week_key: weekKey,
      category: cat.key,
      platform: null,
      title: t.titolo,
      description: t.descrizione,
      intensity: t.intensità,
      source: 'auto-scan'
    }));
    await supabaseInsert('weekly_trends', rows);
    console.log(`    Salvati ${rows.length} trend per ${cat.label}`);
  } catch(e) {
    console.error(`    Errore ${cat.label}:`, e.message);
  }
}

async function scanSocialPlatform(platform, weekKey) {
  console.log(`  Scansione social: ${platform}`);
  const prompt = `Sei un analista culturale. Ricerca i 3 trend culturali più rilevanti e recenti (ultimi 30 giorni) su ${platform} — musica, moda, linguaggio, serie/film, arte, movimenti sociali.

Restituisci solo JSON puro:
[
  {
    "titolo": "nome del trend in 4-6 parole",
    "descrizione": "2-3 frasi osservative su cosa sta succedendo su ${platform} e perché è interessante",
    "categoria": "una tra: musica, visual, linguaggio, serie, arte, sociale",
    "intensità": "emergente | in crescita | al picco"
  }
]`;

  try {
    const text = await callAnthropic(prompt);
    const match = text.replace(/```json|```/g,'').match(/\[[\s\S]*\]/);
    if (!match) { console.log(`    Nessun JSON trovato per ${platform}`); return; }
    const trends = JSON.parse(match[0]);
    const rows = trends.map(t => ({
      week_key: weekKey,
      category: t.categoria || 'sociale',
      platform: platform,
      title: t.titolo,
      description: t.descrizione,
      intensity: t.intensità,
      source: platform
    }));
    await supabaseInsert('weekly_trends', rows);
    console.log(`    Salvati ${rows.length} trend per ${platform}`);
  } catch(e) {
    console.error(`    Errore ${platform}:`, e.message);
  }
}

async function generateWeeklySynthesis(weekKey, weekLabel) {
  console.log('  Generazione lettura settimanale...');

  // Recupera i trend appena salvati
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/weekly_trends?week_key=eq.${weekKey}&select=category,title,description`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  const trends = await res.json();
  if (!trends.length) { console.log('    Nessun trend trovato per la sintesi'); return; }

  const signals = trends.map(t => `[${t.category}] ${t.title} — ${t.description}`).join('\n');
  const prompt = `Sei una consulente strategica che osserva la cultura contemporanea. Segnali della settimana del ${weekLabel}:\n\n${signals}\n\nScrivi una lettura culturale breve (200-280 parole) che nomini quello che sta succedendo — senza spiegare, senza insegnare, senza motivare. Stile: osservatorio, denso, punto di vista preciso. Inizia con il segnale più interessante. Prosa continua, nessun elenco.`;

  try {
    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res2.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // Upsert della sintesi
    await fetch(`${SUPABASE_URL}/rest/v1/weekly_syntheses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ week_key: weekKey, content: text, updated_at: new Date().toISOString() })
    });
    console.log('    Lettura settimanale salvata');
  } catch(e) {
    console.error('    Errore sintesi:', e.message);
  }
}

async function main() {
  const weekKey = getWeekKey();
  const weekLabel = getWeekLabel();
  console.log(`\nRadar Culturale — Scansione settimana ${weekKey} (${weekLabel})`);
  console.log('='.repeat(60));

  console.log('\n[1/3] Scansione categorie culturali...');
  for (const cat of CATEGORIES) {
    await scanCategory(cat, weekKey);
    await new Promise(r => setTimeout(r, 2000)); // pausa tra chiamate
  }

  console.log('\n[2/3] Scansione piattaforme social...');
  for (const platform of PLATFORMS) {
    await scanSocialPlatform(platform, weekKey);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n[3/3] Generazione lettura settimanale...');
  await generateWeeklySynthesis(weekKey, weekLabel);

  console.log('\nScansione completata.');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
