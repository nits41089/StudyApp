import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { callOpenAiForJson } from '../_shared/openai.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';

type GeneratedQuestion = {
    id: string;
    prompt: string;
    type: 'short_answer' | 'multiple_choice';
    choices?: string[];
    expectedAnswer?: string;
};

type GenerateQuizResponse = {
    questions: GeneratedQuestion[];
};

type GenerateQuizRequest = {
    topicId?: number | string;
    topicName?: string;
    material?: string;
    questionCount?: number;
};

const MIN_WORDS = 30;
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 25;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function getWordCount(input: string): number {
    return input
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

function sanitizeQuestions(raw: unknown, count: number): GeneratedQuestion[] {
    if (!Array.isArray(raw)) return [];

    return raw
        .map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            const prompt = String((item as Record<string, unknown>).prompt || '').trim();
            if (!prompt) return null;

            const typeRaw = String((item as Record<string, unknown>).type || '').toLowerCase().trim();
            const choices = Array.isArray((item as Record<string, unknown>).choices)
                ? ((item as Record<string, unknown>).choices as unknown[])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .slice(0, 5)
                : [];

            const type: 'short_answer' | 'multiple_choice' = (
                typeRaw === 'multiple_choice' && choices.length >= 2
            )
                ? 'multiple_choice'
                : 'short_answer';

            return {
                id: String((item as Record<string, unknown>).id || `q${index + 1}`),
                prompt,
                type,
                choices: type === 'multiple_choice' ? choices : [],
                expectedAnswer: String((item as Record<string, unknown>).expectedAnswer || '').trim()
            };
        })
        .filter((value): value is GeneratedQuestion => Boolean(value))
        .slice(0, count);
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return errorResponse('Method not allowed', 405);
    }

    try {
        const body = (await req.json().catch(() => null)) as GenerateQuizRequest | null;
        const topicName = String(body?.topicName || '').trim();
        const material = String(body?.material || '').trim();
        const wordCount = getWordCount(material);

        if (!material) return errorResponse('material is required', 400);
        if (wordCount < MIN_WORDS) {
            return errorResponse(`material must include at least ${MIN_WORDS} words`, 400);
        }

        const requestedCount = Number(body?.questionCount);
        const questionCount = clamp(
            Number.isFinite(requestedCount) ? Math.floor(requestedCount) : Math.ceil(wordCount / 220),
            MIN_QUESTIONS,
            MAX_QUESTIONS
        );

        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                questions: {
                    type: 'array',
                    minItems: questionCount,
                    maxItems: questionCount,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['id', 'prompt', 'type', 'choices', 'expectedAnswer'],
                        properties: {
                            id: { type: 'string', minLength: 1 },
                            prompt: { type: 'string', minLength: 5 },
                            type: { type: 'string', enum: ['short_answer', 'multiple_choice'] },
                            choices: {
                                type: 'array',
                                items: { type: 'string' },
                                minItems: 0,
                                maxItems: 5
                            },
                            expectedAnswer: { type: 'string', minLength: 1 }
                        }
                    }
                }
            },
            required: ['questions']
        };

        const systemPrompt = [
            'You generate study quiz questions from user-provided material.',
            'Use only the given material; do not use outside facts.',
            'Return exactly the requested number of questions.',
            'Each question must test understanding, not trivia.',
            'For multiple_choice, include 3-4 options and one clearly correct expectedAnswer.',
            'For short_answer, expectedAnswer should be concise and gradable.'
        ].join(' ');

        const userPrompt = [
            `Topic: ${topicName || 'Untitled topic'}`,
            `Target question count: ${questionCount}`,
            'Generate a balanced quiz:',
            '- around 35-45% multiple_choice, rest short_answer',
            '- no duplicate prompts',
            '- clear wording for beginners',
            '',
            'Material:',
            material.slice(0, 18000)
        ].join('\n');

        const generated = await callOpenAiForJson<GenerateQuizResponse>({
            schemaName: 'generate_quiz_response',
            schema,
            systemPrompt,
            userPrompt,
            maxTokens: 2200,
            temperature: 0.2
        });

        const questions = sanitizeQuestions(generated?.questions, questionCount);
        if (questions.length === 0) {
            return errorResponse('AI did not return usable questions', 502);
        }

        return jsonResponse({
            questions,
            meta: {
                topicId: body?.topicId ?? null,
                wordCount,
                questionCount: questions.length
            }
        });
    } catch (error) {
        console.error('[ai-generate-quiz] error', error);
        return errorResponse(
            'Unable to generate quiz',
            500,
            { message: error instanceof Error ? error.message : String(error) }
        );
    }
});
