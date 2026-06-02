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

const SOURCES = {
  musica: 'Pitchfork, Rolling Stone, Resident Advisor, The Wire, Bandcamp Daily, Crack Magazine, Rumore, Boiler Room, KEXP, Colors, The Needle Drop',
  visual: 'Business of Fashion, Dazed, i-D Magazine, 032c, Highsnobiety, Vogue Italia, @dietprada, @thefashionlaw, @eugbrandstrat',
  linguaggio: 'The Atlantic, Wired, Know Your Meme, Garbage Day newsletter, Nerdwriter1, Internet Historian, Sarah Z',
  serie: 'IndieWire, Variety, Letterboxd, Film Comment, Little White Lies, Thomas Flight, Just Write, Like Stories of Old',
  libri: 'Literary Hub, Electric Literature, The Millions, Il Libraio, La Balena Bianca, Satisfiction, Tom Nicholas',
  arte: 'Artforum, Frieze, Dezeen, Domus, e-flux, Artribune, Exibart, The Art Assignment',
  sociale: 'Internazionale, Le Monde Diplomatique, Jacobin, openDemocracy, Scomodo, @rivistastudio, Contrapoints',
};

const CROSS_SOURCES = '@eugbrandstrat, Ana Andjelic Sociology of Business, @ashwinn, @joelmarli, @teoherzkovich, Garbage Day, Platformer, Blackbird Spyplane, 2PM newsletter';

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
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function sbPost(table, rows) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbGet(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbPatch(path, data) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
}

function parseJSON(text) {
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch(e) {} }
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch(e) {} }
  return null;
}

function cleanSources(sources) {
  if (!sources || !Array.isArray(sources)) return '[]';
  const valid = sources.filter(s => s && s.url && s.url !== 'https://url-reale.com' && !s.url.includes('url-se-'));
  return JSON.stringify(valid);
}

async function scanCategory(cat) {
  console.log('  ' + cat.label);
  const catSources = SOURCES[cat.key] || '';
  
  let existing = [];
  try {
    existing = await sbGet('trends?category=eq.' + cat.key + '&status=in.(ascesa,evidenza)&select=id,title,status,update_count');
  } catch(e) { console.log('    warning: ' + e.message); }
  
  const existingTitles = existing.map(t => t.title).join(', ');

  const prompt = 'Sei un analista culturale. Analizza i trend attuali nella categoria "' + cat.label + '" - cultura pop italiana e internazionale.\n\n' +
    'Fonti prioritarie da consultare: ' + catSources + '\n' +
    'Analisti trasversali: ' + CROSS_SOURCES + '\n\n' +
    (existingTitles ? 'Trend gia nel radar: ' + existingTitles + '\n\n' : '') +
    'Restituisci SOLO questo JSON, nessun testo fuori:\n' +
    '{"nuovi":[{"titolo":"4-6 parole","descrizione":"2-3 frasi osservative","status":"ascesa","momentum":"salita","sources":[{"name":"fonte","url":"https://url"}]}],"aggiornamenti":[{"titolo":"titolo esatto","momentum":"salita|stabile|discesa","status":"ascesa|evidenza|archivio"}]}\n\n' +
    'Restituisci sempre almeno 2 trend nuovi. Sources opzionali, solo URL reali.';

  try {
    const text = await callAnthropic(prompt);
    const result = parseJSON(text);
    if (!result || !result.nuovi) { console.log('    no JSON'); return; }

    if (result.nuovi.length) {
      const rows = result.nuovi.map(t => ({
        category: cat.key,
        platform: null,
        title: t.titolo,
        description: t.descrizione,
        status: t.status || 'ascesa',
        momentum: t.momentum || 'salita',
        sources: cleanSources(t.sources),
        source: 'auto-scan',
        first_seen_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      }));
      await sbPost('trends', rows);
      console.log('    +' + rows.length + ' trend');
    }

    if (result.aggiornamenti && result.aggiornamenti.length) {
      for (const upd of result.aggiornamenti) {
        const match = existing.find(e => e.title.toLowerCase().includes(upd.titolo.toLowerCase().substring(0, 12)));
        if (!match) continue;
        await sbPatch('trends?id=eq.' + match.id, {
          momentum: upd.momentum || 'stabile',
          status: upd.status || match.status,
          last_updated_at: new Date().toISOString(),
          update_count: (match.update_count || 1) + 1,
        });
      }
      console.log('    aggiornati: ' + result.aggiornamenti.length);
    }
  } catch(e) {
    console.error('    errore: ' + e.message);
  }
}

