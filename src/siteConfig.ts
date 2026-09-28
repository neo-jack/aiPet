/** @file siteConfig.ts @description 中文注释：独立站点资料加载与公开配置校验。 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import defaultSite from './site.config.json' with { type: 'json' };
const httpUrl = z.string().refine(value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
const schema = z.object({
  siteOrigin: httpUrl,
  instructions: z.string().max(16000),
  greeting: z.string().max(1000),
  welcomeQuestions: z.array(z.object({ id: z.string(), label: z.string().max(160), question: z.string().max(160) })).max(3),
  sites: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/), name: z.string(), description: z.string(), href: z.string(), owned: z.boolean().default(false), icon: z.string().default(''), category: z.string().default(''), tags: z.array(z.string()).default([]) })).max(100),
}).superRefine((site, context) => {
  if (new Set(site.sites.map(entry => entry.id)).size !== site.sites.length) context.addIssue({code:'custom',message:'duplicate site IDs'});
  for (const entry of site.sites) {
    try { if (!httpUrl.safeParse(new URL(entry.href, site.siteOrigin).href).success) throw new Error(); }
    catch { context.addIssue({code:'custom',message:'invalid site URL'}); }
  }
});
export function readSiteConfig(path?: string) {
  try { return schema.parse(path ? JSON.parse(readFileSync(path, 'utf8')) : defaultSite); }
  catch { throw new Error('Invalid configuration: SITE_CONFIG_FILE'); }
}
export type SiteConfig = ReturnType<typeof readSiteConfig>;
export function publicSiteConfig(site: SiteConfig) {
  return { siteOrigin: site.siteOrigin, greeting: site.greeting, welcomeQuestions: site.welcomeQuestions,
    sites: site.sites.map(({href, ...entry}) => ({...entry, url:new URL(href, site.siteOrigin).href})) };
}
