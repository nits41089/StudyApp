function handleTopicSubmit() {
    const name = document.getElementById('topicName').value.trim();
    const categories = normalizeCategoryList(document.getElementById('topicCategories').value);
    const weight = parseInt(document.getElementById('topicWeight').value);
    const id = document.getElementById('editId').value;
    const action = (isEditing && id) ? 'update' : 'add';

    if (!name) return;

    if (isEditing && id) {
        // Update existing
        const index = topics.findIndex(t => t.id == id);
        if (index !== -1) {
            topics[index].name = name;
            topics[index].weight = weight;
            topics[index].categories = categories;
        }
        cancelEdit();
    } else {
        // Add new
        topics.push({
            id: Date.now(),
            name,
            weight,
            nextReview: new Date().toISOString().split('T')[0],
            interval: 1,
            streak: 0,
            reviewCount: 0,
            ease: 2.3,
            lapses: 0,
            lastReviewedAt: null,
            dueCount: 0,
            recentOutcomes: [],
            recentReviewHistory: [],
            inLearning: true,
            learningStep: 0,
            categories
        });
        document.getElementById('topicName').value = '';
        document.getElementById('topicCategories').value = '';
    }
    save();
    trackClarityEvent(action === 'add' ? 'topic_added' : 'topic_updated');
    setClarityTag('last_topic_weight', weight);
}

function editTopic(id) {
    const topic = topics.find(t => t.id == id);
    if (!topic) return;
    trackClarityEvent('topic_edit_started');

    isEditing = true;
    document.getElementById('editId').value = topic.id;
    document.getElementById('topicName').value = topic.name;
    document.getElementById('topicCategories').value = normalizeCategoryList(topic.categories).join(', ');
    document.getElementById('topicWeight').value = topic.weight;

    // UI Updates
    document.getElementById('mainBtn').innerText = "Update Topic";
    document.getElementById('mainBtn').classList.replace('bg-indigo-600', 'bg-emerald-600');
    document.getElementById('mainBtn').classList.replace('hover:bg-indigo-700', 'hover:bg-emerald-700');
    document.getElementById('formTitle').innerText = "Edit Topic";
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    document.getElementById('entryForm').classList.add('ring-2', 'ring-emerald-100');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
    isEditing = false;
    document.getElementById('editId').value = '';
    document.getElementById('topicName').value = '';
    document.getElementById('topicCategories').value = '';
    document.getElementById('topicWeight').value = '45';

    // UI Reset
    document.getElementById('mainBtn').innerText = "Add to Queue";
    document.getElementById('mainBtn').classList.replace('bg-emerald-600', 'bg-indigo-600');
    document.getElementById('mainBtn').classList.replace('hover:bg-emerald-700', 'hover:bg-indigo-700');
    document.getElementById('formTitle').innerText = "Add New Topic";
    document.getElementById('cancelEditBtn').classList.add('hidden');
    document.getElementById('entryForm').classList.remove('ring-2', 'ring-emerald-100');
}

function deleteTopic(id) {
    if (confirm("Are you sure you want to delete this topic?")) {
        topics = topics.filter(t => t.id != id);
        save();
        trackClarityEvent('topic_deleted');
    }
}

const AI_GENERATE_FUNCTION = 'ai-generate-quiz';
const AI_GRADE_FUNCTION = 'ai-grade-quiz';
let aiAssessmentState = {
    topicId: null,
    material: '',
    wordCount: 0,
    questionCount: 3,
    questions: [],
    result: null
};
let aiCodeEditors = new Map();
let aiCodeCompletionRegistered = false;
let acePathsConfigured = false;
const codeTextareaFallbacks = new WeakSet();

const AI_CODE_KEYWORDS = {
    python: [
        'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
        'False', 'finally', 'for', 'from', 'if', 'import', 'in', 'is', 'lambda', 'None', 'not',
        'or', 'pass', 'return', 'True', 'try', 'while', 'with', 'yield', 'range', 'len', 'enumerate',
        'zip', 'map', 'filter', 'sorted', 'sum', 'min', 'max', 'list', 'dict', 'set', 'tuple',
        'append', 'pop', 'insert', 'remove', 'split', 'join', 'strip'
    ],
    javascript: [
        'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do',
        'else', 'export', 'false', 'finally', 'for', 'function', 'if', 'import', 'let', 'new',
        'null', 'return', 'switch', 'this', 'throw', 'true', 'try', 'undefined', 'var', 'while',
        'Array', 'Object', 'Map', 'Set', 'Math', 'Number', 'String', 'Boolean', 'console',
        'length', 'push', 'pop', 'slice', 'map', 'filter', 'reduce', 'sort', 'includes', 'indexOf'
    ],
    java: [
        'abstract', 'boolean', 'break', 'case', 'catch', 'char', 'class', 'continue', 'default',
        'double', 'else', 'extends', 'false', 'final', 'finally', 'float', 'for', 'if', 'implements',
        'import', 'int', 'interface', 'long', 'new', 'null', 'private', 'protected', 'public',
        'return', 'static', 'String', 'switch', 'this', 'throw', 'throws', 'true', 'try', 'void',
        'while', 'List', 'ArrayList', 'Map', 'HashMap', 'Set', 'HashSet', 'Arrays', 'Collections'
    ],
    csharp: [
        'abstract', 'as', 'bool', 'break', 'case', 'catch', 'class', 'const', 'continue', 'decimal',
        'default', 'double', 'else', 'enum', 'false', 'finally', 'float', 'for', 'foreach', 'if',
        'in', 'int', 'interface', 'is', 'List', 'Dictionary', 'namespace', 'new', 'null', 'object',
        'private', 'protected', 'public', 'return', 'static', 'string', 'switch', 'this', 'throw',
        'true', 'try', 'using', 'var', 'void', 'while'
    ]
};

function normalizeCodeLanguage(value) {
    const language = String(value || '').toLowerCase().trim();
    if (language === 'js' || language === 'javascript') return 'javascript';
    if (language === 'py' || language === 'python') return 'python';
    if (language === 'cs' || language === 'c#' || language === 'csharp') return 'csharp';
    if (language === 'java') return 'java';
    return 'javascript';
}

function getAceModeForLanguage(language) {
    const normalized = normalizeCodeLanguage(language);
    if (normalized === 'python') return 'ace/mode/python';
    if (normalized === 'java') return 'ace/mode/java';
    if (normalized === 'csharp') return 'ace/mode/csharp';
    return 'ace/mode/javascript';
}

function configureAcePaths() {
    if (acePathsConfigured || !window.ace || !window.ace.config) return;
    const basePath = String(window.ACE_CDN_BASE || '').replace(/\/+$/, '');
    if (basePath) {
        window.ace.config.set('basePath', basePath);
        window.ace.config.set('modePath', basePath);
        window.ace.config.set('themePath', basePath);
        window.ace.config.set('workerPath', basePath);
    }
    acePathsConfigured = true;
}

function getAiCodeCompletionWords(language, source) {
    const normalized = normalizeCodeLanguage(language);
    const words = new Set(AI_CODE_KEYWORDS[normalized] || []);
    String(source || '')
        .match(/[A-Za-z_][A-Za-z0-9_]*/g)
        ?.forEach(word => {
            if (word.length > 1) words.add(word);
        });
    return [...words].sort((a, b) => a.localeCompare(b));
}

function registerAiCodeCompleter() {
    if (aiCodeCompletionRegistered || !window.ace) return;
    let languageTools = null;
    try {
        languageTools = window.ace.require?.('ace/ext/language_tools');
    } catch (_error) {
        languageTools = null;
    }
    if (!languageTools || typeof languageTools.addCompleter !== 'function') return;

    languageTools.addCompleter({
        getCompletions(editor, _session, _pos, prefix, callback) {
            const typed = String(prefix || '').toLowerCase();
            const sourceWords = Array.isArray(editor.aiCompletionWords) ? editor.aiCompletionWords : [];
            const completions = sourceWords
                .filter(word => typed && word.toLowerCase().startsWith(typed) && word.toLowerCase() !== typed)
                .slice(0, 80)
                .map(word => ({
                    caption: word,
                    value: word,
                    meta: editor.aiCompletionLanguage || 'code',
                    score: 500
                }));
            callback(null, completions);
        }
    });
    aiCodeCompletionRegistered = true;
}

