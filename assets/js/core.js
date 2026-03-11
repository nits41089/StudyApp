const SUPABASE_URL = 'https://onqncpdvxjlkraqybmfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ucW5jcGR2eGpsa3JhcXlibWZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NDYxODUsImV4cCI6MjA4NzMyMjE4NX0.xonXlN-kUPTV_9C269hFObWz4VWiq23wpj-TmschhDw';
const STORAGE_KEY = 'study-topics';
const ACTIVITY_STORAGE_KEY = 'study-activity-log';
const SYNC_META_KEY = 'study-sync-meta';

let topics = loadLocalTopics();
let activityLog = loadLocalActivity();
let syncMeta = loadSyncMeta();
let isEditing = false;
let supabase = null;
let currentUser = null;
let saveTimer = null;
let syncInFlight = false;
let pendingAutoSync = false;
let isHydratingRemote = false;
let cloudSupportsActivityLog = true;
let categorySortOrder = 'desc';
let currentRoute = 'dashboard';
let clarityTagCache = {};
ensureSyncMetaInitialized();

function loadLocalTopics() {
    try {
        return normalizeTopics(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
    } catch {
        return [];
    }
}

function loadLocalActivity() {
    try {
        return normalizeActivityLog(JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY)) || []);
    } catch {
        return [];
    }
}

function parseTimestamp(value) {
    const ts = new Date(value || 0).getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function loadSyncMeta() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}');
        return {
            lastLocalChangeAt: typeof parsed.lastLocalChangeAt === 'string' ? parsed.lastLocalChangeAt : null,
            lastSuccessfulSyncAt: typeof parsed.lastSuccessfulSyncAt === 'string' ? parsed.lastSuccessfulSyncAt : null
        };
    } catch {
        return { lastLocalChangeAt: null, lastSuccessfulSyncAt: null };
    }
}

function persistSyncMeta() {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
}

function ensureSyncMetaInitialized() {
    if (syncMeta.lastLocalChangeAt) return;
    if (topics.length === 0 && activityLog.length === 0) return;
    syncMeta.lastLocalChangeAt = new Date().toISOString();
    persistSyncMeta();
}

function markLocalChanged(timestamp = new Date().toISOString()) {
    syncMeta.lastLocalChangeAt = timestamp;
    persistSyncMeta();
}

function markCloudSynced(timestamp = new Date().toISOString()) {
    syncMeta.lastLocalChangeAt = timestamp;
    syncMeta.lastSuccessfulSyncAt = timestamp;
    persistSyncMeta();
}

