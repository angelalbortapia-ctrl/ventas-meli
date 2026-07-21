-- Ventas Meli — schema de sync (ejecutar en Supabase SQL Editor)
-- Project Settings → API: copia Project URL y anon public key a Ajustes de la app.

create table if not exists public.ventas_meli_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lotes jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ventas_meli_state enable row level security;

drop policy if exists "own state select" on public.ventas_meli_state;
drop policy if exists "own state insert" on public.ventas_meli_state;
drop policy if exists "own state update" on public.ventas_meli_state;
drop policy if exists "own state delete" on public.ventas_meli_state;

create policy "own state select" on public.ventas_meli_state
  for select using (auth.uid() = user_id);

create policy "own state insert" on public.ventas_meli_state
  for insert with check (auth.uid() = user_id);

create policy "own state update" on public.ventas_meli_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own state delete" on public.ventas_meli_state
  for delete using (auth.uid() = user_id);

-- Realtime: cambios llegan al iPhone / otra pestaña al instante
do $$
begin
  alter publication supabase_realtime add table public.ventas_meli_state;
exception
  when duplicate_object then null;
end $$;

-- Auth: en Authentication → Providers deja Email habilitado.
-- En Authentication → URL Configuration añade la URL donde hospedes la PWA
-- (ej. https://tu-usuario.github.io/ventas-meli/).