function handleCodeTextareaKeydown(event) {
    if (event.key !== 'Tab') return;
    event.preventDefault();

    const textarea = event.currentTarget;
    const indent = '    ';
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;

    if (selectionStart !== selectionEnd) {
        const selected = value.slice(lineStart, selectionEnd);
        const lines = selected.split('\n');
        const updatedLines = event.shiftKey
            ? lines.map(line => line.startsWith(indent) ? line.slice(indent.length) : line.replace(/^\t/, ''))
            : lines.map(line => `${indent}${line}`);
        const updated = updatedLines.join('\n');
        textarea.value = value.slice(0, lineStart) + updated + value.slice(selectionEnd);
        textarea.selectionStart = lineStart;
        textarea.selectionEnd = lineStart + updated.length;
        return;
    }

    if (event.shiftKey) {
        const beforeCursor = value.slice(lineStart, selectionStart);
        if (beforeCursor.endsWith(indent)) {
            textarea.value = value.slice(0, selectionStart - indent.length) + value.slice(selectionStart);
            textarea.selectionStart = selectionStart - indent.length;
            textarea.selectionEnd = selectionStart - indent.length;
        }
        return;
    }

    textarea.value = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    textarea.selectionStart = selectionStart + indent.length;
    textarea.selectionEnd = selectionStart + indent.length;
}

function enableCodeTextareaFallback(textarea) {
    if (!textarea || codeTextareaFallbacks.has(textarea)) return;
    textarea.classList.add('code-editor');
    textarea.addEventListener('keydown', handleCodeTextareaKeydown);
    codeTextareaFallbacks.add(textarea);
}

function destroyAiCodeEditors() {
    aiCodeEditors.forEach((editor) => {
        try {
            editor.destroy();
        } catch (_error) {
            // Ignore stale editor instances after DOM replacement.
        }
    });
    aiCodeEditors.clear();
}

function initAiCodeEditors() {
    const codeAreas = document.querySelectorAll('[data-ai-code-answer="true"]');
    if (!window.ace) {
        codeAreas.forEach(enableCodeTextareaFallback);
        return;
    }

    configureAcePaths();
    registerAiCodeCompleter();

    codeAreas.forEach((textarea) => {
        const index = Number(textarea.dataset.questionIndex);
        if (!Number.isFinite(index) || aiCodeEditors.has(index)) return;

        const language = normalizeCodeLanguage(textarea.dataset.language);
        const editorHost = document.createElement('div');
        editorHost.id = `aiAssessCodeEditor${index}`;
        editorHost.className = 'ai-code-editor';
        editorHost.setAttribute('aria-label', `Code answer for question ${index + 1}`);
        textarea.classList.add('hidden');
        textarea.insertAdjacentElement('afterend', editorHost);

        const editor = window.ace.edit(editorHost);
        editor.aiCompletionLanguage = language;
        editor.aiCompletionWords = getAiCodeCompletionWords(language, textarea.value);
        editor.setTheme('ace/theme/tomorrow_night');
        editor.session.setMode(getAceModeForLanguage(language));
        editor.session.setTabSize(4);
        editor.session.setUseSoftTabs(true);
        editor.session.setUseWrapMode(true);
        editor.session.setUseWorker(false);
        editor.setValue(textarea.value || '', -1);
        editor.setOptions({
            animatedScroll: true,
            autoScrollEditorIntoView: true,
            behavioursEnabled: true,
            displayIndentGuides: true,
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            fadeFoldWidgets: false,
            fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
            fontSize: '13px',
            highlightActiveLine: true,
            highlightSelectedWord: true,
            maxLines: 24,
            minLines: 10,
            scrollPastEnd: 0.25,
            showFoldWidgets: true,
            showGutter: true,
            showPrintMargin: false,
            tabSize: 4,
            useSoftTabs: true
        });
        editor.commands.addCommand({
            name: 'triggerAutocomplete',
            bindKey: { win: 'Ctrl-Space|Alt-Space', mac: 'Ctrl-Space|Alt-Space' },
            exec(activeEditor) {
                activeEditor.execCommand('startAutocomplete');
            }
        });
        editor.on('change', () => {
            textarea.value = editor.getValue();
        });
        aiCodeEditors.set(index, editor);
        requestAnimationFrame(() => editor.resize());
    });
}

function normalizeDifficultyLabel(value) {
    const normalized = String(value || '').toLowerCase().trim();
    if (normalized === 'easy' || normalized === 'mastered') return 'easy';
    if (normalized === 'medium' || normalized === 'okay') return 'medium';
    if (normalized === 'hard' || normalized === 'struggled') return 'hard';
    return '';
}

function difficultyToReadableLabel(value) {
    if (value === 'easy') return 'Mastered';
    if (value === 'medium') return 'Okay';
    return 'Struggled';
}

function scoreToDifficulty(score) {
    if (!Number.isFinite(score)) return 'medium';
    if (score >= 80) return 'easy';
    if (score >= 50) return 'medium';
    return 'hard';
}

