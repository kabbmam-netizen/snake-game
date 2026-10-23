import { useCallback, useEffect, useRef, useState } from 'react';

const COLS = 20;
const ROWS = 20;
const CELL = 22;
const W = COLS * CELL;
const H = ROWS * CELL;
const START_SPEED = 150;
const MIN_SPEED = 65;
const SPEED_STEP = 5;

const VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

const KEY_MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right'
};

function randomFood(snake, avoid) {
  const used = new Set(snake.map((s) => `${s.x},${s.y}`));
  // 避免新食物刷在旧位置上，否则看起来像"没刷新"
  if (avoid) used.add(`${avoid.x},${avoid.y}`);
  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!used.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) {
    // 极端情况：除旧位置外已无空格，退回旧位置
    return avoid ? { x: avoid.x, y: avoid.y } : null;
  }
  return free[Math.floor(Math.random() * free.length)];
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default function Game({ onGameOver }) {
  const canvasRef = useRef(null);
  const snakeRef = useRef([{ x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }]);
  const dirRef = useRef(VECTORS.right);
  const pendingRef = useRef([]);
  const foodRef = useRef(null);
  const scoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const statusRef = useRef('idle');

  const [status, setStatus] = useState('idle');
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');
  const [best, setBest] = useState(() => {
    try {
      return Number(localStorage.getItem('snake_best') || 0);
    } catch {
      return 0;
    }
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0e1524';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, H);
      ctx.stroke();
    }
    for (let i = 1; i < ROWS; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(W, i * CELL);
      ctx.stroke();
    }

    const food = foodRef.current;
    if (food) {
      const cx = food.x * CELL + CELL / 2;
      const cy = food.y * CELL + CELL / 2;
      // 呼吸动画：让食物在静止的棋盘上"活着"，不容易被忽略
      const pulse = 1 + 0.14 * Math.sin(performance.now() / 260);

      // 外圈光环
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.44 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(242, 181, 68, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 本体（带发光）
      ctx.save();
      ctx.shadowColor = 'rgba(242, 181, 68, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.32 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = '#f7c65a';
      ctx.fill();
      ctx.restore();

      // 高光
      ctx.beginPath();
      ctx.arc(cx - CELL * 0.1, cy - CELL * 0.12, CELL * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
    }

    const snake = snakeRef.current;
    snake.forEach((seg, i) => {
      const isHead = i === 0;
      const pad = isHead ? 1 : 2.5;
      const alpha = isHead ? 1 : Math.max(0.32, 0.92 - i * 0.035);
      ctx.fillStyle = isHead ? '#4ade80' : `rgba(74, 222, 128, ${alpha})`;
      roundRect(ctx, seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, isHead ? 7 : 5);
      ctx.fill();
    });

    const head = snake[0];
    if (head) {
      const cx = head.x * CELL + CELL / 2;
      const cy = head.y * CELL + CELL / 2;
      const d = dirRef.current;
      const fx = d.x * 3;
      const fy = d.y * 3;
      const px = d.y !== 0 ? 3.5 : 0;
      const py = d.x !== 0 ? 3.5 : 0;
      ctx.fillStyle = '#0b1220';
      ctx.beginPath();
      ctx.arc(cx + fx + px, cy + fy + py, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + fx - px, cy + fy - py, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endGame = useCallback((reason) => {
    stopTimer();
    statusRef.current = 'over';
    setStatus('over');
    setMessage(reason);

    const finalScore = scoreRef.current;
    setBest((prev) => {
      const next = Math.max(prev, finalScore);
      try {
        localStorage.setItem('snake_best', String(next));
      } catch {
        /* 忽略隐私模式下的写入失败 */
      }
      return next;
    });

    if (onGameOver) {
      onGameOver({
        score: finalScore,
        durationMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0
      });
    }
  }, [onGameOver, stopTimer]);

  const step = useCallback(() => {
    if (statusRef.current !== 'running') return;

    while (pendingRef.current.length) {
      const next = pendingRef.current.shift();
      const cur = dirRef.current;
      if (next.x === -cur.x && next.y === -cur.y) continue;
      if (next.x === cur.x && next.y === cur.y) continue;
      dirRef.current = next;
      break;
    }

    const snake = snakeRef.current;
    // 防御：运行中食物不该为空，万一丢了立刻补一个
    if (!foodRef.current) foodRef.current = randomFood(snake, null);
    const dir = dirRef.current;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      endGame('撞到墙了');
      return;
    }

    const willEat = foodRef.current && head.x === foodRef.current.x && head.y === foodRef.current.y;
    const bodyToCheck = willEat ? snake : snake.slice(0, -1);
    if (bodyToCheck.some((s) => s.x === head.x && s.y === head.y)) {
      endGame('咬到自己了');
      return;
    }

    snake.unshift(head);
    if (willEat) {
      scoreRef.current += 10;
      setScore(scoreRef.current);
      const prevFood = foodRef.current;
      foodRef.current = randomFood(snake, prevFood);
      if (!foodRef.current) {
        endGame('满屏通关');
        return;
      }
    } else {
      snake.pop();
    }

    draw();

    const speed = Math.max(MIN_SPEED, START_SPEED - Math.floor(scoreRef.current / 10) * SPEED_STEP);
    timerRef.current = setTimeout(step, speed);
  }, [draw, endGame]);

  const start = useCallback(() => {
    stopTimer();
    snakeRef.current = [{ x: 6, y: 10 }, { x: 5, y: 10 }, { x: 4, y: 10 }];
    dirRef.current = VECTORS.right;
    pendingRef.current = [];
    scoreRef.current = 0;
    setScore(0);
    setMessage('');
    foodRef.current = randomFood(snakeRef.current, null);
    startedAtRef.current = Date.now();
    statusRef.current = 'running';
    setStatus('running');
    draw();
    timerRef.current = setTimeout(step, START_SPEED);
  }, [draw, step, stopTimer]);

  const togglePause = useCallback(() => {
    if (statusRef.current === 'running') {
      stopTimer();
      statusRef.current = 'paused';
      setStatus('paused');
      return;
    }
    if (statusRef.current === 'paused') {
      statusRef.current = 'running';
      setStatus('running');
      const speed = Math.max(MIN_SPEED, START_SPEED - Math.floor(scoreRef.current / 10) * SPEED_STEP);
      timerRef.current = setTimeout(step, speed);
    }
  }, [step, stopTimer]);

  const steer = useCallback((name) => {
    if (statusRef.current === 'idle' || statusRef.current === 'over') {
      start();
    }
    if (statusRef.current === 'running' && pendingRef.current.length < 3) {
      pendingRef.current.push(VECTORS[name]);
    }
  }, [start]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // 按设备像素比放大位图，避免 CSS 拉伸导致画面发虚
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    foodRef.current = randomFood(snakeRef.current, null);
    draw();
    return stopTimer;
  }, [draw, stopTimer]);

  // 持续重绘：食物做呼吸动画，也保证画面永远跟状态同步
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    const onKey = (e) => {
      const dirName = KEY_MAP[e.key];
      if (dirName) {
        e.preventDefault();
        steer(dirName);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (statusRef.current === 'idle' || statusRef.current === 'over') start();
        else togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, steer, togglePause]);

  return (
    <div className="game">
      <div className="hud">
        <div className="hud-cell">
          <span className="hud-label">本局得分</span>
          <span className="hud-value">{score}</span>
        </div>
        <div className="hud-cell">
          <span className="hud-label">本地最高</span>
          <span className="hud-value muted">{best}</span>
        </div>
        <div className="hud-cell">
          <span className="hud-label">速度</span>
          <span className="hud-value muted">
            {Math.min(10, 1 + Math.floor(score / 10))}
          </span>
        </div>
      </div>

      <div className="canvas-wrap">
        <canvas ref={canvasRef} className="game-canvas" />
        {status !== 'running' && (
          <div className="overlay">
            {status === 'idle' && (
              <>
                <h2>准备好了吗</h2>
                <p>方向键或 WASD 控制，空格暂停</p>
                <button type="button" className="btn primary" onClick={start}>开始游戏</button>
              </>
            )}
            {status === 'paused' && (
              <>
                <h2>已暂停</h2>
                <p>按空格或点下面继续</p>
                <button type="button" className="btn primary" onClick={togglePause}>继续</button>
              </>
            )}
            {status === 'over' && (
              <>
                <h2>{message}</h2>
                <p>本局得分 {score}</p>
                <button type="button" className="btn primary" onClick={start}>再来一局</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="dpad">
        <button type="button" className="dpad-btn up" onClick={() => steer('up')} aria-label="上">↑</button>
        <button type="button" className="dpad-btn left" onClick={() => steer('left')} aria-label="左">←</button>
        <button type="button" className="dpad-btn pause" onClick={() => (statusRef.current === 'running' || statusRef.current === 'paused' ? togglePause() : start())} aria-label="暂停">Ⅱ</button>
        <button type="button" className="dpad-btn right" onClick={() => steer('right')} aria-label="右">→</button>
        <button type="button" className="dpad-btn down" onClick={() => steer('down')} aria-label="下">↓</button>
      </div>
    </div>
  );
}
