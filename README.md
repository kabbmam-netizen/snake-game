# 贪吃蛇 · 在线排行榜

React + Vite + Supabase 实现的贪吃蛇，带账号登录和在线排行榜。

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:5173 即可玩。**不配 Supabase 也能玩** —— 会进入「本地模式」，成绩只存在浏览器 localStorage 里。

## 接入在线排行榜

### 1. 建表

在 Supabase Dashboard → SQL Editor 里执行 `supabase/schema.sql` 全文。

会创建：

| 对象 | 作用 |
| --- | --- |
| `profiles` | 用户资料（用户名、邮箱），与 `auth.users` 一对一 |
| `scores` | 每局成绩，一行一局 |
| `leaderboard`（视图） | 每人最高分 + 排名，前端直接查 |
| 触发器 | 注册时自动建 profile |

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

填两个值（Dashboard → Project Settings → API）：

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

重启 `npm run dev`。

### 3. 关掉邮箱确认（本地开发）

Dashboard → Authentication → Sign In / Providers → 取消 **Confirm email**。
否则注册后收不到确认邮件就登不进去。

## 项目结构

```
src/
  components/
    Game.jsx          画布渲染 + 游戏循环 + 键盘/触控
    AuthPanel.jsx     登录 / 注册 / 退出
    Leaderboard.jsx   排行榜列表
  lib/
    supabase.js       客户端单例；没配环境变量时为 null
  App.jsx             组装、会话管理、成绩上报
supabase/
  schema.sql          表结构 + RLS + 排行榜视图 + Realtime 发布
  storage.sql         头像 bucket + 存储策略 + 视图补 avatar_url
  functions/
    submit-score/     Edge Function：服务端校验并写入成绩
```

## 玩法

- 方向键 或 WASD 控制方向
- 空格暂停 / 继续
- 每吃一个食物 +10 分，速度随分数递增
- 撞墙或咬到自己结束，结束后自动上报成绩

## 已知取舍

- 成绩走 Edge Function `submit-score` 做服务端校验（分数必须是 10 的倍数、≤5000、时长与分数匹配），能挡住「F12 改个数字直接提交」这类伪造。但仍挡不住「把游戏速度调慢、慢慢刷分」—— 真正的强校验需要服务端回放操作序列，成本高得多，这个 demo 没做。
- `profiles.email` 是从 `auth.users` 冗余过来的副本，因为 anon 角色读不到 `auth.users`，而排行榜需要展示邮箱。
- 头像用 `storage.upload()` 一次性上传（≤2 MB）。如果要传大文件，应换成 TUS 断点续传（见 `@uppy/tus`）。
