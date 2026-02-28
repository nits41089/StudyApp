const CLOUD_REQUEST_TIMEOUT_MS = 15000;
let loadRequestSequence = 0;

async function withCloudTimeout(promise, operation, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
    let timeoutId;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function initCloudSync() {
    const hint = document.getElementById('cloudConfigHint');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        hint.classList.remove('hidden');
        setSyncStatus('Local only (add Supabase config to enable cloud sync)', 'amber');
        updateAuthControls();
        updateClarityContext();
        trackClarityEvent('cloud_sync_not_configured');
        return;
    }

    try {
        setSyncStatus('Initializing cloud sync...', 'indigo');
        const module = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        supabase = module.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        const { data, error } = await withCloudTimeout(
            supabase.auth.getSession(),
            'Auth session restore'
        );
        if (error) throw error;

        currentUser = data.session?.user || null;
        cloudSupportsActivityLog = true;
        updateAuthControls();
        updateClarityContext();

        if (currentUser) {
            trackClarityEvent('auth_session_restored');
            await loadRemoteTopics();
        } else {
            setSyncStatus('Local only (not signed in)', 'slate');
        }

        supabase.auth.onAuthStateChange(async (_event, session) => {
            currentUser = session?.user || null;
            updateAuthControls();
            updateClarityContext();

            if (currentUser) {
                cloudSupportsActivityLog = true;
                await loadRemoteTopics();
            } else {
                setSyncStatus('Local only (not signed in)', 'slate');
            }
        });
    } catch (error) {
        console.error(error);
        setSyncStatus('Cloud sync init failed', 'red');
        updateAuthControls();
    }
}

async function loadRemoteTopics() {
    if (!supabase || !currentUser) return;
    const requestId = ++loadRequestSequence;

    try {
        setSyncStatus('Loading from cloud...', 'indigo');
        isHydratingRemote = true;
        let data = null;
        let error = null;

        if (cloudSupportsActivityLog) {
            const response = await withCloudTimeout(
                supabase
                    .from('user_study_data')
                    .select('topics, activity_log, updated_at')
                    .eq('user_id', currentUser.id)
                    .maybeSingle(),
                'Cloud load'
            );
            data = response.data;
            error = response.error;
        } else {
            const response = await withCloudTimeout(
                supabase
                    .from('user_study_data')
                    .select('topics, updated_at')
                    .eq('user_id', currentUser.id)
                    .maybeSingle(),
                'Cloud load'
            );
            data = response.data;
            error = response.error;
        }

        if (error && isMissingActivityColumnError(error)) {
            cloudSupportsActivityLog = false;
            updateClarityContext();
            setSyncStatus('Cloud table missing activity_log column. Run migration to sync stats.', 'amber');
            trackClarityEvent('cloud_activity_column_missing');

            const fallbackResponse = await withCloudTimeout(
                supabase
                    .from('user_study_data')
                    .select('topics, updated_at')
                    .eq('user_id', currentUser.id)
                    .maybeSingle(),
                'Cloud load fallback'
            );
            data = fallbackResponse.data;
            error = fallbackResponse.error;
        }

        if (requestId !== loadRequestSequence) return;
        if (error) throw error;

        if (data && Array.isArray(data.topics)) {
            const remoteUpdatedAt = data.updated_at || new Date().toISOString();
            const remoteTs = parseTimestamp(remoteUpdatedAt);
            const localTs = parseTimestamp(syncMeta.lastLocalChangeAt);

            if (localTs > remoteTs + 1000) {
                setSyncStatus('Cloud is behind. Kept local changes and queued upload.', 'amber');
                trackClarityEvent('cloud_conflict_local_wins');
                queueRemoteSave();
                return;
            }

            topics = normalizeTopics(data.topics);
            if (cloudSupportsActivityLog) {
                activityLog = normalizeActivityLog(data.activity_log || []);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
            localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(activityLog));
            markCloudSynced(remoteUpdatedAt);
            render();
            renderLibrary();
            renderAnalytics();
            updateClarityContext();
            setSyncStatus(
                cloudSupportsActivityLog
                    ? `Synced (${new Date(remoteUpdatedAt).toLocaleString()})`
                    : `Synced topics only (${new Date(remoteUpdatedAt).toLocaleString()})`,
                cloudSupportsActivityLog ? 'green' : 'amber'
            );
            trackClarityEvent('cloud_data_loaded');
        } else {
            setSyncStatus(
                cloudSupportsActivityLog ? 'Signed in (no cloud data yet)' : 'Signed in (topics-only cloud schema)',
                cloudSupportsActivityLog ? 'green' : 'amber'
            );
            trackClarityEvent('cloud_data_empty');
            queueRemoteSave();
        }
    } catch (error) {
        if (requestId !== loadRequestSequence) return;
        console.error(error);
        if (String(error?.message || '').toLowerCase().includes('timed out')) {
            setSyncStatus('Cloud load timed out. Local data kept; retry with Sync Now.', 'amber');
            trackClarityEvent('cloud_data_load_timeout');
        } else {
            setSyncStatus('Failed to load cloud data', 'red');
            trackClarityEvent('cloud_data_load_failed');
        }
    } finally {
        if (requestId === loadRequestSequence) {
            isHydratingRemote = false;
            updateAuthControls();
        }
    }
}

