const PALETTE = [
  ['#0071e3', '#34c759'],
  ['#8b5cf6', '#0071e3'],
  ['#ff9f0a', '#ff3b30'],
  ['#34c759', '#0a84ff'],
  ['#ff3b30', '#8b5cf6'],
  ['#0a84ff', '#ff9f0a'],
]

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Locally rendered initials avatar.
 *
 * Replaces the previous api.dicebear.com <img>, which sent the user's display
 * name to a third party on every page load, broke offline/behind a firewall and
 * flashed a broken image while loading. Deterministic gradient per name, so the
 * same person keeps the same colour.
 */
export default function Avatar({ name = '', size = 48, className = '' }) {
  const [from, to] = PALETTE[hash(name) % PALETTE.length]
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0 select-none shadow-sm ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
      }}
      role="img"
      aria-label={name ? `Profilbild ${name}` : 'Profilbild'}
    >
      {initialsOf(name)}
    </div>
  )
}
