// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import node from '@astrojs/node';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://krivy.cyou',
	output: 'server',
	adapter: node({ mode: 'middleware' }),
	// 部署在 Caddy 反向代理之后，Host 与浏览器 Origin 可能不一致，
	// Astro 默认的 Origin 校验会误判所有 POST 为跨站（403）。
	// CSRF 防护仍由 session cookie 的 sameSite=lax 提供。
	security: {
		checkOrigin: false,
	},
	// 关键 CSS 内联进 HTML：
	// 这台机器的回源要跨境走隧道，多一个阻塞请求就多一个往返（实测 200-600ms）。
	// 把全局样式（约 37KB）内联后省掉这次往返，首屏渲染明显提前；
	// 代价是 HTML 变大几 KB（brotli 后），换少一次 RTT 很划算。
	build: {
		inlineStylesheets: 'always',
	},
	// 链接预取：鼠标悬停站内链接时预加载，点击近乎秒开
	prefetch: {
		prefetchAll: true,
		defaultStrategy: 'hover',
	},
	integrations: [
		mdx(),
		sitemap({
			// 只收录公开内容：后台、登录、私信、通知、写文章等页面
			// 默认会被 @astrojs/sitemap 全量写成 <url>，等于主动邀请搜索引擎去爬私有页。
			filter: (page) => {
				const path = new URL(page).pathname;
				const privatePrefixes = [
					'/admin',
					'/api',
					'/edit',
					'/feed',
					'/login',
					'/messages',
					'/notifications',
					'/search',
					'/write',
					'/uploads',
					'/404',
					'/500',
				];
				return !privatePrefixes.some(
					(p) => path === p || path.startsWith(`${p}/`) || path === `${p}/`
				);
			},
		}),
	],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff2'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff2'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
