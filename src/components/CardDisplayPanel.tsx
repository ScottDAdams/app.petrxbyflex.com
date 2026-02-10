import * as React from "react"

export type CardDisplayPanelProps = {
  cardImageUrl: string
  walletUrl?: string
  memberId?: string
  petName?: string
  onDownload?: () => void
  onAddToWallet?: () => void
}

export function CardDisplayPanel({
  cardImageUrl,
  walletUrl,
  memberId = "FRX001000",
  petName = "your pet",
  onDownload,
  onAddToWallet,
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
    <div className="cardPanel">
      <div className="cardPanel__header">
        <h2>Your Digital Card</h2>
      </div>
      <div className="cardPanel__cardWrap">
        {loading && <div className="cardPanel__shimmer" aria-hidden />}
        <img
          src={cardImageUrl}
          alt={`PetRx Card for ${petName}`}
          className="cardPanel__cardImg"
          style={{ display: loading ? "none" : "block" }}
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      </div>
      <div className="cardPanel__actions">
        {walletUrl &&
          (onAddToWallet ? (
            <button type="button" className="btn btn--primary" onClick={onAddToWallet}>
              Add to Digital Wallet
            </button>
          ) : (
            <a href={walletUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
              Add to Digital Wallet
            </a>
          ))}
        <button type="button" className="btn btn--secondary" onClick={handleDownload}>
          Download Card Image
        </button>
      </div>
      <p className="cardPanel__note">
        Tip: Save to your phone's digital wallet so it&apos;s always available at the pharmacy.
      </p>
    </div>
  )
}
