import { NextRequest, NextResponse } from 'next/server'

const VALID_TAGS = [
  'spicy','raw','coriander','offal','mala','dairy','gluten',
  'pork','seafood','chicken','beef','egg','nuts','soy',
] as const

const VALID_CATEGORIES = [
  '한식','중식','일식','양식','분식','아시안','패스트푸드','카페/브런치',
] as const

// ── OpenAI gpt-4o-mini를 이용한 대표 메뉴 + 태그 + 제외 판정 ────────────
export async function POST(request: NextRequest) {
  let body: {
    name?: string
    category?: string
    address?: string
    excludeKeywords?: string[]
    excludeTags?: string[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: '잘못된 요청 형식이에요.' }, { status: 400 })
  }

  const { name, category, address, excludeKeywords, excludeTags } = body
  if (!name || !category) {
    return NextResponse.json({ message: '음식점 정보가 필요합니다.' }, { status: 400 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ message: 'AI 서비스 키가 설정되지 않았어요.' }, { status: 500 })
  }

  // 제외 키워드(기타 직접 입력)가 있으면 판정 지시
  const exclusionInstruction =
    excludeKeywords && excludeKeywords.length > 0
      ? `사용자가 원하지 않는 음식/식당 종류: [${excludeKeywords.join(', ')}]\n` +
        '이 음식점이 해당 조건에 해당하면 excluded: true로 설정하세요.\n'
      : ''

  // 제외 태그(칩 선택)가 있으면 판정 지시 추가
  const tagExclusionInstruction =
    excludeTags && excludeTags.length > 0
      ? `사용자가 제외한 음식 특성 태그: [${excludeTags.join(', ')}]\n` +
        '이 음식점의 대표 메뉴가 해당 태그에 해당하면 excluded: true로 설정하세요.\n'
      : ''

  const systemContent =
    '당신은 한국 음식점 분석 전문가입니다. 주어진 음식점의 대표 메뉴 3~5개, 음식 특성 태그, 그리고 정확한 음식 카테고리를 분석해주세요.\n' +
    '태그는 아래 목록 중 해당하는 것만 선택하세요 (영문 키값 그대로 사용):\n' +
    '  spicy(매운 음식), raw(날 음식·회), coriander(고수), offal(내장류),\n' +
    '  mala(마라·강한향신료), dairy(유제품), gluten(밀가루·글루텐),\n' +
    '  pork(돼지고기), seafood(해산물), chicken(닭고기), beef(소고기),\n' +
    '  egg(계란), nuts(견과류), soy(콩·두부)\n' +
    '카테고리는 아래 목록 중 하나를 선택하세요:\n' +
    '  한식, 중식, 일식, 양식, 분식, 아시안, 패스트푸드, 카페/브런치\n' +
    '음식점명과 메뉴를 기반으로 가장 정확한 카테고리를 판단하세요. 제공된 카테고리가 틀릴 수 있으니 음식점명과 메뉴로 직접 판단하세요.\n' +
    exclusionInstruction +
    tagExclusionInstruction +
    '반드시 다음 JSON 형식으로만 응답하세요:\n' +
    '{"menus": ["메뉴1", "메뉴2", "메뉴3"], "tags": ["pork", "spicy"], "excluded": false, "category": "양식"}'

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          {
            role: 'user',
            content: [
              `음식점명: ${name}`,
              `카테고리: ${category}`,
              address ? `주소: ${address}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 250,
        temperature: 0.3,
      }),
    })
  } catch (err) {
    console.error('[Menu Enrich] 네트워크 오류:', err)
    return NextResponse.json({ message: 'AI 서비스 연결 오류가 발생했어요.' }, { status: 502 })
  }

  if (!res.ok) {
    const errorText = await res.text()
    console.error('[Menu Enrich] OpenAI 오류:', errorText)
    return NextResponse.json({ message: 'AI 메뉴 생성에 실패했어요.' }, { status: 502 })
  }

  const data = await res.json()
  let menus: string[] = []
  let tags: string[] = []
  let excluded = false
  let correctedCategory: string | null = null
  try {
    const content: string = data.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(content) as { menus?: unknown; tags?: unknown; excluded?: unknown; category?: unknown }
    menus = Array.isArray(parsed.menus) ? (parsed.menus as string[]).slice(0, 5) : []
    tags = Array.isArray(parsed.tags)
      ? (parsed.tags as string[]).filter((t) => (VALID_TAGS as readonly string[]).includes(t))
      : []
    excluded = parsed.excluded === true
    // GPT가 판단한 카테고리 검증
    if (typeof parsed.category === 'string' && (VALID_CATEGORIES as readonly string[]).includes(parsed.category)) {
      correctedCategory = parsed.category
    }
  } catch {
    console.error('[Menu Enrich] 응답 파싱 오류:', data)
    menus = []
    tags = []
    excluded = false
  }

  // 서버 측 이중 체크: GPT가 excluded를 놓쳤더라도 태그 교집합으로 강제 제외
  if (!excluded && excludeTags && excludeTags.length > 0) {
    if (tags.some((t) => excludeTags.includes(t))) {
      excluded = true
    }
  }

  return NextResponse.json({ menus, tags, excluded, category: correctedCategory })
}
