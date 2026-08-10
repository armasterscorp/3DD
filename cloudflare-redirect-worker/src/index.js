export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const alias = decodeURIComponent(
      url.pathname.replace(/^\/+|\/+$/g, '')
    );

    if (!alias) {
      return new Response('Redirect not found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const value = await env.REDIRECTS.get(alias);

    if (!value) {
      return new Response('Redirect not found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    let destination = value;
    let statusCode = 302;

    try {
      const record = JSON.parse(value);

      destination = String(record.destination || '');

      statusCode = [301, 302, 307, 308].includes(
        Number(record.statusCode)
      )
        ? Number(record.statusCode)
        : 302;
    } catch {
      // Backward compatibility:
      // Plain KV values are treated as 302 redirect URLs.
    }

    let parsedDestination;

    try {
      parsedDestination = new URL(destination);
    } catch {
      return new Response('Invalid redirect destination', {
        status: 500,
      });
    }

    if (
      !['http:', 'https:'].includes(parsedDestination.protocol)
    ) {
      return new Response('Invalid redirect destination', {
        status: 500,
      });
    }

    return Response.redirect(
      parsedDestination.toString(),
      statusCode
    );
  },
};