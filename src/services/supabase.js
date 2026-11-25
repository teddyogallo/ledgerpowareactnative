import 'react-native-url-polyfill/auto';
import { authStorage } from './authStorage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const configError = !supabaseUrl || !supabaseAnonKey
  ? 'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
  : null;

export const supabase = configError ? null : createClient(
  supabaseUrl.trim().replace(/\/$/, ''),
  supabaseAnonKey.trim(),
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  }
);
