import app from '../worker/index.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Vercel rewrites preserve the query and supply the original route here.
    const route = url.searchParams.get('__route');
    if (route) {
      url.pathname = '/' + route;
      url.searchParams.delete('__route');
    }
    try {
      return await app.fetch(new Request(url, {
        method: request.method,
        headers: request.headers,
      }));
    } catch (error) {
      console.error('Podcast request failed', { path: url.pathname, message: error.message });
      return new Response('Service temporarily unavailable', { status: 502 });
    }
  },
};
