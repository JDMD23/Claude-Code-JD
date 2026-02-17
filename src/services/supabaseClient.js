import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://rahvxwwkpzujcnsfjahz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhaHZ4d3drcHp1amNuc2ZqYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDU2MDUsImV4cCI6MjA4NjkyMTYwNX0.scIzgjET4Aaz8Tz91EG7SapKnDpS2lXqa_GflhkRh9s'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
