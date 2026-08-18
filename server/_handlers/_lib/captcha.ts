import { Errors } from './error';

// 服务端算术验证码：答案仅存服务端内存，一次性使用，TTL 5 分钟
// 注意：serverless 冷启动会清空内存，前端登录时若提示过期则重新获取题目即可
interface CaptchaEntry {
  answer: number;
  expiresAt: number;
}
const captchaMap = new Map<string, CaptchaEntry>();
const CAPTCHA_TTL_MS = 5 * 60 * 1000;

// 登录失败锁定：按账号维度，连续 5 次失败锁定 15 分钟
interface FailEntry {
  fails: number;
  lockedUntil: number;
}
const failMap = new Map<string, FailEntry>();
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60 * 1000;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface CaptchaChallenge {
  captchaId: string;
  a: number;
  b: number;
  op: '+' | '-' | '*';
}

export function createCaptcha(): CaptchaChallenge {
  const now = Date.now();
  for (const [id, e] of captchaMap) {
    if (e.expiresAt <= now) captchaMap.delete(id);
  }
  const ops: Array<'+' | '-' | '*'> = ['+', '-', '*'];
  const op = ops[randomInt(0, 2)];
  let a = 0;
  let b = 0;
  if (op === '+') {
    a = randomInt(1, 20);
    b = randomInt(1, 20);
  } else if (op === '-') {
    a = randomInt(10, 30);
    b = randomInt(1, a);
  } else {
    a = randomInt(2, 9);
    b = randomInt(2, 9);
  }
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  const captchaId = 'c' + now.toString(36) + Math.random().toString(36).slice(2, 10);
  captchaMap.set(captchaId, { answer, expiresAt: now + CAPTCHA_TTL_MS });
  return { captchaId, a, b, op };
}

export function verifyCaptcha(captchaId: string, answer: number): boolean {
  if (!captchaId) return false;
  const entry = captchaMap.get(captchaId);
  captchaMap.delete(captchaId); // 一次性：无论对错立即失效
  if (!entry || entry.expiresAt <= Date.now()) return false;
  return Number(answer) === entry.answer;
}

export function getLockRemainMs(email: string): number {
  const key = email.trim().toLowerCase();
  const e = failMap.get(key);
  if (!e || !e.lockedUntil) return 0;
  const remain = e.lockedUntil - Date.now();
  return remain > 0 ? remain : 0;
}

export function recordLoginFail(email: string): { locked: boolean; fails: number } {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  const e = failMap.get(key);
  if (e && e.lockedUntil && e.lockedUntil > now) {
    return { locked: true, fails: e.fails };
  }
  const fails = (e ? e.fails : 0) + 1;
  let lockedUntil = 0;
  if (fails >= MAX_FAILS) lockedUntil = now + LOCK_MS;
  failMap.set(key, { fails, lockedUntil });
  return { locked: fails >= MAX_FAILS, fails };
}

export function clearLoginFails(email: string): void {
  failMap.delete(email.trim().toLowerCase());
}
