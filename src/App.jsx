import { useCallback, useEffect, useRef, useState } from 'react';
import Game from './components/Game.jsx';
import AuthPanel from './components/AuthPanel.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import { supabase, isCloudEnabled } from './lib/supabase.js';

const LOCAL_BOARD_KEY = 'snake_local_board';

function readLocalScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeLocalScores(list) {
  try {
    localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* 忽略 */
  }
}

function toRows(scores) {
  return scores
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((s, i) => ({
      rank: i + 1,
      user_id: null,
      username: '本地玩家',
      email: '仅本机',
      best_score: s.score
    }));
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [boardError, setBoardError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [liveNotice, setLiveNotice] = useState('');
  const channelRef = useRef(null);

  const loadProfile = useCallback(async (uid) => {
    if (!supabase || !uid) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, email, avatar_url')
      .eq('id', uid)
      .maybeSingle();
    if (!error) setProfile(data ?? null);
  }, []);

  const loadBoard = useCallback(async () => {
    if (!supabase) {
      setRows(toRows(readLocalScores()));
      return;
    }
    setLoadingBoard(true);
    setBoardError('');
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .order('rank', { ascending: true })
      .limit(20);
    if (error) {
      setBoardError(`${error.message}（是不是还没跑 supabase/schema.sql？）`);
      setRows([]);
    } else {
      setRows(data ?? []);
    }
    setLoadingBoard(false);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setRows(toRows(readLocalScores()));
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });

    // 兜底：邮件里的重置链接会带 type=recovery，直接判断一下
    if (window.location.hash.includes('type=recovery')) setRecovery(true);

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      // 注意：不要在回调里直接 setState 后再调 supabase，用 setTimeout 跳出当前栈
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => setRecovery(true), 0);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadProfile(user?.id);
    loadBoard();
  }, [user, loadProfile, loadBoard]);

  // ---- Realtime：三大能力挂在同一个 channel 上 ----
  useEffect(() => {
    if (!supabase) return undefined;
    const key = user?.id || `guest-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel('snake-lobby', { config: { presence: { key } } });

    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scores' }, () => {
      // ① 数据库变更监听：有人提交成绩，立刻重拉排行榜
      loadBoard();
    })
      .on('presence', { event: 'sync' }, () => {
        // ② 在线状态：当前有多少人在这个 channel 里
        setOnlineCount(Object.keys(ch.presenceState()).length);
      })
      .on('broadcast', { event: 'new-score' }, ({ payload }) => {
        // ③ 广播：不进数据库的即时消息
        if (!payload) return;
        setLiveNotice(`${payload.username || '有人'} 刚拿了 ${payload.score} 分`);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ at: Date.now() });
      });

    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [user, loadBoard]);

  useEffect(() => {
    if (!liveNotice) return undefined;
    const t = setTimeout(() => setLiveNotice(''), 4000);
    return () => clearTimeout(t);
  }, [liveNotice]);

  const signIn = async ({ email, password }) => {
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  };

  const signUp = async ({ email, password, username }) => {
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) {
      setAuthError(error.message);
    } else {
      setNotice('注册成功。若开启了邮箱确认，请先点邮件里的链接再登录。');
    }
    setAuthBusy(false);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setNotice('');
  };

  const oauthSignIn = async (provider) => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      setAuthError(error.message);
      setAuthBusy(false);
    }
    // 成功时整页跳转到 provider 授权页，不会执行到这里
  };

  const forgotPassword = async (email) => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if (error) setAuthError(error.message);
    else setNotice('重置邮件已发送，请查收邮箱（含垃圾箱）');
    setAuthBusy(false);
  };

  const updatePassword = async (password) => {
    if (!supabase) return '未连接 Supabase';
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return error.message;
    setNotice('密码已更新');
    return null;
  };

  const uploadAvatar = async (file) => {
    if (!supabase || !user) return '请先登录';
    if (file.size > 2 * 1024 * 1024) return '图片不能超过 2 MB';

    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${user.id}/avatar.${ext}`;

    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, cacheControl: '60' });
    if (error) return error.message;

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    // 文件名固定，加个版本参数让浏览器不要用旧缓存
    const url = `${data.publicUrl}?v=${Date.now()}`;

    const { error: upErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', user.id);
    if (upErr) return upErr.message;

    await loadProfile(user.id);
    loadBoard();
    setNotice('头像已更新');
    return null;
  };

  const handleGameOver = useCallback(async ({ score, durationMs }) => {
    if (score <= 0) return;

    if (!isCloudEnabled || !user) {
      const next = [...readLocalScores(), { score, at: Date.now() }];
      writeLocalScores(next);
      setRows(toRows(next));
      if (isCloudEnabled && !user) setNotice(`得分 ${score}，登录后即可上榜`);
      return;
    }

    // 走 Edge Function：服务端校验分数与时长是否匹配，再落库
    const { data, error } = await supabase.functions.invoke('submit-score', {
      body: { score, durationMs }
    });

    if (error) {
      let detail = error.message;
      try {
        const body = await error.context?.json?.();
        if (body?.error) detail = body.error;
      } catch {
        /* 拿不到就沿用原始 message */
      }
      setNotice(`成绩未通过校验：${detail}`);
      return;
    }
    if (data?.error) {
      setNotice(`成绩未通过校验：${data.error}`);
      return;
    }

    setNotice(`得分 ${score}，已上传排行榜`);
    loadBoard();
    // 广播给同一房间的其他人（自己也会收到，属于正常）
    channelRef.current?.send({
      type: 'broadcast',
      event: 'new-score',
      payload: { score, username: profile?.username || '有人' }
    });
  }, [user, loadBoard, profile]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          贪吃蛇 <span className="brand-sub">在线排行榜</span>
        </div>
        <div className="topbar-right">
          {isCloudEnabled && <span className="pill online">{onlineCount} 人在线</span>}
          <span className={`pill ${isCloudEnabled ? 'on' : 'off'}`}>
            {isCloudEnabled ? 'Supabase 已连接' : '本地模式'}
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="stage">
          <Game onGameOver={handleGameOver} />
          {notice && <p className="notice">{notice}</p>}
          {liveNotice && <p className="notice live">{liveNotice}</p>}
          <p className="tips">
            方向键 / WASD 控制 · 空格暂停 · 每吃一个 +10 分，速度会越来越快
          </p>
        </section>

        <aside className="side">
          <AuthPanel
            user={user}
            profile={profile}
            cloudEnabled={isCloudEnabled}
            busy={authBusy}
            error={authError}
            onSignIn={signIn}
            onSignUp={signUp}
            onSignOut={signOut}
            onOAuth={oauthSignIn}
            onForgotPassword={forgotPassword}
            onUploadAvatar={uploadAvatar}
          />
          <Leaderboard
            rows={rows}
            loading={loadingBoard}
            error={boardError}
            cloudEnabled={isCloudEnabled}
            currentUserId={user?.id}
          />
        </aside>
      </main>

      {recovery && (
        <div className="modal-backdrop">
          <div className="modal">
            <ResetPassword onSubmit={updatePassword} onDone={() => setRecovery(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
