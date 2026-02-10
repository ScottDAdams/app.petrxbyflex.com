/**
 * Header visibility driven by session.funnel_type + current_step.
 * During quote steps: logo + support link only. No Med Lookup.
 * After quote completion: full header.
 */

type AppHeaderProps = { fullNav: boolean }

const SUPPORT_URL = "https://petrxbyflex.com/support"

export function AppHeader({ fullNav }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="petrx-container app-header__inner">
        <a href="https://petrxbyflex.com" className="app-logo" aria-label="PetRx by Flex">
          <img src="/assets/petrxbyflex-logo.svg" alt="PetRx by Flex" />
        </a>
        <nav className="app-nav" aria-label="Main">
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="app-nav-link">
            Support
          </a>
          {fullNav && (
            <>
              <a href="/med-lookup" className="app-nav-link">
                Med Lookup
              </a>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
