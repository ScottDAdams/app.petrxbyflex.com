#!/usr/bin/env node

const searchQuery = "Affenpinscher dog breed"
const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(searchQuery)}&qft=+filterui:imagesize-large`

const htmlRes = await fetch(searchUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  }
})

const html = await htmlRes.text()
// Try multiple patterns
const patterns = [
  { name: 'murl', regex: /"murl":"([^"]+)"/g },
  { name: 'turl', regex: /"turl":"([^"]+)"/g },
  { name: 'img src', regex: /<img[^>]+src=["']([^"']+)["'][^>]*>/gi },
  { name: 'data-src', regex: /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi },
  { name: 'image url', regex: /"image":"([^"]+)"/gi },
]

for (const { name, regex } of patterns) {
  const matches = []
  let match
  while ((match = regex.exec(html)) !== null) {
    matches.push(match[1])
  }
  console.log(`\n${name}: Found ${matches.length} matches`)
  if (matches.length > 0 && matches.length < 20) {
    matches.slice(0, 3).forEach((url, i) => {
      const unescaped = url.replace(/\\\//g, '/')
      console.log(`  ${i+1}. ${unescaped.substring(0, 100)}`)
    })
  }
}
