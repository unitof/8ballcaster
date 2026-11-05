const destinationOrigin = 'https://8ballcaster.unitof.com';

export default {
  async fetch(request) {
    const { pathname, search } = new URL(request.url);
    const destination = new URL(destinationOrigin);
    destination.pathname = pathname;
    destination.search = search;

    // Let subscribers read the destination's migration tag at the old URL.
    if (pathname === '/feed.xml' && ['GET', 'HEAD'].includes(request.method)) {
      return fetch(destination, { method: request.method, redirect: 'error' });
    }

    return new Response(null, {
      status: 307,
      headers: { Location: destination.href, 'Cache-Control': 'no-store' },
    });
  },
};
