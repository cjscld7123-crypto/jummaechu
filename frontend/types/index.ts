// ─── 필터 관련 타입 ───────────────────────────────────────────────

export type Radius = 300 | 500 | 700 | 1000

export type PriceBand = 'under_10k' | '10_15k' | 'over_15k'

export const PRICE_BAND_LABEL: Record<PriceBand, string> = {
  under_10k: '1만원 이하',
  '10_15k': '1~1.5만원',
  over_15k: '1.5만원 이상',
}

// PRD §6 음식 카테고리 정의 기반
export type ExcludeTag =
  | 'spicy'       // 매운 음식
  | 'raw'         // 날 음식 (생선·회)
  | 'coriander'   // 고수
  | 'offal'       // 내장류
  | 'mala'        // 마라·향신료
  | 'dairy'       // 유제품
  | 'gluten'      // 밀가루(글루텐)
  | 'pork'        // 돼지고기
  | 'seafood'     // 해산물
  | 'chicken'     // 닭고기
  | 'beef'        // 소고기
  | 'egg'         // 계란
  | 'nuts'        // 견과류
  | 'soy'         // 콩·두부

export const EXCLUDE_TAG_LABEL: Record<ExcludeTag, string> = {
  spicy: '매운 음식',
  raw: '날 음식 (회·생선)',
  coriander: '고수',
  offal: '내장류',
  mala: '마라·향신료',
  dairy: '유제품',
  gluten: '밀가루',
  pork: '돼지고기',
  seafood: '해산물',
  chicken: '닭고기',
  beef: '소고기',
  egg: '계란',
  nuts: '견과류',
  soy: '콩·두부',
}

// ─── 음식점 관련 타입 ─────────────────────────────────────────────

export type RestaurantCategory =
  | '한식' | '중식' | '일식' | '양식'
  | '분식' | '아시안' | '패스트푸드' | '카페/브런치'

export interface Restaurant {
  placeId: string
  name: string
  category: RestaurantCategory
  address: string
  lat: number
  lng: number
  distanceM: number   // 사용자 위치로부터 계산된 거리 (m)
  rating: number
  userRatingsTotal: number
  priceBand: PriceBand | null   // Google Places price_level 매핑
  photoUrl: string | null       // Google Places 사진
  mapUrl: string                // Google Maps 딥링크
  // AI 메뉴 보강 결과 (POST /api/menu/enrich)
  representativeMenus: string[] // 대표 메뉴 1~3개
  tags: ExcludeTag[]            // AI가 분류한 음식 특성 태그 (필터링에 활용)
  excluded: boolean             // customExcludes 기준 AI 제외 판정 결과
  description: string | null    // 한 줄 설명
  bestReview: {                 // Google Places 베스트 리뷰 (별점 높은 순 1개)
    text: string
    rating: number
    authorName: string
  } | null
}

// ─── API 요청/응답 타입 ───────────────────────────────────────────

export interface SearchParams {
  lat: number
  lng: number
  radius: Radius
  priceBand: PriceBand | null
  excludeTags: ExcludeTag[]
}

export interface SearchResponse {
  restaurants: Restaurant[]
}

// ─── 사용자 설정 타입 ─────────────────────────────────────────────

export interface UserPreference {
  excludeTags: ExcludeTag[]
  defaultRadiusM: Radius   // backend와 필드명 통일
  defaultPriceBand: PriceBand | null
}
