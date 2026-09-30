// File: src/pages/admin/admin-dashboard.js

let adminFundRequestsRealtimeStarted = false;

const getAdminFundRequestsCacheKey = () => {
    const uid = currentUser?.uid || getCachedSessionUserId() || 'admin';
    return `rw_admin_fund_requests_cache_${uid}`;
};

const saveAdminFundRequestsToCache = () => {
    try {
        const cacheKey = getAdminFundRequestsCacheKey();
        const serializable = (allFundRequestsCache || []).slice(0, 200).map(req => {
            const obj = { ...req };
            // Convert Firestore timestamps to millis for safe JSON serialization
            ['requestedAt', 'processedAt', 'createdAt', 'updatedAt', 'timestamp'].forEach(field => {
                if (obj[field]?.toMillis) obj[field] = obj[field].toMillis();
                else if (obj[field]?.seconds) obj[field] = obj[field].seconds * 1000;
            });
            return obj;
        });
        writeJsonCache(cacheKey, { items: serializable, savedAt: Date.now() });
    } catch (e) {
        console.warn('Save admin fund requests cache error:', e);
    }
};

const hydrateAdminFundRequestsFromCache = () => {
    try {
        const cacheKey = getAdminFundRequestsCacheKey();
        const cached = readJsonCache(cacheKey);
        if (!cached || !Array.isArray(cached.items) || cached.items.length === 0) return false;
        // Only use cache if less than 10 minutes old
        if (cached.savedAt && Date.now() - cached.savedAt > 10 * 60 * 1000) return false;
        allFundRequestsCache = cached.items.filter(req => (req.type || 'withdrawal') === 'withdrawal' && (!req.status || req.status === 'pending') && !isFundRequestLocallyProcessed(req));
        allRechargeRequestsCache = cached.items.filter(req => req.type === 'mobile_recharge' && (!req.status || req.status === 'pending') && !isFundRequestLocallyProcessed(req));
        updateAdminPendingRequestSummary();
        return true;
    } catch (e) {
        console.warn('Hydrate admin fund requests from cache error:', e);
        return false;
    }
};

const setupAdminRealtimeFundRequestsListener = () => {
    const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
    if (!isCurrentAdmin || adminFundRequestsRealtimeStarted) return;
    adminFundRequestsRealtimeStarted = true;

    try {
        const reqsRef = collection(db, `artifacts/${appId}/public/data/fund_requests`);
        const reqsQuery = query(reqsRef, where("status", "==", "pending"));

        onSnapshot(reqsQuery, (snapshot) => {
            const firebasePending = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            const merged = mergeFundRequestsById(allFundRequestsCache.concat(allRechargeRequestsCache), firebasePending);

            allFundRequestsCache = merged.filter(req => (req.type || 'withdrawal') === 'withdrawal' && (!req.status || req.status === 'pending') && !isFundRequestLocallyProcessed(req));
            allRechargeRequestsCache = merged.filter(req => req.type === 'mobile_recharge' && (!req.status || req.status === 'pending') && !isFundRequestLocallyProcessed(req));

            updateAdminPendingRequestSummary();
            saveAdminFundRequestsToCache();

            if (document.getElementById('admin-fund-requests-list-page')) {
                renderAdminFundRequests(allFundRequestsCache);
            }
            if (document.getElementById('admin-recharge-requests-list-page')) {
                renderAdminRechargeRequests(allRechargeRequestsCache);
            }
        }, (err) => {
            console.warn('Realtime admin fund requests snapshot skipped:', err);
        });
    } catch (e) {
        console.warn('Admin realtime fund requests listener init skipped:', e);
    }
};

const refreshAdminFundRequestsFromCloud = async () => {
            const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
            if (!isCurrentAdmin) return;
            setupAdminRealtimeFundRequestsListener();
            try {
                const cloudRequests = await loadCloudFundRequests({ status: 'pending' });
                let firebasePendingRequests = [];
                if (!fundRequestsImportedFromFirebase) {
                    firebasePendingRequests = await loadFirebasePendingFundRequests();
                    const cloudIds = new Set(cloudRequests.map(req => req.id || req.requestId || req.request_id));
                    const missingFirebaseRequests = firebasePendingRequests.filter(req => !cloudIds.has(req.id));
                    if (missingFirebaseRequests.length) {
                        await importCloudFundRequests(missingFirebaseRequests);
                    }
                    fundRequestsImportedFromFirebase = true;
                }
                const allRequests = mergeFundRequestsById(cloudRequests, firebasePendingRequests);
                allFundRequestsCache = allRequests.filter(req => (req.type || 'withdrawal') === 'withdrawal' && !isFundRequestLocallyProcessed(req));
                allRechargeRequestsCache = allRequests.filter(req => req.type === 'mobile_recharge' && !isFundRequestLocallyProcessed(req));
                updateAdminPendingRequestSummary();
                saveAdminFundRequestsToCache();
                if (document.getElementById('admin-fund-requests-list-page')) renderAdminFundRequests(allFundRequestsCache);
                if (document.getElementById('admin-recharge-requests-list-page')) renderAdminRechargeRequests(allRechargeRequestsCache);
            } catch (error) {
                if (typeof isExpectedBackgroundAbort === 'function' && isExpectedBackgroundAbort(error)) return;
                console.error('Cloudflare fund request load failed:', error);
                try {
                    await importFirebaseFundRequestsForAdmin();
                } catch (fallbackError) {
                    console.error('Firebase pending fund request fallback failed:', fallbackError);
                    if (document.getElementById('admin-fund-requests-list-page')) {
                        renderAdminFundRequests(allFundRequestsCache || []);
                    }
                }
            }
        };

const importFirebaseFundRequestsForAdmin = async () => {
            const allRequests = await loadFirebasePendingFundRequests();
            await importCloudFundRequests(allRequests);
            fundRequestsImportedFromFirebase = true;
            allFundRequestsCache = allRequests.filter(req => req.status === 'pending' && (req.type || 'withdrawal') === 'withdrawal');
            allRechargeRequestsCache = allRequests.filter(req => req.status === 'pending' && req.type === 'mobile_recharge');
            updateAdminPendingRequestSummary();
            saveAdminFundRequestsToCache();
            if (document.getElementById('admin-fund-requests-list-page')) renderAdminFundRequests(allFundRequestsCache);
            if (document.getElementById('admin-recharge-requests-list-page')) renderAdminRechargeRequests(allRechargeRequestsCache);
        };

const getAdminMetricsCacheKey = () => {
    const uid = currentUser?.uid || getCachedSessionUserId() || 'guest';
    return `rw_admin_dashboard_metrics_cache_${uid}`;
};

const readAdminDashboardMetricsCache = () => {
    const cached = readJsonCache(getAdminMetricsCacheKey());
    return cached && typeof cached === 'object' ? cached : {};
};

const rememberAdminDashboardMetrics = (partial = {}) => {
    const key = getAdminMetricsCacheKey();
    const next = { ...readAdminDashboardMetricsCache(), ...partial, cachedAt: Date.now() };
    writeJsonCache(key, next);
    return next;
};

const applyAdminDashboardMetrics = (metrics = {}) => {
            if (!metrics || typeof metrics !== 'object') return;
            const setText = (id, value) => {
                if (value === undefined || value === null) return;
                const el = document.getElementById(id);
                if (el) el.textContent = String(value);
            };
            setText('analytics-total-users', metrics.totalUsers);
            setText('analytics-total-funds', metrics.totalFunds);
            setText('analytics-new-members', metrics.newMembers);
            setText('analytics-minus-balance-users', metrics.minusBalanceUsers);
            setText('analytics-minus-balance-total', metrics.minusBalanceTotal);
            setText('analytics-pending-reqs', metrics.pendingWithdrawals);
            setText('analytics-pending-amount', metrics.pendingWithdrawalAmount);
            setText('analytics-gift-cards', metrics.giftCardsRedeemed);
            const adminPendingEl = document.getElementById('admin-pending-withdrawals');
            if (adminPendingEl && metrics.pendingWithdrawals !== undefined && metrics.pendingWithdrawalAmount !== undefined) {
                adminPendingEl.innerHTML = `${metrics.pendingWithdrawals}<br><span class="text-sm font-normal">${metrics.pendingWithdrawalAmount}</span>`;
            }
            const withdrawalBadge = document.getElementById('admin-withdrawal-request-badge');
            if (withdrawalBadge && metrics.pendingWithdrawals !== undefined) {
                const count = Number(metrics.pendingWithdrawals || 0);
                withdrawalBadge.textContent = count > 99 ? '99+' : String(count || '');
                withdrawalBadge.classList.toggle('hidden', count <= 0);
            }
            const loanBadge = document.getElementById('admin-loan-request-badge');
            if (loanBadge && metrics.pendingLoans !== undefined) {
                const count = Number(metrics.pendingLoans || 0);
                loanBadge.textContent = count > 99 ? '99+' : String(count || '');
                loanBadge.classList.toggle('hidden', count <= 0);
            }
        };

const hydrateAdminDashboardMetricsFromCache = () => {
            applyAdminDashboardMetrics(readAdminDashboardMetricsCache());
        };

