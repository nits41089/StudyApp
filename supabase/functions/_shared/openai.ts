type JsonSchema = Record<string, unknown>;

function getEnvValue(key: string): string {
    const value = String(Deno.env.get(key) || '').trim();
    if (!value) {
        throw new Error(`Missing required env var: ${key}`);
    }
    return value;
}

function getBaseUrl(): string {
    const configured = String(Deno.env.get('OPENAI_BASE_URL') || '').trim();
    if (!configured) return 'https://api.openai.com/v1';
    return configured.replace(/\/+$/, '');
}

function normalizeJsonString(raw: string): string {
    const trimmed = raw.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export async function callOpenAiForJson<T>({
    schemaName,
    schema,
    systemPrompt,
    userPrompt,
    maxTokens = 1800,
    temperature = 0.2
}: {
    schemaName: string;
    schema: JsonSchema;
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
}): Promise<T> {
    const apiKey = getEnvValue('OPENAI_API_KEY');
    const model = String(Deno.env.get('OPENAI_MODEL') || '').trim() || 'gpt-4.1-mini';
    const baseUrl = getBaseUrl();

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            temperature,
            max_completion_tokens: maxTokens,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: schemaName,
                    schema,
                    strict: true
                }
            }
        })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = String(
            payload?.error?.message ||
            payload?.message ||
            `OpenAI request failed (${response.status})`
        );
        throw new Error(message);
    }

    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
        throw new Error('OpenAI response did not include JSON content.');
    }

    const normalized = normalizeJsonString(content);
    try {
        return JSON.parse(normalized) as T;
    } catch (_error) {
        throw new Error('Failed to parse structured JSON response from OpenAI.');
    }
}
