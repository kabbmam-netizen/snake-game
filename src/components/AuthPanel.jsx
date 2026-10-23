import { useState } from 'react';

export default function AuthPanel({
  user,
  profile,
  cloudEnabled,
  busy,
  error,
  onSignIn,
  onSignUp,
  onSignOut,
  onOAuth,
  onForgotPassword,
  onUploadAvatar
}) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const pickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    const msg = await onUploadAvatar(file);
    setUploading(false);
    if (msg) setUploadError(msg);
    e.target.value = '';
  };

  if (!cloudEnabled) {
    return (
      <section className="panel">
        <h3>未连接 Supabase</h3>
        <p className="hint">
          当前是本地模式：游戏可以正常玩，成绩只存在浏览器里。
          想启用登录和在线排行榜，把 <code>.env.example</code> 复制成 <code>.env.local</code> 并填好两个变量，然后重启。
        </p>
      </section>
    );
  }

  if (user) {
    const initial = (profile?.username || user.email || '?').slice(0, 1).toUpperCase();
    return (
      <section className="panel">
        <h3>已登录</h3>
        <div className="identity">
          {profile?.avatar_url ? (
            <img className="avatar avatar-img" src={profile.avatar_url} alt="头像" />
          ) : (
            <div className="avatar">{initial}</div>
          )}
          <div>
            <div className="identity-name">{profile?.username || '（未建资料）'}</div>
            <div className="identity-mail">{profile?.email || user.email}</div>
          </div>
        </div>

        <label className="btn ghost upload-btn">
          {uploading ? '上传中…' : profile?.avatar_url ? '更换头像' : '上传头像'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={pickFile}
            disabled={uploading}
            hidden
          />
        </label>

        {uploadError && <p className="error">{uploadError}</p>}

        <button type="button" className="btn ghost" onClick={onSignOut} disabled={busy}>
          退出登录
        </button>
      </section>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'signin') onSignIn({ email, password });
    else if (mode === 'signup') onSignUp({ email, password, username });
    else onForgotPassword(email);
  };

  if (mode === 'forgot') {
    return (
      <section className="panel">
        <h3>找回密码</h3>
        <p className="hint">输入注册邮箱，我们会发一封带重置链接的邮件。</p>
        <form className="form" onSubmit={submit}>
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? '发送中…' : '发送重置邮件'}
          </button>
          <button type="button" className="btn ghost" onClick={() => setMode('signin')} disabled={busy}>
            返回登录
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="tabs">
        <button
          type="button"
          className={mode === 'signin' ? 'tab active' : 'tab'}
          onClick={() => setMode('signin')}
        >
          登录
        </button>
        <button
          type="button"
          className={mode === 'signup' ? 'tab active' : 'tab'}
          onClick={() => setMode('signup')}
        >
          注册
        </button>
      </div>

      <div className="oauth">
        <button type="button" className="btn oauth-btn" onClick={() => onOAuth('google')} disabled={busy}>
          <span className="oauth-mark">G</span>
          继续使用 Google
        </button>
        <button type="button" className="btn oauth-btn" onClick={() => onOAuth('github')} disabled={busy}>
          <span className="oauth-mark">◉</span>
          继续使用 GitHub
        </button>
      </div>

      <div className="divider"><span>或使用邮箱</span></div>

      <form className="form" onSubmit={submit}>
        {mode === 'signup' && (
          <label>
            用户名
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="排行榜显示的名字"
              minLength={2}
              maxLength={20}
              required
            />
          </label>
        )}
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            minLength={6}
            required
          />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册并登录'}
        </button>
      </form>

      {mode === 'signin' && (
        <button type="button" className="link-btn" onClick={() => setMode('forgot')}>
          忘记密码？
        </button>
      )}

      {error && <p className="error">{error}</p>}
      {mode === 'signup' && <p className="hint">注册后如需邮箱确认，请先点邮件里的链接再登录。</p>}
    </section>
  );
}
