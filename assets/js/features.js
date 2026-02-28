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

function completeTopic(id, difficulty) {
    const topic = topics.find(t => t.id === id);
    if (!topic) return;
    const multipliers = { easy: 2.5, medium: 1.5, hard: 0 };

    if (difficulty === 'hard') {
        topic.interval = 1;
        topic.streak = 0;
    } else {
        topic.interval *= multipliers[difficulty];
        topic.streak += 1;
    }

    let next = new Date();
    next.setDate(next.getDate() + Math.ceil(topic.interval));
    topic.nextReview = next.toISOString().split('T')[0];
    topic.reviewCount = (Number(topic.reviewCount) || 0) + 1;
    recordActivity(topic.weight, difficulty, topic.categories);
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

function recordActivity(minutes, difficulty, categories = []) {
    const today = getDateKey(0);
    const day = activityLog.find(entry => entry.date === today);
    const categoryCounts = buildCategoryReviewCountMap(categories);

    if (day) {
        day.minutes += Math.max(0, Number(minutes) || 0);
        day.completed += 1;
        if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
            day[difficulty] += 1;
        }
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

    let currentLoad = 0;
    let hasOverflow = false;
    agendaList.innerHTML = '';

    const dueTopics = topics.filter(t => t.nextReview <= today).sort((a, b) => a.weight - b.weight);

    dueTopics.forEach(topic => {
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
                </div>
                <div class="flex gap-2">
                    <button onclick="completeTopic(${topic.id}, 'hard')" class="px-3 py-2 text-xs font-bold rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Struggled</button>
                    <button onclick="completeTopic(${topic.id}, 'medium')" class="px-3 py-2 text-xs font-bold rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50">Okay</button>
                    <button onclick="completeTopic(${topic.id}, 'easy')" class="px-4 py-2 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700">Mastered</button>
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

initRouting();
render();
renderLibrary();
renderAnalytics();
updateClarityContext();
trackClarityEvent('app_loaded');
updateAuthControls();
initCloudSync();
