const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function createSupabaseClient(accessToken) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    const name = part.slice(0, separator).trim();
    try {
      return [name, decodeURIComponent(part.slice(separator + 1).trim())];
    } catch {
      return [name, part.slice(separator + 1).trim()];
    }
  }).filter(([name]) => name));
}

function authCookieOptions(maxAge) {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function setAuthCookies(res, session) {
  const accessAge = Math.max(60, Number(session.expires_in) || 3600);
  const refreshAge = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', [
    `sahayak_access=${encodeURIComponent(session.access_token)}; ${authCookieOptions(accessAge)}`,
    `sahayak_refresh=${encodeURIComponent(session.refresh_token)}; ${authCookieOptions(refreshAge)}`,
  ]);
}

function clearAuthCookies(res) {
  const expired = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', [
    `sahayak_access=; ${expired}`,
    `sahayak_refresh=; ${expired}`,
  ]);
}

async function authenticateRequest(req, res, next) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ ok: false, message: 'Persistent authentication is not configured.' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const accessToken = cookies.sahayak_access;
  const refreshToken = cookies.sahayak_refresh;
  const authClient = createSupabaseClient();

  try {
    let token = accessToken;
    let { data, error } = token
      ? await authClient.auth.getUser(token)
      : { data: { user: null }, error: new Error('No access token') };

    if (error && refreshToken) {
      const refreshed = await authClient.auth.refreshSession({ refresh_token: refreshToken });
      if (refreshed.error || !refreshed.data.session) {
        clearAuthCookies(res);
        return res.status(401).json({ ok: false, message: 'Your session expired. Please log in again.' });
      }
      setAuthCookies(res, refreshed.data.session);
      token = refreshed.data.session.access_token;
      data = { user: refreshed.data.user };
      error = null;
    }

    if (error || !data.user) {
      clearAuthCookies(res);
      return res.status(401).json({ ok: false, message: 'Please log in to continue.' });
    }

    req.authUser = data.user;
    req.supabase = createSupabaseClient(token);
    return next();
  } catch (error) {
    console.error('Authentication verification failed:', error.message);
    return res.status(503).json({ ok: false, message: 'Authentication is temporarily unavailable.' });
  }
}

async function requireMemoryConsent(supabase, userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('memory_consent')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.memory_consent === true;
}

function compareAssessmentScores(assessments) {
  const comparable = assessments.filter((item) => Number.isFinite(item.stress_score))
    .sort((a, b) => new Date(a.assessed_at) - new Date(b.assessed_at));
  if (comparable.length < 2) {
    return { trend: 'Insufficient data', difference: null, evidence: [] };
  }
  const first = comparable[0];
  const last = comparable[comparable.length - 1];
  if (first.assessment_type !== last.assessment_type
    || first.scale_definition !== last.scale_definition
    || (first.concern_category && last.concern_category && first.concern_category !== last.concern_category)) {
    return { trend: 'Insufficient data', difference: null, evidence: ['Assessment methods, concern types, or scales differ.'] };
  }
  const difference = last.stress_score - first.stress_score;
  const directions = new Set(comparable.slice(1).map((item, index) => {
    const delta = item.stress_score - comparable[index].stress_score;
    return Math.sign(delta);
  }).filter(Boolean));
  if (directions.size > 1) {
    return {
      trend: 'Fluctuating',
      difference,
      evidence: [`Comparable scores varied across ${comparable.length} assessments; the first score was ${first.stress_score} and the latest was ${last.stress_score}.`],
    };
  }
  return {
    trend: difference < 0 ? 'Improving' : difference > 0 ? 'Worsening' : 'Stable',
    difference,
    evidence: [`Comparable ${last.assessment_type} scores: ${first.stress_score} on ${new Date(first.assessed_at).toLocaleDateString()} and ${last.stress_score} on ${new Date(last.assessed_at).toLocaleDateString()}. Lower scores indicate less reported distress or impact on this scale.`],
  };
}

module.exports = {
  authenticateRequest,
  clearAuthCookies,
  compareAssessmentScores,
  createSupabaseClient,
  isSupabaseConfigured,
  parseCookies,
  requireMemoryConsent,
  setAuthCookies,
};
