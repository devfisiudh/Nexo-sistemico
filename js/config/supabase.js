const SUPABASE_URL = 'https://gkunrwknbuoevylyuftl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_reWqkCnOQn6yVHoQvzbrNQ_1bE6xlJa';

export const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);