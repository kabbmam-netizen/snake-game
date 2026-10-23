import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * 没有配置环境变量时返回 null，游戏会自动降级为「本地模式」：
 * 不登录、不联网，成绩只存在 localStorage 里。
 */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const isCloudEnabled = Boolean(supabase);
