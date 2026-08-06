function Bar({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton rounded ${className}`} style={style} />
}

export function ResultsSkeleton() {
  return (
    <div className="rise space-y-8 rounded-2xl border border-line-soft bg-panel/50 p-4">
      <section className="space-y-3">
        <Bar className="h-3 w-24" />
        <div className="flex items-center gap-3">
          <Bar className="size-14 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Bar className="h-3 w-1/3" />
            <Bar className="h-2.5 w-1/5" />
          </div>
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Bar className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Bar className="h-2.5" style={{ width: `${45 + i * 8}%` }} />
              <Bar className="h-2 w-1/6" />
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <Bar className="h-3 w-20" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Bar className="aspect-square rounded-lg" />
              <Bar className="h-2.5 w-3/4" />
              <Bar className="h-2 w-1/2" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function AlbumSkeleton() {
  return (
    <div className="rise space-y-4 rounded-2xl border border-line-soft bg-panel/50 p-4">
      <div className="flex items-center gap-4">
        <Bar className="size-20 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Bar className="h-4 w-40" />
          <Bar className="h-2.5 w-56" />
        </div>
        <Bar className="h-9 w-28 rounded-full" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Bar className="size-10 rounded-lg" />
          <Bar className="h-2.5 flex-1" />
          <Bar className="h-2.5 w-10" />
        </div>
      ))}
    </div>
  )
}