function normalizeCategoryList(raw) {
    const source = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
            ? raw.split(',')
            : [];

    const seen = new Set();
    const categories = [];

    source.forEach(item => {
        const cleaned = String(item || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        categories.push(cleaned);
    });

    return categories;
}

function normalizeCategoryCountMap(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const counts = {};
    Object.entries(raw).forEach(([category, value]) => {
        const normalizedCategory = normalizeCategoryList([category])[0];
        const count = Math.max(0, Number(value) || 0);
        if (!normalizedCategory || count <= 0) return;
        counts[normalizedCategory] = (counts[normalizedCategory] || 0) + count;
    });

    return counts;
}

function mergeCategoryCounts(base, incoming) {
    const merged = normalizeCategoryCountMap(base);
    Object.entries(normalizeCategoryCountMap(incoming)).forEach(([category, count]) => {
        merged[category] = (merged[category] || 0) + count;
    });
    return merged;
}

function buildCategoryReviewCountMap(categories) {
    const normalized = normalizeCategoryList(categories);
    if (normalized.length === 0) return { Uncategorized: 1 };

    return normalized.reduce((acc, category) => {
        acc[category] = (acc[category] || 0) + 1;
        return acc;
    }, {});
}

function getCategoryReviewTotals() {
    return topics.reduce((totals, topic) => {
        const categories = normalizeCategoryList(topic.categories);
        const reviewCount = Math.max(0, Number(topic.reviewCount) || 0);
        const buckets = categories.length > 0 ? categories : ['Uncategorized'];

        buckets.forEach(category => {
            if (!(category in totals)) totals[category] = 0;
            totals[category] += reviewCount;
        });
        return totals;
    }, {});
}

function getCategoryTopicTotals() {
    return topics.reduce((totals, topic) => {
        const categories = normalizeCategoryList(topic.categories);
        const buckets = categories.length > 0 ? categories : ['Uncategorized'];

        buckets.forEach(category => {
            totals[category] = (totals[category] || 0) + 1;
        });
        return totals;
    }, {});
}

function renderCategoryBadges(categories) {
    const normalized = normalizeCategoryList(categories);
    if (normalized.length === 0) return '';

    return `
        <div class="mt-2 flex flex-wrap gap-1.5">
            ${normalized.map(category => `<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold uppercase tracking-wide">${escapeHtml(category)}</span>`).join('')}
        </div>
    `;
}

function normalizeTopics(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(item => item && typeof item === 'object')
        .map(item => {
            const lastReviewedAtRaw = String(item.lastReviewedAt || '').slice(0, 10);
            const hasValidLastReviewedAt = /^\d{4}-\d{2}-\d{2}$/.test(lastReviewedAtRaw);
            const recentOutcomes = Array.isArray(item.recentOutcomes)
                ? item.recentOutcomes
                    .map(value => String(value).toLowerCase())
                    .filter(value => value === 'hard' || value === 'medium' || value === 'easy')
                    .slice(-10)
                : [];
            const recentReviewHistory = Array.isArray(item.recentReviewHistory)
                ? item.recentReviewHistory
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
            const fallbackHistoryDate = hasValidLastReviewedAt
                ? lastReviewedAtRaw
                : new Date().toISOString().split('T')[0];
            const normalizedReviewHistory = recentReviewHistory.length > 0
                ? recentReviewHistory
                : recentOutcomes
                    .map(difficulty => ({ difficulty, date: fallbackHistoryDate }))
                    .slice(-10);
            const normalizedRecentOutcomes = recentOutcomes.length > 0
                ? recentOutcomes
                : normalizedReviewHistory.map(entry => entry.difficulty).slice(-10);
            const parsedEase = Number(item.ease);
            const normalizedEase = Number.isFinite(parsedEase)
                ? Math.min(2.8, Math.max(1.3, parsedEase))
                : 2.3;
            const maxLearningStep = 3;
            const parsedLearningStep = Number(item.learningStep);
            const normalizedLearningStep = Number.isFinite(parsedLearningStep)
                ? Math.min(maxLearningStep, Math.max(0, Math.floor(parsedLearningStep)))
                : 0;
            const normalizedInLearning = typeof item.inLearning === 'boolean'
                ? item.inLearning
                : (Math.max(0, Number(item.reviewCount) || 0) === 0);

            return {
                id: Number(item.id) || Date.now() + Math.floor(Math.random() * 1000),
                name: String(item.name || '').trim(),
                weight: Number(item.weight) || 45,
                nextReview: String(item.nextReview || new Date().toISOString().split('T')[0]),
                interval: Number(item.interval) || 1,
                streak: Number(item.streak) || 0,
                reviewCount: Math.max(0, Number(item.reviewCount) || 0),
                ease: normalizedEase,
                lapses: Math.max(0, Number(item.lapses) || 0),
                lastReviewedAt: hasValidLastReviewedAt ? lastReviewedAtRaw : null,
                dueCount: Math.max(0, Number(item.dueCount) || 0),
                recentOutcomes: normalizedRecentOutcomes,
                recentReviewHistory: normalizedReviewHistory,
                inLearning: normalizedInLearning && normalizedLearningStep < maxLearningStep,
                learningStep: normalizedLearningStep,
                categories: normalizeCategoryList(item.categories || item.category || [])
            };
        })
        .filter(item => item.name);
}

function normalizeActivityLog(raw) {
    if (!Array.isArray(raw)) return [];

    const byDate = new Map();

    raw.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const date = String(item.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

        const sanitized = {
            date,
            minutes: Math.max(0, Number(item.minutes) || 0),
            completed: Math.max(0, Number(item.completed) || 0),
            easy: Math.max(0, Number(item.easy) || 0),
            medium: Math.max(0, Number(item.medium) || 0),
            hard: Math.max(0, Number(item.hard) || 0),
            srsRetentionEligible: Math.max(0, Number(item.srsRetentionEligible) || 0),
            srsRetentionSuccess: Math.max(0, Number(item.srsRetentionSuccess) || 0),
            srsHardWithin7d: Math.max(0, Number(item.srsHardWithin7d) || 0),
            srsOverdueReviews: Math.max(0, Number(item.srsOverdueReviews) || 0),
            srsDaysSinceLastTotal: Math.max(0, Number(item.srsDaysSinceLastTotal) || 0),
            srsDaysSinceLastCount: Math.max(0, Number(item.srsDaysSinceLastCount) || 0),
            srsLearningReviews: Math.max(0, Number(item.srsLearningReviews) || 0),
            srsLearningHard: Math.max(0, Number(item.srsLearningHard) || 0),
            srsGraduatedReviews: Math.max(0, Number(item.srsGraduatedReviews) || 0),
            srsGraduatedHard: Math.max(0, Number(item.srsGraduatedHard) || 0),
            srsIntervalAtReviewTotal: Math.max(0, Number(item.srsIntervalAtReviewTotal) || 0),
            srsIntervalAtReviewCount: Math.max(0, Number(item.srsIntervalAtReviewCount) || 0),
            categories: normalizeCategoryCountMap(item.categories)
        };

        const existing = byDate.get(date) || {
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
        };

        existing.minutes += sanitized.minutes;
        existing.completed += sanitized.completed;
        existing.easy += sanitized.easy;
        existing.medium += sanitized.medium;
        existing.hard += sanitized.hard;
        existing.srsRetentionEligible += sanitized.srsRetentionEligible;
        existing.srsRetentionSuccess += sanitized.srsRetentionSuccess;
        existing.srsHardWithin7d += sanitized.srsHardWithin7d;
        existing.srsOverdueReviews += sanitized.srsOverdueReviews;
        existing.srsDaysSinceLastTotal += sanitized.srsDaysSinceLastTotal;
        existing.srsDaysSinceLastCount += sanitized.srsDaysSinceLastCount;
        existing.srsLearningReviews += sanitized.srsLearningReviews;
        existing.srsLearningHard += sanitized.srsLearningHard;
        existing.srsGraduatedReviews += sanitized.srsGraduatedReviews;
        existing.srsGraduatedHard += sanitized.srsGraduatedHard;
        existing.srsIntervalAtReviewTotal += sanitized.srsIntervalAtReviewTotal;
        existing.srsIntervalAtReviewCount += sanitized.srsIntervalAtReviewCount;
        existing.categories = mergeCategoryCounts(existing.categories, sanitized.categories);
        byDate.set(date, existing);
    });

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function trackClarityEvent(eventName) {
    if (!eventName || typeof window.clarity !== 'function') return;
    try {
        window.clarity('event', String(eventName));
    } catch (error) {
        console.warn('Clarity event failed:', error);
    }
}

function setClarityTag(key, value) {
    if (!key || value == null || typeof window.clarity !== 'function') return;
    try {
        const stringValue = String(value);
        if (clarityTagCache[key] === stringValue) return;
        clarityTagCache[key] = stringValue;
        window.clarity('set', String(key), stringValue);
    } catch (error) {
        console.warn('Clarity tag failed:', error);
    }
}

function updateClarityContext() {
    setClarityTag('auth_state', currentUser ? 'signed_in' : 'signed_out');
    setClarityTag('cloud_sync_configured', (SUPABASE_URL && SUPABASE_ANON_KEY) ? 'yes' : 'no');
    setClarityTag('cloud_activity_sync', cloudSupportsActivityLog ? 'enabled' : 'schema_missing');
    setClarityTag('category_sort_order', categorySortOrder);
    setClarityTag('active_route', currentRoute);
    setClarityTag('topic_count', topics.length);
    setClarityTag('topic_count_bucket', topics.length === 0 ? '0' : topics.length <= 5 ? '1-5' : topics.length <= 20 ? '6-20' : '21+');
    setClarityTag('activity_days_logged', activityLog.length);
}

function getRouteFromHash() {
    const hash = (window.location.hash || '').trim().toLowerCase();
    const route = hash.replace(/^#\/?/, '');
    const allowed = ['dashboard', 'analytics', 'topics', 'sync'];
    return allowed.includes(route) ? route : 'dashboard';
}

function setRouteHash(route, replace = false) {
    const target = `#/${route}`;
    if (replace && window.history?.replaceState) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${target}`);
        return;
    }
    window.location.hash = target;
}

function applyRoute(route) {
    currentRoute = route;
    const sections = document.querySelectorAll('[data-route-section]');
    sections.forEach(section => {
        const routes = (section.dataset.routeSection || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        section.classList.toggle('hidden', !routes.includes(route));
    });

    const links = document.querySelectorAll('[data-route-link]');
    links.forEach(link => {
        const active = link.dataset.routeLink === route;
        link.classList.toggle('bg-indigo-600', active);
        link.classList.toggle('text-white', active);
        link.classList.toggle('border-indigo-600', active);
        link.classList.toggle('bg-white', !active);
        link.classList.toggle('text-slate-600', !active);
        link.classList.toggle('border-slate-200', !active);
    });
}

function initRouting() {
    const route = getRouteFromHash();
    if ((window.location.hash || '').toLowerCase() !== `#/${route}`) {
        setRouteHash(route, true);
    }
    applyRoute(route);
    window.addEventListener('hashchange', () => {
        const nextRoute = getRouteFromHash();
        if ((window.location.hash || '').toLowerCase() !== `#/${nextRoute}`) {
            setRouteHash(nextRoute, true);
        }
        applyRoute(nextRoute);
        updateClarityContext();
    });
}

