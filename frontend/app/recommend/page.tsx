'use client'

import { useState, useCallback, useEffect } from 'react'
import { Header } from '@/components/layout/Header'
import { PrimaryButton } from '@/components/ui/PrimaryButton'
import { FilterChip } from '@/components/ui/FilterChip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { RestaurantCard } from '@/components/ui/RestaurantCard'
import { SkeletonCard } from '@/components/ui/SkeletonCard'
import { LocationSelector } from '@/components/ui/LocationSelector'
import type { LocationInfo } from '@/components/ui/LocationSelector'
import type { Radius, PriceBand, ExcludeTag, Restaurant } from '@/types'
import { EXCLUDE_TAG_LABEL, PRICE_BAND_LABEL } from '@/types'

// ── 필터 옵션 ─────────────────────────────────────────────────────────
const RADIUS_OPTIONS: { label: string; value: Radius }[] = [
  { label: '3분',  value: 300 },
  { label: '5분',  value: 500 },
  { label: '10분', value: 700 },
  { label: '15분', value: 1000 },
]

const PRICE_OPTIONS: { label: string; value: PriceBand | 'all' }[] = [
  { label: '전체',                        value: 'all' },
  { label: PRICE_BAND_LABEL['under_10k'], value: 'under_10k' },
  { label: PRICE_BAND_LABEL['10_15k'],    value: '10_15k' },
  { label: PRICE_BAND_LABEL['over_15k'],  value: 'over_15k' },
]

const ALL_EXCLUDE_TAGS = Object.keys(EXCLUDE_TAG_LABEL) as ExcludeTag[]

const LIKED_STORAGE_KEY = 'jummaechu_liked'

