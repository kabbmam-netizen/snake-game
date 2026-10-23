// ============================================================================
// Edge Function: submit-score
// ============================================================================
// 作用：服务端校验并写入成绩，替代前端直接 insert。
// 部署：Supabase Dashboard -> Edge Functions -> Create -> 名称填 submit-score
//       把本文件全文粘进去 -> Deploy
//
// 前端调用：
//   await supabase.functions.invoke('submit-score', {
//     body: { score, durationMs }
//   })
//
// 注意：这个函数用「调用者的 JWT」建客户端，所以 RLS 依然生效
//      （scores 的 INSERT 策略要求 auth.uid() = user_id），
//      它只是多做了一层业务校验，不是绕过安全机制。
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ error: '只接受 POST' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: '缺少 Authorization 头，请先登录' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  // 1. 确认调用者身份
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return json({ error: '登录状态无效' }, 401);
  }
  const user = userData.user;

  // 2. 解析参数
  let payload: { score?: unknown; durationMs?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }

  const score = Number(payload.score);
  const durationMs = Number(payload.durationMs);

  // 3. 业务校验
  if (!Number.isInteger(score) || score < 0) {
    return json({ error: '分数必须是非负整数' }, 400);
  }
  if (score % 10 !== 0) {
    return json({ error: '分数必须是 10 的倍数（每吃一个 +10）' }, 400);
  }
  if (score > 5000) {
    return json({ error: '分数超出棋盘理论上限' }, 400);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return json({ error: '时长不合法' }, 400);
  }
  if (durationMs > 3 * 60 * 60 * 1000) {
    return json({ error: '单局时长超过 3 小时' }, 400);
  }

  // 每吃一个 +10 分，游戏最快 65ms 走一步，所以吃一个至少也要 65ms 左右
  const minDuration = (score / 10) * 60;
  if (durationMs < minDuration) {
    return json(
      {
        error: '分数与时长不匹配，疑似作弊',
        score,
        durationMs,
        minDuration
      },
      422
    );
  }

  // 4. 写入（RLS 仍会校验 user_id = auth.uid()）
  const { data: row, error: insErr } = await supabase
    .from('scores')
    .insert({ user_id: user.id, score, duration_ms: Math.round(durationMs) })
    .select('id, score, created_at')
    .single();

  if (insErr) {
    return json({ error: insErr.message }, 400);
  }

  return json({ ok: true, score: row.score, id: row.id });
});