function getWordCountFromMaterial(material) {
    return String(material || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

function calculateQuestionCountFromMaterial(material) {
    const words = getWordCountFromMaterial(material);
    return Math.max(3, Math.min(25, Math.ceil(words / 220)));
}

function getAiModalElements() {
    return {
        modal: document.getElementById('aiAssessModal'),
        topicName: document.getElementById('aiAssessTopicName'),
        materialInput: document.getElementById('aiAssessMaterialInput'),
        wordCount: document.getElementById('aiAssessWordCount'),
        questionCount: document.getElementById('aiAssessQuestionCount'),
        status: document.getElementById('aiAssessStatus'),
        questionWrap: document.getElementById('aiAssessQuestionWrap'),
        questionList: document.getElementById('aiAssessQuestions'),
        resultWrap: document.getElementById('aiAssessResultWrap'),
        score: document.getElementById('aiAssessScore'),
        suggestion: document.getElementById('aiAssessSuggestion'),
        feedback: document.getElementById('aiAssessFeedback'),
        tagSplit: document.getElementById('aiAssessTagSplit'),
        knownTags: document.getElementById('aiAssessKnownTags'),
        prepareTags: document.getElementById('aiAssessPrepareTags'),
        generateBtn: document.getElementById('aiAssessGenerateBtn'),
        regenerateBtn: document.getElementById('aiAssessRegenerateBtn'),
        gradeBtn: document.getElementById('aiAssessGradeBtn'),
        applyBtn: document.getElementById('aiAssessApplyBtn')
    };
}

function setAiAssessmentQuestionActionMode(mode = 'generate') {
    const { generateBtn, regenerateBtn } = getAiModalElements();
    if (generateBtn) generateBtn.classList.toggle('hidden', mode !== 'generate');
    if (regenerateBtn) regenerateBtn.classList.toggle('hidden', mode !== 'regenerate');
}

function setAiAssessmentStatus(message, tone = 'slate') {
    const { status } = getAiModalElements();
    if (!status) return;
    const toneClassMap = {
        slate: 'text-slate-500',
        indigo: 'text-indigo-600',
        green: 'text-emerald-600',
        amber: 'text-amber-600',
        red: 'text-red-600'
    };
    status.className = `text-xs ${toneClassMap[tone] || toneClassMap.slate}`;
    status.textContent = message || '';
}

function getAssessmentTagsForTopic(topic) {
    const categories = normalizeCategoryList(topic?.categories || []);
    return categories.length > 0 ? categories : ['Uncategorized'];
}

function renderTagPills(tags, tone = 'slate') {
    const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
    const toneClasses = {
        emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        amber: 'bg-amber-100 text-amber-800 border-amber-200',
        slate: 'bg-slate-100 text-slate-600 border-slate-200'
    };
    const classes = toneClasses[tone] || toneClasses.slate;

    if (list.length === 0) {
        return `<div class="text-xs text-slate-400">No tags yet.</div>`;
    }

    return list.map(tag => {
        const label = typeof tag === 'string' ? tag : tag.label;
        const meta = typeof tag === 'string' ? '' : tag.meta;
        return `
            <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}">
                ${escapeHtml(label)}
                ${meta ? `<span class="font-normal opacity-75">${escapeHtml(meta)}</span>` : ''}
            </span>
        `;
    }).join('');
}

function getAiAssessmentTagBuckets(topic, score) {
    const tags = getAssessmentTagsForTopic(topic);
    const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
    return normalizedScore >= 80
        ? { known: tags, prepare: [] }
        : { known: [], prepare: tags };
}

function renderCurrentAiAssessmentTagSplit(topic, score) {
    const { tagSplit, knownTags, prepareTags } = getAiModalElements();
    if (!tagSplit || !knownTags || !prepareTags || !topic) return;

    const buckets = getAiAssessmentTagBuckets(topic, score);
    knownTags.innerHTML = renderTagPills(buckets.known, 'emerald');
    prepareTags.innerHTML = renderTagPills(buckets.prepare, 'amber');
    tagSplit.classList.remove('hidden');
}

function renderAiTagReadiness() {
    const section = document.getElementById('aiTagReadinessSection');
    const knownNode = document.getElementById('aiKnownTags');
    const prepareNode = document.getElementById('aiPrepareTags');
    const updatedNode = document.getElementById('aiTagReadinessUpdated');
    if (!section || !knownNode || !prepareNode) return;

    const tagStats = new Map();
    topics.forEach(topic => {
        const assessment = topic.lastAiAssessment;
        if (!assessment || !assessment.date) return;

        const score = Math.max(0, Math.min(100, Number(assessment.score) || 0));
        getAssessmentTagsForTopic(topic).forEach(tag => {
            const existing = tagStats.get(tag) || {
                label: tag,
                total: 0,
                count: 0,
                latestDate: ''
            };
            existing.total += score;
            existing.count += 1;
            existing.latestDate = existing.latestDate && existing.latestDate > assessment.date
                ? existing.latestDate
                : assessment.date;
            tagStats.set(tag, existing);
        });
    });

    const entries = Array.from(tagStats.values())
        .map(item => ({
            label: item.label,
            score: Math.round(item.total / Math.max(1, item.count)),
            count: item.count,
            latestDate: item.latestDate
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.label.localeCompare(b.label);
        });

    const known = entries
        .filter(item => item.score >= 80)
        .map(item => ({ label: item.label, meta: `${item.score}% · ${item.count}` }));
    const prepare = entries
        .filter(item => item.score < 80)
        .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
        .map(item => ({ label: item.label, meta: `${item.score}% · ${item.count}` }));

    knownNode.innerHTML = renderTagPills(known, 'emerald');
    prepareNode.innerHTML = renderTagPills(prepare, 'amber');

    if (updatedNode) {
        const latest = entries
            .map(item => item.latestDate)
            .filter(Boolean)
            .sort()
            .pop();
        updatedNode.textContent = latest
            ? `Based on ${entries.length} assessed tag${entries.length === 1 ? '' : 's'} · latest ${new Date(latest).toLocaleDateString()}`
            : 'Complete an AI assessment to populate this section';
    }
}

function updateAiAssessmentLengthInfo() {
    const {
        materialInput,
        wordCount: wordCountNode,
        questionCount: questionCountNode
    } = getAiModalElements();
    if (!materialInput) return;

    const material = String(materialInput.value || '');
    const words = getWordCountFromMaterial(material);
    const questionCount = calculateQuestionCountFromMaterial(material);
    aiAssessmentState.material = material.trim();
    aiAssessmentState.wordCount = words;
    aiAssessmentState.questionCount = questionCount;

    if (wordCountNode) wordCountNode.textContent = String(words);
    if (questionCountNode) questionCountNode.textContent = String(questionCount);
}

function syncAiAssessmentLengthDisplay() {
    const { wordCount: wordCountNode, questionCount: questionCountNode } = getAiModalElements();
    if (wordCountNode) wordCountNode.textContent = String(aiAssessmentState.wordCount || 0);
    if (questionCountNode) questionCountNode.textContent = String(aiAssessmentState.questionCount || 3);
}

function normalizeGeneratedQuestions(rawQuestions) {
    if (!Array.isArray(rawQuestions)) return [];

    return rawQuestions
        .map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            const prompt = String(item.prompt || item.question || '').trim();
            if (!prompt) return null;
            const type = String(item.type || item.kind || 'short_answer').toLowerCase();
            const choices = Array.isArray(item.choices || item.options)
                ? (item.choices || item.options).map(value => String(value || '').trim()).filter(Boolean).slice(0, 6)
                : [];

            return {
                id: String(item.id || `q${index + 1}`),
                prompt,
                type,
                choices,
                expectedAnswer: String(item.expectedAnswer || item.answer || '').trim(),
                language: String(item.language || '').toLowerCase().trim(),
                starterCode: String(item.starterCode || '').trim(),
                testCases: String(item.testCases || '').trim(),
                constraints: String(item.constraints || '').trim()
            };
        })
        .filter(Boolean);
}

function getSavedAiQuizForTopic(topic) {
    if (!topic || !topic.lastAiQuiz || typeof topic.lastAiQuiz !== 'object') return null;
    const questions = normalizeGeneratedQuestions(topic.lastAiQuiz.questions || []);
    if (questions.length === 0) return null;
    const material = String(topic.lastAiQuiz.material || '').trim();

    const questionCount = Math.max(3, Math.min(25, Number(topic.lastAiQuiz.questionCount) || questions.length));
    return {
        generatedAt: String(topic.lastAiQuiz.generatedAt || ''),
        material,
        wordCount: Math.max(0, Number(topic.lastAiQuiz.wordCount) || getWordCountFromMaterial(material)),
        questionCount,
        questions: questions.slice(0, questionCount)
    };
}

function renderAiAssessmentQuestions() {
    const { questionWrap, questionList, gradeBtn, resultWrap, tagSplit } = getAiModalElements();
    if (!questionWrap || !questionList) return;

    destroyAiCodeEditors();

    if (!Array.isArray(aiAssessmentState.questions) || aiAssessmentState.questions.length === 0) {
        questionWrap.classList.add('hidden');
        questionList.innerHTML = '';
        if (resultWrap) resultWrap.classList.add('hidden');
        if (tagSplit) tagSplit.classList.add('hidden');
        return;
    }

    questionList.innerHTML = aiAssessmentState.questions.map((question, index) => {
        const choices = Array.isArray(question.choices) ? question.choices : [];
        const isCodeChallenge = question.type === 'code_challenge';

        if (isCodeChallenge) {
            const language = question.language || 'python';
            const starterCode = question.starterCode || '# Write your code here';
            const testCases = question.testCases || 'No test cases provided';
            const constraints = question.constraints || '';

            return `
                <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div class="text-xs text-slate-400 font-semibold mb-1">Q${index + 1} · Code Challenge</div>
                    <div class="text-sm text-slate-800 mb-3">${escapeHtml(question.prompt)}</div>
                    
                    <div class="bg-white rounded-lg border border-slate-200 p-3 mb-2">
                        <div class="text-xs font-semibold text-slate-600 mb-2">Language: <span class="text-indigo-600">${escapeHtml(language.toUpperCase())}</span></div>
                        <div class="mb-3">
                            <div class="text-xs font-semibold text-slate-600 mb-1">Starter Code:</div>
                            <pre class="bg-slate-900 text-slate-100 p-2 rounded text-xs overflow-x-auto"><code class="language-${escapeHtml(language)}">${escapeHtml(starterCode)}</code></pre>
                        </div>
                    </div>
                    
                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-2 text-xs">
                        <div class="font-semibold text-blue-900 mb-1">Test Cases:</div>
                        <div class="text-blue-800 whitespace-pre-wrap font-mono text-xs">${escapeHtml(testCases)}</div>
                    </div>
                    
                    ${constraints ? `<div class="text-xs text-slate-600 mb-2"><strong>Constraints:</strong> ${escapeHtml(constraints)}</div>` : ''}
                    
                    <div class="mb-2">
                        <label class="text-xs font-semibold text-slate-600 block mb-1">Your Code:</label>
                        <textarea id="aiAssessCodeAnswer${index}" data-ai-code-answer="true" data-question-index="${index}"
                            data-language="${escapeHtml(language)}"
                            class="code-editor w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-mono bg-slate-900 text-slate-100"
                            rows="10" placeholder="Write your solution here...">${escapeHtml(starterCode)}</textarea>
                    </div>
                </div>
            `;
        }

        const choicesMarkup = choices.length > 0
            ? `
                <div class="mt-2 space-y-2">
                    ${choices.map((choice, optionIndex) => `
                        <label class="flex items-start gap-2 text-sm text-slate-700">
                            <input type="radio" name="aiAssessQ${index}" value="${escapeHtml(choice)}" class="mt-1">
                            <span>${escapeHtml(choice)}</span>
                        </label>
                    `).join('')}
                </div>
            `
            : `
                <textarea id="aiAssessAnswer${index}" rows="3" placeholder="Type your answer..."
                    class="mt-2 w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"></textarea>
            `;

        return `
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div class="text-xs text-slate-400 font-semibold mb-1">Q${index + 1}</div>
                <div class="text-sm text-slate-800">${escapeHtml(question.prompt)}</div>
                ${choicesMarkup}
            </div>
        `;
    }).join('');

    questionWrap.classList.remove('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (tagSplit) tagSplit.classList.add('hidden');
    if (gradeBtn) gradeBtn.disabled = false;

    // Apply syntax highlighting to code blocks
    setTimeout(() => {
        initAiCodeEditors();
        document.querySelectorAll('pre code').forEach(block => {
            if (window.hljs) {
                window.hljs.highlightElement(block);
            }
        });
    }, 100);
}

function collectAiAssessmentAnswers() {
    return aiAssessmentState.questions.map((question, index) => {
        const choices = Array.isArray(question.choices) ? question.choices : [];
        let answer = '';
        
        if (question.type === 'code_challenge') {
            const codeEditor = aiCodeEditors.get(index);
            if (codeEditor) {
                answer = String(codeEditor.getValue() || '').trim();
            } else {
                const codeArea = document.getElementById(`aiAssessCodeAnswer${index}`);
                answer = codeArea ? String(codeArea.value || '').trim() : '';
            }
        } else if (choices.length > 0) {
            const selected = document.querySelector(`input[name="aiAssessQ${index}"]:checked`);
            answer = selected ? String(selected.value || '').trim() : '';
        } else {
            const textArea = document.getElementById(`aiAssessAnswer${index}`);
            answer = textArea ? String(textArea.value || '').trim() : '';
        }
        return {
            questionId: question.id,
            answer
        };
    });
}

async function invokeAiAssessmentFunction(functionName, payload) {
    if (supabase && supabase.functions && typeof supabase.functions.invoke === 'function') {
        const { data, error } = await supabase.functions.invoke(functionName, { body: payload });
        if (error) throw new Error(error.message || `Function ${functionName} failed.`);
        return data;
    }

    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(String(data?.error || data?.message || `${functionName} failed (${response.status})`));
        }
        return data;
    }

    throw new Error('Cloud AI service is not configured. Add Supabase config and deploy AI Edge Functions.');
}

