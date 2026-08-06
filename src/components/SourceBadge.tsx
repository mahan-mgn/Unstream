import { SOURCE_LABEL, type Source } from '../lib/types'

const DOT: Record<Source, string> = {
  apple: '#fa586a',
  deezer: '#a238ff',
  soundcloud: '#ff7700',
  spotify: '#1db954',
  youtube: '#ff0033',
}

export default function SourceBadge({ source }: { source: Source }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">
      <span className="size-1.5 rounded-full" style={{ background: DOT[source] }} />
      {SOURCE_LABEL[source]}
    </span>
  )
}
