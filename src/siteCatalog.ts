/** @file siteCatalog.ts @description 中文注释：默认站点清单；运行实例使用 Config.site。 */
import site from './site.config.json' with { type: 'json' };
export const SITE_CATALOG = site.sites;
