/**
 * Returns the icon path for a breed by species and numeric ID.
 * Use this path as img src; on error, fall back to /assets/breeds/{species}/default.svg
 */
export function getBreedIconPath(
  species: "dogs" | "cats",
  breedValue: number | undefined | null
): string {
  if (breedValue == null || Number.isNaN(Number(breedValue))) {
    return `/assets/breeds/${species}/default.svg`
  }
  return `/assets/breeds/${species}/${breedValue}.svg`
}
