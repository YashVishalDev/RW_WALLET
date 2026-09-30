// File: src/pages/withdraw.js

const loadUserPendingWithdrawalsMerged = async (userId) => {
    if (!userId) return [];
    const [cloudRequests, firebaseRequests] = await Promise.all([
        loadCloudFundRequests({ status: 'pending', type: 'withdrawal', userId, limit: 200, timeoutMs: 2500 }).catch(error => {
            logBackgroundSkip('User cloud pending withdrawals skipped', error);
            return [];
        }),
        loadFirebasePendingFundRequests(userId).catch(error => {
            logBackgroundSkip('User Firebase pending withdrawals skipped', error);
            return [];
        })
    ]);
    return mergeFundRequestsById(cloudRequests, firebaseRequests)
        .filter(req => (req.type || 'withdrawal') === 'withdrawal' && (req.status || 'pending') === 'pending');
};

const checkPendingWithdrawal = async (userId) => {
    try {
        const pendingQuery = query(
            collection(db, `artifacts/${appId}/public/data/fund_requests`),
            where("userId", "==", userId),
            where("status", "==", "pending")
        );
        const snapshot = await getDocs(pendingQuery);
        return !snapshot.empty;
    } catch (e) {
        console.error("Error checking pending withdrawal:", e);
        return false;
    }
};

const isWithdrawMethodDetailsComplete = (method) => {
    const details = getProfilePaymentDetails(method);
    if (method === 'upi') return !!String(details.upiId || '').trim();
    if (method === 'bank') {
        return ['accountNumber', 'ifsc', 'bankName', 'accountName'].every(key => !!String(details[key] || '').trim());
    }
    if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
        return !!String(details.email || '').trim();
    }
    return false;
};

const showWithdrawDetailsMissingModal = (method, methodName) => {
    renderModal('Update Withdraw Method',
        `<div class="space-y-3">
                    <div class="rounded-2xl border border-yellow-100 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-4">
                        <p class="text-sm font-bold text-yellow-800 dark:text-yellow-100">${escapeHtml(methodName)} details are missing.</p>
                        <p class="text-sm text-yellow-700 dark:text-yellow-200 mt-1">Please update your withdraw method first, then request withdrawal.</p>
                    </div>
                </div>`,
        `<button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
                 <button id="set-withdraw-method-now-btn" class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Set Now</button>`,
        'max-w-sm');
    document.getElementById('set-withdraw-method-now-btn').onclick = () => {
        window.closeModal();
        showProfilePage(method);
    };
};

const getWithdrawalTransactions = () => unifiedHistoryCache.filter(item => {
    if (item.status && item.status !== 'completed') return false;
    return normalizeTransactionType(item) === 'withdrawal';
});

const getInvoiceGroupsFromHistory = () => {
    const transactions = (window.unifiedHistoryCache || []).filter(item => {
        if (item.status && item.status !== 'completed' && item.status !== 'approved') return false;
        const type = normalizeTransactionType(item);

        if (type !== 'credit') return false;

        const comment = String(item.comment || item.remarks || '').toLowerCase();
        const typeStr = String(item.type || '').toLowerCase();

        if (comment.includes('deposit') || comment.includes('manual') || comment.includes('admin credit') || comment.includes('admin debit')) return false;
        if (comment.includes('loan') || comment.includes('repayment')) return false;
        if (comment.includes('transfer') || typeStr.includes('transfer')) return false;
        if (comment.includes('refund')) return false;
        if (comment.includes('signup') || comment.includes('referral') || comment.includes('bonus')) return false;

        return true;
    });

    const groups = {};
    const today = new Date();

    transactions.forEach(item => {
        const date = getSafeDate(item.timestamp || item.createdAt);
        if (!date) return;

        const year = date.getFullYear();
        const month = date.getMonth();

        let targetGenYear = year;
        let targetGenMonth = month + 1;
        if (targetGenMonth > 11) {
            targetGenMonth = 0;
            targetGenYear += 1;
        }

        const genDate = new Date(targetGenYear, targetGenMonth, 7, 0, 0, 0);
        if (today < genDate) {
            return;
        }

        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        if (!groups[key]) {
            groups[key] = {
                key,
                year,
                month,
                monthName: `${shortMonthNames[month]} ${year}`,
                shortMonth: shortMonthNames[month],
                invoiceId: `INV-${shortMonthNames[month].toUpperCase()}-${year}-${String(Math.abs(item.transactionId || item.id || 1000)).slice(-4)}`,
                total: 0,
                tasksCompleted: 0,
                totalTransactions: 0,
                generatedDate: `07 ${shortMonthNames[targetGenMonth]} ${targetGenYear}`,
                paymentMethod: "Deposit in RW Wallet",
                status: "Paid",
                breakup: {
                    review: { amount: 0, pct: "0%" },
                    other: { amount: 0, pct: "0%" }
                },
                rawItems: []
            };
        }

        const amount = Math.abs(Number(item.amount || item.chargeAmount || 0));
        groups[key].total += amount;
        groups[key].totalTransactions += 1;

        const itemName = item.comment || item.remarks || item.type || 'Task Reward';
        const isReview = String(itemName).toLowerCase().includes('review') || String(item.type || '').toLowerCase().includes('review');

        groups[key].rawItems.push({
            date: formatDateDDMMYY(item.timestamp || item.createdAt),
            name: itemName,
            rate: amount,
            approved: 1,
            amount: amount,
            isReview: isReview
        });
    });

    const result = Object.values(groups).map(g => {
        g.rawItems.sort((a, b) => b.date.localeCompare(a.date));

        const aggregated = {};
        g.rawItems.forEach(item => {
            const aggKey = `${item.name}-${item.rate}`;
            if (!aggregated[aggKey]) {
                aggregated[aggKey] = {
                    date: item.date,
                    name: item.name,
                    rate: item.rate,
                    approved: 0,
                    amount: 0,
                    isReview: item.isReview
                };
            }
            aggregated[aggKey].approved += 1;
            aggregated[aggKey].amount += item.amount;
        });

        const itemsList = Object.values(aggregated);
        g.tasksCompleted = itemsList.reduce((acc, item) => acc + item.approved, 0);

        g.pages = [];
        for (let i = 0; i < itemsList.length; i += 18) {
            g.pages.push(itemsList.slice(i, i + 18));
        }
        if (g.pages.length === 0) {
            g.pages.push([]);
        }

        let reviewSum = 0;
        let otherSum = 0;
        itemsList.forEach(item => {
            if (item.isReview) {
                reviewSum += item.amount;
            } else {
                otherSum += item.amount;
            }
        });

        g.breakup.review.amount = reviewSum;
        g.breakup.other.amount = otherSum;

        const total = g.total || 1;
        g.breakup.review.pct = `${((reviewSum / total) * 100).toFixed(1)}%`;
        g.breakup.other.pct = `${((otherSum / total) * 100).toFixed(1)}%`;

        return g;
    });

    return result.sort((a, b) => b.key.localeCompare(a.key));
};