function toggleCategorySort() {
    categorySortOrder = categorySortOrder === 'desc' ? 'asc' : 'desc';
    renderAnalytics();
    updateClarityContext();
    trackClarityEvent('category_sort_toggled');
}

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activityLog));
    markLocalChanged();
    render();
    renderLibrary();
    renderAnalytics();
    updateClarityContext();
    queueRemoteSave();
}

function isMissingActivityColumnError(error) {
    const message = String(error?.message || error?.details || '').toLowerCase();
    return message.includes('activity_log') && (message.includes('column') || message.includes('schema cache'));
}

function setSyncStatus(text, tone = 'slate') {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const toneClasses = {
        slate: 'bg-slate-100 text-slate-600',
        indigo: 'bg-indigo-100 text-indigo-700',
        green: 'bg-green-100 text-green-700',
        amber: 'bg-amber-100 text-amber-700',
        red: 'bg-red-100 text-red-700'
    };
    el.className = `inline-flex mt-2 text-xs font-semibold px-3 py-1 rounded-full ${toneClasses[tone] || toneClasses.slate}`;
    el.textContent = text;
}

function updateAuthControls() {
    const signedIn = !!currentUser;
    const cloudReady = !!supabase;

    document.getElementById('signUpBtn').disabled = !cloudReady || signedIn;
    document.getElementById('signInBtn').disabled = !cloudReady || signedIn;
    document.getElementById('syncNowBtn').disabled = !cloudReady || !signedIn || syncInFlight;
    document.getElementById('signOutBtn').disabled = !cloudReady || !signedIn;
    document.getElementById('authEmail').disabled = !cloudReady || signedIn;
    document.getElementById('authPassword').disabled = !cloudReady || signedIn;

    if (signedIn) {
        document.getElementById('authPassword').value = '';
    }
}

function queueRemoteSave() {
    if (!supabase || !currentUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        syncNow('auto');
    }, 500);
}
