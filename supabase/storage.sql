-- ============================================================================
-- 头像上传：对象存储 bucket + 策略 + 排行榜视图补字段
-- ============================================================================
-- 在 SQL Editor 里整段执行即可，可重复运行。
--
-- 设计说明：
--   1. bucket 设为 public —— 头像本来就是公开信息，读的时候不需要签名 URL
--   2. 写入策略限制「只能写自己 id 目录下的文件」，靠路径第一段 = auth.uid()
--   3. 数据库里只存 URL，文件本体在 storage.objects 里（不占 Postgres 行空间）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 创建 bucket（已存在则只更新公开设置）
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 2. storage.objects 的行级安全策略
-- ----------------------------------------------------------------------------
-- 读：public bucket 通过 /object/public/ 直接对外提供文件，读的时候根本不走
--     storage.objects 的 RLS，所以这里「不需要」SELECT 策略。
--     反过来，如果加一条宽泛的 SELECT 策略，客户端就能把整个桶的文件列表
--     list 出来（Supabase 会在 Storage 页面弹黄色警告提示这一点）。
--     所以这里是把历史遗留的读策略删掉，而不是新建。
drop policy if exists "avatars 公开可读" on storage.objects;

-- 写：只能写 avatars/<自己的 uid>/xxx
drop policy if exists "avatars 本人可上传" on storage.objects;
create policy "avatars 本人可上传"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars 本人可覆盖" on storage.objects;
create policy "avatars 本人可覆盖"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars 本人可删除" on storage.objects;
create policy "avatars 本人可删除"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 3. 排行榜视图补上 avatar_url
-- ----------------------------------------------------------------------------
drop view if exists public.leaderboard;
create view public.leaderboard
with (security_invoker = true) as
select
  row_number() over (order by best_score desc, last_played_at asc) as rank,
  user_id,
  username,
  email,
  avatar_url,
  best_score,
  games_played,
  last_played_at
from (
  select
    p.id              as user_id,
    p.username        as username,
    p.email           as email,
    p.avatar_url      as avatar_url,
    max(s.score)      as best_score,
    count(s.id)       as games_played,
    max(s.created_at) as last_played_at
  from public.profiles p
  join public.scores s on s.user_id = p.id
  group by p.id, p.username, p.email, p.avatar_url
) t;

comment on view public.leaderboard is '每人最高分排行榜，含头像 URL';

-- ============================================================================
-- 完成。前端用法：
--   supabase.storage.from('avatars').upload(`${uid}/avatar.png`, file, { upsert: true })
--   supabase.storage.from('avatars').getPublicUrl(`${uid}/avatar.png`)
-- ============================================================================
