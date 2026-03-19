import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

export type EventRow = Database['public']['Tables']['events']['Row']
export type CompanyRow = Database['public']['Tables']['companies']['Row']
export type ReviewRow = Database['public']['Tables']['reviews']['Row']
export type EventWithCompany = EventRow & { companies: CompanyRow | null }
