/**
 * حالت خالی/بدون‌نتیجه‌ی مشترک — قبلاً هرجا فقط یک پاراگراف خاکستری بود،
 * که کنار آرت‌ورک‌ها و کارت‌های رنگی بقیه‌ی صفحه خیلی مرده به‌نظر می‌رسید.
 */
export default function EmptyState({
  icon,
  text,
  bordered = true,
}: {
  icon: React.ReactNode
  text: string
  bordered?: boolean
}) {
  return (
    <div
      className={`rise flex flex-col items-center gap-3 text-center ${
        bordered
          ? 'rounded-2xl border border-line-soft bg-panel/50 p-10'
          : 'p-8'
      }`}
    >
      <span className="grid size-11 place-items-center rounded-full bg-panel-2 text-muted-2">
        {icon}
      </span>
      <p className="max-w-xs text-sm text-muted">{text}</p>
    </div>
  )
}
