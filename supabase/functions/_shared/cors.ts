export const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
        }
    });
}

export function errorResponse(message: string, status = 400, details: unknown = null): Response {
    return jsonResponse(
        {
            error: message,
            details
        },
        status
    );
}