async function syncNow(source = 'manual') {
    if (!supabase || !currentUser) return;
    if (syncInFlight) {
        if (source === 'auto') pendingAutoSync = true;
        return;
    }

    try {
        syncInFlight = true;
        updateAuthControls();
        setSyncStatus('Syncing to cloud...', 'indigo');

        const payload = {
            user_id: currentUser.id,
            topics,
            updated_at: new Date().toISOString()
        };
        if (cloudSupportsActivityLog) {
            payload.activity_log = activityLog;
        }

        let { error } = await withCloudTimeout(
            supabase
                .from('user_study_data')
                .upsert(payload, { onConflict: 'user_id' }),
            'Cloud sync'
        );

        if (error && cloudSupportsActivityLog && isMissingActivityColumnError(error)) {
            cloudSupportsActivityLog = false;
            updateClarityContext();
            trackClarityEvent('cloud_activity_column_missing');

            const fallbackPayload = {
                user_id: currentUser.id,
                topics,
                updated_at: new Date().toISOString()
            };
            const fallback = await withCloudTimeout(
                supabase
                    .from('user_study_data')
                    .upsert(fallbackPayload, { onConflict: 'user_id' }),
                'Cloud sync fallback'
            );
            error = fallback.error;
        }

        if (error) throw error;
        markCloudSynced(payload.updated_at);
        setSyncStatus(
            cloudSupportsActivityLog
                ? `Synced (${new Date().toLocaleTimeString()})`
                : `Synced topics only (${new Date().toLocaleTimeString()})`,
            cloudSupportsActivityLog ? 'green' : 'amber'
        );
        trackClarityEvent(source === 'auto' ? 'cloud_sync_auto' : 'cloud_sync_manual');
    } catch (error) {
        console.error(error);
        if (String(error?.message || '').toLowerCase().includes('timed out')) {
            setSyncStatus('Cloud sync timed out. Local changes are safe and pending retry.', 'amber');
            trackClarityEvent(source === 'auto' ? 'cloud_sync_auto_timeout' : 'cloud_sync_manual_timeout');
        } else {
            setSyncStatus('Cloud sync failed', 'red');
            trackClarityEvent(source === 'auto' ? 'cloud_sync_auto_failed' : 'cloud_sync_manual_failed');
        }
    } finally {
        syncInFlight = false;
        updateAuthControls();
        if (pendingAutoSync) {
            pendingAutoSync = false;
            syncNow('auto');
        }
    }
}

function getAuthCredentials() {
    return {
        email: document.getElementById('authEmail').value.trim(),
        password: document.getElementById('authPassword').value
    };
}

async function signUp() {
    if (!supabase) return;
    const { email, password } = getAuthCredentials();
    if (!email || !password) {
        alert('Enter email and password first.');
        return;
    }

    try {
        setSyncStatus('Creating account...', 'indigo');
        trackClarityEvent('auth_signup_attempt');
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: window.location.href.split('#')[0]
            }
        });
        if (error) throw error;
        setSyncStatus('Account created. Sign in (or confirm email if required).', 'amber');
        trackClarityEvent('auth_signup_success');
    } catch (error) {
        console.error(error);
        setSyncStatus('Sign up failed', 'red');
        trackClarityEvent('auth_signup_failed');
        alert(error.message || 'Sign up failed.');
    }
}

async function signIn() {
    if (!supabase) return;
    const { email, password } = getAuthCredentials();
    if (!email || !password) {
        alert('Enter email and password first.');
        return;
    }

    try {
        setSyncStatus('Signing in...', 'indigo');
        trackClarityEvent('auth_signin_attempt');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setSyncStatus('Signed in', 'green');
        trackClarityEvent('auth_signin_success');
    } catch (error) {
        console.error(error);
        setSyncStatus('Sign in failed', 'red');
        trackClarityEvent('auth_signin_failed');
        alert(error.message || 'Sign in failed.');
    }
}

async function signOut() {
    if (!supabase) return;
    try {
        await supabase.auth.signOut();
        currentUser = null;
        updateAuthControls();
        updateClarityContext();
        setSyncStatus('Local only (not signed in)', 'slate');
        trackClarityEvent('auth_signout');
    } catch (error) {
        console.error(error);
        setSyncStatus('Sign out failed', 'red');
        trackClarityEvent('auth_signout_failed');
    }
}
