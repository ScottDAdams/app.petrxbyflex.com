import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { SessionProviderFromUrl } from "./context/SessionProviderFromUrl"
import { App } from "./app/App"
import "./styles/global.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProviderFromUrl>
        <App />
      </SessionProviderFromUrl>
    </BrowserRouter>
  </React.StrictMode>
)
