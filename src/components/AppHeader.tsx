/**
 * Header visibility driven by session.funnel_type + current_step.
 * During quote steps: logo + Rx Price Lookup link only. No Med Lookup.
 * After quote completion: full header.
 */

import { Link } from "react-router-dom"

type AppHeaderProps = { fullNav: boolean }

export function AppHeader({ fullNav }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="petrx-container app-header__inner">
        <a href="https://petrxbyflex.com" className="app-logo" aria-label="PetRx by Flex">
          <img src="/assets/petrxbyflex-logo.svg" alt="PetRx by Flex" />
        </a>
        <nav className="app-nav" aria-label="Main">
          <Link to="/prescriptions/drug-search" className="app-nav-link">
            Rx Price Lookup
          </Link>
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
