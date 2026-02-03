import * as React from "react"

export type CardDisplayPanelProps = {
  cardImageUrl: string
  walletUrl?: string
  memberId?: string
  petName?: string
  onDownload?: () => void
}

export function CardDisplayPanel({
  cardImageUrl,
  walletUrl,
  memberId = "FRX001000",
  petName = "your pet",
  onDownload,
}: CardDisplayPanelProps) {
  const [loading, setLoading] = React.useState(true)

  const handleDownload = () => {
    if (onDownload) {
      onDownload()
      return
    }
    const link = document.createElement("a")
    link.href = cardImageUrl
    link.download = `${memberId}-card.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="card-display-panel">
      <p className="card-display-panel-title">Your Digital Card</p>
      {loading && <div className="card-display-panel-shimmer" />}
      <img
        src={cardImageUrl}
        alt={`PetRx Card for ${petName}`}
        className="card-display-panel-image"
        style={{ display: loading ? "none" : "block" }}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
      />
      <button type="button" className="card-display-panel-download" onClick={handleDownload}>
        Download Card Image
      </button>
      {walletUrl && (
        <a href={walletUrl} target="_blank" rel="noopener noreferrer" className="card-display-panel-wallet">
          Add to Wallet
        </a>
      )}
    </div>
  )
}
