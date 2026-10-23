import { useState } from 'react';

export default function ResetPassword({ onSubmit, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    const msg = await onSubmit(password);
    setBusy(false);
    if (msg) setError(msg);
    else setDone(true);
  };

  if (done) {
    return (
      <div className="reset">
        <h2>密码已更新</h2>
        <p className="hint">下次登录请使用新密码，当前会话保持登录状态。</p>
        <button type="button" className="btn primary" onClick={onDone}>
          回到游戏
        </button>
      </div>
    );
  }

  return (
    <form className="reset" onSubmit={submit}>
      <h2>设置新密码</h2>
      <p className="hint">你正在通过邮件里的重置链接修改密码。</p>
      <label>
        新密码
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
          minLength={6}
          required
        />
      </label>
      <label>
        确认新密码
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="再输一次"
          minLength={6}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? '提交中…' : '确认修改'}
      </button>
      <button type="button" className="btn ghost" onClick={onDone} disabled={busy}>
        先不改了
      </button>
    </form>
  );
}
