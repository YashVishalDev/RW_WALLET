// File: src/pages/admin/admin-withdrawals.js

const showAdminWithdrawalsPage = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const content = `
        ${getPageHeader('Withdrawals')}
        <div class="max-w-4xl mx-auto space-y-6">
            <!-- Tabs Navigation -->
            <div class="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 rounded-2xl shadow-sm">
                <button id="tab-pending-btn" class="flex-1 py-3 text-sm font-bold text-center text-blue-600 border-b-2 border-blue-600 transition" onclick="switchWithdrawalTab('pending')">Pending Requests</button>
                <button id="tab-history-btn" class="flex-1 py-3 text-sm font-bold text-center text-gray-500 hover:text-blue-600 transition" onclick="switchWithdrawalTab('history')">Withdrawal History</button>
            </div>

            <!-- Tab 1: Pending Requests Section -->
            <div id="withdrawal-pending-section" class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
                <div class="relative flex items-center gap-2">
                    <input type="search" id="pending-withdrawal-search" value="${escapeHtml(adminPendingWithdrawalSearch)}" placeholder="Search name, mobile, email, amount, method" class="min-w-0 flex-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-700 rounded-xl text-sm focus:outline-none border border-gray-100 dark:border-gray-600">
                    <button id="pending-withdrawal-actions-btn" class="h-10 w-10 shrink-0 rounded-full bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-xl font-black text-yellow-700 dark:text-yellow-200 shadow-sm hover:bg-yellow-100 dark:hover:bg-yellow-900/40" title="More actions">&#8942;</button>
                    <div id="pending-withdrawal-actions-menu" class="hidden absolute right-0 top-12 z-20 w-64 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-xl">
                        <p id="legacy-pending-withdrawal-summary" class="mb-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-[11px] leading-4 text-yellow-800 dark:text-yellow-100">Checking pending withdrawals without balance cut...</p>
                        <button id="fix-legacy-pending-withdrawals-btn" class="w-full rounded-lg px-3 py-2 text-left text-xs font-black text-yellow-700 dark:text-yellow-200 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 disabled:opacity-50 disabled:cursor-not-allowed">Deduct Uncut Pending</button>
                        <button id="refresh-pending-withdrawals-btn" class="w-full rounded-lg px-3 py-2 text-left text-xs font-black text-blue-700 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/30">Refresh List</button>
                    </div>
                </div>
                <div id="admin-fund-requests-list-page" class="max-h-[75vh] overflow-y-auto"></div>
            </div>

            <!-- Tab 2: History Section -->
            <div id="withdrawal-history-section" class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4 hidden animate-fade-in">
                <!-- Filters -->
                <div class="space-y-3">
                    <!-- Search & Toggle Custom Date Row -->
                    <div class="flex gap-2">
                        <div class="relative flex-1">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </span>
                            <input type="search" id="withdrawal-history-search" placeholder="Search name, mobile, email..." class="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-700/50 border border-slate-200 dark:border-slate-700/80 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 transition">
                        </div>
                        <button id="toggle-custom-date-btn" class="h-9 px-3 flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-xs font-bold text-gray-600 dark:text-gray-300">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <span>Range</span>
                        </button>
                    </div>

                    <!-- Quick Filters Segment -->
                    <div class="flex flex-wrap gap-1.5 items-center">
                        <span class="text-[10px] font-black uppercase text-gray-405 dark:text-gray-400 tracking-wider mr-1">Period:</span>
                        <button data-filter="today" class="filter-btn active-filter px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-full transition shadow-sm">Today</button>
                        <button data-filter="yesterday" class="filter-btn px-3 py-1.5 text-xs font-bold bg-gray-150 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition">Yesterday</button>
                        <button data-filter="week" class="filter-btn px-3 py-1.5 text-xs font-bold bg-gray-150 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition">Week</button>
                        <button data-filter="month" class="filter-btn px-3 py-1.5 text-xs font-bold bg-gray-150 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition">Month</button>
                        <button data-filter="all" class="filter-btn px-3 py-1.5 text-xs font-bold bg-gray-150 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition">All</button>
                    </div>

                    <!-- Collapsible Custom Date Panel -->
                    <div id="custom-date-panel" class="hidden p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-gray-50/50 dark:bg-gray-800/30 space-y-3 animate-fade-in">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">From Date</label>
                                <input type="date" id="filter-from-date" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none">
                            </div>
                            <div>
                                <label class="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">To Date</label>
                                <input type="date" id="filter-to-date" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-slate-200 dark:border-slate-600 rounded-lg text-xs outline-none">
                            </div>
                        </div>
                        <button id="apply-date-filter" class="w-full py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition shadow-sm">Apply Custom Range</button>
                    </div>
                </div>
                
                <!-- Statistics -->
                <div class="grid grid-cols-3 gap-2.5 text-sm font-semibold">
                    <div class="bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100/80 dark:border-blue-900/50">
                        <p class="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Total</p>
                        <p id="total-withdrawals-count" class="text-xl font-black mt-1 text-blue-700 dark:text-blue-300">0</p>
                    </div>
                    <div class="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-100/80 dark:border-emerald-900/50">
                        <p class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">Approved</p>
                        <p id="approved-withdrawals-count" class="text-xl font-black mt-1 text-emerald-700 dark:text-emerald-300">0</p>
                    </div>
                    <div class="bg-red-50/50 dark:bg-red-950/20 p-3 rounded-xl border border-red-100/80 dark:border-red-900/50">
                        <p class="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider">Rejected</p>
                        <p id="rejected-withdrawals-count" class="text-xl font-black mt-1 text-red-700 dark:text-red-300">0</p>
                    </div>
                </div>
                
                <!-- Withdrawal History List -->
                <div id="withdrawal-history-list" class="max-h-[60vh] overflow-y-auto space-y-3"></div>
            </div>
        </div>
        ${getPageFooter()}
    `;

    showPage(content, { returnTo: 'admin' });
    setBottomNavActive('bottom-admin-btn');

    // Pending Requests Tab Logic
    const searchInput = document.getElementById('pending-withdrawal-search');
    searchInput?.addEventListener('input', () => {
        adminPendingWithdrawalSearch = (searchInput.value || '').trim().toLowerCase();
        renderAdminFundRequests(allFundRequestsCache);
    });

    const actionBtn = document.getElementById('pending-withdrawal-actions-btn');
    const actionMenu = document.getElementById('pending-withdrawal-actions-menu');
    actionBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        actionMenu?.classList.toggle('hidden');
    });

    document.addEventListener('click', (event) => {
        if (!actionMenu || !actionBtn || actionMenu.classList.contains('hidden')) return;
        if (!actionMenu.contains(event.target) && !actionBtn.contains(event.target)) {
            actionMenu.classList.add('hidden');
        }
    });

    document.getElementById('fix-legacy-pending-withdrawals-btn')?.addEventListener('click', handleFixLegacyPendingWithdrawals);
    document.getElementById('refresh-pending-withdrawals-btn')?.addEventListener('click', () => refreshAdminFundRequestsFromCloud());
    if ((!allFundRequestsCache || allFundRequestsCache.length === 0) && typeof hydrateAdminFundRequestsFromCache === 'function') {
        hydrateAdminFundRequestsFromCache();
    }
    renderAdminFundRequests(allFundRequestsCache);
    updateLegacyWithdrawalFixSummary();
    refreshAdminFundRequestsFromCloud();

    // History Tab Logic
    document.getElementById('toggle-custom-date-btn')?.addEventListener('click', () => {
        document.getElementById('custom-date-panel')?.classList.toggle('hidden');
    });

    document.getElementById('withdrawal-history-search')?.addEventListener('input', renderLocalWithdrawalHistoryList);
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('[data-filter]').forEach(b => {
                b.classList.remove('active-filter', 'bg-blue-600', 'text-white');
                b.classList.add('bg-gray-150', 'dark:bg-gray-700', 'text-gray-600', 'dark:text-gray-300');
            });
            this.classList.add('active-filter', 'bg-blue-600', 'text-white');
            this.classList.remove('bg-gray-150', 'dark:bg-gray-700', 'text-gray-600', 'dark:text-gray-300');
            const filter = this.dataset.filter;
            loadLocalWithdrawalHistory(filter);
        });
    });

    document.getElementById('apply-date-filter')?.addEventListener('click', () => {
        const fromDate = document.getElementById('filter-from-date').value;
        const toDate = document.getElementById('filter-to-date').value;
        if (fromDate && toDate) {
            loadLocalWithdrawalHistory('custom', fromDate, toDate);
        } else {
            showNotification('Please select both from and to dates.', true);
        }
    });

    loadLocalWithdrawalHistory('today');
};

