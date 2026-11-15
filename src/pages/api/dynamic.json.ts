import { getCollection } from "astro:content";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import {
	dynamicSearchText,
	dynamicSlug,
	sortDynamics,
} from "@/utils/dynamic-utils";

const markdownImagePattern = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g;

// 站内绝对路径需要补上 base（如 /myBlog），否则部署到子路径后图片会 404
function withBase(src: string): string {
	if (!src.startsWith("/")) return src;
	if (/^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src)) return src;
	const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
	if (!base || src.startsWith(`${base}/`)) return src;
	return `${base}${src}`;
}

export async function GET(): Promise<Response> {
	const processor = await createMarkdownProcessor();
	const dynamics = sortDynamics(await getCollection("dynamic"));
	const data = await Promise.all(
		dynamics.map(async (entry) => {
			const images: Array<{ alt: string; src: string; title?: string }> = [];
			const markdown = (entry.body || "").replace(
				markdownImagePattern,
				(_match, alt: string, src: string, title?: string) => {
					images.push({
						alt,
						src: withBase(src),
						...(title ? { title } : {}),
					});
					return "";
				},
			);
			const rendered = await processor.render(markdown);

			return {
				id: dynamicSlug(entry.id),
				published: entry.data.published.getTime(),
				html: rendered.code,
				images,
				searchText: dynamicSearchText(entry),
				pinned: entry.data.pinned || false,
				location: entry.data.location.trim(),
			};
		}),
	);

	return new Response(JSON.stringify(data), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}
