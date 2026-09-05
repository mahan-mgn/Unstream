/** نوار range با بخشِ پرشده — درصد از طریق متغیر CSS می‌رود، نه با المنت دوم */
export default function Range({
  value,
  max,
  onChange,
  label,
  className = '',
}: {
  value: number
  max: number
  onChange: (v: number) => void
  label: string
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step="any"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className={`seek ${className}`}
      style={{ '--pct': `${pct}%` } as React.CSSProperties}
    />
  )
}