// ── localStorage 좋아요 기록 읽기/쓰기 ─────────────────────────────────
function loadLikedFromStorage(): Restaurant[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(LIKED_STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

function saveLikedToStorage(liked: Restaurant[]) {
  try {
    localStorage.setItem(LIKED_STORAGE_KEY, JSON.stringify(liked))
  } catch { /* 용량 초과 등 무시 */ }
}

// ── Haversine 거리 계산 (m 단위) ─────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── 랭킹: 거리 + 평점 동일 가중치 (PRD §3) ──────────────────────────
function rankRestaurants(list: Restaurant[]): Restaurant[] {
  if (list.length === 0) return []
  const maxDist = Math.max(...list.map((r) => r.distanceM))
  const minDist = Math.min(...list.map((r) => r.distanceM))
  const maxRating = Math.max(...list.map((r) => r.rating))
  const minRating = Math.min(...list.map((r) => r.rating))
  const distRange = maxDist - minDist || 1
  const ratingRange = maxRating - minRating || 1
  return [...list].sort((a, b) => {
    const scoreDistA = 1 - (a.distanceM - minDist) / distRange
    const scoreDistB = 1 - (b.distanceM - minDist) / distRange
    const scoreRatingA = (a.rating - minRating) / ratingRange
    const scoreRatingB = (b.rating - minRating) / ratingRange
    return (0.5 * scoreDistB + 0.5 * scoreRatingB) - (0.5 * scoreDistA + 0.5 * scoreRatingA)
  })
}

// ── 가중치 랜덤 선택 ──────────────────────────────────────────────────
// excludeTags 교집합, excluded, 싫어요 카테고리 감소, 좋아요 카테고리 부스트
function pickWeighted(
  pool: Restaurant[],
  shown: Set<string>,
  dislikedCats: Record<string, number>,
  userExcludeTags: Set<ExcludeTag>,
  likedCats?: Record<string, number>,
): Restaurant | null {
  const available = pool.filter((r) => {
    if (shown.has(r.placeId)) return false
    if (r.excluded) return false
    // 칩 태그와 GPT 태그 교집합 → 제외 (enrichment 완료된 경우만)
    if (r.tags.length > 0 && r.tags.some((t) => userExcludeTags.has(t))) return false
    return true
  })
  if (available.length === 0) return null

  const weights = available.map((r) => {
    let w = Math.max(0.1, 1 / (1 + (dislikedCats[r.category] ?? 0) * 0.7))
    // 이전 좋아요 카테고리 부스트 (#6)
    if (likedCats) {
      const likeCount = likedCats[r.category] ?? 0
      if (likeCount > 0) w *= Math.pow(1.3, Math.min(likeCount, 5))
    }
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let rand = Math.random() * total
  for (let i = 0; i < available.length; i++) {
    rand -= weights[i]
    if (rand <= 0) return available[i]
  }
  return available[available.length - 1]
}

// ── 풀 소진 시 카테고리별 Top 3 선택 (#6) ────────────────────────────
function pickTop3ByCategory(liked: Restaurant[]): Restaurant[] {
  if (liked.length === 0) return []
  // 카테고리별 그룹화
  const groups: Record<string, Restaurant[]> = {}
  for (const r of liked) {
    if (!groups[r.category]) groups[r.category] = []
    groups[r.category].push(r)
  }
  // 가장 많은 카테고리 순으로 정렬
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  // 상위 3개 카테고리에서 각각 rating 가장 높은 1개
  return sorted.slice(0, 3).map(([, restaurants]) =>
    restaurants.sort((a, b) => b.rating - a.rating)[0]
  )
}

// ── 좋아요 카테고리 빈도 계산 ────────────────────────────────────────
function countLikedCategories(liked: Restaurant[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of liked) {
    counts[r.category] = (counts[r.category] ?? 0) + 1
  }
  return counts
}

type Step = 'filter' | 'loading' | 'tinder' | 'empty'

// ── 메인 페이지 ───────────────────────────────────────────────────────
export default function RecommendPage() {
  const [step, setStep] = useState<Step>('filter')
  const [location, setLocation] = useState<LocationInfo | null>(null)
  const [radius, setRadius] = useState<Radius>(500)
  const [priceBand, setPriceBand] = useState<PriceBand | 'all'>('all')
  const [excludeTags, setExcludeTags] = useState<Set<ExcludeTag>>(new Set())
  const [customExcludes, setCustomExcludes] = useState<string[]>([])
  const [customInput, setCustomInput] = useState('')

  const [candidatePool, setCandidatePool] = useState<Restaurant[]>([])
  const [currentCard, setCurrentCard] = useState<Restaurant | null>(null)
  const [shownIds, setShownIds] = useState<Set<string>>(new Set())
  // 카테고리별 싫어요 횟수 → 가중치 랜덤 선택에 사용
  const [dislikedCategories, setDislikedCategories] = useState<Record<string, number>>({})
  // AI 메뉴 보강 중인 placeId 집합
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set())
  // 좋아요 누른 식당 목록 — localStorage에서 초기화 (#6)
  const [likedRestaurants, setLikedRestaurants] = useState<Restaurant[]>([])
  const [apiError, setApiError] = useState<string | null>(null)

  // localStorage에서 좋아요 기록 로드 (클라이언트 전용)
  useEffect(() => {
    setLikedRestaurants(loadLikedFromStorage())
  }, [])

  const toggleTag = (tag: ExcludeTag) => {
    setExcludeTags((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  const addCustomExclude = () => {
    const item = customInput.trim()
    if (!item || customExcludes.includes(item)) {
      setCustomInput('')
      return
    }
    setCustomExcludes((prev) => [...prev, item])
    setCustomInput('')
  }

  // 단일 식당 enrichment (await 가능) — #8 레이스 컨디션 해결용
  const enrichSingle = useCallback(async (
    r: Restaurant,
    tags: Set<ExcludeTag>,
    keywords: string[],
  ): Promise<Restaurant> => {
    try {
      const res = await fetch('/api/menu/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: r.name,
          category: r.category,
          address: r.address,
          excludeKeywords: keywords.length > 0 ? keywords : undefined,
          excludeTags: tags.size > 0 ? [...tags] : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json() as { menus?: string[]; tags?: ExcludeTag[]; excluded?: boolean; category?: string }
        return {
          ...r,
          representativeMenus: data.menus ?? [],
          tags: data.tags ?? [],
          excluded: data.excluded ?? false,
          // GPT가 교정한 카테고리 반영 (Google Places 분류가 부정확할 수 있음)
          ...(data.category && { category: data.category as Restaurant['category'] }),
        }
      }
    } catch { /* 개별 실패 무시 */ }
    return r
  }, [])

  // 배경 enrichment — 나머지 후보를 3개씩 배치로 점진적으로 보강
  const enrichBackground = useCallback(async (
    restaurants: Restaurant[],
    tags: Set<ExcludeTag>,
    keywords: string[],
  ) => {
    setEnrichingIds(new Set(restaurants.map((r) => r.placeId)))
    const BATCH_SIZE = 3
    for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
      const batch = restaurants.slice(i, i + BATCH_SIZE)
      await Promise.allSettled(
        batch.map(async (r) => {
          const enriched = await enrichSingle(r, tags, keywords)
          setCandidatePool((prev) =>
            prev.map((item) =>
              item.placeId === r.placeId ? enriched : item,
            ),
          )
          // enrichment 완료 후 현재 카드가 제외 대상이면 자동 스킵 (#8-D)
          if (enriched.excluded || enriched.tags.some((t) => tags.has(t as ExcludeTag))) {
            setCurrentCard((prev) => {
              if (prev?.placeId === r.placeId) {
                return null // useEffect에서 처리
              }
              return prev
            })
          }
          setEnrichingIds((prev) => {
            const next = new Set(prev)
            next.delete(r.placeId)
            return next
          })
        }),
      )
    }
  }, [enrichSingle])

  // 현재 카드가 null이 되면 (제외로 인해) 다음 카드 자동 선택
  useEffect(() => {
    if (step === 'tinder' && currentCard === null) {
      const next = pickWeighted(candidatePool, shownIds, dislikedCategories, excludeTags)
      if (next) {
        setCurrentCard(next)
      } else {
        setStep('empty')
      }
    }
  }, [step, currentCard, candidatePool, shownIds, dislikedCategories, excludeTags])

  const recommend = useCallback(async () => {
    if (!location) return
    setStep('loading')
    setApiError(null)
    setShownIds(new Set())
    setDislikedCategories({})
    // #6: 좋아요 기록은 초기화하지 않음 (localStorage 유지)

    try {
      const params = new URLSearchParams({
        lat: String(location.lat),
        lng: String(location.lng),
        radius: String(radius),
        ...(priceBand !== 'all' && { priceBand }),
      })
      const res = await fetch(`/api/places/search?${params}`)
      const data: { restaurants?: Restaurant[]; message?: string } = await res.json()

      if (!res.ok) {
        setApiError(data.message ?? '음식점 검색에 실패했어요.')
        setStep('filter')
        return
      }

      let filtered: Restaurant[] = data.restaurants ?? []

      // 가격대 클라이언트 이중 필터 (서버에서도 처리하지만 안전장치)
      if (priceBand !== 'all') {
        filtered = filtered.filter((r) => r.priceBand === priceBand || r.priceBand === null)
      }

      // 랭킹 후 가격 정보 없는 곳 후순위
      const ranked = rankRestaurants(filtered)
      if (priceBand !== 'all') {
        ranked.sort((a, b) => {
          if (a.priceBand === null && b.priceBand !== null) return 1
          if (a.priceBand !== null && b.priceBand === null) return -1
          return 0
        })
      }

      setCandidatePool(ranked)

      // #8-E: 첫 카드를 enrichment 완료 후 표시 (레이스 컨디션 해결)
      const localShown = new Set<string>()
      let first: Restaurant | null = null

      for (const candidate of ranked) {
        const enriched = await enrichSingle(candidate, excludeTags, customExcludes)
        // candidatePool에 enrichment 결과 반영
        setCandidatePool((prev) =>
          prev.map((item) => item.placeId === candidate.placeId ? enriched : item),
        )
        // 제외 체크
        if (enriched.excluded || enriched.tags.some((t) => excludeTags.has(t as ExcludeTag))) {
          localShown.add(candidate.placeId)
          continue
        }
        first = enriched
        break
      }

      if (!first) {
        setApiError('조건에 맞는 음식점이 없어요. 필터를 조정해보세요.')
        setStep('filter')
        return
      }

      setCurrentCard(first)
      setShownIds(new Set([...localShown, first.placeId]))
      setStep('tinder')

      // 나머지 후보는 백그라운드 enrichment
      const remaining = ranked.filter(
        (r) => r.placeId !== first!.placeId && !localShown.has(r.placeId)
      )
      if (remaining.length > 0) {
        enrichBackground(remaining, excludeTags, customExcludes)
      }
    } catch {
      setApiError('네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.')
      setStep('filter')
    }
  }, [location, radius, priceBand, excludeTags, customExcludes, enrichSingle, enrichBackground])

  // 좋아요 카테고리 빈도 (가중치 부스트용)
  const likedCats = countLikedCategories(likedRestaurants)

  // 좋아요 — Google Maps 열고 다음 카드
  const handleLike = useCallback(() => {
    if (!currentCard) return
    window.open(currentCard.mapUrl, '_blank')
    // 좋아요 목록에 저장 + localStorage 업데이트 (#6)
    setLikedRestaurants((prev) => {
      const updated = [...prev, currentCard]
      saveLikedToStorage(updated)
      return updated
    })
    const newShown = new Set([...shownIds, currentCard.placeId])
    setShownIds(newShown)
    const next = pickWeighted(candidatePool, newShown, dislikedCategories, excludeTags, likedCats)
    if (next) {
      setCurrentCard(next)
    } else {
      setStep('empty')
    }
  }, [currentCard, shownIds, dislikedCategories, candidatePool, excludeTags, likedCats])

  // 싫어요 — 카테고리 가중치 낮추고 다음 카드
  const handleDislike = useCallback(() => {
    if (!currentCard) return
    const newDislikedCats = {
      ...dislikedCategories,
      [currentCard.category]: (dislikedCategories[currentCard.category] ?? 0) + 1,
    }
    const newShown = new Set([...shownIds, currentCard.placeId])
    setDislikedCategories(newDislikedCats)
    setShownIds(newShown)
    const next = pickWeighted(candidatePool, newShown, newDislikedCats, excludeTags, likedCats)
    if (next) {
      setCurrentCard(next)
    } else {
      setStep('empty')
    }
  }, [currentCard, shownIds, dislikedCategories, candidatePool, excludeTags, likedCats])

  // 남은 카드 수 (excluded + 태그 매칭 제외)
  const remaining = candidatePool.filter((r) => {
    if (shownIds.has(r.placeId)) return false
    if (r.excluded) return false
    if (r.tags.length > 0 && r.tags.some((t) => excludeTags.has(t))) return false
    return true
  }).length

  // 풀 소진 시 카테고리별 Top 3 (#6)
  const top3Liked = pickTop3ByCategory(likedRestaurants)

  return (
    <div className="min-h-screen bg-[#FAFAF9] dark:bg-[#0C0A09]">
      <Header />

      {/* ── 필터 단계 ─────────────────────────────────────── */}
      {step === 'filter' && (
        <main className="max-w-[480px] mx-auto px-4 py-6 pb-28 space-y-6">
          <LocationSelector value={location} onChange={setLocation} />

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">도보 시간</h2>
            <SegmentedControl options={RADIUS_OPTIONS} value={radius} onChange={setRadius} />
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">가격대</h2>
            <SegmentedControl options={PRICE_OPTIONS} value={priceBand} onChange={setPriceBand} />
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              못 먹거나 싫어하는 음식
            </h2>
            <div className="flex flex-wrap gap-2">
              {ALL_EXCLUDE_TAGS.map((tag) => (
                <FilterChip
                  key={tag}
                  label={EXCLUDE_TAG_LABEL[tag]}
                  selected={excludeTags.has(tag)}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomExclude() }}
                  placeholder="기타 직접 입력 (예: 제육볶음, 고수)"
                  className="flex-1 px-3 py-2.5 bg-[#F5F5F4] dark:bg-[#292524] rounded-[10px] text-[14px] text-[#1C1917] dark:text-[#FAFAF9] placeholder-[#D6D3D1] dark:placeholder-[#57534E] outline-none focus:ring-2 focus:ring-[#F97316]"
                />
                <button
                  onClick={addCustomExclude}
                  disabled={!customInput.trim()}
                  className="px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#292524] disabled:opacity-40 text-[#78716C] dark:text-[#A8A29E] rounded-[10px] text-[14px] font-medium transition-colors hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
                >
                  추가
                </button>
              </div>
              {customExcludes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customExcludes.map((item) => (
                    <span
                      key={item}
                      className="flex items-center gap-1 px-2.5 py-1 bg-[#FEF2F2] dark:bg-[#1C0A0A] border border-[#FECACA] dark:border-[#7F1D1D] rounded-full text-[13px] text-[#EF4444] font-medium"
                    >
                      {item}
                      <button
                        onClick={() => setCustomExcludes((prev) => prev.filter((e) => e !== item))}
                        className="text-[#EF4444]/60 hover:text-[#EF4444] leading-none ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-4 bg-[#FAFAF9]/90 dark:bg-[#0C0A09]/90 backdrop-blur-sm border-t border-[#E7E5E4] dark:border-[#44403C]">
            <div className="max-w-[480px] mx-auto space-y-2">
              {apiError && (
                <p className="text-[13px] text-[#EF4444] text-center px-1">{apiError}</p>
              )}
              <PrimaryButton onClick={recommend} disabled={!location}>
                {location ? '추천받기 →' : '위치를 먼저 설정해주세요'}
              </PrimaryButton>
            </div>
          </div>
        </main>
      )}

      {/* ── 로딩 단계 ─────────────────────────────────────── */}
      {step === 'loading' && (
        <main className="max-w-[480px] mx-auto px-4 py-6 space-y-4">
          <p className="text-[14px] text-[#78716C] dark:text-[#A8A29E] text-center">
            필터 조건 확인 중...
          </p>
          <SkeletonCard />
        </main>
      )}

      {/* ── 틴더 단계 ─────────────────────────────────────── */}
      {step === 'tinder' && currentCard && (
        <main className="max-w-[480px] mx-auto px-4 py-6 space-y-4">
          {/* 상단 상태 표시 */}
          <div className="flex items-center justify-between text-[13px] text-[#78716C] dark:text-[#A8A29E]">
            <button
              onClick={() => setStep('filter')}
              className="underline hover:text-[#1C1917] dark:hover:text-[#FAFAF9] transition-colors"
            >
              조건 변경
            </button>
            <span>{remaining}곳 남음</span>
          </div>

          {/* 식당 카드 */}
          <RestaurantCard
            restaurant={currentCard}
            menuLoading={enrichingIds.has(currentCard.placeId)}
          />

          {/* 싫어요 / 좋아요 버튼 */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleDislike}
              className="flex-1 h-[56px] rounded-[14px] bg-[#F5F5F4] dark:bg-[#292524] text-[#78716C] dark:text-[#A8A29E] text-[17px] font-semibold hover:bg-[#E7E5E4] dark:hover:bg-[#3C3837] active:scale-95 transition-all"
            >
              ✕
            </button>
            <button
              onClick={handleLike}
              className="flex-1 h-[56px] rounded-[14px] bg-[#F97316] hover:bg-[#EA580C] text-white text-[17px] font-semibold active:scale-95 transition-all"
            >
              ❤️ 지도 열기
            </button>
          </div>

          <p className="text-[12px] text-[#A8A29E] dark:text-[#57534E] text-center">
            추천 정보는 실제와 차이가 있을 수 있습니다.
          </p>
        </main>
      )}

      {/* ── 풀 소진 단계 ───────────────────────────────────── */}
      {step === 'empty' && (
        <main className="max-w-[480px] mx-auto px-4 py-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <span className="text-5xl">🍽️</span>
            <h2 className="text-[17px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              주변 식당을 모두 봤어요
            </h2>
            <p className="text-[14px] text-[#78716C] dark:text-[#A8A29E]">
              {top3Liked.length > 0
                ? '마음에 들었던 식당을 다시 확인해보세요'
                : '반경을 넓히거나 조건을 바꿔보세요'}
            </p>
          </div>

          {/* 카테고리별 Top 3 좋아요 식당 재표시 (#6) */}
          {top3Liked.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[15px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                좋아요한 식당
              </h3>
              {top3Liked.map((r) => (
                <button
                  key={r.placeId}
                  onClick={() => window.open(r.mapUrl, '_blank')}
                  className="w-full flex items-center gap-3 p-3 rounded-[12px] bg-[#F5F5F4] dark:bg-[#292524] hover:bg-[#E7E5E4] dark:hover:bg-[#3C3837] transition-colors text-left"
                >
                  {r.photoUrl && (
                    <img
                      src={r.photoUrl}
                      alt={r.name}
                      className="w-14 h-14 rounded-[8px] object-cover flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-[#1C1917] dark:text-[#FAFAF9] truncate">
                      {r.name}
                    </p>
                    <p className="text-[13px] text-[#78716C] dark:text-[#A8A29E]">
                      {r.category} · {r.distanceM}m
                    </p>
                  </div>
                  <span className="text-[13px] text-[#F97316] font-medium flex-shrink-0">
                    지도 →
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex justify-center">
            <button
              onClick={() => setStep('filter')}
              className="h-[52px] px-8 rounded-[12px] bg-[#F97316] hover:bg-[#EA580C] text-white text-[15px] font-semibold transition-colors"
            >
              조건 다시 설정
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
