-- Lead Finder: módulo de prospecção da Central.
-- Mesmo padrão das tabelas existentes: RLS por user_id + política restritiva que exige 2FA (aal2).

create table public.lf_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  max_searches_per_hour int not null default 10 check (max_searches_per_hour between 1 and 30),
  max_results int not null default 100 check (max_results between 10 and 200),
  score_weights jsonb not null default '{"sem_site":30,"problemas_site":25,"presenca_limitada":15,"contato":10,"adequacao":20}'::jsonb,
  google_places_enabled boolean not null default false,
  google_monthly_limit int not null default 0 check (google_monthly_limit >= 0),
  updated_at timestamptz not null default now()
);

create table public.lf_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  params jsonb not null default '{}'::jsonb,
  area_label text,
  status text not null default 'executando' check (status in ('executando','ok','erro','cancelada')),
  found int not null default 0,
  new_count int not null default 0,
  dup_count int not null default 0,
  skipped int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index lf_searches_user_created on public.lf_searches (user_id, created_at desc);

create table public.lf_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  name_norm text not null,
  segment text not null default 'outro',
  category text,
  address text,
  neighborhood text,
  city text,
  state text,
  postcode text,
  lat double precision,
  lon double precision,
  phone text,
  phone_norm text,
  website text,
  domain_norm text,
  instagram text,
  facebook text,
  site_status text not null default 'nao_encontrado_na_fonte' check (site_status in ('nao_encontrado_na_fonte','rede_social','informado')),
  origin text not null,
  first_search_id uuid references public.lf_searches(id) on delete set null,
  status text not null default 'novo' check (status in ('novo','em_analise','pronto_contato','contatado','respondeu','negociacao','proposta_enviada','venda_concluida','perdido','nao_contatar')),
  score int check (score between 0 and 100),
  score_detail jsonb,
  estimated_value numeric(12,2) check (estimated_value >= 0),
  next_action text,
  next_action_at date,
  lost_reason text,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lf_companies_user_status on public.lf_companies (user_id, status);
create index lf_companies_user_phone on public.lf_companies (user_id, phone_norm) where phone_norm is not null;
create index lf_companies_user_domain on public.lf_companies (user_id, domain_norm) where domain_norm is not null;
create index lf_companies_user_name on public.lf_companies (user_id, name_norm);
create index lf_companies_first_search on public.lf_companies (first_search_id);

-- Identificadores externos: de qual fonte veio cada empresa (registro da origem dos dados).
create table public.lf_company_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references public.lf_companies(id) on delete cascade,
  provider text not null,
  external_id text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);
create index lf_company_sources_company on public.lf_company_sources (company_id);

create table public.lf_site_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references public.lf_companies(id) on delete cascade,
  url text not null,
  status text not null default 'ok',
  result jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
create index lf_site_analyses_company on public.lf_site_analyses (company_id, checked_at desc);
create index lf_site_analyses_user on public.lf_site_analyses (user_id);

create table public.lf_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references public.lf_companies(id) on delete cascade,
  score int not null check (score between 0 and 100),
  confidence text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lf_scores_company on public.lf_scores (company_id, created_at desc);
create index lf_scores_user on public.lf_scores (user_id);

-- Histórico do CRM: anotações, contatos, respostas e alterações automáticas.
create table public.lf_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references public.lf_companies(id) on delete cascade,
  kind text not null check (kind in ('nota','contato','resposta','status','alteracao','sistema')),
  body text check (char_length(body) <= 4000),
  meta jsonb not null default '{}'::jsonb,
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index lf_events_company on public.lf_events (company_id, happened_at desc);
create index lf_events_user on public.lf_events (user_id);

