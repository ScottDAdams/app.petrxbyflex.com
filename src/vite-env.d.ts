/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Base URL for chatbot static assets (default https://app.petrxbyflex.com) */
  readonly VITE_CHATBOT_ASSETS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
