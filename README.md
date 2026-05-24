# Radar Culturale

Dashboard per il monitoraggio settimanale automatico dei trend nella cultura pop.

## Struttura

```
radar-culturale/
├── radar-culturale.html        ← la dashboard (pubblica su Netlify)
├── schema.sql                  ← schema del database Supabase
├── package.json
├── scripts/
│   └── weekly-scan.mjs         ← script di scansione automatica
└── .github/
    └── workflows/
        └── weekly-scan.yml     ← automazione GitHub Actions
```

## Setup (una volta sola)

### 1. Supabase — crea le tabelle

Vai su Supabase → SQL Editor → incolla tutto il contenuto di `schema.sql` → Run.

### 2. GitHub — crea il repository

1. Vai su github.com → New repository → nome: `radar-culturale`
2. Carica tutti i file di questa cartella
3. Vai su Settings → Secrets and variables → Actions → New repository secret
4. Aggiungi questi tre secret:
   - `ANTHROPIC_API_KEY` → la tua API key da console.anthropic.com
   - `SUPABASE_URL` → https://fekigyjxbsmifanoaljd.supabase.co
   - `SUPABASE_ANON_KEY` → la anon key di Supabase

### 3. Netlify — pubblica la dashboard

1. Vai su netlify.com → Sites → trascina `radar-culturale.html`
2. Fatto. La dashboard è online.

## Come funziona

- **Ogni lunedì alle 07:00** GitHub Actions lancia `weekly-scan.mjs`
- Lo script chiama l'API Anthropic con web search per 6 categorie + 3 piattaforme social
- I trend vengono salvati su Supabase
- Viene generata automaticamente la lettura settimanale
- Quando apri la dashboard, legge i dati da Supabase e li mostra

## Avvio manuale

Puoi avviare la scansione in qualsiasi momento:
GitHub → repository → Actions → "Radar Culturale — Scansione Settimanale" → Run workflow

## Aggiornamenti futuri

Per aggiungere funzionalità alla dashboard: modifica `radar-culturale.html` e ricaricalo su Netlify (drag & drop). I dati su Supabase restano intatti.
