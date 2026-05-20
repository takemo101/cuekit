import { defineConfig } from "vitepress";

export default defineConfig({
	title: "cuekit",
	description: "Child-agent delegation substrate for coding agents",
	lang: "en-US",
	base: "/cuekit/",
	lastUpdated: true,
	cleanUrls: true,
	srcDir: ".",
	outDir: ".vitepress/dist",
	cacheDir: ".vitepress/cache",
	head: [
		["link", { rel: "icon", href: "/cuekit/favicon.svg", type: "image/svg+xml" }],
		["meta", { name: "theme-color", content: "#3b82f6" }],
	],
	themeConfig: {
		nav: [
			{ text: "Quickstart", link: "/quickstart" },
			{ text: "Install", link: "/install" },
			{
				text: "Guides",
				items: [
					{ text: "Project Config (.cuekit.yaml)", link: "/guides/project-config" },
					{ text: "Team Strategies", link: "/guides/team-strategies" },
					{ text: "Agent Profiles", link: "/guides/agent-profiles" },
				],
			},
			{ text: "API", link: "/api/mcp-tools" },
			{
				text: "v0.0.15",
				items: [
					{
						text: "Changelog",
						link: "https://github.com/takemo101/cuekit/blob/main/CHANGELOG.md",
					},
					{
						text: "GitHub",
						link: "https://github.com/takemo101/cuekit",
					},
				],
			},
		],
		sidebar: {
			"/": [
				{
					text: "Getting Started",
					items: [
						{ text: "Quickstart", link: "/quickstart" },
						{ text: "Install", link: "/install" },
					],
				},
				{
					text: "Guides",
					items: [
						{ text: "Project Config (.cuekit.yaml)", link: "/guides/project-config" },
						{ text: "Team Strategies", link: "/guides/team-strategies" },
						{ text: "Agent Profiles", link: "/guides/agent-profiles" },
					],
				},
				{
					text: "Reference",
					items: [{ text: "MCP Tools", link: "/api/mcp-tools" }],
				},
			],
		},
		socialLinks: [{ icon: "github", link: "https://github.com/takemo101/cuekit" }],
		editLink: {
			pattern: "https://github.com/takemo101/cuekit/edit/main/site/:path",
			text: "Edit this page on GitHub",
		},
		footer: {
			message: "Released under the MIT License.",
			copyright: "© 2026 takemo101",
		},
		search: {
			provider: "local",
		},
	},
});
