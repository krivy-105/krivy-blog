---
title: 小迪安全 P1–P10 · 学习总目录
slug: xiaodi-overview
date: 2026-10-14
category: 学习路线
order: 0
tags: [小迪安全, 学习路线, 渗透测试]
summary: 基础入门十天主线：认识目标 → 第一件武器 → 眼睛 → 解码 → 手工构造数据包。
---
> 课程：【小迪安全】全栈网络安全 | 渗透测试 | 高级红蓝对抗 V2024（B站 BV123yAYMEwb，全199P）
> 本目录覆盖 基础入门阶段 P1-P10（约14.6小时课程）
> 笔记来源：SenseVoice本地全片语音转写（每集约1000段带时间戳文稿）→ 人工校对整理，同音字已纠正

---

## 笔记清单

| P | 笔记文件 | 本集一句话 |
|---|---|---|
| P1 | [小迪安全笔记-P1-Web架构搭建.md](/security/xiaodi-p01-web-arch) | 网站怎么搭的=攻击面怎么来的；三种搭建模式+IIS配置受限攻防双视角 |
| P2 | [小迪安全笔记-P2-Web架构进阶.md](/security/xiaodi-p02-web-arch-advanced) | 前后端分离/集成软件/Docker/分配站：中间件运行身份=权限边界；webshell同壳不同命实验 |
| P3 | [小迪安全笔记-P3-CDN与WAF架构.md](/security/xiaodi-p03-cdn-waf) | WAF/CDN/OSS/反代/负载均衡五种装备：每种让一类漏洞失效，又带来新攻击面（AK泄露/假站） |
| P4 | [小迪安全笔记-P4-APP与小程序架构.md](/security/xiaodi-p04-app-miniprogram) | 封装APP=测它网站；原生=反编译提资产；H5+Vue=测JS接口；抓包vs反编译的适用边界 |
| P5 | [小迪安全笔记-P5-反弹Shell与带外.md](/security/xiaodi-p05-reverse-shell-oob) | 正反向连接选型由可达性决定（NAT内网实验+防火墙出入站）；dnslog带外无回显取数 |
| P6 | [小迪安全笔记-P6-抓包技术与HTTPS.md](/security/xiaodi-p06-https-capture) | Charles/Fiddler/Burp三工具抓包点位表+证书中间人原理+Proxifier转发联动 |
| P7 | [小迪安全笔记-P7-全局抓包与封包监听.md](/security/xiaodi-p07-global-capture) | 非HTTP协议用科来/Wireshark从网卡抓；封包重放=外挂原理；抓包终点是资产串联 |
| P8 | [小迪安全笔记-P8-加密算法与密文存储.md](/security/xiaodi-p08-encryption) | payload必须按目标同样编码加密提交；密文三连（纯MD5/加盐/自定义算法）；混淆堵死黑白盒 |
| P9 | [小迪安全笔记-P9-算法逆向与JS解密.md](/security/xiaodi-p09-algorithm-reversing) | 散列/对称/非对称的解密条件清单；密文特征识别；JS前端加密逆向；墨者AES注入实战 |
| P10 | [小迪安全笔记-P10-HTTP数据包与状态码.md](/security/xiaodi-p10-http-packets) | 请求头=信任滥用攻击面（改UA/塞Cookie免密进后台）；状态码口诀撑起目录爆破原理 |

---

## 基础入门十天的主线

```
P1-P4  【认识目标】网站/APP/小程序怎么搭 → 架构决定攻击面
P5     【第一件武器】拿到权限怎么维持（反弹shell）+ 看不见怎么测（带外）
P6-P7  【眼睛】抓包：HTTP用Burp族，私有协议上网卡工具，终点是资产串联
P8-P9  【解码】密文识别 → 算法条件清单 → 前端JS逆向 → 按目标加密构造payload
P10    【手】HTTP数据包手工构造与判断 → 目录爆破/登录爆破的底层逻辑
```

## 给数通HCIA背景的学习路线建议

1. **快进区**（你的主场）：P3的CDN/负载均衡原理、P5的防火墙出入站、P6的HTTPS/TLS、P7的网卡与协议分析、P10的HTTP基础
2. **逐帧区**（安全新视角）：P3的58:00反代百度演示、P5的39:04 NAT正反向实验、P6的模拟器抓包配置、P8密文三连、P9的JS逆向与墨者靶场、P10的爆破实战
3. P11之后进入【信息打点】阶段（资产收集/指纹/空间测绘），这10集的架构认知是那里的地基

## 生产记录（复现用）

- 转写：yt-dlp拉流 → ffmpeg 16kHz mono WAV → sherpa-onnx SenseVoice-Small int8 + Silero VAD（NVIDIA无卡纯CPU，约10倍速）
- 教训存档：双实例并行ONNX推理在4核8线程笔记本上互相拖慢5倍，**串行才是最快的并行**
- B站数据（元数据/弹幕/评论）：BiliBili_VideoRead_MCP（（本地存档））