create table public.lf_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid references public.lf_companies(id) on delete cascade,
  kind text not null default 'lembrete',
  title text not null,
  due_at timestamptz,
  status text not null default 'pendente' check (status in ('pendente','pausada','concluida','cancelada')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index lf_tasks_user_due on public.lf_tasks (user_id, status, due_at);
create index lf_tasks_company on public.lf_tasks (company_id);

create table public.lf_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope text not null,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lf_errors_user_created on public.lf_errors (user_id, created_at desc);

create table public.lf_api_usage (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  day date not null,
  calls int not null default 0,
  primary key (user_id, provider, day)
);

-- RLS + 2FA em todas
do $$
declare t text;
begin
  foreach t in array array['lf_settings','lf_searches','lf_companies','lf_company_sources','lf_site_analyses','lf_scores','lf_events','lf_tasks','lf_errors','lf_api_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy dono_tudo on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy exige_2fa on public.%I as restrictive for all to authenticated using (((select auth.jwt()) ->> ''aal'') = ''aal2'') with check (((select auth.jwt()) ->> ''aal'') = ''aal2'')', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create trigger lf_companies_updated before update on public.lf_companies for each row execute function public.set_updated_at();
create trigger lf_settings_updated before update on public.lf_settings for each row execute function public.set_updated_at();

-- Histórico de alterações automático (status e campos comerciais).
create or replace function public.lf_log_company_changes() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.lf_events (user_id, company_id, kind, meta) values (new.user_id, new.id, 'status', jsonb_build_object('de', old.status, 'para', new.status, 'motivo', new.lost_reason));
    if new.status = 'contatado' and new.last_contact_at is null then new.last_contact_at := now(); end if;
  end if;
  if new.estimated_value is distinct from old.estimated_value then
    insert into public.lf_events (user_id, company_id, kind, meta) values (new.user_id, new.id, 'alteracao', jsonb_build_object('campo', 'estimated_value', 'de', old.estimated_value, 'para', new.estimated_value));
  end if;
  if new.next_action is distinct from old.next_action or new.next_action_at is distinct from old.next_action_at then
    insert into public.lf_events (user_id, company_id, kind, meta) values (new.user_id, new.id, 'alteracao', jsonb_build_object('campo', 'next_action', 'para', new.next_action, 'data', new.next_action_at));
  end if;
  if new.phone is distinct from old.phone then
    insert into public.lf_events (user_id, company_id, kind, meta) values (new.user_id, new.id, 'alteracao', jsonb_build_object('campo', 'phone', 'de', old.phone, 'para', new.phone));
  end if;
  if new.website is distinct from old.website then
    insert into public.lf_events (user_id, company_id, kind, meta) values (new.user_id, new.id, 'alteracao', jsonb_build_object('campo', 'website', 'de', old.website, 'para', new.website));
  end if;
  return new;
end $$;
create trigger lf_companies_log before update on public.lf_companies for each row execute function public.lf_log_company_changes();

-- Contador de uso por fonte e por dia (controle de cotas).
create or replace function public.lf_count_usage(p_provider text, p_day date, p_calls int) returns void
language sql security invoker set search_path = '' as $$
  insert into public.lf_api_usage (user_id, provider, day, calls) values ((select auth.uid()), p_provider, p_day, greatest(p_calls, 0))
  on conflict (user_id, provider, day) do update set calls = public.lf_api_usage.calls + excluded.calls;
$$;

-- Entrada de empresas com deduplicação.
-- Ordem de correspondência: 1) mesmo identificador na mesma fonte; 2) mesmo telefone (e perto, se houver coordenadas);
-- 3) mesmo domínio + mesmo nome; 4) mesmo nome a menos de ~150 m.
-- Em duplicados, só preenche campos vazios: nunca apaga o que você editou nem mexe no status do CRM.
create or replace function public.lf_ingest(p_search uuid, p_provider text, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  it jsonb;
  v_id uuid;
  v_new int := 0; v_dup int := 0; v_skip int := 0;
  v_lat double precision; v_lon double precision;
  v_name text; v_nn text; v_ph text; v_dom text; v_ext text;
begin
  if v_uid is null then raise exception 'Sem sessão'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Lista inválida'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'Muitos itens de uma vez'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_name := nullif(btrim(it->>'name'), '');
    v_nn := nullif(btrim(it->>'name_norm'), '');
    v_ext := nullif(btrim(it->>'external_id'), '');
    if v_name is null or v_nn is null or v_ext is null then v_skip := v_skip + 1; continue; end if;
    v_ph := nullif(it->>'phone_norm', '');
    v_dom := nullif(it->>'domain_norm', '');
    v_lat := (it->>'lat')::double precision;
    v_lon := (it->>'lon')::double precision;
    v_id := null;

    select s.company_id into v_id from public.lf_company_sources s
      where s.user_id = v_uid and s.provider = p_provider and s.external_id = v_ext;
    if v_id is null and v_ph is not null then
      select c.id into v_id from public.lf_companies c
        where c.user_id = v_uid and c.phone_norm = v_ph
          and (v_lat is null or c.lat is null or (abs(c.lat - v_lat) < 0.03 and abs(c.lon - v_lon) < 0.03))
        order by c.created_at limit 1;
    end if;
    if v_id is null and v_dom is not null then
      select c.id into v_id from public.lf_companies c
        where c.user_id = v_uid and c.domain_norm = v_dom and c.name_norm = v_nn
        order by c.created_at limit 1;
    end if;
    if v_id is null and v_lat is not null then
      select c.id into v_id from public.lf_companies c
        where c.user_id = v_uid and c.name_norm = v_nn and c.lat is not null
          and abs(c.lat - v_lat) < 0.0015 and abs(c.lon - v_lon) < 0.0015
        order by c.created_at limit 1;
    end if;

    if v_id is not null then
      update public.lf_companies c set
        category = coalesce(c.category, it->>'category'),
        address = coalesce(c.address, it->>'address'),
        neighborhood = coalesce(c.neighborhood, it->>'neighborhood'),
        city = coalesce(c.city, it->>'city'),
        state = coalesce(c.state, it->>'state'),
        postcode = coalesce(c.postcode, it->>'postcode'),
        lat = coalesce(c.lat, v_lat), lon = coalesce(c.lon, v_lon),
        phone = case when c.phone_norm is null then it->>'phone' else c.phone end,
        phone_norm = coalesce(c.phone_norm, v_ph),
        website = case when c.domain_norm is null then coalesce(it->>'website', c.website) else c.website end,
        domain_norm = coalesce(c.domain_norm, v_dom),
        instagram = coalesce(c.instagram, it->>'instagram'),
        facebook = coalesce(c.facebook, it->>'facebook'),
        site_status = case
          when coalesce(c.domain_norm, v_dom) is not null then 'informado'
          when coalesce(c.instagram, it->>'instagram', c.facebook, it->>'facebook') is not null then 'rede_social'
          else c.site_status end
      where c.id = v_id;
      insert into public.lf_company_sources (user_id, company_id, provider, external_id, source_url)
        values (v_uid, v_id, p_provider, v_ext, it->>'source_url')
        on conflict (user_id, provider, external_id) do update set fetched_at = now(), source_url = excluded.source_url;
      v_dup := v_dup + 1;
    else
      insert into public.lf_companies (user_id, name, name_norm, segment, category, address, neighborhood, city, state, postcode, lat, lon,
          phone, phone_norm, website, domain_norm, instagram, facebook, site_status, origin, first_search_id)
        values (v_uid, left(v_name, 160), v_nn, coalesce(nullif(it->>'segment', ''), 'outro'), it->>'category', it->>'address', it->>'neighborhood',
          it->>'city', it->>'state', it->>'postcode', v_lat, v_lon, it->>'phone', v_ph, it->>'website', v_dom, it->>'instagram', it->>'facebook',
          coalesce(nullif(it->>'site_status', ''), 'nao_encontrado_na_fonte'), p_provider, p_search)
        returning id into v_id;
      insert into public.lf_company_sources (user_id, company_id, provider, external_id, source_url)
        values (v_uid, v_id, p_provider, v_ext, it->>'source_url');
      v_new := v_new + 1;
    end if;
  end loop;
  return jsonb_build_object('novos', v_new, 'duplicados', v_dup, 'ignorados', v_skip);
end $$;

revoke execute on function public.lf_ingest(uuid, text, jsonb) from public, anon;
revoke execute on function public.lf_count_usage(text, date, int) from public, anon;
revoke execute on function public.lf_log_company_changes() from public, anon, authenticated;
grant execute on function public.lf_ingest(uuid, text, jsonb) to authenticated;
grant execute on function public.lf_count_usage(text, date, int) to authenticated;

-- pg_net: reservado para as automações agendadas da etapa 4.
create extension if not exists pg_net with schema extensions;

-- Abre uma pesquisa conferindo os limites no servidor (nunca pesquisas ilimitadas) e conta o uso da fonte.
create or replace function public.lf_begin_search(p_provider text, p_params jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_max int;
  v_n int;
  v_last timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Sem sessão'; end if;
  if p_provider not in ('osm') then raise exception 'Fonte de dados desconhecida ou desativada.'; end if;
  if jsonb_typeof(p_params) is distinct from 'object' or pg_column_size(p_params) > 2000 then raise exception 'Parâmetros inválidos.'; end if;
  select coalesce((select s.max_searches_per_hour from public.lf_settings s where s.user_id = v_uid), 10) into v_max;
  select count(*), max(created_at) into v_n, v_last from public.lf_searches where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_n >= v_max then raise exception 'Limite de % pesquisas por hora atingido. Tente mais tarde.', v_max; end if;
  if v_last is not null and v_last > now() - interval '8 seconds' then raise exception 'Aguarde alguns segundos entre uma pesquisa e outra.'; end if;
  update public.lf_searches set status = 'cancelada', finished_at = now() where user_id = v_uid and status = 'executando' and created_at < now() - interval '5 minutes';
  insert into public.lf_searches (user_id, provider, params, status) values (v_uid, p_provider, p_params, 'executando') returning id into v_id;
  insert into public.lf_api_usage (user_id, provider, day, calls) values (v_uid, p_provider, current_date, 1)
    on conflict (user_id, provider, day) do update set calls = public.lf_api_usage.calls + 1;
  return v_id;
end $$;
revoke execute on function public.lf_begin_search(text, jsonb) from public, anon;
grant execute on function public.lf_begin_search(text, jsonb) to authenticated;
