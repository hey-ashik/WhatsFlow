// Hostinger & Supabase Database Bridge
const { createClient } = require('@supabase/supabase-js');
const db = require('./server/db/db');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_API_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Supabase] ✓ Connected to Supabase client successfully.');
  } catch (err) {
    console.warn('[Supabase] Initialization notice:', err.message);
  }
}

module.exports = {
  supabase,
  db
};
