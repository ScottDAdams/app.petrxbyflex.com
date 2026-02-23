import { Outlet } from "react-router-dom"
import { AppHeader } from "../components/AppHeader"
import { ChatbotWidget } from "../features/chatbot"

export function PublicLayout() {
  return (
    <div className="app-layout">
      <AppHeader fullNav={false} />
      <main className="app-main">
        <div id="petrx-container" className="petrx-container" style={{ position: "relative" }}>
          <Outlet />
        </div>
      </main>
      <ChatbotWidget pageContext="homepage" />
    </div>
  )
}