const fetchAdminInvestmentsFromBackend = async () => {
            try {
                const token = await getBackendAuthToken();
                const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/partner-investments`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }, 10000);
                if (!response.ok) throw new Error('Failed to load partner investments');
                const data = await response.json();
                if (!data.ok) throw new Error(data.message || 'Failed to load partner investments');
                return data.investments;
            } catch (err) {
                console.warn('Backend admin investments fetch failed:', err);
                return [];
            }
        };

const hasCachedAdminSession = () => {
    return checkIsUserAdmin(currentUser, currentUserData);
};

const hasAdminSessionReadyOrCached = () => {
    return checkIsUserAdmin(currentUser, currentUserData);
};

const ensureAdminSessionReady = () => {
    const isCurrentAdmin = checkIsUserAdmin(currentUser, currentUserData);
    if (isCurrentAdmin) return true;
    showNotification(currentUser ? 'Admin access only.' : 'Please login first.', true);
    return false;
};

const updateOwnerAdminPanelButtons = () => {
    const isOwner = checkIsOwner(currentUser, currentUserData);
    document.getElementById('admin-manage-admins-btn')?.classList.toggle('hidden', !isOwner);
    document.getElementById('admin-loans-btn')?.classList.toggle('hidden', !isOwner);
    document.getElementById('admin-investments-btn')?.classList.toggle('hidden', !isOwner);
    document.getElementById('admin-train-ai-btn')?.classList.toggle('hidden', !isOwner);
    
    const labelEl = document.getElementById('admin-settlement-btn-label');
    if (labelEl) {
        labelEl.textContent = isOwner ? 'Settlements' : 'Settlement Panel';
    }
};

const applyAdminBottomChrome = (isAdminView) => {
            const isUserAdmin = checkIsUserAdmin(currentUser, currentUserData);
            updateOwnerAdminPanelButtons();
            document.getElementById('admin-tab-button')?.classList.toggle('hidden', !isUserAdmin);
            const bottomAdminButton = document.getElementById('bottom-admin-btn');
            if (bottomAdminButton) {
                bottomAdminButton.hidden = !isUserAdmin;
                bottomAdminButton.classList.toggle('hidden', !isUserAdmin);
            }
            const bottomHelpButton = document.getElementById('bottom-help-btn');
            if (bottomHelpButton) {
                bottomHelpButton.hidden = isUserAdmin;
                bottomHelpButton.classList.toggle('hidden', isUserAdmin);
            }
            document.getElementById('bottom-task-btn')?.classList.remove('hidden');
            const bottomHomeLabel = document.getElementById('bottom-home-label');
            if (bottomHomeLabel) bottomHomeLabel.textContent = 'Wallet';
            const bottomGrid = document.getElementById('bottom-nav-grid');
            if (bottomGrid) {
                bottomGrid.style.setProperty('--bottom-nav-count', '5');
                bottomGrid.className = `mx-auto grid w-full max-w-xl grid-cols-5 items-center px-2 pt-2 text-[10px] sm:text-xs font-semibold text-gray-500 dark:text-gray-400`;
            }
        };

const loadFirebaseLoanRequestsForAdmin = async () => {
            const loanRequestsQuery = query(collection(db, `artifacts/${appId}/public/data/loan_requests`), orderBy("requestedAt", "desc"));
            const snap = await getDocs(loanRequestsQuery);
            return snap.docs.map(doc => ({ id: doc.id, requestId: doc.id, ...doc.data() }));
        };

const loadCloudLoanRequestsForAdmin = () =>
            loadCloudLoanRequests({ status: 'all', limit: 800, timeoutMs: 9000 });

const loadAdminLoanRequestsMerged = async () => {
            const [cloudResult, firebaseResult] = await Promise.allSettled([
                loadCloudLoanRequestsForAdmin(),
                loadFirebaseLoanRequestsForAdmin()
            ]);
            const cloudRequests = cloudResult.status === 'fulfilled' ? cloudResult.value : [];
            const firebaseRequests = firebaseResult.status === 'fulfilled' ? firebaseResult.value : [];
            if (cloudResult.status === 'rejected') {
                console.warn('Cloudflare loan request load skipped:', cloudResult.reason);
            }
            if (firebaseResult.status === 'rejected') {
                console.warn('Firebase loan request fallback skipped:', firebaseResult.reason);
            }
            if (firebaseRequests.length) {
                importCloudLoanRequests(firebaseRequests).catch(error => console.warn('Cloud loan migration skipped:', error));
            }
            return mergeLoanRequestRecords(firebaseRequests, cloudRequests);
        };

const refreshAdminDashboardCaches = async () => {
            const usersQuery = query(collection(db, `artifacts/${appId}/public/data/users`));
            const codesQuery = query(collection(db, `artifacts/${appId}/public/data/gift_codes`));
            const loansQuery = query(collection(db, `artifacts/${appId}/public/data/loans`), orderBy("createdAt", "desc"));
            const investmentsQuery = query(collection(db, `artifacts/${appId}/public/data/partner_investments`), orderBy("createdAt", "desc"));
            const tasksQuery = query(collection(db, `artifacts/${appId}/public/data/tasks`), orderBy("createdAt", "desc"));
            const adsQuery = query(collection(db, `artifacts/${appId}/public/data/ads`), orderBy("createdAt", "desc"));

            const [
                usersResult,
                fundResult,
                codesResult,
                loanRequestsResult,
                loansResult,
                investmentsResult,
                tasksResult,
                adsResult
            ] = await Promise.allSettled([
                getDocs(usersQuery),
                refreshAdminFundRequestsFromCloud(),
                getDocs(codesQuery),
                loadAdminLoanRequestsMerged(),
                getDocs(loansQuery),
                fetchAdminInvestmentsFromBackend(),
                getDocs(tasksQuery),
                getDocs(adsQuery)
            ]);

            if (usersResult.status === 'fulfilled') {
                if (!adminUsersRealtimeStarted) {
                    applyAdminUsersCache(usersResult.value.docs.map(d => ({ id: d.id, ...d.data() })));
                } else {
                    console.log('Preserving active realtime admin user state; skipping getDocs database snapshot overwrite');
                }
            } else {
                console.warn('Admin users refresh skipped:', usersResult.reason);
            }
            if (fundResult.status === 'rejected') {
                console.warn('Admin fund request refresh skipped:', fundResult.reason);
            }
            if (codesResult.status === 'fulfilled') {
                applyAdminGiftCodesSnapshot(codesResult.value.docs);
            } else {
                console.warn('Admin gift code refresh skipped:', codesResult.reason);
            }
            if (loanRequestsResult.status === 'fulfilled') {
                applyAdminLoanRequestsList(loanRequestsResult.value, { replace: true });
            } else {
                console.warn('Admin loan request refresh skipped:', loanRequestsResult.reason);
            }
            if (loansResult.status === 'fulfilled') {
                applyAdminLoansSnapshot(loansResult.value.docs);
            } else {
                console.warn('Admin loans refresh skipped:', loansResult.reason);
            }
            if (investmentsResult.status === 'fulfilled') {
                applyAdminInvestmentsSnapshot(investmentsResult.value);
            } else {
                console.warn('Admin investments refresh skipped:', investmentsResult.reason);
            }
            if (tasksResult.status === 'fulfilled') {
                applyAdminTasksSnapshot(tasksResult.value.docs);
            } else {
                console.warn('Admin tasks refresh skipped:', tasksResult.reason);
            }
            if (adsResult.status === 'fulfilled') {
                applyAdsSnapshot(adsResult.value.docs);
            } else {
                console.warn('Admin ads refresh skipped:', adsResult.reason);
            }
        };

const initializeAdminFundRequestsRealtime = () => {
            const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
            if (!isCurrentAdmin || adminFundRequestsRealtimeStarted) return;
            adminFundRequestsRealtimeStarted = true;
            refreshAdminFundRequestsFromCloud().catch(error => {
                console.warn('Admin fund request refresh skipped:', error);
            });
        };

const applyAdminGiftCodesSnapshot = (docs = []) => {
            allGiftCodesCache = docs;
            const totalRedeemed = docs.reduce((acc, doc) => acc + (doc.data().timesUsed || 0), 0);
            const giftCardsEl = document.getElementById('analytics-gift-cards');
            if (giftCardsEl) giftCardsEl.textContent = totalRedeemed;
            rememberAdminDashboardMetrics({ giftCardsRedeemed: totalRedeemed });
            if (document.getElementById('gift-codes-list-page')) {
                renderAdminGiftCodesList(docs);
            }
        };

const updateAdminLoanRequestBadge = () => {
            if (!adminLoanRequestsLoaded && !allLoanRequestsCache.length) {
                applyAdminDashboardMetrics(readAdminDashboardMetricsCache());
                return;
            }
            const pendingCount = getLatestLoanRequestsByApplicant(allLoanRequestsCache, allUsersCache)
                .filter(request => getRawLoanRequestStatus(request) === 'pending')
                .length;
            if (adminLoanRequestsLoaded) {
                rememberAdminDashboardMetrics({ pendingLoans: pendingCount });
            }
            const badge = document.getElementById('admin-loan-request-badge');
            if (!badge) return;
            badge.textContent = pendingCount > 99 ? '99+' : String(pendingCount || '');
            badge.classList.toggle('hidden', pendingCount <= 0);
        };

const applyAdminLoanRequestsList = (requests = [], { replace = false } = {}) => {
            allLoanRequestsCache = mergeLoanRequestRecords(replace ? [] : allLoanRequestsCache, requests);
            adminLoanRequestsLoaded = true;
            updateAdminLoanRequestBadge();
            if (document.getElementById('admin-loan-page')) {
                renderAdminLoanPage();
            }
        };

const applyAdminLoanRequestsSnapshot = (docs = []) => {
            applyAdminLoanRequestsList(docs.map(doc => ({ id: doc.id, requestId: doc.id, ...doc.data() })));
        };

const applyAdminLoansSnapshot = (docs = []) => {
            allLoansCache = docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(isModernLoanRecord);
            if (document.getElementById('admin-loan-page')) {
                renderAdminLoanPage();
            }
        };

const applyAdminInvestmentsSnapshot = (docs = []) => {
            allInvestmentsCache = docs.map(doc => {
                if (doc && typeof doc.data === 'function') {
                    return { id: doc.id, ...doc.data() };
                }
                return doc;
            });
            processDuePartnerInvestmentsForAdmin();
            if (document.getElementById('admin-investments-page')) {
                renderAdminInvestmentsPage();
            }
        };

const initializeAdminSecondaryRealtime = () => {
            const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
            if (!isCurrentAdmin || adminSecondaryRealtimeStarted) return;
            adminSecondaryRealtimeStarted = true;
            refreshAdminSecondaryCaches().catch(error => console.warn('Admin secondary data refresh skipped:', error));
        };

const refreshAdminSecondaryCaches = async () => {
            const codesQuery = query(collection(db, `artifacts/${appId}/public/data/gift_codes`));
            const codesSnap = await getDocs(codesQuery);
            applyAdminGiftCodesSnapshot(codesSnap.docs);

            await refreshAdminFundRequestsFromCloud();

            applyAdminLoanRequestsList(await loadAdminLoanRequestsMerged(), { replace: true });

            const loansQuery = query(collection(db, `artifacts/${appId}/public/data/loans`), orderBy("createdAt", "desc"));
            const loansSnap = await getDocs(loansQuery);
            applyAdminLoansSnapshot(loansSnap.docs);

            const backendInvestments = await fetchAdminInvestmentsFromBackend();
            applyAdminInvestmentsSnapshot(backendInvestments);

            const tasksQuery = query(collection(db, `artifacts/${appId}/public/data/tasks`), orderBy("createdAt", "desc"));
            const tasksSnap = await getDocs(tasksQuery);
            applyAdminTasksSnapshot(tasksSnap.docs);

            const adsQuery = query(collection(db, `artifacts/${appId}/public/data/ads`), orderBy("createdAt", "desc"));
            const adsSnap = await getDocs(adsQuery);
            applyAdsSnapshot(adsSnap.docs);
        };

const refreshAdminLoanCaches = async () => {
            const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
            if (!isCurrentAdmin) return;
            const loansQuery = query(collection(db, `artifacts/${appId}/public/data/loans`), orderBy("createdAt", "desc"));
            const [loanRequestsResult, loansResult] = await Promise.allSettled([
                loadAdminLoanRequestsMerged(),
                getDocs(loansQuery)
            ]);
            if (loanRequestsResult.status === 'fulfilled') {
                applyAdminLoanRequestsList(loanRequestsResult.value, { replace: true });
            } else {
                console.warn('Admin loan requests quick refresh skipped:', loanRequestsResult.reason);
            }
            if (loansResult.status === 'fulfilled') {
                applyAdminLoansSnapshot(loansResult.value.docs);
            } else {
                console.warn('Admin loans quick refresh skipped:', loansResult.reason);
            }
        };

const showAdminLiveListsPage = () => {
            const todayStr = new Date().toISOString().split('T')[0];
            const content = `
                ${getPageHeader('Live List Finder')}
                <div class="max-w-2xl mx-auto space-y-6 pb-24 px-4">
                    <!-- Add Live List Form -->
                    <section class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
                        <h3 class="text-base font-extrabold text-gray-900 dark:text-white">Add Reviewers List</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-400 uppercase mb-1">App Name</label>
                                <input type="text" id="admin-list-app-name" placeholder="e.g. RW Wallet" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm border border-gray-100 dark:border-gray-600">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Target Date</label>
                                <input type="date" id="admin-list-date" value="${todayStr}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm border border-gray-100 dark:border-gray-600">
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-400 uppercase mb-1">Reviewer Names (One per line)</label>
                            <textarea id="admin-list-content" rows="6" placeholder="Paste live review list names here..." class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm border border-gray-100 dark:border-gray-600 font-mono"></textarea>
                        </div>
                        <button id="admin-list-submit-btn" class="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition">Save Reviewer List</button>
                    </section>

                    <!-- Existing Live Lists -->
                    <section class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
                        <h3 class="text-base font-extrabold text-gray-900 dark:text-white">Active Reviewer Lists</h3>
                        <div id="admin-live-lists-container" class="space-y-3">
                            <div class="py-6 text-center text-sm text-gray-400">Loading live lists...</div>
                        </div>
                    </section>
                </div>
                ${getPageFooter()}`;

            showPage(content, { returnTo: 'settings', keepBottomNav: false });
            loadAdminLiveLists();

            document.getElementById('admin-list-submit-btn').onclick = handleSaveLiveList;
        };

const loadAdminLiveLists = async () => {
            const container = document.getElementById('admin-live-lists-container');
            if (!container) return;
            try {
                const token = await getBackendAuthToken();
                const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/lists`, {
                    headers: { Authorization: `Bearer ${token}` }
                }, 8000);
                const data = await response.json().catch(() => ({}));
                if (data.ok && Array.isArray(data.lists)) {
                    if (data.lists.length === 0) {
                        container.innerHTML = `<p class="py-6 text-center text-sm text-gray-400 italic">No live lists uploaded yet.</p>`;
                        return;
                    }
                    container.innerHTML = data.lists.map(list => `
                        <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 flex justify-between items-start gap-4">
                            <div class="min-w-0 flex-1 space-y-1">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(list.appName)}</span>
                                    <span class="rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-black text-blue-700 dark:text-blue-300">${escapeHtml(list.date)}</span>
                                    <span class="rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-black text-purple-700 dark:text-purple-300">${list.lineCount} reviewers</span>
                                </div>
                                <p class="text-[11px] font-mono text-gray-400 bg-white dark:bg-gray-800 p-2 rounded border border-gray-100 dark:border-gray-700 truncate">${escapeHtml(list.preview || 'Empty')}</p>
                            </div>
                            <button data-action="delete-live-list" data-listid="${list.id}" class="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition">
                                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    `).join('');

                    container.querySelectorAll('[data-action="delete-live-list"]').forEach(btn => {
                        btn.onclick = async (e) => {
                            const listId = e.currentTarget.dataset.listid;
                            if (!confirm('Are you sure you want to delete this list?')) return;
                            try {
                                showLoading();
                                const token = await getBackendAuthToken();
                                const resp = await fetch(`${BACKEND_BASE_URL}/api/lists/${encodeURIComponent(listId)}`, {
                                    method: 'DELETE',
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                hideLoading();
                                if (resp.ok) {
                                    showNotification('List deleted.');
                                    loadAdminLiveLists();
                                } else {
                                    showNotification('Failed to delete list.', true);
                                }
                            } catch (err) {
                                hideLoading();
                                console.error('Delete list error:', err);
                                showNotification('Failed to delete list.', true);
                            }
                        };
                    });
                } else {
                    container.innerHTML = `<p class="py-6 text-center text-sm text-red-400">Failed to load lists.</p>`;
                }
            } catch (err) {
                console.error('Load lists error:', err);
                container.innerHTML = `<p class="py-6 text-center text-sm text-red-400">Error loading live lists.</p>`;
            }
        };

const showAdminMainPage = () => {
            if (!hasAdminSessionReadyOrCached()) return showNotification(currentUser ? 'Admin access only.' : 'Please login first.', true);
            if (activeChatUnsubscribe) {
                activeChatUnsubscribe();
                activeChatUnsubscribe = null;
            }
            if (activeTaskReservationTimer) {
                clearInterval(activeTaskReservationTimer);
                activeTaskReservationTimer = null;
            }
            activeTaskReservation = null;
            switchTab('admin-panel');
            document.getElementById('dashboard-content').classList.remove('hidden');
            document.getElementById('page-container').classList.add('hidden');
            document.getElementById('page-container').innerHTML = '';
            setMainChrome(true);
            document.getElementById('app-footer')?.classList.add('app-footer-hidden');
            currentMainSection = 'admin';
            setBottomNavActive('bottom-admin-btn');
            updateAdminLoanRequestBadge();

            updateOwnerAdminPanelButtons();
        };

const isAdminReviewTask = (task = {}) => getAdminTaskFamily(task) === 'review';

const showAdminAdsPage = () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            currentMainSection = 'admin';
            const content = `
                ${getPageHeader('Manage Ads')}
                <div class="max-w-5xl mx-auto space-y-4 pb-24">
                    <section class="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-5 shadow-sm">
                        <div class="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h3 class="text-lg font-black">Add Advertisement</h3>
                                <p class="text-xs text-gray-500 dark:text-gray-400">Paste image link or YouTube link. Users see it instantly in the home carousel.</p>
                            </div>
                            <span class="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-50 text-2xl font-black text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-200">+</span>
                        </div>
                        <form id="admin-ad-form" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="hidden" id="admin-ad-edit-id" value="">
                            <div>
                                <label class="text-xs font-black uppercase text-gray-400">Ad Title</label>
                                <input id="admin-ad-title" placeholder="Ad title" class="mt-1 w-full rounded-xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
                            </div>
                            <div>
                                <label class="text-xs font-black uppercase text-gray-400">Type</label>
                                <select id="admin-ad-type" class="mt-1 w-full rounded-xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
                                    <option value="auto">Auto detect</option>
                                    <option value="image">Image / Banner</option>
                                    <option value="youtube">YouTube Video</option>
                                </select>
                            </div>
                            <div class="sm:col-span-2">
                                <label class="text-xs font-black uppercase text-gray-400">Image / YouTube Link</label>
                                <input id="admin-ad-media-url" placeholder="https://..." class="mt-1 w-full rounded-xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
                            </div>
                            <div class="sm:col-span-2">
                                <label class="text-xs font-black uppercase text-gray-400">Subtitle</label>
                                <input id="admin-ad-subtitle" placeholder="Small text shown on ad" class="mt-1 w-full rounded-xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
                            </div>
                            <div>
                                <label class="text-xs font-black uppercase text-gray-400">Status</label>
                                <select id="admin-ad-status" class="mt-1 w-full rounded-xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-fuchsia-500">
                                    <option value="active">Active</option>
                                    <option value="paused">Paused</option>
                                </select>
                            </div>
                            <div class="sm:col-span-2 flex flex-col sm:flex-row gap-2">
                                <button id="admin-ad-save-btn" type="submit" class="flex-1 rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-black text-white hover:bg-fuchsia-700 transition">Add Ad</button>
                            </div>
                        </form>
                    </section>
                    <section class="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-5 shadow-sm">
                        <div class="mb-4 flex items-center justify-between">
                            <h3 class="text-lg font-black">Active Ads</h3>
                            <span id="admin-ads-count" class="text-xs font-bold text-gray-400">0 ads</span>
                        </div>
                        <div id="admin-ads-list" class="space-y-3"></div>
                    </section>
                </div>
                ${getPageFooter()}`;
            showPage(content, { returnTo: 'admin', keepBottomNav: true });
            setBottomNavActive('bottom-admin-btn');
            document.getElementById('admin-ad-form')?.addEventListener('submit', handleSaveAdminAd);
            renderAdminAdsList();
            getDocs(query(collection(db, `artifacts/${appId}/public/data/ads`), orderBy("createdAt", "desc")))
                .then(snapshot => applyAdsSnapshot(snapshot.docs))
                .catch(error => console.warn('Ads refresh skipped:', error));
        };

