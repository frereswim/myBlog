---
title: "duo 的小站（myBlog）"
slug: myblog
published: 2026-11-15
draft: false
order: 100
description: "本站源码。Astro 构建的纯静态博客，用来沉淀 Java、数据库、分布式与计算机网络的学习笔记。"
image: ""
status: "published"
tags:
  - Astro
  - 博客
  - 静态站点
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/frereswim/myBlog"
  - label: "访问站点"
    icon: "material-symbols:open-in-new"
    value: "https://frereswim.github.io/myBlog/"
lang: ""
---

## 这是什么

自己的技术博客，也是这份笔记的落脚处。纯静态站点，源码公开在 GitHub，`dist/` 由 GitHub Actions 构建后发布到 GitHub Pages。

## 技术栈

| 层 | 选择 |
|---|---|
| 框架 | Astro（静态输出，无服务端） |
| 交互 | Svelte 5 孤岛组件 |
| 样式 | Tailwind CSS |
| 搜索 | Pagefind（构建期生成索引） |
| 图表 | Mermaid / PlantUML（构建期转静态 SVG） |
| 公式 | KaTeX |

## 写作约定

- 经验类：背景 → 做法 → 踩坑 → 结论
- 知识类：一句话定义 → 最小例子 → 易错点
- 能用图说明的，就不写三段文字描述

## 本地运行

```bash
pnpm install
pnpm dev      # http://localhost:4321/myBlog/
pnpm build    # 产物在 dist/
```

> 站点部署在子路径下，开发时的地址同样带 `/myBlog/` 前缀。
