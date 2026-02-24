import type { Restaurant, PriceBand } from '@/types'

const PRICE_BAND_LABEL: Record<PriceBand, string> = {
  under_10k: '1만원 이하',
  '10_15k': '1~1.5만원',
  over_15k: '1.5만원 이상',
}

interface Props {
  restaurant: Restaurant
  menuLoading?: boolean
}

export function RestaurantCard({ restaurant, menuLoading = false }: Props) {
  const {
    name,
    category,
    distanceM,
    rating,
    userRatingsTotal,
    priceBand,
    photoUrl,
    mapUrl,
    representativeMenus,
    description,
  } = restaurant

  const distanceLabel =
    distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)}km` : `${distanceM}m`

  return (
    <div className="bg-white dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] rounded-[16px] overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] flex flex-col">
      {/* 음식점 사진 */}
      {photoUrl ? (
        <div className="w-full h-36 bg-[#F5F5F4] dark:bg-[#292524]">
          <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-full h-36 bg-[#F5F5F4] dark:bg-[#292524] flex items-center justify-center text-4xl">
          🍽️
        </div>
      )}

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* 카테고리 + 거리 */}
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#F97316] bg-[#FFF7ED] dark:bg-[#431407] px-2 py-0.5 rounded-[6px] font-medium">
            {category}
          </span>
          <span className="text-[12px] text-[#78716C] dark:text-[#A8A29E]">
            📍 {distanceLabel}
          </span>
        </div>

        {/* 음식점명 + 설명 */}
        <div>
          <h3 className="text-[20px] font-bold text-[#1C1917] dark:text-[#FAFAF9] leading-tight">
            {name}
          </h3>
          {description && (
            <p className="text-[14px] text-[#78716C] dark:text-[#A8A29E] mt-1">{description}</p>
          )}
        </div>

        {/* 대표 메뉴 */}
        {menuLoading ? (
          <div className="h-4 bg-[#F5F5F4] dark:bg-[#292524] rounded-full animate-pulse w-3/4" />
        ) : representativeMenus.length > 0 ? (
          <p className="text-[14px] text-[#78716C] dark:text-[#A8A29E]">
            🍴 {representativeMenus.join(' · ')}
          </p>
        ) : null}

        {/* 베스트 리뷰 */}
        {restaurant.bestReview && (
          <div className="bg-[#FFFBEB] dark:bg-[#1C1407] p-3 rounded-[10px]">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[12px]">⭐ {restaurant.bestReview.rating.toFixed(1)}</span>
              <span className="text-[12px] text-[#A8A29E]">— {restaurant.bestReview.authorName}</span>
            </div>
            <p className="text-[13px] text-[#78716C] dark:text-[#A8A29E] line-clamp-2">
              &ldquo;{restaurant.bestReview.text}&rdquo;
            </p>
          </div>
        )}

        {/* 평점 + 가격 */}
        <div className="flex items-center gap-3 text-[12px] text-[#78716C] dark:text-[#A8A29E]">
          <span>⭐ {rating.toFixed(1)} ({userRatingsTotal.toLocaleString()})</span>
          {priceBand
            ? <span>💰 {PRICE_BAND_LABEL[priceBand]}</span>
            : <span className="text-[#A8A29E] dark:text-[#57534E]">가격 미확인</span>
          }
        </div>

        {/* 지도 링크 */}
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[14px] text-[#F97316] font-medium text-right mt-auto hover:underline"
        >
          지도에서 보기 →
        </a>
      </div>
    </div>
  )
}