function openAiAssessment(topicId) {
    const topic = topics.find(item => item.id === topicId);
    if (!topic) return;

    const {
        modal,
        topicName,
        materialInput,
        questionWrap,
        resultWrap,
        questionList,
        generateBtn,
        regenerateBtn,
        gradeBtn,
        applyBtn,
        score,
        suggestion,
        feedback,
        tagSplit,
        knownTags,
        prepareTags
    } = getAiModalElements();
    if (!modal || !materialInput) return;

    destroyAiCodeEditors();

    aiAssessmentState = {
        topicId: topic.id,
        material: '',
        wordCount: 0,
        questionCount: 3,
        questions: [],
        result: null
    };

    if (topicName) topicName.textContent = topic.name;
    materialInput.value = '';
    if (questionList) questionList.innerHTML = '';
    if (questionWrap) questionWrap.classList.add('hidden');
    if (resultWrap) resultWrap.classList.add('hidden');
    if (score) score.textContent = '--';
    if (suggestion) suggestion.textContent = '--';
    if (feedback) feedback.textContent = '';
    if (tagSplit) tagSplit.classList.add('hidden');
    if (knownTags) knownTags.innerHTML = '';
    if (prepareTags) prepareTags.innerHTML = '';
    if (generateBtn) generateBtn.disabled = false;
    if (regenerateBtn) regenerateBtn.disabled = false;
    if (gradeBtn) gradeBtn.disabled = false;
    if (applyBtn) applyBtn.disabled = false;

    const savedQuiz = getSavedAiQuizForTopic(topic);
    if (savedQuiz) {
        aiAssessmentState.material = savedQuiz.material;
        aiAssessmentState.wordCount = savedQuiz.wordCount;
        aiAssessmentState.questionCount = savedQuiz.questions.length;
        aiAssessmentState.questions = savedQuiz.questions;
        materialInput.value = savedQuiz.material || '';
        renderAiAssessmentQuestions();
        syncAiAssessmentLengthDisplay();
        setAiAssessmentQuestionActionMode('regenerate');
        setAiAssessmentStatus('Loaded existing quiz. Use Regenerate Quiz only if you want a new one.', 'green');
    } else {
        updateAiAssessmentLengthInfo();
        setAiAssessmentQuestionActionMode('generate');
        setAiAssessmentStatus('Paste material to generate AI questions.', 'slate');
    }

    modal.classList.remove('hidden');
    materialInput.focus();
    trackClarityEvent('ai_assess_opened');
}

function closeAiAssessmentModal() {
    const { modal } = getAiModalElements();
    if (!modal) return;
    modal.classList.add('hidden');
    destroyAiCodeEditors();
    aiAssessmentState = {
        topicId: null,
        material: '',
        wordCount: 0,
        questionCount: 3,
        questions: [],
        result: null
    };
    setAiAssessmentQuestionActionMode('generate');
}

async function generateAiAssessmentQuestions(forceRegenerate = false) {
    const {
        generateBtn,
        regenerateBtn,
        gradeBtn,
        applyBtn,
        resultWrap
    } = getAiModalElements();

    const topic = topics.find(item => item.id === aiAssessmentState.topicId);
    if (!topic) {
        setAiAssessmentStatus('Topic not found.', 'red');
        return;
    }

    const savedQuiz = getSavedAiQuizForTopic(topic);
    if (!forceRegenerate && savedQuiz) {
        aiAssessmentState.material = savedQuiz.material;
        aiAssessmentState.wordCount = savedQuiz.wordCount;
        aiAssessmentState.questionCount = savedQuiz.questions.length;
        aiAssessmentState.questions = savedQuiz.questions;
        aiAssessmentState.result = null;
        const { materialInput } = getAiModalElements();
        if (materialInput) materialInput.value = savedQuiz.material || '';
        renderAiAssessmentQuestions();
        syncAiAssessmentLengthDisplay();
        setAiAssessmentQuestionActionMode('regenerate');
        setAiAssessmentStatus('Loaded existing quiz. Use Regenerate Quiz only if you want a new one.', 'green');
        return;
    }

    updateAiAssessmentLengthInfo();
    if (aiAssessmentState.wordCount < 30) {
        setAiAssessmentStatus('Add a little more material (at least ~30 words).', 'amber');
        return;
    }

    try {
        if (generateBtn) generateBtn.disabled = true;
        if (regenerateBtn) regenerateBtn.disabled = true;
        if (gradeBtn) gradeBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        if (resultWrap) resultWrap.classList.add('hidden');
        const { tagSplit } = getAiModalElements();
        if (tagSplit) tagSplit.classList.add('hidden');
        setAiAssessmentStatus('Generating questions with AI...', 'indigo');

        const response = await invokeAiAssessmentFunction(AI_GENERATE_FUNCTION, {
            topicId: topic.id,
            topicName: topic.name,
            material: aiAssessmentState.material,
            wordCount: aiAssessmentState.wordCount,
            questionCount: aiAssessmentState.questionCount
        });

        const questions = normalizeGeneratedQuestions(response?.questions || response);
        if (questions.length === 0) {
            throw new Error('AI did not return usable questions.');
        }

        aiAssessmentState.questions = questions.slice(0, aiAssessmentState.questionCount);
        aiAssessmentState.questionCount = aiAssessmentState.questions.length;
        aiAssessmentState.result = null;
        topic.lastAiQuiz = {
            generatedAt: new Date().toISOString(),
            material: aiAssessmentState.material,
            wordCount: aiAssessmentState.wordCount,
            questionCount: aiAssessmentState.questions.length,
            questions: aiAssessmentState.questions
        };
        save();
        renderAiAssessmentQuestions();
        syncAiAssessmentLengthDisplay();
        setAiAssessmentQuestionActionMode('regenerate');
        setAiAssessmentStatus(`Generated ${aiAssessmentState.questions.length} questions. Answer all and grade.`, 'green');
        trackClarityEvent('ai_assess_questions_generated');
    } catch (error) {
        console.error(error);
        setAiAssessmentStatus(
            `${error.message || 'Question generation failed.'} Deploy Edge Function: ${AI_GENERATE_FUNCTION}.`,
            'red'
        );
    } finally {
        if (generateBtn) generateBtn.disabled = false;
        if (regenerateBtn) regenerateBtn.disabled = false;
        if (gradeBtn) gradeBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = false;
    }
}

function regenerateAiAssessmentQuestions() {
    return generateAiAssessmentQuestions(true);
}

