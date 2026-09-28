import paperUrl from '../assets/paper.webp?url';
import type { RecommendedSite } from '../types';

export function SiteCard({ site }: { site: RecommendedSite }) {
  return (
    <article aria-label={`${site.name}网站推荐`}
      className="my-3 min-w-0 rounded-[2px_5px_3px_4px] bg-[#f7f4eb] p-2.5"
      style={{ backgroundImage: `linear-gradient(#f7f4ebbd, #f7f4ebbd), url(${paperUrl})`, backgroundSize: '240px' }}>
      <div className="relative px-3 pb-3">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 top-3.5 border-x border-b border-[#8a8879]/65" />
        <div className="-mx-3 flex items-start gap-2">
          <span aria-hidden="true" className="mt-3.5 w-3 shrink-0 border-t border-[#8a8879]/65" />
          <h3 className="m-0 min-w-0 text-[17px] font-semibold leading-7 text-[#4a4c42] wrap-anywhere"
            style={{ fontFamily: 'Georgia, "Songti SC", SimSun, serif' }}>{site.name}</h3>
          <span aria-hidden="true" className="mt-3.5 min-w-3 flex-1 border-t border-[#8a8879]/65" />
        </div>
        <p className="mt-4 mb-4 text-xs leading-6 text-[#6f7265]">{site.description}</p>
        <a href={site.url} target="_blank" rel="noopener noreferrer" aria-label={`访问${site.name}`}
          className="inline-flex min-h-9 max-w-full items-center justify-center gap-5 rounded-[2px_4px_3px_3px] border border-[#7b806d]/65 bg-[#e7e8dc] px-4 py-1.5 text-xs! font-medium text-[#505946]! no-underline! shadow-[0_1px_0_#ffffff90_inset] hover:bg-[#dce0d0] focus-visible:outline-2 focus-visible:outline-offset-2">
          点击访问 <span aria-hidden="true" className="text-base">→</span>
        </a>
      </div>
    </article>
  );
}
