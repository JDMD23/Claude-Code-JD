-- ============================================================
-- NormanCRE / DealFlow - Supabase Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)
-- Project: rahvxwwkpzujcnsfjahz
-- ============================================================

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============ SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "proxyUrl" text DEFAULT '',
  "proxySecret" text DEFAULT '',
  "perplexityApiKey" text DEFAULT '',
  "apolloApiKey" text DEFAULT '',
  "exaApiKey" text DEFAULT '',
  "firecrawlApiKey" text DEFAULT '',
  "autoEnrich" boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ============ DEALS ============
CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name text DEFAULT '',
  deal_nickname text DEFAULT '',
  contact_name text DEFAULT '',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  square_footage text DEFAULT '',
  target_budget text DEFAULT '',
  target_date text,
  notes text DEFAULT '',
  stage text DEFAULT 'kickoff',
  stage_history jsonb DEFAULT '[]'::jsonb,
  prospect_id uuid,
  company_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ MASTER LIST ============
CREATE TABLE IF NOT EXISTS master_list (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "organizationName" text DEFAULT '',
  website text DEFAULT '',
  description text DEFAULT '',
  industries text DEFAULT '',
  headquarters text DEFAULT '',
  "employeeCount" text DEFAULT '',
  "totalFunding" text DEFAULT '',
  "lastFundingAmount" text DEFAULT '',
  "lastFundingType" text DEFAULT '',
  "lastFundingDate" text DEFAULT '',
  "foundedYear" text DEFAULT '',
  founders text DEFAULT '',
  "topInvestors" text DEFAULT '',
  "leadInvestors" text DEFAULT '',
  linkedin text DEFAULT '',
  "crunchbaseUrl" text DEFAULT '',
  "cbRank" text DEFAULT '',
  "fundingRounds" text DEFAULT '',
  tier text DEFAULT '',
  dossier jsonb,
  "enrichedAt" text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ CONTACTS ============
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  title text DEFAULT '',
  company text DEFAULT '',
  company_id uuid,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ PROSPECTS ============
CREATE TABLE IF NOT EXISTS prospects (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_name text DEFAULT '',
  contact_name text DEFAULT '',
  contact_email text DEFAULT '',
  contact_title text DEFAULT '',
  website text DEFAULT '',
  crm_stage text DEFAULT 'top_pursuits',
  prospect_status text DEFAULT '',
  master_list_id uuid,
  converted_to_deal_id uuid,
  notes jsonb DEFAULT '[]'::jsonb,
  description text DEFAULT '',
  industries text DEFAULT '',
  headquarters text DEFAULT '',
  employee_count text DEFAULT '',
  total_funding text DEFAULT '',
  added_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ COMMISSIONS ============
CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name text DEFAULT '',
  landlord_building text DEFAULT '',
  square_footage text DEFAULT '',
  lease_term text DEFAULT '',
  annual_rent text DEFAULT '',
  commission_rate text DEFAULT '',
  calculated_amount numeric DEFAULT 0,
  expected_close_date text,
  status text DEFAULT 'projected',
  notes text DEFAULT '',
  linked_deal_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ FOLLOW-UPS ============
CREATE TABLE IF NOT EXISTS follow_ups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text DEFAULT '',
  contact_name text DEFAULT '',
  due_date text,
  entity_type text,
  entity_id uuid,
  company_id uuid,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============ ACTIVITY LOG ============
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text DEFAULT '',
  message text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- ============ CLAUSES (Lease Intelligence) ============
CREATE TABLE IF NOT EXISTS clauses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text DEFAULT '',
  category text DEFAULT 'other',
  clause_text text DEFAULT '',
  notes text DEFAULT '',
  source_lease text DEFAULT '',
  tags jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Each user can only see/modify their own data
-- ============================================================

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE clauses ENABLE ROW LEVEL SECURITY;

-- Settings policies
CREATE POLICY "Users can view own settings" ON settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON settings FOR UPDATE USING (auth.uid() = user_id);

-- Deals policies
CREATE POLICY "Users can view own deals" ON deals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deals" ON deals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own deals" ON deals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own deals" ON deals FOR DELETE USING (auth.uid() = user_id);

-- Master list policies
CREATE POLICY "Users can view own master_list" ON master_list FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own master_list" ON master_list FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own master_list" ON master_list FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own master_list" ON master_list FOR DELETE USING (auth.uid() = user_id);

-- Contacts policies
CREATE POLICY "Users can view own contacts" ON contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON contacts FOR DELETE USING (auth.uid() = user_id);

-- Prospects policies
CREATE POLICY "Users can view own prospects" ON prospects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own prospects" ON prospects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own prospects" ON prospects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own prospects" ON prospects FOR DELETE USING (auth.uid() = user_id);

-- Commissions policies
CREATE POLICY "Users can view own commissions" ON commissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own commissions" ON commissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own commissions" ON commissions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own commissions" ON commissions FOR DELETE USING (auth.uid() = user_id);

-- Follow-ups policies
CREATE POLICY "Users can view own follow_ups" ON follow_ups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own follow_ups" ON follow_ups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own follow_ups" ON follow_ups FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own follow_ups" ON follow_ups FOR DELETE USING (auth.uid() = user_id);

-- Activity log policies
CREATE POLICY "Users can view own activity_log" ON activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity_log" ON activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Clauses policies
CREATE POLICY "Users can view own clauses" ON clauses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own clauses" ON clauses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own clauses" ON clauses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own clauses" ON clauses FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_deals_user_id ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_master_list_user_id ON master_list(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_prospects_user_id ON prospects(user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_user_id ON commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user_id ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_clauses_user_id ON clauses(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);
