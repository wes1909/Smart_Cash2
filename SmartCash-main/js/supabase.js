const SUPABASE_URL = 'https://wpgqfsyezaudyjjrwxyp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KbTmiKmTQ6GMSwYR141Jsw__20UDB3F';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

console.log('Supabase inicializado:', supabaseClient);