import * as React from "react"
import { API_BASE } from "../api/index"

export type WalletModalProps = {
  open: boolean
  onClose: () => void
  qrCodeUrl?: string
  qrCodeUrlAndroid?: string
  walletPassUrl?: string
  memberId?: string
}

export function WalletModal({
  open,
  onClose,
  qrCodeUrl,
  qrCodeUrlAndroid,
  walletPassUrl,
  memberId,
}: WalletModalProps) {
  const [googleUrl, setGoogleUrl] = React.useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = React.useState(false)
  const [googleError, setGoogleError] = React.useState(false)

  const handleAppleWallet = () => {
    if (walletPassUrl) window.location.href = walletPassUrl
  }

  const handleGoogleWallet = async () => {
    if (googleUrl) {
      window.open(googleUrl, "_blank", "noopener,noreferrer")
      return
    }
    if (!memberId) {
      setGoogleError(true)
      return
    }
    setGoogleLoading(true)
    setGoogleError(false)
    try {
      const res = await fetch(`${API_BASE}/api/googlewallet/${memberId}`)
      if (!res.ok) throw new Error("Failed to get Google Wallet URL")
      const data = (await res.json()) as { url?: string }
      const url = data?.url
      if (url) {
        setGoogleUrl(url)
        window.open(url, "_blank", "noopener,noreferrer")
      } else {
        setGoogleError(true)
      }
    } catch {
      setGoogleError(true)
    } finally {
      setGoogleLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="wallet-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
      <div className="walletModal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="walletModal__header">
          <h2 id="wallet-modal-title" className="walletModal__title">Add to Your Wallet</h2>
          <button type="button" className="walletModal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="walletModal__content">
          <div className="walletModal__grid">
            <div className="walletTile">
              <p className="walletTile__label">Apple Wallet</p>
              <div className="walletTile__qr">
                {qrCodeUrl ? (
                  <img src={qrCodeUrl} alt="Apple Wallet QR code" />
                ) : (
                  <div className="walletTile__qr-placeholder" aria-hidden />
                )}
              </div>
            </div>
            <div className="walletTile">
              <p className="walletTile__label">Google Wallet</p>
              <div className="walletTile__qr">
                {qrCodeUrlAndroid ? (
                  <img src={qrCodeUrlAndroid} alt="Google Wallet QR code" />
                ) : (
                  <div className="walletTile__qr-placeholder" aria-hidden />
                )}
              </div>
            </div>
          </div>
          <div className="walletModal__ctaRow">
            <button
              type="button"
              className="walletModal__ctaBtn walletModal__ctaBtn--apple"
              onClick={handleAppleWallet}
              disabled={!walletPassUrl}
              aria-label="Add to Apple Wallet"
            >
              <img src="/assets/add_to_apple.png" alt="" />
            </button>
            {googleError ? (
              <div className="walletModal__ctaRow-hint">
                <p className="walletModal__scanHint">Scan the QR code on your Android device to add to Google Wallet.</p>
              </div>
            ) : (
              <button
                type="button"
                className="walletModal__ctaBtn walletModal__ctaBtn--google"
                onClick={handleGoogleWallet}
                disabled={googleLoading}
                aria-label="Add to Google Wallet"
              >
                <img src="/assets/add_to_google.png" alt="" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
