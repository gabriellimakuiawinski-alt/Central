-- Central — fase 2: mensalidades, checklist de entrega, meta, horas, lembretes, monitor de sites,
-- lead que vira cliente e backup no Google Drive.
-- Mesmo padrão das outras tabelas: RLS por user_id + política restritiva que exige 2FA (aal2).

-- projetos: mensalidade, checklist e origem (lead)
alter table public.projects
  add column if not exists monthly_fee numeric check (monthly_fee is null or monthly_fee >= 0),
  add column if not exists monthly_day smallint check (monthly_day is null or monthly_day between 1 and 28),
  add column if not exists monthly_start date,
  add column if not exists monthly_end date,
  add column if not exists checklist jsonb not null default '{}'::jsonb,
  add column if not exists lead_id uuid references public.lf_companies(id) on delete set null;
create index if not exists projects_lead_id_idx on public.projects(lead_id);

alter table public.clients
  add column if not exists lead_id uuid references public.lf_companies(id) on delete set null;
create index if not exists clients_lead_id_idx on public.clients(lead_id);

-- pagamentos: tipo "mensalidade" com o mês de referência (uma por projeto e mês)
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind = any (array['entrada','saldo','extra','mensalidade']));
alter table public.payments add column if not exists ref_month date;
create unique index if not exists payments_mensalidade_unica on public.payments(project_id, kind, ref_month);

-- ajustes
alter table public.app_settings
  add column if not exists monthly_goal numeric check (monthly_goal is null or monthly_goal >= 0),
  add column if not exists pix_city text check (pix_city is null or char_length(pix_city) <= 40),
  add column if not exists checklist_template jsonb,
  add column if not exists drive_client_id text check (drive_client_id is null or char_length(drive_client_id) <= 200),
  add column if not exists drive_folder_id text check (drive_folder_id is null or char_length(drive_folder_id) <= 200),
  add column if not exists drive_last_backup timestamptz;

-- horas trabalhadas por projeto
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  minutes integer not null check (minutes between 1 and 1440),
  worked_on date not null default current_date,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists time_entries_user_idx on public.time_entries(user_id);
create index if not exists time_entries_project_idx on public.time_entries(project_id);

-- lembretes (follow-up de cliente, projeto ou lead)
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  due_on date not null,
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  company_id uuid references public.lf_companies(id) on delete cascade,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_user_idx on public.reminders(user_id);
create index if not exists reminders_client_idx on public.reminders(client_id);
create index if not exists reminders_project_idx on public.reminders(project_id);
create index if not exists reminders_company_idx on public.reminders(company_id);
drop trigger if exists reminders_updated_at on public.reminders;
create trigger reminders_updated_at before update on public.reminders for each row execute function public.set_updated_at();

-- monitor dos sites dos clientes (gravado pela Edge Function site-check com a sessão do usuário)
create table if not exists public.site_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  url text not null check (char_length(url) <= 300),
  ok boolean not null,
  status integer,
  ms integer,
  https boolean,
  final_url text check (final_url is null or char_length(final_url) <= 300),
  domain_expires date,
  error text check (error is null or char_length(error) <= 300),
  checked_at timestamptz not null default now()
);
create index if not exists site_checks_user_idx on public.site_checks(user_id);
create index if not exists site_checks_project_idx on public.site_checks(project_id, checked_at desc);

do $$
declare t text;
begin
  foreach t in array array['time_entries','reminders','site_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dono_tudo on public.%I', t);
    execute format('drop policy if exists exige_2fa on public.%I', t);
    execute format('create policy dono_tudo on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy exige_2fa on public.%I as restrictive for all to authenticated using (((select auth.jwt()) ->> ''aal'') = ''aal2'') with check (((select auth.jwt()) ->> ''aal'') = ''aal2'')', t);
  end loop;
end $$;