const switchWithdrawalTab = (tab) => {
    const tabs = ['pending', 'history'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}-btn`);
        const sec = document.getElementById(`withdrawal-${t}-section`);
        if (t === tab) {
            btn?.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
            btn?.classList.remove('text-gray-500');
            sec?.classList.remove('hidden');
        } else {
            btn?.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
            btn?.classList.add('text-gray-500');
            sec?.classList.add('hidden');
        }
    });
};

const loadLocalWithdrawalHistory = async (filter = 'today', fromDate = null, toDate = null) => {
    try {
        const needsDeepHistoryScan = filter === 'all' || filter === 'custom';
        const historyLimit = needsDeepHistoryScan ? 1200 : 450;
        const withdrawalQuery = query(
            collection(db, `artifacts/${appId}/public/data/fund_requests`),
            orderBy("requestedAt", "desc"),
            firestoreLimit(historyLimit)
        );

        const [snap, cloudRequests, legacyWithdrawals] = await Promise.all([
            getDocs(withdrawalQuery),
            loadCloudFundRequests({ status: 'all', type: 'withdrawal', limit: historyLimit, timeoutMs: needsDeepHistoryScan ? 8000 : 3000 }).catch(() => []),
            needsDeepHistoryScan ? loadLegacyWithdrawalTransactionsForAdmin() : Promise.resolve([])
        ]);

        const firebaseRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let withdrawals = mergeWithdrawalHistoryRecords(firebaseRequests, cloudRequests, legacyWithdrawals);

        // Sub-admin Referred Users Filtering
        const isOwner = checkIsOwner(currentUser, currentUserData);
        if (!isOwner) {
            withdrawals = withdrawals.filter(w => {
                const u = allUsersCache.find(user => (user.id || user.uid) === w.userId);
                return u && (u.parentAdmin === currentUser?.uid || u.parent_admin === currentUser?.uid);
            });
        } else {
            withdrawals = withdrawals.filter(w => {
                const u = allUsersCache.find(user => (user.id || user.uid) === w.userId);
                return !u || !u.parentAdmin || u.parentAdmin === ADMIN_UID || u.parent_admin === ADMIN_UID;
            });
        }

        // Apply filters
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        if (filter === 'today') {
            withdrawals = withdrawals.filter(w => w.requestedAt && getSafeDate(w.requestedAt) >= today);
        } else if (filter === 'yesterday') {
            withdrawals = withdrawals.filter(w => w.requestedAt && getSafeDate(w.requestedAt) >= yesterday && getSafeDate(w.requestedAt) < today);
        } else if (filter === 'week') {
            withdrawals = withdrawals.filter(w => w.requestedAt && getSafeDate(w.requestedAt) >= weekAgo);
        } else if (filter === 'month') {
            withdrawals = withdrawals.filter(w => w.requestedAt && getSafeDate(w.requestedAt) >= monthAgo);
        } else if (filter === 'custom' && fromDate && toDate) {
            const from = new Date(fromDate);
            const to = new Date(toDate);
            to.setDate(to.getDate() + 1);
            withdrawals = withdrawals.filter(w => w.requestedAt && getSafeDate(w.requestedAt) >= from && getSafeDate(w.requestedAt) < to);
        }

        withdrawalHistoryCache = withdrawals;
        renderLocalWithdrawalHistoryList();
    } catch (error) {
        console.error("Error loading withdrawal history:", error);
    }
};

const renderLocalWithdrawalHistoryList = () => {
    const listEl = document.getElementById('withdrawal-history-list');
    if (!listEl) return;
    const search = (document.getElementById('withdrawal-history-search')?.value || '').trim().toLowerCase();
    const withdrawals = withdrawalHistoryCache.filter(w => !search || [
        w.userName,
        w.userMobile,
        w.userEmail
    ].some(value => String(value || '').toLowerCase().includes(search)));

    document.getElementById('total-withdrawals-count').textContent = withdrawals.length;
    document.getElementById('approved-withdrawals-count').textContent = withdrawals.filter(w => w.status === 'completed').length;
    document.getElementById('rejected-withdrawals-count').textContent = withdrawals.filter(w => w.status === 'rejected').length;

    if (withdrawals.length === 0) {
        listEl.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-4">No withdrawal history found.</p>';
        return;
    }

    listEl.innerHTML = withdrawals.map(w => {
        const statusColor = w.status === 'completed' ? 'text-green-500' : w.status === 'rejected' ? 'text-red-500' : 'text-yellow-500';
        const statusBg = w.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30' : w.status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30';
        const statusText = w.status === 'completed' ? 'Approved' : w.status === 'rejected' ? 'Rejected' : 'Pending';
        const payoutDetails = getWithdrawalDetailText(w);

        let requestDate = 'N/A';
        let requestTime = 'N/A';
        const reqTs = w.requestedAt || w.requested_at || w.createdAt || w.timestamp;
        if (reqTs) {
            requestDate = formatDate(reqTs).split(' ')[0];
            requestTime = getTimeFromTimestamp(reqTs);
        }

        let proceedDate = '';
        let proceedTime = '';
        const procTs = w.processedAt || w.completedAt || w.updatedAt || w.processed_at;
        if (procTs && (w.status === 'completed' || w.status === 'rejected')) {
            proceedDate = formatDate(procTs).split(' ')[0];
            proceedTime = getTimeFromTimestamp(procTs);
        }

        const escapedDetail = escapeHtml(payoutDetails);
        const methodId = normalizeWithdrawalMethodId(w);
        const methodName = getWithdrawalDisplayMethodName(w, escapeHtml(w.method || 'N/A'));

        return `
            <div class="relative mb-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-gray-800 overflow-hidden shadow-sm hover:shadow transition-all duration-200 animate-fade-in">
                <div class="px-3.5 pt-2.5 pb-2">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1 space-y-0.5">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <p class="text-sm font-bold text-gray-800 dark:text-gray-100 truncate capitalize leading-tight">${escapeHtml(w.userName || 'N/A')}</p>
                                <span class="rounded px-1.5 py-0.5 text-[9px] font-bold ${statusBg} ${statusColor} leading-none">${statusText}</span>
                            </div>
                            <div class="mt-0.5">
                                <span class="inline-block rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider">${escapeHtml(methodName)}</span>
                            </div>
                            <div class="flex flex-wrap items-center gap-1.5 pt-1">
                                ${typeof renderPayoutDetailPills === 'function' ? renderPayoutDetailPills(w) : `
                                    <div class="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-md text-xs font-bold text-indigo-700 dark:text-indigo-300">
                                        <span>${escapedDetail}</span>
                                        ${payoutDetails && payoutDetails !== 'N/A' ? `
                                            <button data-action="copy-text" data-text="${escapedDetail}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition text-indigo-600 dark:text-indigo-300" title="Copy">
                                                <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            </button>
                                        ` : ''}
                                    </div>
                                `}
                            </div>
                        </div>
                        <div class="shrink-0">
                            <span class="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-sm font-black text-emerald-700 dark:text-emerald-200 leading-none">${formatCurrencyAbs(w.amount)}</span>
                        </div>
                    </div>
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center text-[10px] font-semibold text-gray-400 mt-2 gap-1">
                        <div class="space-x-1">
                            <span>Requested: ${requestDate} ${requestTime}</span>
                            ${proceedDate ? `<span class="text-blue-600 dark:text-blue-400 font-bold">| Proceeded: ${proceedDate} ${proceedTime}</span>` : ''}
                        </div>
                        ${w.adminTransactionId ? `<span class="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-700 rounded font-mono text-[9px] text-gray-500 dark:text-gray-300">TXID: ${w.adminTransactionId}</span>` : ''}
                    </div>
                    <div id="hist-card-${w.id}-details" class="hidden mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/80 space-y-1 text-xs">
                        <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                            <span class="font-semibold">Mobile: ${escapeHtml(maskMobile(w.userMobile || ''))}</span>
                        </div>
                        <div class="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                            <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                            <span class="font-semibold">Email: ${escapeHtml(w.userEmail || 'N/A')}</span>
                        </div>
                    </div>
                </div>
                <button onclick="(function(b){var d=document.getElementById('hist-card-${w.id}-details');if(d){d.classList.toggle('hidden');b.querySelector('svg').style.transform=d.classList.contains('hidden')?'':'rotate(180deg)'};})(this)" class="w-full py-1.5 flex items-center justify-center bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-700/60 border-t border-slate-200/60 dark:border-slate-700/60 transition text-gray-500 dark:text-gray-400" title="Contact Info">
                    <span class="text-[10px] font-bold uppercase tracking-wider mr-1">User Info</span>
                    <svg class="h-3.5 w-3.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
            </div>
        `;
    }).join('');
};

const showAdminWithdrawSettingsModal = async () => {
    await loadWithdrawalSettingsOnce(true);
    const referralReward = getReferralRewardAmount ? getReferralRewardAmount() : (appConfigCache.referralRewardAmount || 0);
    const content = `
        <div class="space-y-4">
            <p class="text-sm text-gray-500 dark:text-gray-400">Configure withdrawal limits and user reward rates from one place.</p>
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Referral Reward Amount</label>
                    <input type="number" id="setting-referral-reward" value="${referralReward}" min="0" step="1" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Min. Withdrawal (UPI)</label>
                    <input type="number" id="setting-min-upi" value="${minWithdrawalUpi}" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Min. Withdrawal (Bank)</label>
                    <input type="number" id="setting-min-bank" value="${minWithdrawalBank}" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Min. Withdrawal (Gift Cards)</label>
                    <input type="number" id="setting-min-redeem" value="${minWithdrawalRedeem}" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Max. Withdrawal Per Day (Total)</label>
                    <input type="number" id="setting-max-day" value="${maxWithdrawalPerDay}" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-500 uppercase mb-1">Max. Pending Requests Per User</label>
                    <input type="number" id="setting-max-pending" value="${maxPendingWithdrawalsPerUser}" class="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                </div>
            </div>
        </div>`;
    const actions = `
        <button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
        <button id="modal-save-settings-btn" class="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg">Save Settings</button>`;
    renderModal('Rate Settings', content, actions);
    document.getElementById('modal-save-settings-btn').onclick = handleSaveWithdrawSettings;
};

// Expose functions to window
window.showAdminWithdrawalsPage = showAdminWithdrawalsPage;
window.switchWithdrawalTab = switchWithdrawalTab;
window.loadLocalWithdrawalHistory = loadLocalWithdrawalHistory;
window.renderLocalWithdrawalHistoryList = renderLocalWithdrawalHistoryList;
window.showAdminWithdrawSettingsModal = showAdminWithdrawSettingsModal;
