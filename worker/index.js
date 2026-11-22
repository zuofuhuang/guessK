export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve runtime backend URL configured via Cloudflare Worker variable BACKEND_URL
    if (pathname === '/config.js') {
      const apiBaseUrl = String(env.BACKEND_URL || '').trim().replace(/\/+$/, '');
      const body = `window.GUESSK_CONFIG = ${JSON.stringify({ apiBaseUrl })};\n`;
      return new Response(body, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    // Rewrite /play/:roomCode and /master/:roomCode to their HTML shells
    if (/^\/play\/[^/]+\/?$/.test(pathname)) {
      const target = new URL('/play.html', url.origin);
      return env.ASSETS.fetch(new Request(target, request));
    }

    if (/^\/master\/[^/]+\/?$/.test(pathname)) {
      const target = new URL('/master.html', url.origin);
      return env.ASSETS.fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
