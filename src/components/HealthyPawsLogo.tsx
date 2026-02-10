export type HealthyPawsLogoProps = {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function HealthyPawsLogo({ size = "md", className = "" }: HealthyPawsLogoProps) {
  const heightMap = {
    sm: "24px", // h-6
    md: "32px", // h-8
    lg: "40px", // h-10
  }
  const height = heightMap[size]
  
  return (
    <img
      src="/assets/healthypaws_logo_color.svg"
      alt="Healthy Paws Pet Insurance"
      className={`healthy-paws-logo healthy-paws-logo--${size} ${className}`}
      style={{
        height,
        width: "auto",
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    />
  )
}
