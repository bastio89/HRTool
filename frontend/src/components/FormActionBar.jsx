/**
 * Sticky action bar for long forms.
 *
 * Both entity forms are several screens tall; parking Save at the very bottom
 * meant scrolling the whole page to submit. This keeps the primary action in
 * reach at every scroll position, and stays inside the app's scroll container
 * so it never overlaps the sidebar.
 */
export default function FormActionBar({ children, className = '' }) {
  return (
    <div
      className={`sticky bottom-0 -mx-4 sm:-mx-6 lg:-mx-10 mt-10 px-4 sm:px-6 lg:px-10 py-4
        bg-white/85 dark:bg-[#1c1c1e]/85 backdrop-blur-2xl
        border-t border-gray-200/60 dark:border-gray-700/60 ${className}`}
    >
      <div className="flex items-center justify-end gap-4 flex-wrap">{children}</div>
    </div>
  )
}