const showWithdrawalInvoicesPage = () => {
    const invoiceGroups = getInvoiceGroupsFromHistory();
    const currentYear = new Date().getFullYear();
    const invoicesCurrentYear = invoiceGroups.filter(inv => inv.year === currentYear);
    const invoicesOlder = invoiceGroups.filter(inv => inv.year < currentYear);

    const content = `
                ${getPageHeader('Invoice')}
                <div class="max-w-xl mx-auto space-y-4 pb-24 px-4 text-left select-none">
                    <!-- Banner Card -->
                    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 p-5 text-white shadow-lg border border-indigo-950/20">
                        <div class="flex justify-between items-center">
                            <div class="space-y-1">
                                <p class="text-[10px] font-black uppercase text-indigo-300 tracking-wider">INVOICE & STATEMENTS</p>
                                <h3 class="text-xl font-extrabold tracking-tight">Monthly Invoices</h3>
                                <p class="text-xs text-indigo-200/80 leading-relaxed mt-1 max-w-[200px]">View and download your monthly reports and invoices.</p>
                            </div>
                            <div class="text-indigo-300 shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-11 h-11 opacity-90 drop-shadow-sm">
                                    <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 0 1 3.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 0 1 3.75 3.75v7.875c0 1.104-.896 2-2 2H5.625a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2Zm12.938 7.5H16.5a1.875 1.875 0 0 0-1.875-1.875V3.938L18.562 9Z" clip-rule="evenodd" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    ${invoiceGroups.length === 0 ? `
                        <div class="flex flex-col items-center justify-center py-12 px-4 text-center space-y-4">
                            <div class="h-16 w-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-500 border border-indigo-100/50 dark:border-indigo-900/50 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-8 h-8 opacity-80">
                                  <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 0 1 3.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 0 1 3.75 3.75v7.875c0 1.104-.896 2-2 2H5.625a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2Zm12.938 7.5H16.5a1.875 1.875 0 0 0-1.875-1.875V3.938L18.562 9Z" clip-rule="evenodd" />
                                </svg>
                            </div>
                            <div class="space-y-1">
                                <h4 class="text-sm font-black text-gray-800 dark:text-white">No Invoices Available</h4>
                                <p class="text-xs text-gray-550 dark:text-gray-400 max-w-[260px] leading-relaxed">Invoices are automatically generated on the 7th day of every month for the previous month's completed task earnings.</p>
                            </div>
                        </div>
                    ` : `
                        <!-- Current Year Invoices Section -->
                        ${invoicesCurrentYear.length === 0 ? '' : `
                            <div class="space-y-3">
                                <h4 class="text-sm font-black text-gray-800 dark:text-white px-1">${currentYear} Invoices</h4>
                                <div class="space-y-2.5">
                                    ${invoicesCurrentYear.map(inv => `
                                        <button type="button" data-invoice-key="${inv.key}" class="invoice-item-card w-full flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 rounded-2xl shadow-sm hover:shadow-md transition active:scale-[0.99]" style="outline: none;">
                                            <div class="flex items-center gap-3.5">
                                                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/50 shadow-sm">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6.5 h-6.5">
                                                        <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 0 1 3.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 0 1 3.75 3.75v7.875c0 1.104-.896 2-2 2H5.625a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2Zm12.938 7.5H16.5a1.875 1.875 0 0 0-1.875-1.875V3.938L18.562 9Z" clip-rule="evenodd" />
                                                    </svg>
                                                </div>
                                                <div class="text-left">
                                                    <div class="flex items-center gap-2">
                                                        <span class="text-xs font-black text-gray-900 dark:text-white">${inv.monthName}</span>
                                                        <span class="px-2 py-0.5 text-[9px] font-black rounded-full bg-emerald-50 dark:bg-emerald-950/45 text-emerald-600 dark:text-emerald-450 border border-emerald-100/60 dark:border-emerald-900/50">Paid</span>
                                                    </div>
                                                    <p class="text-[9px] text-gray-400 dark:text-gray-500 font-semibold mt-0.5">Generated on ${inv.generatedDate}</p>
                                                </div>
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-xs font-black text-gray-900 dark:text-white">₹${inv.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3.5 h-3.5 text-gray-400">
                                                  <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                                </svg>
                                            </div>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `}

                        <!-- Older Invoices Section -->
                        ${invoicesOlder.length === 0 ? '' : `
                            <div class="space-y-3">
                                <h4 class="text-sm font-black text-gray-800 dark:text-white px-1">Older Invoices</h4>
                                <button type="button" id="show-older-invoices-btn" class="w-full flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 rounded-2xl shadow-sm hover:bg-gray-55 dark:hover:bg-gray-750 transition active:scale-[0.99]" style="outline: none;">
                                    <span class="text-xs font-black text-gray-800 dark:text-white">Show Older Invoices</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-gray-500 transition-transform duration-200" id="show-older-arrow">
                                      <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                    </svg>
                                </button>
                                <div id="older-invoices-container" class="hidden space-y-2.5 mt-2">
                                    ${invoicesOlder.map(inv => `
                                        <button type="button" data-invoice-key="${inv.key}" class="invoice-item-card w-full flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 rounded-2xl shadow-sm hover:shadow-md transition active:scale-[0.99]" style="outline: none;">
                                            <div class="flex items-center gap-3.5">
                                                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/50 shadow-sm">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6.5 h-6.5">
                                                        <path fill-rule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 0 1 3.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 0 1 3.75 3.75v7.875c0 1.104-.896 2-2 2H5.625a2 2 0 0 1-2-2V3.5a2 2 0 0 1 2-2Zm12.938 7.5H16.5a1.875 1.875 0 0 0-1.875-1.875V3.938L18.562 9Z" clip-rule="evenodd" />
                                                    </svg>
                                                </div>
                                                <div class="text-left">
                                                    <div class="flex items-center gap-2">
                                                        <span class="text-xs font-black text-gray-900 dark:text-white">${inv.monthName}</span>
                                                        <span class="px-2 py-0.5 text-[9px] font-black rounded-full bg-emerald-550/20 text-emerald-450 border border-emerald-500/25">Paid</span>
                                                    </div>
                                                    <p class="text-[9px] text-gray-400 dark:text-gray-500 font-semibold mt-0.5">Generated on ${inv.generatedDate}</p>
                                                </div>
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-xs font-black text-gray-900 dark:text-white">₹${inv.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3.5 h-3.5 text-gray-400">
                                                  <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                                </svg>
                                            </div>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                        `}
                    `}

                    <!-- Info Box -->
                    <div class="flex gap-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/50 p-4 rounded-2xl">
                        <div class="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                              <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 1 1 1.05-.018l-.05.022zm-.5 1.5H12V16.5h.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                            </svg>
                        </div>
                        <p class="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 leading-relaxed">Invoices are generated on 7th day of every month for the previous month.</p>
                    </div>
                </div>
                ${getPageFooter()}`;

    showPage(content, { onBack: showSettingsPage });

    document.querySelectorAll('.invoice-item-card').forEach(btn => {
        btn.onclick = () => showWithdrawalInvoiceDetails(btn.dataset.invoiceKey);
    });

    const olderBtn = document.getElementById('show-older-invoices-btn');
    if (olderBtn) {
        olderBtn.onclick = () => {
            const container = document.getElementById('older-invoices-container');
            const arrow = document.getElementById('show-older-arrow');
            if (container && arrow) {
                const isHidden = container.classList.contains('hidden');
                if (isHidden) {
                    container.classList.remove('hidden');
                    arrow.classList.add('rotate-180');
                } else {
                    container.classList.add('hidden');
                    arrow.classList.remove('rotate-180');
                }
            }
        };
    }
};

const showWithdrawalInvoiceDetails = (invoiceKey) => {
    const invoiceGroups = getInvoiceGroupsFromHistory();
    const inv = invoiceGroups.find(item => item.key === invoiceKey);
    if (!inv) return showNotification('Invoice not found.', true);

    const shortMonth = inv.shortMonth || 'Jul';
    const year = inv.year || 2026;
    const lastDay = new Date(year, inv.month !== undefined ? inv.month + 1 : 7, 0).getDate();
    const statementPeriod = `01 ${shortMonth} - ${lastDay} ${shortMonth} ${year}`;

    const content = `
                ${getPageHeader('Invoice Details')}
                <div class="max-w-xl mx-auto space-y-4 pb-24 px-4 text-left select-none">
                    
                    <!-- Banner Card -->
                    <div class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 p-5 text-white shadow-lg border border-indigo-950/20">
                        <div class="flex justify-between items-start">
                            <div class="space-y-1">
                                <h3 class="text-xl font-extrabold tracking-tight">${inv.monthName} Invoice</h3>
                                <p class="text-[10px] font-bold text-indigo-200/80 mt-0.5">Invoice ID: ${inv.invoiceId}</p>
                                <div class="mt-2.5">
                                    <span class="px-2.5 py-0.5 text-[9px] font-black rounded-full bg-emerald-550/20 text-emerald-450 border border-emerald-500/25">Paid</span>
                                </div>
                            </div>
                            <div class="text-indigo-400 shrink-0">
                                <svg class="h-10 w-10 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <!-- Invoice Summary Card -->
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-150 dark:border-gray-700/50 space-y-3.5">
                        <h4 class="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-wider">Invoice Summary</h4>
                        <div class="space-y-2.5 text-xs">
                            <div class="flex justify-between py-0.5">
                                <span class="font-bold text-gray-500 dark:text-gray-450">Month</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${inv.monthName}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Statement Period</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${statementPeriod}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Total Earnings</span>
                                <span class="font-black text-gray-900 dark:text-white text-sm">₹${inv.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Total Tasks Completed</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${inv.tasksCompleted}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Total Transactions</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${inv.totalTransactions}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Invoice Date</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${inv.generatedDate}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Payment Method</span>
                                <span class="font-extrabold text-gray-900 dark:text-white">${inv.paymentMethod}</span>
                            </div>
                            <div class="flex justify-between py-0.5 border-t border-gray-50 dark:border-gray-750/30 pt-2.5 items-center">
                                <span class="font-bold text-gray-500 dark:text-gray-455">Status</span>
                                <span class="px-2 py-0.5 text-[10px] font-black rounded bg-emerald-550/20 text-emerald-450 border border-emerald-500/25">Paid</span>
                            </div>
                        </div>
                    </div>

                    <!-- Earnings Breakup Section -->
                    <div class="space-y-2.5">
                        <h4 class="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-wider px-1">Overview (Earnings Breakup)</h4>
                        <div class="grid grid-cols-2 gap-2.5">
                            <!-- Review Tasks -->
                            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-750 p-3 rounded-2xl text-center space-y-1.5 shadow-sm">
                                <div class="flex justify-center text-indigo-600 dark:text-indigo-400">
                                    <div class="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/50 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6.5 h-6.5">
                                            <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.748-5.25Z" clip-rule="evenodd" />
                                        </svg>
                                    </div>
                                </div>
                                <p class="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wide">Review Tasks</p>
                                <p class="text-xs font-black text-gray-900 dark:text-white">₹${inv.breakup.review.amount.toLocaleString('en-IN')}</p>
                                <p class="text-[9px] font-bold text-gray-400 dark:text-gray-500">${inv.breakup.review.pct}</p>
                            </div>

                            <!-- Other Tasks -->
                            <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-750 p-3 rounded-2xl text-center space-y-1.5 shadow-sm">
                                <div class="flex justify-center text-indigo-600 dark:text-indigo-400">
                                    <div class="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/50 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6.5 h-6.5">
                                            <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 9a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V15a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V9Z" clip-rule="evenodd" />
                                        </svg>
                                    </div>
                                </div>
                                <p class="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wide">Other Tasks</p>
                                <p class="text-xs font-black text-gray-900 dark:text-white">₹${inv.breakup.other.amount.toLocaleString('en-IN')}</p>
                                <p class="text-[9px] font-bold text-gray-400 dark:text-gray-500">${inv.breakup.other.pct}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Actions Section -->
                    <div class="space-y-3 pt-2">
                        <h4 class="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-wider px-1">Actions</h4>
                        <div class="space-y-2.5">
                            <button type="button" id="download-invoice-pdf-btn" class="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] py-3 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md shadow-indigo-600/30" style="background-color: #4f46e5 !important; color: #ffffff !important; outline: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-white">
                                    <path fill-rule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v11.59l3.97-3.97a.75.75 0 1 1 1.06 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0l-5.25-5.25a.75.75 0 1 1 1.06-1.06l3.97 3.97V3a.75.75 0 0 1 .75-.75ZM3.75 19.5a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75Z" clip-rule="evenodd" />
                                </svg>
                                <span class="text-white font-bold">Download PDF</span>
                            </button>
                            <button type="button" id="view-invoice-preview-btn" class="w-full rounded-xl border-2 border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 active:scale-[0.98] py-2.5 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center gap-2 transition shadow-xs" style="outline: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-indigo-600 dark:text-indigo-400">
                                    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                                    <path fill-rule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clip-rule="evenodd" />
                                </svg>
                                <span>View Invoice Preview</span>
                            </button>
                        </div>
                    </div>

                </div>
                ${getPageFooter()}`;

    showPage(content, { onBack: showWithdrawalInvoicesPage });

    document.getElementById('download-invoice-pdf-btn').onclick = () => downloadMockInvoicePdf(inv);
    document.getElementById('view-invoice-preview-btn').onclick = () => showInvoicePreviewPage(inv);
};

const showInvoicePreviewPage = (inv) => {
    window.currentInvoicePreviewPage = 0;

    const renderPreviewTable = () => {
        const pageIdx = window.currentInvoicePreviewPage;
        const pageItems = inv.pages[pageIdx] || [];
        const isLastPage = pageIdx === inv.pages.length - 1;

        let rowsHtml = '';
        pageItems.forEach((item, index) => {
            const rowNumber = pageIdx * 18 + index + 1;
            rowsHtml += `
                        <tr class="border-b border-gray-100 dark:border-gray-800 text-[10px]">
                            <td class="px-3 py-2 text-gray-500 font-semibold">${rowNumber}</td>
                            <td class="px-3 py-2 text-gray-650 dark:text-gray-400">${item.date}</td>
                            <td class="px-3 py-2 font-bold text-gray-800 dark:text-gray-200 truncate max-w-[140px]">${item.name}</td>
                            <td class="px-3 py-2 text-gray-650 dark:text-gray-400">₹${item.rate.toFixed(2)}</td>
                            <td class="px-3 py-2 text-gray-700 dark:text-gray-300 font-bold">${item.approved}</td>
                            <td class="px-3 py-2 font-black text-gray-900 dark:text-white">₹${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                    `;
        });

        let totalRowHtml = '';
        if (isLastPage) {
            totalRowHtml = `
                        <tr class="bg-indigo-50/45 dark:bg-indigo-950/20 font-black text-[10px] text-indigo-900 dark:text-indigo-300">
                            <td colspan="4" class="px-3 py-2.5 text-left uppercase tracking-wider">TOTAL</td>
                            <td class="px-3 py-2.5">${inv.tasksCompleted}</td>
                            <td class="px-3 py-2.5">₹${inv.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                    `;
        }

        const tableBody = document.getElementById('preview-table-body');
        if (tableBody) {
            tableBody.innerHTML = rowsHtml + totalRowHtml;
        }

        const pageIndicator = document.getElementById('preview-page-indicator');
        if (pageIndicator) {
            pageIndicator.textContent = `${pageIdx + 1}/${inv.pages.length}`;
        }

        const prevBtn = document.getElementById('preview-prev-btn');
        if (prevBtn) {
            prevBtn.disabled = pageIdx === 0;
            prevBtn.className = `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 transition active:scale-90 ${pageIdx === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-indigo-600'}`;
        }

        const nextBtn = document.getElementById('preview-next-btn');
        if (nextBtn) {
            nextBtn.disabled = isLastPage;
            nextBtn.className = `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 transition active:scale-90 ${isLastPage ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-indigo-600'}`;
        }
    };

    const userName = currentUserData?.name || 'Yash Vishal';
    const userEmail = currentUserData?.email || currentUser?.email || 'yashvishal@gmail.com';
    const userPhone = currentUserData?.mobile || '+91 91234 56789';
    const userUpi = currentUserData?.upiId || currentUserData?.paymentAddress || 'yashvishal@upi';

    const shortMonth = inv.shortMonth || 'Jul';
    const year = inv.year || 2026;
    const lastDay = new Date(year, inv.month !== undefined ? inv.month + 1 : 7, 0).getDate();
    const statementPeriod = `01 ${shortMonth} ${year} - ${lastDay} ${shortMonth} ${year}`;

    const content = `
                ${getPageHeader('Invoice Preview')}
                <div class="max-w-xl mx-auto pb-24 px-4 text-left select-none space-y-5">
                    
                    <!-- Invoice Paper Container -->
                    <div class="bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-800 shadow-xl rounded-2xl p-5 md:p-6 font-sans space-y-5 text-left relative overflow-hidden">
                        
                        <!-- Logo & Stamps Row -->
                        <div class="flex justify-between items-start gap-4">
                            <div class="space-y-1">
                                <div class="flex items-center gap-2">
                                    <img src="${RW_LOGO_URL}" class="h-8 w-8 rounded-lg object-cover shadow-sm border border-gray-100 dark:border-gray-800 animate-pulse" alt="Logo">
                                    <span class="text-xs font-black tracking-tight text-gray-900 dark:text-white uppercase">REVIEWS WORLD</span>
                                </div>
                                <p class="text-[9px] font-semibold text-gray-400 dark:text-gray-500">Review Tasks, Earn Rewards, Build Your Future</p>
                            </div>
                            
                            <div class="text-right flex flex-col items-end shrink-0">
                                <h3 class="text-lg font-black tracking-wider text-indigo-600 dark:text-indigo-400 uppercase">INVOICE</h3>
                                <!-- Paid Diagonal Stamp -->
                                <div class="mt-1 border-2 border-emerald-500 text-emerald-500 text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest transform rotate-[-6deg] select-none bg-emerald-50/20">
                                    PAID
                                </div>
                            </div>
                        </div>

                        <!-- ID and Date Row -->
                        <div class="flex justify-between text-[10px] text-gray-500 border-t border-gray-100 dark:border-gray-800 pt-3.5">
                            <div>
                                <span class="font-bold">Invoice ID : </span>
                                <span class="font-extrabold text-gray-800 dark:text-gray-200">${inv.invoiceId}</span>
                            </div>
                            <div>
                                <span class="font-bold">Invoice Date : </span>
                                <span class="font-extrabold text-gray-800 dark:text-gray-200">${inv.generatedDate}</span>
                            </div>
                        </div>

                        <!-- User Details Card -->
                        <div class="overflow-hidden rounded-xl border border-gray-150 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/10">
                            <div class="bg-indigo-600 text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider">
                                User Details
                            </div>
                            <div class="p-3.5 grid grid-cols-2 gap-4 text-[10px]">
                                <div class="space-y-2.5">
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Name</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5">${escapeHtml(userName)}</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Email</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5 truncate max-w-[140px]">${escapeHtml(userEmail)}</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Phone Number</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5">${escapeHtml(userPhone)}</p>
                                    </div>
                                </div>
                                <div class="space-y-2.5">
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Payment Method</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5">Deposit in RW Wallet</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Account Details</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5 truncate max-w-[140px]">RW Digital Wallet</p>
                                    </div>
                                    <div>
                                        <p class="text-gray-400 dark:text-gray-500 font-bold">Invoice For</p>
                                        <p class="font-extrabold text-gray-800 dark:text-gray-200 mt-0.5">${statementPeriod}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Earnings Table Container -->
                        <div class="overflow-hidden rounded-xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-slate-900">
                            <div class="bg-indigo-600 text-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider">
                                Earnings Report (Task-wise)
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left border-collapse min-w-[480px]">
                                    <thead>
                                        <tr class="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-150 dark:border-gray-800 text-[9px] uppercase font-black text-gray-500 dark:text-gray-400">
                                            <th class="px-3 py-2 w-8">#</th>
                                            <th class="px-3 py-2 w-20">Date</th>
                                            <th class="px-3 py-2">Task / App Name</th>
                                            <th class="px-3 py-2 w-16">Rate (₹)</th>
                                            <th class="px-3 py-2 w-16">Approved</th>
                                            <th class="px-3 py-2 w-24 text-right pr-4">Amount (₹)</th>
                                        </tr>
                                    </thead>
                                    <tbody id="preview-table-body" class="divide-y divide-gray-50 dark:divide-gray-850">
                                        <!-- Injected dynamically -->
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Pagination row -->
                        <div class="flex items-center justify-center gap-4 pt-2">
                            <button type="button" id="preview-prev-btn" class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 transition active:scale-90 hover:bg-gray-100 dark:hover:bg-gray-800" style="outline: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-gray-600 dark:text-gray-400">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <span id="preview-page-indicator" class="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-black shadow-sm select-none">1/3</span>
                            <button type="button" id="preview-next-btn" class="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 transition active:scale-90 hover:bg-gray-100 dark:hover:bg-gray-800" style="outline: none;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 text-gray-600 dark:text-gray-400">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                        </div>

                    </div>
                    
                    <!-- Actions inside Preview -->
                    <button type="button" id="preview-download-pdf-btn" class="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] py-3 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-md shadow-indigo-600/30" style="background-color: #4f46e5 !important; color: #ffffff !important; outline: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-white">
                            <path fill-rule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v11.59l3.97-3.97a.75.75 0 1 1 1.06 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0l-5.25-5.25a.75.75 0 1 1 1.06-1.06l3.97 3.97V3a.75.75 0 0 1 .75-.75ZM3.75 19.5a.75.75 0 0 0 0 1.5h16.5a.75.75 0 0 0 0-1.5H3.75Z" clip-rule="evenodd" />
                        </svg>
                        <span class="text-white font-bold">Download PDF</span>
                    </button>
                </div>
                ${getPageFooter()}`;

    showPage(content, { onBack: () => showWithdrawalInvoiceDetails(inv.key) });

    renderPreviewTable();

    document.getElementById('preview-prev-btn').onclick = () => {
        if (window.currentInvoicePreviewPage > 0) {
            window.currentInvoicePreviewPage--;
            renderPreviewTable();
        }
    };

    document.getElementById('preview-next-btn').onclick = () => {
        if (window.currentInvoicePreviewPage < inv.pages.length - 1) {
            window.currentInvoicePreviewPage++;
            renderPreviewTable();
        }
    };

    document.getElementById('preview-download-pdf-btn').onclick = () => downloadMockInvoicePdf(inv);
};

const createMockInvoicePdf = (inv) => {
    const commands = [];
    const text = (value, x, y, size = 10, font = 'F1', color = '0 0 0') => {
        commands.push('BT', `/${font} ${size} Tf`, `${color} rg`, `${x} ${y} Td`, `(${escapePdfText(value)}) Tj`, 'ET');
    };
    const fillRect = (x, y, w, h, color) => commands.push('q', `${color} rg`, `${x} ${y} ${w} ${h} re f`, 'Q');
    const strokeRect = (x, y, w, h, color = '0.85 0.88 0.92') => commands.push('q', `${color} RG`, `${x} ${y} ${w} ${h} re S`, 'Q');
    const line = (x1, y1, x2, y2, color = '0.85 0.88 0.92') => commands.push('q', `${color} RG`, `${x1} ${y1} m ${x2} ${y2} l S`, 'Q');

    fillRect(0, 0, 595, 842, '1 1 1');

    text('REVIEWS WORLD', 78, 783, 14, 'F2', '0.1 0.1 0.1');
    text('Review Tasks, Earn Rewards, Build Your Future', 78, 770, 7, 'F1', '0.5 0.5 0.5');

    text('INVOICE', 450, 783, 20, 'F2', '0.25 0.28 0.8');

    strokeRect(450, 742, 60, 18, '0.05 0.6 0.35');
    text('PAID', 465, 747, 9, 'F2', '0.05 0.6 0.35');

    line(50, 730, 545, 730, '0.9 0.9 0.9');

    text(`Invoice ID : ${inv.invoiceId}`, 50, 715, 8, 'F1', '0.4 0.4 0.4');
    text(`Invoice Date : ${inv.generatedDate}`, 400, 715, 8, 'F1', '0.4 0.4 0.4');

    fillRect(50, 680, 495, 18, '0.25 0.28 0.8');
    text('User Details', 60, 685, 9, 'F2', '1 1 1');
    strokeRect(50, 590, 495, 90, '0.9 0.9 0.9');

    const userName = currentUserData?.name || 'Yash Vishal';
    const userEmail = currentUserData?.email || currentUser?.email || 'yashvishal@gmail.com';
    const userPhone = currentUserData?.mobile || '+91 91234 56789';
    const userUpi = currentUserData?.upiId || currentUserData?.paymentAddress || 'yashvishal@upi';

    const shortMonth = inv.shortMonth || 'Jul';
    const year = inv.year || 2026;
    const lastDay = new Date(year, inv.month !== undefined ? inv.month + 1 : 7, 0).getDate();
    const statementPeriod = `01 ${shortMonth} ${year} - ${lastDay} ${shortMonth} ${year}`;

    text('Name', 65, 660, 8, 'F1', '0.5 0.5 0.5');
    text(userName, 65, 648, 9, 'F2', '0.1 0.1 0.1');

    text('Email', 65, 630, 8, 'F1', '0.5 0.5 0.5');
    text(userEmail, 65, 618, 9, 'F2', '0.1 0.1 0.1');

    text('Phone Number', 65, 600, 8, 'F1', '0.5 0.5 0.5');
    text(userPhone, 65, 588, 9, 'F2', '0.1 0.1 0.1');

    text('Payment Method', 300, 660, 8, 'F1', '0.5 0.5 0.5');
    text('Deposit in RW Wallet', 300, 648, 9, 'F2', '0.1 0.1 0.1');

    text('Account Details', 300, 630, 8, 'F1', '0.5 0.5 0.5');
    text('RW Digital Wallet', 300, 618, 9, 'F2', '0.1 0.1 0.1');

    text('Invoice For', 300, 600, 8, 'F1', '0.5 0.5 0.5');
    text(statementPeriod, 300, 588, 9, 'F2', '0.1 0.1 0.1');

    fillRect(50, 550, 495, 18, '0.25 0.28 0.8');
    text('Earnings Report (Task-wise)', 60, 555, 9, 'F2', '1 1 1');
    strokeRect(50, 90, 495, 460, '0.9 0.9 0.9');

    fillRect(50, 528, 495, 14, '0.96 0.97 0.99');
    text('#', 60, 532, 8, 'F2', '0.4 0.4 0.4');
    text('Date', 90, 532, 8, 'F2', '0.4 0.4 0.4');
    text('Task / App Name', 160, 532, 8, 'F2', '0.4 0.4 0.4');
    text('Rate', 340, 532, 8, 'F2', '0.4 0.4 0.4');
    text('Approved', 410, 532, 8, 'F2', '0.4 0.4 0.4');
    text('Amount', 480, 532, 8, 'F2', '0.4 0.4 0.4');

    let y = 508;
    const allItems = [];
    inv.pages.forEach(p => allItems.push(...p));

    allItems.forEach((item, index) => {
        if (index % 2 === 1) {
            fillRect(51, y - 4, 493, 14, '0.97 0.98 1');
        }
        text(String(index + 1), 60, y, 7.5, 'F1', '0.3 0.3 0.3');
        text(item.date, 90, y, 7.5, 'F1', '0.3 0.3 0.3');
        text(item.name, 160, y, 7.5, 'F2', '0.15 0.15 0.15');
        text(`₹${item.rate.toFixed(2)}`, 340, y, 7.5, 'F1', '0.3 0.3 0.3');
        text(String(item.approved), 410, y, 7.5, 'F2', '0.2 0.2 0.2');
        text(`₹${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 480, y, 7.5, 'F2', '0.1 0.1 0.1');

        y -= 16;
    });

    fillRect(50, 100, 495, 18, '0.93 0.94 0.98');
    text('TOTAL', 60, 105, 8.5, 'F2', '0.25 0.28 0.8');
    text(String(inv.tasksCompleted), 410, 105, 8.5, 'F2', '0.1 0.1 0.1');
    text(`₹${inv.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 480, 105, 8.5, 'F2', '0.1 0.1 0.1');

    const objects = [];
    const addObject = (body) => {
        objects.push(body);
        return objects.length;
    };
    addObject('<< /Type /Catalog /Pages 2 0 R >>');
    addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>');
    addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const contentStream = commands.join('\n');
    addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
};

const downloadMockInvoicePdf = (inv) => {
    const blob = createMockInvoicePdf(inv);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Invoice-${inv.invoiceId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

const getPendingWithdrawalForBot = async () => {
    if (!currentUser) return null;
    try {
        const pending = await loadUserPendingWithdrawalsMerged(currentUser.uid);
        return pending[0] || null;
    } catch (error) {
        console.error('Bot pending withdrawal check failed:', error);
        return null;
    }
};

const notifyWithdrawalStatus = ({ userId, status, amount, txnId, requestId, rejectionReason = '', processedAt = Date.now() }) => {
    if (status === 'completed') {
        const title = 'Withdrawal Approved';
        const message = [
            `Your withdrawal of ${formatCurrency(amount)} has been approved.`,
            `Credited Details: ${txnId || 'Processed successfully'}`,
            `Request ID: ${requestId || 'N/A'}`,
            `Updated on: ${formatDateDDMMYY(processedAt)}`
        ].join('\n');
        sendSystemNotificationToUser({ userId, title, message });
        
        if (typeof window.sendNotification === 'function') {
            window.sendNotification(userId, title, message, { type: 'transaction' });
        }
    } else {
        const title = 'Withdrawal Rejected';
        const message = [
            `Your withdrawal of ${formatCurrency(amount)} was rejected.`,
            `Reason: ${rejectionReason || 'Not specified'}`,
            `Request ID: ${requestId || 'N/A'}`,
            `Updated on: ${formatDateDDMMYY(processedAt)}`
        ].join('\n');
        sendSystemNotificationToUser({ userId, title, message });

        if (typeof window.sendNotification === 'function') {
            window.sendNotification(userId, title, message, { type: 'transaction' });
        }
    }
};

const getWithdrawMethodLogo = (methodId) => WITHDRAW_METHOD_LOGOS[methodId] || '';

const renderWithdrawMethodLogo = (methodId, altText, extraClass = '') => {
    const logo = getWithdrawMethodLogo(methodId);
    return logo ? `<img src="${logo}" class="${extraClass || 'w-full h-full object-cover'}" alt="${altText}" loading="eager" fetchpriority="high" decoding="async">` : '';
};

const getWithdrawalMethodName = (methodId, fallback = '') => {
    const names = {
        upi: 'UPI',
        bank: 'Bank Account',
        play_store: 'Google Play Gift Card',
        amazon_gift: 'Amazon Gift Card',
        flipkart_gift: 'Flipkart Gift Card',
        paypal: 'PayPal',
        crypto: 'Crypto'
    };
    return names[methodId] || fallback || 'Withdrawal Method';
};

const normalizeWithdrawalMethodId = (item = {}) => {
    const candidates = [
        item.giftCardType,
        item.gift_card_type,
        item.giftCardName,
        item.gift_card_name,
        item.methodId,
        item.paymentMethod,
        item.withdrawMethod,
        item.withdraw_method,
        item.method,
        item.paymentDetails,
        item.comment
    ].map(value => String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_'));
    for (const raw of candidates) {
        if (!raw || raw === 'gift_card' || raw === 'gift') continue;
        if (raw.includes('upi')) return 'upi';
        if (raw.includes('bank') || raw.includes('account')) return 'bank';
        if (raw.includes('play') || raw.includes('google')) return 'play_store';
        if (raw.includes('amazon')) return 'amazon_gift';
        if (raw.includes('flipkart')) return 'flipkart_gift';
        if (raw.includes('paypal')) return 'paypal';
    }
    if (item.upiId) return 'upi';
    if (item.accountNumber || item.ifsc) return 'bank';
    if (item.email || item.paymentEmail) return 'paypal';
    return candidates.find(Boolean) || '';
};

const getWithdrawalDisplayMethodName = (item = {}, fallback = 'N/A') => {
    const methodId = normalizeWithdrawalMethodId(item);
    const knownMethodIds = ['upi', 'bank', 'play_store', 'amazon_gift', 'flipkart_gift', 'paypal', 'crypto'];
    const specificName = knownMethodIds.includes(methodId) ? getWithdrawalMethodName(methodId, '') : '';
    const rawName = String(item.method || item.paymentMethod || fallback || '').trim();
    if (specificName && !['gift card', 'gift_card', 'withdrawal method'].includes(rawName.toLowerCase())) {
        return specificName;
    }
    if (!specificName && ['gift card', 'gift_card'].includes(rawName.toLowerCase())) {
        return 'Gift Card - type not saved';
    }
    return specificName || rawName || fallback;
};

const getWithdrawalDetailText = (item = {}) => {
    const methodId = normalizeWithdrawalMethodId(item);
    const details = item.paymentDetails && typeof item.paymentDetails === 'object' ? item.paymentDetails : {};
    const detailText = typeof item.paymentDetails === 'string' ? item.paymentDetails : '';
    if (methodId === 'upi') return item.upiId || item.paymentDetails || 'N/A';
    if (methodId === 'bank') {
        return [
            (item.accountNumber || details.accountNumber) ? `A/C: ${item.accountNumber || details.accountNumber}` : '',
            (item.ifsc || details.ifsc) ? `IFSC: ${item.ifsc || details.ifsc}` : '',
            item.bankName || details.bankName || '',
            (item.accountName || details.accountName) ? `Name: ${item.accountName || details.accountName}` : ''
        ].filter(Boolean).join(' | ') || detailText || 'N/A';
    }
    if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(methodId)) {
        return item.email || item.paymentEmail || details.email || detailText || 'N/A';
    }
    return detailText || item.upiId || item.accountNumber || item.email || item.paymentEmail || 'N/A';
};

const renderPayoutDetailPills = (item = {}) => {
    const methodId = normalizeWithdrawalMethodId(item);
    const details = item.paymentDetails && typeof item.paymentDetails === 'object' ? item.paymentDetails : {};
    
    if (methodId === 'bank') {
        const accNum = item.accountNumber || details.accountNumber || '';
        const ifsc = item.ifsc || details.ifsc || '';
        const accName = item.accountName || details.accountName || '';
        const bankName = item.bankName || details.bankName || '';

        const pills = [];
        if (accNum) {
            const val = escapeHtml(accNum);
            pills.push(`
                <div class="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-md text-xs font-bold text-indigo-700 dark:text-indigo-300">
                    <span>A/C: ${val}</span>
                    <button data-action="copy-text" data-text="${val}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition text-indigo-600 dark:text-indigo-300" title="Copy Account Number">
                        <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                </div>
            `);
        }
        if (ifsc) {
            const val = escapeHtml(ifsc);
            pills.push(`
                <div class="inline-flex items-center gap-1.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-800/60 px-2.5 py-1 rounded-md text-xs font-bold text-purple-700 dark:text-purple-300">
                    <span>IFSC: ${val}</span>
                    <button data-action="copy-text" data-text="${val}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-purple-200 dark:hover:bg-purple-800 transition text-purple-600 dark:text-purple-300" title="Copy IFSC">
                        <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                </div>
            `);
        }
        if (accName) {
            const val = escapeHtml(accName);
            pills.push(`
                <div class="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 px-2.5 py-1 rounded-md text-xs font-bold text-slate-700 dark:text-slate-200">
                    <span>Name: ${val}</span>
                    <button data-action="copy-text" data-text="${val}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition text-slate-600 dark:text-slate-300" title="Copy Name">
                        <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                </div>
            `);
        }
        if (bankName) {
            const val = escapeHtml(bankName);
            pills.push(`
                <div class="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 px-2.5 py-1 rounded-md text-xs font-bold text-slate-600 dark:text-slate-300">
                    <span>Bank: ${val}</span>
                </div>
            `);
        }
        if (pills.length > 0) return pills.join('');
    }

    const detailText = getWithdrawalDetailText(item);
    const escapedDetail = escapeHtml(detailText);
    return `
        <div class="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-md text-xs font-bold text-indigo-700 dark:text-indigo-300">
            <span>${escapedDetail}</span>
            ${detailText && detailText !== 'N/A' ? `
                <button data-action="copy-text" data-text="${escapedDetail}" class="h-5 w-5 flex items-center justify-center rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition text-indigo-600 dark:text-indigo-300" title="Copy">
                    <svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
            ` : ''}
        </div>
    `;
};

const getWithdrawalSnapshot = (data = {}) => ({
    method: getWithdrawalDisplayMethodName(data, getWithdrawalMethodName(data.methodId)),
    methodId: data.methodId || data.paymentMethod || '',
    upiId: data.upiId || '',
    accountNumber: data.accountNumber || '',
    ifsc: data.ifsc || '',
    bankName: data.bankName || '',
    accountName: data.accountName || '',
    email: data.email || '',
    paymentDetails: data.paymentDetails || ''
});

const saveUserPayoutDetailsSilently = async (method, details) => {
    if (!currentUser || !currentUser.uid) return;
    try {
        const updatedSavedDetails = {
            ...(currentUserData?.savedWithdrawalDetails || {}),
            [method]: details
        };
        const updatePayload = {
            savedWithdrawalDetails: updatedSavedDetails,
            paymentMethod: method,
            ...(method === 'upi' ? { upiId: details.upiId } : {}),
            ...(method === 'bank' ? { bankDetails: details, accountNumber: details.accountNumber, ifsc: details.ifsc, bankName: details.bankName, accountName: details.accountName } : {}),
            ...(['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method) ? { paymentEmail: details.email } : {}),
            ...(method === 'crypto' ? { cryptoAddress: details.walletAddress } : {})
        };
        currentUserData = { ...(currentUserData || {}), ...updatePayload };
        writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));
        await updateDoc(doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid), updatePayload);
    } catch (e) {
        console.warn('Auto-save payment details skipped:', e);
    }
};

const showWithdrawPage = () => {
    if (!currentUserData) return showNotification('User data not loaded. Please wait.', true);
    loadWithdrawalSettingsOnce().catch(error => console.warn('Withdrawal settings background load skipped:', error));

    if (currentUserData.isFlagged) {
        return showNotification('Your account is flagged. Please contact support.', true);
    }

    const content = `
                <style>
                    .payment-option-container .payment-option {
                        border: 2px solid transparent !important;
                        transition: all 0.15s ease-in-out;
                        -webkit-tap-highlight-color: transparent;
                        background-color: transparent !important;
                    }
                    .payment-option-container .payment-option:hover {
                        background-color: rgba(59, 130, 246, 0.04) !important;
                    }
                    .payment-option-container .payment-option.selected {
                        background-color: rgba(59, 130, 246, 0.08) !important;
                        box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.15) !important;
                    }
                </style>
                ${getPageHeader('Withdraw Funds')}
                <div class="max-w-xl mx-auto relative select-none w-full payment-option-container rounded-3xl overflow-hidden shadow-md" style="aspect-ratio: 1024 / 748;">
                    <div class="absolute inset-0 scale-[1.03] origin-center transform-gpu">
                        <img src="/assets/images/withdraw_methods_layout.jpg" class="w-full h-full object-cover [image-rendering:-webkit-optimize-contrast]" alt="Withdraw Methods" loading="eager" fetchpriority="high">
                        
                        <!-- Clickable hotspot overlays -->
                        <div class="absolute inset-0">
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 6.25%; top: 27.27%; width: 20.7%; height: 28.88%;" data-method="upi" title="UPI"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 28.91%; top: 27.27%; width: 20.7%; height: 28.88%;" data-method="bank" title="Bank Transfer"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 51.37%; top: 27.27%; width: 20.7%; height: 28.88%;" data-method="play_store" title="Google Play Gift Card"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 73.83%; top: 27.27%; width: 20.7%; height: 28.88%;" data-method="amazon_gift" title="Amazon Gift Card"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 6.25%; top: 59.89%; width: 20.7%; height: 28.88%;" data-method="flipkart_gift" title="Flipkart Gift Card"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 28.91%; top: 59.89%; width: 20.7%; height: 28.88%;" data-method="paypal" title="PayPal"></div>
                            <div class="payment-option absolute cursor-pointer rounded-[32px]" style="left: 51.37%; top: 59.89%; width: 20.7%; height: 28.88%;" data-method="crypto" data-coming-soon="true" title="Crypto Currency"></div>
                        </div>
                    </div>
                </div>
                ${getPageFooter()}`;
    showPage(content);

    document.querySelectorAll('.payment-option').forEach(option => {
        option.addEventListener('click', function () {
            if (this.dataset.comingSoon === 'true') {
                showNotification('Coming soon...', true);
                return;
            }
            document.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');
            const method = this.dataset.method;
            showWithdrawAmountPage(method);
        });
    });

    loadUserPendingWithdrawalsMerged(currentUser.uid)
        .then((pendingWithdrawals) => {
            const pendingWithdrawalCount = pendingWithdrawals.length;
            if (pendingWithdrawalCount >= maxPendingWithdrawalsPerUser && document.getElementById('page-container')?.textContent.includes('Choose Withdrawal Method')) {
                showNotification(`You already have ${pendingWithdrawalCount} pending withdrawal request(s).`, true);
                hidePage();
            }
        })
        .catch(error => console.warn('Pending withdrawal background check skipped:', error));
};

const showWithdrawAmountPage = async (method) => {
    activeWithdrawMethod = method;
    try {
        await loadWithdrawalSettingsOnce(true);
    } catch (e) {
        console.warn('Withdrawal settings load skipped:', e);
    }
    const methodName = getWithdrawalDisplayMethodName(method, getWithdrawalMethodName(method));
    const minForMethod = getMinWithdrawalForMethod(method);
    const existingDetails = typeof getProfilePaymentDetails === 'function' ? getProfilePaymentDetails(method) : {};

    let detailInputsHtml = '';
    if (method === 'upi') {
        const val = escapeHtml(existingDetails.upiId || '');
        detailInputsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold text-gray-700 dark:text-gray-200">UPI ID Details</label>
                <input type="text" id="withdraw-input-upiId" placeholder="e.g. 9876543210@paytm / user@ybl" value="${val}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
            </div>
        `;
    } else if (method === 'bank') {
        const accNum = escapeHtml(existingDetails.accountNumber || '');
        const ifsc = escapeHtml(existingDetails.ifsc || '');
        const accName = escapeHtml(existingDetails.accountName || currentUserData?.name || '');
        const bankName = escapeHtml(existingDetails.bankName || '');

        detailInputsHtml = `
            <div class="space-y-2.5">
                <div class="space-y-1">
                    <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Account Number</label>
                    <input type="text" id="withdraw-input-accountNumber" placeholder="Enter Bank Account Number" value="${accNum}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold text-gray-700 dark:text-gray-200">IFSC Code</label>
                    <input type="text" id="withdraw-input-ifsc" placeholder="e.g. HDFC0001234" value="${ifsc}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white uppercase outline-none focus:border-blue-500">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Account Holder Name</label>
                    <input type="text" id="withdraw-input-accountName" placeholder="Name as per Bank" value="${accName}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Bank Name (Optional)</label>
                    <input type="text" id="withdraw-input-bankName" placeholder="e.g. HDFC Bank, SBI" value="${bankName}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
                </div>
            </div>
        `;
    } else if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
        const val = escapeHtml(existingDetails.email || currentUserData?.email || '');
        detailInputsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Recipient Email Address</label>
                <input type="email" id="withdraw-input-email" placeholder="Enter email address" value="${val}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
            </div>
        `;
    } else if (method === 'crypto') {
        const val = escapeHtml(existingDetails.walletAddress || '');
        detailInputsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Crypto Wallet Address</label>
                <input type="text" id="withdraw-input-walletAddress" placeholder="Enter USDT/BTC Wallet Address" value="${val}" class="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-semibold text-gray-900 dark:text-white outline-none focus:border-blue-500">
            </div>
        `;
    }

    const content = `
                ${getPageHeader(`Withdraw to ${methodName}`)}
                <div class="max-w-md mx-auto bg-white dark:bg-gray-800 p-5 sm:p-6 rounded-2xl shadow-md space-y-5">
                    <div class="flex items-center gap-3 bg-blue-50/60 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-100 dark:border-blue-900/50">
                        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-white dark:bg-gray-700 shadow-xs">
                            ${renderWithdrawMethodLogo(method, methodName)}
                        </div>
                        <div>
                            <h3 class="text-sm font-bold text-gray-900 dark:text-white">${methodName}</h3>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Enter amount and payout details below.</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <div class="flex justify-between items-center mb-1">
                                <label class="text-xs font-bold text-gray-700 dark:text-gray-200">Amount to Withdraw (₹)</label>
                                <span class="text-xs font-semibold text-emerald-600">Available: ₹${Number(currentUserData?.balance || 0).toFixed(2)}</span>
                            </div>
                            <input type="number" id="withdraw-amount-input" placeholder="Enter amount (min ₹${minForMethod})" min="${minForMethod}" class="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-base font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500">
                            
                            <div class="flex gap-2 mt-2">
                                <button type="button" class="quick-amount-btn flex-1 py-1 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 text-gray-700 dark:text-gray-200 transition" data-amount="100">₹100</button>
                                <button type="button" class="quick-amount-btn flex-1 py-1 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 text-gray-700 dark:text-gray-200 transition" data-amount="200">₹200</button>
                                <button type="button" class="quick-amount-btn flex-1 py-1 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 text-gray-700 dark:text-gray-200 transition" data-amount="500">₹500</button>
                                <button type="button" class="quick-amount-btn flex-1 py-1 text-xs font-bold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 text-gray-700 dark:text-gray-200 transition" data-amount="1000">₹1000</button>
                            </div>
                            <p id="withdraw-min-helper" class="text-[11px] text-gray-400 mt-1">Minimum withdrawal: ₹${minForMethod}</p>
                        </div>

                        <div class="pt-3 border-t border-gray-100 dark:border-gray-700">
                            ${detailInputsHtml}
                        </div>
                    </div>

                    <button id="confirm-withdraw-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl shadow transition">Proceed to Withdraw</button>
                </div>
                ${getPageFooter()}`;

    showPage(content);

    document.querySelectorAll('.quick-amount-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const input = document.getElementById('withdraw-amount-input');
            if (input) input.value = this.dataset.amount;
        });
    });

    document.getElementById('confirm-withdraw-btn').onclick = () => {
        const amount = parseFloat(document.getElementById('withdraw-amount-input')?.value);
        let newPayoutDetails = {};
        if (method === 'upi') {
            const upiId = document.getElementById('withdraw-input-upiId')?.value.trim();
            if (!upiId) return showNotification('Please enter your UPI ID.', true);
            newPayoutDetails = { upiId };
        } else if (method === 'bank') {
            const accountNumber = document.getElementById('withdraw-input-accountNumber')?.value.trim();
            const ifsc = document.getElementById('withdraw-input-ifsc')?.value.trim().toUpperCase();
            const accountName = document.getElementById('withdraw-input-accountName')?.value.trim();
            const bankName = document.getElementById('withdraw-input-bankName')?.value.trim();
            if (!accountNumber) return showNotification('Please enter Bank Account Number.', true);
            if (!ifsc) return showNotification('Please enter IFSC Code.', true);
            newPayoutDetails = { accountNumber, ifsc, accountName, bankName };
        } else if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
            const email = document.getElementById('withdraw-input-email')?.value.trim();
            if (!email) return showNotification('Please enter Email Address.', true);
            newPayoutDetails = { email };
        } else if (method === 'crypto') {
            const walletAddress = document.getElementById('withdraw-input-walletAddress')?.value.trim();
            if (!walletAddress) return showNotification('Please enter Wallet Address.', true);
            newPayoutDetails = { walletAddress };
        }

        saveUserPayoutDetailsSilently(method, newPayoutDetails);
        handleWithdrawConfirmation(amount, method, methodName, newPayoutDetails);
    };
};

const handleWithdrawConfirmation = (amount, method, methodName, payoutDetails = {}) => {
    const minForMethod = getMinWithdrawalForMethod(method);
    if (isNaN(amount) || amount < minForMethod) {
        return showNotification(`Minimum withdrawal for ${methodName} is ₹${minForMethod}.`, true);
    }

    if (!currentUserData || getSpendableWalletBalance(currentUserData) < amount) {
        return showNotification(getInsufficientWalletMessage(currentUserData), true);
    }

    let methodDetails = '';
    const missingDetailText = 'N/A';
    if (method === 'upi') {
        methodDetails = payoutDetails.upiId || missingDetailText;
    } else if (method === 'bank') {
        methodDetails = payoutDetails.accountNumber || payoutDetails.bankName
            ? `A/C: ${payoutDetails.accountNumber || missingDetailText}, IFSC: ${payoutDetails.ifsc || missingDetailText}`
            : missingDetailText;
    } else {
        methodDetails = payoutDetails.email || payoutDetails.walletAddress || missingDetailText;
    }

    const walletBalance = Number(currentUserData?.balance || 0);
    const spendableBalance = getSpendableWalletBalance(currentUserData);
    const balanceAfter = spendableBalance - amount;

    renderModal('Withdrawal Request',
        `<div class="withdraw-confirm-shell">
                    <div class="withdraw-confirm-hero">
                        <span class="withdraw-confirm-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </span>
                        <p class="withdraw-confirm-kicker">Admin approval required</p>
                        <h4>Confirm withdrawal</h4>
                    </div>
                    <div class="withdraw-confirm-amount">
                        <div class="withdraw-confirm-amount-label-wrapper">
                            <div class="withdraw-confirm-amount-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3"></path>
                                </svg>
                            </div>
                            <span>Amount</span>
                        </div>
                        <strong>${formatCurrency(amount)}</strong>
                    </div>
                    <div class="withdraw-confirm-details">
                        <!-- Row 1: Method -->
                        <div class="withdraw-confirm-details-row">
                            <div class="withdraw-confirm-row-left">
                                <div class="withdraw-confirm-row-icon bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                                        <line x1="1" y1="10" x2="23" y2="10"></line>
                                    </svg>
                                </div>
                                <span>Method</span>
                            </div>
                            <strong>${escapeHtml(methodName)}</strong>
                        </div>
                        <!-- Row 2: Payout details -->
                        <div class="withdraw-confirm-details-row">
                            <div class="withdraw-confirm-row-left">
                                <div class="withdraw-confirm-row-icon bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                        <circle cx="12" cy="7" r="4"></circle>
                                    </svg>
                                </div>
                                <span>Payout details</span>
                            </div>
                            <strong>${escapeHtml(methodDetails)}</strong>
                        </div>
                    </div>
                </div>`,
        `<button onclick="window.closeModal()" class="withdraw-cancel-btn">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                         <circle cx="12" cy="12" r="10"></circle>
                         <line x1="15" y1="9" x2="9" y2="15"></line>
                         <line x1="9" y1="9" x2="15" y2="15"></line>
                     </svg>
                     Cancel
                 </button>
                 <button id="final-withdraw-btn" class="withdraw-submit-btn">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                         <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                         <polyline points="22 4 12 14.01 9 11.01"></polyline>
                     </svg>
                     Confirm
                 </button>`,
        'max-w-md', true
    );
    document.getElementById('final-withdraw-btn').onclick = async () => {
        const btn = document.getElementById('final-withdraw-btn');
        if (!btn || btn.disabled) return;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Processing...';
        try {
            await handleWithdrawRequest(amount, method, methodName);
        } finally {
            const liveBtn = document.getElementById('final-withdraw-btn');
            if (liveBtn) {
                liveBtn.disabled = false;
                liveBtn.textContent = originalText;
            }
        }
    };
};

const startLoanRepaymentAfterWithdrawalApproval = async (userId, processedAtValue = Date.now()) => {
    if (!userId) return;
    const processedAtMillis = timestampToMillis(processedAtValue) || Date.now();
    const repaymentStartDate = new Date(processedAtMillis);
    const dueDate = getNextMonthRepaymentDate(repaymentStartDate);
    const loansSnap = await getDocs(query(
        collection(db, `artifacts/${appId}/public/data/loans`),
        where("userId", "==", userId),
        where("status", "==", "active")
    ));
    const activeLoans = loansSnap.docs
        .map(docItem => ({ id: docItem.id, ...docItem.data() }))
        .filter(loan => isModernLoanRecord(loan) && isActiveLoanRecord(loan))
        .filter(loan => {
            const basis = String(loan.repaymentBasis || loan.repaymentStatus || '').toLowerCase();
            return !timestampToMillis(loan.repaymentStartedAt) || !basis.includes('withdrawal');
        });
    if (!activeLoans.length) return;

    await Promise.all(activeLoans.map(loan => updateDoc(doc(db, `artifacts/${appId}/public/data/loans`, loan.id), {
        repaymentStartedAt: Timestamp.fromDate(repaymentStartDate),
        repaymentBasis: 'withdrawal_processed',
        repaymentStatus: 'running',
        dueDate: Timestamp.fromDate(dueDate),
        lockedAmount: Number(loan.totalRepayable || 0),
        reserveStartsAt: Timestamp.fromDate(dueDate),
        updatedAt: serverTimestamp()
    })));

    const firstLoan = activeLoans[0];
    const totalFutureReserve = Number(activeLoans.reduce((sum, loan) => sum + Number(loan.totalRepayable || 0), 0).toFixed(2));
    const userMarkerUpdate = {
        activeLoanDueDate: Timestamp.fromDate(dueDate),
        activeLoanRepaymentStartedAt: Timestamp.fromDate(repaymentStartDate),
        activeLoanRepaymentBasis: 'withdrawal_processed',
        loanLockedAmount: totalFutureReserve,
        loanReserveStartsAt: Timestamp.fromDate(dueDate)
    };
    await updateDoc(doc(db, `artifacts/${appId}/public/data/users`, userId), userMarkerUpdate);

    allLoansCache = allLoansCache.map(loan => activeLoans.some(activeLoan => activeLoan.id === loan.id)
        ? {
            ...loan,
            repaymentStartedAt: repaymentStartDate.getTime(),
            repaymentBasis: 'withdrawal_processed',
            repaymentStatus: 'running',
            dueDate: dueDate.getTime(),
            lockedAmount: Number(loan.totalRepayable || 0),
            reserveStartsAt: dueDate.getTime()
        }
        : loan);
    if (currentUser?.uid === userId && currentUserData) {
        currentUserData = {
            ...currentUserData,
            ...userMarkerUpdate,
            activeLoanId: currentUserData.activeLoanId || firstLoan.id
        };
    }
};

const showWithdrawalHistoryPage = () => {
    const content = `
                ${getPageHeader('Withdrawal History')}
                <div class="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
                    <!-- Filters -->
                    <div class="mb-6 space-y-4">
                        <div class="flex flex-wrap gap-2">
                            <button data-filter="today" class="filter-btn active-filter">Today</button>
                            <button data-filter="yesterday" class="filter-btn">Yesterday</button>
                            <button data-filter="week" class="filter-btn">This Week</button>
                            <button data-filter="month" class="filter-btn">This Month</button>
                            <button data-filter="all" class="filter-btn">All Time</button>
                        </div>
                        <div class="flex flex-col sm:flex-row gap-3">
                            <div class="flex-[1.5]">
                                <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Search User</label>
                                <input type="search" id="withdrawal-history-search" placeholder="Name, mobile, email" class="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                            </div>
                            <div class="flex-1">
                                <label class="text-sm font-medium text-gray-500 dark:text-gray-400">From Date</label>
                                <input type="date" id="filter-from-date" class="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                            </div>
                            <div class="flex-1">
                                <label class="text-sm font-medium text-gray-500 dark:text-gray-400">To Date</label>
                                <input type="date" id="filter-to-date" class="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                            </div>
                            <div class="flex items-end">
                                <button id="apply-date-filter" class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Apply</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Statistics -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                            <p class="text-sm text-blue-600 dark:text-blue-400">Total Withdrawals</p>
                            <p id="total-withdrawals-count" class="text-2xl font-bold">0</p>
                        </div>
                        <div class="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                            <p class="text-sm text-green-600 dark:text-green-400">Approved</p>
                            <p id="approved-withdrawals-count" class="text-2xl font-bold">0</p>
                        </div>
                        <div class="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                            <p class="text-sm text-red-600 dark:text-red-400">Rejected</p>
                            <p id="rejected-withdrawals-count" class="text-2xl font-bold">0</p>
                        </div>
                    </div>
                    
                    <!-- Withdrawal History List -->
                    <div id="withdrawal-history-list" class="max-h-[60vh] overflow-y-auto"></div>
                </div>
                ${getPageFooter()}`;
    showPage(content);

    // Set today as default active
    document.querySelector('[data-filter="today"]').classList.add('active-filter');
    if (withdrawalHistoryCache.length) {
        renderWithdrawalHistoryList();
    } else {
        document.getElementById('withdrawal-history-list').innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-8">Loading withdrawal history...</p>';
    }
    loadWithdrawalHistory('today');
    document.getElementById('withdrawal-history-search').addEventListener('input', renderWithdrawalHistoryList);

    // Add event listeners for filters
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active-filter'));
            this.classList.add('active-filter');
            const filter = this.dataset.filter;
            loadWithdrawalHistory(filter);
        });
    });

    document.getElementById('apply-date-filter').addEventListener('click', () => {
        const fromDate = document.getElementById('filter-from-date').value;
        const toDate = document.getElementById('filter-to-date').value;
        if (fromDate && toDate) {
            loadWithdrawalHistory('custom', fromDate, toDate);
        } else {
            showNotification('Please select both from and to dates.', true);
        }
    });
};

const isWithdrawalHistorySourceRecord = (record = {}) => {
    const rawType = String(record.type || record.requestType || record.request_type || '').toLowerCase().replace(/\s+/g, '_');
    const normalizedType = normalizeTransactionType(record);
    const hasRechargeFields = !!(
        record.mobileNumber ||
        record.operator ||
        record.planDetails ||
        record.discountRate ||
        rawType.includes('recharge') ||
        normalizedType === 'mobile_recharge'
    );
    if (hasRechargeFields) return false;
    if (normalizedType === 'withdrawal' || rawType.includes('withdraw')) return true;

    // Compatibility for old withdrawal rows that stored only payout fields.
    return !rawType && !!(
        record.methodId ||
        record.paymentMethod ||
        record.paymentDetails ||
        record.upiId ||
        record.accountNumber ||
        record.ifsc ||
        record.bankName ||
        record.giftCardType
    );
};

const normalizeWithdrawalHistoryRecord = (record = {}) => {
    const sourceType = normalizeTransactionType(record);
    const requestedAt = record.requestedAt || record.timestamp || record.createdAt || record.processedAt || Date.now();
    const userProfile = allUsersCache.find(u =>
        (record.userId && u.id === record.userId) ||
        (record.userMobile && normalizePhoneDigits(getUserMobileValue(u)) === normalizePhoneDigits(record.userMobile)) ||
        (record.userEmail && u.email === record.userEmail)
    ) || {};
    return {
        ...record,
        id: record.id || record.requestId || record.request_id || record.transactionId || record.transaction_id || `${sourceType}-${timestampToMillis(requestedAt)}-${record.amount || 0}`,
        userId: record.userId || record.user_id || userProfile.id || '',
        userName: record.userName || record.senderName || record.recipientName || userProfile.name || 'N/A',
        userMobile: record.userMobile || record.mobile || getUserMobileValue(userProfile) || '',
        userEmail: record.userEmail || record.emailAddress || userProfile.email || '',
        type: 'withdrawal',
        amount: absoluteAmount(record.amount || 0),
        method: getWithdrawalDisplayMethodName(record, record.paymentMethod || 'N/A'),
        status: record.status || 'completed',
        requestedAt,
        processedAt: ['completed', 'rejected'].includes(record.status) ? (record.processedAt || null) : null
    };
};

const mergeWithdrawalHistoryRecords = (...groups) => {
    const merged = new Map();
    groups.flat().forEach((record, index) => {
        if (!record) return;
        if (!isWithdrawalHistorySourceRecord(record)) return;
        const normalized = normalizeWithdrawalHistoryRecord(record);
        const key = normalized.requestId || normalized.request_id || normalized.transactionId || normalized.transaction_id || normalized.id || `withdrawal-${timestampToMillis(normalized.requestedAt)}-${normalized.amount}-${index}`;
        const existing = merged.get(String(key)) || {};
        const requestedAtCandidates = [existing.requestedAt, existing.requested_at, existing.timestamp, normalized.requestedAt, normalized.requested_at, normalized.timestamp]
            .map(timestampToMillis)
            .filter(time => Number.isFinite(time) && time > 0);
        const requestedAt = requestedAtCandidates.length ? Math.min(...requestedAtCandidates) : normalized.requestedAt;
        merged.set(String(key), {
            ...existing,
            ...normalized,
            requestedAt,
            timestamp: requestedAt
        });
    });
    return Array.from(merged.values())
        .sort((a, b) => timestampToMillis(b.requestedAt || b.timestamp || b.processedAt) - timestampToMillis(a.requestedAt || a.timestamp || a.processedAt));
};

const loadWithdrawalHistory = async (filter = 'today', fromDate = null, toDate = null) => {
    activeWithdrawalHistoryFilter = { filter, fromDate, toDate };
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
            loadCloudFundRequests({ status: 'all', type: 'withdrawal', limit: historyLimit, timeoutMs: needsDeepHistoryScan ? 8000 : 3000 }).catch(error => {
                console.warn('Cloud withdrawal history load skipped:', error);
                return [];
            }),
            needsDeepHistoryScan
                ? loadLegacyWithdrawalTransactionsForAdmin()
                : Promise.resolve([])
        ]);
        const firebaseRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let withdrawals = mergeWithdrawalHistoryRecords(firebaseRequests, cloudRequests, legacyWithdrawals);

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
            withdrawals = withdrawals.filter(w => {
                if (!w.requestedAt) return false;
                const reqDate = getSafeDate(w.requestedAt);
                return reqDate >= today;
            });
        } else if (filter === 'yesterday') {
            withdrawals = withdrawals.filter(w => {
                if (!w.requestedAt) return false;
                const reqDate = getSafeDate(w.requestedAt);
                return reqDate >= yesterday && reqDate < today;
            });
        } else if (filter === 'week') {
            withdrawals = withdrawals.filter(w => {
                if (!w.requestedAt) return false;
                const reqDate = getSafeDate(w.requestedAt);
                return reqDate >= weekAgo;
            });
        } else if (filter === 'month') {
            withdrawals = withdrawals.filter(w => {
                if (!w.requestedAt) return false;
                const reqDate = getSafeDate(w.requestedAt);
                return reqDate >= monthAgo;
            });
        } else if (filter === 'custom' && fromDate && toDate) {
            const from = new Date(fromDate);
            const to = new Date(toDate);
            to.setDate(to.getDate() + 1); // Include the entire to date

            withdrawals = withdrawals.filter(w => {
                if (!w.requestedAt) return false;
                const reqDate = getSafeDate(w.requestedAt);
                return reqDate >= from && reqDate < to;
            });
        }
        // 'all' filter shows all withdrawals

        withdrawalHistoryCache = withdrawals;
        renderWithdrawalHistoryList();
    } catch (error) {
        console.error("Error loading withdrawal history:", error);
        showNotification('Error loading withdrawal history: ' + error.message, true);

        // Show error in the list
        const listEl = document.getElementById('withdrawal-history-list');
        if (listEl) {
            listEl.innerHTML = `
                        <div class="text-center py-8">
                            <p class="text-red-500">Error loading withdrawal history</p>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">Please check console for details</p>
                        </div>`;
        }
    }
};

const renderWithdrawalHistoryList = () => {
    const listEl = document.getElementById('withdrawal-history-list');
    if (!listEl) return;
    const search = (document.getElementById('withdrawal-history-search')?.value || '').trim().toLowerCase();
    const withdrawals = withdrawalHistoryCache.filter(w => !search || [
        w.userName,
        w.userMobile,
        w.userEmail
    ].some(value => String(value || '').toLowerCase().includes(search)));

    const totalWithdrawals = withdrawals.length;
    const approvedWithdrawals = withdrawals.filter(w => w.status === 'completed').length;
    const rejectedWithdrawals = withdrawals.filter(w => w.status === 'rejected').length;

    document.getElementById('total-withdrawals-count').textContent = totalWithdrawals;
    document.getElementById('approved-withdrawals-count').textContent = approvedWithdrawals;
    document.getElementById('rejected-withdrawals-count').textContent = rejectedWithdrawals;

    if (withdrawals.length === 0) {
        listEl.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-4">No withdrawal history found.</p>';
        return;
    }

    listEl.innerHTML = withdrawals.map(w => {
        const statusColor = w.status === 'completed' ? 'text-green-500' :
            w.status === 'rejected' ? 'text-red-500' : 'text-yellow-500';
        const statusBg = w.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30' :
            w.status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-yellow-100 dark:bg-yellow-900/30';
        const statusText = w.status === 'completed' ? 'Approved' :
            w.status === 'rejected' ? 'Rejected' : 'Pending';
        const payoutDetails = getWithdrawalDetailText(w);

        // Format date safely
        let requestDate = 'N/A';
        let requestTime = 'N/A';
        if (w.requestedAt) {
            requestDate = formatDate(w.requestedAt).split(' ')[0];
            requestTime = getTimeFromTimestamp(w.requestedAt);
        }

        return `
                        <div class="p-4 mb-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                            <div class="flex justify-between items-start mb-3">
                                <div>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200">${escapeHtml(w.userName || 'N/A')}</p>
                                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Mobile: ${escapeHtml(maskMobile(w.userMobile || ''))}</p>
                                    <p class="text-xs text-gray-500 dark:text-gray-400">Email: ${escapeHtml((w.userEmail || 'N/A').split('@')[0])}***</p>
                                </div>
                                <span class="px-2 py-1 text-xs ${statusBg} ${statusColor} rounded-full font-semibold">${statusText}</span>
                            </div>
                            
                            <div class="grid grid-cols-2 gap-3 text-sm mb-3">
                                <div class="bg-white dark:bg-gray-800 p-2 rounded">
                                    <p class="text-gray-500 dark:text-gray-400 text-xs">Amount</p>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200">${formatCurrencyAbs(w.amount)}</p>
                                </div>
                                <div class="bg-white dark:bg-gray-800 p-2 rounded">
                                    <p class="text-gray-500 dark:text-gray-400 text-xs">Method</p>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200">${escapeHtml(w.method || 'N/A')}</p>
                                </div>
                                <div class="bg-white dark:bg-gray-800 p-2 rounded">
                                    <p class="text-gray-500 dark:text-gray-400 text-xs">Payout Details</p>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200 text-sm break-words">${escapeHtml(payoutDetails)}</p>
                                </div>
                                <div class="bg-white dark:bg-gray-800 p-2 rounded">
                                    <p class="text-gray-500 dark:text-gray-400 text-xs">Date</p>
                                    <p class="font-semibold text-gray-800 dark:text-gray-200">${requestDate}</p>
                                </div>
                            </div>
                            
                            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                                <span>Requested: ${requestDate} ${requestTime}</span>
                                ${w.adminTransactionId ?
                `<span class="txn-id-badge">${w.adminTransactionId}</span>` :
                ''
            }
                            </div>
                            
                            ${w.rejectionReason ? `
                                <div class="rejection-badge mt-3">
                                    <p class="font-semibold">Rejection Reason:</p>
                                    <p class="text-sm">${escapeHtml(w.rejectionReason)}</p>
                                </div>
                            ` : ''}
                            
                            ${w.processedAt ? `
                                <div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                                    Processed: ${formatDate(w.processedAt)}
                                </div>
                            ` : ''}
                        </div>
                    `;
    }).join('');
};

const isLegacyWithdrawalRequest = (request = {}) => {
    return (request.type || 'withdrawal') === 'withdrawal';
};

const isWithdrawalBalanceDeducted = (request = {}) => {
    if (request.balanceDeducted === true || request.balance_deducted === true || request.legacyBalanceAdjusted === true || request.legacy_balance_adjusted === true) return true;
    const balanceAfter = Number(request.balanceAfter ?? request.balance_after);
    if (Number.isFinite(balanceAfter)) return true;
    return !isLegacyWithdrawalRequest(request);
};

const shouldDeductLegacyWithdrawal = (request = {}) =>
    isLegacyWithdrawalRequest(request) && !isWithdrawalBalanceDeducted(request);

const getLegacyWithdrawalTargets = () =>
    allFundRequestsCache.filter(req => (req.status || 'pending') === 'pending' && shouldDeductLegacyWithdrawal(req));

const handleSetWithdrawalGiftCardType = async (userId, requestId, methodId) => {
    const allowed = ['amazon_gift', 'play_store', 'flipkart_gift'];
    if (!allowed.includes(methodId)) return;
    const giftCardName = getWithdrawalMethodName(methodId, 'Gift Card');
    const updatePayload = {
        methodId,
        paymentMethod: methodId,
        method: giftCardName,
        giftCardType: methodId,
        giftCardName,
        updatedAt: serverTimestamp()
    };
    try {
        const reqRef = doc(db, `artifacts/${appId}/public/data/fund_requests`, requestId);
        await updateDoc(reqRef, updatePayload);
        const existing = allFundRequestsCache.find(req => req.id === requestId) || {};
        const updatedRequest = { ...existing, ...updatePayload, updatedAt: Date.now() };
        allFundRequestsCache = allFundRequestsCache.map(req => req.id === requestId ? updatedRequest : req);
        renderAdminFundRequests(allFundRequestsCache);
        updateCloudFundRequestStatus(requestId, updatedRequest.status || 'pending', updatedRequest)
            .catch(error => console.warn('Cloud gift card type update skipped:', error));
        if (userId) syncRecentTransactionsToCloud(userId).catch(error => console.warn('Gift card transaction sync skipped:', error));
        showNotification(`${giftCardName} saved for this withdrawal.`);
    } catch (error) {
        console.error('Gift card type update failed:', error);
        showNotification(`Could not save gift card type: ${error.message}`, true);
        renderAdminFundRequests(allFundRequestsCache);
    }
};

const applyLegacyWithdrawalDeduction = async (userId, requestId, requestData = {}) => {
    if (!shouldDeductLegacyWithdrawal(requestData)) return requestData;
    const amount = Number(requestData.amount || 0);
    if (!amount || amount <= 0) return requestData;

    const userRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
    const reqRef = doc(db, `artifacts/${appId}/public/data/fund_requests`, requestId);
    const cachedUser = allUsersCache.find(u => u.id === userId || u.uid === userId) || {};
    const currentBalance = Number.isFinite(Number(requestData.balanceBefore ?? requestData.balance_before))
        ? Number(requestData.balanceBefore ?? requestData.balance_before)
        : (Number.isFinite(Number(cachedUser.balance)) ? Number(cachedUser.balance) : null);
    const balanceAfter = currentBalance !== null ? Number((currentBalance - amount).toFixed(2)) : null;
    const cutTransactionId = `ADMIN-CUT-${requestId}`;
    const adjustment = {
        ...(currentBalance !== null ? { balanceBefore: currentBalance } : {}),
        ...(balanceAfter !== null ? { balanceAfter } : {}),
        balanceDeducted: true,
        legacyBalanceAdjusted: true,
        legacyBalanceAdjustedAt: serverTimestamp(),
        legacyBalanceAdjustedBy: currentUser?.uid || ADMIN_UID
    };
    const updatedRequest = { ...requestData, ...adjustment, legacyBalanceAdjustedAt: Date.now() };

    await Promise.all([
        updateDoc(userRef, { balance: increment(-amount) }),
        updateDoc(reqRef, adjustment).catch(error => {
            console.warn('Legacy withdrawal request marker skipped:', error);
        })
    ]);

    await updateCloudFundRequestStatus(requestId, 'pending', {
        ...updatedRequest,
        balanceBefore: updatedRequest.balanceBefore,
        balanceAfter: updatedRequest.balanceAfter,
        balanceDeducted: true,
        legacyBalanceAdjusted: true,
        legacyBalanceAdjustedAt: Date.now()
    });
    const debitHistory = {
        type: 'debit',
        amount,
        comment: 'Admin Debit - Pending Withdrawal Balance Cut',
        adminComment: 'Balance deducted for pending withdrawal request',
        timestamp: Date.now(),
        transactionId: cutTransactionId,
        requestId,
        method: getWithdrawalDisplayMethodName(requestData, 'Withdrawal'),
        status: 'completed',
        balanceBefore: currentBalance,
        balanceAfter,
        isAdminTransaction: true,
        isWithdrawalBalanceCut: true
    };
    await recordUserFirestoreTransaction(userId, debitHistory);
    recordCloudTransaction(userId, debitHistory).catch(error => {
        console.warn('Legacy withdrawal debit cloud history skipped:', error);
    });
    allFundRequestsCache = allFundRequestsCache.map(req => req.id === requestId ? { ...req, ...updatedRequest } : req);
    allUsersCache = allUsersCache.map(u => (u.id === userId || u.uid === userId) ? { ...u, balance: Number(u.balance || 0) - amount } : u);
    return updatedRequest;
};

const handleFixLegacyPendingWithdrawals = async () => {
    if (currentUser?.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
    const targets = getLegacyWithdrawalTargets();
    if (!targets.length) return showNotification('No pending withdrawals need balance correction.');
    const total = targets.reduce((sum, req) => sum + Number(req.amount || 0), 0);
    renderModal('Fix Uncut Pending Withdrawals',
        `<div class="space-y-3 text-sm">
                    <p>This will deduct pending withdrawal amounts that are not already marked as balance cut. Use this for old app withdrawals where balance was not deducted.</p>
                    <div class="rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
                        <p class="font-bold">${targets.length} request(s)</p>
                        <p class="text-yellow-700 dark:text-yellow-200">Total to deduct: ${formatCurrency(total)}</p>
                    </div>
                    <p class="text-xs text-gray-500 dark:text-gray-400">A completed admin debit entry will be added to each user's transaction history with before/after balance.</p>
                </div>`,
        `<button onclick="window.closeModal()" class="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg">Cancel</button>
                 <button id="confirm-legacy-withdrawal-fix-btn" class="px-4 py-2 text-sm bg-yellow-600 text-white rounded-lg">Deduct Uncut Pending</button>`,
        'max-w-md'
    );
    document.getElementById('confirm-legacy-withdrawal-fix-btn').onclick = async () => {
        const btn = document.getElementById('confirm-legacy-withdrawal-fix-btn');
        btn.disabled = true;
        btn.textContent = 'Fixing...';
        let fixed = 0;
        try {
            for (const req of targets) {
                await applyLegacyWithdrawalDeduction(req.userId, req.id, req);
                fixed++;
            }
            renderAdminFundRequests(allFundRequestsCache);
            updateLegacyWithdrawalFixSummary();
            refreshAdminDashboardCaches().catch(error => console.warn('Admin cache refresh after legacy fix skipped:', error));
            showNotification(`Fixed ${fixed} old pending withdrawal(s).`);
            window.closeModal();
        } catch (error) {
            console.error('Legacy withdrawal fix failed:', error);
            showNotification(`Error: ${error.message}`, true);
            btn.disabled = false;
            btn.textContent = 'Deduct Old Pending';
        }
    };
};

let handleWithdrawRequest = async (amount, method, methodName) => {
    if (!currentUser) return showNotification('Error: You are not logged in.', true);
    if (!currentUserData) {
        return showNotification('Your user data is still loading. Please try again.', true);
    }
    if (currentUserData.isDisabled || currentUserData.dueLoanBlocked) {
        return showNotification(currentUserData.dueLoanReason || currentUserData.banReason || 'Your account is blocked. Please contact admin.', true);
    }
    if (currentUserData.isFlagged) {
        return showNotification(currentUserData.banReason || 'Your account is flagged. Please contact admin.', true);
    }
    const resolvedMethodName = methodName || getWithdrawalMethodName(method, 'Withdrawal');

    const pendingWithdrawalCount = (await loadUserPendingWithdrawalsMerged(currentUser.uid)).length;
    if (pendingWithdrawalCount >= maxPendingWithdrawalsPerUser) {
        return showNotification(`You already have ${pendingWithdrawalCount} pending withdrawal request(s). Please wait for them to be processed.`, true);
    }

    let paymentDetails = '';
    let methodSpecificDetails = {};

    switch (method) {
        case 'upi':
            paymentDetails = getProfilePaymentDetails(method).upiId || 'Not set';
            methodSpecificDetails = { upiId: paymentDetails };
            if (amount < minWithdrawalUpi) return showNotification(`Minimum withdrawal for UPI is ₹${minWithdrawalUpi}`, true);
            break;
        case 'bank':
            const bankData = getProfilePaymentDetails(method);
            // If bank details are missing in current profile, try to fetch from user data
            const accountNumber = bankData.accountNumber || currentUserData.accountNumber || 'N/A';
            const ifsc = bankData.ifsc || currentUserData.ifsc || 'N/A';
            const bankName = bankData.bankName || currentUserData.bankName || 'N/A';
            const accountName = bankData.accountName || currentUserData.accountName || 'N/A';

            paymentDetails = `A/C: ${accountNumber}, IFSC: ${ifsc}, Name: ${accountName}`;
            methodSpecificDetails = {
                accountNumber: accountNumber,
                ifsc: ifsc,
                bankName: bankName,
                accountName: accountName
            };
            if (amount < minWithdrawalBank) return showNotification(`Minimum withdrawal for Bank is ₹${minWithdrawalBank}`, true);
            break;
        default:
            paymentDetails = getProfilePaymentDetails(method).email || 'Not set';
            methodSpecificDetails = { email: paymentDetails };
            if (['play_store', 'amazon_gift', 'flipkart_gift'].includes(method)) {
                methodSpecificDetails.giftCardType = method;
                methodSpecificDetails.giftCardName = resolvedMethodName;
            }
            if (amount < minWithdrawalRedeem) return showNotification(`Minimum withdrawal for this method is ₹${minWithdrawalRedeem}`, true);
    }

    // Anti-spam check: Verify no other pending withdrawal exists in Firestore
    try {
        const frQuery = query(
            collection(db, `artifacts/${appId}/public/data/fund_requests`),
            where("userId", "==", currentUser.uid),
            where("status", "==", "pending")
        );
        const frSnap = await getDocs(frQuery);
        if (!frSnap.empty) {
            showNotification("You already have a pending withdrawal request. Please wait for approval.", true);
            return;
        }

        // Anti-click-spam check: Verify no withdrawal submitted in the last 60 seconds
        const oneMinuteAgo = Date.now() - 60000;
        const recentQuery = query(
            collection(db, `artifacts/${appId}/public/data/fund_requests`),
            where("userId", "==", currentUser.uid),
            where("requestedAt", ">=", oneMinuteAgo)
        );
        const recentSnap = await getDocs(recentQuery);
        if (!recentSnap.empty) {
            showNotification("Please wait 60 seconds before submitting another withdrawal request.", true);
            return;
        }
    } catch (err) {
        console.warn("Spam checks skipped due to fetch error:", err);
    }

    try {
        const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
        const reqRef = doc(collection(db, `artifacts/${appId}/public/data/fund_requests`));
        const requestedAt = Date.now();
        const requestPayload = stripUndefinedFields({
            id: reqRef.id,
            userId: currentUser.uid,
            userName: currentUserData.name || 'N/A',
            userMobile: currentUserData.mobile || 'N/A',
            userEmail: currentUserData.email || 'N/A',
            type: 'withdrawal',
            amount,
            method: resolvedMethodName,
            methodId: method,
            upiId: method === 'upi' ? paymentDetails : '',
            paymentDetails,
            ...methodSpecificDetails,
            status: 'pending',
            requestedAt
        });

        await runTransaction(db, async (tx) => {
            const userDoc = await tx.get(userRef);
            if (!userDoc.exists()) throw new Error("User account not found!");

            const currentBalance = userDoc.data().balance || 0;
            if (getSpendableWalletBalance(userDoc.data()) < amount) throw new Error(getInsufficientWalletMessage(userDoc.data()));

            // 1. Deduct balance immediately
            const balanceAfter = currentBalance - amount;
            requestPayload.balanceBefore = currentBalance;
            requestPayload.balanceAfter = balanceAfter;
            tx.update(userRef, { balance: balanceAfter });

            // 2. Add fund request (with snapshot of payment details)
            const { id, ...firebaseRequestPayload } = requestPayload;
            tx.set(reqRef, stripUndefinedFields({
                ...firebaseRequestPayload,
                requestedAt: serverTimestamp()
            }));

            // 3. Add a pending transaction record for the user
            const txRef = doc(collection(userRef, 'transactions'));
            tx.set(txRef, stripUndefinedFields({
                type: 'withdrawal',
                amount: amount,
                comment: `Withdrawal Request (${resolvedMethodName})`,
                timestamp: serverTimestamp(),
                status: 'pending',
                requestId: reqRef.id,
                transactionId: generateTransactionId(),
                method: resolvedMethodName,
                methodId: method,
                // Save a snapshot of details here too
                paymentDetails: paymentDetails,
                balanceBefore: currentBalance,
                balanceAfter,
                ...methodSpecificDetails
            }));
        });

        upsertCloudFundRequest(requestPayload).catch(error => {
            console.warn('Withdrawal cloud request background sync skipped:', error);
        });
        syncRecentTransactionsToCloud(currentUser.uid).catch(error => {
            console.warn('Withdrawal transaction background sync skipped:', error);
        });
        showNotification('Withdrawal request sent to admin.', false, true);

        // Notify admins about the new withdrawal request
        if (typeof window.sendNotification === 'function') {
            const adminId = currentUserData?.parentAdmin || currentUserData?.parent_admin || ADMIN_UID;
            const notificationMsg = `User ${currentUserData?.name || 'User'} (${currentUserData?.mobile || ''}) requested ₹${amount} via ${resolvedMethodName}.`;
            window.sendNotification(adminId, 'New Withdrawal Request', notificationMsg, { type: 'admin_withdrawal' });
            if (adminId !== ADMIN_UID) {
                window.sendNotification(ADMIN_UID, 'New Withdrawal Request', notificationMsg, { type: 'admin_withdrawal' });
            }
        }

        window.closeModal();
        hidePage();
    } catch (e) {
        console.error("Withdraw request failed: ", e);
        const message = String(e?.message || '');
        const userMessage = /permission-denied|missing or insufficient permissions/i.test(message)
            ? 'Withdrawal permission is blocked for this account. Please contact admin.'
            : /resource-exhausted|quota exceeded/i.test(message)
                ? 'Database daily quota exceeded. Please try again later.'
                : /insufficient|pending|not found|minimum|flagged|blocked/i.test(message)
                    ? message
                    : 'Could not submit withdrawal request. Please try again.';
        showNotification(userMessage, true);
    }
};

const handleSaveWithdrawSettings = async () => {
    const referralReward = parseInt(document.getElementById('setting-referral-reward')?.value || '0');
    const minUpi = parseInt(document.getElementById('setting-min-upi').value);
    const minBank = parseInt(document.getElementById('setting-min-bank').value);
    const minRedeem = parseInt(document.getElementById('setting-min-redeem').value);
    const maxDay = parseInt(document.getElementById('setting-max-day').value);
    const maxPending = parseInt(document.getElementById('setting-max-pending').value);

    if (isNaN(referralReward) || referralReward < 0 || isNaN(minUpi) || isNaN(minBank) || isNaN(minRedeem) || isNaN(maxDay) || isNaN(maxPending)) {
        return showNotification('Please enter valid numbers for all settings.', true);
    }

    try {
        const isOwner = checkIsOwner(currentUser, currentUserData);
        const updatedConfig = {
            referralRewardAmount: referralReward,
            referralRewardUpdatedAt: serverTimestamp(),
            referralRewardUpdatedBy: currentUser.uid,
            min_withdrawal_upi: minUpi,
            min_withdrawal_bank: minBank,
            min_withdrawal_redeem: minRedeem,
            min_withdrawal_amount: Math.min(minUpi, minBank, minRedeem),
            max_withdrawal_per_day: maxDay,
            max_pending_withdrawals: maxPending,
            updatedAt: serverTimestamp()
        };

        if (isOwner) {
            const configRef = doc(db, `artifacts/${appId}/settings`, 'app_config');
            await setDoc(configRef, updatedConfig, { merge: true });
        } else {
            const adminConfigRef = doc(db, `artifacts/${appId}/settings`, `admin_config_${currentUser.uid}`);
            await setDoc(adminConfigRef, updatedConfig, { merge: true });
        }

        const localConfig = {
            referralRewardAmount: referralReward,
            referralRewardUpdatedAt: Date.now(),
            min_withdrawal_upi: minUpi,
            min_withdrawal_bank: minBank,
            min_withdrawal_redeem: minRedeem,
            min_withdrawal_amount: Math.min(minUpi, minBank, minRedeem),
            max_withdrawal_per_day: maxDay,
            max_pending_withdrawals: maxPending
        };
        applyAppConfig(localConfig);
        withdrawalSettingsLoadedAt = Date.now();

        showNotification('Rate settings saved successfully!');
        window.closeModal();
    } catch (e) {
        console.error("Save settings failed:", e);
        showNotification(`Error: ${e.message}`, true);
    }
};

const applyWithdrawalConfig = (config = {}) => {
    if (config.min_withdrawal_upi !== undefined) minWithdrawalUpi = Number(config.min_withdrawal_upi);
    if (config.min_withdrawal_bank !== undefined) minWithdrawalBank = Number(config.min_withdrawal_bank);
    if (config.min_withdrawal_redeem !== undefined) minWithdrawalRedeem = Number(config.min_withdrawal_redeem);
    if (config.max_withdrawal_per_day !== undefined) maxWithdrawalPerDay = Number(config.max_withdrawal_per_day);
    if (config.max_pending_withdrawals !== undefined) maxPendingWithdrawalsPerUser = Math.max(1, Number(config.max_pending_withdrawals));
    
    minWithdrawalAmount = Math.min(minWithdrawalUpi, minWithdrawalBank, minWithdrawalRedeem);

    updateMinWithdrawalInfo();
    const amountInput = document.getElementById('withdraw-amount-input');
    if (amountInput && activeWithdrawMethod) {
        const minForMethod = getMinWithdrawalForMethod(activeWithdrawMethod);
        amountInput.min = String(minForMethod);
        amountInput.placeholder = `Enter amount (min ₹${minForMethod})`;
        const helper = document.getElementById('withdraw-min-helper') || amountInput.parentElement?.querySelector('p');
        if (helper) helper.textContent = `Minimum withdrawal: ₹${minForMethod}`;
    }
};

const resolveEffectiveSubAdminId = async () => {
    if (!currentUserData) return '';
    
    // 0. If current logged-in user is a sub-admin/admin, their rates apply to themselves
    const myRole = String(currentUserData.role || '').toLowerCase();
    if (myRole === 'subadmin' || myRole === 'admin') {
        const myUid = currentUser?.uid || currentUserData.uid || currentUserData.id || '';
        if (myUid && myUid !== ADMIN_UID) return myUid;
    }

    // 1. Check parentAdmin / assigned fields
    let pAdmin = currentUserData.parentAdmin || currentUserData.parent_admin || currentUserData.assignedSubAdmin || currentUserData.adminId || currentUserData.subAdminId || '';
    if (pAdmin && pAdmin !== ADMIN_UID) return pAdmin;

    // 2. Check referredBy with direct Firestore lookup
    const refUid = currentUserData.referredBy || currentUserData.referred_by || '';
    if (refUid && refUid !== ADMIN_UID) {
        let refUser = (typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache))
            ? allUsersCache.find(u => String(u.id || u.uid) === String(refUid))
            : null;
        
        if (!refUser) {
            try {
                const snap = await getDoc(doc(db, `artifacts/${appId}/public/data/users`, refUid));
                if (snap.exists()) refUser = { id: snap.id, ...snap.data() };
            } catch (e) {}
        }

        if (refUser) {
            const role = String(refUser.role || '').toLowerCase();
            if (role === 'subadmin' || role === 'admin') {
                return refUser.id || refUser.uid || refUid;
            }
            const parentOfRef = refUser.parentAdmin || refUser.parent_admin;
            if (parentOfRef && parentOfRef !== ADMIN_UID) return parentOfRef;
        }
    }

    // 3. Check usedReferralCode with Firestore fallback
    const usedCode = String(currentUserData.usedReferralCode || currentUserData.referredByCode || currentUserData.referralCodeUsed || currentUserData.used_referral_code || '').trim().toUpperCase();
    if (usedCode) {
        let codeOwner = (typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache))
            ? allUsersCache.find(u => String(u.referralCode || u.myReferralCode || u.refCode || '').trim().toUpperCase() === usedCode)
            : null;
        
        if (!codeOwner) {
            try {
                const codeQ1 = query(collection(db, `artifacts/${appId}/public/data/users`), where("referralCode", "==", usedCode));
                const snap1 = await getDocs(codeQ1);
                if (!snap1.empty) {
                    codeOwner = { id: snap1.docs[0].id, ...snap1.docs[0].data() };
                } else {
                    const codeQ2 = query(collection(db, `artifacts/${appId}/public/data/users`), where("myReferralCode", "==", usedCode));
                    const snap2 = await getDocs(codeQ2);
                    if (!snap2.empty) {
                        codeOwner = { id: snap2.docs[0].id, ...snap2.docs[0].data() };
                    }
                }
            } catch (e) {}
        }

        if (codeOwner) {
            const role = String(codeOwner.role || '').toLowerCase();
            if (role === 'subadmin' || role === 'admin') {
                return codeOwner.id || codeOwner.uid;
            }
            const parentOfOwner = codeOwner.parentAdmin || codeOwner.parent_admin;
            if (parentOfOwner && parentOfOwner !== ADMIN_UID) return parentOfOwner;
        }
    }

    return '';
};

const loadWithdrawalSettingsOnce = async (force = false) => {
    const now = Date.now();
    if (!force && withdrawalSettingsLoadedAt && now - withdrawalSettingsLoadedAt < 30000) return;
    if (withdrawalSettingsLoadPromise && !force) return withdrawalSettingsLoadPromise;

    withdrawalSettingsLoadPromise = (async () => {
        try {
            // 1. Always load global app_config first (Owner defaults + maintenance + whats new)
            const globalSnapshot = await getDoc(doc(db, `artifacts/${appId}/settings`, 'app_config'));
            if (globalSnapshot.exists()) applyAppConfig(globalSnapshot.data());

            // 2. If current user has a parent sub-admin, load per-admin rate overrides from dual locations
            const subAdminId = await resolveEffectiveSubAdminId();
            if (subAdminId && subAdminId !== ADMIN_UID) {
                try {
                    const [adminConfigDoc, subUserDoc] = await Promise.all([
                        getDoc(doc(db, `artifacts/${appId}/settings`, `admin_config_${subAdminId}`)).catch(() => null),
                        getDoc(doc(db, `artifacts/${appId}/public/data/users`, subAdminId)).catch(() => null)
                    ]);

                    let adminConfig = {};
                    if (adminConfigDoc && adminConfigDoc.exists()) {
                        adminConfig = { ...adminConfig, ...adminConfigDoc.data() };
                    }
                    if (subUserDoc && subUserDoc.exists()) {
                        const uData = subUserDoc.data();
                        const rateData = uData.rateSettings || uData.withdrawalSettings || {};
                        adminConfig = { ...rateData, ...adminConfig };
                    }

                    if (Object.keys(adminConfig).length > 0) {
                        applyWithdrawalConfig(adminConfig);
                    }
                } catch (e) {
                    console.warn('Per-admin rate config load skipped:', e);
                }
            }

            withdrawalSettingsLoadedAt = Date.now();
        } catch (error) {
            console.error('Withdrawal settings load failed:', error);
        }
    })();

    return withdrawalSettingsLoadPromise.finally(() => {
        withdrawalSettingsLoadPromise = null;
    });
};

const getMinWithdrawalForMethod = (method) => {
    if (method === 'upi') return minWithdrawalUpi;
    if (method === 'bank') return minWithdrawalBank;
    return minWithdrawalRedeem;
};

const updateMinWithdrawalInfo = () => {
    const infoElement = document.getElementById('min-withdrawal-info');
    if (infoElement) {
        infoElement.textContent = `Min. withdrawal: ₹${minWithdrawalAmount}`;
    }
};

const originalHandleWithdrawRequest = handleWithdrawRequest;

handleWithdrawRequest = async function (amount, method, methodName) {
    // Prevent duplicate request
    if (!preventDuplicateRequest('withdrawal', 15000)) {
        return;
    }

    try {
        await loadWithdrawalSettingsOnce(true);
        // Check minimum withdrawal
        const minForMethod = getMinWithdrawalForMethod(method);
        if (amount < minForMethod) {
            showNotification(`Minimum withdrawal for ${methodName} is ₹${minForMethod}`, true);
            return;
        }

        // Call original function
        await originalHandleWithdrawRequest.call(this, amount, method, methodName);
    } finally {
        pendingRequests.delete('withdrawal');
    }
};

const startWithdrawalSettingsListener = async () => {
    if (appConfigListenerActive) return;
    appConfigListenerActive = true;

    const subAdminId = await resolveEffectiveSubAdminId();

    // Listen to global app_config (maintenance, whats new, owner defaults)
    const stopGlobal = onSnapshot(doc(db, `artifacts/${appId}/settings`, 'app_config'), (snapshot) => {
        if (!snapshot.exists()) return;
        applyAppConfig(snapshot.data());

        // Re-apply sub-admin rates so owner defaults never overwrite sub-admin settings
        if (subAdminId && subAdminId !== ADMIN_UID) {
            getDoc(doc(db, `artifacts/${appId}/settings`, `admin_config_${subAdminId}`)).then(subSnap => {
                if (subSnap.exists()) {
                    applyWithdrawalConfig(subSnap.data());
                }
            }).catch(() => {});
        }

        withdrawalSettingsLoadedAt = Date.now();
    }, (error) => {
        console.error('App settings listener failed:', error);
    });
    unsubscribers.push(() => { stopGlobal(); });

    // Listen to per-admin config if user belongs to a sub-admin
    if (subAdminId && subAdminId !== ADMIN_UID) {
        const stopAdmin = onSnapshot(doc(db, `artifacts/${appId}/settings`, `admin_config_${subAdminId}`), (snapshot) => {
            if (!snapshot.exists()) return;
            // Only override rate settings, NOT maintenance/whatsNew
            applyWithdrawalConfig(snapshot.data());
            withdrawalSettingsLoadedAt = Date.now();
        }, (error) => {
            console.warn('Per-admin settings listener failed:', error);
        });
        unsubscribers.push(() => { stopAdmin(); });
    }
};

// Expose functions to window for global access
window.loadUserPendingWithdrawalsMerged = loadUserPendingWithdrawalsMerged;
window.checkPendingWithdrawal = checkPendingWithdrawal;
window.isWithdrawMethodDetailsComplete = isWithdrawMethodDetailsComplete;
window.showWithdrawDetailsMissingModal = showWithdrawDetailsMissingModal;
window.getWithdrawalTransactions = getWithdrawalTransactions;
window.showWithdrawalInvoicesPage = showWithdrawalInvoicesPage;
window.showWithdrawalInvoiceDetails = showWithdrawalInvoiceDetails;
window.createWithdrawalInvoicePdf = createMockInvoicePdf;
window.downloadWithdrawalInvoicePdf = downloadMockInvoicePdf;
window.showInvoicePreviewPage = showInvoicePreviewPage;
window.getPendingWithdrawalForBot = getPendingWithdrawalForBot;
window.notifyWithdrawalStatus = notifyWithdrawalStatus;
window.getWithdrawMethodLogo = getWithdrawMethodLogo;
window.renderWithdrawMethodLogo = renderWithdrawMethodLogo;
window.getWithdrawalMethodName = getWithdrawalMethodName;
window.normalizeWithdrawalMethodId = normalizeWithdrawalMethodId;
window.getWithdrawalDisplayMethodName = getWithdrawalDisplayMethodName;
window.getWithdrawalDetailText = getWithdrawalDetailText;
window.renderPayoutDetailPills = renderPayoutDetailPills;
window.getWithdrawalSnapshot = getWithdrawalSnapshot;
window.showWithdrawPage = showWithdrawPage;
window.showWithdrawAmountPage = showWithdrawAmountPage;
window.handleWithdrawConfirmation = handleWithdrawConfirmation;
window.startLoanRepaymentAfterWithdrawalApproval = startLoanRepaymentAfterWithdrawalApproval;
window.showWithdrawalHistoryPage = showWithdrawalHistoryPage;
window.isWithdrawalHistorySourceRecord = isWithdrawalHistorySourceRecord;
window.normalizeWithdrawalHistoryRecord = normalizeWithdrawalHistoryRecord;
window.mergeWithdrawalHistoryRecords = mergeWithdrawalHistoryRecords;
window.loadWithdrawalHistory = loadWithdrawalHistory;
window.renderWithdrawalHistoryList = renderWithdrawalHistoryList;
window.isLegacyWithdrawalRequest = isLegacyWithdrawalRequest;
window.isWithdrawalBalanceDeducted = isWithdrawalBalanceDeducted;
window.shouldDeductLegacyWithdrawal = shouldDeductLegacyWithdrawal;
window.getLegacyWithdrawalTargets = getLegacyWithdrawalTargets;
window.handleSetWithdrawalGiftCardType = handleSetWithdrawalGiftCardType;
window.applyLegacyWithdrawalDeduction = applyLegacyWithdrawalDeduction;
window.handleFixLegacyPendingWithdrawals = handleFixLegacyPendingWithdrawals;
window.handleWithdrawRequest = handleWithdrawRequest;
window.handleSaveWithdrawSettings = handleSaveWithdrawSettings;
window.applyWithdrawalConfig = applyWithdrawalConfig;
window.loadWithdrawalSettingsOnce = loadWithdrawalSettingsOnce;
window.getMinWithdrawalForMethod = getMinWithdrawalForMethod;
window.updateMinWithdrawalInfo = updateMinWithdrawalInfo;
window.originalHandleWithdrawRequest = originalHandleWithdrawRequest;
window.startWithdrawalSettingsListener = startWithdrawalSettingsListener;
