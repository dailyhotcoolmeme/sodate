export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
          gender_ratio: string | null
          capacity_male: number | null
          capacity_female: number | null
          seats_left_male: number | null
          seats_left_female: number | null
          theme: string[]
          age_range_min: number | null
          age_range_max: number | null
          format: string | null
          source_url: string
          is_closed: boolean
          is_active: boolean
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
          gender_ratio?: string | null
          capacity_male?: number | null
          capacity_female?: number | null
          seats_left_male?: number | null
          seats_left_female?: number | null
          theme?: string[]
          age_range_min?: number | null
          age_range_max?: number | null
          format?: string | null
          source_url: string
          is_closed?: boolean
          is_active?: boolean
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
          gender_ratio?: string | null
          capacity_male?: number | null
          capacity_female?: number | null
          seats_left_male?: number | null
          seats_left_female?: number | null
          theme?: string[]
          age_range_min?: number | null
          age_range_max?: number | null
          format?: string | null
          source_url?: string
          is_closed?: boolean
          is_active?: boolean
          crawled_at?: string
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
      reviews: {
        Row: {
          id: string
          company_id: string
          source: 'naver_blog' | 'instagram' | 'kakao' | 'manual'
          author_name: string | null
          author_url: string | null
          content: string
          rating: number | null
          thumbnail_url: string | null
          source_url: string
          published_at: string | null
          is_active: boolean
          crawled_at: string
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          source: 'naver_blog' | 'instagram' | 'kakao' | 'manual'
          author_name?: string | null
          author_url?: string | null
          content: string
          rating?: number | null
          thumbnail_url?: string | null
          source_url: string
          published_at?: string | null
          is_active?: boolean
          crawled_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          source?: 'naver_blog' | 'instagram' | 'kakao' | 'manual'
          author_name?: string | null
          author_url?: string | null
          content?: string
          rating?: number | null
          thumbnail_url?: string | null
          source_url?: string
          published_at?: string | null
          is_active?: boolean
          crawled_at?: string
          created_at?: string
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
