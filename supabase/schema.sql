-- ============================================================================
-- 贪吃蛇在线排行榜 · 数据库结构
-- ============================================================================
-- ⚠️ 重要：请为这个游戏单独建一个 Supabase 项目，不要复用教程里「汉堡店」那个。
--    原因：那边已经有一张 public.profiles（字段是 full_name，没有 username），
--    而 create table if not exists 遇到同名表会静默跳过、不检查结构，
--    结果就是这里的建表被跳过，后面的 leaderboard 视图会因为找不到 username 而报错。
--
-- 在 Supabase Dashboard -> SQL Editor 里整段执行即可。
-- 设计思路：
--   1. 账号本身交给 Supabase Auth（auth.users），不自己存密码
--   2. profiles 存「对外展示的身份」——用户名、邮箱、头像
--   3. scores 存「每一局的成绩」——一行一局，方便做历史记录与统计
--   4. leaderboard 视图把「每人最高分」算好并排名，前端直接查
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. profiles：用户资料（与 auth.users 一对一）
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (char_length(username) between 2 and 20),
  email       text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is '用户对外展示的资料，与 auth.users 一对一';
comment on column public.profiles.username is '排行榜显示的名字，全局唯一';
comment on column public.profiles.email is '冗余存储邮箱：anon 角色读不到 auth.users，展示排名时必须靠这份副本';

-- ----------------------------------------------------------------------------
-- 2. scores：每局成绩（与 profiles 一对多）
-- ----------------------------------------------------------------------------
create table if not exists public.scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  score       integer not null check (score >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at  timestamptz not null default now()
);

comment on table public.scores is '每局一条记录，用于排行榜与历史成绩';
comment on column public.scores.score is '本局得分';
comment on column public.scores.duration_ms is '本局时长（毫秒），可用于反作弊参考';

-- 排行榜查询主要按分数倒序，建索引
create index if not exists scores_score_desc_idx on public.scores (score desc);
create index if not exists scores_user_id_idx     on public.scores (user_id);

-- ----------------------------------------------------------------------------
-- 3. 注册时自动建 profile
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  -- 优先用注册时传的 username，没有就用邮箱前缀
  v_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(new.email, '@', 1)
  );

  -- 重名就加随机后缀，避免注册失败
  while exists (select 1 from public.profiles p where p.username = v_username) loop
    v_username := v_username || floor(random() * 900 + 100)::text;
  end loop;

  insert into public.profiles (id, username, email)
  values (new.id, v_username, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. updated_at 自动维护
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. 行级安全（RLS）
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;

-- 资料：所有人可读（排行榜要显示用户名和邮箱），仅本人可改
drop policy if exists "profiles 公开可读" on public.profiles;
create policy "profiles 公开可读"
  on public.profiles for select
  using (true);

drop policy if exists "profiles 仅本人可改" on public.profiles;
create policy "profiles 仅本人可改"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 成绩：所有人可读，仅本人可写、可删
drop policy if exists "scores 公开可读" on public.scores;
create policy "scores 公开可读"
  on public.scores for select
  using (true);

drop policy if exists "scores 仅本人可写" on public.scores;
create policy "scores 仅本人可写"
  on public.scores for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "scores 仅本人可删" on public.scores;
create policy "scores 仅本人可删"
  on public.scores for delete
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 6. leaderboard 视图：每人取最高分并排名
-- ----------------------------------------------------------------------------
drop view if exists public.leaderboard;
create view public.leaderboard
with (security_invoker = true) as
select
  row_number() over (order by best_score desc, last_played_at asc) as rank,
  user_id,
  username,
  email,
  best_score,
  games_played,
  last_played_at
from (
  select
    p.id            as user_id,
    p.username      as username,
    p.email         as email,
    max(s.score)    as best_score,
    count(s.id)     as games_played,
    max(s.created_at) as last_played_at
  from public.profiles p
  join public.scores s on s.user_id = p.id
  group by p.id, p.username, p.email
) t;

comment on view public.leaderboard is '每人最高分排行榜，按分数倒序、同分先达成者靠前';

-- ----------------------------------------------------------------------------
-- 7. 把 scores 加进 Realtime 发布列表
-- ----------------------------------------------------------------------------
-- ⚠️ 不做这一步，前端订阅 postgres_changes 会「静默收不到任何事件」：
--    不报错、不断连，就是永远等不到消息。这是接 Realtime 最容易漏的一步。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'scores'
  ) then
    alter publication supabase_realtime add table public.scores;
  end if;
end $$;

-- ============================================================================
-- 完成。前端查询示例：
--   supabase.from('leaderboard').select('*').limit(20)
--   supabase.from('scores').insert({ user_id, score, duration_ms })
-- ============================================================================
