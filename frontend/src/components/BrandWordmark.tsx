// The "CORE" wordmark in the logo's navy (brand token: navy in light mode, a readable light blue in dark mode).
export default function BrandWordmark({ className = '' }: { className?: string }) {
  return <b className={`tracking-[.08em] text-brand ${className}`}>CORE</b>
}
