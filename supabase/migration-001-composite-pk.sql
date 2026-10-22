-- Migración 001: clave primaria compuesta (id, kind) en public.titles.
--
-- Motivo: los TMDB ID de películas y series son espacios distintos. Con
-- `id` como PK, una película y una serie con el mismo número se pisaban en
-- el upsert y una de las dos desaparecía del catálogo.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Si la tabla está vacía
-- o solo tiene una fila por id (lo normal), no hay conflictos.
--
-- Antes de ejecutar, comprueba que no haya duplicados:
--   select id, kind, count(*) from public.titles
--   group by id, kind having count(*) > 1;

begin;

alter table public.titles drop constraint if exists titles_pkey;
alter table public.titles add constraint titles_pkey primary key (id, kind);

-- PostgREST cachea el esquema; esto le pide recargarlo sin reiniciar.
notify pgrst, 'reload schema';

commit;
