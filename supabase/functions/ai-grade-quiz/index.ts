import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { callOpenAiForJson } from '../_shared/openai.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';

type QuizQuestion = {
    id: string;
    prompt: string;
    type?: string;
    choices?: string[];
    expectedAnswer?: string;
    language?: string;
    starterCode?: string;
    testCases?: string;
    constraints?: string;
};

type QuizAnswer = {
    questionId: string;
    answer: string;
};

type GradeQuizRequest = {
    topicName?: string;
    material?: string;
    questions?: QuizQuestion[];
    answers?: QuizAnswer[];
};

type GradeQuizResponse = {
    score: number;
    recommendedDifficulty: 'hard' | 'medium' | 'easy';
    feedback: string;
    perQuestion?: Array<{
        questionId: string;
        awarded: number;
        comment: string;
    }>;
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function normalizeQuestions(raw: unknown): QuizQuestion[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            const prompt = String((item as Record<string, unknown>).prompt || '').trim();
            if (!prompt) return null;
            const choices = Array.isArray((item as Record<string, unknown>).choices)
                ? ((item as Record<string, unknown>).choices as unknown[])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .slice(0, 6)
                : [];

            return {
                id: String((item as Record<string, unknown>).id || `q${index + 1}`),
                prompt,
                type: String((item as Record<string, unknown>).type || '').toLowerCase().trim() || 'short_answer',
                choices,
                expectedAnswer: String(
                    (item as Record<string, unknown>).expectedAnswer ||
                    (item as Record<string, unknown>).answer ||
                    ''
                ).trim(),
                language: String((item as Record<string, unknown>).language || '').toLowerCase().trim(),
                starterCode: String((item as Record<string, unknown>).starterCode || '').trim(),
                testCases: String((item as Record<string, unknown>).testCases || '').trim(),
                constraints: String((item as Record<string, unknown>).constraints || '').trim()
            };
        })
        .filter((item): item is QuizQuestion => Boolean(item));
}

function normalizeAnswers(raw: unknown): QuizAnswer[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const questionId = String((item as Record<string, unknown>).questionId || '').trim();
            const answer = String((item as Record<string, unknown>).answer || '').trim();
            if (!questionId || !answer) return null;
            return { questionId, answer };
        })
        .filter((item): item is QuizAnswer => Boolean(item));
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return errorResponse('Method not allowed', 405);
    }

    try {
        const body = (await req.json().catch(() => null)) as GradeQuizRequest | null;
        const topicName = String(body?.topicName || '').trim();
        const material = String(body?.material || '').trim();
        const questions = normalizeQuestions(body?.questions);
        const answers = normalizeAnswers(body?.answers);

        if (questions.length === 0) return errorResponse('questions are required', 400);
        if (answers.length === 0) return errorResponse('answers are required', 400);

        const answerMap = new Map<string, string>();
        answers.forEach((item) => {
            answerMap.set(item.questionId, item.answer);
        });

        const unresolved = questions.filter((question) => !answerMap.get(question.id));
        if (unresolved.length > 0) {
            return errorResponse('all questions must have answers', 400, {
                missingQuestionIds: unresolved.map((item) => item.id)
            });
        }

        const schema = {
            type: 'object',
            additionalProperties: false,
            required: ['score', 'recommendedDifficulty', 'feedback', 'perQuestion'],
            properties: {
                score: { type: 'number', minimum: 0, maximum: 100 },
                recommendedDifficulty: { type: 'string', enum: ['hard', 'medium', 'easy'] },
                feedback: { type: 'string', minLength: 5, maxLength: 2000 },
                perQuestion: {
                    type: 'array',
                    minItems: questions.length,
                    maxItems: questions.length,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['questionId', 'awarded', 'comment'],
                        properties: {
                            questionId: { type: 'string', minLength: 1 },
                            awarded: { type: 'number', minimum: 0, maximum: 1 },
                            comment: { type: 'string', minLength: 1, maxLength: 500 }
                        }
                    }
                }
            }
        };

        const promptQuestions = questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            type: question.type || 'short_answer',
            choices: question.choices || [],
            expectedAnswer: question.expectedAnswer || null,
            userAnswer: answerMap.get(question.id) || '',
            ...(question.type === 'code_challenge' && {
                language: question.language,
                testCases: question.testCases,
                constraints: question.constraints
            })
        }));

        const systemPrompt = [
            'You are grading a study quiz including code challenges.',
            'Be strict but fair. For code, evaluate correctness, edge cases, and code quality.',
            'Use material and expectedAnswer when available.',
            'If material is missing, use question context and expectedAnswer to grade.',
            'For code_challenge questions:',
            '  - Award 1.0 if code is correct, handles edge cases, and follows best practices.',
            '  - Award 0.7-0.9 if code works but has minor issues or inefficiencies.',
            '  - Award 0.3-0.6 if code has logical errors or misses edge cases.',
            '  - Award 0 if code doesn\'t compile or completely fails.',
            '  - In comment, explain correctness, edge case handling, and code quality.',
            'Awarded score per question is 0 to 1.',
            'Final score is overall percent 0-100.',
            'Difficulty mapping guidance:',
            '- easy for strong mastery (code quality + correctness)',
            '- medium for partial understanding',
            '- hard for weak understanding'
        ].join(' ');

        const userPrompt = [
            `Topic: ${topicName || 'Untitled topic'}`,
            material
                ? `Reference material (may be partial):\n${material.slice(0, 18000)}`
                : 'Reference material: not provided',
            '',
            'Questions and user answers:',
            JSON.stringify(promptQuestions, null, 2)
        ].join('\n');

        const graded = await callOpenAiForJson<GradeQuizResponse>({
            schemaName: 'grade_quiz_response',
            schema,
            systemPrompt,
            userPrompt,
            maxTokens: 2200,
            temperature: 0.1
        });

        const numericScore = Number(graded?.score);
        const score = Number.isFinite(numericScore)
            ? clamp(Math.round(numericScore), 0, 100)
            : 0;

        const recommendedDifficulty = (
            graded?.recommendedDifficulty === 'easy' ||
            graded?.recommendedDifficulty === 'hard' ||
            graded?.recommendedDifficulty === 'medium'
        )
            ? graded.recommendedDifficulty
            : score >= 80
                ? 'easy'
                : score >= 50
                    ? 'medium'
                    : 'hard';

        const feedback = String(graded?.feedback || '').trim()
            || 'Assessment graded successfully.';

        const perQuestion = Array.isArray(graded?.perQuestion)
            ? graded.perQuestion
                .map((item) => ({
                    questionId: String(item.questionId || ''),
                    awarded: clamp(Number(item.awarded) || 0, 0, 1),
                    comment: String(item.comment || '').trim()
                }))
                .filter((item) => item.questionId && item.comment)
            : [];

        return jsonResponse({
            score,
            recommendedDifficulty,
            feedback,
            perQuestion
        });
    } catch (error) {
        console.error('[ai-grade-quiz] error', error);
        return errorResponse(
            'Unable to grade quiz',
            500,
            { message: error instanceof Error ? error.message : String(error) }
        );
    }
});
