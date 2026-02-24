import { NextRequest, NextResponse } from 'next/server'
import type { Restaurant, PriceBand, RestaurantCategory } from '@/types'

// ── 카테고리 매핑 ─────────────────────────────────────────────────────
function mapCategory(types: string[]): RestaurantCategory {
  if (types.some((t) => ['korean_restaurant'].includes(t))) return '한식'
  if (types.some((t) => ['chinese_restaurant'].includes(t))) return '중식'
  if (types.some((t) => ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'].includes(t))) return '일식'
  if (types.some((t) => ['pizza_restaurant', 'italian_restaurant', 'american_restaurant', 'steak_house', 'french_restaurant'].includes(t))) return '양식'
  if (types.some((t) => ['fast_food_restaurant', 'hamburger_restaurant'].includes(t))) return '패스트푸드'
  if (types.some((t) => ['cafe', 'coffee_shop', 'brunch_restaurant', 'sandwich_shop'].includes(t))) return '카페/브런치'
  if (types.some((t) => ['vietnamese_restaurant', 'thai_restaurant', 'indian_restaurant', 'asian_restaurant', 'southeast_asian_restaurant'].includes(t))) return '아시안'
  return '한식' // 기본값
}

// ── 가격대 매핑 (Places API New → PriceBand) ─────────────────────────
function mapPriceBand(priceLevel?: string): PriceBand | null {
  if (priceLevel === 'PRICE_LEVEL_INEXPENSIVE') return 'under_10k'
  if (priceLevel === 'PRICE_LEVEL_MODERATE') return '10_15k'
  if (priceLevel === 'PRICE_LEVEL_EXPENSIVE' || priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE') return 'over_15k'
  return null
}

// ── Haversine 거리 계산 (m) ───────────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Fisher-Yates 셔플 ────────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Places API (New) 응답 타입 ────────────────────────────────────────
interface PlaceResult {
  id?: string
  displayName?: { text: string; languageCode: string }
  rating?: number
  userRatingCount?: number
  priceLevel?: string
  location?: { latitude: number; longitude: number }
  shortFormattedAddress?: string
  types?: string[]
  editorialSummary?: { text: string }
  photos?: { name: string }[]
  currentOpeningHours?: { openNow?: boolean }
  businessStatus?: string // 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'
  reviews?: {
    text?: { text: string }
    rating?: number
    authorAttribution?: { displayName: string }
  }[]
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.location',
  'places.shortFormattedAddress',
  'places.types',
  'places.editorialSummary',
  'places.photos',
  'places.currentOpeningHours.openNow',
  'places.businessStatus',
  'places.reviews',
].join(',')

// 점심시간대(10~14시) 술집/유흥업소 제외용 타입
const BAR_TYPES = ['bar', 'night_club', 'liquor_store', 'wine_bar', 'pub']

// ── 단일 Nearby Search 요청 ───────────────────────────────────────────
async function searchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  rankPreference: 'DISTANCE' | 'POPULARITY',
): Promise<PlaceResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius,
        },
      },
      maxResultCount: 20,
      rankPreference,
      languageCode: 'ko',
    }),
  })
  if (!res.ok) return []
  const data: { places?: PlaceResult[] } = await res.json()
  return data.places ?? []
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lng = parseFloat(searchParams.get('lng') ?? '')
  const radius = parseInt(searchParams.get('radius') ?? '500')
  const priceBand = searchParams.get('priceBand') as PriceBand | null

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ message: '위치 정보가 필요합니다.' }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ message: 'API 키가 설정되지 않았어요.' }, { status: 500 })
  }

  // 거리순 + 인기순 두 가지 정렬로 병렬 조회 → 최대 40개 후보 확보
  const [distResult, popResult] = await Promise.allSettled([
    searchNearby(apiKey, lat, lng, radius, 'DISTANCE'),
    searchNearby(apiKey, lat, lng, radius, 'POPULARITY'),
  ])

  // 중복 제거 (placeId 기준)
  const seen = new Set<string>()
  const merged: PlaceResult[] = []
  for (const result of [distResult, popResult]) {
    if (result.status === 'fulfilled') {
      for (const place of result.value) {
        if (place.id && !seen.has(place.id)) {
          seen.add(place.id)
          merged.push(place)
        }
      }
    }
  }

  // 1) 임시휴업 및 영업 전 매장 필터링
  const open = merged.filter((place) => {
    if (place.businessStatus === 'CLOSED_TEMPORARILY') return false
    if (place.currentOpeningHours?.openNow === false) return false
    return true
  })

  // 2) 가격대 필터링 (서버 사이드 — #4)
  const priceFiltered = priceBand
    ? open.filter((place) => {
        const mapped = mapPriceBand(place.priceLevel)
        // 가격 정보가 있고 선택한 가격대와 다르면 제외
        return mapped === null || mapped === priceBand
      })
    : open

  // 3) 점심시간대(10~14시) 술집/유흥업소 제외 (#7)
  const hour = new Date().getHours()
  const isLunchTime = hour >= 10 && hour < 14
  const timeFiltered = isLunchTime
    ? priceFiltered.filter((place) =>
        !place.types?.some((t) => BAR_TYPES.includes(t))
      )
    : priceFiltered

  if (timeFiltered.length === 0) {
    return NextResponse.json({ message: '주변에서 음식점을 찾지 못했어요.' }, { status: 404 })
  }

  // 서버에서 셔플 → 같은 위치/반경이어도 매 요청마다 다른 순서로 반환
  const shuffled = shuffle(timeFiltered)

  const restaurants: Restaurant[] = shuffled.map((place) => {
    const rLat = place.location?.latitude ?? lat
    const rLng = place.location?.longitude ?? lng

    // 베스트 리뷰 선택 — 별점 높은 순 (#5)
    const bestReviewRaw = place.reviews
      ?.filter((r) => r.text?.text && r.rating)
      ?.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null

    return {
      placeId: place.id ?? '',
      name: place.displayName?.text ?? '(이름 없음)',
      category: mapCategory(place.types ?? []),
      address: place.shortFormattedAddress ?? '',
      lat: rLat,
      lng: rLng,
      distanceM: Math.round(haversineDistance(lat, lng, rLat, rLng)),
      rating: place.rating ?? 0,
      userRatingsTotal: place.userRatingCount ?? 0,
      priceBand: mapPriceBand(place.priceLevel),
      photoUrl: place.photos?.[0]?.name
        ? `https://places.googleapis.com/v1/${place.photos[0].name}/media?maxWidthPx=400&key=${apiKey}`
        : null,
      mapUrl: place.id
        ? `https://www.google.com/maps/place/?q=place_id:${place.id}`
        : `https://maps.google.com/?q=${rLat},${rLng}`,
      representativeMenus: [],
      tags: [],
      excluded: false,
      description: place.editorialSummary?.text ?? null,
      bestReview: bestReviewRaw
        ? {
            text: bestReviewRaw.text!.text!,
            rating: bestReviewRaw.rating!,
            authorName: bestReviewRaw.authorAttribution?.displayName ?? '익명',
          }
        : null,
    }
  })

  return NextResponse.json({ restaurants })
}