async function gradeAiAssessmentAnswers() {
    const {
        gradeBtn,
        regenerateBtn,
        applyBtn,
        resultWrap,
        score: scoreNode,
        suggestion: suggestionNode,
        feedback: feedbackNode
    } = getAiModalElements();

    if (!Array.isArray(aiAssessmentState.questions) || aiAssessmentState.questions.length === 0) {
        setAiAssessmentStatus('Generate questions first.', 'amber');
        return;
    }

    const topic = topics.find(item => item.id === aiAssessmentState.topicId);
    if (!topic) {
        setAiAssessmentStatus('Topic not found.', 'red');
        return;
    }

    const answers = collectAiAssessmentAnswers();
    const unanswered = answers.filter(item => !item.answer).length;
    if (unanswered > 0) {
        setAiAssessmentStatus(`Please answer all questions (${unanswered} remaining).`, 'amber');
        return;
    }

    try {
        if (gradeBtn) gradeBtn.disabled = true;
        if (regenerateBtn) regenerateBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        setAiAssessmentStatus('Evaluating your answers...', 'indigo');

        const response = await invokeAiAssessmentFunction(AI_GRADE_FUNCTION, {
            topicId: topic.id,
            topicName: topic.name,
            material: aiAssessmentState.material,
            wordCount: aiAssessmentState.wordCount,
            questionCount: aiAssessmentState.questions.length,
            questions: aiAssessmentState.questions,
            answers
        });

        const numericScore = Number(response?.score);
        const score = Number.isFinite(numericScore) ? Math.max(0, Math.min(100, numericScore)) : 0;
        const suggestedDifficulty = normalizeDifficultyLabel(response?.recommendedDifficulty || response?.difficulty) || scoreToDifficulty(score);
        const feedback = String(response?.feedback || response?.summary || '').trim();

        aiAssessmentState.result = {
            score,
            suggestedDifficulty,
            feedback
        };
        topic.lastAiAssessment = {
            date: new Date().toISOString(),
            score: Math.round(score),
            suggestedDifficulty,
            wordCount: aiAssessmentState.wordCount,
            questionCount: aiAssessmentState.questions.length
        };
        save();

        if (scoreNode) scoreNode.textContent = `${Math.round(score)}%`;
        if (suggestionNode) suggestionNode.textContent = difficultyToReadableLabel(suggestedDifficulty);
        if (feedbackNode) {
            feedbackNode.textContent = feedback || 'AI completed grading. Apply this result to update schedule.';
        }
        renderCurrentAiAssessmentTagSplit(topic, score);
        if (resultWrap) resultWrap.classList.remove('hidden');
        setAiAssessmentStatus('Assessment complete. Apply result to schedule.', 'green');
        trackClarityEvent('ai_assess_graded');
    } catch (error) {
        console.error(error);
        setAiAssessmentStatus(
            `${error.message || 'Grading failed.'} Deploy Edge Function: ${AI_GRADE_FUNCTION}.`,
            'red'
        );
    } finally {
        if (gradeBtn) gradeBtn.disabled = false;
        if (regenerateBtn) regenerateBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = false;
    }
}

function applyAiAssessmentResult() {
    const topic = topics.find(item => item.id === aiAssessmentState.topicId);
    const result = aiAssessmentState.result;
    if (!topic || !result) {
        setAiAssessmentStatus('Grade answers first.', 'amber');
        return;
    }

    topic.lastAiAssessment = {
        date: topic.lastAiAssessment?.date || new Date().toISOString(),
        score: Math.round(result.score),
        suggestedDifficulty: result.suggestedDifficulty,
        wordCount: aiAssessmentState.wordCount,
        questionCount: aiAssessmentState.questions.length
    };

    completeTopic(topic.id, result.suggestedDifficulty);
    setClarityTag('last_ai_assessment_score', Math.round(result.score));
    trackClarityEvent('ai_assess_applied');
    closeAiAssessmentModal();
}

function completeTopic(id, difficulty) {
    const topic = topics.find(t => t.id === id);
    if (!topic) return;
    const multipliers = { easy: 2.5, medium: 1.5, hard: 0 };
    if (!Object.prototype.hasOwnProperty.call(multipliers, difficulty)) return;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const minInterval = 1;
    const maxInterval = 120;
    const maxSingleJumpDays = 30;
    const minEase = 1.3;
    const maxEase = 2.8;
    const learningIntervals = [1, 2, 4];
    const maxLearningStep = learningIntervals.length;
    const previousInterval = clamp(Number(topic.interval) || minInterval, minInterval, maxInterval);
    let ease = clamp(Number(topic.ease) || 2.3, minEase, maxEase);
    let nextInterval = minInterval;
    const rawLearningStep = Number(topic.learningStep);
    let learningStep = Number.isFinite(rawLearningStep)
        ? Math.min(maxLearningStep, Math.max(0, Math.floor(rawLearningStep)))
        : 0;
    let inLearning = typeof topic.inLearning === 'boolean'
        ? topic.inLearning
        : (Number(topic.reviewCount) || 0) === 0;
    if (inLearning && learningStep >= maxLearningStep) {
        learningStep = maxLearningStep - 1;
    }
    const today = getDateKey(0);
    const dueDate = getDateObject(String(topic.nextReview || today));
    const todayDate = getDateObject(today);
    const hasValidDueDate = !Number.isNaN(dueDate.getTime()) && !Number.isNaN(todayDate.getTime());
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysFromDue = hasValidDueDate
        ? Math.floor((todayDate.getTime() - dueDate.getTime()) / msPerDay)
        : 0;
    const previousLastReviewedAtRaw = String(topic.lastReviewedAt || '').slice(0, 10);
    const hasValidLastReviewedAt = /^\d{4}-\d{2}-\d{2}$/.test(previousLastReviewedAtRaw);
    const previousLastReviewedDate = hasValidLastReviewedAt ? getDateObject(previousLastReviewedAtRaw) : null;
    const daysSinceLastReview = (
        previousLastReviewedDate &&
        !Number.isNaN(previousLastReviewedDate.getTime()) &&
        !Number.isNaN(todayDate.getTime())
    )
        ? Math.max(0, Math.floor((todayDate.getTime() - previousLastReviewedDate.getTime()) / msPerDay))
        : null;
    const wasOverdue = hasValidDueDate && daysFromDue > 0;
    const wasLearningAtReview = inLearning;
    const reviewHistory = Array.isArray(topic.recentReviewHistory)
        ? topic.recentReviewHistory
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => ({
                difficulty: String(entry.difficulty || '').toLowerCase(),
                date: String(entry.date || '').slice(0, 10)
            }))
            .filter(entry => (
                (entry.difficulty === 'hard' || entry.difficulty === 'medium' || entry.difficulty === 'easy') &&
                /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
            ))
            .slice(-10)
        : [];
    const fallbackOutcomes = Array.isArray(topic.recentOutcomes)
        ? topic.recentOutcomes
            .map(value => String(value).toLowerCase())
            .filter(value => value === 'hard' || value === 'medium' || value === 'easy')
            .slice(-10)
        : [];
    const baselineReviewHistory = reviewHistory.length > 0
        ? reviewHistory
        : fallbackOutcomes.map(difficultyValue => ({ difficulty: difficultyValue, date: today })).slice(-10);
    const stabilitySample = baselineReviewHistory.map(entry => entry.difficulty);
    const hardCount = stabilitySample.filter(value => value === 'hard').length;
    const hardRatio = stabilitySample.length > 0 ? hardCount / stabilitySample.length : 0;
    let recentHardStreak = 0;
    for (let i = stabilitySample.length - 1; i >= 0; i -= 1) {
        if (stabilitySample[i] !== 'hard') break;
        recentHardStreak += 1;
    }
    const stabilityFactor = clamp(1 - (hardRatio * 0.35) - (recentHardStreak * 0.08), 0.6, 1);

    if (difficulty === 'hard') {
        ease = clamp(ease - 0.2, minEase, maxEase);
        nextInterval = minInterval;
        topic.streak = 0;
        topic.lapses = Math.max(0, Number(topic.lapses) || 0) + 1;
        inLearning = true;
        learningStep = 0;
    } else {
        if (difficulty === 'easy') {
            ease = clamp(ease + 0.1, minEase, maxEase);
        } else if (difficulty === 'medium') {
            ease = clamp(ease - 0.05, minEase, maxEase);
        }
        if (inLearning) {
            const stepIndex = Math.min(learningStep, learningIntervals.length - 1);
            nextInterval = learningIntervals[stepIndex];
            if (stepIndex >= learningIntervals.length - 1) {
                inLearning = false;
                learningStep = maxLearningStep;
            } else {
                learningStep = stepIndex + 1;
            }
        } else {
            let timingFactor = 1;
            if (daysFromDue > 0) {
                const overdueRatio = Math.min(1, daysFromDue / Math.max(1, previousInterval));
                timingFactor += overdueRatio * 0.2;
            } else if (daysFromDue < 0) {
                const earlyRatio = Math.min(1, Math.abs(daysFromDue) / Math.max(1, previousInterval));
                timingFactor -= earlyRatio * 0.15;
            }
            timingFactor = clamp(timingFactor, 0.85, 1.2);
            const easeFactor = clamp(ease / 2.3, 0.75, 1.25);
            const multiplied = previousInterval * multipliers[difficulty] * timingFactor * easeFactor * stabilityFactor;
            const jumpCapped = Math.min(multiplied, previousInterval + maxSingleJumpDays);
            nextInterval = clamp(jumpCapped, minInterval, maxInterval);
        }
        topic.streak += 1;
    }

    if (wasOverdue) {
        topic.dueCount = Math.max(0, Number(topic.dueCount) || 0) + 1;
    }

    topic.ease = ease;
    topic.inLearning = inLearning;
    topic.learningStep = learningStep;
    topic.interval = nextInterval;
    let next = new Date();
    next.setDate(next.getDate() + Math.ceil(topic.interval));
    topic.nextReview = next.toISOString().split('T')[0];
    topic.reviewCount = (Number(topic.reviewCount) || 0) + 1;
    topic.lastReviewedAt = today;
    topic.recentOutcomes = [...stabilitySample, difficulty].slice(-10);
    topic.recentReviewHistory = [...baselineReviewHistory, { difficulty, date: today }].slice(-10);
    recordActivity(topic.weight, difficulty, topic.categories, {
        daysSinceLastReview,
        wasOverdue,
        hardWithin7d: difficulty === 'hard' && daysSinceLastReview != null && daysSinceLastReview <= 7,
        wasLearning: wasLearningAtReview,
        intervalAtReview: previousInterval
    });
    save();
    trackClarityEvent(`topic_completed_${difficulty}`);
    setClarityTag('last_topic_difficulty', difficulty);
}

function toDateKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function getDateKey(daysAgo = 0) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    return toDateKey(date);
}

function getDateObject(dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getActivityMap() {
    return new Map(activityLog.map(entry => [entry.date, entry]));
}

function getRecentActivity(days) {
    const activityMap = getActivityMap();
    const values = [];

    for (let i = days - 1; i >= 0; i -= 1) {
        const date = getDateKey(i);
        values.push(activityMap.get(date) || {
            date,
            minutes: 0,
            completed: 0,
            easy: 0,
            medium: 0,
            hard: 0,
            srsRetentionEligible: 0,
            srsRetentionSuccess: 0,
            srsHardWithin7d: 0,
            srsOverdueReviews: 0,
            srsDaysSinceLastTotal: 0,
            srsDaysSinceLastCount: 0,
            srsLearningReviews: 0,
            srsLearningHard: 0,
            srsGraduatedReviews: 0,
            srsGraduatedHard: 0,
            srsIntervalAtReviewTotal: 0,
            srsIntervalAtReviewCount: 0,
            categories: {}
        });
    }

    return values;
}

function getActiveStreak() {
    const activityMap = getActivityMap();
    let streak = 0;

    for (let i = 0; i < 3650; i += 1) {
        const date = getDateKey(i);
        const day = activityMap.get(date);
        if (!day || day.minutes <= 0) break;
        streak += 1;
    }

    return streak;
}

function recordActivity(minutes, difficulty, categories = [], srsMeta = {}) {
    const today = getDateKey(0);
    const day = activityLog.find(entry => entry.date === today);
    const categoryCounts = buildCategoryReviewCountMap(categories);
    const hasDaysSinceLast = srsMeta.daysSinceLastReview != null && Number.isFinite(Number(srsMeta.daysSinceLastReview));
    const parsedDaysSinceLast = hasDaysSinceLast ? Number(srsMeta.daysSinceLastReview) : null;
    const daysSinceLastReview = hasDaysSinceLast ? Math.max(0, parsedDaysSinceLast) : null;
    const wasOverdue = srsMeta.wasOverdue === true;
    const hardWithin7d = srsMeta.hardWithin7d === true;
    const wasLearning = srsMeta.wasLearning === true;
    const hasIntervalAtReview = srsMeta.intervalAtReview != null && Number.isFinite(Number(srsMeta.intervalAtReview));
    const parsedIntervalAtReview = hasIntervalAtReview ? Number(srsMeta.intervalAtReview) : null;
    const intervalAtReview = hasIntervalAtReview ? Math.max(0, parsedIntervalAtReview) : null;
    const retentionEligible = daysSinceLastReview != null && daysSinceLastReview <= 7;
    const retentionSuccess = retentionEligible && difficulty !== 'hard';

    if (day) {
        day.minutes += Math.max(0, Number(minutes) || 0);
        day.completed += 1;
        if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
            day[difficulty] += 1;
        }
        day.srsRetentionEligible = Math.max(0, Number(day.srsRetentionEligible) || 0) + (retentionEligible ? 1 : 0);
        day.srsRetentionSuccess = Math.max(0, Number(day.srsRetentionSuccess) || 0) + (retentionSuccess ? 1 : 0);
        day.srsHardWithin7d = Math.max(0, Number(day.srsHardWithin7d) || 0) + (hardWithin7d ? 1 : 0);
        day.srsOverdueReviews = Math.max(0, Number(day.srsOverdueReviews) || 0) + (wasOverdue ? 1 : 0);
        day.srsDaysSinceLastTotal = Math.max(0, Number(day.srsDaysSinceLastTotal) || 0) + (daysSinceLastReview != null ? daysSinceLastReview : 0);
        day.srsDaysSinceLastCount = Math.max(0, Number(day.srsDaysSinceLastCount) || 0) + (daysSinceLastReview != null ? 1 : 0);
        day.srsLearningReviews = Math.max(0, Number(day.srsLearningReviews) || 0) + (wasLearning ? 1 : 0);
        day.srsLearningHard = Math.max(0, Number(day.srsLearningHard) || 0) + (wasLearning && difficulty === 'hard' ? 1 : 0);
        day.srsGraduatedReviews = Math.max(0, Number(day.srsGraduatedReviews) || 0) + (wasLearning ? 0 : 1);
        day.srsGraduatedHard = Math.max(0, Number(day.srsGraduatedHard) || 0) + (!wasLearning && difficulty === 'hard' ? 1 : 0);
        day.srsIntervalAtReviewTotal = Math.max(0, Number(day.srsIntervalAtReviewTotal) || 0) + (intervalAtReview != null ? intervalAtReview : 0);
        day.srsIntervalAtReviewCount = Math.max(0, Number(day.srsIntervalAtReviewCount) || 0) + (intervalAtReview != null ? 1 : 0);
        day.categories = mergeCategoryCounts(day.categories, categoryCounts);
        return;
    }

    activityLog.push({
        date: today,
        minutes: Math.max(0, Number(minutes) || 0),
        completed: 1,
        easy: difficulty === 'easy' ? 1 : 0,
        medium: difficulty === 'medium' ? 1 : 0,
        hard: difficulty === 'hard' ? 1 : 0,
        srsRetentionEligible: retentionEligible ? 1 : 0,
        srsRetentionSuccess: retentionSuccess ? 1 : 0,
        srsHardWithin7d: hardWithin7d ? 1 : 0,
        srsOverdueReviews: wasOverdue ? 1 : 0,
        srsDaysSinceLastTotal: daysSinceLastReview != null ? daysSinceLastReview : 0,
        srsDaysSinceLastCount: daysSinceLastReview != null ? 1 : 0,
        srsLearningReviews: wasLearning ? 1 : 0,
        srsLearningHard: wasLearning && difficulty === 'hard' ? 1 : 0,
        srsGraduatedReviews: wasLearning ? 0 : 1,
        srsGraduatedHard: !wasLearning && difficulty === 'hard' ? 1 : 0,
        srsIntervalAtReviewTotal: intervalAtReview != null ? intervalAtReview : 0,
        srsIntervalAtReviewCount: intervalAtReview != null ? 1 : 0,
        categories: categoryCounts
    });
    activityLog = normalizeActivityLog(activityLog);
}

