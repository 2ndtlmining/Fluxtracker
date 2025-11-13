// src/hooks.server.js
// API Proxy - Routes /api/* requests to the Express backend on port 3000

const API_BASE = 'http://localhost:3000';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
    // Check if this is an API request
    if (event.url.pathname.startsWith('/api/')) {
        try {
            // Build the backend API URL
            const apiUrl = `${API_BASE}${event.url.pathname}${event.url.search}`;
            
            console.log(`[API Proxy] ${event.request.method} ${event.url.pathname} → ${apiUrl}`);
            
            // Prepare headers for the proxied request
            const headers = new Headers(event.request.headers);
            headers.delete('host'); // Remove host header to avoid conflicts
            headers.delete('connection'); // Remove connection header
            
            // Make the request to the Express backend
            const response = await fetch(apiUrl, {
                method: event.request.method,
                headers: headers,
                body: event.request.method !== 'GET' && event.request.method !== 'HEAD' 
                    ? await event.request.text() 
                    : undefined
            });
            
            // Get the response body
            const body = await response.text();
            
            // Create response headers
            const responseHeaders = new Headers();
            responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
            
            // Copy other important headers
            const headersToKeep = ['content-type', 'cache-control', 'etag', 'last-modified'];
            headersToKeep.forEach(header => {
                const value = response.headers.get(header);
                if (value) responseHeaders.set(header, value);
            });
            
            // Return the proxied response
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });
            
        } catch (error) {
            console.error('[API Proxy Error]', error.message);
            
            return new Response(
                JSON.stringify({ 
                    error: 'Backend API unavailable', 
                    details: error.message,
                    timestamp: new Date().toISOString()
                }), 
                {
                    status: 503,
                    headers: { 
                        'Content-Type': 'application/json' 
                    }
                }
            );
        }
    }
    
    // For non-API requests, proceed normally with SvelteKit rendering
    const response = await resolve(event);
    return response;
}

/** @type {import('@sveltejs/kit').HandleServerError} */
export function handleError({ error, event }) {
    console.error('[SvelteKit Error]', error);
    
    return {
        message: 'An error occurred',
        code: error?.code ?? 'UNKNOWN'
    };
}