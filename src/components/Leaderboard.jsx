export default function Leaderboard({ rows, loading, error, cloudEnabled, currentUserId }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>在线排行榜</h3>
        <span className="badge">{cloudEnabled ? 'Supabase' : '本地'}</span>
      </div>

      {loading && <p className="hint">加载中…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p className="hint">还没有成绩，玩一局就能上榜。</p>
      )}

      {rows.length > 0 && (
        <ol className="rank-list">
          {rows.map((row) => (
            <li
              key={row.user_id || `local-${row.rank}`}
              className={row.user_id && row.user_id === currentUserId ? 'rank-row me' : 'rank-row'}
            >
              <span className={`rank-no rank-${row.rank}`}>{row.rank}</span>
              <span className="rank-avatar">
                {row.avatar_url ? (
                  <img src={row.avatar_url} alt="" />
                ) : (
                  <span className="rank-initial">{(row.username || '?').slice(0, 1).toUpperCase()}</span>
                )}
              </span>
              <span className="rank-main">
                <span className="rank-name">{row.username}</span>
                <span className="rank-mail">{row.email}</span>
              </span>
              <span className="rank-score">{row.best_score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
