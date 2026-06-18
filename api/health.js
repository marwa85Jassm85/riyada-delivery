export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  function pickUrl() {
    const candidates = [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL];
    for (const c of candidates) {
      if (c && c.startsWith('http')) return c.replace(/\/+$/, '');
    }
    return 'https://mzfhwxctiovsgpwyfevj.supabase.co';
  }
  const url = pickUrl();
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || '';
  res.status(200).json({
    SUPABASE_URL_set:           !!process.env.SUPABASE_URL,
    VITE_SUPABASE_URL_set:      !!process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_KEY_set:   !!process.env.SUPABASE_SERVICE_KEY,
    VITE_SERVICE_KEY_set:       !!process.env.VITE_SUPABASE_SERVICE_KEY,
    url_resolved:               url ? url.slice(0, 30) + '...' : 'MISSING',
    key_prefix:                 key ? key.slice(0, 12) + '...' : 'MISSING',
    key_is_secret:              key.startsWith('sb_secret_'),
  });
}
