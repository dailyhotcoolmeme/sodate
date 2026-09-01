export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface ParticipantPerson {
  birth_year?: number
  generation?: string  // "90중반", "90초반" 등
  job?: string
  height?: number
}

export interface ParticipantStats {
  male?: ParticipantPerson[]
  female?: ParticipantPerson[]
  total_count?: number
  seats_left_male?: number
  seats_left_female?: number
  // 소셜링(2026-08-21) — 성별 정원이 없는 소스(문토 취미·동행클럽)의 총 인원 현황.
  total_capacity?: number
  male_count?: number
  female_count?: number
}

// 성별 가격 티어(정가/얼리버드/품절). 에모셔널오렌지 자동크롤 전용. null=단일가.
export interface GenderPriceDetail {
  regular?: number
  regular_soldout?: boolean
  earlybird?: number
  earlybird_soldout?: boolean
}
export interface PriceDetail {
  male?: GenderPriceDetail
  female?: GenderPriceDetail
}

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          slug: string
          name: string
          logo_url: string | null
          base_url: string
          crawl_url: string
          crawl_type: 'static' | 'dynamic' | 'api'
          regions: string[]
          description: string | null
          instagram_url: string | null
          is_active: boolean
          /** 'free' | 'partner' — partner 면 일정에 '모잇 할인' 딱지가 붙는다(2026-09-02) */
          plan: string
          /** 제휴 혜택 문구(예: '5,000원 할인'). 비면 앱에서 혜택 줄을 안 그린다 */
          partner_benefit: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          logo_url?: string | null
          base_url: string
          crawl_url: string
          crawl_type: 'static' | 'dynamic' | 'api'
          regions?: string[]
          description?: string | null
          instagram_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          logo_url?: string | null
          base_url?: string
          crawl_url?: string
          crawl_type?: 'static' | 'dynamic' | 'api'
          regions?: string[]
          description?: string | null
          instagram_url?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      events: {
        Row: {
          id: string
          company_id: string
          external_id: string | null
          title: string
          description: string | null
          thumbnail_urls: string[]
          event_date: string
          location_region: string
          location_detail: string | null
          price_male: number | null
          price_female: number | null
          price_detail: PriceDetail | null
          gender_ratio: string | null
          capacity_male: number | null
          capacity_female: number | null
          seats_left_male: number | null
          seats_left_female: number | null
          theme: string[]
          age_range_min: number | null
          age_range_max: number | null
          age_male: string | null
          age_female: string | null
          hashtags: string[]
          // 2026-08-14: 모임 피드 검색용. hashtags(배열)의 ilike 부분일치가 안 돼 문자열로
          // 합쳐둔 트리거 동기화 컬럼(supabase/migrations/20260814_events_search_fields.sql).
          hashtags_search: string | null
          // 조인 없이 companies.name을 ilike로 검색하기 위한 트리거 동기화 컬럼(위와 동일 이유).
          company_name: string | null
          format: string | null
          source_url: string
          is_closed: boolean
          is_active: boolean
          participant_stats: ParticipantStats | null
          image_type_id: string | null
          attendee_image_url: string | null
          // 소셜링 확장(2026-08-21). event_type 으로 앱 탭이 나뉜다(dating=소개팅 / socialing=소셜링).
          event_type: string
          socialing_category: string | null
          crawled_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          external_id?: string | null
          title: string
          description?: string | null
          thumbnail_urls?: string[]
          event_date: string
          location_region: string
          location_detail?: string | null
          price_male?: number | null
          price_female?: number | null
          price_detail?: PriceDetail | null
          gender_ratio?: string | null
          capacity_male?: number | null
          capacity_female?: number | null
          seats_left_male?: number | null
          seats_left_female?: number | null
          theme?: string[]
          age_range_min?: number | null
          age_range_max?: number | null
          age_male?: string | null
          age_female?: string | null
          hashtags?: string[]
          hashtags_search?: string | null
          company_name?: string | null
          format?: string | null
          source_url: string
          is_closed?: boolean
          is_active?: boolean
          participant_stats?: ParticipantStats | null
          image_type_id?: string | null
          attendee_image_url?: string | null
          crawled_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          external_id?: string | null
          title?: string
          description?: string | null
          thumbnail_urls?: string[]
          event_date?: string
          location_region?: string
          location_detail?: string | null
          price_male?: number | null
          price_female?: number | null
          price_detail?: PriceDetail | null
          gender_ratio?: string | null
          capacity_male?: number | null
          capacity_female?: number | null
          seats_left_male?: number | null
          seats_left_female?: number | null
          theme?: string[]
          age_range_min?: number | null
          age_range_max?: number | null
          age_male?: string | null
          age_female?: string | null
          hashtags?: string[]
          hashtags_search?: string | null
          company_name?: string | null
          format?: string | null
          source_url?: string
          is_closed?: boolean
          is_active?: boolean
          participant_stats?: ParticipantStats | null
          image_type_id?: string | null
          attendee_image_url?: string | null
          crawled_at?: string
          created_at?: string
          updated_at?: string
        }
      }
      company_image_types: {
        Row: {
          id: string
          company_id: string
          name: string
          images: string[]
          is_default: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          images?: string[]
          is_default?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          images?: string[]
          is_default?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
      }
      push_tokens: {
        Row: {
          id: string
          token: string
          platform: 'ios' | 'android' | null
          created_at: string
          last_seen_at: string
        }
        Insert: {
          id?: string
          token: string
          platform?: 'ios' | 'android' | null
          created_at?: string
          last_seen_at?: string
        }
        Update: {
          id?: string
          token?: string
          platform?: 'ios' | 'android' | null
          created_at?: string
          last_seen_at?: string
        }
      }
      alert_subscriptions: {
        Row: {
          id: string
          push_token_id: string
          regions: string[] | null
          max_price: number | null
          themes: string[] | null
          company_ids: string[] | null
          notify_new: boolean
          notify_deadline: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          push_token_id: string
          regions?: string[] | null
          max_price?: number | null
          themes?: string[] | null
          company_ids?: string[] | null
          notify_new?: boolean
          notify_deadline?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          push_token_id?: string
          regions?: string[] | null
          max_price?: number | null
          themes?: string[] | null
          company_ids?: string[] | null
          notify_new?: boolean
          notify_deadline?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      favorites: {
        Row: {
          id: string
          device_id: string
          event_id: string
          created_at: string
        }
        Insert: {
          id?: string
          device_id: string
          event_id: string
          created_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          event_id?: string
          created_at?: string
        }
      }
      board_posts: {
        Row: {
          id: string
          nickname: string
          title: string
          content: string
          content_below: string | null
          image_urls: string[] | null
          link_urls: string[] | null
          owner_token: string
          tag_id: string | null
          upvotes: number
          downvotes: number
          comment_count: number
          view_count: number
          report_count: number
          content_report_count: number
          is_active: boolean
          content_hidden: boolean
          /** 공지글. 목록 맨 위에 고정되고 추천·비추천 버튼이 숨겨진다(admin 에서만 지정). */
          is_notice: boolean
          created_at: string
          updated_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      board_tags: {
        Row: {
          id: string
          label: string
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      board_comments: {
        Row: {
          id: string
          post_id: string
          parent_id: string | null
          nickname: string
          /** 비밀 댓글이면 빈 문자열. 실제 본문은 secret_content 에 있고 앱은 읽을 권한이 없다. */
          content: string
          content_below?: string | null
          owner_token: string
          is_secret: boolean
          report_count: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      board_votes: {
        Row: { post_id: string; owner_token: string; value: number; created_at: string }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      board_settings: {
        Row: {
          id: boolean
          hide_post_reports: number
          hide_image_reports: number
          hide_comment_reports: number
          hot_upvotes: number
          cold_downvotes: number
          post_cooldown_seconds: number
          comment_cooldown_seconds: number
          updated_at: string
        }
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
      }
      reviews: {
        Row: {
          id: string
          company_id: string
          source: 'naver_blog' | 'instagram' | 'kakao' | 'manual' | 'user' | 'youtube'
          author_name: string | null
          author_url: string | null
          content: string
          rating: number | null
          thumbnail_url: string | null
          source_url: string | null
          published_at: string | null
          is_active: boolean
          crawled_at: string
          created_at: string
          owner_token: string | null
          report_count: number | null
          gender: 'male' | 'female' | null
          event_id: string | null
          event_title: string | null
        }
        Insert: {
          id?: string
          company_id: string
          source: 'naver_blog' | 'instagram' | 'kakao' | 'manual' | 'user' | 'youtube'
          author_name?: string | null
          author_url?: string | null
          content: string
          rating?: number | null
          thumbnail_url?: string | null
          source_url?: string | null
          published_at?: string | null
          is_active?: boolean
          crawled_at?: string
          created_at?: string
          owner_token?: string | null
          report_count?: number | null
          gender?: 'male' | 'female' | null
          event_id?: string | null
          event_title?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          source?: 'naver_blog' | 'instagram' | 'kakao' | 'manual' | 'user' | 'youtube'
          author_name?: string | null
          author_url?: string | null
          content?: string
          rating?: number | null
          thumbnail_url?: string | null
          source_url?: string | null
          published_at?: string | null
          is_active?: boolean
          crawled_at?: string
          created_at?: string
          owner_token?: string | null
          report_count?: number | null
          gender?: 'male' | 'female' | null
          event_id?: string | null
          event_title?: string | null
        }
      }
      crawl_logs: {
        Row: {
          id: string
          company_id: string
          status: 'success' | 'partial' | 'failed'
          events_found: number
          events_new: number
          events_updated: number
          error_message: string | null
          duration_ms: number | null
          executed_at: string
        }
        Insert: {
          id?: string
          company_id: string
          status: 'success' | 'partial' | 'failed'
          events_found?: number
          events_new?: number
          events_updated?: number
          error_message?: string | null
          duration_ms?: number | null
          executed_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          status?: 'success' | 'partial' | 'failed'
          events_found?: number
          events_new?: number
          events_updated?: number
          error_message?: string | null
          duration_ms?: number | null
          executed_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// ─── 편의 타입 ───────────────────────────────────────────────────────────────
export type Company = Database['public']['Tables']['companies']['Row']
export type CompanyInsert = Database['public']['Tables']['companies']['Insert']
export type CompanyUpdate = Database['public']['Tables']['companies']['Update']

export type Event = Database['public']['Tables']['events']['Row']
export type EventInsert = Database['public']['Tables']['events']['Insert']
export type EventUpdate = Database['public']['Tables']['events']['Update']

export type PushToken = Database['public']['Tables']['push_tokens']['Row']
export type PushTokenInsert = Database['public']['Tables']['push_tokens']['Insert']
export type PushTokenUpdate = Database['public']['Tables']['push_tokens']['Update']

export type AlertSubscription = Database['public']['Tables']['alert_subscriptions']['Row']
export type AlertSubscriptionInsert = Database['public']['Tables']['alert_subscriptions']['Insert']
export type AlertSubscriptionUpdate = Database['public']['Tables']['alert_subscriptions']['Update']

export type CrawlLog = Database['public']['Tables']['crawl_logs']['Row']
export type CrawlLogInsert = Database['public']['Tables']['crawl_logs']['Insert']
export type CrawlLogUpdate = Database['public']['Tables']['crawl_logs']['Update']

export type Review = Database['public']['Tables']['reviews']['Row']
export type ReviewInsert = Database['public']['Tables']['reviews']['Insert']

// ─── 도메인 상수 ─────────────────────────────────────────────────────────────
export const REGIONS = [
  '강남', '역삼', '선릉', '삼성',
  '홍대', '신촌', '연남',
  '을지로', '종로', '광화문',
  '잠실', '건대', '성수',
  '이태원', '한남',
  '수원', '판교', '분당',
  '인천',
  '대전',
  '기타',
] as const

export type Region = typeof REGIONS[number]

export const THEMES = [
  '와인',
  '커피',
  '에세이',
  '전시',
  '사주',
  '보드게임',
  '쿠킹',
  '일반',
] as const

export type Theme = typeof THEMES[number]

// ─── pgmq 메시지 타입 ────────────────────────────────────────────────────────
export interface PushNotificationMessage {
  type: 'new_event' | 'deadline_reminder'
  event_id: string
  event_title: string
  event_date: string
  location_region: string
  company_name: string
  source_url: string
  target_tokens: string[]
}
