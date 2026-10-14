# Kelimşek ⚡ — Web

Kelimşek kelime oyununun web sürümü (PWA). Çevrimdışı oynanabilir; Android/iOS sarmalayıcılarının temelini oluşturur.

## Özellikler
- Çevrimdışı oynanış (service worker + manifest)
- Kelime paketleri: KPSS, YDS, YKS (`packs/`)
- `native-bridge.js` — Capacitor köprüsü (sarmalayıcılar için)

## Yapı
- `index.html` — oyun
- `packs/` — kelime paketleri
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA

## Yayın
Statik — doğrudan sunulur. Sarmalayıcılar: `kelimsek-android`, `kelimsek-ios`.
