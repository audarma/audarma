# Supabase Production Setup

Production setup for the Audarma Supabase database adapter
(`src/adapters/examples/supabase-adapter.ts`). It covers the schema, Row Level
Security (RLS), the role grants Supabase now requires, and which API key to use
on the server vs. the client.

This adapter is a dependency-free reference implementation: it talks to a
minimal structural subset of the `@supabase/supabase-js` query builder. A real
client created with `createClient(url, key)` is structurally compatible and can
be passed directly to `createSupabaseAdapter(...)`.

## 1. Schema

Audarma caches translations in a single `content_translations` table. The
composite primary key `(content_type, content_id, locale)` is what the adapter's
`saveTranslations` upsert conflicts on (`onConflict: 'content_type,content_id,locale'`).

```sql
CREATE TABLE content_translations (
  content_type    TEXT        NOT NULL,   -- 'product_title', 'message', etc.
  content_id      TEXT        NOT NULL,   -- product id, message id, etc.
  locale          TEXT        NOT NULL,   -- 'es', 'fr', 'ru', etc.
  original_text   TEXT        NOT NULL,
  translated_text TEXT        NOT NULL,
  source_hash     TEXT        NOT NULL,   -- SHA-256 (hex) of original text
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (content_type, content_id, locale)
);

-- Lookup path used by getCachedTranslations (filters by content_id, then
-- narrows on content_type + locale).
CREATE INDEX idx_content_lookup
  ON content_translations (content_type, content_id, locale);

-- Supports per-locale scans / purges (e.g. deleteTranslations by locale only).
CREATE INDEX idx_locale
  ON content_translations (locale);
```

## 2. Row Level Security

Enable RLS on the table. With RLS on and no policy, every request is denied, so
the policies below are required for the adapter to function:

- Reads are public (the lazy/lookup path runs in the browser with the anon key).
- Writes (insert / update / delete) are restricted to the `service_role`, so
  only server-side code holding the service-role key can populate or purge the
  cache.

```sql
ALTER TABLE content_translations ENABLE ROW LEVEL SECURITY;

-- Public read: anon + authenticated may SELECT cached translations.
CREATE POLICY "content_translations_public_read"
  ON content_translations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Service-role writes only. The service_role key bypasses RLS, but adding an
-- explicit policy documents intent and survives any future "force RLS" setting.
CREATE POLICY "content_translations_service_write"
  ON content_translations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Notes:

- The `service_role` bypasses RLS by default; the explicit `FOR ALL` policy is
  belt-and-suspenders and keeps writes working if `FORCE ROW LEVEL SECURITY`
  is ever enabled on the table.
- No insert/update/delete policy is granted to `anon` or `authenticated`, so a
  leaked anon key cannot mutate the cache.

## 3. Role grants

Recent Supabase projects require explicit table-level `GRANT`s in addition to
RLS policies (RLS filters rows; grants gate the privilege itself). Grant read to
the public roles and write to the service role:

```sql
-- Public read.
GRANT SELECT ON content_translations TO anon, authenticated;

-- Server-side write (population by the CLI / saveTranslations, purges by
-- deleteTranslations).
GRANT INSERT, UPDATE, DELETE ON content_translations TO service_role;

-- service_role typically already has full access; this is explicit and safe.
GRANT SELECT ON content_translations TO service_role;
```

If your project uses a sequence or other owned objects for this table, grant on
those too. The schema above uses no sequence (text PK), so table grants suffice.

## 4. Which key to use where

The adapter writes (`saveTranslations`, `deleteTranslations`) only succeed for
`service_role`. Choose the key by where the code runs:

| Context | Key | Why |
|---|---|---|
| Server (CLI `audarma translate`, server actions, API routes, cron) | **Service role key** (`SUPABASE_SERVICE_ROLE_KEY`) | Bypasses RLS so it can insert/update/delete cache rows and read everything for discovery. |
| Browser / client component (lazy lookup) | **Anon (publishable) key** | Public-read policy lets it `SELECT` cached translations; it has no write privilege. |

```ts
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdapter } from 'audarma/adapters/examples/supabase-adapter';

// SERVER ONLY — never ship the service-role key to the browser.
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const adapter = createSupabaseAdapter(supabase);
```

Security warnings:

- **Never expose the service-role key client-side.** It bypasses RLS entirely.
  Keep it in a server-only environment variable (no `NEXT_PUBLIC_` prefix).
- The anon key is safe to ship to the browser; the read-only RLS policy above is
  what constrains it.

## 5. What the adapter does against this schema

| Method | SQL effect |
|---|---|
| `getCachedTranslations(items, locale)` | `SELECT content_type, content_id, locale, translated_text, source_hash` filtered by `content_id IN (...)`, then narrowed in memory to the exact `(content_type, content_id)` pairs and `locale`. |
| `saveTranslations(rows)` | `UPSERT` on `content_translations` with `onConflict = content_type,content_id,locale` (deduplicated by that key first). |
| `deleteTranslations(filter)` | `DELETE` with one `.eq()` per provided field (`contentType -> content_type`, `contentId -> content_id`, `locale`). Omitted fields are unconstrained; `{}` deletes ALL rows — guard against accidental full purges. |
| `getAllTranslatableContent(sources)` | For each source item, `SELECT idColumn, textColumn` from the source table with optional `where` filters applied as `.eq()`, mapped to `{ contentType, contentId, text }`. Used by the CLI batch translator. |
