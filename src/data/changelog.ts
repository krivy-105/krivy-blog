// 站点更新日志 —— 新条目加在数组最前面即可，关于页自动展示
export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  type: 'feat' | 'fix' | 'style' | 'perf' | 'security';
  title: string;
  detail?: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    date: '2026-09-20',
    type: 'feat',
    title: '质感升级',
    detail: [
      'PWA 支持：可添加到主屏幕、离线可访问',
      '文章分享卡：微信 / X 分享自动展示标题大图',
      '全新 404 页面与 /now 状态页',
    ],
  },
  {
    date: '2026-09-19',
    type: 'security',
    title: '安全与体验加固',
    detail: [
      '正文渲染接入 sanitize-html，杜绝脚本注入',
      '登录 / 注册增加 IP 限流，防暴力破解',
      '新增安全响应头与数据库每日自动备份',
      '文章页补全 OG 标签与 JSON-LD 结构化数据',
    ],
  },
  {
    date: '2026-09-19',
    type: 'fix',
    title: '修复删除文章 500',
    detail: ['软删除触发 FTS 全文索引报错导致删除失败，已修复'],
  },
  {
    date: '2026-09-19',
    type: 'feat',
    title: '文章删除与下架',
    detail: ['详情页支持作者删除自己的文章', '管理员可下架违规文章'],
  },
  {
    date: '2026-09-18',
    type: 'feat',
    title: '社区与治理',
    detail: [
      '管理员删除用户，事务级联清理关联数据',
      '头像上传 + 人工审核队列',
      '首页新增站点简介区块',
    ],
  },
  {
    date: '2026-09-17',
    type: 'feat',
    title: '12 项博客增强',
    detail: [
      '标签、全文搜索、阅读进度条、目录 TOC',
      '暗色模式、相关文章、浏览量统计',
      '归档、友链、草稿自动保存',
      '文章置顶；移动端排版整体优化',
    ],
  },
  {
    date: '2026-09-16',
    type: 'feat',
    title: '正式上线',
    detail: [
      '全栈重构：账号体系、私信、发文审核',
      '莫奈蓝设计系统 + 明暗双主题',
      '绑定域名 krivy.cyou，部署 Railway + Cloudflare',
    ],
  },
];
