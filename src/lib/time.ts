/**
 * 全站统一时区：Asia/Shanghai（北京时间）。
 *
 * 背景：站点跑在容器里，容器时区通常是 UTC。所有 `toLocaleDateString('zh-CN')`
 * 之类默认跟随进程时区渲染，导致北京时间 0:00–8:00 之间发布的文章，读者看到的
 * 日期比日历早一天。这里把「显示」和「输入」两端都钉死在北京时间。
 *
 * 两类东西要区分清楚：
 *  - 显示：给读者看的日期/时间文本 → 用 SITE_TZ 渲染
 *  - 存储：数据库里一律存毫秒时间戳（现状不变），只有「日期键」这种字符串
 *    （统计表的主键、备份文件名）需要按北京时间取日历日 → dateKeyCN()
 */

export const SITE_TZ = 'Asia/Shanghai';

const DT_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * 给 `toLocaleDateString` / `toLocaleString` / `toLocaleTimeString` 的 options
 * 补上 timeZone。用法：
 *
 *   new Date(ts).toLocaleDateString('zh-CN', cnOpts({ month: 'short', day: 'numeric' }))
 *   new Date(ts).toLocaleString('zh-CN', cnOpts({ hour12: false }))
 */
export function cnOpts(opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  return { ...opts, timeZone: SITE_TZ };
}

/** 北京时间的日历日 `YYYY-MM-DD`，与进程时区无关。用于统计键、备份文件名。 */
export function dateKeyCN(at: Date | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at);
  // en-CA 的日期格式恰好是 YYYY-MM-DD，省掉手工补零
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * 把 `<input type="datetime-local">` 的 `YYYY-MM-DDTHH:mm` 当成**北京时间**解析成
 * 毫秒时间戳。非法或空返回 null。
 *
 * 注意：`new Date('2026-11-06T20:00')` 会按**进程/浏览器时区**解析，容器里就是
 * UTC，定时发布会整整差 8 小时。所有 datetime-local 的提交都必须走这个函数。
 */
export function parseCNLocal(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = DT_LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, da, h, mi] = m;
  const ts = Date.parse(`${y}-${mo}-${da}T${h}:${mi}:00+08:00`);
  return Number.isNaN(ts) ? null : ts;
}

/** 把时间戳格式化成 `<input type="datetime-local">` 需要的 `YYYY-MM-DDTHH:mm`（北京时间）。 */
export function toCNLocalInput(at: Date | number | string): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // 个别 ICU 版本在 hour12:false 下会把午夜给成 24
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
