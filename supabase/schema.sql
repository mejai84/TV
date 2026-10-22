-- Esquema de la base de datos (Supabase / Postgres) para el índice de
-- contenido. Ejecutar en el "SQL Editor" de Supabase una sola vez.
--
-- Importante: aquí NO se guardan enlaces (playUrl/directUrl). Solo metadatos
-- para poder cachear el catálogo y detectar novedades. Los enlaces son de un
-- solo uso y caducan a los 5 minutos; pedirlos al reproducir.

create table if not exists public.titles (
  id               text not null,             -- tmdbId (películas/series) o slug
  kind             text not null,             -- 'movie' | 'series'
  title            text not null default '',
  original_title   text default '',
  slug             text default '',
  tmdb_id          text default '',
  year             text default '',
  poster           text default '',
  rating           text default '',
  genres           text default '',
  description      text default '',
  source           text default '',
  last_resolved_at timestamptz,               -- cuándo lo resolvió NasriPlay
  first_seen_at    timestamptz not null default now(),  -- cuándo lo detectamos
  is_new           boolean not null default true,
  -- TMDB usa espacios de ID distintos para películas y series: el ID 550
  -- puede ser una película y una serie a la vez. La clave debe ser compuesta.
  primary key (id, kind)
);

create index if not exists titles_kind_idx         on public.titles (kind);
create index if not exists titles_first_seen_idx   on public.titles (first_seen_at desc);
create index if not exists titles_is_new_idx       on public.titles (is_new);

-- Lectura pública solo si quisieras exponerla; el acceso real es server-side
-- con la service key. Descomenta si quieres leer desde el navegador con la
-- anon key:
-- alter table public.titles enable row level security;
-- create policy "lectura publica" on public.titles for select using (true);
