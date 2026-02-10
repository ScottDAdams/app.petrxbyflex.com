/**
 * Returns the avatar image path for a breed by species and breed key (ID or string).
 * Paths: /assets/breed-avatars/dogs|cats/{breedKey}.png, fallback default.png.
 * Use as img src; on error, fall back to /assets/breed-avatars/{species}/default.png
 */
export function getBreedAvatarPath(
  species: "dogs" | "cats",
  breedKey: number | string | undefined | null
): string {
  if (breedKey == null || (typeof breedKey === "string" && breedKey.trim() === "")) {
    return `/assets/breed-avatars/${species}/default.png`
  }
  const key = typeof breedKey === "number" ? breedKey : String(breedKey).trim()
  if (key === "" || (typeof breedKey === "number" && Number.isNaN(breedKey))) {
    return `/assets/breed-avatars/${species}/default.png`
  }
  return `/assets/breed-avatars/${species}/${key}.png`
}
