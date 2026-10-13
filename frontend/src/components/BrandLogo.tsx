// CORE logo: navy gradient tile with a white "C" and a faint ring in the corner (V113 prototype).
export default function BrandLogo({ size = 42, className = '' }: { size?: number; className?: string }) {
  return (
    <div className={`relative overflow-hidden shrink-0 grid place-items-center text-white font-black ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.29), fontSize: Math.round(size * 0.48), letterSpacing: '-.04em', background: 'linear-gradient(145deg,#17324d,#2f5879)', boxShadow: '0 7px 18px rgba(23,50,77,.18)', border: '1px solid rgba(255,255,255,.12)' }}
      aria-hidden="true">
      C
      <span className="absolute rounded-full" style={{ width: size * 0.31, height: size * 0.31, right: -size * 0.1, bottom: -size * 0.1, border: '2px solid rgba(255,255,255,.22)' }} />
    </div>
  )
}
