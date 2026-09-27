(function () {
  'use strict';
  let client;
  window.getSupabaseClient = function () {
    if (client) return client;
    const config = window.COMMUNITY_CONFIG;
    if (!config || !/^https:\/\/[a-z0-9.-]+\/?$/i.test(config.supabaseUrl) ||
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
      throw new Error('Authentication is not configured. Follow the public configuration steps in README.md.');
    }
    if (!window.supabase?.createClient) throw new Error('Authentication could not load. Check your connection and reload.');
    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
    });
    return client;
  };
})();
