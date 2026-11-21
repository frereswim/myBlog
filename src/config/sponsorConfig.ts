import type { SponsorConfig } from "../types/sponsorConfig";

export const sponsorConfig: SponsorConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "支持与反馈",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "如果这里的内容帮到了你，最好的支持是留言告诉我哪一篇有用。",

	// 打赏用途说明
	usage:
		"本站目前不设打赏渠道，也没有开通任何收款方式。内容都是免费公开的；如果发现错误或有想看的主题，欢迎通过留言板或 GitHub Issue 告诉我，这比打赏更有用。",

	// 是否显示打赏者列表
	showSponsorsList: false,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否在文章详情页底部显示打赏按钮
	showButtonInPost: false,

	// 打赏方式列表（当前不提供任何收款渠道，保留空数组以隐藏整块卡片）
	methods: [],

	// 打赏者列表（当前为空）
	sponsors: [],
};