async function scanPlatform(platform) {
  console.log('  ' + platform);
  
  let existing = [];
  try {
    existing = await sbGet('trends?platform=eq.' + platform + '&status=in.(ascesa,evidenza)&select=id,title,status,update_count');
  } catch(e) {}

  const existingTitles = existing.map(t => t.title).join(', ');

  const prompt = 'Sei un analista culturale. Analizza i trend su ' + platform + '.\n' +
    'Account analisti da seguire: ' + CROSS_SOURCES + '\n\n' +
    (existingTitles ? 'Gia monitorati: ' + existingTitles + '\n\n' : '') +
    'Restituisci SOLO questo JSON:\n' +
    '{"nuovi":[{"titolo":"4-6 parole","descrizione":"2-3 frasi","categoria":"musica|visual|linguaggio|serie|libri|arte|sociale","status":"ascesa","momentum":"salita","sources":[{"name":"fonte","url":"https://url"}]}],"aggiornamenti":[{"titolo":"titolo esatto","momentum":"salita|stabile|discesa","status":"ascesa|evidenza|archivio"}]}\n\n' +
    'Almeno 2 trend nuovi. Sources opzionali, solo URL reali.';

  try {
    const text = await callAnthropic(prompt);
    const result = parseJSON(text);
    if (!result || !result.nuovi) return;

    if (result.nuovi.length) {
      const rows = result.nuovi.map(t => ({
        category: t.categoria || 'sociale',
        platform: platform,
        title: t.titolo,
        description: t.descrizione,
        status: t.status || 'ascesa',
        momentum: t.momentum || 'salita',
        sources: cleanSources(t.sources),
        source: platform,
        first_seen_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      }));
      await sbPost('trends', rows);
      console.log('    +' + rows.length + ' trend');
    }

    if (result.aggiornamenti && result.aggiornamenti.length) {
      for (const upd of result.aggiornamenti) {
        const match = existing.find(e => e.title.toLowerCase().includes(upd.titolo.toLowerCase().substring(0, 12)));
        if (!match) continue;
        await sbPatch('trends?id=eq.' + match.id, {
          momentum: upd.momentum || 'stabile',
          status: upd.status || match.status,
          last_updated_at: new Date().toISOString(),
          update_count: (match.update_count || 1) + 1,
        });
      }
    }
  } catch(e) {
    console.error('    errore: ' + e.message);
  }
}

async function generateReading() {
  console.log('  Lettura...');
  const now = new Date();
  const periodKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  let trends = [];
  try {
    trends = await sbGet('trends?status=in.(ascesa,evidenza)&order=last_updated_at.desc&limit=20&select=category,title,description,status,momentum');
  } catch(e) { return; }
  
  if (!trends.length) return;

  const lines = trends.map(t => '[' + t.category + '|' + t.status + '|' + t.momentum + '] ' + t.title + ' - ' + t.description).join('\n');
  const prompt = 'Sei una consulente strategica che osserva la cultura contemporanea. Trend attivi:\n\n' + lines + '\n\nScrivi una lettura culturale (250-320 parole) che nomini quello che sta succedendo, senza spiegare o insegnare. Stile osservatorio, denso, punto di vista preciso. Inizia con il segnale piu interessante. Prosa continua, nessun elenco.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    const readRes = await fetch(SUPABASE_URL + '/rest/v1/readings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ period_key: periodKey, content: text, updated_at: new Date().toISOString() })
    });
    if (!readRes.ok) console.log('    warning lettura: ' + await readRes.text());
    else console.log('    lettura salvata per ' + periodKey);
  } catch(e) {
    console.error('    errore lettura: ' + e.message);
  }
}

async function main() {
  console.log('Radar Culturale - Scansione ' + new Date().toLocaleDateString('it-IT'));
  console.log('----------------------------------------');

  console.log('[1/3] Categorie...');
  for (const cat of CATEGORIES) {
    await scanCategory(cat);
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('[2/3] Social...');
  for (const p of PLATFORMS) {
    await scanPlatform(p);
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('[3/3] Lettura...');
  await generateReading();

  console.log('Fatto.');
}

main().catch(e => { console.error('Errore fatale:', e.message); process.exit(1); });