const resetAdminAdForm = () => {
            document.getElementById('admin-ad-form')?.reset();
            const editId = document.getElementById('admin-ad-edit-id');
            if (editId) editId.value = '';
            const saveBtn = document.getElementById('admin-ad-save-btn');
            if (saveBtn) saveBtn.textContent = 'Add Ad';
            if (typeof window.showAdminAdForm === 'function') {
                window.showAdminAdForm(false);
            }
        };

const getAdminAdPayload = () => {
            const title = document.getElementById('admin-ad-title')?.value.trim() || '';
            const mediaUrl = document.getElementById('admin-ad-media-url')?.value.trim() || '';
            const typeValue = document.getElementById('admin-ad-type')?.value || 'auto';
            return {
                title,
                subtitle: document.getElementById('admin-ad-subtitle')?.value.trim() || '',
                mediaUrl,
                type: typeValue === 'auto' ? (getYoutubeEmbedUrl(mediaUrl) ? 'youtube' : 'image') : typeValue,
                order: 0,
                status: document.getElementById('admin-ad-status')?.value || 'active'
            };
        };

const handleSaveAdminAd = async (event) => {
            event.preventDefault();
            if (currentUser?.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const editId = document.getElementById('admin-ad-edit-id')?.value || '';
            const payload = getAdminAdPayload();
            if (!payload.title) return showNotification('Please enter ad title.', true);
            if (!/^https?:\/\//i.test(payload.mediaUrl)) return showNotification('Please paste a valid image or YouTube link.', true);
            const saveBtn = document.getElementById('admin-ad-save-btn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = editId ? 'Updating...' : 'Adding...';
            }
            try {
                if (editId) {
                    await updateDoc(doc(db, `artifacts/${appId}/public/data/ads`, editId), {
                        ...payload,
                        updatedAt: serverTimestamp(),
                        updatedBy: currentUser.uid
                    });
                    allAdsCache = allAdsCache.map(ad => ad.id === editId ? { ...ad, ...payload } : ad);
                    showNotification('Ad updated.');
                } else {
                    const adRef = doc(collection(db, `artifacts/${appId}/public/data/ads`));
                    allAdsCache = [{ id: adRef.id, ...payload, createdAt: Date.now(), createdBy: currentUser.uid }, ...allAdsCache];
                    renderAdminAdsList();
                    renderHomeAdsCarousel();
                    await setDoc(adRef, {
                        ...payload,
                        createdAt: serverTimestamp(),
                        createdBy: currentUser.uid
                    });
                    showNotification('Ad added.');
                }
                resetAdminAdForm();
                renderAdminAdsList();
                renderHomeAdsCarousel();
            } catch (error) {
                console.error('Ad save failed:', error);
                showNotification(`Could not save ad: ${error.message}`, true);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = document.getElementById('admin-ad-edit-id')?.value ? 'Update Ad' : 'Add Ad';
                }
            }
        };

const editAdminAd = (adId) => {
            const ad = allAdsCache.find(item => item.id === adId);
            if (!ad) return;
            document.getElementById('admin-ad-edit-id').value = ad.id;
            document.getElementById('admin-ad-title').value = ad.title || '';
            document.getElementById('admin-ad-type').value = ad.type || 'auto';
            document.getElementById('admin-ad-media-url').value = getAdMediaUrl(ad);
            document.getElementById('admin-ad-subtitle').value = ad.subtitle || '';
            const orderInput = document.getElementById('admin-ad-order');
            if (orderInput) orderInput.value = ad.order || 0;
            document.getElementById('admin-ad-status').value = ad.status || 'active';
            document.getElementById('admin-ad-save-btn').textContent = 'Update Ad';
            if (typeof window.showAdminAdForm === 'function') {
                window.showAdminAdForm(true);
            }
            document.getElementById('admin-ad-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

const handleDeleteAdminAd = async (adId) => {
            const ad = allAdsCache.find(item => item.id === adId);
            if (!ad) return;
            renderModal('Delete Ad',
                `<p class="text-sm text-gray-600 dark:text-gray-300">Delete <strong>${escapeHtml(ad.title || 'this ad')}</strong>?</p>`,
                `<button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
                 <button id="confirm-delete-admin-ad-btn" class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg">Delete</button>`);
            document.getElementById('confirm-delete-admin-ad-btn').onclick = async () => {
                try {
                    allAdsCache = allAdsCache.filter(item => item.id !== adId);
                    renderAdminAdsList();
                    renderHomeAdsCarousel();
                    window.closeModal();
                    await deleteDoc(doc(db, `artifacts/${appId}/public/data/ads`, adId));
                    showNotification('Ad deleted.');
                } catch (error) {
                    console.error('Ad delete failed:', error);
                    showNotification(`Could not delete ad: ${error.message}`, true);
                }
            };
        };

const renderAdminAdsList = () => {
            const listEl = document.getElementById('admin-ads-list');
            if (!listEl) return;
            const countEl = document.getElementById('admin-ads-count');
            if (countEl) countEl.textContent = `${allAdsCache.length} ad${allAdsCache.length === 1 ? '' : 's'}`;
            listEl.innerHTML = allAdsCache.length ? allAdsCache.map(ad => {
                const mediaUrl = getAdMediaUrl(ad);
                const isYoutube = getAdType(ad) === 'youtube';
                return `
                    <div class="rounded-2xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                        <div class="flex gap-3">
                            <div class="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-white dark:border-gray-700 bg-gray-950">
                                ${isYoutube ? `<div class="flex h-full w-full items-center justify-center bg-red-600 text-xs font-black text-white">YouTube</div>` : `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(ad.title || 'Ad')}" class="h-full w-full object-cover">`}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-black text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-200">${escapeHtml(ad.type || 'image')}</span>
                                    <span class="rounded-full ${ad.status === 'paused' ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'} px-2 py-0.5 text-[10px] font-black">${escapeHtml(ad.status || 'active')}</span>
                                </div>
                                <h4 class="mt-1 truncate text-sm font-black">${escapeHtml(ad.title || 'Advertisement')}</h4>
                                <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">${escapeHtml(mediaUrl)}</p>
                                <div class="mt-2 flex flex-wrap gap-2">
                                    <button data-action="edit-admin-ad" data-adid="${ad.id}" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white dark:bg-white dark:text-slate-900">Edit</button>
                                    <button data-action="delete-admin-ad" data-adid="${ad.id}" class="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-black text-red-600 dark:bg-red-900/30 dark:text-red-200">Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
            }).join('') : '<p class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No ads added yet.</p>';
        };

const getSupportAdminEmail = () => {
            const adminProfile = allUsersCache.find(u => u.id === ADMIN_UID) || {};
            return adminProfile.email || 'reviewsworld01@gmail.com';
        };

const getAdminSupportChatSeenKey = (roomId) => `rw_admin_support_seen_${roomId}`;

const getLatestAdminMessageTime = (messages = []) => Math.max(0, ...messages
            .map(normalizeBackendMessage)
            .filter(message => message.senderRole === 'admin')
            .map(message => timestampToMillis(message.createdAt)));

const markAdminSupportChatSeen = (roomId, messages = readSupportChatCache(roomId)) => {
            const latestUserTime = Math.max(0, ...messages
                .map(normalizeBackendMessage)
                .filter(message => message.senderRole !== 'admin')
                .map(message => timestampToMillis(message.createdAt)));
            const room = allSupportChatsCache.find(chat => (chat.roomId || getSupportRoomId(chat.userId || chat.id)) === roomId);
            const fallbackTime = room && (room.lastSenderId || room.last_sender_id) !== ADMIN_UID ? timestampToMillis(room.updatedAt || room.updated_at) : 0;
            const seenAt = Math.max(latestUserTime, fallbackTime);
            if (seenAt) localStorage.setItem(getAdminSupportChatSeenKey(roomId), String(seenAt));
            refreshAdminChatUnreadCount();
        };

const showAdminSignupApprovalsPage = () => {
    showAdminUsersPage();
    switchUsersTab('approvals');
};

const showAdminGiftCodesPage = () => {
            const content = `
                ${getPageHeader('Gift Codes')}
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <button id="create-gift-code-btn-page" class="px-4 py-2 text-sm bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition">Create New</button>
                        <button id="copy-active-gift-codes-btn" class="px-4 py-2 text-sm bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition">Copy Active Codes</button>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-700">
                        <input type="number" id="bulk-gift-code-count" min="1" max="200" placeholder="How many codes?" class="w-full px-4 py-3 bg-white dark:bg-gray-800 rounded-lg">
                        <input type="number" id="bulk-gift-code-amount" min="1" placeholder="Amount (₹)" class="w-full px-4 py-3 bg-white dark:bg-gray-800 rounded-lg">
                        <button id="bulk-gift-code-generate-btn" class="px-4 py-3 text-sm bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition">Generate</button>
                    </div>
                    <div id="gift-codes-list-page" class="space-y-2 max-h-[70vh] overflow-y-auto"></div>
                </div>
                ${getPageFooter()}`;
            showPage(content);
            renderAdminGiftCodesList(allGiftCodesCache);
            getDocs(collection(db, `artifacts/${appId}/public/data/gift_codes`))
                .then(snap => applyAdminGiftCodesSnapshot(snap.docs))
                .catch(error => console.warn('Gift code refresh skipped:', error));
            document.getElementById('create-gift-code-btn-page').onclick = showCreateGiftCodeModal;
            document.getElementById('bulk-gift-code-generate-btn').onclick = handleGenerateGiftCodes;
            document.getElementById('copy-active-gift-codes-btn').onclick = (e) => handleCopyActiveGiftCodes(e.currentTarget);
        };

const loadLegacyWithdrawalTransactionsForAdmin = async () => {
            if (currentUser?.uid !== ADMIN_UID) return [];
            const records = [];
            try {
                const snap = await getDocs(query(collectionGroup(db, 'transactions'), where('type', '==', 'withdrawal')));
                snap.docs.forEach(docSnap => records.push({ id: docSnap.id, sourcePath: docSnap.ref.path, ...docSnap.data() }));
            } catch (error) {
                console.warn('Legacy withdrawal collection group load skipped:', error);
            }

            for (const rootPath of ['transactions', 'transaction_history', 'wallet_transactions']) {
                try {
                    const snap = await getDocs(query(collection(db, rootPath), where('type', '==', 'withdrawal')));
                    snap.docs.forEach(docSnap => records.push({ id: docSnap.id, sourcePath: docSnap.ref.path, ...docSnap.data() }));
                } catch (error) {
                    console.warn('Legacy root withdrawal load skipped:', rootPath, error);
                }
            }
            return records;
        };

const renderAdminFundRequests = (requests) => {
            const listEl = document.getElementById('admin-fund-requests-list-page');
            if (!listEl) return;

            const search = adminPendingWithdrawalSearch || '';
            let pendingRequests = [...requests];
            const isOwner = currentUser?.uid === ADMIN_UID || currentUser?.email === 'reviewsworld51@gmail.com' || currentUser?.email === 'reviewsworld01@gmail.com' || currentUserData?.role === 'owner';
            if (isOwner) {
                pendingRequests = pendingRequests.filter(r => {
                    const u = allUsersCache.find(user => (user.id || user.uid) === r.userId);
                    return !u || !u.parentAdmin || u.parentAdmin === ADMIN_UID || u.parent_admin === ADMIN_UID;
                });
            } else {
                pendingRequests = pendingRequests.filter(r => {
                    const u = allUsersCache.find(user => (user.id || user.uid) === r.userId);
                    return u && (u.parentAdmin === currentUser.uid || u.parent_admin === currentUser.uid);
                });
            }
            pendingRequests = pendingRequests.filter(r => {
                if (!search) return true;
                return [
                    r.userName,
                    r.userEmail,
                    r.userMobile,
                    r.mobile,
                    r.amount,
                    r.method,
                    getWithdrawalMethodName(r.methodId, ''),
                    getWithdrawalMethodName(normalizeWithdrawalMethodId(r), ''),
                    getWithdrawalDetailText(r),
                    r.paymentDetails,
                    r.paymentEmail,
                    r.upiId,
                    r.email,
                    r.accountNumber,
                    r.ifsc,
                    r.accountName,
                    r.bankName
                ].some(value => String(value || '').toLowerCase().includes(search));
            });
            pendingRequests.sort((a, b) => timestampToMillis(a.requestedAt || a.requested_at) - timestampToMillis(b.requestedAt || b.requested_at));

            const formatWithdrawalDateOnly = (value) => {
                const date = getSafeDate(value) || new Date();
                const dd = String(date.getDate()).padStart(2, '0');
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const yyyy = date.getFullYear();
                return `${dd}/${mm}/${yyyy}`;
            };
            const groupedByDate = pendingRequests.reduce((groups, request) => {
                const dateKey = formatWithdrawalDateOnly(request.requestedAt || request.requested_at);
                if (!groups.has(dateKey)) groups.set(dateKey, []);
                groups.get(dateKey).push(request);
                return groups;
            }, new Map());
            const renderRequestCard = (r) => {
                const methodId = normalizeWithdrawalMethodId(r);
                const methodName = getWithdrawalDisplayMethodName(r, 'N/A');
                const detailText = getWithdrawalDetailText({ ...r, methodId });
                const needsBalanceCut = shouldDeductLegacyWithdrawal(r);
                const isGiftOrEmailMethod = ['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(methodId);
                const isGenericGiftCard = String(r.method || r.paymentMethod || '').toLowerCase().replace(/[\s-]+/g, '_') === 'gift_card';
                const escapedDetail = escapeHtml(detailText);
                const cardId = `wd-card-${r.id}`;
                const giftTypeControl = isGenericGiftCard ? `
                    <select data-action="set-gift-card-type" data-userid="${r.userId}" data-requestid="${r.id}" class="text-[10px] font-bold bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-100 border border-yellow-200 dark:border-yellow-700 px-1.5 py-0.5 rounded outline-none">
                        <option value="">Gift type</option>
                        <option value="amazon_gift">Amazon</option>
                        <option value="play_store">Google Play</option>
                        <option value="flipkart_gift">Flipkart</option>
                    </select>
                ` : '';

                return `
                <div class="relative mb-2 rounded-xl border ${needsBalanceCut ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50/10 dark:bg-rose-950/5' : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-gray-800'} overflow-hidden shadow-sm hover:shadow transition-all duration-200">
                    ${needsBalanceCut ? '<span class="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-xl"></span>' : ''}
                    <div class="px-3.5 pt-2.5 pb-2 ${needsBalanceCut ? 'pl-4' : ''}">
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0 flex-1 space-y-0.5">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <p class="text-sm font-bold text-gray-800 dark:text-gray-100 truncate capitalize leading-tight">${r.userName || 'No Name'}</p>
                                    ${needsBalanceCut ? '<span class="rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-200 px-1 py-0.2 text-[8px] font-black uppercase tracking-wider">Uncut</span>' : ''}
                                </div>
                                <div class="mt-0.5">
                                    <span class="inline-block rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider">${escapeHtml(methodName)}</span>
                                </div>
                                <div class="flex flex-wrap items-center gap-1.5 pt-1">
                                    ${typeof renderPayoutDetailPills === 'function' ? renderPayoutDetailPills(r) : `
                                        <div class="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-md text-xs font-bold text-indigo-700 dark:text-indigo-300">
                                            <span>${escapedDetail}</span>
                                            ${detailText && detailText !== 'N/A' ? `
                                                <button data-action="copy-text" data-text="${escapedDetail}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition text-indigo-600 dark:text-indigo-300" title="Copy">
                                                    <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                </button>
                                            ` : ''}
                                        </div>
                                    `}
                                    ${giftTypeControl}
                                </div>
                            </div>
                            <div class="shrink-0 flex flex-col items-end gap-1">
                                <span class="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-200 leading-none">${formatCurrency(r.amount)}</span>
                                <div class="flex items-center gap-1">
                                    <button data-action="mark-as-paid" data-userid="${r.userId}" data-requestid="${r.id}" class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/60 transition shadow-sm" title="Approve Payment">
                                        <svg class="h-3.5 w-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    </button>
                                    <button data-action="reject-request" data-userid="${r.userId}" data-requestid="${r.id}" class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/60 transition shadow-sm" title="Reject">
                                        <svg class="h-3.5 w-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div id="${cardId}-details" class="hidden mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-1">
                            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                <span class="font-semibold">${r.userMobile || r.mobile || 'No Mobile'}</span>
                            </div>
                            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                <span class="font-semibold">${r.userEmail || r.email || 'No Email'}</span>
                            </div>
                        </div>
                    </div>
                    <button onclick="(function(b){var d=document.getElementById('${cardId}-details');if(d){d.classList.toggle('hidden');b.querySelector('svg').style.transform=d.classList.contains('hidden')?'':'rotate(180deg)'};})(this)" class="w-full py-1.5 flex items-center justify-center bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-700/60 border-t border-slate-200/60 dark:border-slate-700/60 transition text-gray-500 dark:text-gray-400" title="Contact Info">
                        <span class="text-[10px] font-bold uppercase tracking-wider mr-1">Contact Info</span>
                        <svg class="h-3.5 w-3.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                </div>`;
            };

            listEl.innerHTML = pendingRequests.length === 0
                ? `<p class="text-gray-500 dark:text-gray-400 text-sm p-4 text-center">${search ? 'No pending requests match your search.' : 'No pending requests.'}</p>`
                : Array.from(groupedByDate.entries()).map(([date, dateRequests]) => `
                    <section class="mb-5">
                        <div class="mb-2 flex items-center gap-3">
                            <span class="shrink-0 rounded-full bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-200 dark:border-yellow-800 px-3 py-1 text-xs font-black text-yellow-700 dark:text-yellow-200">Withdrawal Date: ${date}</span>
                            <span class="h-px flex-1 bg-yellow-100 dark:bg-yellow-900/50"></span>
                            <span class="shrink-0 text-[10px] font-bold uppercase text-gray-400">${dateRequests.length} pending</span>
                        </div>
                        ${dateRequests.map(renderRequestCard).join('')}
                    </section>
                `).join('');
            updateLegacyWithdrawalFixSummary();
        };

const showAdminLoanPage = () => {
            const content = `
                ${getPageHeader('Manage Loan')}
                <div id="admin-loan-page" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-4">
                    <div class="flex flex-wrap gap-2">
                        <button data-loan-filter="pending" class="loan-filter-btn px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Pending</button>
                        <button data-loan-filter="approved" class="loan-filter-btn px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-semibold">Approved</button>
                        <button data-loan-filter="rejected" class="loan-filter-btn px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-semibold">Rejected</button>
                        <button data-loan-filter="loans" class="loan-filter-btn px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-semibold">Active/Paid Loans</button>
                    </div>
                    <input id="loan-admin-search" placeholder="Search name, mobile, Aadhaar..." class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <div id="admin-loan-list" class="max-h-[70vh] overflow-y-auto"></div>
                </div>
                ${getPageFooter()}`;
            showPage(content);
            window.currentLoanFilter = window.currentLoanFilter || 'pending';
            document.getElementById('admin-loan-page').addEventListener('click', (e) => {
                const btn = e.target.closest('.loan-filter-btn');
                if (!btn) return;
                window.currentLoanFilter = btn.dataset.loanFilter;
                renderAdminLoanPage();
            });
            document.getElementById('loan-admin-search').addEventListener('input', renderAdminLoanPage);
            renderAdminLoanPage();
            if (currentUser?.uid === ADMIN_UID && (!allLoanRequestsCache.length || !allLoansCache.length)) {
                const listEl = document.getElementById('admin-loan-list');
                if (listEl && !allLoanRequestsCache.length && !allLoansCache.length) {
                    listEl.innerHTML = '<p class="text-center text-gray-500 py-6">Loading loan data...</p>';
                }
                refreshAdminLoanCaches()
                    .then(renderAdminLoanPage)
                    .catch(error => console.warn('Admin loan quick refresh failed:', error));
            }
        };

const renderAdminLoanPage = () => {
            const listEl = document.getElementById('admin-loan-list');
            if (!listEl) return;
            updateAdminLoanRequestBadge();
            const filter = window.currentLoanFilter || 'pending';
            document.querySelectorAll('.loan-filter-btn').forEach(btn => {
                const active = btn.dataset.loanFilter === filter;
                btn.className = `loan-filter-btn px-3 py-2 rounded-lg text-sm font-semibold ${active ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700'}`;
            });
            const search = (document.getElementById('loan-admin-search')?.value || '').toLowerCase();

            if (filter === 'loans') {
                const grouped = new Map();
                [...allLoansCache].filter(isModernLoanRecord).forEach(loan => {
                    const userId = loan.userId || 'unknown';
                    const current = grouped.get(userId) || { userId, loans: [], user: allUsersCache.find(user => (user.id || user.uid) === userId) || {} };
                    current.loans.push(loan);
                    grouped.set(userId, current);
                });
                let groups = Array.from(grouped.values()).map(group => {
                    const loans = group.loans.sort((a, b) => timestampToMillis(b.createdAt || b.paidAt) - timestampToMillis(a.createdAt || a.paidAt));
                    const activeLoans = loans.filter(isActiveLoanRecord);
                    const totalUsed = activeLoans.reduce((sum, loan) => sum + Number(loan.amount || 0), 0);
                    const totalRepayable = activeLoans.reduce((sum, loan) => sum + Number(loan.totalRepayable || 0), 0);
                    const latest = loans[0] || {};
                    const user = group.user || {};
                    return { ...group, loans, activeLoans, totalUsed, totalRepayable, latest, user };
                }).filter(group => !search || [
                    group.user.name,
                    group.user.mobile,
                    group.user.email,
                    group.latest.userName,
                    group.latest.userMobile,
                    group.latest.status
                ].some(v => String(v || '').toLowerCase().includes(search)));

                groups.sort((a, b) => timestampToMillis(b.latest.createdAt || b.latest.paidAt) - timestampToMillis(a.latest.createdAt || a.latest.paidAt));
                listEl.innerHTML = groups.length ? groups.map(group => {
                    const displayName = group.user.name || group.latest.userName || 'User';
                    const displayMobile = group.user.mobile || group.latest.userMobile || '';
                    return `
                        <button data-action="view-admin-loan-user" data-userid="${group.userId}" class="w-full p-4 mb-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-left text-sm border border-gray-100 dark:border-gray-700">
                            <div class="flex justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="font-black truncate">${escapeHtml(displayName)}</p>
                                    <p class="text-xs text-gray-500 truncate">${escapeHtml(displayMobile || group.user.email || '')}</p>
                                    <p class="mt-1 text-xs text-gray-500">${group.loans.length} loan record(s) | ${group.activeLoans.length} active</p>
                                </div>
                                <div class="text-right shrink-0">
                                    <p class="font-black">${formatCurrency(group.totalUsed)}</p>
                                    <p class="text-xs text-gray-500">Used now</p>
                                    <p class="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Limit ${formatCurrency(getLoanLimitAmount(group.user))}</p>
                                </div>
                            </div>
                            ${group.totalRepayable ? `<div class="mt-3 rounded-xl bg-white dark:bg-gray-800 px-3 py-2 text-xs font-bold text-gray-600 dark:text-gray-300">Active repayable: ${formatCurrency(group.totalRepayable)}</div>` : ''}
                        </button>`;
                }).join('') : '<p class="text-center text-gray-500 py-6">No loan users found.</p>';
                return;
            }

            let requests = getLatestLoanRequestsByApplicant(allLoanRequestsCache, allUsersCache).filter(r => getLoanRequestStatus(r) === filter);
            requests = requests.filter(r => !search || [r.name, r.fatherName, r.mobile, r.alternateMobile, r.dob, r.aadhaar].some(v => (v || '').toString().toLowerCase().includes(search)));
            listEl.innerHTML = requests.length ? requests.map(r => {
                const status = getLoanRequestStatus(r);
                return `
                <div class="p-4 mb-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-sm">
                    <div class="flex flex-col sm:flex-row justify-between gap-3">
                        <div class="space-y-1">
                            <p class="font-semibold">${r.name || 'No Name'}</p>
                            <p class="text-xs text-gray-500">Father: ${r.fatherName || 'N/A'}</p>
                            <p class="text-xs text-gray-500">Mobile: ${r.mobile || 'N/A'} | Alt: ${r.alternateMobile || 'N/A'}</p>
                            <p class="text-xs text-gray-500">DOB: ${r.dob || 'N/A'}</p>
                            <p class="text-xs text-gray-500">Aadhaar: ${r.aadhaar || 'N/A'}</p>
                            <p class="text-xs text-gray-500">User: ${r.userEmail || 'N/A'}</p>
                            <div class="flex flex-wrap gap-2 pt-1">
                                ${r.documents?.aadhaar?.url ? `<button type="button" data-action="preview-loan-doc" data-requestid="${r.id}" data-doctype="aadhaar" class="rounded bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-700">View Aadhaar</button>` : '<span class="rounded bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-500">No Aadhaar file</span>'}
                                ${r.documents?.selfie?.url ? `<button type="button" data-action="preview-loan-doc" data-requestid="${r.id}" data-doctype="selfie" class="rounded bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">View Selfie</button>` : '<span class="rounded bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-500">No selfie file</span>'}
                            </div>
                            ${r.maxLoanAmount ? `<p class="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Approved Max: ${formatCurrency(r.maxLoanAmount)}</p>` : ''}
                            ${status === 'rejected' && r.rejectionReason ? `<p class="text-xs font-semibold text-red-600 dark:text-red-300">Reason: ${escapeHtml(r.rejectionReason)}</p>` : ''}
                        </div>
                        ${status === 'pending' ? `
                            <div class="flex sm:flex-col gap-2">
                                <button data-action="approve-loan-request" data-requestid="${r.id}" data-userid="${r.userId}" class="px-3 py-1 text-xs bg-green-600 text-white rounded font-semibold">Approve</button>
                                <button data-action="reject-loan-request" data-requestid="${r.id}" data-userid="${r.userId}" class="px-3 py-1 text-xs bg-red-600 text-white rounded font-semibold">Reject</button>
                            </div>` : ''}
                        ${status === 'rejected' ? `
                            <div class="flex flex-wrap sm:flex-col gap-2">
                                <button data-action="approve-loan-request" data-requestid="${r.id}" data-userid="${r.userId}" class="px-3 py-1 text-xs bg-green-600 text-white rounded font-semibold" title="Approve rejected request">&#10003; Approve</button>
                                <button data-action="give-loan-chance" data-requestid="${r.id}" data-userid="${r.userId}" class="px-3 py-1 text-xs bg-indigo-600 text-white rounded font-semibold">Give Chance</button>
                            </div>` : ''}
                    </div>
                </div>`;
            }).join('') : '<p class="text-center text-gray-500 py-6">No loan requests found.</p>';
        };

const showAdminLoanUserDetailsPage = (userId) => {
            const user = allUsersCache.find(item => (item.id || item.uid) === userId) || {};
            const loans = getUserLoanRecords(userId);
            const summary = buildLoanSummary(user, loans);
            const request = getLatestModernLoanRequest(userId);
            const loanRows = loans.length ? loans.map(loan => {
                const dueDate = toDate(loan.dueDate);
                const createdAt = toDate(loan.createdAt);
                const canAutoDebit = isActiveLoanRecord(loan) && dueDate && dueDate <= new Date();
                return `
                    <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm">
                        <div class="flex justify-between gap-3">
                            <div>
                                <p class="font-black">${formatCurrency(loan.amount || 0)} <span class="text-[10px] uppercase text-gray-500">${escapeHtml(loan.status || 'active')}</span></p>
                                <p class="text-xs text-gray-500">${createdAt ? createdAt.toLocaleDateString('en-IN') : 'N/A'} | Due ${getLoanDueDateText(loan)}</p>
                            </div>
                            <div class="text-right">
                                <p class="font-black">${formatCurrency(loan.totalRepayable || 0)}</p>
                                <p class="text-xs text-gray-500">Repay</p>
                            </div>
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <button data-action="admin-view-loan-detail" data-loanid="${loan.id}" class="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">Full Details</button>
                            ${isActiveLoanRecord(loan) ? `
                                <button data-action="admin-close-loan-manual" data-loanid="${loan.id}" class="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-black text-white shadow-sm">✓ Close Loan (External Paid)</button>
                                <button data-action="admin-loan-auto-debit" data-loanid="${loan.id}" ${canAutoDebit ? '' : 'disabled'} class="rounded-lg px-3 py-2 text-xs font-black ${canAutoDebit ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700'}">Auto Debit</button>
                            ` : ''}
                        </div>
                    </div>`;
            }).join('') : '<p class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-5 text-center text-sm font-bold text-gray-500">No loan history.</p>';

            showPage(`
                ${getPageHeader('Loan User Details')}
                <div class="max-w-3xl mx-auto space-y-4">
                    <div class="rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h3 class="text-lg font-black text-gray-900 dark:text-white">${escapeHtml(user.name || request?.name || 'User')}</h3>
                                <p class="text-xs text-gray-500">${escapeHtml(user.mobile || request?.mobile || '')} ${user.email ? `| ${escapeHtml(user.email)}` : ''}</p>
                            </div>
                            <button data-action="admin-add-loan-limit" data-userid="${userId}" class="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white">Add / Change Limit</button>
                        </div>
                        <div class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            <div class="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 p-3"><p class="text-xs text-gray-500">Max Limit</p><p class="font-black">${formatCurrency(summary.maxLimit)}</p></div>
                            <div class="rounded-xl bg-blue-50 dark:bg-blue-900/20 p-3"><p class="text-xs text-gray-500">Used</p><p class="font-black">${formatCurrency(summary.usedAmount)}</p></div>
                            <div class="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3"><p class="text-xs text-gray-500">Available</p><p class="font-black">${formatCurrency(summary.availableAmount)}</p></div>
                            <div class="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3"><p class="text-xs text-gray-500">Repayable</p><p class="font-black">${formatCurrency(summary.repayableAmount)}</p></div>
                        </div>
                    </div>
                    <div class="rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 class="text-sm font-black text-gray-900 dark:text-white">Uploaded Documents</h3>
                        <div class="mt-3 flex flex-wrap gap-2 text-xs">
                            ${request?.documents?.aadhaar?.url ? `<button type="button" data-action="preview-loan-doc" data-requestid="${request.id}" data-doctype="aadhaar" class="rounded-lg bg-indigo-100 px-3 py-2 font-black text-indigo-700">Open Aadhaar</button>` : '<span class="rounded-lg bg-gray-100 px-3 py-2 font-black text-gray-500">Aadhaar not uploaded</span>'}
                            ${request?.documents?.selfie?.url ? `<button type="button" data-action="preview-loan-doc" data-requestid="${request.id}" data-doctype="selfie" class="rounded-lg bg-emerald-100 px-3 py-2 font-black text-emerald-700">Open Selfie</button>` : '<span class="rounded-lg bg-gray-100 px-3 py-2 font-black text-gray-500">Selfie not uploaded</span>'}
                            <span class="rounded-lg bg-yellow-100 px-3 py-2 font-black text-yellow-700">Match: ${escapeHtml(request?.documents?.aadhaarSelfieMatchStatus || 'pending_admin_review')}</span>
                        </div>
                    </div>
                    <div class="space-y-3">
                        <h3 class="px-1 text-sm font-black text-gray-900 dark:text-white">Loan History</h3>
                        ${loanRows}
                    </div>
                </div>
                ${getPageFooter()}`, { returnTo: 'admin', onBack: showAdminLoanPage });
            setBottomNavActive('bottom-admin-btn');
        };

const showAdminLoanDetailModal = (loanId) => {
            const loan = allLoansCache.find(item => item.id === loanId);
            if (!loan) return showNotification('Loan details not found.', true);
            const dueDate = toDate(loan.dueDate);
            const createdAt = toDate(loan.createdAt);
            const paidAt = toDate(loan.paidAt);
            const isPaid = loan.status === 'paid';
            renderModal('Admin Loan Details',
                `<div class="space-y-3 text-sm">
                    <div class="rounded-2xl bg-gray-50 dark:bg-gray-700 p-4 space-y-2">
                        <div class="flex justify-between gap-3"><span>User</span><span class="font-bold text-right">${escapeHtml(loan.userName || 'User')}</span></div>
                        <div class="flex justify-between gap-3"><span>Mobile</span><span class="font-bold text-right">${escapeHtml(loan.userMobile || 'N/A')}</span></div>
                        <div class="flex justify-between gap-3"><span>Status</span><span class="font-bold text-right uppercase ${isPaid ? 'text-emerald-600' : 'text-amber-600'}">${escapeHtml(loan.status || 'active')}</span></div>
                    </div>
                    <div class="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
                        <div class="flex justify-between gap-3"><span>Principal</span><span class="font-black">${formatCurrency(loan.amount || 0)}</span></div>
                        <div class="flex justify-between gap-3"><span>Interest</span><span class="font-black">${formatCurrency(loan.interest || 0)}</span></div>
                        <div class="flex justify-between gap-3"><span>Total Repay</span><span class="font-black">${formatCurrency(loan.totalRepayable || 0)}</span></div>
                        <div class="flex justify-between gap-3"><span>Credit Limit</span><span class="font-black">${formatCurrency(loan.creditLimitAtBorrow || 0)}</span></div>
                        <div class="flex justify-between gap-3"><span>Created</span><span class="font-black">${createdAt ? createdAt.toLocaleDateString('en-IN') : 'N/A'}</span></div>
                        <div class="flex justify-between gap-3"><span>Due Date</span><span class="font-black text-right">${escapeHtml(getLoanDueDateText(loan))}</span></div>
                        ${paidAt ? `<div class="flex justify-between gap-3"><span>Paid</span><span class="font-black text-emerald-600">${paidAt.toLocaleDateString('en-IN')} ${loan.paidExternally ? '(External/Manual)' : ''}</span></div>` : ''}
                        ${loan.settlementNote ? `<div class="flex justify-between gap-3"><span>Note</span><span class="font-semibold text-right text-xs text-gray-500">${escapeHtml(loan.settlementNote)}</span></div>` : ''}
                    </div>
                </div>`,
                `<div class="flex justify-end gap-2">
                    <button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Close</button>
                    ${!isPaid ? `<button data-action="admin-close-loan-manual" data-loanid="${loan.id}" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-black shadow">Close Loan (External Paid)</button>` : ''}
                </div>`,
                'max-w-md');
        };

const showAdminAddLoanLimitModal = (userId) => {
            const user = allUsersCache.find(item => (item.id || item.uid) === userId) || {};
            renderModal('Update Loan Limit',
                `<div class="space-y-4">
                    <div class="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 p-3 text-sm">
                        <p class="font-black">${escapeHtml(user.name || 'User')}</p>
                        <p class="text-xs text-gray-500">${escapeHtml(user.mobile || user.email || '')}</p>
                    </div>
                    <input type="number" id="admin-loan-limit-input" min="1" step="1" value="${getLoanLimitAmount(user) || ''}" placeholder="New max credit limit" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>`,
                `<button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
                 <button id="confirm-admin-loan-limit-btn" class="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg">Save Limit</button>`,
                'max-w-md');
            document.getElementById('confirm-admin-loan-limit-btn').onclick = async () => {
                const amount = Number(document.getElementById('admin-loan-limit-input')?.value || 0);
                if (!Number.isFinite(amount) || amount < 1) return showNotification('Enter a valid loan limit.', true);
                await updateAdminLoanLimit(userId, amount);
            };
        };

const updateAdminLoanLimit = async (userId, amount) => {
            try {
                await updateDoc(doc(db, `artifacts/${appId}/public/data/users`, userId), {
                    loanEligible: true,
                    maxLoanAmount: Number(amount),
                    loanMaxAmount: Number(amount),
                    loanApplicationVersion: LOAN_APPLICATION_VERSION,
                    loanRequestStatus: 'approved',
                    loanLimitUpdatedAt: serverTimestamp(),
                    loanLimitUpdatedBy: currentUser.uid
                });
                allUsersCache = allUsersCache.map(user => (user.id || user.uid) === userId ? {
                    ...user,
                    loanEligible: true,
                    maxLoanAmount: Number(amount),
                    loanMaxAmount: Number(amount),
                    loanApplicationVersion: LOAN_APPLICATION_VERSION,
                    loanRequestStatus: 'approved'
                } : user);
                showNotification('Loan limit updated.');
                window.closeModal();
                showAdminLoanUserDetailsPage(userId);
            } catch (error) {
                console.error('Loan limit update failed:', error);
                showNotification(`Error: ${error.message}`, true);
            }
        };

const showAdminInvestmentsPage = () => {
            const content = `
                ${getPageHeader('Manage Partner')}
                <div id="admin-investments-page" class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-4">
                    <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                        <input id="investment-admin-search" placeholder="Search user, mobile, invoice..." class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                        <span class="text-xs text-gray-500 dark:text-gray-400">Interest button unlocks only after 30 days.</span>
                    </div>
                    <div id="admin-investments-list" class="max-h-[72vh] overflow-y-auto"></div>
                </div>
                ${getPageFooter()}`;
            showPage(content);
            document.getElementById('investment-admin-search').addEventListener('input', renderAdminInvestmentsPage);
            renderAdminInvestmentsPage();
        };

const renderAdminInvestmentsPage = () => {
            const listEl = document.getElementById('admin-investments-list');
            if (!listEl) return;
            const search = (document.getElementById('investment-admin-search')?.value || '').toLowerCase();
            let investments = [...allInvestmentsCache].filter(i => !search || [i.userName, i.userMobile, i.userEmail, i.invoiceId, i.status].some(v => (v || '').toString().toLowerCase().includes(search)));

            const grouped = new Map();
            investments.forEach(inv => {
                const userId = inv.userId || 'unknown';
                const group = grouped.get(userId) || { userId, user: allUsersCache.find(user => (user.id || user.uid) === userId) || {}, investments: [] };
                group.investments.push(inv);
                grouped.set(userId, group);
            });
            const groups = Array.from(grouped.values()).map(group => {
                const active = group.investments.filter(inv => (inv.status || 'active') === 'active');
                const totalAmount = group.investments.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
                const activeAmount = active.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
                const paidInterest = group.investments.reduce((sum, inv) => sum + Number(inv.paidInterest || 0), 0);
                const latest = group.investments.sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt))[0] || {};
                return { ...group, active, totalAmount, activeAmount, paidInterest, latest };
            }).sort((a, b) => timestampToMillis(b.latest.createdAt) - timestampToMillis(a.latest.createdAt));

            listEl.innerHTML = groups.length ? groups.map(group => {
                const name = group.user.name || group.latest.userName || 'User';
                const mobile = group.user.mobile || group.latest.userMobile || '';
                return `
                    <button data-action="view-admin-investment-user" data-userid="${group.userId}" class="w-full p-4 mb-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-left text-sm border border-gray-100 dark:border-gray-700">
                        <div class="flex justify-between gap-3">
                            <div class="min-w-0">
                                <p class="font-black truncate">${escapeHtml(name)}</p>
                                <p class="text-xs text-gray-500 truncate">${escapeHtml(mobile || group.user.email || group.latest.userEmail || '')}</p>
                                <p class="mt-1 text-xs text-gray-500">${group.investments.length} investment record(s) | ${group.active.length} active</p>
                            </div>
                            <div class="text-right shrink-0">
                                <p class="font-black">${formatCurrency(group.activeAmount)}</p>
                                <p class="text-xs text-gray-500">Active</p>
                            </div>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div class="rounded-xl bg-white dark:bg-gray-800 p-2"><span class="text-gray-500">Total Invested</span><p class="font-bold">${formatCurrency(group.totalAmount)}</p></div>
                            <div class="rounded-xl bg-white dark:bg-gray-800 p-2"><span class="text-gray-500">Interest Paid</span><p class="font-bold">${formatCurrency(group.paidInterest)}</p></div>
                        </div>
                    </button>`;
            }).join('') : '<p class="text-center text-gray-500 py-6">No partner investments found.</p>';
        };

const showAdminInvestmentUserDetailsPage = (userId) => {
            const user = allUsersCache.find(item => (item.id || item.uid) === userId) || {};
            const investments = allInvestmentsCache
                .filter(inv => inv.userId === userId)
                .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            const active = investments.filter(inv => (inv.status || 'active') === 'active');
            const totalAmount = investments.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
            const activeAmount = active.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
            const paidInterest = investments.reduce((sum, inv) => sum + Number(inv.paidInterest || 0), 0);
            const formatDateStr = (dateVal) => {
                if (!dateVal) return 'N/A';
                const d = toDate(dateVal);
                if (!d || isNaN(d.getTime())) return 'N/A';
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}/${mm}/${yyyy}`;
            };

            const cards = investments.length ? investments.map(inv => {
                const start = toDate(inv.startDate) || toDate(inv.createdAt) || new Date();
                const months = inv.months || inv.tenureMonths || 12;
                let end = toDate(inv.endDate);
                if (!end && start) {
                    end = new Date(start.getTime());
                    end.setMonth(end.getMonth() + months);
                }
                let next = toDate(inv.nextPayoutAt);
                if (!next && start && (inv.status || 'active') === 'active') {
                    next = new Date(start.getTime());
                    next.setMonth(next.getMonth() + 1);
                }
                const now = new Date();
                const due = inv.status === 'active' && next && next <= now;
                const isCompleted = inv.status === 'completed' || (end && end <= now && (inv.paidInterest || 0) >= (inv.totalInterest || 0));

                return `
                    <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm space-y-3 shadow-sm">
                        <div class="flex justify-between items-start gap-3 border-b border-gray-100 dark:border-gray-700 pb-3">
                            <div>
                                <p class="text-lg font-black text-gray-900 dark:text-white">${formatCurrency(inv.amount || 0)}</p>
                                <p class="text-xs text-gray-500 font-mono">Invoice #${escapeHtml(inv.invoiceId || inv.id)}</p>
                            </div>
                            <span class="rounded-full px-3 py-1 text-xs font-black ${isCompleted ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}">
                                ${isCompleted ? 'Completed' : (inv.status || 'active').toUpperCase()}
                            </span>
                        </div>

                        <div class="grid grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-gray-750 p-3 rounded-xl">
                            <div>
                                <span class="text-[10px] font-bold text-gray-400 uppercase block">📅 Invested Date</span>
                                <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5">${formatDateStr(start)}</p>
                            </div>
                            <div>
                                <span class="text-[10px] font-bold text-gray-400 uppercase block">🏆 Maturity / Return Date</span>
                                <p class="font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">${formatDateStr(end)}</p>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2 text-xs">
                            <div class="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 p-2.5">
                                <span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Interest Paid</span>
                                <p class="font-black text-emerald-700 dark:text-emerald-300 mt-0.5">${formatCurrency(inv.paidInterest || 0)}</p>
                            </div>
                            <div class="rounded-xl bg-blue-50/60 dark:bg-blue-950/20 p-2.5">
                                <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase">Next Payout</span>
                                <p class="font-black text-blue-700 dark:text-blue-300 mt-0.5">${isCompleted ? 'All Paid' : formatDateStr(next)}</p>
                            </div>
                        </div>

                        <div class="flex flex-wrap gap-2 pt-1">
                            <button data-action="process-investment-interest" data-investmentid="${inv.id}" ${due ? '' : 'disabled'} class="rounded-xl px-4 py-2 text-xs font-black transition ${due ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500 cursor-not-allowed'}">${due ? '⚡ Process Monthly Interest' : 'Interest Unlocks in 30 Days'}</button>
                            <button data-action="download-admin-investment-invoice" data-investmentid="${inv.id}" class="rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-black text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 shadow-sm">📄 Invoice PDF</button>
                        </div>
                    </div>`;
            }).join('') : '<p class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-5 text-center text-sm font-bold text-gray-500">No investment history.</p>';

            showPage(`
                ${getPageHeader('Partner User Details')}
                <div class="max-w-3xl mx-auto space-y-4">
                    <div class="rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 class="text-lg font-black text-gray-900 dark:text-white">${escapeHtml(user.name || investments[0]?.userName || 'User')}</h3>
                        <p class="text-xs text-gray-500">${escapeHtml(user.mobile || investments[0]?.userMobile || '')} ${user.email ? `| ${escapeHtml(user.email)}` : ''}</p>
                        <div class="mt-4 grid grid-cols-3 gap-3 text-sm">
                            <div class="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-3"><p class="text-xs text-gray-500">Active</p><p class="font-black">${formatCurrency(activeAmount)}</p></div>
                            <div class="rounded-xl bg-blue-50 dark:bg-blue-900/20 p-3"><p class="text-xs text-gray-500">Total</p><p class="font-black">${formatCurrency(totalAmount)}</p></div>
                            <div class="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3"><p class="text-xs text-gray-500">Interest</p><p class="font-black">${formatCurrency(paidInterest)}</p></div>
                        </div>
                    </div>
                    <div class="space-y-3">${cards}</div>
                </div>
                ${getPageFooter()}`, { returnTo: 'admin', onBack: showAdminInvestmentsPage });
            setBottomNavActive('bottom-admin-btn');
        };

const processDuePartnerInvestmentsForAdmin = async (showToast = false) => {
            const dueInvestments = allInvestmentsCache.filter(inv => inv.status === 'active' && toDate(inv.nextPayoutAt) && toDate(inv.nextPayoutAt) <= new Date());
            let processed = 0;
            for (const inv of dueInvestments) {
                try {
                    await processPartnerInterest(inv.id);
                    processed++;
                } catch (e) {
                    console.error('Due partner interest failed:', e);
                }
            }
            if (showToast) showNotification(processed ? `Processed ${processed} due investment(s).` : 'No investment has completed 30 days yet.', !processed);
        };

const renderAdminGiftCodesList = (docs) => {
            const listEl = document.getElementById('gift-codes-list-page');
            if (!listEl) return;
            listEl.innerHTML = docs.length === 0 ? '<p class="text-xs text-gray-500 dark:text-gray-400">No codes.</p>' : docs.map(d => {
                const c = d.data();
                const status = (c.timesUsed || 0) >= (c.usageLimit || 1) ? 'Fully Redeemed' : `${c.timesUsed || 0}/${c.usageLimit || 1} Used`;
                return `
                    <div class="p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex justify-between items-center text-sm">
                        <div>
                            <p class="font-mono font-semibold">${c.code}</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">${formatCurrency(c.amount)} - ${status}</p>
                        </div>
                        <button data-action="delete-gift-code" data-id="${d.id}" class="text-red-500 hover:text-red-700 text-xs font-semibold">Delete</button>
                    </div>`;
            }).join('');
        };

const showAdminAddFundsModal = () => {
            let options = allUsersCache
                .filter(u => !isAdminUserRecord(u))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map(u => `<option value="${u.id}">${u.name || u.email}</option>`)
                .join('');
            const content = `
                <div class="space-y-4">
                    <p class="text-sm text-gray-500 dark:text-gray-400">Select a user to add funds to their wallet directly.</p>
                    <select id="user-select-dropdown" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">${options}</select>
                    <input type="number" id="fund-amount-input" placeholder="Amount (₹)" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <input type="text" id="fund-comment-input" placeholder="Remarks (e.g., Bonus)" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>`;
            const actions = `
                <button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
                <button id="modal-submit-btn" class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Add Funds</button>`;
            renderModal('Add Funds to User', content, actions);
            document.getElementById('modal-submit-btn').onclick = handleAdminAddFunds;
        };

const handleAdminAddFunds = async () => {
            const userId = document.getElementById('user-select-dropdown').value;
            const amount = parseFloat(document.getElementById('fund-amount-input').value);
            let comment = document.getElementById('fund-comment-input').value.trim();

            // Auto-fill remarks if empty
            if (!comment) {
                comment = "Payment By reviews World";
            }

            if (!userId || isNaN(amount) || amount <= 0) {
                return showNotification('Please fill all fields correctly.', true);
            }

            try {
                const userRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
                await runTransaction(db, async (tx) => {
                    const userDoc = await tx.get(userRef);
                    if (!userDoc.exists()) throw new Error("User not found!");
                    const oldBalance = userDoc.data().balance || 0;
                    const newBalance = oldBalance + amount;
                    tx.update(userRef, { balance: newBalance });
                    tx.set(doc(collection(userRef, 'transactions')), {
                        type: 'credit',
                        amount,
                        comment,
                        timestamp: serverTimestamp(),
                        transactionId: generateTransactionId(),
                        status: 'completed',
                        senderName: 'REVIEWS WORLD',
                        senderMobile: 'Admin Wallet',
                        recipientName: userDoc.data().name || 'User',
                        recipientMobile: userDoc.data().mobile || '',
                        recipientIsProProfile: !!userDoc.data().isProProfile,
                        mode: 'Admin Credit',
                        balanceBefore: oldBalance,
                        balanceAfter: newBalance,
                        isAdminTransaction: true
                    });
                });
                allUsersCache = allUsersCache.map(u => u.id === userId ? { ...u, balance: (Number(u.balance || 0) + amount) } : u);
                syncRecentTransactionsToCloud(userId).catch(error => console.warn('Admin add funds cloud sync skipped:', error));
                showNotification('Funds added successfully!');
                window.closeModal();
                if (document.getElementById('admin-users-list-page')) updateAdminUserListView();
            } catch (e) {
                console.error("Admin add funds failed:", e);
                showFriendlyError('Could not add funds. Please try again.');
            }
        };

const showManageAdminWalletModal = () => {
            if (!currentUserData) return showNotification("Your admin data is not loaded yet. Please wait.", true);
            const content = `
                <div class="space-y-3 p-4 bg-gray-100 dark:bg-gray-700/50 rounded-lg">
                    <p>Current Balance: <strong>${formatCompactBalance(currentUserData.balance)}</strong></p>
                    <input type="number" id="admin-fund-amount-input" placeholder="Amount (e.g., 10000 or -50)" class="w-full px-4 py-2 bg-white dark:bg-gray-700 rounded-lg">
                    <input type="text" id="admin-fund-comment-input" placeholder="Remarks (e.g., Initial Deposit)" class="w-full px-4 py-2 bg-white dark:bg-gray-700 rounded-lg">
                </div>`;
            const actions = `
                <button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 font-semibold rounded-lg">Cancel</button>
                <button id="modal-submit-btn" class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Update My Balance</button>`;
            renderModal('Manage My Admin Wallet', content, actions);
            document.getElementById('modal-submit-btn').onclick = handleUpdateAdminWallet;
        };

const handleUpdateAdminWallet = async () => {
            const amount = parseFloat(document.getElementById('admin-fund-amount-input').value);
            const comment = document.getElementById('admin-fund-comment-input').value.trim();
            if (isNaN(amount) || !comment) return showNotification('Invalid amount or remarks.', true);

            const adminRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
            try {
                await runTransaction(db, async (tx) => {
                    const adminDoc = await tx.get(adminRef);
                    if (!adminDoc.exists()) throw new Error("Admin user not found!");
                    const newBalance = (adminDoc.data().balance || 0) + amount;
                    if (newBalance < 0) throw new Error("Admin balance cannot be negative.");
                    tx.update(adminRef, { balance: newBalance });
                    tx.set(doc(collection(adminRef, 'transactions')), {
                        type: amount > 0 ? 'credit' : 'debit',
                        amount: Math.abs(amount),
                        comment: comment,
                        timestamp: serverTimestamp(),
                        transactionId: generateTransactionId(),
                        status: 'completed'
                    });
                });
                showNotification('Admin balance updated successfully!');
                window.closeModal();
            } catch (e) {
                console.error("Update admin wallet failed:", e);
                showNotification(`Error: ${e.message}`, true);
            }
        };

const openAdminQuickAction = (handler) => {
            if (!ensureAdminSessionReady()) return null;
            currentMainSection = 'admin';
            setBottomNavActive('bottom-admin-btn');
            try {
                const result = handler();
                if (result?.catch) {
                    result.catch(error => {
                        console.error('Admin quick action failed:', error);
                        showNotification(`Admin page error: ${error.message || error}`, true);
                    });
                }
                return result;
            } catch (error) {
                console.error('Admin quick action failed:', error);
                showNotification(`Admin page error: ${error.message || error}`, true);
                return null;
            }
        };

// Expose functions to window for global access
window.refreshAdminFundRequestsFromCloud = refreshAdminFundRequestsFromCloud;
window.importFirebaseFundRequestsForAdmin = importFirebaseFundRequestsForAdmin;
window.saveAdminFundRequestsToCache = saveAdminFundRequestsToCache;
window.hydrateAdminFundRequestsFromCache = hydrateAdminFundRequestsFromCache;
window.readAdminDashboardMetricsCache = readAdminDashboardMetricsCache;
window.rememberAdminDashboardMetrics = rememberAdminDashboardMetrics;
window.applyAdminDashboardMetrics = applyAdminDashboardMetrics;
window.hydrateAdminDashboardMetricsFromCache = hydrateAdminDashboardMetricsFromCache;
window.fetchAdminInvestmentsFromBackend = fetchAdminInvestmentsFromBackend;
window.hasCachedAdminSession = hasCachedAdminSession;
window.hasAdminSessionReadyOrCached = hasAdminSessionReadyOrCached;
window.ensureAdminSessionReady = ensureAdminSessionReady;
window.applyAdminBottomChrome = applyAdminBottomChrome;
window.loadFirebaseLoanRequestsForAdmin = loadFirebaseLoanRequestsForAdmin;
window.loadCloudLoanRequestsForAdmin = loadCloudLoanRequestsForAdmin;
window.loadAdminLoanRequestsMerged = loadAdminLoanRequestsMerged;
window.refreshAdminDashboardCaches = refreshAdminDashboardCaches;
window.initializeAdminFundRequestsRealtime = initializeAdminFundRequestsRealtime;
window.applyAdminGiftCodesSnapshot = applyAdminGiftCodesSnapshot;
window.updateAdminLoanRequestBadge = updateAdminLoanRequestBadge;
window.applyAdminLoanRequestsList = applyAdminLoanRequestsList;
window.applyAdminLoanRequestsSnapshot = applyAdminLoanRequestsSnapshot;
window.applyAdminLoansSnapshot = applyAdminLoansSnapshot;
window.applyAdminInvestmentsSnapshot = applyAdminInvestmentsSnapshot;
window.initializeAdminSecondaryRealtime = initializeAdminSecondaryRealtime;
window.refreshAdminSecondaryCaches = refreshAdminSecondaryCaches;
window.refreshAdminLoanCaches = refreshAdminLoanCaches;
let allAdminDepositsCache = [];

const showAdminDepositHistoryPage = async () => {
    const isCurrentAdmin = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
    if (!isCurrentAdmin) return showNotification('Admin access required.', true);

    const content = `
        ${getPageHeader('All Deposits / Add Money History')}
        <div class="max-w-4xl mx-auto space-y-4">
            <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-3">
                <input type="search" id="admin-deposit-search" placeholder="Search user name, email, mobile, UTR, Order ID" class="w-full sm:w-80 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <div class="flex items-center gap-2 w-full sm:w-auto">
                    <select id="admin-deposit-filter" class="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl text-sm font-semibold">
                        <option value="all">All Deposits</option>
                        <option value="completed">Completed Only</option>
                        <option value="failed">Failed Only</option>
                    </select>
                    <button id="admin-refresh-deposits-btn" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition">Refresh</button>
                    <button id="admin-autoverify-deposits-btn" onclick="handleAdminAutoVerifyAllDeposits()" class="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-emerald-600 hover:from-amber-600 hover:to-emerald-700 text-white rounded-xl text-xs font-black shadow-md transition flex items-center gap-1">
                        <span>⚡ Auto-Verify All</span>
                    </button>
                </div>
            </div>

            <div class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700">
                <div id="admin-deposits-list" class="max-h-[70vh] overflow-y-auto space-y-3">
                    <p class="text-center text-gray-500 py-8 font-semibold">Loading deposit history...</p>
                </div>
            </div>
        </div>
        ${getPageFooter()}`;

    showPage(content);

    document.getElementById('admin-deposit-search')?.addEventListener('input', renderAdminDepositHistoryList);
    document.getElementById('admin-deposit-filter')?.addEventListener('change', renderAdminDepositHistoryList);
    document.getElementById('admin-refresh-deposits-btn')?.addEventListener('click', fetchAdminDepositHistory);

    renderAdminDepositHistoryList();
    fetchAdminDepositHistory();
};

const handleAdminAutoVerifyAllDeposits = async () => {
    const uncompleted = allAdminDepositsCache.filter(d => d.status !== 'completed');
    if (!uncompleted.length) {
        return showNotification('No pending or failed deposits to verify.', true);
    }

    showLoading();
    let verifiedCount = 0;
    const apiKey = appConfigCache?.fampay_api_key || 'FAM_fbc1b443110a37b5f2f1de5bef365c90defb23c1a38d19c0';

    for (const d of uncompleted) {
        const orderId = d.orderId || d.id;
        if (!orderId) continue;
        try {
            const verifyUrl = `https://fampay.anujbots.xyz/verify.php?order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
            const vRes = await fetch(verifyUrl).then(r => r.json()).catch(() => null);

            if (vRes && (vRes.status === 'success' || vRes.success === true)) {
                const txnId = vRes.data?.transaction_id || `TXN_${orderId}`;
                const utr = vRes.data?.utr || 'N/A';
                const senderName = vRes.data?.sender_name || 'UPI User';

                const userId = d.userId;
                const amount = Number(d.amount || 0);
                const taxAmount = Number(d.taxAmount || 0);

                if (userId && amount > 0) {
                    const userRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
                    await runTransaction(db, async (tx) => {
                        const uSnap = await tx.get(userRef);
                        if (!uSnap.exists()) return;
                        const curBal = Number(uSnap.data().balance || 0);
                        const newBal = curBal + amount;

                        tx.update(userRef, { balance: newBal });
                        const txRef = doc(userRef, 'transactions', `dep_${orderId}`);
                        tx.set(txRef, {
                            type: 'deposit',
                            amount,
                            taxAmount,
                            totalPayable: amount + taxAmount,
                            balanceBefore: curBal,
                            balanceAfter: newBal,
                            comment: `UPI Deposit Auto-Verified (UTR: ${utr})`,
                            orderId,
                            transactionId: txnId,
                            utr,
                            senderName,
                            status: 'completed',
                            timestamp: serverTimestamp()
                        }, { merge: true });
                    });

                    const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
                    await setDoc(depositRef, {
                        status: 'completed',
                        transactionId: txnId,
                        utr,
                        senderName,
                        completedAt: serverTimestamp()
                    }, { merge: true });

                    verifiedCount++;
                }
            }
        } catch (err) {
            console.warn(`Auto-verify error for ${orderId}:`, err);
        }
    }

    hideLoading();
    if (verifiedCount > 0) {
        showNotification(`⚡ Auto-Verification Complete! ${verifiedCount} deposit(s) verified & credited to users.`, false, true);
        fetchAdminDepositHistory();
    } else {
        showNotification('Auto-verifier ran. No new payments detected in FamPay API.', true);
    }
};

window.handleAdminAutoVerifyAllDeposits = handleAdminAutoVerifyAllDeposits;

const fetchAdminDepositHistory = async () => {
    try {
        const depositsRef = collection(db, `artifacts/${appId}/public/data/deposits`);
        const snapshot = await getDocs(query(depositsRef, orderBy("createdAt", "desc"), firestoreLimit(300))).catch(() => null);

        if (snapshot && !snapshot.empty) {
            allAdminDepositsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        } else {
            allAdminDepositsCache = [];
        }
        renderAdminDepositHistoryList();
    } catch (e) {
        console.warn('Admin deposit history load error:', e);
        renderAdminDepositHistoryList();
    }
};

const renderAdminDepositHistoryList = () => {
    const listEl = document.getElementById('admin-deposits-list');
    if (!listEl) return;

    const search = (document.getElementById('admin-deposit-search')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('admin-deposit-filter')?.value || 'all';

    let items = [...allAdminDepositsCache];

    if (filter === 'completed') {
        items = items.filter(d => d.status === 'completed');
    } else if (filter === 'failed') {
        items = items.filter(d => d.status === 'failed' || d.status === 'rejected');
    }

    if (search) {
        items = items.filter(d =>
            (d.userName || '').toLowerCase().includes(search) ||
            (d.userEmail || '').toLowerCase().includes(search) ||
            (d.userMobile || '').toLowerCase().includes(search) ||
            (d.utr || '').toLowerCase().includes(search) ||
            (d.orderId || '').toLowerCase().includes(search)
        );
    }

    if (items.length === 0) {
        listEl.innerHTML = `<p class="text-center text-gray-500 dark:text-gray-400 py-8 font-medium">No deposit history found.</p>`;
        return;
    }

    listEl.innerHTML = items.map(d => {
        const isSuccess = d.status === 'completed';
        const statusBg = isSuccess ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200';
        const statusText = isSuccess ? 'Completed' : 'Failed / Cancelled';
        const dateDisplay = formatDate(d.createdAt || d.timestamp || d.completedAt);

        return `
            <div class="p-4 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition">
                <div class="flex flex-col sm:flex-row justify-between sm:items-start gap-2">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-bold text-gray-900 dark:text-white text-base">${escapeHtml(d.userName || 'User')}</span>
                            <span class="px-2 py-0.5 rounded text-[10px] font-black uppercase ${statusBg}">${statusText}</span>
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(d.userMobile || 'No Mobile')} | ${escapeHtml(d.userEmail || 'No Email')}</p>
                        <div class="flex flex-wrap gap-2 text-xs pt-1">
                            <span class="bg-white dark:bg-gray-700 px-2 py-1 rounded border border-gray-200 dark:border-gray-600">UTR: <span class="font-mono font-bold">${escapeHtml(d.utr || 'N/A')}</span></span>
                            <span class="bg-white dark:bg-gray-700 px-2 py-1 rounded border border-gray-200 dark:border-gray-600">Order ID: <span class="font-mono font-bold">${escapeHtml(d.orderId || 'N/A')}</span></span>
                        </div>
                    </div>
                    <div class="text-left sm:text-right space-y-1">
                        <p class="text-lg font-black text-emerald-600 dark:text-emerald-400">+₹${(d.amount || 0).toFixed(2)}</p>
                        <p class="text-xs text-blue-600 dark:text-blue-400 font-semibold">Tax Paid: ₹${(d.taxAmount || 0).toFixed(2)} (Total ₹${(d.totalPayable || d.amount || 0).toFixed(2)})</p>
                        <p class="text-[11px] text-gray-400">${dateDisplay}</p>
                    </div>
                </div>
                ${!isSuccess ? `
                    <div class="mt-3 pt-2.5 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                        <button onclick="handleAdminManualApproveDeposit('${d.id || d.orderId}', ${d.amount || 0}, ${d.taxAmount || 0}, '${d.userId}', '${escapeHtml(d.userName || 'User')}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center gap-1.5">
                            <span>✅ Approve & Credit ₹${(d.amount || 0).toFixed(2)}</span>
                        </button>
                    </div>
                ` : ''}
            </div>`;
    }).join('');
};

const handleAdminManualApproveDeposit = async (orderId, amount, taxAmount, userId, userName) => {
    if (!orderId || !userId) return showNotification('Invalid deposit record.', true);

    renderModal('Manual Deposit Approval',
        `<div class="space-y-4 text-center">
            <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs space-y-1">
                <p class="font-bold text-gray-900 dark:text-white text-sm">Credit ₹${amount} to ${escapeHtml(userName)}?</p>
                <p class="text-gray-500">Order ID: <span class="font-mono font-bold">${orderId}</span></p>
                <p class="text-blue-600 font-semibold">Wallet Credit: ₹${amount} | Tax Paid: ₹${taxAmount}</p>
            </div>
            <div>
                <label class="block text-xs font-semibold text-gray-400 uppercase mb-1 text-left">Enter UTR / Transaction ID (Optional)</label>
                <input type="text" id="admin-manual-utr-input" placeholder="e.g. 421598371029" class="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-700 rounded-xl text-sm font-mono border border-gray-200 dark:border-gray-600">
            </div>
        </div>`,
        `<button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
         <button id="confirm-admin-credit-btn" class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-bold">Confirm & Credit ₹${amount}</button>`,
        'max-w-md'
    );

    document.getElementById('confirm-admin-credit-btn').onclick = async () => {
        const utr = (document.getElementById('admin-manual-utr-input')?.value || '').trim() || 'ADMIN_MANUAL_CREDIT';
        showLoading();
        try {
            const userRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
            await runTransaction(db, async (tx) => {
                const uSnap = await tx.get(userRef);
                if (!uSnap.exists()) throw new Error('User record not found.');

                const curBal = Number(uSnap.data().balance || 0);
                const newBal = curBal + Number(amount);

                tx.update(userRef, { balance: newBal });

                const txRef = doc(userRef, 'transactions', `dep_${orderId}`);
                tx.set(txRef, {
                    type: 'deposit',
                    amount: Number(amount),
                    taxAmount: Number(taxAmount || 0),
                    totalPayable: Number(amount) + Number(taxAmount || 0),
                    balanceBefore: curBal,
                    balanceAfter: newBal,
                    comment: `Deposit Approved by Admin (UTR: ${utr})`,
                    orderId,
                    utr,
                    status: 'completed',
                    timestamp: serverTimestamp()
                }, { merge: true });
            });

            const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
            await setDoc(depositRef, {
                status: 'completed',
                utr,
                approvedByAdmin: true,
                approvedBy: currentUser?.uid || 'ADMIN',
                completedAt: serverTimestamp()
            }, { merge: true }).catch(() => {});

            hideLoading();
            window.closeModal();
            showNotification(`✅ Successfully credited ₹${amount} to ${userName}'s wallet!`, false, true);

            fetchAdminDepositHistory();
        } catch (err) {
            hideLoading();
            console.error('Admin manual credit error:', err);
            showNotification(err.message || 'Failed to credit user wallet.', true);
        }
    };
};

window.handleAdminManualApproveDeposit = handleAdminManualApproveDeposit;
window.showAdminDepositHistoryPage = showAdminDepositHistoryPage;
window.showAdminLiveListsPage = showAdminLiveListsPage;
window.loadAdminLiveLists = loadAdminLiveLists;
window.showAdminMainPage = showAdminMainPage;
window.isAdminReviewTask = isAdminReviewTask;
window.showAdminAdsPage = showAdminAdsPage;
window.resetAdminAdForm = resetAdminAdForm;
window.getAdminAdPayload = getAdminAdPayload;
window.handleSaveAdminAd = handleSaveAdminAd;
window.editAdminAd = editAdminAd;
window.handleDeleteAdminAd = handleDeleteAdminAd;
window.renderAdminAdsList = renderAdminAdsList;
window.getSupportAdminEmail = getSupportAdminEmail;
window.getAdminSupportChatSeenKey = getAdminSupportChatSeenKey;
window.getLatestAdminMessageTime = getLatestAdminMessageTime;
window.markAdminSupportChatSeen = markAdminSupportChatSeen;
window.showAdminSignupApprovalsPage = showAdminSignupApprovalsPage;
window.showAdminGiftCodesPage = showAdminGiftCodesPage;
window.loadLegacyWithdrawalTransactionsForAdmin = loadLegacyWithdrawalTransactionsForAdmin;
window.renderAdminFundRequests = renderAdminFundRequests;
window.showAdminLoanPage = showAdminLoanPage;
window.renderAdminLoanPage = renderAdminLoanPage;
window.showAdminLoanUserDetailsPage = showAdminLoanUserDetailsPage;
window.showAdminLoanDetailModal = showAdminLoanDetailModal;
window.showAdminAddLoanLimitModal = showAdminAddLoanLimitModal;
window.updateAdminLoanLimit = updateAdminLoanLimit;
window.showAdminInvestmentsPage = showAdminInvestmentsPage;
window.renderAdminInvestmentsPage = renderAdminInvestmentsPage;
window.showAdminInvestmentUserDetailsPage = showAdminInvestmentUserDetailsPage;
window.processDuePartnerInvestmentsForAdmin = processDuePartnerInvestmentsForAdmin;
window.renderAdminGiftCodesList = renderAdminGiftCodesList;
window.showAdminAddFundsModal = showAdminAddFundsModal;
window.handleAdminAddFunds = handleAdminAddFunds;
window.showManageAdminWalletModal = showManageAdminWalletModal;
window.handleUpdateAdminWallet = handleUpdateAdminWallet;
window.openAdminQuickAction = openAdminQuickAction;
window.updateOwnerAdminPanelButtons = updateOwnerAdminPanelButtons;