function renderAnalytics() {
    const recent14 = getRecentActivity(14);
    const recent7 = recent14.slice(-7);
    const today = recent14[recent14.length - 1];

    const weekMinutes = recent7.reduce((sum, day) => sum + day.minutes, 0);
    const weekSessions = recent7.reduce((sum, day) => sum + day.completed, 0);
    const streak = getActiveStreak();
    const peakDay = recent14.reduce((peak, day) => day.minutes > peak.minutes ? day : peak, { date: '', minutes: 0 });

    document.getElementById('statTodayMinutes').textContent = `${today.minutes}m`;
    document.getElementById('statWeeklyMinutes').textContent = `${weekMinutes}m`;
    document.getElementById('statWeeklySessions').textContent = String(weekSessions);
    document.getElementById('statStreak').textContent = `${streak}d`;
    document.getElementById('chartPeakLabel').textContent = peakDay.minutes > 0 ? `Peak: ${peakDay.minutes}m (${peakDay.date})` : 'Peak: 0m';

    const now = new Date();
    document.getElementById('analyticsUpdated').textContent = `Updated ${now.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    })}`;

    const maxMinutes = Math.max(...recent14.map(day => day.minutes), 1);
    document.getElementById('activityChart').innerHTML = recent14.map(day => {
        const label = getDateObject(day.date).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
        const height = day.minutes === 0 ? 8 : Math.max(14, Math.round((day.minutes / maxMinutes) * 150));
        const color = day.minutes === 0
            ? 'bg-slate-200'
            : day.minutes >= maxMinutes * 0.75
                ? 'bg-indigo-500'
                : day.minutes >= maxMinutes * 0.4
                    ? 'bg-indigo-400'
                    : 'bg-indigo-300';
        const highlightClass = day.date === getDateKey(0) ? 'ring-2 ring-indigo-200' : '';

        return `
            <div class="flex-1 min-w-0 flex flex-col items-center justify-end gap-2" title="${day.date}: ${day.minutes} min, ${day.completed} sessions">
                <div class="w-full rounded-t-md ${color} ${highlightClass}" style="height:${height}px"></div>
                <div class="text-[10px] text-slate-400">${label}</div>
            </div>
        `;
    }).join('');

    const totals = recent7.reduce((acc, day) => {
        acc.easy += day.easy;
        acc.medium += day.medium;
        acc.hard += day.hard;
        return acc;
    }, { easy: 0, medium: 0, hard: 0 });

    const totalDifficulty = totals.easy + totals.medium + totals.hard;
    const breakdown = [
        { key: 'easy', label: 'Mastered', color: 'bg-green-500' },
        { key: 'medium', label: 'Okay', color: 'bg-amber-500' },
        { key: 'hard', label: 'Struggled', color: 'bg-red-500' }
    ];

    document.getElementById('difficultyBreakdown').innerHTML = breakdown.map(item => {
        const count = totals[item.key];
        const pct = totalDifficulty ? Math.round((count / totalDifficulty) * 100) : 0;

        return `
            <div>
                <div class="flex justify-between text-xs text-slate-500 mb-1">
                    <span>${item.label}</span>
                    <span>${count} (${pct}%)</span>
                </div>
                <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div class="${item.color} h-full" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');

    const srsRecent30 = getRecentActivity(30);
    const srsTotals = srsRecent30.reduce((acc, day) => {
        acc.reviews += Math.max(0, Number(day.completed) || 0);
        acc.retentionEligible += Math.max(0, Number(day.srsRetentionEligible) || 0);
        acc.retentionSuccess += Math.max(0, Number(day.srsRetentionSuccess) || 0);
        acc.hardWithin7d += Math.max(0, Number(day.srsHardWithin7d) || 0);
        acc.overdue += Math.max(0, Number(day.srsOverdueReviews) || 0);
        acc.daysTotal += Math.max(0, Number(day.srsDaysSinceLastTotal) || 0);
        acc.daysCount += Math.max(0, Number(day.srsDaysSinceLastCount) || 0);
        acc.learningReviews += Math.max(0, Number(day.srsLearningReviews) || 0);
        acc.learningHard += Math.max(0, Number(day.srsLearningHard) || 0);
        acc.graduatedReviews += Math.max(0, Number(day.srsGraduatedReviews) || 0);
        acc.graduatedHard += Math.max(0, Number(day.srsGraduatedHard) || 0);
        acc.intervalTotal += Math.max(0, Number(day.srsIntervalAtReviewTotal) || 0);
        acc.intervalCount += Math.max(0, Number(day.srsIntervalAtReviewCount) || 0);
        return acc;
    }, {
        reviews: 0,
        retentionEligible: 0,
        retentionSuccess: 0,
        hardWithin7d: 0,
        overdue: 0,
        daysTotal: 0,
        daysCount: 0,
        learningReviews: 0,
        learningHard: 0,
        graduatedReviews: 0,
        graduatedHard: 0,
        intervalTotal: 0,
        intervalCount: 0
    });

    const formatPercent = (num, den) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '--');
    const retentionProxy = formatPercent(srsTotals.retentionSuccess, srsTotals.retentionEligible);
    const hardWithin7dRate = formatPercent(srsTotals.hardWithin7d, srsTotals.retentionEligible);
    const overdueRate = formatPercent(srsTotals.overdue, srsTotals.reviews);
    const learningHardRate = formatPercent(srsTotals.learningHard, srsTotals.learningReviews);
    const graduatedHardRate = formatPercent(srsTotals.graduatedHard, srsTotals.graduatedReviews);
    const avgDaysSinceLast = srsTotals.daysCount > 0
        ? `${(srsTotals.daysTotal / srsTotals.daysCount).toFixed(1)}d`
        : '--';
    const avgIntervalAtReview = srsTotals.intervalCount > 0
        ? `${(srsTotals.intervalTotal / srsTotals.intervalCount).toFixed(1)}d`
        : '--';

    document.getElementById('srsRetentionProxy').textContent = retentionProxy;
    document.getElementById('srsHardWithin7d').textContent = hardWithin7dRate;
    document.getElementById('srsOverdueRate').textContent = overdueRate;
    document.getElementById('srsAvgDaysSinceLast').textContent = avgDaysSinceLast;
    document.getElementById('srsAvgIntervalAtReview').textContent = avgIntervalAtReview;
    document.getElementById('srsBucketBreakdown').innerHTML = `
        <div class="flex justify-between text-xs text-slate-600">
            <span>Learning hard rate</span>
            <span class="font-semibold">${learningHardRate}</span>
        </div>
        <div class="flex justify-between text-xs text-slate-600">
            <span>Graduated hard rate</span>
            <span class="font-semibold">${graduatedHardRate}</span>
        </div>
    `;
    document.getElementById('srsQualityNote').textContent = srsTotals.retentionEligible > 0
        ? `Based on ${srsTotals.retentionEligible} short-gap reviews in the last 30 days`
        : 'Review more in the next few days to build retention signal';

    const categoryTotals = Object.entries(getCategoryReviewTotals());
    const sorted = [...categoryTotals].sort((a, b) => {
        if (categorySortOrder === 'asc') return a[1] - b[1] || a[0].localeCompare(b[0]);
        return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    document.getElementById('categoryRankSource').textContent =
        'Based on topic review totals since start (resets if topic is deleted)';
    document.getElementById('categorySortLabel').textContent = categorySortOrder === 'desc' ? 'High to Low' : 'Low to High';
    document.getElementById('categorySortIcon').textContent = categorySortOrder === 'desc' ? '↓' : '↑';

    const renderCategoryList = (items) => {
        if (items.length === 0) {
            return `<div class="text-xs text-slate-400">No categories yet.</div>`;
        }
        return items.map(([category, count]) => `
            <div class="flex justify-between items-center text-xs">
                <span class="text-slate-600 font-medium">${escapeHtml(category)}</span>
                <span class="text-slate-500">${count} reviews</span>
            </div>
        `).join('');
    };

    document.getElementById('categoryRankList').innerHTML = renderCategoryList(sorted);

    const categoryTopicTotals = Object.entries(getCategoryTopicTotals())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const maxTopicCount = Math.max(...categoryTopicTotals.map(([, count]) => count), 1);
    document.getElementById('categoryTopicCountChart').innerHTML = categoryTopicTotals.length === 0
        ? `<div class="text-xs text-slate-400">No categories yet.</div>`
        : categoryTopicTotals.map(([category, count]) => {
            const width = Math.max(8, Math.round((count / maxTopicCount) * 100));
            return `
                <div>
                    <div class="flex justify-between items-center text-xs mb-1">
                        <span class="text-slate-600 font-medium">${escapeHtml(category)}</span>
                        <span class="text-slate-500">${count} topics</span>
                    </div>
                    <div class="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div class="h-full bg-indigo-500" style="width:${width}%"></div>
                    </div>
                </div>
            `;
        }).join('');
}

// --- Render Functions ---

function render() {
    const agendaList = document.getElementById('agendaList');
    const loadIndicator = document.getElementById('loadIndicator');
    const overflowNotice = document.getElementById('overflowNotice');
    const dailyCap = parseInt(document.getElementById('dailyCap').value);
    const today = getDateKey(0);
    const todayDate = getDateObject(today);
    const msPerDay = 24 * 60 * 60 * 1000;
    const learningPhaseCount = 3;

    let currentLoad = 0;
    let hasOverflow = false;
    agendaList.innerHTML = '';

    const getReviewDifficultySample = (topic) => {
        if (Array.isArray(topic.recentReviewHistory)) {
            const values = topic.recentReviewHistory
                .filter(entry => entry && typeof entry === 'object')
                .map(entry => String(entry.difficulty || '').toLowerCase())
                .filter(value => value === 'hard' || value === 'medium' || value === 'easy')
                .slice(-10);
            if (values.length > 0) return values;
        }
        if (Array.isArray(topic.recentOutcomes)) {
            return topic.recentOutcomes
                .map(value => String(value).toLowerCase())
                .filter(value => value === 'hard' || value === 'medium' || value === 'easy')
                .slice(-10);
        }
        return [];
    };

    const getDuePriority = (topic) => {
        const dueDate = getDateObject(String(topic.nextReview || today));
        const dueDateValid = !Number.isNaN(dueDate.getTime()) && !Number.isNaN(todayDate.getTime());
        const overdueDays = dueDateValid
            ? Math.max(0, Math.floor((todayDate.getTime() - dueDate.getTime()) / msPerDay))
            : 0;
        const lapses = Math.max(0, Number(topic.lapses) || 0);
        const parsedEase = Number(topic.ease);
        const ease = Number.isFinite(parsedEase) ? Math.min(2.8, Math.max(1.3, parsedEase)) : 2.3;
        const inLearning = topic.inLearning === true;
        const learningStep = Math.max(0, Number(topic.learningStep) || 0);
        const difficultySample = getReviewDifficultySample(topic);
        const hardCount = difficultySample.filter(value => value === 'hard').length;
        const hardRate = difficultySample.length > 0 ? hardCount / difficultySample.length : 0;

        const score =
            (inLearning ? 6 : 0) +
            (overdueDays * 5) +
            (lapses * 3) +
            ((2.8 - ease) * 2) +
            (hardRate * 4);

        const reasonParts = [];
        if (inLearning) {
            reasonParts.push(`Learning ${Math.min(learningPhaseCount, learningStep + 1)}/${learningPhaseCount}`);
        }
        if (overdueDays > 0) reasonParts.push(`Overdue ${overdueDays}d`);
        if (lapses > 0) reasonParts.push(`${lapses} lapse${lapses === 1 ? '' : 's'}`);
        if (difficultySample.length >= 3 && hardRate >= 0.34) {
            reasonParts.push(`${Math.round(hardRate * 100)}% hard recently`);
        }

        return {
            score,
            reason: reasonParts.length > 0 ? reasonParts.join(' • ') : 'Due today'
        };
    };

    const dueTopics = topics
        .filter(t => t.nextReview <= today)
        .map(topic => ({ topic, priority: getDuePriority(topic) }))
        .sort((a, b) => {
            if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
            if (a.topic.weight !== b.topic.weight) return a.topic.weight - b.topic.weight;
            return String(a.topic.name || '').localeCompare(String(b.topic.name || ''));
        });

    dueTopics.forEach(({ topic, priority }) => {
        if (currentLoad + topic.weight <= dailyCap) {
            currentLoad += topic.weight;
            const card = document.createElement('div');
            card.className = "topic-card bg-white p-5 rounded-2xl shadow-sm border-l-4 border-indigo-500 flex flex-col md:flex-row justify-between items-center gap-4 border border-slate-100 fade-in";
            card.innerHTML = `
                <div class="flex-1">
                    <h3 class="font-bold text-lg">${escapeHtml(topic.name)}</h3>
                    ${renderCategoryBadges(topic.categories)}
                    <div class="flex gap-3 text-xs text-slate-400 mt-1 uppercase font-semibold">
                        <span>⏱️ ${topic.weight} min</span>
                        <span>🔥 Streak: ${topic.streak}</span>
                    </div>
                    <div class="text-xs text-slate-500 mt-1">${priority.reason}</div>
                </div>
                <div class="flex gap-2">
                    <button onclick="completeTopic(${topic.id}, 'hard')" class="px-3 py-2 text-xs font-bold rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Struggled</button>
                    <button onclick="completeTopic(${topic.id}, 'medium')" class="px-3 py-2 text-xs font-bold rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50">Okay</button>
                    <button onclick="completeTopic(${topic.id}, 'easy')" class="px-4 py-2 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700">Mastered</button>
                    <button onclick="openAiAssessment(${topic.id})" class="px-3 py-2 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50">Assess with AI</button>
                </div>`;
            agendaList.appendChild(card);
        } else { hasOverflow = true; }
    });

    if (agendaList.innerHTML === '') {
        agendaList.innerHTML = `<div class="text-center py-12 text-slate-400 bg-slate-100 rounded-xl">Rest your brain. All tasks complete!</div>`;
    }

    loadIndicator.innerText = `Load: ${currentLoad} / ${dailyCap} min`;
    loadIndicator.className = `text-sm font-medium px-4 py-1 rounded-full ${currentLoad > dailyCap * 0.9 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`;
    overflowNotice.classList.toggle('hidden', !hasOverflow);
    renderAiTagReadiness();
}

function renderLibrary() {
    const libraryList = document.getElementById('libraryList');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();

    libraryList.innerHTML = '';

    const filtered = topics.filter(t =>
        t.name.toLowerCase().includes(searchTerm) ||
        normalizeCategoryList(t.categories).some(category => category.toLowerCase().includes(searchTerm))
    );

    filtered.forEach(topic => {
        const item = document.createElement('div');
        item.className = "flex justify-between items-center p-3 bg-white rounded-lg border border-slate-100 hover:shadow-sm";
        item.innerHTML = `
            <div>
                <div class="font-semibold text-slate-700">${escapeHtml(topic.name)}</div>
                ${renderCategoryBadges(topic.categories)}
                <div class="text-xs text-slate-400">Next: ${topic.nextReview}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="editTopic(${topic.id})" class="text-slate-400 hover:text-indigo-600 p-1">✏️</button>
                <button onclick="deleteTopic(${topic.id})" class="text-slate-400 hover:text-red-600 p-1">🗑️</button>
            </div>
        `;
        libraryList.appendChild(item);
    });
}

// Backup/Restore Logic
function exportData() {
    const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        topics,
        activityLog
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload));
    const node = document.createElement('a');
    node.setAttribute("href", dataStr);
    node.setAttribute("download", "intellectflow_backup_" + new Date().toISOString().split('T')[0] + ".json");
    document.body.appendChild(node);
    node.click();
    node.remove();
    trackClarityEvent('backup_exported');
}

function importData(event) {
    trackClarityEvent('backup_import_attempt');
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                topics = normalizeTopics(imported);
                activityLog = [];
                save();
                trackClarityEvent('backup_import_success');
                alert("Data successfully restored!");
                return;
            }

            if (imported && typeof imported === 'object' && Array.isArray(imported.topics)) {
                topics = normalizeTopics(imported.topics);
                activityLog = normalizeActivityLog(imported.activityLog || []);
                save();
                trackClarityEvent('backup_import_success');
                alert("Data successfully restored!");
                return;
            }

            throw new Error('Unsupported backup format');
        } catch (err) {
            trackClarityEvent('backup_import_failed');
            alert("Invalid file format.");
        }
    };
    reader.readAsText(event.target.files[0]);
}

const aiAssessMaterialInput = document.getElementById('aiAssessMaterialInput');
if (aiAssessMaterialInput) {
    aiAssessMaterialInput.addEventListener('input', updateAiAssessmentLengthInfo);
}
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const { modal } = getAiModalElements();
    if (modal && !modal.classList.contains('hidden')) {
        closeAiAssessmentModal();
    }
});

initRouting();
render();
renderLibrary();
renderAnalytics();
updateClarityContext();
trackClarityEvent('app_loaded');
updateAuthControls();
initCloudSync();
