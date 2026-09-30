// File: src/pages/dashboard.js

const getHistoryCacheKey = (userId) => `rw_wallet_history_cache_${userId}`;

const getHistoryDataCacheKey = (userId) => `rw_wallet_history_data_cache_${userId}`;

const getUserTaskHistoryCacheKey = (userId) => `rw_wallet_user_task_history_cache_${userId}`;

const normalizeHistoryItemForCache = (item = {}) => {
            const cached = { ...item };
            ['timestamp', 'requestedAt', 'processedAt'].forEach(field => {
                if (cached[field]) cached[field] = timestampToMillis(cached[field]);
            });
            return cached;
        };

const reviveHistoryItemFromCache = (item = {}) => {
            const revived = { ...item };
            ['timestamp', 'requestedAt', 'processedAt'].forEach(field => {
                if (revived[field]) revived[field] = reviveCachedTimestamp(revived[field]);
            });
            return revived;
        };

const readHistoryItemsFromCache = (userId) => {
            const cached = readJsonCache(getHistoryDataCacheKey(userId));
            return Array.isArray(cached) ? cached.map(reviveHistoryItemFromCache) : [];
        };

const writeHistoryItemsToCache = (userId, items) => {
            if (!userId || !Array.isArray(items)) return;
            writeJsonCache(getHistoryDataCacheKey(userId), items.map(normalizeHistoryItemForCache));
        };

const normalizeTransactionType = (item = {}) => {
            const rawType = String(item.type || '').toLowerCase().replace(/\s+/g, '_');
            const comment = String(item.comment || item.remarks || '').toLowerCase();
            if (rawType.includes('withdraw') || comment.includes('withdraw')) return 'withdrawal';
            if (rawType.includes('recharge') || comment.includes('recharge')) return 'mobile_recharge';
            if (rawType.includes('gift')) return 'gift_card';
            if (rawType.includes('wallet_transfer') || rawType === 'transfer') return 'wallet_transfer';
            if (rawType === 'credit' || rawType.includes('credit') || rawType.includes('received') || rawType.includes('deposit') || rawType.includes('add_fund')) return 'credit';
            if (rawType === 'debit' || rawType.includes('debit') || rawType.includes('deduct') || rawType.includes('cut')) return 'debit';
            if (rawType.includes('sent') || comment.includes('money sent')) return 'debit';
            if (comment.includes('admin credit')) return 'credit';
            if (comment.includes('admin debit') || comment.includes('balance cut') || comment.includes('deduct')) return 'debit';
            if (Number(item.amount || 0) > 0) return 'credit';
            if (Number(item.amount || 0) < 0) return 'debit';
            return rawType || 'transaction';
        };

const normalizeTransactionForHistory = (item = {}, index = 0) => {
            const timestamp = timestampToMillis(item.timestamp || item.requestedAt || item.createdAt || item.processedAt || item.date) || Date.now();
            const type = normalizeTransactionType(item);
            const amount = Number(item.amount || item.chargeAmount || 0);
            const transactionId = String(item.transaction_id || item.transactionId || item.adminTransactionId || item.id || `TX-${timestamp}-${index}`);
            return {
                ...item,
                id: item.id || transactionId,
                userId: item.user_id || item.userId || currentUser?.uid || '',
                transactionId,
                type,
                timestamp,
                amount,
                status: item.status || 'completed',
                comment: item.comment || item.remarks || item.description || (type === 'credit' ? 'Money Received' : type === 'withdrawal' ? 'Withdrawal' : 'Wallet Transaction')
            };
        };

const getTransactionBalanceEffect = (item = {}) => {
            const type = normalizeTransactionType(item);
            const amount = Number(item.chargeAmount || item.amount || 0);
            const status = String(item.status || '').toLowerCase();
            if (!Number.isFinite(amount) || amount === 0) return 0;
            if (status === 'rejected' || status === 'failed') {
                if (type === 'withdrawal' || type === 'mobile_recharge') return amount;
                return 0;
            }
            if (type === 'credit' || type === 'wallet_transfer' || type === 'add_fund' || type === 'gift_card') return amount;
            if (type === 'debit' || type === 'withdrawal' || type === 'mobile_recharge') return -amount;
            return amount > 0 ? amount : 0;
        };

const annotateTransactionsWithRemainingBalance = (items = [], currentBalance = 0) => {
            let runningBalance = Number(currentBalance || 0);
            return items.map(item => {
                const explicitBalanceAfter = getExplicitBalanceAfter(item);
                const balanceAfter = explicitBalanceAfter !== null ? explicitBalanceAfter : runningBalance;
                const effect = getTransactionBalanceEffect(item);
                runningBalance = Number((balanceAfter - effect).toFixed(2));
                return {
                    ...item,
                    balanceAfter,
                    balanceBefore: item.balanceBefore ?? item.balance_before ?? Number((balanceAfter - effect).toFixed(2))
                };
            });
        };

const normalizeCloudTransaction = (item = {}) => normalizeTransactionForHistory(item);

const getTransactionKey = (item = {}, index = 0) => {
    const timestamp = timestampToMillis(item.timestamp || item.requestedAt || item.createdAt || item.processedAt) || Date.now();
    const type = normalizeTransactionType(item);

    // 1. Order ID for deposits
    const orderId = item.orderId || item.order_id;
    if (orderId) {
        const cleanOrder = String(orderId).replace(/^dep_/, '');
        return `dep_${cleanOrder}`;
    }

    // 2. Request ID for withdrawals / mobile recharge
    const requestId = item.requestId || item.request_id;
    if (requestId) {
        const cleanReq = String(requestId).replace(/^req-/, '');
        return `req-${cleanReq}`;
    }

    // 3. Existing key if prefixed
    const existingKey = String(item.key || '');
    if (existingKey.startsWith('dep_')) {
        return `dep_${existingKey.replace(/^dep_/, '')}`;
    }
    if (existingKey.startsWith('req-')) {
        return `req-${existingKey.replace(/^req-/, '')}`;
    }

    // 4. Raw ID prefixes
    const rawId = String(item.id || '');
    if (rawId.startsWith('dep_')) {
        return `dep_${rawId.replace(/^dep_/, '')}`;
    }
    if (rawId.startsWith('req-')) {
        return `req-${rawId.replace(/^req-/, '')}`;
    }

    // 5. Withdrawal type fallback with ID
    if (type === 'withdrawal' && rawId) {
        return `req-${rawId.replace(/^req-/, '')}`;
    }

    // 6. Transaction ID / adminTransactionId fallback
    const txnId = item.transactionId || item.transaction_id || item.adminTransactionId || item.id || existingKey;
    if (txnId) return String(txnId);

    return `${type}-${timestamp}-${Math.abs(Number(item.amount || 0))}-${index}`;
};

const mergeTransactionsByKey = (...groups) => {
    const merged = new Map();
    const statusRank = (item = {}) => {
        const s = String(item.status || '').toLowerCase();
        if (s === 'completed' || s === 'approved') return 3;
        if (s === 'rejected' || s === 'failed') return 2;
        return 1;
    };

    const getOriginalRequestTime = (...items) => {
        const times = items
            .flat()
            .map(item => timestampToMillis(item?.requestedAt || item?.requested_at || item?.createdAt || item?.timestamp))
            .filter(time => Number.isFinite(time) && time > 0);
        return times.length ? Math.min(...times) : null;
    };

    // First pass: group by canonical key
    groups.flat().forEach((item, index) => {
        if (!item) return;
        const normalized = normalizeTransactionForHistory(item, index);
        const key = getTransactionKey(normalized, index);
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...normalized, key });
            return;
        }

        let next = statusRank(normalized) >= statusRank(existing)
            ? { ...existing, ...normalized, key }
            : { ...normalized, ...existing, key };

        const type = normalizeTransactionType(next);
        if ((next.requestId || next.request_id || key.startsWith('req-')) && (type === 'withdrawal' || type === 'mobile_recharge')) {
            const requestedAt = getOriginalRequestTime(existing, normalized, item);
            if (requestedAt) {
                next.requestedAt = requestedAt;
                next.timestamp = requestedAt;
            }
        }
        merged.set(key, next);
    });

    // Second pass: deep deduplication for records referring to the same transaction
    const allItems = Array.from(merged.values());
    const finalItems = [];

    const isSameTransaction = (a, b) => {
        if (a === b) return true;

        // Match orderId (e.g. UPI deposits)
        const aOrder = String(a.orderId || a.order_id || '').replace(/^dep_/, '').trim();
        const bOrder = String(b.orderId || b.order_id || '').replace(/^dep_/, '').trim();
        if (aOrder && bOrder && aOrder.toLowerCase() === bOrder.toLowerCase()) return true;

        // Match requestId (e.g. withdrawals or mobile recharges)
        const aReq = String(a.requestId || a.request_id || a.id || '').replace(/^req-/, '').trim();
        const bReq = String(b.requestId || b.request_id || b.id || '').replace(/^req-/, '').trim();
        if (aReq && bReq && aReq === bReq && (a.type === 'withdrawal' || b.type === 'withdrawal' || a.type === 'mobile_recharge' || b.type === 'mobile_recharge')) return true;

        // Match UTR if valid
        const aUtr = String(a.utr || '').trim().toLowerCase();
        const bUtr = String(b.utr || '').trim().toLowerCase();
        if (aUtr && bUtr && aUtr !== 'n/a' && aUtr.length >= 6 && aUtr === bUtr) return true;

        // Match transactionId / adminTransactionId
        const aTxn = String(a.transactionId || a.transaction_id || a.adminTransactionId || '').trim();
        const bTxn = String(b.transactionId || b.transaction_id || b.adminTransactionId || '').trim();
        if (aTxn && bTxn && aTxn === bTxn && !aTxn.startsWith('TX-') && !aTxn.startsWith('tx-')) return true;

        // Match identical type + amount + close timestamp
        const aType = normalizeTransactionType(a);
        const bType = normalizeTransactionType(b);
        if (aType === bType && Math.abs(Number(a.amount || 0)) === Math.abs(Number(b.amount || 0))) {
            const aTime = timestampToMillis(a.timestamp || a.requestedAt || a.createdAt);
            const bTime = timestampToMillis(b.timestamp || b.requestedAt || b.createdAt);
            if (aTime && bTime && Math.abs(aTime - bTime) <= 15000) {
                return true;
            }
        }

        return false;
    };

    for (const item of allItems) {
        const existingIdx = finalItems.findIndex(existing => isSameTransaction(existing, item));
        if (existingIdx >= 0) {
            const existing = finalItems[existingIdx];
            const mergedItem = statusRank(item) >= statusRank(existing)
                ? { ...existing, ...item, key: existing.key || item.key }
                : { ...item, ...existing, key: existing.key || item.key };

            mergedItem.transactionId = item.transactionId || existing.transactionId;
            mergedItem.adminTransactionId = item.adminTransactionId || existing.adminTransactionId;
            mergedItem.orderId = item.orderId || existing.orderId;
            mergedItem.requestId = item.requestId || existing.requestId;
            mergedItem.utr = item.utr || existing.utr;

            finalItems[existingIdx] = mergedItem;
        } else {
            finalItems.push(item);
        }
    }

    return finalItems.sort((a, b) => timestampToMillis(b.timestamp || b.requestedAt) - timestampToMillis(a.timestamp || a.requestedAt));
};

const normalizePendingRequestForHistory = (request = {}) => {
            const requestType = request.type || 'withdrawal';
            const timestamp = request.requestedAt || request.requested_at || request.timestamp || request.createdAt || Date.now();
            const requestId = request.id || request.requestId || request.request_id || `${requestType}-${timestampToMillis(timestamp)}-${request.amount || 0}`;
            return {
                ...request,
                id: requestId,
                requestId,
                key: `req-${requestId}`,
                type: requestType,
                comment: requestType === 'mobile_recharge' ? 'Mobile Recharge Request' : 'Withdrawal Request',
                timestamp,
                status: request.status || 'pending'
            };
        };

const loadFirebaseTransactions = async (userId, maxItems = FIRESTORE_TRANSACTION_READ_LIMIT) => {
            if (!userId) return [];
            const readLimit = Math.max(1, Math.min(Number(maxItems) || FIRESTORE_TRANSACTION_READ_LIMIT, FIRESTORE_TRANSACTION_READ_LIMIT));
            const canonicalQuery = query(
                collection(db, `artifacts/${appId}/public/data/users/${userId}/transactions`),
                orderBy('timestamp', 'desc'),
                firestoreLimit(readLimit)
            );
            const snapshot = await getDocs(canonicalQuery);
            return snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                sourcePath: docSnap.ref.path,
                ...docSnap.data()
            }));
        };

const serializeCloudTransaction = (item = {}, userId = currentUser?.uid) => {
            const timestamp = timestampToMillis(item.timestamp || item.requestedAt || item.createdAt || item.processedAt) || Date.now();
            const transactionId = String(item.transactionId || item.adminTransactionId || item.requestId || item.id || `${item.type || 'tx'}-${timestamp}`);
            return {
                userId,
                transactionId,
                type: item.type || 'transaction',
                amount: Number(item.amount || 0),
                status: item.status || 'completed',
                timestamp,
                details: normalizeHistoryItemForCache({ ...item, transactionId, timestamp })
            };
        };

const fetchCloudTransactionHistory = async (userId, limit = 100) => {
            const token = await getBackendAuthToken();
            const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/transactions/${encodeURIComponent(userId)}?limit=${limit}`, {
                headers: { Authorization: `Bearer ${token}` }
            }, 7000);
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) throw new Error(data.error || 'Cloudflare history load failed');
            return (data.history || []).map(normalizeCloudTransaction);
        };

const importFirestoreTransactionsToCloud = async (userId, items) => {
            if (!items.length) return;
            try {
                const token = await getBackendAuthToken();
                for (let index = 0; index < items.length; index += 500) {
                    const chunk = items.slice(index, index + 500);
                    await fetch(`${BACKEND_BASE_URL}/api/transactions/import`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId,
                            transactions: chunk.map(item => serializeCloudTransaction(item, userId))
                        })
                    });
                }
            } catch (error) {
                console.warn('Cloudflare history import failed:', error);
                reportSyncFailure('transaction_import', userId, 'firebase', 'd1', error?.message);
            }
        };

const recordCloudTransaction = async (userId, item) => {
            try {
                const token = await getBackendAuthToken();
                await fetchWithTimeout(`${BACKEND_BASE_URL}/api/transactions`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(serializeCloudTransaction(item, userId))
                }, 5000);
            } catch (error) {
                console.warn('Cloudflare transaction save failed:', error);
                reportSyncFailure('transaction', item?.transactionId || 'unknown', 'firebase', 'd1', error?.message);
            }
        };

const getSafeTransactionDocId = (id = '') => String(id || generateTransactionId()).replace(/[\/\\#?[\]]/g, '-').slice(0, 120);

const recordUserFirestoreTransaction = async (userId, item = {}) => {
            const userRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
            const transactionId = item.transactionId || generateTransactionId();
            const txRef = doc(collection(userRef, 'transactions'), getSafeTransactionDocId(transactionId));
            await setDoc(txRef, {
                ...item,
                transactionId,
                timestamp: item.timestamp || serverTimestamp()
            }, { merge: true });
            return { ...item, transactionId };
        };

const syncRecentTransactionsToCloud = async (userId = currentUser?.uid) => {
            if (!userId) return;
            try {
                const items = await loadFirebaseTransactions(userId, FIRESTORE_TRANSACTION_READ_LIMIT);
                await importFirestoreTransactionsToCloud(userId, items);
                const mergedUserHistory = mergeTransactionsByKey(readHistoryItemsFromCache(userId), items);
                writeHistoryItemsToCache(userId, mergedUserHistory);
                if (currentUser?.uid === userId) {
                    unifiedHistoryCache = mergeTransactionsByKey(unifiedHistoryCache, mergedUserHistory);
                }
            } catch (error) {
                console.warn('Firebase transaction cache sync failed:', error);
            }
        };

const loadUserDepositsForHistory = async (userId = currentUser?.uid) => {
    if (!userId) return [];
    try {
        const depositsRef = collection(db, `artifacts/${appId}/public/data/deposits`);
        const snap = await getDocs(query(depositsRef, where("userId", "==", userId), firestoreLimit(50))).catch(() => null);
        let items = snap && !snap.empty ? snap.docs.map(d => ({ id: d.id, ...d.data() })) : [];

        if (items.length === 0 && currentUser?.email) {
            const snapEmail = await getDocs(query(depositsRef, where("userEmail", "==", currentUser.email), firestoreLimit(50))).catch(() => null);
            if (snapEmail && !snapEmail.empty) {
                items = snapEmail.docs.map(d => ({ id: d.id, ...d.data() }));
            }
        }

        return items.map(d => ({
            key: `dep_${d.orderId || d.id}`,
            transactionId: d.orderId || d.id,
            orderId: d.orderId || d.id,
            type: 'deposit',
            amount: Number(d.amount || 0),
            taxAmount: Number(d.taxAmount || 0),
            totalPayable: Number(d.totalPayable || d.amount || 0),
            utr: d.utr || '',
            senderName: d.userName || 'UPI User',
            comment: `Add Money via UPI (Order: ${d.orderId || d.id})`,
            status: d.status || 'pending',
            timestamp: d.createdAt || d.timestamp || Date.now(),
            createdAt: d.createdAt || d.timestamp || Date.now()
        }));
    } catch (e) {
        console.warn('Load user deposits for history skipped:', e);
        return [];
    }
};

const prefetchTransactionHistory = (userId = currentUser?.uid, { force = false } = {}) => {
            if (!userId) return Promise.resolve([]);
            if (!force && transactionHistoryPrefetch.userId === userId && transactionHistoryPrefetch.promise) {
                return transactionHistoryPrefetch.promise;
            }
            if (!force && transactionHistoryPrefetch.userId === userId && transactionHistoryPrefetch.loadedAt && Date.now() - transactionHistoryPrefetch.loadedAt < 60000) {
                return Promise.resolve(unifiedHistoryCache);
            }
            const cached = readHistoryItemsFromCache(userId);
            if (cached.length) {
                unifiedHistoryCache = mergeTransactionsByKey(unifiedHistoryCache, cached);
            }
            transactionHistoryPrefetch.userId = userId;
            transactionHistoryPrefetch.promise = (async () => {
                const [firebaseTransactions, cloudTransactions, pendingWithdrawals, userDeposits] = await Promise.all([
                    loadFirebaseTransactions(userId, FIRESTORE_TRANSACTION_READ_LIMIT).catch(error => {
                        logBackgroundSkip('Firebase transaction prefetch skipped', error);
                        return [];
                    }),
                    fetchCloudTransactionHistory(userId, FIRESTORE_TRANSACTION_READ_LIMIT).catch(error => {
                        logBackgroundSkip('Cloud transaction prefetch skipped', error);
                        return [];
                    }),
                    loadUserPendingWithdrawalsMerged(userId).catch(error => {
                        logBackgroundSkip('Pending withdrawal prefetch skipped', error);
                        return [];
                    }),
                    loadUserDepositsForHistory(userId).catch(error => {
                        logBackgroundSkip('User deposits prefetch skipped', error);
                        return [];
                    })
                ]);
                const activeHistoryCache = currentUser?.uid === userId ? unifiedHistoryCache : readHistoryItemsFromCache(userId);
                const cachedPending = (activeHistoryCache || []).filter(item => String(item.status || '').toLowerCase() === 'pending');
                const pendingHistoryItems = pendingWithdrawals.map(normalizePendingRequestForHistory);
                const mergedUserHistory = mergeTransactionsByKey(firebaseTransactions, cloudTransactions, cachedPending, pendingHistoryItems, userDeposits);
                writeHistoryItemsToCache(userId, mergedUserHistory);
                if (currentUser?.uid === userId) {
                    unifiedHistoryCache = mergedUserHistory;
                }
                transactionHistoryPrefetch.loadedAt = Date.now();
                return mergedUserHistory;
            })().finally(() => {
                transactionHistoryPrefetch.promise = null;
            });
            return transactionHistoryPrefetch.promise;
        };

const addInstantTransactionToHistory = (userId, item = {}) => {
            if (!userId || !item) return null;
            const normalized = normalizeTransactionForHistory({
                ...item,
                timestamp: item.timestamp || Date.now()
            });
            const mergedUserHistory = mergeTransactionsByKey([normalized], readHistoryItemsFromCache(userId), currentUser?.uid === userId ? unifiedHistoryCache : []);
            writeHistoryItemsToCache(userId, mergedUserHistory);
            if (currentUser?.uid === userId) {
                unifiedHistoryCache = mergedUserHistory;
            }
            transactionHistoryPrefetch = { userId, promise: null, loadedAt: 0 };
            if (document.getElementById('transactions-list')) {
                document.getElementById('transactions-list').innerHTML = unifiedHistoryCache.slice(0, 5).map(tx => renderTransactionItem(tx)).join('');
                try {
                    localStorage.setItem(getHistoryCacheKey(userId), document.getElementById('transactions-list').innerHTML);
                } catch (error) {
                    console.warn('Instant history html cache skipped:', error);
                }
            }
            if (document.getElementById('all-transactions-list')) {
                const activeFilter = document.querySelector('#filter-bar .active-filter')?.dataset.filter || 'all';
                renderFilteredTransactions(activeFilter, { reset: false });
            }
            return unifiedHistoryCache.find(tx => tx.transactionId === normalized.transactionId) || normalized;
        };

const generateTransactionId = () => {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(36).substring(2, 8);
            return `TXN${timestamp}${random}`.toUpperCase();
        };

const formatPaytmDate = (timestamp) => {
    if (!timestamp) return 'Recent';
    let date;
    if (timestamp?.toDate) date = timestamp.toDate();
    else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
    else if (typeof timestamp === 'number') date = new Date(timestamp);
    else date = new Date(timestamp);

    if (isNaN(date.getTime())) return 'Recent';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    if (isToday) return `Today, ${timeStr}`;
    if (isYesterday) return `Yesterday, ${timeStr}`;

    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${day} ${month}, ${timeStr}`;
};

const getPaytmInitialAvatar = (name, item = {}) => {
    const cleanName = (name || 'User').trim();

    // 1. Check if item has explicit photoURL / avatar / senderPhoto / recipientPhoto
    let avatarUrl = item.photoURL || item.avatar || item.senderPhoto || item.recipientPhoto || item.senderProfilePic || item.recipientProfilePic;

    // 2. Search in allUsersCache or currentUserData
    if (!avatarUrl && typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache)) {
        const normName = cleanName.toLowerCase();
        const found = allUsersCache.find(u =>
            (u.name || '').toLowerCase() === normName ||
            (u.displayName || '').toLowerCase() === normName ||
            (item.senderMobile && u.mobile === item.senderMobile) ||
            (item.recipientMobile && u.mobile === item.recipientMobile)
        );
        if (found) {
            avatarUrl = typeof getProfileAvatarUrl === 'function' ? getProfileAvatarUrl(found) : (found.photoURL || found.avatar || found.profilePic);
        }
    }

    if (!avatarUrl && currentUserData && (currentUserData.name || '').toLowerCase() === cleanName.toLowerCase()) {
        avatarUrl = typeof getProfileAvatarUrl === 'function' ? getProfileAvatarUrl(currentUserData) : (currentUserData.photoURL || currentUserData.avatar);
    }

    // If valid profile photo exists, render image avatar
    if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.length > 5 && !avatarUrl.includes('default-avatar') && !avatarUrl.includes('ui-avatars')) {
        return `<img src="${escapeHtml(avatarUrl)}" class="w-11 h-11 rounded-full object-cover shrink-0 border border-gray-200 dark:border-gray-700 shadow-xs" alt="${escapeHtml(cleanName)}" loading="lazy">`;
    }

    // Fallback: Initial circle
    const parts = cleanName.split(' ');
    let initials = '';
    if (parts.length >= 2) {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (cleanName.length >= 2) {
        initials = cleanName.substring(0, 2).toUpperCase();
    } else {
        initials = cleanName[0].toUpperCase();
    }

    const colorPairs = [
        'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
        'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
        'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
        'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
    ];
    let charSum = 0;
    for (let i = 0; i < cleanName.length; i++) charSum += cleanName.charCodeAt(i);
    const colorClass = colorPairs[charSum % colorPairs.length];

    return `<div class="w-11 h-11 rounded-full ${colorClass} font-bold text-sm flex items-center justify-center shrink-0 border border-black/5 shadow-xs">${initials}</div>`;
};

const renderTransactionItem = (item, isFullPage = false) => {
    const hasDetailKey = !!item.key;
    const clickableClass = hasDetailKey ? 'tx-item-clickable cursor-pointer' : '';
    const dataKey = hasDetailKey ? `data-key="${item.key}"` : '';

    const timestamp = item.timestamp || item.createdAt || item.requestedAt;
    const dateStr = formatPaytmDate(timestamp);
    const rawType = normalizeTransactionType(item);
    const rwLogoImg = `<img src="https://cdn-icons-png.flaticon.com/512/12449/12449036.png" class="w-4 h-4 object-contain inline-block" alt="RW Logo">`;

    // 1. DEPOSIT / ADD MONEY
    if (item.type === 'deposit' || item.orderId) {
        const isSuccess = item.status === 'completed';
        const isPending = item.status === 'pending' || item.status === 'pending_admin_approval';
        const statusText = isSuccess
            ? `Added on ${dateStr}`
            : isPending
                ? `Requested on ${dateStr}`
                : `${dateStr}`;

        const leftIcon = `
            <div class="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0 shadow-xs">
                <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>`;

        return `
            <div class="py-3 px-1 border-b border-gray-100 dark:border-gray-800 space-y-1 ${clickableClass}" ${dataKey}>
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        ${leftIcon}
                        <div class="min-w-0 flex-1">
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white truncate">Add Money</h4>
                            <p class="text-xs font-medium ${!isSuccess && !isPending ? 'text-rose-500 font-bold flex items-center gap-1' : 'text-gray-500 dark:text-gray-400'} mt-0.5">
                                ${statusText}
                                ${!isSuccess && !isPending ? '<span class="inline-block w-2 h-2 rounded-full bg-rose-500"></span> Failed' : ''}
                            </p>
                            <div class="mt-1">
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                                    💵 Self-Transfer
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-base font-bold text-emerald-600 dark:text-emerald-400">+ ₹${(item.amount || 0).toLocaleString('en-IN')}</p>
                        <p class="text-[11px] text-gray-400 font-medium mt-0.5 flex items-center justify-end gap-1">
                            <span>From</span>
                            ${rwLogoImg}
                        </p>
                    </div>
                </div>
            </div>`;
    }

    // 2. WITHDRAWAL
    if (item.type === 'withdrawal' || rawType === 'withdrawal') {
        const isPending = item.status === 'pending';
        const isRejected = item.status === 'rejected';

        const methodId = item.methodId || item.withdraw_method || item.paymentMethod || (item.upiId ? 'upi' : item.accountNumber ? 'bank' : '');
        const logoUrl = getWithdrawMethodLogo(methodId);
        const leftIcon = logoUrl
            ? `<img src="${logoUrl}" class="w-11 h-11 rounded-full object-contain p-1 border border-gray-200 dark:border-gray-700 bg-white shrink-0 shadow-xs" alt="Logo">`
            : `<div class="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-xs shrink-0">₹</div>`;

        const statusSubtext = isPending
            ? `Requested on ${dateStr}`
            : isRejected
                ? `Failed on ${dateStr}`
                : `Paid on ${dateStr}`;

        return `
            <div class="py-3 px-1 border-b border-gray-100 dark:border-gray-800 space-y-1 ${clickableClass}" ${dataKey}>
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        ${leftIcon}
                        <div class="min-w-0 flex-1">
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white truncate">Withdrawal</h4>
                            <p class="text-xs font-medium ${isRejected ? 'text-rose-500 font-bold' : 'text-gray-500 dark:text-gray-400'} mt-0.5">
                                ${statusSubtext}
                            </p>
                            <div class="mt-1">
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                                    💵 Withdrawal
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-base font-bold text-gray-900 dark:text-white">- ₹${(item.amount || 0).toLocaleString('en-IN')}</p>
                        <p class="text-[11px] text-gray-400 font-medium mt-0.5 flex items-center justify-end gap-1">
                            <span>From</span>
                            ${rwLogoImg}
                        </p>
                    </div>
                </div>
            </div>`;
    }

    // 3. MOBILE RECHARGE
    if (item.type === 'mobile_recharge') {
        const isPending = item.status === 'pending';
        const isRejected = item.status === 'rejected';
        const chargeAmount = item.chargeAmount || item.amount || 0;
        const statusSubtext = isPending ? `Requested on ${dateStr}` : isRejected ? `Failed on ${dateStr}` : `Paid on ${dateStr}`;

        const leftIcon = `
            <div class="w-11 h-11 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0 shadow-xs">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
            </div>`;

        return `
            <div class="py-3 px-1 border-b border-gray-100 dark:border-gray-800 space-y-1 ${clickableClass}" ${dataKey}>
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        ${leftIcon}
                        <div class="min-w-0 flex-1">
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.mobileNumber || 'Mobile Recharge')}</h4>
                            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mt-0.5">${statusSubtext}</p>
                            <div class="mt-1">
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                                    💵 Mobile Recharge
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-base font-bold text-gray-900 dark:text-white">- ₹${Number(chargeAmount).toLocaleString('en-IN')}</p>
                        <p class="text-[11px] text-gray-400 font-medium mt-0.5 flex items-center justify-end gap-1">
                            <span>From</span>
                            ${rwLogoImg}
                        </p>
                    </div>
                </div>
            </div>`;
    }

    // 4. USER P2P / WALLET TRANSFERS & OTHERS
    const isCredit = rawType === 'credit' || rawType === 'gift_card' || (Number(item.amount || 0) > 0 && !['debit', 'withdrawal', 'mobile_recharge'].includes(rawType));
    const isWalletTransfer = item.type === 'wallet_transfer';

    let partyName = '';
    if (isWalletTransfer) {
        partyName = isCredit ? (item.senderName || 'User') : (item.recipientName || 'User');
    } else if (item.type === 'debit' && item.recipientName) {
        partyName = item.recipientName;
    } else if (item.senderName) {
        partyName = item.senderName;
    } else {
        partyName = item.comment || item.type || 'Wallet Transaction';
    }
    partyName = partyName.replace(/_/g, ' ');

    const dateVerb = isCredit ? `Received on ${dateStr}` : `Sent on ${dateStr}`;
    const pillText = isCredit ? '💵 Money Received' : '💵 Money Transfer';
    const amountSign = isCredit ? '+ ₹' : '- ₹';
    const amountColor = isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-white';
    const sourceLabel = isCredit ? 'In' : 'From';

    const avatarHtml = getPaytmInitialAvatar(partyName, item);

    return `
        <div class="py-3 px-1 border-b border-gray-100 dark:border-gray-800 space-y-1 ${clickableClass}" ${dataKey}>
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    ${avatarHtml}
                    <div class="min-w-0 flex-1">
                        <h4 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(partyName)}</h4>
                        <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mt-0.5">${dateVerb}</p>
                        <div class="mt-1">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                                ${pillText}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <p class="text-base font-bold ${amountColor}">${amountSign}${Math.abs(Number(item.amount || 0)).toLocaleString('en-IN')}</p>
                    <p class="text-[11px] text-gray-400 font-medium mt-0.5 flex items-center justify-end gap-1">
                        <span>${sourceLabel}</span>
                        ${rwLogoImg}
                    </p>
                </div>
            </div>
        </div>`;
};

const setBottomNavActive = (activeId) => {
            document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === activeId);
            });
        };

const showPage = (content, options = {}) => {
            if (adminMaintenanceInterval) {
                clearInterval(adminMaintenanceInterval);
                adminMaintenanceInterval = null;
            }
            if (!options.keepTaskReservation && activeTaskReservationTimer) {
                clearInterval(activeTaskReservationTimer);
                activeTaskReservationTimer = null;
            }
            if (!options.keepTaskReservation) {
                activeTaskReservation = null;
                window.activeTaskReservation = null;
            }
            lastManualPageOpenAt = Date.now();
            const pageContainer = document.getElementById('page-container');
            const dashboardContent = document.getElementById('dashboard-content');
            // ---- ATOMIC PAINT ORDER: Hide everything that's visible FIRST (so NO intermediate frame with stale content) ----
            pageContainer.classList.add('hidden');
            dashboardContent.classList.add('hidden');
            // ---- Write new content WHILE hidden: browser will NOT paint stale HTML ----
            pageContainer.innerHTML = content;
            const returnSection = options.returnTo || currentMainSection;
            pageContainer.style.paddingBottom = options.fullHeight ? '0' : (options.keepBottomNav ? '6.5rem' : '1.5rem');
            pageContainer.style.overflowY = options.fullHeight ? 'hidden' : 'auto';
            pageContainer.style.scrollPaddingBottom = '7rem';
            pageContainer.scrollTop = 0;
            setMainChrome(!!options.keepBottomNav);
            document.getElementById('app-footer')?.classList.add('app-footer-hidden');
            // ---- Only NOW make new content visible (fresh HTML, one paint only) ----
            pageContainer.classList.remove('hidden');

            const defaultBackAction = () => {
                if (returnSection === 'settings') {
                    showSettingsPage();
                } else if (returnSection === 'transactions') {
                    showAllTransactionsPage();
                } else if (returnSection === 'help') {
                    showHelpSupportPage();
                } else if (returnSection === 'admin') {
                    showAdminMainPage();
                } else {
                    hidePage();
                }
            };

            window.currentPageBackHandler = options.onBack || defaultBackAction;
            window.isSubPageActive = true;

            try {
                window.history.pushState({ rwPage: true, returnTo: returnSection, ts: Date.now() }, '');
            } catch (_) {}

            const backButton = pageContainer.querySelector('.page-back-btn') || document.getElementById('revy-back-btn');
            if (backButton) {
                backButton.onclick = window.currentPageBackHandler;
            }
        };

const hidePage = () => {
            if (adminMaintenanceInterval) {
                clearInterval(adminMaintenanceInterval);
                adminMaintenanceInterval = null;
            }
            if (activeChatUnsubscribe) {
                activeChatUnsubscribe();
                activeChatUnsubscribe = null;
            }
            if (activeTaskReservationTimer) {
                clearInterval(activeTaskReservationTimer);
                activeTaskReservationTimer = null;
            }
            activeTaskReservation = null;
            window.activeTaskReservation = null;
            window.currentPageBackHandler = null;
            window.isSubPageActive = false;

            document.getElementById('dashboard-content').classList.remove('hidden');
            document.getElementById('page-container').classList.add('hidden');
            document.getElementById('page-container').innerHTML = '';
            document.getElementById('page-container').style.overflowY = 'auto';
            document.getElementById('page-container').style.scrollPaddingBottom = '';
            updateDollarBalanceDisplay(currentUserData?.balance || 0);
            setMainChrome(true);
            document.getElementById('app-footer')?.classList.add('app-footer-hidden');
            const selectedTab = document.querySelector('.tab-button[aria-selected="true"]');
            if (selectedTab) {
                switchTab(selectedTab.dataset.tab);
                setBottomNavActive(selectedTab.dataset.tab === 'admin-panel' ? 'bottom-admin-btn' : 'bottom-home-btn');
            } else {
                const fallbackTab = currentUser && currentUser.uid === ADMIN_UID && currentMainSection === 'admin'
                    ? 'admin-panel'
                    : 'user-panel';
                switchTab(fallbackTab);
                setBottomNavActive(fallbackTab === 'admin-panel' ? 'bottom-admin-btn' : 'bottom-home-btn');
            }
        };

let lastBackGestureTime = 0;

const showAppExitModal = () => {
    renderModal('Exit App?',
        `<div class="space-y-3 py-2 text-center">
            <div class="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 mx-auto flex items-center justify-center text-2xl shadow-inner">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </div>
            <p class="text-base font-bold text-gray-800 dark:text-gray-100">Do you want to close RW Wallet?</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">Click "Yes, Close" to exit, or "No, Stay" to keep using your wallet.</p>
        </div>`,
        `<div class="flex justify-center gap-3 w-full">
            <button onclick="window.closeModal()" class="flex-1 py-2.5 rounded-xl bg-gray-150 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold text-xs transition hover:bg-gray-200 dark:hover:bg-gray-650">No, Stay</button>
            <button onclick="window.confirmExitApp()" class="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md transition">Yes, Close</button>
        </div>`,
        'max-w-xs');
};

const confirmExitApp = () => {
    window.closeModal();
    if (window.navigator && window.navigator.app && typeof window.navigator.app.exitApp === 'function') {
        window.navigator.app.exitApp();
    } else if (typeof window.close === 'function') {
        window.close();
    }
};

const handleDeviceBackNavigation = (e) => {
    const modalContainer = document.getElementById('modal-container');
    const isModalOpen = modalContainer && modalContainer.children.length > 0 && modalContainer.innerHTML.trim().length > 0;
    
    if (isModalOpen) {
        if (e && e.preventDefault) e.preventDefault();
        window.closeModal();
        try { window.history.pushState({ rwPage: true }, ''); } catch (_) {}
        return;
    }

    const pageContainer = document.getElementById('page-container');
    const isPageOpen = pageContainer && !pageContainer.classList.contains('hidden') && pageContainer.innerHTML.trim().length > 0;

    if (isPageOpen) {
        if (e && e.preventDefault) e.preventDefault();
        if (typeof window.currentPageBackHandler === 'function') {
            window.currentPageBackHandler();
        } else {
            const backButton = pageContainer.querySelector('.page-back-btn') || document.getElementById('revy-back-btn');
            if (backButton) {
                backButton.click();
            } else if (typeof hidePage === 'function') {
                hidePage();
            }
        }
        return;
    }

    // User is on root Dashboard / Main screen
    const now = Date.now();
    if (now - lastBackGestureTime < 3000) {
        // Double back within 3 seconds: show exit confirmation modal
        if (e && e.preventDefault) e.preventDefault();
        showAppExitModal();
        try { window.history.pushState({ rwRoot: true }, ''); } catch (_) {}
    } else {
        lastBackGestureTime = now;
        if (e && e.preventDefault) e.preventDefault();
        showNotification('Swipe / press back again to exit', false, 2500);
        try { window.history.pushState({ rwRoot: true }, ''); } catch (_) {}
    }
};

window.showAppExitModal = showAppExitModal;
window.confirmExitApp = confirmExitApp;
window.handleDeviceBackNavigation = handleDeviceBackNavigation;

// Hook up browser gesture/history popstate & Cordova/Capacitor hardware backbutton
window.addEventListener('popstate', handleDeviceBackNavigation);
document.addEventListener('backbutton', handleDeviceBackNavigation, false);

const openSlideMenu = () => {
            const menu = document.getElementById('slide-menu');
            const isAdmin = currentUser && currentUser.uid === ADMIN_UID;

            let adminItems = '';
            if (isAdmin) {
                adminItems = `
                    <hr class="border-gray-200 dark:border-gray-700 my-2">
                    <p class="text-xs font-semibold text-gray-400 uppercase px-4 pt-2">Admin</p>
                    <button id="slide-menu-admin-withdrawals" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>
                        Pending Requests
                    </button>
                    <button id="slide-menu-admin-users" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        User Management
                    </button>
                    <button id="slide-menu-admin-gift-codes" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>
                        Gift Codes
                    </button>
                    <button id="slide-menu-admin-withdrawal-history" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        Withdrawal History
                    </button>
                    <button id="slide-menu-admin-bulk-send" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-indigo-600 dark:text-indigo-400 font-bold">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><path d="M22 2L11 13"></path><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        Bulk Send Money
                    </button>
                    `;
            }

            menu.innerHTML = `
                <div class="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-lg font-semibold">Menu</h3>
                    <button id="slide-menu-close-btn" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="p-2 space-y-1">
                    <button id="slide-menu-profile-btn" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        My Profile
                    </button>
                    <button id="slide-menu-settings-btn" class="flex items-center w-full text-left p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        Settings
                    </button>
                    
                    ${adminItems}

                    <hr class="border-gray-200 dark:border-gray-700 my-2">
                    
                    <button id="slide-menu-logout-btn" class="flex items-center w-full text-left p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-3"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        Logout
                    </button>
                </div>
            `;

            document.getElementById('menu-overlay').classList.remove('hidden');
            menu.classList.remove('translate-x-full');

            // Add listeners
            document.getElementById('slide-menu-close-btn').onclick = closeSlideMenu;
            document.getElementById('slide-menu-profile-btn').onclick = () => { showProfilePage(); closeSlideMenu(); };
            document.getElementById('slide-menu-settings-btn').onclick = () => { showSettingsPage(); closeSlideMenu(); };
            if (isAdmin) {
                document.getElementById('slide-menu-admin-withdrawals').onclick = () => { showAdminWithdrawalsPage(); closeSlideMenu(); };
                document.getElementById('slide-menu-admin-users').onclick = () => { showAdminUsersPage(); closeSlideMenu(); };
                document.getElementById('slide-menu-admin-gift-codes').onclick = () => { showAdminGiftCodesPage(); closeSlideMenu(); };
                document.getElementById('slide-menu-admin-withdrawal-history').onclick = () => { showWithdrawalHistoryPage(); closeSlideMenu(); };
                document.getElementById('slide-menu-admin-bulk-send')?.addEventListener('click', () => {
                    if (typeof showAdminBulkSendPage === 'function') showAdminBulkSendPage();
                    closeSlideMenu();
                });
            }
            document.getElementById('slide-menu-logout-btn').onclick = () => {
                window.handleLogout();
            };
        };

const closeSlideMenu = () => {
            document.getElementById('slide-menu').classList.add('translate-x-full');
            document.getElementById('menu-overlay').classList.add('hidden');
        };

const showBlockedAccountPage = (data = currentUserData || {}) => {
            const details = getBanDetails(data);
            hideLoading();
            setMainChrome(false);
            document.getElementById('auth-screen')?.classList.add('hidden');
            document.getElementById('main-content')?.classList.remove('hidden');
            document.getElementById('dashboard-content')?.classList.add('hidden');
            document.getElementById('menu-overlay')?.classList.add('hidden');
            document.getElementById('slide-menu')?.classList.add('translate-x-full');

            // Hide all bottom nav buttons except Chat
            document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
                if (btn.id === 'bottom-help-btn') {
                    btn.classList.remove('hidden');
                    btn.classList.add('active');
                } else {
                    btn.classList.add('hidden');
                }
            });

            // Open Chat page directly
            const targetUid = currentUser?.uid || data?.uid || data?.id;
            if (targetUid && typeof openSupportChatPage === 'function') {
                openSupportChatPage(targetUid, 'user', {
                    initialMessage: `My account is blocked. Reason: ${details.reason}. Ban duration: ${details.time}. Please help unban my account.`,
                    returnToBlocked: true,
                    blockedData: data
                });
            }

            // Render persistent Banned Popup Modal
            renderModal('Account Blocked', `
                <div class="space-y-4 text-center">
                    <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600">
                        <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-xl font-black text-gray-900 dark:text-white">Account Blocked</h3>
                        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Your account is suspended by admin. You can send messages to support below.</p>
                    </div>
                    <div class="rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 p-3.5 text-left">
                        <p class="text-[10px] font-black uppercase text-red-500 dark:text-red-300">Reason for Ban</p>
                        <p class="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(details.reason)}</p>
                    </div>
                    <div class="rounded-2xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700 p-3.5 text-left">
                        <p class="text-[10px] font-black uppercase text-gray-400">Ban Duration</p>
                        <p class="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(details.time)}</p>
                    </div>
                </div>`,
                `<button onclick="window.closeModal()" class="w-full py-3 rounded-xl bg-blue-600 font-black text-xs uppercase tracking-wider text-white shadow-sm hover:bg-blue-700 transition">Chat with Support</button>`,
                'max-w-md'
            );
        };

const showVerificationPendingPage = (data = currentUserData || {}) => {
            const details = getApprovalDetails(data);
            hideLoading();
            setMainChrome(false);
            document.getElementById('auth-screen')?.classList.add('hidden');
            document.getElementById('main-content')?.classList.remove('hidden');
            document.getElementById('dashboard-content')?.classList.add('hidden');
            document.getElementById('menu-overlay')?.classList.add('hidden');
            document.getElementById('slide-menu')?.classList.add('translate-x-full');
            const pageContainer = document.getElementById('page-container');
            pageContainer.innerHTML = `
                <div id="verification-pending-container" class="min-h-[100dvh] flex items-center justify-center p-4 bg-gray-100 dark:bg-gray-900">
                    <div class="w-full max-w-md rounded-3xl bg-white dark:bg-gray-800 border border-amber-100 dark:border-amber-900/50 shadow-xl overflow-hidden">
                        <div class="bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white">
                            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M9 12l2 2 4-4"></path><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path>
                                </svg>
                            </div>
                            <h2 class="text-center text-2xl font-black">${escapeHtml(details.title)}</h2>
                            <p class="mt-2 text-center text-sm text-white/85">Admin review is required before wallet access.</p>
                        </div>
                        <div class="space-y-4 p-5">
                            <div class="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4">
                                <p class="text-xs font-black uppercase text-amber-600 dark:text-amber-200">Status</p>
                                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(details.message)}</p>
                            </div>
                            <div class="rounded-2xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-700 p-4">
                                <p class="text-xs font-black uppercase text-gray-400">Account</p>
                                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-white">${escapeHtml(data.name || data.email || 'New user')}</p>
                                ${details.requestedAt ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-300">Sent: ${new Date(details.requestedAt).toLocaleString('en-IN')}</p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>`;
            pageContainer.classList.remove('hidden');
            pageContainer.style.paddingBottom = '0';
            pageContainer.style.overflowY = 'hidden';
        };

const getPageHeader = (title, options = {}) => {
    const isCentered = options.centerTitle || title === 'My Profile';
    return `
            <header class="flex items-center mb-6 p-4 bg-white dark:bg-gray-800 shadow-md page-header-fixed relative">
                ${options.showBack === false ? '' : `
                    <button class="page-back-btn p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 mr-2 z-10">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
                    </button>
                `}
                <h2 class="text-xl font-bold ${isCentered ? 'absolute inset-x-0 text-center pointer-events-none' : ''}">${title}</h2>
            </header>
            <div class="p-4 pt-0">`;
};
const getPageFooter = () => `</div>`;

const clientAppLogoCache = {};

const getSubmissionAppLogo = (s) => {
    if (!s) return 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';
    const taskId = s.task_id || s.taskId;
    if (!taskId) return 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';

    const defaultPlaceholder = 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';

    // Find task fallback image from cache
    let taskFallbackLogo = '';
    if (typeof allTasksCache !== 'undefined' && Array.isArray(allTasksCache)) {
        const task = allTasksCache.find(t => t && t.id === taskId);
        if (task) {
            taskFallbackLogo = task.imageUrl || task.logoUrl || task.iconUrl || '';
            if (taskFallbackLogo.includes('play.google.com') || taskFallbackLogo.includes('play-store')) {
                taskFallbackLogo = '';
            }
        }
    }

    // 1. Get taskAppId from submission or cached task
    let taskAppId = s.appId || s.app_id || '';
    if (typeof allTasksCache !== 'undefined' && Array.isArray(allTasksCache)) {
        const task = allTasksCache.find(t => t && t.id === taskId);
        if (task) {
            taskAppId = task.appId || task.app_id || taskAppId;
        }
    }

    if (!taskAppId) {
        return taskFallbackLogo || defaultPlaceholder;
    }

    // 2. Check in-memory logo cache
    if (clientAppLogoCache[taskAppId]) {
        return clientAppLogoCache[taskAppId];
    }

    // 3. Fetch from Firestore (apps collection) asynchronously and update DOM elements matching data-app-id
    if (typeof db !== 'undefined' && typeof appId !== 'undefined' && typeof doc === 'function' && typeof getDoc === 'function') {
        try {
            const appDocRef = doc(db, `artifacts/${appId}/public/data/apps`, taskAppId);
            getDoc(appDocRef).then(docSnap => {
                if (docSnap.exists()) {
                    const appData = docSnap.data();
                    const logo = appData.logoUrl || appData.logo || appData.imageUrl || '';
                    if (logo) {
                        clientAppLogoCache[taskAppId] = logo;
                        // Update all img tags with data-app-id="taskAppId"
                        const imgs = document.querySelectorAll(`img[data-app-id="${taskAppId}"]`);
                        imgs.forEach(img => {
                            img.src = logo;
                        });
                    }
                }
            }).catch(err => console.warn('Failed to fetch app logo from Firestore:', err));
        } catch (e) {
            console.warn('Error fetching logo from Firestore:', e);
        }
    }

    return taskFallbackLogo || defaultPlaceholder;
};

const getSubmissionDateText = (submittedAt) => {
    if (!submittedAt) return 'Unknown';
    let ms = 0;
    if (typeof submittedAt === 'object') {
        if (typeof submittedAt.toDate === 'function') {
            return submittedAt.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        }
        if (submittedAt.seconds) {
            ms = submittedAt.seconds * 1000;
        } else if (submittedAt._seconds) {
            ms = submittedAt._seconds * 1000;
        }
    } else {
        ms = Number(submittedAt);
    }
    if (!ms || isNaN(ms)) return 'Unknown';
    return new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const getTaskTypeLabel = (s) => {
    if (!s) return 'Play Store Review';
    const isReview = !!(s.assigned_comment && String(s.assigned_comment).trim().length > 0);
    const link = s.task_link || s.taskLink || '';
    
    // 1. Try to find the task in allTasksCache to get the actual sub-type/name
    if (typeof allTasksCache !== 'undefined' && Array.isArray(allTasksCache)) {
        const task = allTasksCache.find(t => t && t.id === (s.task_id || s.taskId));
        if (task) {
            const type = task.taskType || task.type || task.subtype || '';
            if (type) {
                const lowerType = String(type).toLowerCase();
                if (lowerType.includes('google') || lowerType.includes('map')) return 'Google Maps Review';
                if (lowerType.includes('play') || lowerType.includes('review')) return 'Play Store Review';
                if (lowerType.includes('screenshot')) return 'Screenshot Task';
                if (lowerType.includes('custom')) return 'Custom Task';
                return String(type).split(/[_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }
    }
    
    // 2. Fallbacks based on link and assigned_comment
    if (typeof link === 'string') {
        if (link.includes('play.google.com') || isReview) {
            return 'Play Store Review';
        }
        if (link.includes('maps.google.com') || link.includes('google.com/maps')) {
            return 'Google Maps Review';
        }
        if (link.includes('custom')) {
            return 'Custom Task';
        }
    }
    return isReview ? 'Play Store Review' : 'Screenshot Task';
};

const getPayoutBadgeLabel = (s) => {
    if (!s) return 'Instant';
    const delayDays = Number(s.payout_delay_days || s.payoutDelayDays || 0);
    if (delayDays === 0) return 'Instant';
    if (delayDays === 3) return '3 Days';
    if (delayDays === 5) return '5 Days';
    if (delayDays === 7) return '7 Days';
    return `${delayDays} Days`;
};

const getUserTaskHistoryListHtml = () => {
    const categoryTab = window.userTaskHistoryActiveTab || 'all';
    const statusFilter = window.userTaskHistoryStatusFilter || 'all';
    const isBulker = isBulkTaskUser();


    let subs = [...(userTaskHistoryCache || [])].filter(s => s);
    // Disabled filtering by allTasksCache to ensure users can always see all their historical submissions
    // even if the task has expired, finished, or is no longer listed in active/public tasks.

    // Filter by category
    if (categoryTab !== 'all') {
        subs = subs.filter(s => {
            const isReview = !!(s.assigned_comment && String(s.assigned_comment).trim().length > 0);
            return categoryTab === 'play_store' ? isReview : !isReview;
        });
    }

    // Filter by status (only for Single Users)
    if (!isBulker && statusFilter !== 'all') {
        if (statusFilter === 'paid') {
            subs = subs.filter(s => s.payout_status === 'paid');
        } else if (statusFilter === 'approved') {
            subs = subs.filter(s => s.manual_status === 'approved' && s.payout_status !== 'paid');
        } else {
            subs = subs.filter(s => s.manual_status === statusFilter);
        }
    }

    if (subs.length === 0) {
        return `<div class="rounded-3xl py-12 text-center text-xs font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-dashed border-gray-150 dark:border-gray-800">No submissions found.</div>`;
    }

    if (isBulker) {
        // Group submissions by task_id
        const taskGroups = {};
        subs.forEach(s => {
            const tId = s.task_id || s.taskId;
            if (!tId) return;
            if (!taskGroups[tId]) {
                taskGroups[tId] = {
                    taskId: tId,
                    taskName: s.app_name || s.taskTitle || 'Task',
                    logoUrl: getSubmissionAppLogo(s),
                    reward: s.reward || 0,
                    submissions: [],
                    lastUpdated: s.submitted_at || 0
                };
            }
            taskGroups[tId].submissions.push(s);
            if (s.submitted_at > taskGroups[tId].lastUpdated) {
                taskGroups[tId].lastUpdated = s.submitted_at;
            }
        });

        const groupsArray = Object.values(taskGroups);
        if (groupsArray.length === 0) {
            return `<div class="rounded-3xl py-12 text-center text-xs font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-dashed border-gray-150 dark:border-gray-800">No submissions found.</div>`;
        }

        return groupsArray.map(g => {
            const total = g.submissions.length;
            const approvedCount = g.submissions.filter(s => s.manual_status === 'approved').length;
            const pendingCount = g.submissions.filter(s => s.manual_status === 'pending').length;
            const rejectedCount = g.submissions.filter(s => s.manual_status === 'rejected').length;
            
            const completionPercent = total > 0 ? Math.round((approvedCount / total) * 100) : 0;
            const dateStr = g.lastUpdated 
                ? new Date(g.lastUpdated).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) 
                : 'Unknown';

            const task = (typeof allTasksCache !== 'undefined' && Array.isArray(allTasksCache)) 
                ? allTasksCache.find(t => t && t.id === g.taskId) 
                : null;
            
            const firstSub = g.submissions[0] || {};
            const family = firstSub.taskFamily || task?.taskFamily || task?.family || 'review';
            const subtype = firstSub.taskSubtype || task?.taskSubtype || task?.subtype || 'app_review';
            
            let subtypeLabel = 'Play Store Review';
            let subtypeLogo = 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Google_Play_Arrow_Logo_%282022%29.svg';
            
            if (typeof ADMIN_TASK_REVIEW_TYPES !== 'undefined' && typeof ADMIN_TASK_SOCIAL_TYPES !== 'undefined') {
                const allTypes = [...ADMIN_TASK_REVIEW_TYPES, ...ADMIN_TASK_SOCIAL_TYPES];
                const matchedType = allTypes.find(t => t.value === subtype);
                if (matchedType) {
                    subtypeLabel = matchedType.label;
                    subtypeLogo = matchedType.logo;
                }
            }
            if (subtype === 'app_review') {
                subtypeLabel = 'Play Store Review';
            }

            return `
            <div class="bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:shadow-[0_4px_16px_rgba(0,0,0,0.03)] cursor-pointer transition select-none text-left space-y-2 shadow-[0_2px_8px_rgba(0,0,0,0.012)]" onclick="window.showBulkerTaskOverview('${g.taskId}')">
                <!-- Top Section: App info and Arrow -->
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                        <img src="${escapeHtml(g.logoUrl)}" data-task-logo-id="${g.taskId}" class="h-11 w-11 rounded-xl object-cover shrink-0 border border-gray-50 dark:border-gray-700 shadow-sm" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3176/3176366.png';">
                        <div class="min-w-0 flex-1">
                            <h4 class="text-[14px] font-black text-gray-900 dark:text-white truncate leading-tight">${escapeHtml(g.taskName)}</h4>
                            <div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-450 dark:text-gray-400 font-bold">
                                <img src="${escapeHtml(subtypeLogo)}" class="h-3.5 w-3.5 shrink-0 rounded-sm object-contain bg-gray-50 dark:bg-gray-800 p-0.5 border border-gray-100 dark:border-gray-700 shadow-sm">
                                <span>${escapeHtml(subtypeLabel)} • ₹${g.reward}</span>
                            </div>
                        </div>
                    </div>
                    <svg class="h-5 w-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                </div>
                
                <!-- Stats Row -->
                <div class="flex items-center justify-between text-center select-none py-1.5 border-y border-gray-50/50 dark:border-gray-750/30">
                    <div class="flex-1">
                        <span class="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 leading-none">Submitted</span>
                        <span class="block text-[18px] font-black text-gray-900 dark:text-white mt-1 leading-none">${total}</span>
                    </div>
                    <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                    <div class="flex-1">
                        <span class="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 leading-none">Approved</span>
                        <span class="block text-[18px] font-black text-emerald-500 mt-1 leading-none">${approvedCount}</span>
                    </div>
                    <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                    <div class="flex-1">
                        <span class="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 leading-none">Pending</span>
                        <span class="block text-[18px] font-black text-amber-500 mt-1 leading-none">${pendingCount}</span>
                    </div>
                    <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                    <div class="flex-1">
                        <span class="block text-[10px] font-semibold text-gray-400 dark:text-gray-500 leading-none">Rejected</span>
                        <span class="block text-[18px] font-black text-rose-500 mt-1 leading-none">${rejectedCount}</span>
                    </div>
                </div>
                
                <!-- Completion Bar -->
                <div class="flex items-center gap-3 pt-0.5">
                    <div class="flex-1 bg-slate-100 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                        <div class="bg-indigo-600 h-full rounded-full" style="width: ${completionPercent}%"></div>
                    </div>
                    <span class="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 shrink-0 leading-none">${completionPercent}% Approved</span>
                </div>
                
                <!-- Footer -->
                <p class="text-[9px] text-gray-400 dark:text-gray-500 font-semibold leading-none mt-0.5">Last Updated: ${dateStr}</p>
            </div>`;
        }).join('');
    } else {
        // Single User Flow Cards
        return subs.map(s => {
            const delayDays = Number(s.payout_delay_days || s.payoutDelayDays || 7);
            
            // STATUS MEANING MAPPING
            let statusColor = 'blue';
            let statusText = 'Under Review';
            let statusEmoji = '🔵';
            let statusIcon = `<svg class="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"></path></svg>`;

            if (s.manual_status === 'approved') {
                statusColor = 'emerald';
                statusText = 'Approved';
                statusEmoji = '🟢';
                statusIcon = `<svg class="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`;
            } else if (s.manual_status === 'rejected') {
                statusColor = 'rose';
                statusText = 'Rejected';
                statusEmoji = '🔴';
                statusIcon = `<svg class="h-3.5 w-3.5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path></svg>`;
            } else if (s.manual_status === 'pending') {
                if (s.ocr_status === 'completed') {
                    statusColor = 'orange';
                    statusText = 'Pending';
                    statusEmoji = '🟡';
                    statusIcon = `<svg class="h-3.5 w-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path></svg>`;
                } else {
                    statusColor = 'blue';
                    statusText = 'Under Review';
                    statusEmoji = '🔵';
                    statusIcon = `<svg class="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"></path></svg>`;
                }
            }

            // Robust Date Parsing
            const timeStr = getSubmissionDateText(s.submitted_at || s.submittedAt);

            // Auto-fetch logo logic (asynchronously loads if missing)
            const appLogo = getSubmissionAppLogo(s);
            
            // Get taskAppId for the data-app-id attribute
            const taskId = s.task_id || s.taskId;
            let taskAppId = s.appId || s.app_id || '';
            if (typeof allTasksCache !== 'undefined' && Array.isArray(allTasksCache)) {
                const task = allTasksCache.find(t => t && t.id === taskId);
                if (task) {
                    taskAppId = task.appId || task.app_id || taskAppId;
                }
            }

            // Task Type and Payout Badges (Fetched and structured)
            const typeBadgeText = getTaskTypeLabel(s);
            const payoutBadgeText = getPayoutBadgeLabel(s);

            let typeBadgeBg = 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-150/50';
            if (typeBadgeText.includes('Maps')) {
                typeBadgeBg = 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 border-blue-150/50';
            } else if (typeBadgeText.includes('Screenshot')) {
                typeBadgeBg = 'bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 border-orange-150/50';
            } else if (typeBadgeText.includes('Custom')) {
                typeBadgeBg = 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-150/50';
            }
            
            const payoutBadgeBg = payoutBadgeText === 'Instant' 
                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-150/50'
                : 'bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border-purple-150/50';

            // Calculate Group 2: Payout / Days Left automatically
            let payoutHtml = '';
            if (s.payout_status !== 'paid' && s.manual_status !== 'rejected') {
                const delayDays = Number(s.payout_delay_days || s.payoutDelayDays || 0);
                const submittedMs = s.submitted_at || s.submittedAt || Date.now();
                
                let submittedTimeMs = Date.now();
                if (submittedMs) {
                    if (typeof submittedMs === 'object') {
                        if (typeof submittedMs.toDate === 'function') {
                            submittedTimeMs = submittedMs.toDate().getTime();
                        } else if (submittedMs.seconds) {
                            submittedTimeMs = submittedMs.seconds * 1000;
                        } else if (submittedMs._seconds) {
                            submittedTimeMs = submittedMs._seconds * 1000;
                        }
                    } else {
                        submittedTimeMs = Number(submittedMs) || Date.now();
                    }
                }
                
                let payoutText = payoutBadgeText;
                let payoutEmoji = payoutBadgeText === 'Instant' ? '⚡' : '🕒';
                
                if (delayDays > 0) {
                    const targetMs = submittedTimeMs + (delayDays * 24 * 60 * 60 * 1000);
                    const msLeft = targetMs - Date.now();
                    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
                    
                    if (daysLeft > 0) {
                        payoutText = `${daysLeft} Days Left`;
                    } else {
                        payoutText = 'Instant';
                        payoutEmoji = '⚡';
                    }
                }
                
                payoutHtml = `
                    <!-- Group 2: Payout -->
                    <div class="flex items-center gap-1 text-gray-500 dark:text-gray-400 shrink-0">
                        <span>${payoutEmoji}</span>
                        <span>${payoutText}</span>
                    </div>
                `;
            }

            return `
            <div class="bg-white dark:bg-gray-800 p-3 rounded-2xl hover:shadow-[0_4px_16px_rgba(0,0,0,0.02)] cursor-pointer transition select-none text-left flex flex-col gap-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.015)]" onclick="window.showUserTaskHistoryDetail('${s.id}')">
                <!-- Top Section (Logo, Name, Badges, Reward) -->
                <div class="flex items-center gap-3">
                    <img src="${escapeHtml(appLogo)}" data-app-id="${taskAppId}" class="h-10 w-10 rounded-xl object-cover shrink-0 border border-gray-50 dark:border-gray-700 shadow-sm" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3176/3176366.png';">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="rounded-lg ${typeBadgeBg} px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border">
                                ${typeBadgeText}
                            </span>
                            <span class="rounded-lg ${payoutBadgeBg} px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border">
                                ${payoutBadgeText}
                            </span>
                        </div>
                        <h4 class="text-xs font-extrabold text-gray-900 dark:text-white truncate mt-1.5">${escapeHtml(s.app_name || 'Task Submission')}</h4>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-xs font-black text-indigo-600 dark:text-indigo-400">₹${s.reward}</p>
                    </div>
                </div>
                
                <!-- Divider -->
                <div class="border-t border-gray-100 dark:border-gray-750/50"></div>
                
                <!-- Bottom Status Row (Google Pay style flex-gap layout) -->
                <div class="flex items-center gap-5 text-[10px] sm:text-[11px] font-bold w-full select-none mt-1 pb-0.5">
                    <!-- Group 1: Status -->
                    <div class="flex items-center gap-1 text-${statusColor}-600 dark:text-${statusColor}-400 shrink-0">
                        <span>${statusEmoji}</span>
                        <span>${statusText}</span>
                    </div>
                    
                    ${payoutHtml}
                    
                    <!-- Group 3: Submission Date & Arrow -->
                    <div class="ml-auto flex items-center gap-1.5 text-gray-400 dark:text-gray-500 shrink-0">
                        <span>${timeStr}</span>
                        <svg class="h-3.5 w-3.5 text-gray-350 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
};

const showUserTaskHistoryPage = () => {
            if (!ensureUserSessionReady()) return;
            
            // Store current active tab and status filter on window so they persist
            if (typeof window.userTaskHistoryActiveTab === 'undefined') {
                window.userTaskHistoryActiveTab = 'all';
            }
            if (typeof window.userTaskHistoryStatusFilter === 'undefined') {
                window.userTaskHistoryStatusFilter = 'all';
            }
            if (typeof window.userTaskHistoryFilterDrawerOpen === 'undefined') {
                window.userTaskHistoryFilterDrawerOpen = false;
            }

            const isBulker = isBulkTaskUser();
            const title = isBulker ? 'Task History (Bulker)' : 'Task History';

            // Load from localStorage cache if memory cache is empty for instant rendering
            if ((!userTaskHistoryCache || userTaskHistoryCache.length === 0) && typeof currentUser !== 'undefined' && currentUser?.uid) {
                const cached = readJsonCache(getUserTaskHistoryCacheKey(currentUser.uid));
                if (Array.isArray(cached) && cached.length > 0) {
                    userTaskHistoryCache = cached;
                }
            }

            // INSTANT LOAD: render list content immediately if cached data is present!
            const initialListHtml = (userTaskHistoryCache && userTaskHistoryCache.length > 0)
                ? getUserTaskHistoryListHtml()
                : `<div class="py-8 text-center text-sm text-gray-450 dark:text-gray-500">Loading history...</div>`;

            const content = `
                ${isBulker ? `
                <header class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-750 page-header-fixed select-none">
                    <button class="page-back-btn p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-white shrink-0" style="outline: none;">
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                    </button>
                    <h2 class="text-md font-extrabold text-gray-900 dark:text-white text-center flex-1 pr-1">${title}</h2>
                    <button class="h-8 w-8 rounded-full bg-gray-55 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center text-sm font-black border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 shadow-sm shrink-0 mr-1" style="outline: none; line-height: 1;" onclick="window.showBulkerStatusMeaningDialog()">
                        ?
                    </button>
                </header>
                ` : `
                <header class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-750 page-header-fixed">
                    <div class="flex items-center gap-3">
                        <button class="page-back-btn p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 mr-1 shrink-0 text-gray-700 dark:text-white" style="outline: none;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                        </button>
                        <h2 class="text-lg font-black text-gray-900 dark:text-white">${title}</h2>
                    </div>
                </header>
                `}
                
                <div class="max-w-xl mx-auto space-y-3 pb-24 px-4 pt-3 text-left">
                    <!-- Category Tabs (Segmented Control Layout) -->
                    <div class="flex p-1 bg-gray-100 dark:bg-gray-900 rounded-2xl select-none mb-2">
                        ${['all', 'play_store', 'others'].map(tab => {
                            const isActive = window.userTaskHistoryActiveTab === tab;
                            const label = tab === 'all' ? 'All' : tab === 'play_store' ? 'Play Store' : 'Others';
                            return `
                                <button type="button" data-action="select-history-tab" data-tab="${tab}" class="flex-1 text-center py-2 text-xs font-black rounded-xl transition-all duration-200 ${isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}" style="outline: none;">
                                    ${label}
                                </button>
                            `;
                        }).join('')}
                    </div>

                    <!-- Toggleable Status Filter Chips (Single User Only) -->
                    ${!isBulker && window.userTaskHistoryFilterDrawerOpen ? `
                    <div class="flex flex-wrap items-center gap-1.5 p-1.5 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-150 dark:border-gray-750">
                        ${['all', 'pending', 'approved', 'paid', 'rejected'].map(status => {
                            const isActive = window.userTaskHistoryStatusFilter === status;
                            const label = status === 'all' ? 'All Status' : status.charAt(0).toUpperCase() + status.slice(1);
                            return `
                                <button type="button" data-action="select-status-filter" data-status="${status}" class="flex-1 text-center py-1.5 text-[10px] font-black rounded-xl transition-all ${isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-805 dark:hover:text-gray-200'}" style="outline: none;">
                                    ${label}
                                </button>
                            `;
                        }).join('')}
                    </div>
                    ` : ''}

                    <!-- List Container (Loaded Instantly) -->
                    <div id="user-task-history-list" class="space-y-3">
                        ${initialListHtml}
                    </div>
                </div>
                ${getPageFooter()}`;

            showPage(content, { returnTo: 'settings', keepBottomNav: true });
            
            // Bind Tab Click Handlers
            const pageEl = document.getElementById('page-container');
            if (pageEl) {
                pageEl.querySelectorAll('[data-action="select-history-tab"]').forEach(btn => {
                    btn.onclick = (e) => {
                        window.userTaskHistoryActiveTab = e.currentTarget.dataset.tab;
                        showUserTaskHistoryPage();
                    };
                });

                // Bind Status Filter Chip Handlers
                pageEl.querySelectorAll('[data-action="select-status-filter"]').forEach(btn => {
                    btn.onclick = (e) => {
                        window.userTaskHistoryStatusFilter = e.currentTarget.dataset.status;
                        showUserTaskHistoryPage();
                    };
                });

                // Bind Toggle Filter Drawer
                const filterToggle = document.getElementById('user-task-history-filter-toggle');
                if (filterToggle) {
                    filterToggle.onclick = () => {
                        window.userTaskHistoryFilterDrawerOpen = !window.userTaskHistoryFilterDrawerOpen;
                        showUserTaskHistoryPage();
                    };
                }
            }

            // Fetch latest data silently in the background
            loadUserTaskHistory();
        };

const loadUserTaskHistory = async () => {
            if (userTaskHistoryLoading) return;

            // Load from localStorage cache if memory cache is empty to make it instant
            if ((!userTaskHistoryCache || userTaskHistoryCache.length === 0) && typeof currentUser !== 'undefined' && currentUser?.uid) {
                const cached = readJsonCache(getUserTaskHistoryCacheKey(currentUser.uid));
                if (Array.isArray(cached) && cached.length > 0) {
                    userTaskHistoryCache = cached;
                    const listEl = document.getElementById('user-task-history-list');
                    if (listEl) {
                        listEl.innerHTML = getUserTaskHistoryListHtml();
                    }
                }
            }

            userTaskHistoryLoading = true;
            try {
                // 1. Fetch latest tasks from Firestore to update allTasksCache
                if (typeof db !== 'undefined' && typeof appId !== 'undefined' && typeof collection === 'function' && typeof getDocs === 'function') {
                    try {
                        const tasksSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/tasks`));
                        allTasksCache = tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        localStorage.setItem('all_tasks_cache', JSON.stringify(allTasksCache));
                    } catch (taskErr) {
                        console.warn('Failed to refresh tasks in history page:', taskErr);
                    }
                }

                // 2. Fetch submissions from Backend API
                const token = await getBackendAuthToken();
                const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-submissions`, {
                    headers: { Authorization: `Bearer ${token}` }
                }, 10000);
                const data = await response.json().catch(() => ({}));
                if (data.ok && Array.isArray(data.submissions)) {
                    userTaskHistoryCache = data.submissions;
                    const todayStart = typeof getStartOfTodayMillis === 'function' ? getStartOfTodayMillis() : new Date().setHours(0, 0, 0, 0);
                    data.submissions.forEach(s => {
                        const taskId = s.taskId || s.task_id;
                        if (taskId) {
                            userTaskSubmissionIds.add(taskId);
                            const submittedAt = timestampToMillis(s.submittedAt || s.createdAt || s.timestamp);
                            if (submittedAt >= todayStart) userTaskTodaySubmissionIds.add(taskId);
                        }
                    });
                    // Update cache in localStorage
                    if (typeof currentUser !== 'undefined' && currentUser?.uid) {
                        writeJsonCache(getUserTaskHistoryCacheKey(currentUser.uid), data.submissions);
                    }
                    if (typeof renderHomeTaskCategories === 'function') renderHomeTaskCategories();
                } else {
                    userTaskHistoryCache = [];
                    if (typeof currentUser !== 'undefined' && currentUser?.uid) {
                        writeJsonCache(getUserTaskHistoryCacheKey(currentUser.uid), []);
                    }
                }
            } catch (err) {
                if (typeof isExpectedBackgroundAbort === 'function' && isExpectedBackgroundAbort(err)) {
                    userTaskHistoryLoading = false;
                    return;
                }
                console.error('Failed to load user task history:', err);
                // Keep the cached items on error instead of resetting to empty array!
                if (!userTaskHistoryCache || userTaskHistoryCache.length === 0) {
                    userTaskHistoryCache = [];
                }
            }
            userTaskHistoryLoading = false;
            
            // Update UI list container silently without resetting scroll or flashing
            const listEl = document.getElementById('user-task-history-list');
            if (listEl) {
                listEl.innerHTML = getUserTaskHistoryListHtml();
            }
        };

const renderUserTaskHistory = () => {
            const listEl = document.getElementById('user-task-history-list');
            if (listEl) {
                listEl.innerHTML = getUserTaskHistoryListHtml();
            }
        };

window.showUserTaskHistoryDetail = (submissionId) => {
            const isBulker = isBulkTaskUser();
            if (isBulker) {
                window.showBulkerSubmissionDetail(submissionId);
                return;
            }

            const idx = userTaskHistoryCache.findIndex(x => x.id === submissionId);
            if (idx === -1) return;
            const s = userTaskHistoryCache[idx];

            const timeStr = s.submitted_at 
                ? new Date(s.submitted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) 
                : 'Unknown';

            const appLogo = getSubmissionAppLogo(s);
            const isReviewTask = !!(s.assigned_comment && String(s.assigned_comment).trim().length > 0);
            const delayDays = Number(s.payout_delay_days || s.payoutDelayDays || 7);

            // Compute remaining days
            const submittedMs = s.submitted_at || s.submittedAt;
            const submittedTimeMs = typeof submittedMs === 'object' && submittedMs.seconds ? submittedMs.seconds * 1000 : Number(submittedMs);
            const targetMs = submittedTimeMs + (delayDays * 24 * 60 * 60 * 1000);
            const msLeft = targetMs - Date.now();
            const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
            const daysLeftText = daysLeft > 0 ? `In ${daysLeft} Days` : 'Instant';

            // Generate clean dynamic developer name
            const cleanAppName = s.app_name || 'App';
            const firstWord = cleanAppName.split(' ')[0] || 'App';
            const devName = `${firstWord.replace(/[^a-zA-Z0-9]/g, '')} LLC`;

            // Timeline calculations
            let stage2Sub = 'Checking on Play Store';
            if (s.manual_status === 'approved' || s.manual_status === 'rejected') {
                stage2Sub = 'Verified';
            }

            let stage3Sub = delayDays === 0 ? 'Instant' : `In ${delayDays} Days`;
            if (s.manual_status === 'approved') {
                stage3Sub = 'Approved';
            } else if (s.manual_status === 'rejected') {
                stage3Sub = 'Rejected';
            }

            let stage4Sub = 'After Approval';
            if (s.payout_status === 'paid') {
                stage4Sub = 'Paid';
            } else if (s.manual_status === 'approved') {
                stage4Sub = daysLeftText;
            }

            const getStageStyle = (stage) => {
                if (stage === 1) {
                    return {
                        circleBg: 'bg-emerald-500 ring-4 ring-emerald-50 dark:ring-emerald-950/20 text-white',
                        icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                    };
                }
                if (stage === 2) {
                    if (s.manual_status === 'approved' || s.manual_status === 'rejected') {
                        return {
                            circleBg: 'bg-emerald-500 ring-4 ring-emerald-50 dark:ring-emerald-950/20 text-white',
                            icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                        };
                    }
                    return {
                        circleBg: 'bg-indigo-600 ring-4 ring-indigo-50 dark:ring-indigo-950/20 text-white animate-pulse',
                        icon: `<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.637 10.637Z"/></svg>`
                    };
                }
                if (stage === 3) {
                    if (s.manual_status === 'approved') {
                        return {
                            circleBg: 'bg-emerald-500 ring-4 ring-emerald-50 dark:ring-emerald-950/20 text-white',
                            icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                        };
                    }
                    if (s.manual_status === 'rejected') {
                        return {
                            circleBg: 'bg-rose-500 ring-4 ring-rose-50 dark:ring-rose-950/20 text-white',
                            icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>`
                        };
                    }
                    return {
                        circleBg: 'bg-gray-200 dark:bg-gray-700 ring-4 ring-gray-100 dark:ring-gray-800 text-gray-400',
                        icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path></svg>`
                    };
                }
                if (stage === 4) {
                    if (s.payout_status === 'paid') {
                        return {
                            circleBg: 'bg-emerald-500 ring-4 ring-emerald-50 dark:ring-emerald-950/20 text-white',
                            icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                        };
                    }
                    return {
                        circleBg: 'bg-gray-200 dark:bg-gray-700 ring-4 ring-gray-100 dark:ring-gray-800 text-gray-400',
                        icon: `<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/></svg>`
                    };
                }
            };

            const stage1 = getStageStyle(1);
            const stage2 = getStageStyle(2);
            const stage3 = getStageStyle(3);
            const stage4 = getStageStyle(4);

            const taskIndexVal = s.task_index || s.taskIndex || 1;
            const commentIndexVal = s.comment_index !== undefined ? s.comment_index : (s.commentIndex ?? s.assignedCommentIndex ?? 0);
            const displaySubmissionId = `#${String(taskIndexVal).padStart(2, '0')}_${String(commentIndexVal + 1).padStart(2, '0')}`;

            const detailContent = `
                <header class="relative flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-750 page-header-fixed">
                    <button class="page-back-btn p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-white" style="outline: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h2 class="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-gray-900 dark:text-white">Task Status</h2>
                    <!-- Question help button inside top header -->
                    <button type="button" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" onclick="window.showSubmissionStatusPage('${s.id}')" style="outline: none;">
                        <svg class="h-6 w-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"/>
                        </svg>
                    </button>
                </header>

                <div class="max-w-xl mx-auto space-y-4 pb-24 px-4 pt-4 text-left">
                    <!-- App Card Header (Premium Border Box - Compact) -->
                    <div class="bg-white dark:bg-gray-800 py-2.5 px-3 rounded-2xl border border-gray-150 dark:border-gray-750 shadow-sm overflow-hidden select-none">
                        <div class="flex items-center justify-between gap-2.5">
                            <div class="flex items-center gap-2 min-w-0">
                                <img src="${escapeHtml(appLogo)}" class="h-11 w-11 rounded-xl object-cover shrink-0 border border-gray-100 dark:border-gray-700 shadow-sm" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3176/3176366.png';">
                                <div class="min-w-0">
                                    <h3 class="text-sm font-black text-gray-900 dark:text-white truncate" style="margin: 0 !important; padding: 0 !important; line-height: 1.1 !important;">${escapeHtml(s.app_name || 'Task Submission')}</h3>
                                    <div class="flex items-center gap-1 text-[11px] text-gray-400 font-semibold" style="margin: 0 !important; padding: 0 !important; margin-top: 2px !important; line-height: 1.1 !important;">
                                        <img src="https://upload.wikimedia.org/wikipedia/commons/d/d0/Google_Play_Arrow_logo.svg" class="h-3 w-3 object-contain shrink-0" alt="Play Store">
                                        <span>Play Store Review</span>
                                    </div>
                                </div>
                            </div>
                            <!-- Payout square box badge -->
                            <div class="flex items-center justify-center h-10 w-10 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 shrink-0">
                                <span class="text-sm font-black text-purple-600 dark:text-purple-400">₹${s.reward}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Row of 3 stats cards -->
                    <div class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-150 dark:border-gray-700 py-3 px-2 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
                        <div class="grid grid-cols-3 divide-x divide-gray-150 dark:divide-gray-700 text-left select-none">
                            <!-- Payout Card -->
                            <div class="flex items-center gap-2 pl-1.5">
                                <div class="text-emerald-500 shrink-0">
                                    <svg class="h-6 w-6 text-emerald-500 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="width: 24px; height: 24px;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] text-gray-400 font-bold uppercase tracking-wider leading-none">Payout</p>
                                    <p class="text-xs font-black text-gray-800 dark:text-white mt-1 leading-none">₹${s.reward}</p>
                                </div>
                            </div>
                            
                            <!-- Approval Time Card -->
                            <div class="flex items-center gap-2 pl-2">
                                <div class="text-blue-500 shrink-0">
                                    <svg class="h-6 w-6 text-blue-500 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="width: 24px; height: 24px;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] text-gray-400 font-bold uppercase tracking-wider leading-none">Approval</p>
                                    <p class="text-xs font-black text-gray-800 dark:text-white mt-1 leading-none">${delayDays === 0 ? 'Instant' : `${delayDays} Days`}</p>
                                </div>
                            </div>
                            
                            <!-- Task Type Card -->
                            <div class="flex items-center gap-2 pl-2">
                                <div class="text-purple-500 shrink-0">
                                    <svg class="h-6 w-6 text-purple-500 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="width: 24px; height: 24px;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[9px] text-gray-400 font-bold uppercase tracking-wider leading-none">Task Type</p>
                                    <p class="text-xs font-black text-gray-800 dark:text-white mt-1 leading-none">${isReviewTask ? 'Play Store' : 'Others'}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Stepper Timeline (Horizontal Layout) -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-150 dark:border-gray-750 shadow-sm">
                        <div class="relative py-2 select-none">
                            <!-- Horizontal line in background connecting the step circles -->
                            <div class="absolute left-[12.5%] right-[12.5%] top-[24px] h-[2px] bg-gray-200 dark:bg-gray-700"></div>
                            
                            <div class="flex items-start justify-between relative z-10">
                                <!-- Step 1: Submitted -->
                                <div class="flex flex-col items-center text-center w-1/4">
                                    <div class="flex shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm border border-emerald-600" style="width: 32px; height: 32px; min-width: 32px; min-height: 32px; max-width: 32px; max-height: 32px; border-radius: 50%;">
                                        <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
                                        </svg>
                                    </div>
                                    <p class="text-[10px] font-black text-gray-900 dark:text-white mt-1.5 leading-none">Submitted</p>
                                    <p class="text-[8px] text-gray-400 font-bold mt-1.5 leading-tight">${timeStr.split(',')[0] || ''}</p>
                                    <p class="text-[7.5px] text-gray-400 font-semibold leading-tight mt-0.5">${timeStr.split(',')[1] || ''}</p>
                                </div>

                                <!-- Step 2: Under Review -->
                                <div class="flex flex-col items-center text-center w-1/4">
                                    <div class="flex shrink-0 items-center justify-center rounded-full ${stage2.circleBg} shadow-sm border ${s.manual_status === 'approved' || s.manual_status === 'rejected' ? 'border-emerald-600' : 'border-indigo-600'}" style="width: 32px; height: 32px; min-width: 32px; min-height: 32px; max-width: 32px; max-height: 32px; border-radius: 50%;">
                                        ${s.manual_status === 'approved' || s.manual_status === 'rejected' 
                                            ? `<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                                            : `<svg class="h-4.5 w-4.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"></path></svg>`}
                                    </div>
                                    <p class="text-[10px] font-black text-gray-900 dark:text-white mt-1.5 leading-none">Under Review</p>
                                    <p class="text-[8px] text-gray-400 font-bold mt-1.5 leading-tight">${stage2Sub}</p>
                                </div>

                                <!-- Step 3: Approval -->
                                <div class="flex flex-col items-center text-center w-1/4">
                                    <div class="flex shrink-0 items-center justify-center rounded-full ${stage3.circleBg} shadow-sm border ${s.manual_status === 'approved' ? 'border-emerald-600' : s.manual_status === 'rejected' ? 'border-rose-600' : 'border-gray-300 dark:border-gray-650'}" style="width: 32px; height: 32px; min-width: 32px; min-height: 32px; max-width: 32px; max-height: 32px; border-radius: 50%;">
                                        ${s.manual_status === 'approved'
                                            ? `<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                                            : s.manual_status === 'rejected'
                                            ? `<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"></path></svg>`
                                            : `<svg class="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path></svg>`}
                                    </div>
                                    <p class="text-[10px] font-black text-gray-900 dark:text-white mt-1.5 leading-none">Approval</p>
                                    <p class="text-[8px] text-gray-400 font-bold mt-1.5 leading-tight">${stage3Sub}</p>
                                </div>

                                <!-- Step 4: Payout -->
                                <div class="flex flex-col items-center text-center w-1/4">
                                    <div class="flex shrink-0 items-center justify-center rounded-full ${stage4.circleBg} shadow-sm border ${s.payout_status === 'paid' ? 'border-emerald-600' : 'border-gray-300 dark:border-gray-650'}" style="width: 32px; height: 32px; min-width: 32px; min-height: 32px; max-width: 32px; max-height: 32px; border-radius: 50%;">
                                        ${s.payout_status === 'paid'
                                            ? `<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>`
                                            : `<svg class="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"></path></svg>`}
                                    </div>
                                    <p class="text-[10px] font-black text-gray-900 dark:text-white mt-1.5 leading-none">Payout</p>
                                    <p class="text-[8px] text-gray-400 font-bold mt-1.5 leading-tight">${stage4Sub}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Your Submission Section (2-column side-by-side) -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-150 dark:border-gray-750 shadow-sm space-y-3.5">
                        <h4 class="text-sm font-black text-gray-900 dark:text-white">Your Submission</h4>
                        
                        <div class="flex items-start gap-4">
                            <!-- Left: Screenshot Preview Box (Narrow) -->
                            <div class="w-[110px] shrink-0 space-y-1.5">
                                <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Screenshot</span>
                                <div class="relative bg-gray-50 dark:bg-gray-900/60 p-1.5 rounded-2xl border border-gray-150 dark:border-gray-800 flex flex-col items-center justify-center shadow-sm hover:border-indigo-200 dark:hover:border-indigo-900 transition duration-200 cursor-pointer overflow-hidden h-[150px] w-[110px]" onclick="window.showScreenshotLightbox('${escapeHtml(s.screenshot_url)}', '${escapeHtml(s.screenshot_view_url || '')}')">
                                    <!-- Fullscreen Icon -->
                                    <button type="button" class="absolute top-1.5 right-1.5 p-1 rounded-lg text-gray-500 bg-white/90 dark:bg-gray-800/90 hover:text-gray-700 dark:hover:text-white shadow-sm transition" style="outline: none;">
                                        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m-11.25 11.25h4.5m-4.5 0v-4.5m0 4.5L9 15m11.25 0v4.5m0-4.5h-4.5m4.5 0L15 15" />
                                        </svg>
                                    </button>
                                    <img id="user-detail-screenshot-img" src="${escapeHtml(s.screenshot_url)}" class="max-h-[135px] max-w-[95px] object-contain rounded-xl shadow-sm" onerror="this.src='https://placehold.co/300x500?text=No+Screenshot+Available';">
                                </div>
                            </div>
                            
                            <!-- Right: Submission Details (Flexible/Wider) -->
                            <div class="flex-1 min-w-0">
                                <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Submission Details</span>
                                
                                ${s.manual_status === 'rejected' ? `
                                <div class="mt-2 space-y-2 text-[11px] font-semibold text-gray-655 dark:text-gray-300">
                                    <div class="flex justify-between items-center">
                                        <span class="text-gray-400 dark:text-gray-500">Status</span>
                                        <span class="text-[9px] font-black uppercase bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-455 px-1.5 py-0.5 rounded border border-rose-100 dark:border-rose-900/30">Rejected</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-400 dark:text-gray-500">Submission ID</span>
                                        <span class="font-extrabold text-gray-855 dark:text-white font-mono">${displaySubmissionId}</span>
                                    </div>
                                    <div class="flex justify-between border-t border-rose-100/50 pt-2 text-rose-600">
                                        <span class="text-gray-400 dark:text-gray-500">Reason</span>
                                        <span class="font-extrabold text-rose-750 dark:text-rose-400 text-right truncate max-w-[120px]" title="${escapeHtml(s.reject_reason || '')}">${escapeHtml(s.reject_reason || 'Review not found')}</span>
                                    </div>
                                    <div class="flex flex-col gap-0.5 border-t border-rose-100/50 pt-2">
                                        <span class="text-gray-400 dark:text-gray-500">Details</span>
                                        <span class="font-medium text-gray-600 dark:text-gray-405 text-left text-[10px] leading-snug italic max-h-[40px] overflow-y-auto">
                                            ${escapeHtml(s.reject_reason || (s.ocr_status === 'failed' ? 'Verification scan failed.' : "We couldn't find your review on Play Store."))}
                                        </span>
                                    </div>
                                </div>
                                ` : `
                                <div class="mt-2 space-y-2 text-[11px] font-semibold text-gray-655 dark:text-gray-300">
                                    <div class="flex justify-between items-center">
                                        <span class="text-gray-400 dark:text-gray-500">Status</span>
                                        <span class="text-[9px] font-black uppercase bg-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-50 dark:bg-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-950/20 text-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-600 dark:text-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-400 px-1.5 py-0.5 rounded border border-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-100 dark:border-${s.manual_status === 'approved' ? 'emerald' : 'amber'}-900/30">
                                            ${s.manual_status === 'approved' ? 'Approved' : 'Pending'}
                                        </span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-400 dark:text-gray-500">Submission ID</span>
                                        <span class="font-extrabold text-gray-855 dark:text-white font-mono">${displaySubmissionId}</span>
                                    </div>
                                    ${isReviewTask ? `
                                    <div class="flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-755 pt-2">
                                        <span class="text-gray-400 dark:text-gray-500 shrink-0">Review Used</span>
                                        <div class="flex items-center gap-1 min-w-0">
                                            <span class="font-extrabold text-gray-855 dark:text-white truncate max-w-[100px]" title="${escapeHtml(s.assigned_comment)}">${escapeHtml(s.assigned_comment)}</span>
                                            <button class="text-purple-600 hover:text-purple-700 p-0.5 rounded hover:bg-purple-50 dark:hover:bg-purple-950/20 shrink-0" onclick="window.copyReviewText('${escapeHtml(s.assigned_comment)}')">
                                                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
                ${getPageFooter()}
            `;

            showPage(detailContent, { returnTo: 'task-history', keepBottomNav: false, onBack: showUserTaskHistoryPage });

            // Lightbox attachment
            const userScreenshotImg = document.getElementById('user-detail-screenshot-img');
            if (userScreenshotImg) {
                userScreenshotImg.onclick = () => {
                    window.showScreenshotLightbox(s.screenshot_url, s.screenshot_view_url || '');
                };
            }
        };

window.copyReviewText = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Review comment copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy text:', err);
    });
};

window.showSubmissionStatusPage = (submissionId) => {
    const idx = userTaskHistoryCache.findIndex(x => x.id === submissionId);
    if (idx === -1) return;
    const s = userTaskHistoryCache[idx];

    const timeStr = s.submitted_at 
        ? new Date(s.submitted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) 
        : 'Unknown';

    const isReviewTask = !!(s.assigned_comment && String(s.assigned_comment).trim().length > 0);
    const delayDays = Number(s.payout_delay_days || s.payoutDelayDays || 7);

    // Compute Stage counts
    const isUploaded = 1;
    const isUnderReview = s.manual_status === 'pending' ? 1 : 0;
    const isApproved = s.manual_status === 'approved' ? 1 : 0;
    const isRejected = s.manual_status === 'rejected' ? 1 : 0;

    let alertText = 'We will check your review on Play Store. If found, it will be approved and added to your wallet.';
    if (s.manual_status === 'approved') {
        alertText = 'Your review has been successfully verified on Play Store and the reward has been added to your wallet.';
    } else if (s.manual_status === 'rejected') {
        alertText = 'Your review could not be verified on Play Store. Please contact support if you believe this is an error.';
    }

    const content = `
        <header class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-750 page-header-fixed">
            <div class="flex items-center gap-3">
                <button class="page-back-btn p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 mr-1 shrink-0 text-gray-700 dark:text-white" style="outline: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><line x1="12" y1="19" x2="5" y2="12"></line><line x1="12" y1="5" x2="5" y2="12"></line></svg>
                </button>
                <h2 class="text-lg font-black text-gray-900 dark:text-white">Submission Status</h2>
            </div>
        </header>

        <div class="max-w-xl mx-auto space-y-6 pb-24 px-4 pt-4 text-left">
            <!-- Stat Cards Row (Design based on Screenshot 3) -->
            <div class="grid grid-cols-4 gap-2 text-center text-xs font-bold">
                <div class="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-2xl border border-emerald-100/60 dark:border-emerald-900/30 shadow-sm">
                    <span class="block text-2xl font-black text-emerald-600 dark:text-emerald-400">${isUploaded}</span>
                    <span class="text-[9px] font-black uppercase text-emerald-500 mt-1 block">Uploaded</span>
                </div>
                <div class="bg-indigo-50/50 dark:bg-indigo-950/20 p-3 rounded-2xl border border-indigo-100/60 dark:border-indigo-900/30 shadow-sm">
                    <span class="block text-2xl font-black text-indigo-600 dark:text-indigo-400">${isUnderReview}</span>
                    <span class="text-[9px] font-black uppercase text-indigo-500 mt-1 block">Under Review</span>
                </div>
                <div class="bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-2xl border border-blue-100/60 dark:border-blue-900/30 shadow-sm">
                    <span class="block text-2xl font-black text-blue-600 dark:text-blue-400">${isApproved}</span>
                    <span class="text-[9px] font-black uppercase text-blue-500 mt-1 block">Approved</span>
                </div>
                <div class="bg-rose-50/50 dark:bg-rose-950/20 p-3 rounded-2xl border border-rose-100/60 dark:border-rose-900/30 shadow-sm">
                    <span class="block text-2xl font-black text-rose-600 dark:text-rose-450">${isRejected}</span>
                    <span class="text-[9px] font-black uppercase text-rose-500 mt-1 block">Rejected</span>
                </div>
            </div>

            <!-- Submission Details Card -->
            <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-850 shadow-sm space-y-4">
                <h3 class="text-sm font-extrabold text-gray-900 dark:text-white">Submission Details</h3>
                <div class="space-y-3.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    <div class="flex justify-between items-start gap-4">
                        <span class="text-gray-400 shrink-0">Task Name</span>
                        <span class="font-extrabold text-gray-900 dark:text-white text-right">${escapeHtml(s.app_name || 'Task Submission')}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Task Type</span>
                        <span class="font-extrabold text-gray-900 dark:text-white">${isReviewTask ? 'Play Store Review' : 'Screenshot Task'}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Payout</span>
                        <span class="font-extrabold text-indigo-600 dark:text-indigo-400">₹${s.reward}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Approval Time</span>
                        <span class="font-extrabold text-gray-900 dark:text-white">${delayDays === 0 ? 'Instant' : `${delayDays} Days`}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Submitted On</span>
                        <span class="font-extrabold text-gray-900 dark:text-white">${timeStr}</span>
                    </div>
                </div>
            </div>

            <!-- Info Box -->
            <div class="bg-blue-50/40 dark:bg-indigo-950/10 p-4.5 rounded-2xl border border-blue-100/50 dark:border-indigo-900/20 flex items-start gap-3 shadow-sm">
                <span class="text-blue-500 dark:text-indigo-400 mt-0.5 shrink-0 text-base">ⓘ</span>
                <p class="text-xs font-bold text-blue-700 dark:text-indigo-300 leading-relaxed">
                    ${alertText}
                </p>
            </div>
        </div>
        ${getPageFooter()}
    `;

    showPage(content, { returnTo: 'task-details', keepBottomNav: false, onBack: () => window.showUserTaskHistoryDetail(submissionId) });
};

window.showBulkerTaskOverview = (taskId) => {
            const taskSubs = userTaskHistoryCache.filter(x => (x.task_id === taskId || x.taskId === taskId));
            if (taskSubs.length === 0) {
                showUserTaskHistoryPage();
                return;
            }
            const sample = taskSubs[0];
            const taskName = sample.app_name || sample.taskTitle || 'Task';
            const logoUrl = sample.app_logo_url || 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';
            const reward = sample.reward || 0;

            const total = taskSubs.length;
            const approved = taskSubs.filter(s => s.manual_status === 'approved').length;
            const pending = taskSubs.filter(s => s.manual_status === 'pending').length;
            const rejected = taskSubs.filter(s => s.manual_status === 'rejected').length;
            const isReviewTask = taskSubs.some(s => s.assigned_comment && String(s.assigned_comment).trim().length > 0);

            const completionPercent = total > 0 ? Math.round((approved / total) * 100) : 0;
            
            // Status Breakdown SVG Donut chart calculation
            const approvedPercent = total > 0 ? Math.round((approved / total) * 100) : 0;
            const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;
            const rejectedPercent = total > 0 ? (100 - approvedPercent - pendingPercent) : 0;

            const content = `
                <header class="relative flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-755 page-header-fixed">
                    <button class="page-back-btn p-2 rounded-full hover:bg-gray-105 dark:hover:bg-gray-700 text-gray-700 dark:text-white" style="outline: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h2 class="absolute left-1/2 -translate-x-1/2 text-lg font-black text-gray-900 dark:text-white">Task Overview</h2>
                </header>

                <div class="max-w-xl mx-auto space-y-4.5 pb-24 px-4 pt-4 text-left">
                    <!-- App Card & Stats (Single unified card as in Screenshot 2) -->
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-150 dark:border-gray-750 shadow-sm space-y-4">
                        <!-- App header -->
                        <div class="flex items-center gap-3.5">
                            <img src="${escapeHtml(logoUrl)}" class="h-12 w-12 rounded-2xl object-cover shrink-0 border border-gray-50 dark:border-gray-700 shadow-sm" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3176/3176366.png';">
                            <div class="min-w-0 flex-1">
                                <h4 class="text-[14px] font-black text-gray-900 dark:text-white truncate">${escapeHtml(taskName)}</h4>
                                <div class="flex items-center gap-1 mt-0.5 text-xs text-gray-400 font-semibold">
                                    <img src="https://upload.wikimedia.org/wikipedia/commons/d/d0/Google_Play_Arrow_Logo_%282022%29.svg" class="h-3 w-3 shrink-0" style="width: 12px; height: 12px;">
                                    <span>Play Store Review • ₹${reward}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Stats Divider -->
                        <div class="border-t border-gray-100 dark:border-gray-750/50"></div>

                        <!-- Stats Row with Dividers -->
                        <div class="flex items-center justify-between text-center select-none py-1.5 border-y border-gray-50/50 dark:border-gray-750/30">
                            <div class="flex-1">
                                <span class="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">Submitted</span>
                                <span class="block text-[18px] font-black text-gray-900 dark:text-white mt-1.5 leading-none">${total}</span>
                            </div>
                            <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                            <div class="flex-1">
                                <span class="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">Approved</span>
                                <span class="block text-[18px] font-black text-emerald-500 mt-1.5 leading-none">${approved}</span>
                            </div>
                            <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                            <div class="flex-1">
                                <span class="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">Pending</span>
                                <span class="block text-[18px] font-black text-amber-500 mt-1.5 leading-none">${pending}</span>
                            </div>
                            <div class="h-6 w-px bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                            <div class="flex-1">
                                <span class="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none">Rejected</span>
                                <span class="block text-[18px] font-black text-rose-500 mt-1.5 leading-none">${rejected}</span>
                            </div>
                        </div>

                        <!-- Divider -->
                        <div class="border-t border-gray-100 dark:border-gray-750/50"></div>

                        <!-- Status Breakdown Section with CSS SVG Donut Chart -->
                        <div class="flex items-center gap-6 pt-1">
                            <!-- Left: CSS SVG Donut Chart -->
                            <div class="relative w-24 h-24 flex items-center justify-center shrink-0">
                                <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                    <!-- Gray background track -->
                                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#E5E7EB" class="dark:stroke-gray-700" stroke-width="3"></circle>
                                    
                                    <!-- Approved segment (emerald) -->
                                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#10B981" stroke-width="3" 
                                        stroke-dasharray="${approvedPercent} ${100 - approvedPercent}" stroke-dashoffset="0"></circle>
                                        
                                    <!-- Pending segment (amber) -->
                                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#F59E0B" stroke-width="3" 
                                        stroke-dasharray="${pendingPercent} ${100 - pendingPercent}" stroke-dashoffset="-${approvedPercent}"></circle>
                                        
                                    <!-- Rejected segment (rose) -->
                                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#EF4444" stroke-width="3" 
                                        stroke-dasharray="${rejectedPercent} ${100 - rejectedPercent}" stroke-dashoffset="-${approvedPercent + pendingPercent}"></circle>
                                </svg>
                                <div class="absolute flex flex-col items-center justify-center text-center">
                                    <span class="text-sm font-black text-gray-900 dark:text-white leading-none">${completionPercent}%</span>
                                    <span class="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-1">Completed</span>
                                </div>
                            </div>

                            <!-- Right: Legend Details -->
                            <div class="flex-1 min-w-0 space-y-2">
                                <h5 class="text-xs font-black text-gray-900 dark:text-white">Status Breakdown</h5>
                                <div class="space-y-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-1.5 min-w-0">
                                            <span class="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
                                            <span class="truncate">Approved</span>
                                        </div>
                                        <span class="font-extrabold text-gray-855 dark:text-white shrink-0">${approved} (${approvedPercent}%)</span>
                                    </div>
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-1.5 min-w-0">
                                            <span class="h-2 w-2 rounded-full bg-amber-500 shrink-0"></span>
                                            <span class="truncate">Pending / Under Review</span>
                                        </div>
                                        <span class="font-extrabold text-gray-855 dark:text-white shrink-0">${pending} (${pendingPercent}%)</span>
                                    </div>
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-1.5 min-w-0">
                                            <span class="h-2 w-2 rounded-full bg-rose-500 shrink-0"></span>
                                            <span class="truncate">Rejected</span>
                                        </div>
                                        <span class="font-extrabold text-gray-855 dark:text-white shrink-0">${rejected} (${rejectedPercent}%)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Quick Actions -->
                    <div class="space-y-3 pt-1.5">
                        <h5 class="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">Quick Actions</h5>

                        <!-- View All Submissions -->
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'all')" class="w-full flex items-center justify-between p-3 bg-indigo-50/50 dark:bg-indigo-950/20 hover:bg-indigo-100/40 dark:hover:bg-indigo-900/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 shadow-sm transition text-left" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-1.5 rounded-lg bg-indigo-600 text-white shrink-0">
                                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                                    </svg>
                                </span>
                                <span class="text-xs font-black text-indigo-600 dark:text-indigo-400 font-extrabold">View All Submissions</span>
                            </div>
                            <svg class="h-4 w-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>

                        <!-- View Pending -->
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'pending')" class="w-full flex items-center justify-between p-3 bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/40 dark:hover:bg-amber-900/30 rounded-2xl border border-amber-100 dark:border-amber-900/40 shadow-sm transition text-left" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-1.5 rounded-lg bg-amber-500 text-white shrink-0">
                                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                </span>
                                <span class="text-xs font-black text-amber-600 dark:text-amber-400 font-extrabold">View Pending (${pending})</span>
                            </div>
                            <svg class="h-4 w-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>

                        <!-- View Rejected -->
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'rejected')" class="w-full flex items-center justify-between p-3 bg-red-50/50 dark:bg-rose-950/20 hover:bg-red-100/40 dark:hover:bg-rose-900/30 rounded-2xl border border-red-100 dark:border-rose-900/40 shadow-sm transition text-left" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-1.5 rounded-lg bg-red-600 text-white shrink-0">
                                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </span>
                                <span class="text-xs font-black text-red-600 dark:text-rose-400 font-extrabold">View Rejected (${rejected})</span>
                            </div>
                            <svg class="h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>

                        <!-- View Live List or Export Report -->
                        ${isReviewTask ? `
                        <button onclick="window.showBulkerLiveList('${taskId}')" class="w-full flex items-center justify-between p-3 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/40 dark:hover:bg-blue-900/30 rounded-2xl border border-blue-100 dark:border-blue-900/40 shadow-sm transition text-left" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-1.5 rounded-lg bg-blue-600 text-white shrink-0">
                                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                    </svg>
                                </span>
                                <span class="text-xs font-black text-blue-600 dark:text-blue-400 font-extrabold">View Live List</span>
                            </div>
                            <svg class="h-4 w-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        ` : `
                        <button onclick="window.exportBulkerReport('${taskId}')" class="w-full flex items-center justify-between p-3 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/40 dark:hover:bg-blue-900/30 rounded-2xl border border-blue-100 dark:border-blue-900/40 shadow-sm transition text-left" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-1.5 rounded-lg bg-blue-600 text-white shrink-0">
                                    <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                    </svg>
                                </span>
                                <span class="text-xs font-black text-blue-600 dark:text-blue-400 font-extrabold">Export Report</span>
                            </div>
                            <svg class="h-4 w-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        `}
                    </div>
                </div>
                ${getPageFooter()}
            `;

            showPage(content, { returnTo: 'task-history', keepBottomNav: false, onBack: showUserTaskHistoryPage });
        };

window.exportBulkerReport = (taskId) => {
            const taskSubs = userTaskHistoryCache.filter(x => (x.task_id === taskId || x.taskId === taskId));
            if (taskSubs.length === 0) return;
            
            const headers = ["Submission ID", "App Name", "Status", "Payout Status", "Reward", "Submitted At"];
            const rows = taskSubs.map(s => {
                const dateStr = s.submitted_at ? new Date(s.submitted_at).toLocaleString('en-IN') : 'Unknown';
                return [
                    s.id,
                    s.app_name || 'Task',
                    s.manual_status || 'pending',
                    s.payout_status || 'pending',
                    s.reward || 0,
                    dateStr
                ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
            });

            const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `submissions_report_${taskId}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showNotification('Report CSV downloaded successfully.');
        };

window.showBulkerLiveList = (taskId) => {
            const taskSubs = userTaskHistoryCache.filter(x => (x.task_id === taskId || x.taskId === taskId));
            if (taskSubs.length === 0) {
                window.showBulkerTaskOverview(taskId);
                return;
            }
            const sample = taskSubs[0];
            const taskName = sample.app_name || sample.taskTitle || 'Task';
            
            // Format current date as DD-MM-YYYY
            const d = new Date();
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            const dateStr = `${day}-${month}-${year}`;
            
            let listText = `${taskName} :-\n${dateStr}\n\n`;
            
            // Sort ascending (oldest submission first)
            const sortedSubs = [...taskSubs].sort((a, b) => {
                const tA = a.submitted_at || a.submittedAt || 0;
                const tB = b.submitted_at || b.submittedAt || 0;
                return tA - tB;
            });

            sortedSubs.forEach((s, index) => {
                const name = s.ocr_extracted_name || s.username || `User #${index + 1}`;
                let symbol = '🕒';
                if (s.manual_status === 'approved') symbol = '✅';
                else if (s.manual_status === 'rejected') symbol = '❌';
                
                listText += `${index + 1}. ${name} ${symbol}\n`;
            });

            const content = `
                <header class="relative flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-755 page-header-fixed">
                    <button class="page-back-btn p-2 rounded-full hover:bg-gray-105 dark:hover:bg-gray-700 text-gray-700 dark:text-white" style="outline: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h2 class="absolute left-1/2 -translate-x-1/2 text-lg font-black text-gray-900 dark:text-white">Live List</h2>
                </header>

                <div class="max-w-xl mx-auto space-y-4.5 pb-24 px-4 pt-4 text-left">
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-150 dark:border-gray-750 shadow-sm space-y-4">
                        <div class="flex items-center justify-between">
                            <h5 class="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Live List Format</h5>
                            <span class="rounded bg-blue-50 dark:bg-blue-950/20 px-2.5 py-0.5 text-[9px] font-black text-blue-600 dark:text-blue-400 border border-blue-100 uppercase">Review Task</span>
                        </div>
                        
                        <div class="bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-800 p-5 rounded-2xl font-mono text-sm leading-relaxed whitespace-pre-wrap select-all text-gray-800 dark:text-gray-200" id="bulker-live-list-text-container">${escapeHtml(listText)}</div>
                        
                        <button class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black transition uppercase tracking-wider shadow-sm flex items-center justify-center gap-2" onclick="window.copyBulkerLiveListText()" style="outline: none;">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-3a2.251 2.251 0 00-1.85 1.136m8.75 3.148t-8.75 0M16.5 7.75v10.5c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.75c0-.621.504-1.125 1.125-1.125h9.75c.621 0 1.125.504 1.125 1.125z" />
                            </svg>
                            <span>Copy Live List</span>
                        </button>
                    </div>
                </div>
                ${getPageFooter()}
            `;

            showPage(content, { returnTo: 'task-overview', keepBottomNav: false, onBack: () => window.showBulkerTaskOverview(taskId) });
        };

window.copyBulkerLiveListText = () => {
            const el = document.getElementById('bulker-live-list-text-container');
            if (el) {
                copyToClipboard(el.textContent.trim());
                showNotification('Live List copied to clipboard!');
            }
        };

window.showBulkerStatusMeaningDialog = () => {
            const content = `
                <div class="space-y-4 text-xs font-semibold select-none text-left p-2">
                    <div class="space-y-4">
                        <!-- Approved -->
                        <div class="flex items-start gap-3">
                            <span class="p-1 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </span>
                            <div class="space-y-0.5">
                                <p class="font-extrabold text-emerald-600 dark:text-emerald-400 text-[11px] uppercase tracking-wider">Approved</p>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-normal">Review found on Play Store. Payout will be added.</p>
                            </div>
                        </div>

                        <!-- Pending -->
                        <div class="flex items-start gap-3">
                            <span class="p-1 rounded-full bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
                                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                                </svg>
                            </span>
                            <div class="space-y-0.5">
                                <p class="font-extrabold text-amber-600 dark:text-amber-400 text-[11px] uppercase tracking-wider">Pending / Under Review</p>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-normal">We are checking your review on Play Store.</p>
                            </div>
                        </div>

                        <!-- Under Review -->
                        <div class="flex items-start gap-3">
                            <span class="p-1 rounded-full bg-blue-50 dark:bg-blue-955/20 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </span>
                            <div class="space-y-0.5">
                                <p class="font-extrabold text-blue-600 dark:text-blue-400 text-[11px] uppercase tracking-wider">Under Review</p>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-normal">Screenshot received, verification in progress.</p>
                            </div>
                        </div>

                        <!-- Rejected -->
                        <div class="flex items-start gap-3">
                            <span class="p-1 rounded-full bg-rose-50 dark:bg-rose-955/20 text-rose-600 dark:text-rose-455 shrink-0 mt-0.5">
                                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </span>
                            <div class="space-y-0.5">
                                <p class="font-extrabold text-rose-600 dark:text-rose-455 text-[11px] uppercase tracking-wider">Rejected</p>
                                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-normal">Review not found / Policy mismatch / Other issue.</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            renderModal('Status Meaning', content, `<button onclick="window.closeModal()" class="w-full py-2.5 text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl uppercase tracking-wider shadow-sm" style="outline: none;">Close</button>`, 'max-w-sm');
        };

window.showBulkerAllSubmissions = (taskId, filterStatus = 'all') => {
            window.bulkerSubmissionDetailReturnPage = 'all-submissions';
            window.bulkerAllSubmissionsFilter = filterStatus;

            const taskSubs = userTaskHistoryCache.filter(x => (x.task_id === taskId || x.taskId === taskId));
            if (taskSubs.length === 0) {
                window.showBulkerTaskOverview(taskId);
                return;
            }

            const total = taskSubs.length;
            const approved = taskSubs.filter(s => s.manual_status === 'approved').length;
            const pending = taskSubs.filter(s => s.manual_status === 'pending').length;
            const rejected = taskSubs.filter(s => s.manual_status === 'rejected').length;

            // Sort submissions descending (newest first)
            const sortedSubs = [...taskSubs].sort((a, b) => {
                const tA = a.submitted_at || a.submittedAt || 0;
                const tB = b.submitted_at || b.submittedAt || 0;
                return tB - tA;
            });

            let filteredSubs = sortedSubs;
            if (filterStatus === 'approved') {
                filteredSubs = sortedSubs.filter(s => s.manual_status === 'approved');
            } else if (filterStatus === 'pending') {
                filteredSubs = sortedSubs.filter(s => s.manual_status === 'pending');
            } else if (filterStatus === 'rejected') {
                filteredSubs = sortedSubs.filter(s => s.manual_status === 'rejected');
            }

            const getPillClass = (status) => {
                const isActive = filterStatus === status;
                if (status === 'all') {
                    return isActive 
                        ? 'bg-indigo-600 text-white shadow-sm border-indigo-600'
                        : 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-transparent hover:bg-indigo-100';
                }
                if (status === 'approved') {
                    return isActive 
                        ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                        : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-transparent hover:bg-emerald-100';
                }
                if (status === 'pending') {
                    return isActive 
                        ? 'bg-amber-500 text-white shadow-sm border-amber-500'
                        : 'bg-amber-50 dark:bg-amber-955/20 text-amber-600 dark:text-amber-400 border-transparent hover:bg-amber-100';
                }
                if (status === 'rejected') {
                    return isActive 
                        ? 'bg-rose-500 text-white shadow-sm border-rose-500'
                        : 'bg-rose-50 dark:bg-rose-955/20 text-rose-600 dark:text-rose-455 border-transparent hover:bg-rose-100';
                }
            };

            const content = `
                <header class="relative flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.015)] border-b border-gray-100 dark:border-gray-750 page-header-fixed">
                    <button class="page-back-btn p-2 rounded-full hover:bg-gray-105 dark:hover:bg-gray-700 text-gray-700 dark:text-white" style="outline: none;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <h2 class="absolute left-1/2 -translate-x-1/2 text-lg font-black text-gray-900 dark:text-white">All Submissions</h2>
                    <button class="h-8 w-8 rounded-full bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 flex items-center justify-center text-sm font-black border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 shadow-sm shrink-0 mr-1" style="outline: none; line-height: 1;" onclick="window.showBulkerStatusMeaningDialog()">
                        ?
                    </button>
                </header>

                <div class="max-w-xl mx-auto space-y-4 pb-24 px-4 pt-4 text-left">
                    <!-- Filter Pills Row -->
                    <div class="flex items-center gap-2 overflow-x-auto pb-1 select-none no-scrollbar">
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'all')" class="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition border ${getPillClass('all')}" style="outline: none;">
                            All (${total})
                        </button>
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'approved')" class="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition border ${getPillClass('approved')}" style="outline: none;">
                            Approved (${approved})
                        </button>
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'pending')" class="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition border ${getPillClass('pending')}" style="outline: none;">
                            Pending (${pending})
                        </button>
                        <button onclick="window.showBulkerAllSubmissions('${taskId}', 'rejected')" class="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider transition border ${getPillClass('rejected')}" style="outline: none;">
                            Rejected (${rejected})
                        </button>
                    </div>

                    <!-- Submissions list -->
                    <div class="bg-white dark:bg-gray-800 rounded-3xl border border-gray-150 dark:border-gray-755 shadow-sm divide-y divide-gray-100 dark:divide-gray-750/60 overflow-hidden">
                        ${filteredSubs.length === 0 ? `
                            <div class="py-12 text-center text-xs font-bold text-gray-400 dark:text-gray-500">
                                No submissions found matching this filter.
                            </div>
                        ` : filteredSubs.map(s => {
                            const originalIdx = sortedSubs.indexOf(s);
                            const displayNum = total - originalIdx;
                            const dateStr = s.submitted_at 
                                ? new Date(s.submitted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) 
                                : 'Unknown';

                            let badgeColor = 'amber';
                            if (s.manual_status === 'approved') badgeColor = 'emerald';
                            if (s.manual_status === 'rejected') badgeColor = 'rose';

                            const taskIndexVal = s.task_index || s.taskIndex || 1;
                            const commentIndexVal = s.comment_index !== undefined ? s.comment_index : (s.commentIndex ?? s.assignedCommentIndex ?? 0);
                            const displaySubmissionId = `#${String(taskIndexVal).padStart(2, '0')}_${String(commentIndexVal + 1).padStart(2, '0')}`;

                            return `
                            <div class="flex items-center justify-between p-3.5 hover:bg-gray-55/50 dark:hover:bg-gray-750/30 transition cursor-pointer select-none" onclick="window.showBulkerSubmissionDetail('${s.id}')">
                                <div class="flex items-center gap-3.5 min-w-0">
                                    <!-- Left Index -->
                                    <span class="text-[10px] font-black text-gray-400 dark:text-gray-500 w-14 shrink-0 font-mono">${displaySubmissionId}</span>
                                    
                                    <!-- Thumbnail -->
                                    <img src="${escapeHtml(s.screenshot_url)}" class="h-11 w-11 rounded object-cover shrink-0 border border-gray-150 dark:border-gray-700 shadow-sm" onclick="event.stopPropagation(); window.showBulkerScreenshotLightbox('${s.id}')" onerror="this.src='https://placehold.co/100x100?text=No+Img';">
                                    
                                    <!-- Info -->
                                    <div class="min-w-0">
                                        <span class="rounded bg-${badgeColor}-50 dark:bg-${badgeColor}-950/20 px-1.5 py-0.5 text-[9px] font-black text-${badgeColor}-700 dark:text-${badgeColor}-400 border border-${badgeColor}-100 dark:border-${badgeColor}-900/30 uppercase tracking-wide inline-block">
                                            ${s.manual_status || 'Pending'}
                                        </span>
                                        <p class="text-[10px] text-gray-400 dark:text-gray-500 font-extrabold mt-1">${dateStr}</p>
                                    </div>
                                </div>
                                
                                <!-- Three dot menu -->
                                <button type="button" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 shrink-0" onclick="window.showBulkerSubmissionMenu(event, '${s.id}')" style="outline: none;">
                                    <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                                    </svg>
                                </button>
                            </div>
                            `;
                        }).join('')}
                    </div>
                </div>
                ${getPageFooter()}
            `;

            showPage(content, { returnTo: 'task-overview', keepBottomNav: false, onBack: () => window.showBulkerTaskOverview(taskId) });
        };

window.showBulkerScreenshotLightbox = (subId) => {
            const s = userTaskHistoryCache.find(x => x.id === subId);
            if (s && typeof window.showScreenshotLightbox === 'function') {
                window.showScreenshotLightbox(s.screenshot_url, s.screenshot_view_url || s.view_url || '');
            }
        };

window.showBulkerPaymentDialogById = (subId) => {
            const s = userTaskHistoryCache.find(x => x.id === subId);
            if (s && typeof window.showBulkerPaymentDialog === 'function') {
                window.showBulkerPaymentDialog(s.reward, s.payout_status || 'pending');
            }
        };

window.showBulkerRejectionReasonDialogById = (subId) => {
            const s = userTaskHistoryCache.find(x => x.id === subId);
            if (s && typeof window.showBulkerRejectionReasonDialog === 'function') {
                const reason = s.reject_reason || (s.ocr_status === 'failed' ? 'Auto check failed' : 'Review comment not found on Play Store');
                window.showBulkerRejectionReasonDialog(reason);
            }
        };

window.showBulkerSubmissionMenu = (event, submissionId) => {
            if (event) event.stopPropagation();
            const idx = userTaskHistoryCache.findIndex(x => x.id === submissionId);
            if (idx === -1) return;
            const s = userTaskHistoryCache[idx];
            
            const taskId = s.task_id || s.taskId;
            const taskIndexVal = s.task_index || s.taskIndex || 1;
            const commentIndexVal = s.comment_index !== undefined ? s.comment_index : (s.commentIndex ?? s.assignedCommentIndex ?? 0);
            const displaySubmissionId = `#${String(taskIndexVal).padStart(2, '0')}_${String(commentIndexVal + 1).padStart(2, '0')}`;
            
            const existing = document.getElementById('submission-menu-sheet-overlay');
            if (existing) existing.remove();
            
            const overlay = document.createElement('div');
            overlay.id = 'submission-menu-sheet-overlay';
            overlay.className = 'fixed inset-0 z-[999] bg-black/60 flex items-end justify-center select-none';
            
            overlay.innerHTML = `
                <div class="w-full max-w-md bg-white dark:bg-gray-800 rounded-t-[32px] p-5 shadow-2xl space-y-4 transform translate-y-full transition-transform duration-300 border-t border-gray-150 dark:border-gray-700" onclick="event.stopPropagation()" id="submission-menu-sheet-content">
                    <!-- Drag handle -->
                    <div class="w-12 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-1"></div>
                    
                    <div class="flex justify-between items-center pb-2 border-b border-gray-100 dark:border-gray-755">
                        <h3 class="text-sm font-black text-gray-900 dark:text-white">Submission ${displaySubmissionId}</h3>
                    </div>
                    
                    <div class="space-y-1.5 max-h-[60vh] overflow-y-auto pr-0.5 scrollbar-thin">
                        <!-- Option 1: View Submission Details -->
                        <button class="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-750/30 transition text-left" onclick="window.closeBulkerSubmissionMenu(); window.showBulkerSubmissionDetail('${s.id}')" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-2 rounded-xl bg-purple-50 dark:bg-purple-955/20 text-purple-600 dark:text-purple-400 shrink-0">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 11.751 1.299l-.041.02a.75.75 0 01-.751-1.299zm0 4.5l.041-.02a.75.75 0 11.751 1.299l-.041.02a.75.75 0 01-.751-1.299zm0-9l.041-.02a.75.75 0 11.751 1.299l-.041.02a.75.75 0 01-.751-1.299zM12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                    </svg>
                                </span>
                                <div>
                                    <p class="text-xs font-black text-gray-900 dark:text-white">View Submission Details</p>
                                    <p class="text-[10px] text-gray-400 font-semibold mt-0.5">See complete submission information</p>
                                </div>
                            </div>
                            <svg class="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>

                        <!-- Option 2: Status Specific -->
                        ${s.manual_status === 'approved' ? `
                        <button class="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-gray-55/50 dark:hover:bg-gray-750/30 transition text-left" onclick="window.closeBulkerSubmissionMenu(); window.showBulkerPaymentDialogById('${s.id}')" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-955/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-19.5 5.25h19.5m-19.5 0h19.5M2.25 12h19.5m-19.5 0h19.5M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" />
                                    </svg>
                                </span>
                                <div>
                                    <p class="text-xs font-black text-emerald-600 dark:text-emerald-400">Payment Details</p>
                                    <p class="text-[10px] text-gray-400 font-semibold mt-0.5">See reward & payout details</p>
                                </div>
                            </div>
                            <svg class="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        ` : s.manual_status === 'rejected' ? `
                        <button class="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-gray-55/50 dark:hover:bg-gray-750/30 transition text-left" onclick="window.closeBulkerSubmissionMenu(); window.showBulkerRejectionReasonDialogById('${s.id}')" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-2 rounded-xl bg-rose-50 dark:bg-rose-955/20 text-rose-600 dark:text-rose-455 shrink-0">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </span>
                                <div>
                                    <p class="text-xs font-black text-rose-600 dark:text-rose-455">View Rejection Reason</p>
                                    <p class="text-[10px] text-gray-400 font-semibold mt-0.5">See why this submission was rejected</p>
                                </div>
                            </div>
                            <svg class="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        ` : `
                        <button class="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-750/30 transition text-left" onclick="window.closeBulkerSubmissionMenu(); window.showBulkerVerificationProgressDialog()" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-2 rounded-xl bg-amber-50 dark:bg-amber-955/20 text-amber-600 dark:text-amber-500 shrink-0">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </span>
                                <div>
                                    <p class="text-xs font-black text-amber-600 dark:text-amber-500">View Verification Progress</p>
                                    <p class="text-[10px] text-gray-400 font-semibold mt-0.5">See current verification status</p>
                                </div>
                            </div>
                            <svg class="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        `}

                        <!-- Option 3: Report Issue -->
                        <button class="w-full flex items-center justify-between p-3.5 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-750/30 transition text-left" onclick="window.closeBulkerSubmissionMenu(); window.reportBulkerSubmissionIssue('${s.id}', '${displaySubmissionId}')" style="outline: none;">
                            <div class="flex items-center gap-3">
                                <span class="p-2 rounded-xl bg-red-50 dark:bg-red-955/20 text-red-600 dark:text-red-500 shrink-0">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                    </svg>
                                </span>
                                <div>
                                    <p class="text-xs font-black text-red-600 dark:text-red-500">Report Issue</p>
                                    <p class="text-[10px] text-gray-400 font-semibold mt-0.5">Report issue to support team</p>
                                </div>
                            </div>
                            <svg class="h-4 w-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                    </div>
                    
                    <!-- Close Button -->
                    <button class="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-650 rounded-2xl text-xs font-black text-gray-900 dark:text-white transition uppercase tracking-wider" onclick="window.closeBulkerSubmissionMenu()" style="outline: none;">
                        Close
                    </button>
                </div>
            `;
            
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
            
            // Slide up animation trigger
            setTimeout(() => {
                const contentEl = document.getElementById('submission-menu-sheet-content');
                if (contentEl) {
                    contentEl.classList.remove('translate-y-full');
                    contentEl.classList.add('translate-y-0');
                }
            }, 10);
            
            overlay.onclick = window.closeBulkerSubmissionMenu;
        };

        window.closeBulkerSubmissionMenu = () => {
            const overlay = document.getElementById('submission-menu-sheet-overlay');
            if (!overlay) return;
            
            const contentEl = document.getElementById('submission-menu-sheet-content');
            if (contentEl) {
                contentEl.classList.remove('translate-y-0');
                contentEl.classList.add('translate-y-full');
            }
            
            setTimeout(() => {
                overlay.remove();
                document.body.style.overflow = '';
            }, 220);
        };

        window.showBulkerReviewDialog = (comment) => {
            renderModal('Assigned Review', 
                `<div class="p-3.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-150 dark:border-gray-800 rounded-2xl font-mono text-xs text-gray-700 dark:text-gray-300 italic select-all leading-relaxed">${escapeHtml(comment)}</div>`,
                `<button onclick="window.closeModal(); copyToClipboard('${escapeHtml(comment)}'); showNotification('Review copied to clipboard!');" class="w-full py-2.5 text-xs font-black bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition uppercase tracking-wider" style="outline: none;">Copy Review</button>`,
                'max-w-sm'
            );
        };

        window.showBulkerPaymentDialog = (reward, payoutStatus) => {
            const isPaid = payoutStatus === 'paid';
            renderModal('Payment Details',
                `<div class="space-y-2 text-xs font-semibold text-gray-655 dark:text-gray-300 text-left">
                    <div class="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                        <span class="text-gray-400">Reward Rate</span>
                        <span class="font-extrabold text-emerald-600">₹${reward}</span>
                    </div>
                    <div class="flex justify-between py-1 pt-1.5">
                        <span class="text-gray-400">Payout Status</span>
                        <span class="rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${isPaid ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}">
                            ${isPaid ? 'Paid' : 'Pending Payout'}
                        </span>
                    </div>
                </div>`,
                `<button onclick="window.closeModal()" class="w-full py-2.5 text-xs font-black bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl transition uppercase tracking-wider" style="outline: none;">Close</button>`,
                'max-w-sm'
            );
        };

        window.showBulkerRejectionReasonDialog = (reason) => {
            renderModal('Rejection Reason',
                `<div class="p-3.5 bg-rose-50/30 border border-rose-100/50 rounded-2xl text-xs text-rose-600 font-bold select-text leading-relaxed">${escapeHtml(reason)}</div>`,
                `<button onclick="window.closeModal()" class="w-full py-2.5 text-xs font-black bg-gray-105 hover:bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl transition uppercase tracking-wider" style="outline: none;">Close</button>`,
                'max-w-sm'
            );
        };

        window.showBulkerVerificationProgressDialog = () => {
            renderModal('Verification Progress',
                `<div class="text-xs font-semibold text-gray-655 dark:text-gray-300 leading-relaxed text-left space-y-2">
                    <p class="font-black text-gray-800 dark:text-white flex items-center gap-1.5">🕒 <span>Checking on Play Store</span></p>
                    <p class="mt-1">Verification usually takes 1 to 7 working days to complete. Our automated systems and quality team verify that your review comment remains active on the Google Play Store page.</p>
                </div>`,
                `<button onclick="window.closeModal()" class="w-full py-2.5 text-xs font-black bg-gray-105 hover:bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl transition uppercase tracking-wider" style="outline: none;">Okay</button>`,
                'max-w-sm'
            );
        };

        window.reportBulkerSubmissionIssue = (submissionId, displayId) => {
            const idx = userTaskHistoryCache.findIndex(x => x.id === submissionId);
            if (idx === -1) return;
            const s = userTaskHistoryCache[idx];
            
            const appName = s.app_name || s.taskTitle || 'Task';
            const subDate = s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
            const taskIdVal = s.task_id || s.taskId || '';

            renderModal('Report Issue',
                `<div class="space-y-3 text-left select-none">
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400">Please describe your query or doubt below. Our support team will resolve it in the chat room.</p>
                    <textarea id="bulker-issue-doubt-textarea" placeholder="Enter your doubt here..." class="w-full h-24 p-3 text-xs bg-gray-55 dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-semibold text-gray-950 dark:text-white" style="outline: none;"></textarea>
                </div>`,
                `<div class="flex gap-2 w-full">
                    <button onclick="window.closeModal()" class="flex-1 py-2.5 text-xs font-black bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl transition uppercase tracking-wider" style="outline: none;">Cancel</button>
                    <button id="send-bulker-doubt-btn" class="flex-1 py-2.5 text-xs font-black bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition uppercase tracking-wider" style="outline: none;">Send</button>
                </div>`,
                'max-w-sm'
            );

            const sendBtn = document.getElementById('send-bulker-doubt-btn');
            if (sendBtn) {
                sendBtn.onclick = () => {
                    const textarea = document.getElementById('bulker-issue-doubt-textarea');
                    const queryText = textarea ? textarea.value.trim() : '';
                    if (!queryText) {
                        showNotification('Please enter your doubt/query first.', true);
                        return;
                    }

                    const prefilledMsg = `📱 App Name: ${appName}\n📅 Date: ${subDate}\n🆔 Task ID: ${taskIdVal}\n🔢 Submission ID: ${displayId}\n\n❓ My Doubt:\n${queryText}`;
                    window.closeModal();

                    if (typeof window.openSupportChatPage === 'function') {
                        window.openSupportChatPage(currentUser.uid, 'user', { 
                            adminId: ADMIN_UID, 
                            initialMessage: prefilledMsg 
                        });
                    } else {
                        showNotification('Support chat page is currently unavailable.');
                    }
                };
            }
        };

window.showBulkerSubmissionDetail = (submissionId) => {
            const idx = userTaskHistoryCache.findIndex(x => x.id === submissionId);
            if (idx === -1) return;
            const s = userTaskHistoryCache[idx];

            const isReviewTask = !!(s.assigned_comment && String(s.assigned_comment).trim().length > 0);
            const appLogo = s.app_logo_url || 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';
            
            let statusColor = 'amber';
            let statusText = 'Pending';
            if (s.manual_status === 'approved') {
                statusColor = 'emerald';
                statusText = 'Approved';
            } else if (s.manual_status === 'rejected') {
                statusColor = 'rose';
                statusText = 'Rejected';
            } else if (s.manual_status === 'pending') {
                if (s.ocr_status === 'completed') {
                    statusColor = 'blue';
                    statusText = 'Under Review';
                } else {
                    statusColor = 'amber';
                    statusText = 'Pending Verification';
                }
            }

            const submittedTimeStr = s.submitted_at 
                ? new Date(s.submitted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                : 'Unknown';

            let details = {};
            try { details = s.details_json ? JSON.parse(s.details_json) : {}; } catch {}
            const gmailName = s.ocr_extracted_name || '';

            const taskIndexVal = s.task_index || s.taskIndex || 1;
            const commentIndexVal = s.comment_index !== undefined ? s.comment_index : (s.commentIndex ?? s.assignedCommentIndex ?? 0);
            const displaySubmissionId = `#${String(taskIndexVal).padStart(2, '0')}_${String(commentIndexVal + 1).padStart(2, '0')}`;

            const content = `
                <header class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.02)] border-b border-gray-100 dark:border-gray-755 page-header-fixed">
                    <div class="flex items-center gap-3">
                        <button class="page-back-btn p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 mr-1 shrink-0 text-gray-700 dark:text-white" style="outline: none;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><line x1="12" y1="19" x2="5" y2="12"></line><line x1="12" y1="5" x2="5" y2="12"></line></svg>
                        </button>
                        <h2 class="text-lg font-black text-gray-900 dark:text-white">Submission Detail</h2>
                    </div>
                    <!-- Three dot menu on right side of detail header -->
                    <button type="button" class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0" onclick="window.showBulkerSubmissionMenu(event, '${s.id}')" style="outline: none;">
                        <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                        </svg>
                    </button>
                </header>
 
                <div class="max-w-xl mx-auto space-y-5 pb-24 px-4 pt-4 text-left">
                    <!-- Details Card -->
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
                        <h4 class="text-[10px] font-black uppercase text-gray-400 tracking-wider">Submission Info</h4>
                        
                        <div class="space-y-3.5 text-xs font-semibold text-gray-655 dark:text-gray-300">
                            <div class="flex justify-between">
                                <span class="text-gray-400">Submission ID</span>
                                <span class="font-extrabold text-gray-855 dark:text-white font-mono select-all">${displaySubmissionId}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-400">Status</span>
                                <span class="rounded-full bg-${statusColor}-50 dark:bg-${statusColor}-950/20 px-2.5 py-0.5 text-[9px] font-black text-${statusColor}-700 dark:text-${statusColor}-400 border border-${statusColor}-100 dark:border-${statusColor}-900/30 uppercase tracking-wide">
                                    ${statusText}
                                </span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-400">Reward</span>
                                <span class="font-extrabold text-purple-600 dark:text-purple-400">₹${s.reward}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-400">Submission Time</span>
                                <span class="font-extrabold text-gray-855 dark:text-white">${submittedTimeStr}</span>
                            </div>

                            ${isReviewTask ? `
                            <div class="flex justify-between border-t border-gray-100 dark:border-gray-755 pt-3.5">
                                <span class="text-gray-400">User Name</span>
                                <span class="font-extrabold text-gray-855 dark:text-white text-right max-w-[200px] truncate">
                                    ${gmailName || s.username || 'Not Available'}
                                </span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-400">Verification Result</span>
                                <span class="font-extrabold text-gray-855 dark:text-white text-right max-w-[200px] truncate">
                                    ${s.manual_status === 'approved' ? 'Verified' : s.manual_status === 'rejected' ? 'Verification Failed' : 'Checking'}
                                </span>
                            </div>
                            ` : ''}

                            ${s.manual_status === 'rejected' ? `
                            <div class="flex justify-between border-t border-rose-100/50 pt-3 text-rose-600">
                                <span>Rejection Reason</span>
                                <span class="font-black text-rose-700 dark:text-rose-400 uppercase tracking-wide">
                                    ${s.reject_reason || (s.ocr_status === 'failed' ? 'Auto check failed' : 'Review not found')}
                                </span>
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Review Card if review task -->
                    ${isReviewTask ? `
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-2">
                        <div class="flex items-center justify-between">
                            <p class="text-[10px] font-black uppercase text-gray-400 tracking-wider">Review Used</p>
                            <button class="text-[10px] text-purple-600 hover:text-purple-700 font-bold flex items-center gap-1 select-none" onclick="copyToClipboard('${escapeHtml(s.assigned_comment || '')}')">
                                <span>Copy</span>
                            </button>
                        </div>
                        <p class="mt-1 text-xs font-semibold text-gray-855 dark:text-gray-255 italic bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-100 dark:border-gray-755 leading-relaxed font-mono">
                            ${escapeHtml(s.assigned_comment)}
                        </p>
                    </div>
                    ` : ''}

                    <!-- Large Screenshot Proof -->
                    ${s.screenshot_url ? `
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-3">
                        <p class="text-[10px] font-black uppercase text-gray-400 tracking-wider">Large Screenshot</p>
                        <div class="relative overflow-hidden rounded-xl bg-gray-50 dark:bg-gray-955 flex items-center justify-center py-4 border border-gray-100 dark:border-gray-800">
                            <img id="bulker-detail-screenshot-img" src="${escapeHtml(s.screenshot_url)}" alt="Screenshot Proof" class="h-80 w-52 rounded-xl object-cover cursor-zoom-in hover:scale-102 transition shadow-sm" onclick="window.showBulkerScreenshotLightbox('${s.id}')">
                        </div>
                    </div>
                    ` : ''}
                </div>
                ${getPageFooter()}
            `;

            const returnPage = window.bulkerSubmissionDetailReturnPage === 'all-submissions' ? 'all-submissions' : 'task-overview';
            const onBackCallback = () => {
                if (window.bulkerSubmissionDetailReturnPage === 'all-submissions') {
                    window.showBulkerAllSubmissions(s.task_id || s.taskId, window.bulkerAllSubmissionsFilter || 'all');
                } else {
                    window.showBulkerTaskOverview(s.task_id || s.taskId);
                }
            };
            showPage(content, { returnTo: returnPage, keepBottomNav: false, onBack: onBackCallback });

            const userScreenshotImg = document.getElementById('bulker-detail-screenshot-img');
            if (userScreenshotImg) {
                userScreenshotImg.onclick = () => {
                    window.showScreenshotLightbox(s.screenshot_url, s.screenshot_view_url || '');
                };
            }
        };window.verifyUserTaskLiveList = async () => {
    const btn = document.getElementById('user-live-lists-verify-btn');
    const taskIdInput = document.getElementById('user-live-lists-task-id');
    const resultEl = document.getElementById('user-live-lists-result');
    if (!taskIdInput || !resultEl || !btn) return;

    const taskId = taskIdInput.value.trim();
    if (!taskId) {
        showNotification('Please enter a Task ID.', true);
        return;
    }

    btn.disabled = true;
    const originalBtnText = btn.textContent;
    btn.textContent = '⏳';
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<div class="text-center text-xs font-semibold text-gray-400 py-3">Fetching task and submission details...</div>`;

    // Hide search wrapper initially
    const searchWrapper = document.getElementById('user-live-lists-search-wrapper');
    if (searchWrapper) {
        searchWrapper.classList.add('hidden');
    }

    try {
        const taskRef = doc(db, `artifacts/${appId}/public/data/tasks`, taskId);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) {
            resultEl.innerHTML = `<div class="text-center text-xs font-bold text-red-500 py-2">⚠️ Task not found. Please double-check the Task ID.</div>`;
            btn.disabled = false;
            btn.textContent = originalBtnText;
            return;
        }
        const taskData = taskSnap.data();

        const subQuery = query(
            collection(db, `artifacts/${appId}/public/data/task_submissions`),
            where("taskId", "==", taskId),
            where("userId", "==", currentUser.uid)
        );
        const subSnap = await getDocs(subQuery);
        if (subSnap.empty) {
            resultEl.innerHTML = `<div class="text-center text-xs font-bold text-amber-500 py-2">⚠️ No submission found for this Task ID from your account. Make sure you have submitted the screenshot for this task first.</div>`;
            btn.disabled = false;
            btn.textContent = originalBtnText;
            return;
        }

        const subData = subSnap.docs[0].data();
        const submittedAt = timestampToMillis(subData.submittedAt || subData.submitted_at);
        const subDate = new Date(submittedAt);

        let releaseTime = 0;
        const paymentMode = taskData.paymentMode || (Number(taskData.paymentDelayDays || 0) > 0 ? 'days' : 'instant');
        if (paymentMode === 'instant') {
            const nextDay = new Date(subDate.getFullYear(), subDate.getMonth(), subDate.getDate() + 1, 0, 0, 0);
            releaseTime = nextDay.getTime();
        } else {
            const delayDays = Number(taskData.paymentDelayDays || taskData.listDays || taskData.list_days || 7);
            const listTimeStr = taskData.listTime || "20:00";
            const [hours, minutes] = listTimeStr.split(':').map(Number);
            const releaseDate = new Date(subDate.getFullYear(), subDate.getMonth(), subDate.getDate() + delayDays, hours, minutes, 0);
            releaseTime = releaseDate.getTime();
        }

        if (Date.now() < releaseTime) {
            const formattedRelease = new Date(releaseTime).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            resultEl.innerHTML = `
                <div class="space-y-2 text-center py-2">
                    <p class="text-xs font-extrabold text-amber-500">⏳ Live List Verification Not Released Yet</p>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400">As per app rules, the verification live list for this task releases after the payment given time is complete.</p>
                    <p class="text-xs font-bold text-gray-800 dark:text-gray-255 bg-amber-505/10 dark:bg-amber-950/20 p-2.5 rounded-xl border border-amber-500/20">
                        Estimated Release: <span class="text-indigo-650 dark:text-indigo-400">${formattedRelease}</span>
                    </p>
                </div>
            `;
            btn.disabled = false;
            btn.textContent = originalBtnText;
            return;
        }

        const appName = taskData.appName || taskData.title || '';
        const targetUrl = `${BACKEND_BASE_URL}/api/lists?appName=${encodeURIComponent(appName)}`;
        const resp = await fetchWithTimeout(targetUrl, {}, 10000);
        const listData = await resp.json().catch(() => ({}));

        if (!listData.ok || !Array.isArray(listData.lists) || !listData.lists.length) {
            resultEl.innerHTML = `
                <div class="space-y-2">
                    <div class="flex items-center gap-2 text-emerald-600 font-extrabold text-xs">
                        <span>✅ Release Time Completed</span>
                    </div>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400">No live lists have been uploaded by the admin for "${escapeHtml(appName)}" yet. Please wait for the admin to compile and upload the list.</p>
                </div>
            `;
            btn.disabled = false;
            btn.textContent = originalBtnText;
            return;
        }

        const reviewerName = String(subData.ocrExtractedName || subData.ocr_extracted_name || '').trim().toLowerCase();
        
        let matchedListHtml = '';
        let isUserFound = false;

        listData.lists.forEach(item => {
            const lines = item.content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const foundInThis = reviewerName && lines.some(l => l.toLowerCase() === reviewerName);
            if (foundInThis) {
                isUserFound = true;
            }

            const formattedListDate = item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown';

            matchedListHtml += `
                <div class="border border-gray-100 dark:border-gray-750 rounded-2xl p-4 space-y-3 bg-white dark:bg-gray-800 shadow-sm text-left">
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <h4 class="text-xs font-black text-gray-900 dark:text-white truncate">${escapeHtml(item.appName)}</h4>
                            <p class="text-[9px] text-gray-400 dark:text-gray-500 font-bold mt-0.5">Target Date: ${escapeHtml(formattedListDate)}</p>
                        </div>
                        <span class="rounded-full bg-indigo-55 dark:bg-indigo-900/30 px-2.5 py-0.5 text-[9px] font-black text-indigo-600 dark:text-indigo-300">
                            👥 ${lines.length} Reviewers
                        </span>
                    </div>
                    
                    <details class="group rounded-xl border border-gray-100 dark:border-gray-750 bg-gray-50/50 dark:bg-gray-900/10 overflow-hidden" open>
                        <summary class="flex items-center justify-between p-3 cursor-pointer text-xs font-bold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 select-none">
                            <span>Reviewer Names List</span>
                            <svg class="h-3 w-3 transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                        </summary>
                        <div class="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-750 max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] text-gray-755 dark:text-gray-300">
                            ${lines.map(line => {
                                const isMatch = reviewerName && line.toLowerCase() === reviewerName;
                                return `<p class="py-0.5 px-2 rounded-lg ${isMatch ? 'bg-emerald-500/20 text-emerald-600 font-black border border-emerald-500/30 animate-pulse' : ''}">${escapeHtml(line)}</p>`;
                            }).join('')}
                        </div>
                    </details>
                </div>
            `;
        });

        let statusHeaderHtml = '';
        if (isUserFound) {
            statusHeaderHtml = `
                <div class="flex items-center gap-2 bg-emerald-500/10 text-emerald-600 p-3 rounded-xl border border-emerald-500/20 mb-3">
                    <span class="text-lg">✅</span>
                    <div>
                         <p class="text-xs font-extrabold">VERIFIED IN LIVE LIST</p>
                         <p class="text-[10px] opacity-80 mt-0.5">Your reviewer name "${escapeHtml(subData.ocrExtractedName || subData.ocr_extracted_name)}" is successfully verified!</p>
                    </div>
                </div>
            `;
        } else {
            statusHeaderHtml = `
                <div class="flex items-center gap-2 bg-rose-500/10 text-rose-600 p-3 rounded-xl border border-rose-500/20 mb-3">
                    <span class="text-lg">⏳</span>
                    <div>
                         <p class="text-xs font-extrabold">NOT FOUND IN LIVE LIST YET</p>
                         <p class="text-[10px] opacity-80 mt-0.5">Your reviewer name "${escapeHtml(subData.ocrExtractedName || subData.ocr_extracted_name || 'unknown')}" is not in the live list yet.</p>
                    </div>
                </div>
            `;
        }

        resultEl.innerHTML = `
            <div class="space-y-3">
                ${statusHeaderHtml}
                <div class="space-y-3.5">
                    ${matchedListHtml}
                </div>
            </div>
        `;

        // Update global userLiveListsCache with the task's specific lists
        window.userLiveListsCache = listData.lists;

        // Show the search wrapper and render the lists
        if (searchWrapper) {
            searchWrapper.classList.remove('hidden');
            const searchInput = document.getElementById('user-live-lists-search');
            if (searchInput) {
                searchInput.value = '';
            }
        }
        renderUserLiveLists();

    } catch (err) {
        console.error('Verification failed:', err);
        resultEl.innerHTML = `<div class="text-center text-xs font-bold text-red-500 py-2">⚠️ Error verifying task. Please try again later.</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = originalBtnText;
    }
};

const showUserLiveListsPage = () => {
            if (!ensureUserSessionReady()) return;
            const content = `
                ${getPageHeader('Live Lists Verification')}
                <div class="max-w-xl mx-auto space-y-4 pb-24 px-4">
                    <!-- Task ID Verification Panel -->
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-4 text-left">
                        <p class="text-xs font-black uppercase text-gray-400 tracking-wider">Verify by Task ID</p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">Enter your Task ID to verify your reviewer name in the live list after the task release time.</p>
                        <div class="flex gap-2">
                            <input type="text" id="user-live-lists-task-id" placeholder="Enter Task ID (e.g. task_abc123)" class="flex-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-750 border border-gray-150 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs text-gray-900 dark:text-white">
                            <button type="button" id="user-live-lists-verify-btn" onclick="window.verifyUserTaskLiveList()" class="shrink-0 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase transition active:scale-95 shadow-md flex items-center justify-center" style="outline: none;">Verify</button>
                        </div>
                        <div id="user-live-lists-result" class="hidden rounded-2xl border p-4 space-y-3.5 text-left bg-gray-50/40 dark:bg-gray-900/10 border-gray-150 dark:border-gray-800"></div>
                    </div>

                    <!-- Search Wrapper (Hidden initially) -->
                    <div id="user-live-lists-search-wrapper" class="hidden space-y-4">
                        <!-- Search Existing Lists -->
                        <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 text-left">
                            <p class="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                Search within the live lists of this app.
                            </p>
                            <input type="text" id="user-live-lists-search" placeholder="🔍 Search app name or reviewer name..." class="mt-3 w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-750 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm border border-gray-100 dark:border-gray-700 text-gray-900 dark:text-white">
                        </div>
                        <div id="user-live-lists-container" class="space-y-4"></div>
                    </div>
                </div>
                ${getPageFooter()}`;

            showPage(content, { returnTo: 'settings', keepBottomNav: false });
            
            document.getElementById('user-live-lists-search').addEventListener('input', renderUserLiveLists);
        };

const openFullscreenScreenshotHistory = (url) => {
            const overlay = document.createElement('div');
            overlay.id = 'fullscreen-ss-overlay';
            overlay.className = 'fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/95 p-4 cursor-zoom-out';
            
            // Prevent background page from scrolling
            document.body.style.overflow = 'hidden';

            const removeOverlay = () => {
                overlay.remove();
                document.body.style.overflow = '';
            };

            overlay.onclick = removeOverlay;
            overlay.innerHTML = `
                <div class="relative max-w-3xl max-h-[85vh] flex items-center justify-center">
                    <img src="${url}" class="max-w-full max-h-[80vh] rounded-2xl shadow-2xl object-contain border border-gray-800">
                </div>
                <div class="mt-4 flex gap-2 shrink-0" onclick="event.stopPropagation()">
                    <button id="fullscreen-close-btn" class="rounded-xl bg-gray-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-gray-650 transition">✕ Close</button>
                </div>`;
            document.body.appendChild(overlay);
            
            const closeBtn = document.getElementById('fullscreen-close-btn');
            if (closeBtn) {
                closeBtn.onclick = removeOverlay;
            }
        };

const showHomeMainPage = () => {
            if (activeChatUnsubscribe) {
                activeChatUnsubscribe();
                activeChatUnsubscribe = null;
            }
            if (activeTaskReservationTimer) {
                clearInterval(activeTaskReservationTimer);
                activeTaskReservationTimer = null;
            }
            activeTaskReservation = null;
            window.activeTaskReservation = null;
            // ---- ATOMIC PAINT ORDER: Clear page-container WHILE still visible under dashboard,
            // then hide page-container, THEN reveal dashboard-content in ONE paint. ----
            const pageContainer = document.getElementById('page-container');
            pageContainer.innerHTML = '';
            pageContainer.style.overflowY = 'auto';
            pageContainer.style.scrollPaddingBottom = '';
            pageContainer.style.paddingBottom = '';
            pageContainer.classList.add('hidden');
            document.getElementById('dashboard-content').classList.remove('hidden');
            document.getElementById('app-top-header')?.classList.remove('hidden');
            setMainChrome(true);
            document.getElementById('app-footer')?.classList.add('app-footer-hidden');
            currentMainSection = 'home';
            switchTab('user-panel');
            setBottomNavActive('bottom-home-btn');
            updateDollarBalanceDisplay(currentUserData?.balance || 0);
        };

let realReferralsCache = [];

const fetchRealReferralsData = async (userUid) => {
    try {
        if (!userUid) return [];

        // Ensure allUsersCache is loaded
        if (typeof loadAllUsersCacheSilently === 'function' && (!allUsersCache || allUsersCache.length === 0)) {
            await loadAllUsersCacheSilently().catch(() => {});
        }

        const primaryRefCode = typeof getProfileReferralCode === 'function' ? getProfileReferralCode() : '';
        const userRefCode = primaryRefCode || String(currentUserData?.referralCode || currentUserData?.myReferralCode || currentUserData?.refCode || '').trim().toUpperCase();
        
        const refCodeSet = new Set([
            primaryRefCode.toUpperCase(),
            String(currentUserData?.referralCode || '').trim().toUpperCase(),
            String(currentUserData?.referral_code || '').trim().toUpperCase(),
            String(currentUserData?.myReferralCode || '').trim().toUpperCase(),
            String(currentUserData?.refCode || '').trim().toUpperCase()
        ].filter(Boolean));

        const viewerRole = String(currentUserData?.role || '').toLowerCase();
        const isSubAdminOrAdmin = viewerRole === 'subadmin' || viewerRole === 'admin' || viewerRole === 'owner';

        const queriesToRun = [
            getDocs(collection(db, `artifacts/${appId}/public/data/users`)).catch(() => ({ docs: [] })),
            getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("referredBy", "==", userUid))).catch(() => ({ docs: [] })),
            getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("referred_by", "==", userUid))).catch(() => ({ docs: [] })),
            getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("parentAdmin", "==", userUid))).catch(() => ({ docs: [] })),
            getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("parent_admin", "==", userUid))).catch(() => ({ docs: [] }))
        ];

        refCodeSet.forEach(code => {
            if (!code) return;
            const codeLower = code.toLowerCase();
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("usedReferralCode", "==", code))).catch(() => ({ docs: [] })));
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("usedReferralCode", "==", codeLower))).catch(() => ({ docs: [] })));
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("referredByCode", "==", code))).catch(() => ({ docs: [] })));
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("referredByCode", "==", codeLower))).catch(() => ({ docs: [] })));
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("referralCodeUsed", "==", code))).catch(() => ({ docs: [] })));
            queriesToRun.push(getDocs(query(collection(db, `artifacts/${appId}/public/data/users`), where("used_referral_code", "==", code))).catch(() => ({ docs: [] })));
        });

        const queryResults = await Promise.all(queriesToRun);
        const userDocsMap = new Map();

        queryResults.forEach(snap => {
            (snap.docs || []).forEach(d => {
                const data = d.data();
                const dUid = String(d.id || data.uid || '');
                if (dUid && dUid !== userUid) {
                    const uRefBy = String(data.referredBy || data.referred_by || '').trim();
                    const uParent = String(data.parentAdmin || data.parent_admin || '').trim();
                    const uUsedCode = String(
                        data.usedReferralCode || 
                        data.referredByCode || 
                        data.referralCodeUsed || 
                        data.used_referral_code || 
                        ''
                    ).trim().toUpperCase();

                    const isMatch = (uRefBy && uRefBy === userUid) ||
                                    (uUsedCode && refCodeSet.has(uUsedCode)) ||
                                    (isSubAdminOrAdmin && uParent && uParent === userUid);

                    if (isMatch) {
                        userDocsMap.set(dUid, { id: dUid, ...data });
                    }
                }
            });
        });

        // Also merge from allUsersCache
        if (typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache)) {
            allUsersCache.forEach(u => {
                const uUid = String(u.id || u.uid || '');
                if (uUid && uUid !== userUid) {
                    const uRefBy = String(u.referredBy || u.referred_by || '').trim();
                    const uParent = String(u.parentAdmin || u.parent_admin || '').trim();
                    const uUsedCode = String(
                        u.usedReferralCode || 
                        u.referredByCode || 
                        u.referralCodeUsed || 
                        u.used_referral_code || 
                        ''
                    ).trim().toUpperCase();

                    const isMatch = (uRefBy && uRefBy === userUid) ||
                                    (uUsedCode && refCodeSet.has(uUsedCode)) ||
                                    (isSubAdminOrAdmin && uParent && uParent === userUid);

                    if (isMatch) {
                        userDocsMap.set(uUid, { id: uUid, ...u });
                    }
                }
            });
        }

        const referredUsers = Array.from(userDocsMap.values());
        if (referredUsers.length === 0) {
            realReferralsCache = [];
            return [];
        }

        const realReferrals = await Promise.all(referredUsers.map(async (u) => {
            const userId = u.id || u.uid;
            const fundQ = query(
                collection(db, `artifacts/${appId}/public/data/fund_requests`),
                where("userId", "==", userId),
                where("status", "==", "completed")
            );
            const fundSnap = await getDocs(fundQ).catch(() => ({ docs: [] }));
            const completedWithdrawals = (fundSnap.docs || []).map(doc => doc.data());
            completedWithdrawals.sort((a, b) => {
                const tA = getSafeDate(a.requestedAt || a.processedAt || a.createdAt)?.getTime() || 0;
                const tB = getSafeDate(b.requestedAt || b.processedAt || b.createdAt)?.getTime() || 0;
                return tA - tB;
            });

            const isSuccessful = completedWithdrawals.length > 0;
            const referralBonus = (isSuccessful && !isSubAdminOrAdmin) ? 5.00 : 0;
            
            let lifetimeEarnings = 0;
            if (!isSubAdminOrAdmin) {
                completedWithdrawals.forEach(w => {
                    const amt = Number(w.amount || 0);
                    lifetimeEarnings += amt * 0.01;
                });
            }
            lifetimeEarnings = Number(lifetimeEarnings.toFixed(2));
            const totalEarned = Number((referralBonus + lifetimeEarnings).toFixed(2));

            const joinedDateObj = getSafeDate(u.createdAt || u.signupRequestedAt) || new Date();
            const joinedAt = formatDate(joinedDateObj).split(' ')[0] || 'N/A';
            const joinedTime = getTimeFromTimestamp(joinedDateObj) || 'N/A';

            let firstWithdrawalAt = null;
            let latestLifetimeAt = null;

            if (completedWithdrawals.length > 0) {
                const firstWd = completedWithdrawals[0];
                const firstWdDate = getSafeDate(firstWd.requestedAt || firstWd.processedAt || firstWd.createdAt);
                firstWithdrawalAt = `${formatDate(firstWdDate).split(' ')[0]} • ${getTimeFromTimestamp(firstWdDate)}`;

                const lastWd = completedWithdrawals[completedWithdrawals.length - 1];
                const lastWdDate = getSafeDate(lastWd.requestedAt || lastWd.processedAt || lastWd.createdAt);
                latestLifetimeAt = `${formatDate(lastWdDate).split(' ')[0]} • ${getTimeFromTimestamp(lastWdDate)}`;
            }

            return {
                id: userId,
                name: u.name || u.userName || 'User',
                mobile: u.mobile || u.phoneNumber || '',
                avatar: u.avatar || u.profileImage || 'https://cdn-icons-png.flaticon.com/512/4140/4140048.png',
                joinedAt,
                joinedTime,
                status: isSuccessful ? 'successful' : 'pending',
                statusLabel: isSuccessful ? 'Successful' : 'Pending',
                bonusText: isSubAdminOrAdmin ? '₹0.00' : `₹${referralBonus.toFixed(2)}`,
                lifetimeText: isSubAdminOrAdmin ? 'Sub-Admin referral' : (isSuccessful ? `+ 1% Lifetime (₹${lifetimeEarnings.toFixed(2)})` : 'Waiting for first withdrawal'),
                referralBonus,
                lifetimeEarnings,
                totalEarned,
                firstWithdrawalAt,
                latestLifetimeAt
            };
        }));

        realReferralsCache = realReferrals;
        return realReferrals;
    } catch (error) {
        console.error('Error fetching real referrals data:', error);
        realReferralsCache = [];
        return [];
    }
};

window.handleWithdrawReferralEarnings = async () => {
    const currentReferralBalance = Number(currentUserData?.referralEarnings || 0);
    const MIN_REFERRAL_WITHDRAWAL = 50;

    if (currentReferralBalance < MIN_REFERRAL_WITHDRAWAL) {
        return showNotification(`Minimum referral withdrawal amount is ₹50. Your available referral balance is ₹${currentReferralBalance.toFixed(2)}.`, true);
    }

    renderModal(
        'Withdraw Referral Earnings',
        `<div class="space-y-4 text-left">
            <div class="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3.5 rounded-xl space-y-1">
                <p class="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Available Referral Balance:</p>
                <p class="text-2xl font-black text-emerald-600 dark:text-emerald-400">₹${currentReferralBalance.toFixed(2)}</p>
            </div>
            <div class="space-y-1.5">
                <label class="text-xs font-bold text-gray-700 dark:text-gray-300">Enter Amount to Transfer to Main Wallet (Min ₹50):</label>
                <input type="number" id="referral-transfer-amount-input" value="${currentReferralBalance.toFixed(2)}" min="50" max="${currentReferralBalance}" step="1" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-xl text-base font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500">
                <p class="text-[11px] text-gray-500 dark:text-gray-400">This amount will be transferred directly into your Main Wallet Balance.</p>
            </div>
        </div>`,
        `<button onclick="window.closeModal()" class="px-4 py-2.5 text-xs font-bold bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl">Cancel</button>
         <button id="confirm-referral-transfer-btn" class="px-5 py-2.5 text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-xs">Transfer to Main Wallet</button>`,
        'max-w-md'
    );

    document.getElementById('confirm-referral-transfer-btn').onclick = async () => {
        const amountInput = document.getElementById('referral-transfer-amount-input');
        const amount = Number(amountInput ? amountInput.value : 0);

        if (isNaN(amount) || amount < MIN_REFERRAL_WITHDRAWAL) {
            return showNotification(`Minimum transfer amount is ₹${MIN_REFERRAL_WITHDRAWAL}.`, true);
        }
        if (amount > currentReferralBalance) {
            return showNotification(`Transfer amount cannot exceed your available referral balance (₹${currentReferralBalance.toFixed(2)}).`, true);
        }

        const btn = document.getElementById('confirm-referral-transfer-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Transferring...';
        }

        try {
            const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
            await updateDoc(userRef, {
                referralEarnings: increment(-amount),
                referralTransferred: increment(amount),
                balance: increment(amount)
            });

            const txId = `ref-transfer-${Date.now()}`;
            await setDoc(doc(collection(userRef, 'transactions'), txId), {
                type: 'referral_transfer',
                amount: amount,
                timestamp: Date.now(),
                status: 'completed',
                comment: `Transferred ₹${amount.toFixed(2)} from Referral Earnings to Main Wallet Balance`
            }, { merge: true });

            currentUserData.referralEarnings = Math.max(0, (currentUserData.referralEarnings || 0) - amount);
            currentUserData.referralTransferred = (currentUserData.referralTransferred || 0) + amount;
            currentUserData.balance = (currentUserData.balance || 0) + amount;
            writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));

            window.closeModal();
            showNotification(`🎉 Transferred ₹${amount.toFixed(2)} to your Main Wallet Balance!`);

            if (typeof window.showTrackReferralsPage === 'function') {
                window.showTrackReferralsPage();
            }
        } catch (error) {
            console.error('Error transferring referral balance:', error);
            showNotification('Transfer failed. Please try again.', true);
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Transfer to Main Wallet';
            }
        }
    };
};

const maskUserMobile = (mobile = '') => {
    const clean = String(mobile || '').trim();
    if (!clean) return 'N/A';
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length >= 5) {
        const first3 = digitsOnly.slice(0, 3);
        const last2 = digitsOnly.slice(-2);
        const prefix = clean.startsWith('+91') ? '+91 ' : (clean.startsWith('+') ? clean.slice(0, clean.indexOf(' ') + 1 || 4) : '');
        return `${prefix}${first3}***${last2}`;
    }
    return '***';
};

const getProfileReferralCode = () => {
    const isOwner = currentUser?.email === 'reviewsworld01@gmail.com' || currentUser?.uid === ADMIN_UID;
    if (isOwner) return 'RWADMIN182488';

    const existingCode = currentUserData?.referralCode || currentUserData?.referral_code || currentUserData?.referCode || currentUserData?.inviteCode;
    if (existingCode && String(existingCode).trim()) {
        return String(existingCode).trim().toUpperCase();
    }

    const rawSeed = String(currentUserData?.mobile || currentUser?.uid || '182488').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `RW${rawSeed.slice(-6)}`;
};

const getProfileReferralLink = (code = getProfileReferralCode()) => {
    return `https://rw-wallet.vercel.app/dl?ref=${code}`;
};

window.showShareReferralModal = (code = getProfileReferralCode()) => {
    const link = getProfileReferralLink(code);
    const shareText = `🎁 Join REVIEWS WORLD & earn instant cash rewards! Use my referral code: ${code}\n👇 Register here:\n${link}`;

    const modalHtml = `
        <div class="space-y-4 text-center">
            <!-- Code Container -->
            <div class="flex items-center justify-between gap-3 bg-emerald-50/70 dark:bg-emerald-950/30 border-2 border-emerald-300 dark:border-emerald-700 p-3.5 rounded-2xl">
                <span class="text-2xl font-black text-emerald-600 dark:text-emerald-300 tracking-wider">${escapeHtml(code)}</span>
                <button type="button" id="modal-copy-code-btn" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-300 shadow-sm border border-emerald-200 dark:border-emerald-800 hover:scale-105 active:scale-95 transition">
                    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                </button>
            </div>
            
            <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Share your code and earn rewards when your friends join and withdraw.</p>

            <!-- Social Share Grid -->
            <div class="grid grid-cols-5 gap-2 pt-1">
                <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}" target="_blank" class="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-750 transition">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-md">
                        <i class="fa-brands fa-whatsapp text-2xl text-white"></i>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300">WhatsApp</span>
                </a>
                <a href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`🎁 Join REVIEWS WORLD & earn instant cash rewards! Use my referral code: ${code}`)}" target="_blank" class="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-750 transition">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-md">
                        <svg class="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.128.832.941z"/></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300">Telegram</span>
                </a>
                <a href="#" id="modal-share-instagram" class="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-750 transition">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white shadow-md">
                        <svg class="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300">Instagram</span>
                </a>
                <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}" target="_blank" class="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-750 transition">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
                        <svg class="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300">Facebook</span>
                </a>
                <button type="button" id="modal-share-more" class="flex flex-col items-center gap-1 p-2 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-750 transition">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-md">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
                    </div>
                    <span class="text-[10px] font-bold text-gray-600 dark:text-gray-300">More</span>
                </button>
            </div>

            <button type="button" id="modal-native-share-btn" class="w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 py-3 text-sm font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition active:scale-98">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Share Link</span>
            </button>

            <!-- Link Box -->
            <div class="space-y-1 text-left pt-1">
                <label class="text-[10px] font-black uppercase text-gray-400 tracking-wider">OR INVITE VIA LINK</label>
                <div class="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 p-2 rounded-xl border border-gray-200 dark:border-gray-600">
                    <input type="text" readonly value="${escapeHtml(link)}" class="w-full bg-transparent text-xs font-mono font-semibold text-gray-800 dark:text-gray-200 outline-none truncate">
                    <button type="button" id="modal-copy-link-btn" class="shrink-0 flex items-center gap-1 rounded-lg bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-white shadow-sm border border-gray-200 dark:border-gray-600 hover:bg-gray-50 active:scale-95 transition">
                        <span>Copy</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    renderModal('Share Referral Code', modalHtml, '', 'max-w-md');

    const copyCode = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => showNotification('Referral code copied to clipboard!'));
        } else {
            showNotification(`Referral Code: ${code}`);
        }
    };

    const copyLink = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(() => showNotification('Referral link copied to clipboard!'));
        } else {
            showNotification(`Referral Link: ${link}`);
        }
    };

    const handleNativeShare = () => {
        if (navigator.share) {
            navigator.share({ title: 'REVIEWS WORLD', text: shareText }).catch(() => {});
        } else {
            copyLink();
        }
    };

    document.getElementById('modal-copy-code-btn')?.addEventListener('click', copyCode);
    document.getElementById('modal-copy-link-btn')?.addEventListener('click', copyLink);
    document.getElementById('modal-native-share-btn')?.addEventListener('click', handleNativeShare);
    document.getElementById('modal-share-more')?.addEventListener('click', handleNativeShare);
    document.getElementById('modal-share-instagram')?.addEventListener('click', () => {
        copyCode();
        showNotification('Code copied! Opening Instagram...');
        window.open('https://instagram.com', '_blank');
    });
};

let isFetchingTrackReferrals = false;

const renderTrackReferralsUI = (filter = 'all', referrals = [], isLoading = false) => {
    const filteredList = (referrals || []).filter(item => {
        if (filter === 'all') return true;
        if (filter === 'successful') return item.status === 'successful';
        if (filter === 'pending') return item.status === 'pending';
        return true;
    });

    const totalCount = (referrals || []).length;
    const successCount = (referrals || []).filter(x => x.status === 'successful').length;
    const pendingCount = (referrals || []).filter(x => x.status === 'pending').length;
    const totalEarnings = (referrals || []).reduce((sum, x) => sum + (x.totalEarned || 0), 0);
    const availableEarnings = Number(currentUserData?.referralEarnings || 0);
    const totalTransferred = Number(currentUserData?.referralTransferred || 0);

    let listHtml = '';
    if (isLoading && (!referrals || referrals.length === 0)) {
        listHtml = `
            <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-center space-y-3">
                <div class="inline-block h-7 w-7 animate-spin rounded-full border-3 border-emerald-500 border-t-transparent"></div>
                <h4 class="text-xs font-bold text-slate-600 dark:text-slate-300">Fetching referred users...</h4>
            </div>
        `;
    } else if (filteredList.length === 0) {
        listHtml = `
            <div class="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-center space-y-2">
                <div class="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                </div>
                <h4 class="text-sm font-black text-slate-800 dark:text-white">No Referrals Found</h4>
                <p class="text-xs text-slate-500 dark:text-slate-400">No referral has joined using your link yet. Share your code to start earning bonuses!</p>
            </div>
        `;
    } else {
        listHtml = filteredList.map(item => `
            <div class="track-referral-item flex items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs transition hover:shadow-sm cursor-pointer active:scale-98" onclick="window.showReferralDetailPage('${item.id}')">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="${item.avatar}" alt="${escapeHtml(item.name)}" class="h-10 w-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 bg-white p-0.5 shrink-0">
                    <div class="min-w-0 text-left space-y-0.5">
                        <div class="flex items-center gap-2">
                            <h4 class="text-sm font-black text-slate-900 dark:text-white truncate">${escapeHtml(item.name)}</h4>
                            <span class="rounded-full px-2 py-0.5 text-[9px] font-black border ${item.status === 'successful' ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'}">${escapeHtml(item.statusLabel)}</span>
                        </div>
                        <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">${escapeHtml(maskUserMobile(item.mobile))} • ${item.joinedAt}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0 text-right">
                    <div>
                        <p class="text-xs font-black ${item.status === 'successful' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}">${item.bonusText}</p>
                        <p class="text-[9px] font-bold text-slate-400 dark:text-slate-500">${item.lifetimeText}</p>
                    </div>
                    <div class="flex h-7 w-7 rounded-full shrink-0 items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-400">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>
            </div>
        `).join('');
    }

    const content = `
        <div id="track-referrals-page-marker"></div>
        <div class="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 px-4 py-3 backdrop-blur-md">
            <button type="button" onclick="window.showReferEarnPage(true)" class="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition active:scale-90" aria-label="Back">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <h2 class="text-base font-black text-gray-900 dark:text-white">Track Referrals</h2>
            <div class="w-9"></div>
        </div>

        <div class="max-w-md mx-auto p-3 space-y-3 text-left pb-24">
            <!-- 4 Stat Grid Cards -->
            <div class="grid grid-cols-2 gap-2.5">
                <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs flex items-center gap-2.5">
                    <div class="flex h-9 w-9 rounded-full shrink-0 items-center justify-center bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 border border-emerald-200/50">
                        <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">Total Referrals</p>
                        <h3 class="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">${totalCount}</h3>
                    </div>
                </div>
                <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs flex items-center gap-2.5">
                    <div class="flex h-9 w-9 rounded-full shrink-0 items-center justify-center bg-blue-50 dark:bg-blue-950/50 text-blue-600 border border-blue-200/50">
                        <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">Successful</p>
                        <h3 class="text-xl font-black text-blue-600 dark:text-blue-400 mt-0.5">${successCount}</h3>
                    </div>
                </div>
                <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs flex items-center gap-2.5">
                    <div class="flex h-9 w-9 rounded-full shrink-0 items-center justify-center bg-amber-50 dark:bg-amber-950/50 text-amber-600 border border-amber-200/50">
                        <svg class="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">Pending</p>
                        <h3 class="text-xl font-black text-amber-600 dark:text-amber-400 mt-0.5">${pendingCount}</h3>
                    </div>
                </div>
                <div class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs flex items-center gap-2.5">
                    <div class="flex h-9 w-9 rounded-full shrink-0 items-center justify-center bg-purple-50 dark:bg-purple-950/50 text-purple-600 border border-purple-200/50">
                        <span class="text-base font-black">₹</span>
                    </div>
                    <div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">Total Earnings</p>
                        <h3 class="text-xl font-black text-purple-600 dark:text-purple-400 mt-0.5">₹${totalEarnings.toFixed(2)}</h3>
                    </div>
                </div>
            </div>

            <!-- Referral Balance & Transfer Card -->
            <div class="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 p-3.5 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-left">
                <div class="flex items-center gap-3">
                    <div>
                        <p class="text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Available Balance</p>
                        <p class="text-lg font-black text-emerald-600 dark:text-emerald-300 mt-0.5">₹${availableEarnings.toFixed(2)}</p>
                    </div>
                    <div class="h-7 w-px bg-emerald-200 dark:bg-emerald-800"></div>
                    <div>
                        <p class="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-400">Transferred</p>
                        <p class="text-xs font-black text-slate-700 dark:text-slate-300 mt-0.5">₹${totalTransferred.toFixed(2)}</p>
                    </div>
                </div>
                <button type="button" onclick="window.handleWithdrawReferralEarnings()" class="shrink-0 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 text-xs font-black shadow-xs transition active:scale-95">
                    <span>🚀 Transfer to Main Wallet (Min ₹50)</span>
                </button>
            </div>

            <!-- Filter Tabs -->
            <div class="flex space-x-1.5 overflow-x-auto pb-0.5 pt-1">
                <button type="button" onclick="window.showTrackReferralsPage('all')" class="rounded-lg px-3 py-1.5 text-[11px] font-black transition ${filter === 'all' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">All (${totalCount})</button>
                <button type="button" onclick="window.showTrackReferralsPage('successful')" class="rounded-lg px-3 py-1.5 text-[11px] font-black transition ${filter === 'successful' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">Successful (${successCount})</button>
                <button type="button" onclick="window.showTrackReferralsPage('pending')" class="rounded-lg px-3 py-1.5 text-[11px] font-black transition ${filter === 'pending' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">Pending (${pendingCount})</button>
            </div>

            <!-- Referrals List -->
            <div class="space-y-2">
                ${listHtml}
            </div>
        </div>
        ${getPageFooter()}
    `;

    showPage(content, { keepBottomNav: false });
};

window.showTrackReferralsPage = async (filter = 'all') => {
    if (!ensureUserSessionReady()) return;

    const referrals = realReferralsCache || [];
    const hasCachedData = Array.isArray(referrals) && referrals.length > 0;

    // Immediately render UI (no modal overlay dialog)
    renderTrackReferralsUI(filter, referrals, !hasCachedData);

    // Perform non-blocking background fetch if not already in progress
    if (!isFetchingTrackReferrals) {
        isFetchingTrackReferrals = true;
        fetchRealReferralsData(currentUser?.uid)
            .then(freshList => {
                realReferralsCache = freshList || [];
                if (document.getElementById('track-referrals-page-marker')) {
                    renderTrackReferralsUI(filter, realReferralsCache, false);
                }
            })
            .catch(err => {
                console.warn('Track referrals background fetch error:', err);
                if (document.getElementById('track-referrals-page-marker')) {
                    renderTrackReferralsUI(filter, realReferralsCache || [], false);
                }
            })
            .finally(() => {
                isFetchingTrackReferrals = false;
            });
    }
};

window.showReferralDetailPage = async (referralId = 'ref-1') => {
    if (!ensureUserSessionReady()) return;
    
    let item = realReferralsCache.find(x => x.id === referralId);
    if (!item) {
        if (typeof showLoading === 'function') showLoading();
        await fetchRealReferralsData(currentUser?.uid).catch(() => {});
        if (typeof hideLoading === 'function') hideLoading();
        item = realReferralsCache.find(x => x.id === referralId);
    }

    if (!item) {
        showNotification('Referral detail not found.', true);
        return window.showTrackReferralsPage();
    }

    const content = `
        <div class="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 px-4 py-3 backdrop-blur-md">
            <button type="button" onclick="window.showTrackReferralsPage()" class="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition active:scale-90" aria-label="Back">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <h2 class="text-base font-black text-gray-900 dark:text-white">Referral Detail</h2>
            <div class="w-9"></div>
        </div>

        <div class="max-w-md mx-auto p-3 space-y-3 text-left pb-16">
            <!-- User Header Card -->
            <div class="flex items-center gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs">
                <img src="${item.avatar}" alt="${escapeHtml(item.name)}" class="h-14 w-14 rounded-full object-cover border-2 border-emerald-500 bg-white p-0.5 shrink-0">
                <div class="min-w-0 flex-1 space-y-0.5">
                    <div class="flex items-center justify-between gap-2">
                        <h3 class="text-base font-black text-slate-900 dark:text-white truncate">${escapeHtml(item.name)}</h3>
                        <span class="rounded-full px-2 py-0.5 text-[9px] font-black border ${item.status === 'successful' ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'}">${escapeHtml(item.statusLabel)}</span>
                    </div>
                    <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">📱 ${escapeHtml(maskUserMobile(item.mobile))}</p>
                    <p class="text-[11px] font-semibold text-slate-400 dark:text-slate-500 truncate">📅 Joined on ${item.joinedAt} • ${item.joinedTime}</p>
                </div>
            </div>

            <!-- Earnings Summary Card -->
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-2.5">
                <h4 class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-400">Earnings Summary</h4>
                <div class="grid grid-cols-3 gap-2 pt-0.5 text-center">
                    <div class="bg-emerald-50/70 dark:bg-emerald-950/30 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-800">
                        <p class="text-[9px] font-bold text-slate-400 dark:text-slate-400">Referral Bonus</p>
                        <p class="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">₹${item.referralBonus.toFixed(2)}</p>
                    </div>
                    <div class="bg-blue-50/70 dark:bg-blue-950/30 p-2.5 rounded-xl border border-blue-100 dark:border-blue-800">
                        <p class="text-[9px] font-bold text-slate-400 dark:text-slate-400">Lifetime Earnings</p>
                        <p class="text-sm font-black text-blue-600 dark:text-blue-400 mt-0.5">₹${item.lifetimeEarnings.toFixed(2)}</p>
                    </div>
                    <div class="bg-purple-50/70 dark:bg-purple-950/30 p-2.5 rounded-xl border border-purple-100 dark:border-purple-800">
                        <p class="text-[9px] font-bold text-slate-400 dark:text-slate-400">Total Earned</p>
                        <p class="text-sm font-black text-purple-600 dark:text-purple-400 mt-0.5">₹${item.totalEarned.toFixed(2)}</p>
                    </div>
                </div>
            </div>

            <!-- Activity Timeline -->
            <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-xs space-y-3">
                <h4 class="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-400">Activity Timeline</h4>
                <div class="relative pl-7 space-y-6 before:absolute before:left-[9px] before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-emerald-200 dark:before:bg-emerald-900">
                    
                    <!-- Timeline Item 1 -->
                    <div class="relative">
                        <div class="absolute -left-7 top-0.5" style="width: 20px; height: 20px; min-width: 20px; min-height: 20px; max-width: 20px; max-height: 20px;">
                            <div style="width: 20px; height: 20px; border-radius: 50% !important; background-color: #10b981; display: flex; align-items: center; justify-content: center;">
                                <svg style="width: 12px; height: 12px; color: white; display: block;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">${item.joinedAt} • ${item.joinedTime}</p>
                        <h5 class="text-xs font-black text-slate-900 dark:text-white mt-0.5">Account Created</h5>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">User joined using your referral code</p>
                    </div>

                    ${item.firstWithdrawalAt ? `
                    <!-- Timeline Item 2 -->
                    <div class="relative">
                        <div class="absolute -left-7 top-0.5" style="width: 20px; height: 20px; min-width: 20px; min-height: 20px; max-width: 20px; max-height: 20px;">
                            <div style="width: 20px; height: 20px; border-radius: 50% !important; background-color: #10b981; display: flex; align-items: center; justify-content: center;">
                                <svg style="width: 12px; height: 12px; color: white; display: block;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">${item.firstWithdrawalAt}</p>
                                <h5 class="text-xs font-black text-slate-900 dark:text-white mt-0.5">First Withdrawal</h5>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Friend completed first withdrawal</p>
                            </div>
                            <span class="text-xs font-black text-emerald-600 dark:text-emerald-400">+ ₹5.00</span>
                        </div>
                    </div>` : ''}

                    ${item.latestLifetimeAt ? `
                    <!-- Timeline Item 3 -->
                    <div class="relative">
                        <div class="absolute -left-7 top-0.5" style="width: 20px; height: 20px; min-width: 20px; min-height: 20px; max-width: 20px; max-height: 20px;">
                            <div style="width: 20px; height: 20px; border-radius: 50% !important; background-color: #10b981; display: flex; align-items: center; justify-content: center;">
                                <svg style="width: 12px; height: 12px; color: white; display: block;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-[10px] font-bold text-slate-400 dark:text-slate-400">${item.latestLifetimeAt}</p>
                                <h5 class="text-xs font-black text-slate-900 dark:text-white mt-0.5">Lifetime Bonus Earned</h5>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">You earned 1% of friend's withdrawal</p>
                            </div>
                            <span class="text-xs font-black text-emerald-600 dark:text-emerald-400">+ ₹${item.lifetimeEarnings.toFixed(2)}</span>
                        </div>
                    </div>` : ''}
                </div>
            </div>

            <!-- Bottom Note -->
            <div class="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 flex items-center gap-2.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                <div style="width: 20px; height: 20px; min-width: 20px; min-height: 20px; max-width: 20px; max-height: 20px; border-radius: 50% !important; background-color: #10b981; display: flex; align-items: center; justify-content: center; shrink: 0;">
                    <span style="font-size: 10px; line-height: 1;">⭐</span>
                </div>
                <span>You will continue to earn 1% on all future withdrawals of this friend.</span>
            </div>
        </div>
        ${getPageFooter()}
    `;

    showPage(content, { keepBottomNav: false });
};

const showReferEarnPage = (force = false) => {
        if (!ensureUserSessionReady()) return;
        if (activeChatUnsubscribe) {
            activeChatUnsubscribe();
            activeChatUnsubscribe = null;
        }
        const READY_LS = 'rw_refer_img_ready_v1';
        const READY_SS = 'rw_refer_img_ready_ss_v1';
        let imagesReady = false;
        try { imagesReady = localStorage.getItem(READY_LS) === '1' || sessionStorage.getItem(READY_SS) === '1'; } catch (_) {}

        // NEVER re-render if already visible on main refer page: prevents full repaint blink
        const pageContainer = document.getElementById('page-container');
        const isMainReferPage = pageContainer && pageContainer.querySelector('#open-track-referrals-btn');
        if (!force && currentMainSection === 'refer' && pageContainer && !pageContainer.classList.contains('hidden') && isMainReferPage) {
            setBottomNavActive('bottom-refer-btn');
            return;
        }
        currentMainSection = 'refer';

        const reward = getReferralRewardAmount();
        const referralCode = getProfileReferralCode();
        const referralLink = getProfileReferralLink(referralCode);

        // Blocking image preload + mark ready flag in dual-cache
        ['/assets/images/referral_banner.webp?v=2', '/assets/images/referral_howitworks_cards.webp?v=2', '/assets/images/referral_banner.png?v=2', '/assets/images/referral_howitworks_cards.png?v=2'].forEach(src => {
            try {
                const img = new Image();
                img.decoding = 'sync';
                img.fetchPriority = 'high';
                const mark = () => {
                    try { localStorage.setItem(READY_LS, '1'); sessionStorage.setItem(READY_SS, '1'); } catch (_) {}
                };
                img.onload = img.onerror = mark;
                img.src = src;
            } catch (_) {}
        });

        const content = `
            ${getPageHeader('Refer & Earn', { showBack: false })}
            <div class="max-w-md mx-auto space-y-3 text-left px-0.5 pt-1 pb-24">

                <!-- Top Banner -->
                <div class="relative overflow-hidden rounded-2xl shadow-md border border-emerald-900/20 bg-emerald-900/10 dark:bg-emerald-950/30 aspect-[1024/498] w-full">
                    <picture>
                        <source srcset="/assets/images/referral_banner.webp?v=2" type="image/webp">
                        <img src="/assets/images/referral_banner.png?v=2" alt="Refer & Earn - Invite Friends, Earn Together"
                             loading="eager" fetchpriority="high" decoding="sync"
                             class="w-full h-full object-cover rounded-2xl block border-0 shadow-none">
                    </picture>
                </div>

                <!-- Middle How It Works card -->
                <div class="relative overflow-hidden rounded-2xl shadow-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 aspect-[1024/484] w-full">
                    <picture>
                        <source srcset="/assets/images/referral_howitworks_cards.webp?v=2" type="image/webp">
                        <img src="/assets/images/referral_howitworks_cards.png?v=2" alt="Referral Rewards & How It Works"
                             loading="eager" fetchpriority="high" decoding="sync"
                             class="w-full h-full object-cover rounded-2xl block border-0 shadow-none">
                    </picture>
                </div>

                <!-- Referral Code & Actions Box -->
                <div class="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 p-3 rounded-2xl shadow-xs space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0 text-left flex-1">
                            <p class="text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-400 tracking-wider">YOUR REFERRAL CODE</p>
                            <div class="flex items-center gap-1.5 mt-0.5">
                                <h3 class="text-xs sm:text-sm font-mono font-black text-emerald-950 dark:text-emerald-100 tracking-wider select-all break-all leading-tight">${escapeHtml(referralCode)}</h3>
                                <button type="button" id="main-copy-code-btn" title="Copy Referral Code" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 border border-emerald-300/60 dark:border-emerald-700/60 transition active:scale-90 shadow-xs">
                                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <button type="button" id="open-track-referrals-btn" onclick="window.showTrackReferralsPage()" class="shrink-0 flex items-center gap-1 rounded-xl bg-white dark:bg-slate-800 border border-emerald-400/80 dark:border-emerald-600 px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 transition active:scale-95 shadow-xs">
                            <span>Track Referrals</span>
                            <span class="text-xs font-black">›</span>
                        </button>
                    </div>

                    <div class="flex items-center justify-between gap-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60">
                        <div class="min-w-0 flex-1 text-left">
                            <p class="text-[9px] font-black uppercase text-slate-400 dark:text-slate-400 tracking-wider">REFERRAL LINK</p>
                            <p class="text-[11px] font-mono font-semibold text-emerald-800 dark:text-emerald-300 select-all break-all leading-tight">${escapeHtml(referralLink)}</p>
                        </div>
                        <button type="button" id="main-share-link-btn" title="Share Link" class="shrink-0 flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-black shadow-xs transition active:scale-95">
                            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                            <span>Share Link</span>
                        </button>
                    </div>
                </div>

                <!-- Bottom Auto Rewards Banner -->
                <div class="rounded-xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-2.5 flex items-center gap-2.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-200 shadow-xs">
                    <div class="shrink-0 flex items-center justify-center bg-emerald-500 text-white shadow-xs" style="width: 22px; height: 22px; min-width: 22px; min-height: 22px; max-width: 22px; max-height: 22px; border-radius: 50% !important;">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <span>Rewards will be added automatically after your friend's first withdrawal.</span>
                </div>
            </div>
            ${getPageFooter()}
        `;

        // NO HTML CACHING: stale cached HTML between page swaps was the #1 cause of blink/flash.
        showPage(content, { keepBottomNav: true, returnTo: currentUser?.uid === ADMIN_UID ? 'admin' : 'home' });
        currentMainSection = 'refer';
        setBottomNavActive('bottom-refer-btn');

        document.getElementById('main-copy-code-btn')?.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(referralCode).then(() => showNotification('Referral code copied to clipboard!'));
            } else {
                showNotification(`Referral Code: ${referralCode}`);
            }
        });
        document.getElementById('main-share-link-btn')?.addEventListener('click', () => window.showShareReferralModal(referralCode));
        document.getElementById('open-track-referrals-btn')?.addEventListener('click', () => window.showTrackReferralsPage());
    };



const showUserTaskPageLegacy = () => {
            if (!ensureUserSessionReady()) return;
            currentMainSection = 'task';
            const content = `
                <header class="mb-4 flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 shadow-sm page-header-fixed">
                    <h2 class="text-base font-extrabold uppercase text-slate-950 dark:text-white">Task Mission</h2>
                    <span class="h-9 w-9 overflow-hidden rounded-full bg-slate-100 p-1 dark:bg-slate-700">
                        <img src="${RW_LOGO_URL}" alt="REVIEWS WORLD" class="h-full w-full rounded-full object-cover">
                    </span>
                </header>
                <div class="px-4 pt-1 pb-28">
                    <div class="mx-auto max-w-xl space-y-4">
                        <section class="rounded-[1.75rem] border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-gray-800">
                            <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 p-3 shadow-lg">
                                <img src="https://cdn-icons-png.flaticon.com/512/3176/3176366.png" alt="Tasks" class="h-full w-full object-contain">
                            </div>
                            <p class="mt-5 text-xs font-extrabold uppercase text-blue-600">Coming Soon</p>
                            <h3 class="mt-2 text-2xl font-extrabold text-slate-950 dark:text-white">Live missions are being prepared</h3>
                            <p class="mx-auto mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-500 dark:text-slate-300">Task work will open here after admin makes it live.</p>
                        </section>

                        <section class="space-y-3 opacity-60">
                            <div class="flex items-center justify-between px-1">
                                <p class="text-xs font-extrabold uppercase text-slate-500 dark:text-slate-300">Live Missions</p>
                                <span class="text-[11px] font-bold text-gray-400">0 available</span>
                            </div>
                            <label class="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                                <svg class="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"></path></svg>
                                <input type="search" disabled placeholder="Search app tasks..." class="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500">
                            </label>
                            <div class="pointer-events-none rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-gray-900">
                                <div class="flex items-center gap-3">
                                    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-400 dark:border-slate-700 dark:bg-gray-800">APP</span>
                                    <span class="min-w-0 flex-1">
                                        <span class="block text-sm font-extrabold text-slate-700 dark:text-slate-200">Sample Task</span>
                                        <span class="mt-1 inline-flex rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-300">Instant</span>
                                    </span>
                                    <span class="text-right">
                                        <span class="block text-[8px] font-extrabold uppercase text-slate-400">Reward</span>
                                        <span class="block text-lg font-extrabold text-slate-400">₹--</span>
                                    </span>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
                ${getPageFooter()}`;
            showPage(content, { returnTo: currentUser?.uid === ADMIN_UID ? 'admin' : 'home', keepBottomNav: true });
            setBottomNavActive('bottom-task-btn');
        };

const getPayoutDelayText = (t) => {
    const days = t.paymentDelayDays ?? t.paymentDays ?? t.payoutDelayDays ?? 7;
    const numDays = Number(days);
    if (isNaN(numDays) || numDays <= 0) return 'Instant Payout';
    if (numDays === 1) return '1 Day Payout';
    return `${numDays} Days Payout`;
};

const getPayoutCleanVal = (t) => {
    const days = t.paymentDelayDays ?? t.paymentDays ?? t.payoutDelayDays ?? 7;
    const numDays = Number(days);
    if (isNaN(numDays) || numDays <= 0) return 'Instant';
    if (numDays === 1) return '1 Day';
    return `${numDays} Days`;
};

const getTaskAccent = (subtype) => {
    if (subtype === 'app_review' || subtype === 'app_download_task') {
        return {
            color: 'indigo',
            bgPill: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200/40',
            bgBtn: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/10 hover:shadow-indigo-600/20',
            textClass: 'text-indigo-600 dark:text-indigo-400 font-extrabold',
            iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
            bannerGradient: 'from-indigo-600 to-violet-600'
        };
    } else if (subtype === 'map_review') {
        return {
            color: 'emerald',
            bgPill: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200/40',
            bgBtn: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/10 hover:shadow-emerald-600/20',
            textClass: 'text-emerald-600 dark:text-emerald-400 font-extrabold',
            iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            bannerGradient: 'from-emerald-600 to-teal-600'
        };
    } else {
        return {
            color: 'orange',
            bgPill: 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border-orange-200/40',
            bgBtn: 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-600/10 hover:shadow-orange-600/20',
            textClass: 'text-orange-600 dark:text-orange-400 font-extrabold',
            iconBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
            bannerGradient: 'from-orange-500 to-amber-500'
        };
    }
};

const showUserTaskPage = () => {
            if (!ensureUserSessionReady()) return;
            currentMainSection = 'task';
            localStorage.setItem('last_active_section', 'task');
            document.getElementById('app-top-header')?.classList.add('hidden');
            document.getElementById('dashboard-content')?.classList.add('hidden');
            const isTaskPageEnabled = true;

            const renderUI = (takenCommentsMap = {}, isBackground = false) => {
                if (currentMainSection !== 'task') return;
                
                let taskCategories = [];
                if (isTaskPageEnabled) {
                    const appReviewItems = [];
                    const mapReviewItems = [];
                    const socialTaskItems = [];

                    const isTaskVisibleToUser = (task) => {
                        if (!task || typeof task !== 'object') return false;
                        const userRole = String(currentUserData?.role || '').toLowerCase();
                        const isOwner = currentUser?.uid === ADMIN_UID || currentUser?.email === 'reviewsworld51@gmail.com' || currentUser?.email === 'reviewsworld01@gmail.com' || userRole === 'owner';
                        const isUserSubAdmin = userRole === 'admin' || userRole === 'subadmin';
                        const userUid = String(currentUser?.uid || currentUserData?.uid || '').trim();

                        const userParentAdmin = String(currentUserData?.parentAdmin || currentUserData?.parent_admin || currentUserData?.assignedSubAdmin || currentUserData?.subAdminId || currentUserData?.adminId || '').trim();

                        const taskCreator = String(task.createdBy || task.created_by || task.adminId || task.subAdminId || '').trim();
                        const assigned = Array.isArray(task.assignedToSubAdmins) ? task.assignedToSubAdmins.map(s => String(s).trim()) : [];

                        const isOwnerTask = !taskCreator || taskCreator === ADMIN_UID || taskCreator === 'owner' || taskCreator === 'REVIEWS_WORLD_ADMIN' || taskCreator === 'reviewsworld01@gmail.com' || taskCreator === 'reviewsworld51@gmail.com';

                        if (isOwner) return true;

                        if (isUserSubAdmin) {
                            return isOwnerTask || taskCreator === userUid || assigned.includes(userUid) || assigned.includes('all');
                        }

                        if (assigned.includes('all') || assigned.includes('all_users')) {
                            return true;
                        }

                        if (!isOwnerTask && taskCreator) {
                            if (userParentAdmin) {
                                return taskCreator === userParentAdmin || assigned.includes(userParentAdmin);
                            }
                            return assigned.includes('all');
                        }

                        if (isOwnerTask) {
                            if (assigned.length === 0) return true;
                            if (userParentAdmin && assigned.includes(userParentAdmin)) return true;
                            return false;
                        }

                    };

                    const isBulker = isBulkTaskUser();
                    const hideNewTasksForDailyLimit = !isBulker && userTaskTodaySubmissionIds.size >= NORMAL_USER_DAILY_TASK_LIMIT;

                    (Array.isArray(allTasksCache) ? allTasksCache : [])
                        .filter(isTaskVisibleToUser)
                        .filter(task => getAdminTaskEffectiveStatus(task) === 'active')
                        .filter(task => {
                            const subtype = task.subtype || task.taskSubtype || '';
                            const isReview = subtype === 'app_review' || subtype === 'map_review' || subtype === 'trustpilot_review' || subtype === 'website_review';
                            if (isReview) {
                                const comments = getTaskCommentPool(task);
                                if (comments.length === 0) return false;

                                const hasReservation = typeof hasActiveUserReservation === 'function' && hasActiveUserReservation(task.id);
                                if (!hasReservation) {
                                    const taken = takenCommentsMap[task.id] || [];
                                    const takenSet = new Set(taken.map(c => String(c).trim()));
                                    const available = comments.filter(c => !takenSet.has(String(c).trim()));
                                    if (available.length === 0) {
                                        return false; // Hide task for users without an active reservation
                                    }
                                }
                            }
                            return true;
                        })
                        .filter(task => {
                            const isBulker = isBulkTaskUser();
                            if (typeof userTaskSubmissionIds !== 'undefined' && userTaskSubmissionIds && userTaskSubmissionIds.has(task.id)) {
                                if (!isBulker) {
                                    return false;
                                }
                                const subtype = task.subtype || task.taskSubtype || '';
                                if (subtype === 'read_news') return false;
                                return userTaskTodaySubmissionIds.has(task.id);
                            }
                            return true;
                        })
                        .filter(() => !hideNewTasksForDailyLimit)
                        .forEach(task => {
                            const subtype = task.subtype || task.taskSubtype || '';
                            if (subtype === 'app_review' || subtype === 'app_download_task') {
                                appReviewItems.push(task);
                            } else if (subtype === 'map_review' || subtype === 'trustpilot_review' || subtype === 'website_review') {
                                mapReviewItems.push(task);
                            } else {
                                socialTaskItems.push(task);
                            }
                        });

                    taskCategories = [
                        {
                            label: 'App Review',
                            accent: 'task-accent-blue',
                            logo: PLAY_STORE_LOGO_URL,
                            items: appReviewItems
                        },
                        {
                            label: 'Map Review',
                            accent: 'task-accent-emerald',
                            logo: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
                            items: mapReviewItems
                        },
                        {
                            label: 'Social Media Task',
                            accent: 'task-accent-rose',
                            logo: 'https://cdn-icons-png.flaticon.com/512/4187/4187336.png',
                            items: socialTaskItems
                        }
                    ].filter(cat => cat.items.length > 0);
                }

                const renderTaskCard = (category, task, index) => {
                    const isReal = isTaskPageEnabled;
                    const status = isReal ? getAdminTaskEffectiveStatus(task) : 'draft';
                    const isLive = isReal && status === 'active';
                    const rewardVal = isReal ? getTaskRewardForUser(task, currentUserData) : (task.reward || 0);
                    const reward = `₹${rewardVal}`;
                    const imageUrl = isReal ? (task.imageUrl || category.logo) : category.logo;
                    const taskTitle = isReal ? (task.title || 'Task Mission') : task.title;

                    const subtype = task.subtype || task.taskSubtype || '';
                    const acc = getTaskAccent(subtype);
                    const taskTypeLabel = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Play Store Review' : (subtype === 'map_review' ? 'Map Review' : 'Screenshot Task');
                    const platformLabel = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Play Store App Review' : (subtype === 'map_review' ? 'Google Maps Place Review' : 'Screenshot + Review');
                    const platformLogo = (subtype === 'app_review' || subtype === 'app_download_task') ? PLAY_STORE_LOGO_URL : (subtype === 'map_review' ? 'https://cdn-icons-png.flaticon.com/512/854/854878.png' : 'https://cdn-icons-png.flaticon.com/512/4187/4187336.png');

                    const payoutDelayText = getPayoutDelayText(task);
                    const payoutVal = payoutDelayText.replace(' Payout', '');
                    const approvalVal = payoutVal === 'Instant' ? 'Instant' : `${payoutVal} Later`;

                    const commentPool = getTaskCommentPool(task);
                    const totalSlots = commentPool.length > 0 ? commentPool.length : (task.submissionsLimit || task.totalSlots || 60);
                    const takenList = Array.isArray(takenCommentsMap[task.id]) ? takenCommentsMap[task.id] : [];
                    const usedOrReservedCount = Math.min(totalSlots, Math.max(task.submissionsCount || 0, takenList.length));

                    if (isLive) {
                        return `
                            <div class="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-[1.75rem] p-5 shadow-sm hover:shadow-md hover:scale-[1.01] transition-all duration-200 flex flex-col gap-4 cursor-pointer" data-action="open-user-task" data-taskid="${task.id}">
                                <!-- Top Row: Icon, Title & Reward -->
                                <div class="flex items-start justify-between gap-3 text-left">
                                    <div class="flex items-center gap-3.5 min-w-0">
                                        <!-- Icon -->
                                        <div class="h-14 w-14 overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-100 dark:border-slate-700 shadow-inner">
                                            <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(taskTitle)}" class="h-full w-full object-cover">
                                        </div>
                                        <!-- Title & Platform info -->
                                        <div class="min-w-0 flex flex-col">
                                            <span class="inline-flex rounded-lg px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider w-fit border ${acc.bgPill}">
                                                ${escapeHtml(taskTypeLabel)}
                                            </span>
                                            <h4 class="text-sm md:text-base font-black text-slate-950 dark:text-white mt-1.5 truncate pr-1 leading-tight">${escapeHtml(taskTitle)}</h4>
                                            <div class="flex items-center gap-1.5 mt-1 text-[10px] text-gray-500">
                                                <img src="${platformLogo}" alt="platform" class="h-3.5 w-3.5 object-contain shrink-0">
                                                <span>${escapeHtml(platformLabel)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- Reward Right-Aligned -->
                                    <div class="flex flex-col items-end shrink-0">
                                        <span class="text-lg md:text-xl font-black text-${acc.color}-600 dark:text-${acc.color}-400">${escapeHtml(reward)}</span>
                                        <span class="text-[8px] font-black text-gray-400 uppercase tracking-wider mt-0.5">Per Approve</span>
                                    </div>
                                </div>

                                <!-- Divider Line -->
                                <div class="border-t border-slate-100 dark:border-slate-800/80"></div>

                                <!-- Middle Row: Metrics Grid -->
                                <div class="grid grid-cols-3 gap-2 py-1 text-left">
                                    <!-- Payout Column -->
                                    <div class="flex items-center gap-2">
                                        <span class="p-1.5 rounded-lg bg-${acc.color}-500/10 ${acc.textClass} shrink-0">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none">Payout</p>
                                            <p class="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">${escapeHtml(payoutVal)}</p>
                                        </div>
                                    </div>

                                    <!-- Approval Column -->
                                    <div class="flex items-center gap-2 border-l border-slate-100 dark:border-slate-800/80 pl-2">
                                        <span class="p-1.5 rounded-lg bg-${acc.color}-500/10 ${acc.textClass} shrink-0">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none">Approval</p>
                                            <p class="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">${escapeHtml(approvalVal)}</p>
                                        </div>
                                    </div>

                                    <!-- Used / Reserved Comments Column -->
                                    <div class="flex items-center gap-2 border-l border-slate-100 dark:border-slate-800/80 pl-2">
                                        <span class="p-1.5 rounded-lg bg-${acc.color}-500/10 ${acc.textClass} shrink-0">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none">Used / Reserved</p>
                                            <p class="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">${usedOrReservedCount}/${totalSlots}</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- Start Task Button -->
                                <button class="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all duration-200 active:scale-[0.99] shadow-sm ${acc.bgBtn}" data-action="open-user-task" data-taskid="${task.id}">
                                    <span>Start Task</span>
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                                </button>
                            </div>`;
                    } else {
                        return '';
                    }
                };

                const renderCategory = (category) => `
                    <section class="task-category-block ${category.accent} mb-6">
                        <div class="task-category-title flex items-center gap-2 mb-3">
                            <span class="task-category-mark h-4 w-1 bg-indigo-600 dark:bg-indigo-400 rounded-full"></span>
                            <h3 class="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">${escapeHtml(category.label)}</h3>
                        </div>
                        <div class="flex flex-col gap-4">
                            ${category.items.map((task, index) => renderTaskCard(category, task, index)).join('')}
                        </div>
                    </section>`;

                let bodyContent = '';
                const isInitialTaskLoading = !window.hasInitialTasksLoaded && (!allTasksCache || allTasksCache.length === 0);
                if (isInitialTaskLoading) {
                    bodyContent = `
                        <div class="space-y-4">
                            <div class="glass-task-skeleton glass-shimmer p-5">
                                <div class="flex items-center gap-3 mb-3">
                                    <div class="h-4 w-4 rounded-full bg-indigo-500/40"></div>
                                    <div class="h-4 w-36 rounded-md bg-slate-200 dark:bg-slate-700"></div>
                                </div>
                                <div class="h-16 w-full rounded-xl bg-slate-100 dark:bg-slate-800/70 mb-3"></div>
                                <div class="h-11 w-full rounded-2xl bg-indigo-600/25"></div>
                            </div>
                            <div class="glass-task-skeleton glass-shimmer p-5">
                                <div class="flex items-center gap-3 mb-3">
                                    <div class="h-4 w-4 rounded-full bg-indigo-500/40"></div>
                                    <div class="h-4 w-44 rounded-md bg-slate-200 dark:bg-slate-700"></div>
                                </div>
                                <div class="h-16 w-full rounded-xl bg-slate-100 dark:bg-slate-800/70 mb-3"></div>
                                <div class="h-11 w-full rounded-2xl bg-indigo-600/25"></div>
                            </div>
                        </div>`;
                } else if (taskCategories.length === 0) {
                    bodyContent = `
                        <div class="rounded-3xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center bg-white dark:bg-gray-800 shadow-sm">
                            <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 mb-4">
                                <img src="https://cdn-icons-png.flaticon.com/512/3176/3176366.png" alt="Coming soon" class="h-8 w-8 object-contain">
                            </div>
                            <h3 class="text-lg font-black text-gray-900 dark:text-white">Missions Coming Soon</h3>
                            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">New activities and updates are coming soon. Keep the app updated for future releases.</p>
                        </div>`;
                } else {
                    bodyContent = taskCategories.map(renderCategory).join('');
                }

                const shellContainer = document.querySelector('.task-page-shell .max-w-xl');
                if (shellContainer && currentMainSection === 'task') {
                    shellContainer.innerHTML = bodyContent;
                } else if (!isBackground) {
                    const content = `
                        <header class="mb-4 bg-white/95 px-4 py-3 shadow-sm backdrop-blur page-header-fixed dark:bg-gray-900/95">
                            <div class="flex items-center justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="text-lg font-black uppercase text-slate-950 dark:text-white">RW TASK</p>
                                </div>
                                <div class="task-header-actions">
                                    <button type="button" data-action="open-task-ads-page" class="task-mini-action">
                                        <img src="https://cdn-icons-png.flaticon.com/512/2659/2659360.png" alt="Ads" loading="eager" decoding="async">
                                        <span>Ads</span>
                                    </button>
                                    <button type="button" data-action="open-task-bonus-page" class="task-mini-action">
                                        <img src="https://cdn-icons-png.flaticon.com/512/2611/2611152.png" alt="Bonus" loading="eager" decoding="async">
                                        <span>Bonus</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        <div class="task-page-shell px-4 pt-1 pb-28">
                            <div class="mx-auto max-w-xl space-y-4">
                                ${bodyContent}
                            </div>
                        </div>
                        ${getPageFooter()}`;
                    
                    showPage(content, { returnTo: currentUser?.uid === ADMIN_UID ? 'admin' : 'home', keepBottomNav: true });
                    setBottomNavActive('bottom-task-btn');
                }
            };

            // Render UI immediately
            renderUI(window.lastTakenCommentsMap || {}, false);

            // Fetch live data silently in the background
            if (isTaskPageEnabled) {
                (async () => {
                    // 1. Fetch live tasks from Firestore
                    if (typeof db !== 'undefined' && typeof appId !== 'undefined' && typeof collection === 'function' && typeof getDocs === 'function') {
                        try {
                            const snapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/tasks`));
                            const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                            allTasksCache = docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                            localStorage.setItem('all_tasks_cache', JSON.stringify(allTasksCache));
                            window.hasInitialTasksLoaded = true;
                            if (currentMainSection === 'task') {
                                renderUI(window.lastTakenCommentsMap || {}, true);
                            }
                        } catch (taskErr) {
                            console.warn('Failed to refresh tasks silently:', taskErr);
                        }
                    }

                    // 2. Fetch availability
                    try {
                        const token = await getBackendAuthToken();
                        const resp = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/tasks/availability`, {
                            headers: { Authorization: `Bearer ${token}` }
                        }, 5000);
                        const d = await resp.json();
                        if (d.ok && d.takenComments) {
                            window.lastTakenCommentsMap = d.takenComments;
                            if (currentMainSection === 'task') {
                                renderUI(d.takenComments, true);
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to load task availability silently:', e);
                    }
                })();
            }
        };

const showTaskFeatureComingSoonPage = (feature = 'ads') => {
    const isAds = feature === 'ads';
    const title = isAds ? 'Watch Ads & Earn' : 'Daily Bonus';
    const icon = isAds
        ? 'https://cdn-icons-png.flaticon.com/512/2659/2659360.png'
        : 'https://cdn-icons-png.flaticon.com/512/2611/2611152.png';
    const headline = isAds
        ? 'Earn from watching banner Ads, videos ads.'
        : 'Claim daily bonus, spin wheel and earn money upto 5 rupees.';
    const content = `
        ${getPageHeader(title)}
        <div class="mx-auto max-w-md pb-24">
            <section class="relative overflow-hidden rounded-3xl border border-slate-100 bg-white p-5 text-center shadow-xl dark:border-slate-700 dark:bg-gray-800">
                <div class="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 shadow-inner dark:bg-gray-900">
                    <img src="${icon}" alt="${title}" class="h-12 w-12 object-contain" loading="eager" decoding="async">
                </div>
                <p class="mt-5 text-[10px] font-black uppercase text-blue-600 dark:text-blue-300">Coming Soon</p>
                <h3 class="mt-2 text-2xl font-black leading-tight text-slate-950 dark:text-white">${headline}</h3>
                <div class="mt-5 rounded-2xl bg-blue-50 px-4 py-4 text-sm font-bold leading-6 text-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
                    This feature is not available yet. It will be announced soon...
                </div>
            </section>
        </div>
        ${getPageFooter()}`;
    showPage(content, { returnTo: 'task', keepBottomNav: false, onBack: showUserTaskPage });
    setBottomNavActive('bottom-task-btn');
};

const showUserReadNewsTaskPage = (task) => {
            const reward = task.rate || task.reward || 0;
            const appName = task.appName || task.title || 'Read News';
            const newsLinks = Array.isArray(task.newsLinks) ? task.newsLinks : [];
            
            // Track read status for links
            const readStatus = new Array(newsLinks.length).fill(false);
            
            const content = `
                <header class="mb-4 flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 shadow-sm page-header-fixed">
                    <div class="flex items-center gap-3">
                        <button class="page-back-btn rounded-full p-2 text-slate-900 dark:text-white">
                            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 12H5m7 7-7-7 7-7"></path></svg>
                        </button>
                        <h2 class="text-base font-black uppercase text-slate-955 dark:text-white">News Mission</h2>
                    </div>
                    <span class="h-9 w-9 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center p-1.5 border border-gray-200">
                        <img src="https://cdn-icons-png.flaticon.com/512/2540/2540832.png" alt="News" class="h-full w-full object-contain">
                    </span>
                </header>
                <div class="px-4 pb-24 h-[calc(100vh-80px)] flex flex-col justify-between">
                    <div class="mx-auto max-w-xl w-full flex-1 flex flex-col justify-between space-y-4">
                        <section class="overflow-hidden rounded-[1.75rem] border-t-4 border-slate-950 bg-white shadow-xl dark:border-white dark:bg-gray-800 flex-1 flex flex-col justify-between">
                            <div class="flex items-start justify-between bg-slate-50 p-4 dark:bg-slate-900 shrink-0">
                                <div>
                                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-950 dark:text-white">Earn From Read News</p>
                                    <h3 class="mt-1 text-base font-black text-slate-950 dark:text-white">${escapeHtml(appName)}</h3>
                                    <span class="mt-0.5 inline-flex rounded bg-white px-2 py-0.5 text-[9px] font-black uppercase text-slate-600 shadow-sm dark:bg-slate-700 dark:text-white">Instant Credit</span>
                                </div>
                                <div class="rounded-xl bg-slate-950 px-4 py-2 text-center text-white shadow-md">
                                    <p class="text-[8px] font-black uppercase text-white/60">Reward</p>
                                    <p class="text-lg font-black">${formatCurrency(reward).replace('.00', '')}</p>
                                </div>
                            </div>
                            
                            <!-- News Links Boxes Grid (Fixed in single screen) -->
                            <div class="p-4 flex-grow flex flex-col justify-center space-y-2">
                                <p class="text-center text-xs font-bold text-gray-500 dark:text-gray-400">Click and read all ${newsLinks.length} news for 10 seconds each:</p>
                                <div class="grid grid-cols-1 gap-2 flex-grow justify-center content-center max-h-[50vh] overflow-y-auto">
                                    ${newsLinks.map((newsUrl, idx) => {
                                        return `
                                            <button type="button" data-news-idx="${idx}" data-news-url="${escapeHtml(newsUrl)}" class="news-box-btn flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-slate-50 dark:bg-slate-900 transition text-left hover:bg-slate-100 dark:hover:bg-slate-800">
                                                <div class="flex items-center gap-3">
                                                    <span class="news-num-badge flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-black text-sm">${idx + 1}</span>
                                                    <div>
                                                        <span class="block text-xs font-black text-slate-955 dark:text-white">News Article ${idx + 1}</span>
                                                        <span class="block text-[9px] text-gray-400">Read & wait 10s</span>
                                                    </div>
                                                </div>
                                                <span class="news-status-pill text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Pending</span>
                                            </button>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                            
                            <div class="p-4 bg-slate-50 dark:bg-slate-900 shrink-0">
                                <button id="news-task-submit-btn" class="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-black uppercase tracking-wide text-white disabled:bg-slate-400" disabled>Complete Task</button>
                            </div>
                        </section>
                    </div>
                </div>
                
                <!-- Mini Web Opener Overlay -->
                <div id="mini-web-opener-overlay" class="fixed inset-0 z-[10000] hidden bg-slate-950 flex flex-col">
                    <div class="flex items-center justify-between bg-white dark:bg-gray-900 px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
                        <div class="flex items-center gap-2">
                            <span class="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping"></span>
                            <span id="web-opener-title" class="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Reading News Article...</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <span id="web-opener-timer" class="text-sm font-black text-blue-600 dark:text-blue-400">10s remaining</span>
                            <button id="web-opener-close-btn" class="hidden rounded-lg bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-200 px-3 py-1.5 text-xs font-black">Close</button>
                        </div>
                    </div>
                    <div class="flex-grow bg-white dark:bg-gray-900 relative">
                        <iframe id="web-opener-iframe" class="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
                        <div id="web-opener-loading" class="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-955 z-10">
                            <div class="flex flex-col items-center gap-2">
                                <svg class="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <p class="text-xs font-bold text-gray-500">Loading Article...</p>
                                <p class="text-[10px] text-gray-400 mt-1">If loading is blocked, timer will still complete.</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            showPage(content, { returnTo: 'task', keepBottomNav: false, onBack: showUserTaskPage });
            setBottomNavActive('bottom-task-btn');
            
            // Bind back button
            const backBtn = document.querySelector('.page-back-btn');
            if (backBtn) {
                backBtn.onclick = () => showUserTaskPage();
            }
            
            // Bind iframe load event
            const iframe = document.getElementById('web-opener-iframe');
            const openerLoading = document.getElementById('web-opener-loading');
            if (iframe && openerLoading) {
                iframe.onload = () => {
                    openerLoading.classList.add('hidden');
                };
            }
            
            // Opener Close Action
            let activeIdx = -1;
            const closeBtn = document.getElementById('web-opener-close-btn');
            const overlay = document.getElementById('mini-web-opener-overlay');
            
            const handleCloseOpener = () => {
                if (activeIdx !== -1) {
                    readStatus[activeIdx] = true;
                    // Update main box UI
                    const box = document.querySelector(`[data-news-idx="${activeIdx}"]`);
                    if (box) {
                        const statusPill = box.querySelector('.news-status-pill');
                        if (statusPill) {
                            statusPill.textContent = 'Completed ✅';
                            statusPill.className = 'news-status-pill text-[10px] font-black uppercase tracking-wide px-2.5 py-1 rounded-lg bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300';
                        }
                        box.classList.add('border-green-200', 'bg-green-50/20', 'dark:border-green-900/30');
                        box.disabled = true;
                    }
                }
                
                // Hide overlay
                if (overlay) overlay.classList.add('hidden');
                if (iframe) iframe.src = 'about:blank';
                activeIdx = -1;
                
                // Check if all complete
                const allDone = readStatus.every(status => status === true);
                const submitBtn = document.getElementById('news-task-submit-btn');
                if (submitBtn) {
                    submitBtn.disabled = !allDone;
                }
            };
            
            if (closeBtn) {
                closeBtn.onclick = handleCloseOpener;
            }
            
            // Box clicks
            document.querySelectorAll('.news-box-btn').forEach(btn => {
                btn.onclick = () => {
                    const idx = Number(btn.dataset.newsIdx);
                    const url = btn.dataset.newsUrl;
                    if (!url) return showNotification('News url is missing.', true);
                    
                    activeIdx = idx;
                    
                    // Show overlay
                    if (overlay) overlay.classList.remove('hidden');
                    if (openerLoading) openerLoading.classList.remove('hidden');
                    if (closeBtn) closeBtn.classList.add('hidden');
                    
                    const timerText = document.getElementById('web-opener-timer');
                    if (timerText) timerText.textContent = '10s remaining';
                    
                    if (iframe) iframe.src = url;
                    
                    // Start timer
                    let seconds = 10;
                    const interval = setInterval(() => {
                        seconds--;
                        if (seconds > 0) {
                            if (timerText) timerText.textContent = `${seconds}s remaining`;
                        } else {
                            clearInterval(interval);
                            if (timerText) timerText.textContent = 'Completed ✅';
                            if (closeBtn) closeBtn.classList.remove('hidden');
                            if (openerLoading) openerLoading.classList.add('hidden');
                            showNotification(`News Article ${idx + 1} read completed!`);
                        }
                    }, 1000);
                };
            });
            
            // Submit Task
            const submitBtn = document.getElementById('news-task-submit-btn');
            if (submitBtn) {
                submitBtn.onclick = async () => {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Crediting reward...';
                    
                    try {
                        const token = await getBackendAuthToken();
                        const resp = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-submissions`, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ taskId: task.id })
                        }, 15000);
                        
                        const resData = await resp.json().catch(() => ({}));
                        if (!resp.ok || !resData.ok) {
                            throw new Error(resData.detail || resData.error || 'Submission failed');
                        }
                        
                        // Success! Update local cache and UI
                        currentUserData.balance = (currentUserData.balance || 0) + reward;
                        userTaskSubmissionIds.add(task.id);
                        userTaskTodaySubmissionIds.add(task.id);
                        
                        showNotification(`Congratulations! ₹${reward} credited to your wallet.`);
                        showUserTaskPage();
                    } catch (err) {
                        console.error('Submit news task failed:', err);
                        showNotification(err.message || 'Verification failed. Please try again.', true);
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Complete Task';
                    }
                };
            }
        };

// Image compression helper
const compressImage = async (file) => {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) {
            resolve(file);
            return;
        }
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 950;
            const MAX_HEIGHT = 1250;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                if (!blob) {
                    resolve(file);
                    return;
                }
                const compressedFile = new File([blob], file.name, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                });
                resolve(compressedFile.size < file.size ? compressedFile : file);
            }, 'image/jpeg', 0.70);
        };
        img.onerror = () => resolve(file);
    });
};

// Mini thumbnail helper
const generateMiniThumbnail = (file) => {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            const canvas = document.createElement('canvas');
            const size = 60;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.max(size / img.width, size / img.height);
            const x = (size - img.width * scale) / 2;
            const y = (size - img.height * scale) / 2;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(null);
    });
};

// Helper for real-time progress uploading using XMLHttpRequest
const uploadFileWithProgress = (url, file, headers, onProgress) => {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        
        for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
        }
        
        if (xhr.upload && typeof onProgress === 'function') {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    onProgress(percent);
                }
            };
        }
        
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve({ ok: true, status: xhr.status, data });
                } catch (err) {
                    resolve({ ok: true, status: xhr.status, data: {} });
                }
            } else {
                try {
                    const data = JSON.parse(xhr.responseText);
                    reject(new Error(data.detail || data.error || `Upload failed with status ${xhr.status}`));
                } catch {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            }
        };
        
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error('Upload timeout'));
        
        xhr.timeout = 45000;
        xhr.send(file);
    });
};

// Queue Manager Class
class TaskUploadQueueManager {
    constructor() {
        this.queues = {}; // taskId -> array of items
        this.callbacks = {}; // taskId -> function to update UI
        this.inFlightComments = {}; // taskId -> Set of comments currently matching
        this.isProcessing = {}; // taskId -> boolean
        
        // Listen to network status
        window.addEventListener('online', () => this.resumeAll());
        window.addEventListener('offline', () => this.pauseAll());
    }

    getQueue(taskId) {
        return this.queues[taskId] || [];
    }

    registerCallback(taskId, callback) {
        this.callbacks[taskId] = callback;
    }

    unregisterCallback(taskId) {
        delete this.callbacks[taskId];
    }

    notify(taskId) {
        if (this.callbacks[taskId]) {
            this.callbacks[taskId](this.getQueue(taskId));
        }
    }

    async addFiles(taskId, files, isBulk, task, reward, appName, taskLink, image, taskTitle, commentPool, submittedComments) {
        if (!this.queues[taskId]) {
            this.queues[taskId] = [];
            this.inFlightComments[taskId] = new Set();
        }

        const startIndex = this.queues[taskId].length;
        
        const effectiveReward = typeof getTaskRewardForUser === 'function' ? getTaskRewardForUser(task, currentUserData) : (reward || 0);

        // Add placeholders with Waiting status
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const itemIndex = startIndex + i;
            const queueItem = {
                index: itemIndex,
                fileName: file.name,
                fileSize: file.size,
                status: 'Waiting', // 'Waiting', 'Uploading', 'OCR Processing', 'Uploaded', 'Failed'
                progress: 0,
                error: '',
                thumbnailUrl: '',
                rawFile: file,
                compressedFile: null,
                isBulk,
                task,
                reward: effectiveReward,
                appName,
                taskLink,
                image,
                taskTitle,
                commentPool,
                submittedComments
            };
            this.queues[taskId].push(queueItem);
        }

        this.notify(taskId);

        // Lazily generate thumbnails and compress images asynchronously
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const itemIndex = startIndex + i;
            const item = this.queues[taskId][itemIndex];
            
            // Generate thumbnail
            generateMiniThumbnail(file).then(thumb => {
                item.thumbnailUrl = thumb;
                this.notify(taskId);
            });

            // Compress image
            compressImage(file).then(compressed => {
                item.compressedFile = compressed;
                item.fileSize = compressed.size;
                if (item.status === 'Waiting') {
                    this.processQueue(taskId);
                }
            });
        }

        this.processQueue(taskId);
    }

    pauseAll() {
        showNotification('Internet disconnected. Upload queue paused.', true);
        Object.keys(this.queues).forEach(taskId => {
            this.isProcessing[taskId] = false;
            this.notify(taskId);
        });
    }

    resumeAll() {
        showNotification('Internet connection returned. Resuming uploads...');
        Object.keys(this.queues).forEach(taskId => {
            this.processQueue(taskId);
        });
    }

    retryFailed(taskId) {
        const queue = this.getQueue(taskId);
        queue.forEach(item => {
            if (item.status === 'Failed') {
                item.status = 'Waiting';
                item.error = '';
                item.progress = 0;
            }
        });
        this.notify(taskId);
        this.processQueue(taskId);
    }

    clearQueue(taskId) {
        this.queues[taskId] = [];
        this.inFlightComments[taskId] = new Set();
        this.isProcessing[taskId] = false;
        this.notify(taskId);
    }

    async processQueue(taskId) {
        if (!navigator.onLine) return;
        if (this.isProcessing[taskId]) return;
        this.isProcessing[taskId] = true;

        const queue = this.getQueue(taskId);
        
        while (navigator.onLine) {
            // Count currently active uploads - Fast parallel batching up to 15 concurrent uploads!
            const activeCount = queue.filter(item => item.status === 'Uploading' || item.status === 'Verifying Screenshot' || item.status === 'Extracting Review' || item.status === 'Matching Comment' || item.status === 'System Checking').length;
            if (activeCount >= 15) {
                break;
            }

            // Find next waiting item
            const nextItem = queue.find(item => item.status === 'Waiting');
            if (!nextItem) {
                break;
            }

            // Process item asynchronously to maintain high concurrency
            this.uploadItem(taskId, nextItem);
        }

        this.isProcessing[taskId] = false;
    }

    async uploadItem(taskId, item) {
        const fileToUpload = item.compressedFile || item.rawFile;
        item.status = 'System Checking';
        item.progress = 10;
        this.notify(taskId);

        let activeReservation = null;

        const isCommentTask = (Array.isArray(item.commentPool) && item.commentPool.length > 0) ||
                               (Array.isArray(item.task?.commentPool) && item.task.commentPool.length > 0) ||
                               (Array.isArray(item.task?.comments) && item.task.comments.length > 0) ||
                               !!item.task?.assignedComment || !!item.task?.comment ||
                               (function() {
                                 const t = String(item.task?.title || item.task?.name || item.appName || '').toLowerCase();
                                 return t.includes('review') || t.includes('comment') || t.includes('playstore') || t.includes('map');
                               })();

        try {
            if (!navigator.onLine) throw new Error('Offline');

            let ocrText = '';
            let clientOcrSuccess = false;

            // Only run OCR Space if task requires review/comment verification
            if (isCommentTask) {
                try {
                    const formData = new FormData();
                    formData.append('file', fileToUpload);
                    formData.append('language', 'eng');
                    formData.append('OCREngine', '2');
                    formData.append('apikey', 'helloworld');

                    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
                        method: 'POST',
                        body: formData
                    });
                    if (ocrResponse.ok) {
                        const ocrData = await ocrResponse.json();
                        if (ocrData.OCRExitCode === 1 && ocrData.ParsedResults && ocrData.ParsedResults.length > 0) {
                            ocrText = ocrData.ParsedResults[0].ParsedText || '';
                            clientOcrSuccess = true;
                        }
                    }
                } catch (ocrErr) {
                    console.error('Client OCR call failed:', ocrErr);
                }
            }

            if (!navigator.onLine) throw new Error('Offline');

            let gmailName = 'Unknown User';
            let skipOcr = isCommentTask ? 'false' : 'true';
            let matchedComment = '';

            if (!isCommentTask) {
                // Non-comment task (Install, Signup, Follow, Like, etc.): Submit immediately with OCR skipped
                skipOcr = 'true';
            } else if (item.isBulk) {
                // BULK MODE: Match comment from remaining pool (excluding submitted and in-flight comments)
                const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const ocrTextLower = ocrText.toLowerCase().replace(/[^a-z0-9\s]/g, '');
                
                const remainingComments = item.commentPool.filter(c => {
                    const cleanC = String(c).trim();
                    return !item.submittedComments.includes(cleanC) && !this.inFlightComments[taskId].has(cleanC);
                });

                skipOcr = 'true';
                if (clientOcrSuccess) {
                    for (const comment of remainingComments) {
                        if (window.verifyClientCommentMatch ? window.verifyClientCommentMatch(ocrText, comment) : true) {
                            matchedComment = comment;
                            break;
                        }
                    }

                    if (!matchedComment && remainingComments.length > 0) {
                        matchedComment = remainingComments[0];
                    }

                    if (matchedComment) {
                        const cleanMatched = String(matchedComment).trim();
                        this.inFlightComments[taskId].add(cleanMatched);
                        
                        try {
                            gmailName = await window.extractReviewerName(ocrText, matchedComment);
                        } catch (chatErr) {
                            console.warn('Failed to extract name:', chatErr);
                        }
                    }
                } else if (remainingComments.length > 0) {
                    matchedComment = remainingComments[0];
                }
            } else {
                // SINGLE MODE: Strictly enforce reserved comment
                activeReservation = window.activeTaskReservation;
                if (!activeReservation || !activeReservation.comment) {
                    try {
                        activeReservation = await findReusableTaskReservation(item.task.id, currentUser.uid);
                    } catch (e) {}
                }
                if (!activeReservation || !activeReservation.comment) {
                    try {
                        activeReservation = await reserveTaskReviewComment(item.task);
                    } catch (e) {}
                }
                matchedComment = activeReservation?.comment || '';

                if (clientOcrSuccess && matchedComment) {
                    try {
                        gmailName = await window.extractReviewerName(ocrText, matchedComment);
                    } catch (chatErr) {
                        console.warn('Failed to extract name:', chatErr);
                    }
                }
                skipOcr = 'true';
            }

            if (!navigator.onLine) throw new Error('Offline');

            item.status = 'Uploading';
            item.progress = 40;
            this.notify(taskId);

            const gmailLogoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(gmailName)}&background=random`;
            const token = await getBackendAuthToken();
            const params = new URLSearchParams({
                taskId: item.task.id,
                fileName: fileToUpload.name,
                appName: item.appName || 'Unknown App',
                isBulk: item.isBulk ? 'true' : 'false',
                skipOcr,
                ocrText: ocrText.slice(0, 1000),
                gmailName,
                gmailLogoUrl,
                matchedComment: matchedComment || '',
                assignedComment: matchedComment || ''
            });

            const uploadUrl = `${BACKEND_BASE_URL}/api/uploads/task-screenshot?${params.toString()}`;
            const headers = {
                Authorization: `Bearer ${token}`,
                'Content-Type': fileToUpload.type || 'image/jpeg'
            };

            const uploadResult = await uploadFileWithProgress(uploadUrl, fileToUpload, headers, (percent) => {
                item.progress = Math.round(40 + (percent * 0.45));
                this.notify(taskId);
            });

            const uploadData = uploadResult.data || {};
            const verification = uploadData.verification || {};
            const finalComment = verification.matchedComment || matchedComment || activeReservation?.comment || '';
            if (item.isBulk && !matchedComment && finalComment) {
                matchedComment = finalComment;
                this.inFlightComments[taskId].add(String(finalComment).trim());
            }

            const screenshotUrl = uploadData?.screenshot?.url 
                || uploadData?.screenshot?.viewUrl 
                || uploadData?.screenshot?.view_url 
                || uploadData?.screenshotUrl 
                || uploadData?.url 
                || uploadData?.screenshot?.drivePath 
                || '';
            const screenshotKey = uploadData?.screenshot?.key || uploadData?.key || '';
            const screenshotViewUrl = uploadData?.screenshot?.viewUrl || uploadData?.viewUrl || screenshotUrl;
            const screenshotDrivePath = uploadData?.screenshot?.drivePath || uploadData?.drivePath || '';

            if (!screenshotUrl) {
                throw new Error('Screenshot upload failed to generate image URL. Please re-upload your screenshot.');
            }

            if (!navigator.onLine) throw new Error('Offline');

            item.progress = 70;
            this.notify(taskId);

            const commentsPool = getTaskCommentPool(item.task);
            const commentIdx = commentsPool.indexOf(finalComment);
            const finalCommentIndex = activeReservation 
                ? (activeReservation.commentIndex ?? activeReservation.comment_index ?? 0) 
                : (commentIdx >= 0 ? commentIdx : 0);
            const taskIndexVal = item.task.taskIndex || item.task.task_index || 1;

            const reservationId = item.isBulk
                ? `res_bulk_${item.task.id.slice(0, 12)}_${currentUser.uid.slice(0, 12)}_${Date.now()}`
                : (activeReservation?.id || getTaskReservationDocId(item.task.id, currentUser.uid));
            
            const submissionId = `sub_${item.task.id.slice(0, 12)}_${currentUser.uid.slice(0, 12)}_${Date.now()}_${item.index}`;

            const submitResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-submissions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: submissionId,
                    taskId: item.task.id,
                    reservationId,
                    assignedComment: finalComment,
                    screenshotUrl,
                    screenshotKey,
                    screenshotViewUrl,
                    screenshotDrivePath,
                    reward: Number(item.reward || 0),
                    taskLink: item.taskLink,
                    appName: item.appName,
                    userName: currentUserData?.name || currentUser.email || 'User',
                    userEmail: currentUser.email || currentUserData?.email || '',
                    payoutDelayDays: Number(item.task.paymentDelayDays || item.task.paymentDays || 7),
                    ocrStatus: 'completed',
                    ocrExtractedName: verification.gmailName,
                    ocrExtractedText: verification.ocrText || ocrText,
                    ocrConfidence: verification.ocrConfidence || 1.0,
                    details: { 
                        gmailLogoUrl: verification.gmailLogoUrl, 
                        avatarHash: verification.avatarHash || '', 
                        avatarCrop: verification.avatarCrop || null,
                        taskIndex: taskIndexVal,
                        task_index: taskIndexVal,
                        commentIndex: finalCommentIndex,
                        comment_index: finalCommentIndex
                    }
                })
            }, 15000);

            const resData = await submitResponse.json().catch(() => ({}));
            if (!submitResponse.ok || !resData.ok) {
                throw new Error(resData.detail || resData.error || 'Submission failed');
            }

            if (!navigator.onLine) throw new Error('Offline');

            item.progress = 90;
            this.notify(taskId);

            await setDoc(doc(db, `artifacts/${appId}/public/data/task_submissions`, submissionId), {
                id: submissionId,
                taskId: item.task.id,
                taskCode: item.task.taskCode || item.task.id,
                taskTitle: item.taskTitle,
                taskFamily: getAdminTaskFamily(item.task),
                taskSubtype: getAdminTaskSubtype(item.task),
                taskSubtypeLabel: item.task.taskSubtypeLabel || getAdminTaskSubtypeMeta(getAdminTaskFamily(item.task), getAdminTaskSubtype(item.task)).label,
                appName: item.appName,
                appLogoUrl: item.image,
                taskLink: item.taskLink,
                userId: currentUser.uid,
                userName: currentUserData?.name || currentUser.email || 'User',
                userEmail: currentUser.email || currentUserData?.email || '',
                userMobile: currentUserData?.mobile || '',
                reward: Number(item.reward || 0),
                assignedComment: finalComment,
                assignedCommentIndex: finalCommentIndex,
                commentIndex: finalCommentIndex,
                comment_index: finalCommentIndex,
                taskIndex: taskIndexVal,
                task_index: taskIndexVal,
                reservationId,
                reservationExpiresAt: activeReservation?.expiresAt || (Date.now() + 24 * 60 * 60 * 1000),
                screenshotUrl,
                screenshotKey,
                proofFileName: fileToUpload.name,
                proofFileSize: fileToUpload.size,
                proofMimeType: fileToUpload.type || 'image/*',
                status: 'pending_manual_verification',
                manualStatus: 'pending',
                autoStatus: 'waiting_scraper',
                verificationMode: 'manual_and_auto_ready',
                ocrStatus: 'completed',
                ocrExtractedName: verification.gmailName,
                ocrExtractedComment: finalComment,
                ocrExtractedLogoUrl: verification.gmailLogoUrl,
                scraperStatus: 'not_configured',
                payoutStatus: 'pending',
                submittedAt: serverTimestamp()
            });

            if (!item.isBulk) {
                await setDoc(doc(db, `artifacts/${appId}/public/data/task_comment_reservations`, reservationId), {
                    status: 'submitted',
                    submittedAt: serverTimestamp()
                }, { merge: true });

                fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-reservations/${encodeURIComponent(reservationId)}/submit`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` }
                }, 5000).catch(() => {});
            }

            item.status = 'Uploaded';
            item.progress = 100;
            if (item.isBulk && finalComment) {
                const cleanC = String(finalComment).trim();
                item.submittedComments.push(cleanC);
                this.inFlightComments[taskId].delete(cleanC);
            }
            this.notify(taskId);

            userTaskSubmissionIds.add(item.task.id);
            userTaskTodaySubmissionIds.add(item.task.id);
            localStorage.removeItem('last_active_task_id');
            localStorage.removeItem('last_active_task_data');

            // For Single Users (non-bulk): auto-redirect back to main Task Page & hide task!
            if (!item.isBulk) {
                setTimeout(() => {
                    if (typeof showUserTaskPage === 'function') {
                        showUserTaskPage();
                    }
                }, 600);
            }

        } catch (err) {
            console.error(`Upload failed for ${item.fileName}:`, err);
            
            if (item.isBulk && matchedComment) {
                this.inFlightComments[taskId].delete(String(matchedComment).trim());
            }

            if (err.message === 'Offline' || !navigator.onLine) {
                item.status = 'Waiting';
                item.error = 'Network disconnected. Waiting for connection...';
                item.progress = 0;
            } else {
                item.status = 'Failed';
                item.error = err.message || 'Verification or upload failed.';
                item.progress = 0;
            }
            this.notify(taskId);
        }

        this.isProcessing[taskId] = false;
        this.processQueue(taskId);
    }
}

window.TaskUploadQueueManager = new TaskUploadQueueManager();

const showUserTaskDetailsPage = async (taskId) => {
            try {
                if (!taskId) {
                    console.warn('[TaskDetails] Missing taskId parameter');
                    return showNotification('Task ID missing. Please try again.', true);
                }

                const cleanTaskId = String(taskId).trim();
                localStorage.setItem('last_active_task_id', cleanTaskId);
                localStorage.setItem('last_active_section', 'task_details');

                const tasksList = Array.isArray(allTasksCache) ? allTasksCache : [];
                let task = tasksList.find(item => item && (String(item.id) === cleanTaskId || String(item._id) === cleanTaskId));

                if (!task) {
                    if (typeof db !== 'undefined' && typeof appId !== 'undefined' && typeof doc === 'function' && typeof getDoc === 'function') {
                        try {
                            const docSnap = await getDoc(doc(db, `artifacts/${appId}/public/data/tasks`, cleanTaskId));
                            if (docSnap.exists()) {
                                const rawData = { id: docSnap.id, _id: docSnap.id, ...docSnap.data() };
                                const normalized = normalizeTasksArray([rawData]);
                                task = normalized[0] || rawData;
                                if (Array.isArray(allTasksCache)) {
                                    allTasksCache.push(task);
                                }
                            }
                        } catch (e) {
                            console.warn('[TaskDetails] Failed to recover task details on boot:', e);
                        }
                    }
                }

                if (!task) {
                    localStorage.removeItem('last_active_task_id');
                    localStorage.removeItem('last_active_task_data');
                    if (typeof showUserTaskPage === 'function') {
                        showUserTaskPage();
                    } else if (typeof hidePage === 'function') {
                        hidePage();
                    }
                    return showNotification('Task not found. Please refresh tasks.', true);
                }

                // Ensure task object properties are normalized
                const normalizedList = normalizeTasksArray([task]);
                task = normalizedList[0] || task;

                localStorage.setItem('last_active_task_data', JSON.stringify(task));

                const effectiveStatus = getAdminTaskEffectiveStatus(task);
                if (effectiveStatus !== 'active') {
                    localStorage.removeItem('last_active_task_id');
                    localStorage.removeItem('last_active_task_data');
                    if (typeof showUserTaskPage === 'function') {
                        showUserTaskPage();
                    } else if (typeof hidePage === 'function') {
                        hidePage();
                    }
                    return showNotification('This task is closed.', true);
                }
                
                if (task.taskSubtype === 'read_news' || task.subtype === 'read_news') {
                    showUserReadNewsTaskPage(task);
                    return;
                }

            const isBulk = isBulkTaskUser();
            if (!isBulk && typeof userTaskSubmissionIds !== 'undefined' && userTaskSubmissionIds && userTaskSubmissionIds.has(task.id)) {
                localStorage.removeItem('last_active_task_id');
                localStorage.removeItem('last_active_task_data');
                if (typeof showUserTaskPage === 'function') {
                    showUserTaskPage();
                } else if (typeof hidePage === 'function') {
                    hidePage();
                }
                return showNotification('You have already completed this task.', true);
            }
            if (isBulk) {
                showLoading();
            }
            const reward = getTaskRewardForUser(task, currentUserData);
            const taskTitle = task.title || 'Task Mission';
            const appName = task.appName || taskTitle;

            // Fetch D1 availability to get active available comments
            let availability = { totalCount: 0, availableCount: 0, availableComments: [] };
            if (isBulk) {
                try {
                    const token = await getBackendAuthToken();
                    const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/tasks/${task.id}/availability`, {
                        headers: { Authorization: `Bearer ${token}` }
                    }, 8000);
                    const resData = await response.json();
                    if (resData.ok) {
                        availability = resData;
                    }
                } catch (e) {
                    console.error('Failed to load task availability:', e);
                }
            }

            // Fetch existing reservations for the bulker (so they don't lose previously generated comments on refresh!)
            let existingReservations = [];
            if (isBulk) {
                try {
                    const token = await getBackendAuthToken();
                    const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-reservations/${task.id}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    }, 5000);
                    const resData = await response.json();
                    if (resData.ok && resData.isBulker && Array.isArray(resData.reservations)) {
                        existingReservations = resData.reservations;
                    }
                } catch (e) {
                    console.warn('Failed to load existing bulker reservations:', e);
                }
            }

            const localCommentPool = getTaskCommentPool(task);
            const takenForTask = new Set((window.lastTakenCommentsMap?.[task.id] || []).map(c => String(c).trim()));
            const localAvailableComments = localCommentPool.filter(c => !takenForTask.has(String(c).trim()));

            const commentPool = (isBulk && Array.isArray(availability.availableComments) && availability.availableComments.length > 0)
                ? availability.availableComments
                : (localAvailableComments.length > 0 ? localAvailableComments : localCommentPool);
            const totalCommentsCount = (isBulk && Number.isFinite(availability.totalCount) && availability.totalCount > 0)
                ? availability.totalCount
                : localCommentPool.length;
            const availableCommentsCount = isBulk
                ? (localCommentPool.length > 0 ? localCommentPool.length : (availability.totalCount || 100))
                : ((Number.isFinite(availability.availableCount) && availability.availableCount > 0) ? availability.availableCount : commentPool.length);
            const taskLink = task.taskLink || task.link || task.url || '';
            const image = task.imageUrl || task.logoUrl || task.iconUrl || 'https://cdn-icons-png.flaticon.com/512/3176/3176366.png';
            
            let submittedComments = [];
            if (isBulk) {
                try {
                    const todayStart = getStartOfTodayMillis();
                    const snap = await getDocs(query(
                        collection(db, `artifacts/${appId}/public/data/task_submissions`),
                        where('userId', '==', currentUser.uid),
                        where('taskId', '==', taskId)
                    ));
                    snap.docs.forEach(docSnap => {
                        const data = docSnap.data();
                        const submittedAt = timestampToMillis(data.submittedAt || data.createdAt || data.timestamp);
                        if (submittedAt >= todayStart && data.assignedComment) {
                            submittedComments.push(String(data.assignedComment).trim());
                        }
                    });
                } catch (err) {
                    console.warn('Failed to load submitted comments:', err);
                }
            }
            if (isBulk) {
                hideLoading();
            }

            let activeReservation = null;
            if (!isBulk) {
                try {
                    activeReservation = await findReusableTaskReservation(task.id, currentUser.uid);
                    if (!activeReservation) {
                        activeReservation = await reserveTaskReviewComment(task);
                    }
                } catch (resErr) {
                    console.warn('Single user reservation lock check:', resErr);
                }
            }
            window.activeTaskReservation = activeReservation;

            const selectDeterministicComment = (pool, userId, taskId) => {
                let hash = 0;
                const str = userId + taskId;
                for (let i = 0; i < str.length; i++) {
                    hash = str.charCodeAt(i) + ((hash << 5) - hash);
                }
                const index = Math.abs(hash) % (pool.length || 1);
                return { comment: pool[index] || '', index };
            };
            const preSelected = selectDeterministicComment(commentPool, currentUser.uid, task.id);
            const initialComment = activeReservation?.comment || preSelected.comment;
            const poolAll = getTaskCommentPool(task);
            const initialCommentIdx = activeReservation?.comment ? poolAll.indexOf(activeReservation.comment) : preSelected.index;
            const commentIdxVal = initialCommentIdx >= 0 ? initialCommentIdx : preSelected.index;

            const getPayoutDelayText = (t) => {
                const days = t.paymentDelayDays ?? t.paymentDays ?? t.payoutDelayDays ?? 7;
                const numDays = Number(days);
                if (isNaN(numDays) || numDays <= 0) return 'Instant Payout';
                if (numDays === 1) return '1 Day Payout';
                return `${numDays} Days Payout`;
            };
            const payoutDelayText = getPayoutDelayText(task);
            const subtype = task.subtype || task.taskSubtype || '';
            const acc = getTaskAccent(subtype);
            const isReviewTask = subtype === 'app_review' || subtype === 'map_review' || subtype === 'trustpilot_review' || subtype === 'website_review';

            const taskTypeLabel = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Play Store Review' : (subtype === 'map_review' ? 'Map Review' : 'Screenshot Task');
            const platformLabel = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Play Store App Review' : (subtype === 'map_review' ? 'Google Maps Place Review' : 'Screenshot + Review');
            const platformLogo = (subtype === 'app_review' || subtype === 'app_download_task') ? PLAY_STORE_LOGO_URL : (subtype === 'map_review' ? 'https://cdn-icons-png.flaticon.com/512/854/854878.png' : 'https://cdn-icons-png.flaticon.com/512/4187/4187336.png');

            const payoutVal = payoutDelayText.replace(' Payout', '');
            const approvalVal = payoutVal === 'Instant' ? 'Instant' : `${payoutVal} Later`;

            let step2Html = '';
            if (isBulk) {
                step2Html = `
                    <div class="space-y-4 text-left p-5 bg-slate-50 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-700/80 rounded-3xl shadow-sm">
                        <!-- Header Block -->
                        <div class="mb-3.5">
                            <div class="flex items-center justify-between gap-2 flex-wrap mb-1">
                                <label for="task-bulk-comments-count" class="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">Enter Number of Comments Needed</label>
                                <span class="text-[11px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-xl border border-indigo-100 dark:border-indigo-900/60 shadow-xs">${availableCommentsCount}/${totalCommentsCount} Available</span>
                            </div>
                            <p class="text-[10px] font-semibold text-slate-400 dark:text-slate-400">Type how many comments you want to generate (e.g. 5, 10, 20)</p>
                        </div>
                        
                        <!-- Input & Generate Button Box -->
                        <div class="flex items-center gap-3 my-2">
                            <div class="relative flex-1 min-w-0">
                                <input type="number" id="task-bulk-comments-count" min="1" max="${Math.max(1, availableCommentsCount)}" placeholder="Enter Quantity (e.g. 10)" class="w-full rounded-2xl border-2 border-indigo-200/90 dark:border-indigo-800/80 bg-white dark:bg-slate-800 px-4 py-3.5 text-sm font-black text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm">
                            </div>
                            <button type="button" id="task-bulk-generate-btn" class="shrink-0 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white px-5 py-3.5 text-xs font-black uppercase tracking-wider transition-all active:scale-[0.97] shadow-md flex items-center gap-1.5">
                                <span>Generate</span>
                                <span>⚡</span>
                            </button>
                        </div>

                        <!-- Divider Line -->
                        <div class="border-t border-slate-200 dark:border-slate-800 my-4"></div>

                        <!-- Generated Comments Header & List -->
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <p class="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">Your Generated Comments:</p>
                                <button type="button" id="task-bulk-copy-all-btn" class="hidden rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-200/40 dark:border-indigo-800/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition shadow-sm">Copy All</button>
                            </div>
                            <div id="task-bulk-comments-list" class="max-h-56 overflow-y-auto space-y-2.5 pr-1">
                                <!-- Populated dynamically -->
                            </div>
                        </div>
                    </div>
                `;
            } else {
                const commentIdStr = `Comment #${String(commentIdxVal + 1).padStart(2, '0')}`;
                step2Html = `
                    <div class="space-y-3.5">
                        <div class="relative rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 p-4 pr-10 text-left mt-3">
                            <div class="flex items-center justify-between mb-1.5 select-none">
                                <span id="task-assigned-review-id" class="text-[9px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">${commentIdStr}</span>
                            </div>
                            <p id="task-assigned-review-text" class="text-sm font-semibold text-slate-800 dark:text-slate-200 italic leading-relaxed">${escapeHtml(initialComment)}</p>
                            <button type="button" id="task-copy-icon-btn" class="absolute right-3.5 top-6 text-indigo-600 dark:text-indigo-400 hover:opacity-85 transition">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            </button>
                        </div>
                        <button type="button" id="task-copy-review-btn" class="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-indigo-600 dark:border-indigo-400 bg-transparent text-indigo-600 dark:text-indigo-400 font-extrabold tracking-wide px-4 py-3.5 text-xs uppercase hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-all active:scale-[0.98]">
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            Copy Review
                        </button>
                    </div>
                `;
            }

            const ctaText = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Install App' : 'Open Link';
            const categoryLabel = (subtype === 'app_review' || subtype === 'app_download_task') ? 'Play Store App Review' : (subtype === 'map_review' ? 'Google Maps Place Review' : 'Task Mission');

            const content = `
                <style>
                    @keyframes timerPulse {
                        0%, 100% {
                            border-color: rgba(255, 255, 255, 0.4);
                            box-shadow: 0 0 4px rgba(255, 255, 255, 0.2);
                        }
                        50% {
                            border-color: rgba(255, 255, 255, 1);
                            box-shadow: 0 0 16px rgba(255, 255, 255, 0.6);
                            transform: scale(1.02);
                        }
                    }
                    @keyframes blinkText {
                        0%, 100% { opacity: 0.6; }
                        50% { opacity: 1; }
                    }
                    .timer-pulse-glow {
                        animation: timerPulse 2s infinite ease-in-out;
                        border-width: 1px;
                        border-style: solid;
                        transition: all 0.2s ease;
                    }
                    .blink-indicator {
                        animation: blinkText 1.5s infinite ease-in-out;
                    }
                </style>
                <header class="mb-4 flex items-center justify-between bg-white/80 dark:bg-gray-800/80 backdrop-blur px-4 py-3 shadow-sm page-header-fixed z-50">
                    <div class="flex items-center gap-3">
                        <button class="page-back-btn rounded-full p-2 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-gray-700 transition">
                            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 12H5m7 7-7-7 7-7"></path></svg>
                        </button>
                        <div class="flex flex-col text-left">
                            <h2 class="text-xs font-black uppercase text-slate-950 dark:text-white tracking-wider leading-none">Mission</h2>
                            <span class="text-[9px] font-bold text-gray-400 dark:text-gray-500 mt-1 select-all">ID: ${escapeHtml(taskId)}</span>
                        </div>
                    </div>
                </header>
                <div class="px-4 pb-28">
                    <div class="mx-auto max-w-xl space-y-4">
                        <!-- Premium Redesigned Task Header Card -->
                        <div class="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/85 rounded-[1.75rem] overflow-hidden shadow-md flex flex-col gap-4 pb-4">
                            <!-- Gradient Banner Header -->
                            <div class="bg-gradient-to-r ${acc.bannerGradient} p-5 text-white flex items-center justify-between gap-4">
                                <div class="flex items-center gap-4 min-w-0">
                                    <!-- Logo -->
                                    <div class="h-16 w-16 overflow-hidden rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/20 shadow-sm">
                                        <img src="${escapeHtml(image)}" alt="${escapeHtml(appName)}" class="h-full w-full object-cover" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3176/3176366.png'">
                                    </div>
                                    <!-- Title & Platform info -->
                                    <div class="min-w-0 flex flex-col text-left">
                                        <span class="inline-flex rounded-lg bg-white/20 backdrop-blur-md px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider w-fit text-white">
                                            ${escapeHtml(taskTypeLabel)}
                                        </span>
                                        <h3 class="text-base md:text-lg font-black text-white mt-1.5 truncate pr-1 leading-tight">${escapeHtml(appName)}</h3>
                                    </div>
                                </div>
                                <!-- Reward Right-Aligned -->
                                <div class="flex flex-col items-end shrink-0">
                                    <span class="text-xl md:text-2xl font-black">${formatCurrency(reward).replace('.00', '')}</span>
                                    <span class="text-[8px] font-bold text-white/70 uppercase tracking-wider mt-0.5 leading-none">Per Approve</span>
                                </div>
                            </div>

                            <!-- Metrics Flex Row -->
                            <div class="flex items-center px-5 py-2 text-left">
                                <!-- Approval Column -->
                                <div class="w-[35%] shrink-0 flex items-center gap-2">
                                    <span class="p-2 rounded-xl ${acc.iconBg} shrink-0">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                    </span>
                                    <div class="min-w-0">
                                        <p class="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none">Approval</p>
                                        <p class="text-[11px] font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">${escapeHtml(approvalVal)}</p>
                                    </div>
                                </div>

                                <!-- Remaining Time Column (Timer) -->
                                <div class="flex-1 flex items-center justify-between border-l border-slate-150 dark:border-slate-800/80 pl-4 min-w-0">
                                    <div class="min-w-0 font-sans">
                                        <p class="text-[8px] font-black text-gray-400 uppercase tracking-wider leading-none">Time Left</p>
                                        <p class="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 truncate leading-none">To Complete</p>
                                    </div>
                                    <!-- Ticking Glowing Timer Badge -->
                                    <div id="task-card-timer-container" class="timer-pulse-glow bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-amber-600 dark:text-amber-400 shadow-sm shrink-0">
                                        <span class="h-2.5 w-2.5 rounded-full bg-amber-500 blink-indicator shrink-0"></span>
                                        <span id="task-card-timer" class="font-mono text-base md:text-lg font-black tracking-widest leading-none">--:--</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Install App CTA Button inside Card -->
                            <div class="px-5 mt-1">
                                <button id="task-download-btn" class="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all duration-200 active:scale-[0.99] shadow-sm ${acc.bgBtn}">
                                    <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                    <span>${ctaText}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Main Sections -->
                        <div class="space-y-4">
                            ${(isReviewTask && initialComment) ? `
                            <!-- Step 1: Copy Review -->
                            <div class="bg-white dark:bg-gray-800 rounded-3xl p-5 border border-gray-150 dark:border-gray-700/80 shadow-md">
                                <div class="flex items-center gap-2.5 text-left mb-2">
                                    <span class="flex items-center justify-center bg-indigo-600 text-white text-[11px] font-black shrink-0" style="width: 24px; height: 24px; min-width: 24px; min-height: 24px; border-radius: 50%;">1</span>
                                    <p class="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Copy Review</p>
                                </div>
                                ${step2Html}
                            </div>
                            ` : ''}

                            <!-- Step: Upload Screenshot -->
                            <div class="bg-white dark:bg-gray-800 rounded-3xl p-5 border border-gray-150 dark:border-gray-700/80 shadow-md">
                                <div class="flex items-center gap-2.5 text-left mb-2">
                                    <span class="flex items-center justify-center bg-indigo-600 text-white text-[11px] font-black shrink-0" style="width: 24px; height: 24px; min-width: 24px; min-height: 24px; border-radius: 50%;">${(isReviewTask && initialComment) ? '2' : '1'}</span>
                                    <p class="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">Upload Screenshot</p>
                                </div>
                                
                                <label class="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 p-5 text-center hover:bg-slate-100/50 dark:hover:bg-slate-900/60 transition mt-3">
                                    <input id="task-proof-input" type="file" accept="image/*" class="hidden" ${isBulk ? 'multiple' : ''}>
                                    <span class="p-3 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 mb-2 shadow-sm border border-indigo-100/50 dark:border-indigo-900/30">
                                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                                    </span>
                                    <span id="task-proof-label" class="text-xs font-black uppercase text-slate-700 dark:text-slate-200">${isBulk ? 'Select Screenshot(s)' : 'Tap to upload screenshot'}</span>
                                    <span class="text-[9px] text-gray-400 mt-1">JPG, PNG • Max 5MB</span>
                                </label>

                                <!-- Trust Badge Icons Grid -->
                                <div class="grid grid-cols-3 gap-2 mt-4 py-3 bg-slate-50/80 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800/80 px-3 text-left">
                                    <!-- Safe & Secure -->
                                    <div class="flex items-center gap-2">
                                        <span class="p-1.5 rounded-full bg-green-500/10 text-green-600 shrink-0">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide leading-none">Safe & Secure</p>
                                            <p class="text-[8px] font-bold text-gray-400 mt-0.5 truncate leading-none">Your data is protected</p>
                                        </div>
                                    </div>
                                    <!-- Fast Approval -->
                                    <div class="flex items-center gap-2 border-l border-slate-200/60 dark:border-slate-800/80 pl-2">
                                        <span class="p-1.5 rounded-full bg-amber-500/10 text-amber-500 shrink-0">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide leading-none">Fast Approval</p>
                                            <p class="text-[8px] font-bold text-gray-400 mt-0.5 truncate leading-none">Verified automatically</p>
                                        </div>
                                    </div>
                                    <!-- Quick Payout -->
                                    <div class="flex items-center gap-2 border-l border-slate-200/60 dark:border-slate-800/80 pl-2">
                                        <span class="p-1.5 rounded-full bg-emerald-500/10 text-emerald-600 shrink-0">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        </span>
                                        <div class="min-w-0">
                                            <p class="text-[8px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide leading-none">Quick Payout</p>
                                            <p class="text-[8px] font-bold text-gray-400 mt-0.5 truncate leading-none">Get paid on time</p>
                                        </div>
                                    </div>
                                </div>

                                ${isBulk ? `
                                <div id="upload-queue-container" class="mt-4 space-y-3 hidden">
                                    <div class="flex items-center justify-between text-xs font-bold text-gray-600 dark:text-gray-400">
                                        <span>Upload Queue</span>
                                        <span id="queue-completion-pct">0%</span>
                                    </div>
                                    <!-- Progress Bar -->
                                    <div class="h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                                        <div id="queue-progress-bar" class="h-full bg-gradient-to-r from-indigo-500 to-blue-600 rounded-full transition-all duration-300" style="width: 0%"></div>
                                    </div>

                                    <!-- Live Summary Badges -->
                                    <div class="grid grid-cols-5 gap-1 text-[8px] font-black text-center uppercase tracking-wider text-white">
                                        <div class="bg-slate-600 dark:bg-slate-700 rounded-lg p-1.5 shadow-sm">
                                            <p class="opacity-75">Selected</p>
                                            <p id="stat-selected" class="text-xs font-black mt-0.5">0</p>
                                        </div>
                                        <div class="bg-green-600 dark:bg-green-700 rounded-lg p-1.5 shadow-sm">
                                            <p class="opacity-75">Uploaded</p>
                                            <p id="stat-uploaded" class="text-xs font-black mt-0.5">0</p>
                                        </div>
                                        <div class="bg-blue-600 dark:bg-blue-700 rounded-lg p-1.5 shadow-sm">
                                            <p class="opacity-75">Active</p>
                                            <p id="stat-active" class="text-xs font-black mt-0.5">0</p>
                                        </div>
                                        <div class="bg-amber-600 dark:bg-amber-700 rounded-lg p-1.5 shadow-sm">
                                            <p class="opacity-75">Waiting</p>
                                            <p id="stat-waiting" class="text-xs font-black mt-0.5">0</p>
                                        </div>
                                        <div class="bg-red-600 dark:bg-red-700 rounded-lg p-1.5 shadow-sm">
                                            <p class="opacity-75">Failed</p>
                                            <p id="stat-failed" class="text-xs font-black mt-0.5">0</p>
                                        </div>
                                    </div>

                                    <!-- Retry / Action Buttons -->
                                    <div class="flex items-center justify-end gap-2 my-2">
                                        <button type="button" id="queue-clear-btn" class="rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 px-3 py-1.5 text-[9px] font-black uppercase text-slate-700 dark:text-white transition">Clear Queue</button>
                                        <button type="button" id="queue-retry-btn" class="rounded-lg bg-red-600 hover:bg-red-700 px-3 py-1.5 text-[9px] font-black uppercase text-white transition hidden">Retry Failed</button>
                                    </div>

                                    <!-- Queue Scroll Area -->
                                    <div id="queue-items-list" class="max-h-64 overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-700/60 rounded-2xl p-2 bg-gray-50/50 dark:bg-gray-900/30">
                                        <!-- File cards rendered here dynamically -->
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
                ${getPageFooter()}`;

            showPage(content, { 
                returnTo: 'task', 
                keepBottomNav: false, 
                onBack: () => {
                    localStorage.removeItem('last_active_task_id');
                    localStorage.removeItem('last_active_task_data');
                    window.TaskUploadQueueManager.unregisterCallback(task.id);
                    showUserTaskPage();
                } 
            });
            setBottomNavActive('bottom-task-btn');

            // Active reservation state
            activeTaskReservation = null;
            if (activeTaskReservationTimer) {
                clearInterval(activeTaskReservationTimer);
                activeTaskReservationTimer = null;
            }

            if (!isBulk) {
                activeTaskReservation = {
                    comment: initialComment,
                    expiresAt: Date.now() + (window.TASK_COMMENT_RESERVATION_MS || 10 * 60 * 1000)
                };
            }

            // Ticking Function for Timer Badge
            const timerEl = document.getElementById('task-card-timer');
            const timerContainerEl = document.getElementById('task-card-timer-container');

            const startLocalTimer = () => {
                if (activeTaskReservationTimer) clearInterval(activeTaskReservationTimer);
                
                const tick = () => {
                    if (isBulk) {
                        const midnight = new Date();
                        midnight.setHours(24, 0, 0, 0);
                        const remaining = Math.max(0, midnight.getTime() - Date.now());
                        if (remaining <= 0) {
                            if (timerEl) timerEl.textContent = 'Closed';
                            clearInterval(activeTaskReservationTimer);
                            activeTaskReservationTimer = null;
                            showNotification('This task is closed for today.', true);
                            showUserTaskPage();
                            return;
                        }
                        const hours = Math.floor(remaining / 3600000);
                        const minutes = Math.floor((remaining % 3600000) / 60000);
                        const seconds = Math.floor((remaining % 60000) / 1000);
                        if (timerEl) {
                            timerEl.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                        }
                    } else {
                        if (!activeTaskReservation) {
                            if (timerEl) timerEl.textContent = '0:00';
                            return;
                        }
                        const expiresAt = timestampToMillis(activeTaskReservation.expiresAt);
                        const remaining = Math.max(0, expiresAt - Date.now());
                        if (remaining <= 0) {
                            if (timerEl) timerEl.textContent = 'Expired';
                            if (timerContainerEl) {
                                timerContainerEl.className = 'bg-red-500/10 dark:bg-red-950/20 border border-red-500/30 rounded-xl px-2 py-1 flex items-center gap-1.5 text-[10px] font-black text-red-600 dark:text-red-400 shadow-sm shrink-0';
                            }
                            clearInterval(activeTaskReservationTimer);
                            activeTaskReservationTimer = null;
                            return;
                        }
                        const minutes = Math.floor(remaining / 60000);
                        const seconds = Math.floor((remaining % 60000) / 1000);
                        if (timerEl) {
                            timerEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
                        }
                    }
                };
                tick();
                activeTaskReservationTimer = setInterval(tick, 1000);
            };

            const updateReservationUi = (reservation) => {
                activeTaskReservation = reservation;
                window.activeTaskReservation = reservation;
                const commentEl = document.getElementById('task-assigned-review-text');
                if (commentEl) commentEl.textContent = reservation.comment;
                const reviewIdEl = document.getElementById('task-assigned-review-id');
                if (reviewIdEl) {
                    const cIdx = reservation.commentIndex !== undefined ? reservation.commentIndex : (reservation.comment_index ?? 0);
                    reviewIdEl.textContent = `Comment #${String(cIdx + 1).padStart(2, '0')}`;
                }
                
                if (timerContainerEl) {
                    timerContainerEl.className = 'timer-pulse-glow bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-amber-600 dark:text-amber-400 shadow-sm shrink-0';
                }
                startLocalTimer();
            };

            const downloadBtn = document.getElementById('task-download-btn');
            if (downloadBtn) {
                downloadBtn.onclick = () => {
                    if (!taskLink) {
                        showNotification('Task link is not added yet.', true);
                        return;
                    }
                    
                    window._activeTaskExecutingId = task.id;
                    window._activeTaskObj = task;
                    try { sessionStorage.setItem('rw_active_task_id', task.id); } catch(e){}

                    const targetUrl = taskLink;
                    const a = document.createElement('a');
                    a.href = targetUrl;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                };
            }

            // Global return-to-app listener for instant task page restoration
            if (!window._taskPageReturnListenerBound) {
                const handleAppReturnToTaskPage = () => {
                    if (typeof window.closeModal === 'function') {
                        window.closeModal();
                    }
                    const newsModal = document.getElementById('sandboxed-news-reader-modal');
                    if (newsModal) newsModal.classList.add('hidden');

                    const activeId = window._activeTaskExecutingId || (function(){ try { return sessionStorage.getItem('rw_active_task_id'); } catch(e){ return null; } })();
                    if (activeId && window._activeTaskObj) {
                        const proofInput = document.getElementById('task-proof-input');
                        if (!proofInput && typeof window.renderTask === 'function') {
                            window.renderTask(window._activeTaskObj);
                        }
                    }
                };

                window.addEventListener('focus', handleAppReturnToTaskPage);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        handleAppReturnToTaskPage();
                    }
                });
                window._taskPageReturnListenerBound = true;
            }

            // Copy & Review logic
            if (isBulk) {
                let generatedComments = existingReservations.map(r => r.comment);

                const renderBulkCommentsList = () => {
                    const commentsListEl = document.getElementById('task-bulk-comments-list');
                    if (!commentsListEl) return;
                    
                    if (generatedComments.length === 0) {
                        commentsListEl.innerHTML = '<p class="text-center py-4 text-xs text-gray-400">Enter quantity and click Generate.</p>';
                        const copyAllBtn = document.getElementById('task-bulk-copy-all-btn');
                        if (copyAllBtn) copyAllBtn.classList.add('hidden');
                        return;
                    }
                    
                    const listHtml = [];
                    for (let i = 0; i < generatedComments.length; i++) {
                        const comment = generatedComments[i];
                        const isSubmitted = submittedComments.includes(String(comment).trim());
                        
                        listHtml.push(`
                            <div class="flex items-start justify-between gap-3 p-3 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-gray-700/80 shadow-sm min-w-0">
                                <div class="min-w-0 flex-1 flex items-start gap-2.5">
                                    <span class="text-[10px] font-black text-gray-500 bg-slate-100 dark:bg-slate-900 rounded-lg px-2 py-1 shadow-sm border border-gray-200 dark:border-gray-800 shrink-0 mt-0.5">${i + 1}</span>
                                    <p class="text-xs font-semibold text-gray-900 dark:text-gray-100 italic text-left break-words whitespace-pre-wrap leading-relaxed flex-1 min-w-0 pr-1">${escapeHtml(comment)}</p>
                                </div>
                                ${isSubmitted 
                                    ? `<span class="text-[10px] font-black text-green-600 shrink-0 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-xl shadow-sm mt-0.5">Done ✅</span>`
                                    : `<button type="button" data-action="copy-comment" data-comment="${escapeHtml(comment)}" class="rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-200/40 dark:border-indigo-800/30 px-3 py-1.5 text-[10px] font-black tracking-wider uppercase transition shrink-0 shadow-sm mt-0.5">Copy</button>`
                                }
                            </div>
                        `);
                    }
                    commentsListEl.innerHTML = listHtml.join('');
                    
                    const copyAllBtn = document.getElementById('task-bulk-copy-all-btn');
                    if (copyAllBtn) {
                        copyAllBtn.classList.remove('hidden');
                        copyAllBtn.onclick = async () => {
                            const text = generatedComments.join('\n\n');
                            try {
                                await navigator.clipboard.writeText(text);
                                showNotification(`Copied all ${generatedComments.length} comments!`);
                            } catch (err) {
                                showNotification('Failed to copy. Try copying individually.', true);
                            }
                        };
                    }
                    
                    commentsListEl.querySelectorAll('[data-action="copy-comment"]').forEach(btn => {
                        btn.onclick = async (e) => {
                            const text = e.currentTarget.dataset.comment;
                            try {
                                await navigator.clipboard.writeText(text);
                                showNotification('Comment copied!');
                            } catch (err) {
                                showNotification('Copy failed. Copy manually.', true);
                            }
                        };
                    });
                };

                const countInput = document.getElementById('task-bulk-comments-count');
                const generateBtn = document.getElementById('task-bulk-generate-btn');

                if (countInput) {
                    countInput.oninput = () => {
                        let val = parseInt(countInput.value) || 0;
                        if (val > availableCommentsCount) {
                            countInput.value = availableCommentsCount;
                        }
                    };
                }

                if (generateBtn) {
                    generateBtn.onclick = async () => {
                        const qtyStr = countInput ? countInput.value.trim() : '';
                        if (!qtyStr) return showNotification('Please enter a quantity (e.g. 5, 10).', true);
                        
                        let limit = parseInt(qtyStr) || 0;
                        if (limit <= 0) return showNotification('Please enter a valid positive quantity.', true);
                        
                        const maxAvail = Math.max(1, availableCommentsCount);
                        if (limit > maxAvail) {
                            limit = maxAvail;
                            if (countInput) countInput.value = limit;
                        }
                        
                        showLoading();
                        let newlyReserved = [];

                        // 1. Try Backend API first
                        const fullPool = getTaskCommentPool(task);
                        try {
                            const token = await getBackendAuthToken();
                            const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-reservations/bulk`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ taskId: task.id, count: limit, commentsPool: fullPool })
                            }, 8000).catch(() => null);

                            if (response && response.ok) {
                                const resData = await response.json().catch(() => ({}));
                                if (resData.ok && Array.isArray(resData.reservedComments) && resData.reservedComments.length > 0) {
                                    newlyReserved = resData.reservedComments.map(r => r.comment);
                                }
                            }
                        } catch (e) {
                            console.warn('Backend bulk reservation check failed, using local fallback:', e);
                        }

                        // 2. Local Fallback if backend API did not return comments
                        if (newlyReserved.length === 0) {
                            const usedSet = new Set([
                                ...generatedComments.map(c => String(c).trim()),
                                ...submittedComments.map(c => String(c).trim())
                            ]);

                            const availablePool = fullPool.filter(c => !usedSet.has(String(c).trim()));
                            newlyReserved = availablePool.slice(0, limit);
                        }

                        if (newlyReserved.length === 0) {
                            hideLoading();
                            return showNotification('No comments available for this task.', true);
                        }

                        generatedComments = [...generatedComments, ...newlyReserved];
                        
                        // Auto-copy to clipboard
                        const textToCopy = newlyReserved.join('\n\n');
                        try {
                            await navigator.clipboard.writeText(textToCopy);
                            showNotification(`Generated & Copied ${newlyReserved.length} comment(s)!`);
                        } catch (copyErr) {
                            showNotification(`Generated ${newlyReserved.length} comment(s)!`, false);
                        }
                        
                        renderBulkCommentsList();
                        hideLoading();
                    };
                }

                renderBulkCommentsList();
                startLocalTimer();
            } else {
                startLocalTimer();
                const initBackgroundReservation = async () => {
                    if (activeReservation) {
                        updateReservationUi(activeReservation);
                        return;
                    }
                    try {
                        const reservation = await reserveTaskReviewComment(task);
                        updateReservationUi(reservation);
                    } catch (error) {
                        console.warn('Background reservation failed:', error);
                        const timerEl = document.getElementById('task-card-timer');
                        if (timerEl) timerEl.textContent = 'Expired';
                        if (error.message && error.message.includes('No comments available')) {
                            showNotification(error.message, true);
                            showUserTaskPage();
                        }
                    }
                };
                initBackgroundReservation();

                const copyBtn = document.getElementById('task-copy-review-btn');
                const copyIconBtn = document.getElementById('task-copy-icon-btn');
                const triggerCopy = async () => {
                    const targetComment = activeTaskReservation?.comment || initialComment;
                    try {
                        await navigator.clipboard.writeText(targetComment);
                        showNotification('Assigned review comment copied!');
                        
                        if (!isBulk && taskLink) {
                            const a = document.createElement('a');
                            a.href = taskLink;
                            a.target = '_blank';
                            a.rel = 'noopener noreferrer';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        }
                    } catch (err) {
                        showNotification('Copy failed. Copy manually.', true);
                    }
                };
                if (copyBtn) copyBtn.onclick = triggerCopy;
                if (copyIconBtn) copyIconBtn.onclick = triggerCopy;
            }

            const renderQueueUi = (queue) => {
                const queueContainer = document.getElementById('upload-queue-container');
                const progressPctEl = document.getElementById('queue-completion-pct');
                const progressBar = document.getElementById('queue-progress-bar');
                const itemsListEl = document.getElementById('queue-items-list');

                const statSelected = document.getElementById('stat-selected');
                const statUploaded = document.getElementById('stat-uploaded');
                const statActive = document.getElementById('stat-active');
                const statWaiting = document.getElementById('stat-waiting');
                const statFailed = document.getElementById('stat-failed');

                const retryBtn = document.getElementById('queue-retry-btn');

                if (!queueContainer || queue.length === 0) {
                    if (queueContainer) queueContainer.classList.add('hidden');
                    return;
                }

                queueContainer.classList.remove('hidden');

                const total = queue.length;
                const uploaded = queue.filter(item => item.status === 'Uploaded').length;
                const active = queue.filter(item => item.status === 'Uploading' || item.status === 'System Checking').length;
                const waiting = queue.filter(item => item.status === 'Waiting').length;
                const failed = queue.filter(item => item.status === 'Failed').length;

                if (statSelected) statSelected.textContent = total;
                if (statUploaded) statUploaded.textContent = uploaded;
                if (statActive) statActive.textContent = active;
                if (statWaiting) statWaiting.textContent = waiting;
                if (statFailed) statFailed.textContent = failed;

                let overallProgress = 0;
                if (total > 0) {
                    const totalProgress = queue.reduce((sum, item) => sum + (item.progress || 0), 0);
                    overallProgress = Math.floor(totalProgress / total);
                }
                if (progressPctEl) progressPctEl.textContent = `${overallProgress}%`;
                if (progressBar) progressBar.style.width = `${overallProgress}%`;

                if (retryBtn) {
                    if (failed > 0) {
                        retryBtn.classList.remove('hidden');
                    } else {
                        retryBtn.classList.add('hidden');
                    }
                }

                if (itemsListEl) {
                    itemsListEl.innerHTML = queue.map((item, idx) => {
                        const statusColors = {
                            'Waiting': 'text-amber-500 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30',
                            'Uploading': 'text-blue-500 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30',
                            'System Checking': 'text-purple-500 bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/30',
                            'Uploaded': 'text-green-600 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/30',
                            'Failed': 'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30'
                        };
                        const colorClass = statusColors[item.status] || 'text-gray-500';
                        const thumbSrc = item.thumbnailUrl || 'https://cdn-icons-png.flaticon.com/512/3342/3342137.png';
                        
                        return `
                            <div class="flex flex-col p-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-150 dark:border-gray-700/60 shadow-sm gap-2">
                                <div class="flex items-center justify-between gap-3">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <div class="h-9 w-9 overflow-hidden rounded bg-gray-100 dark:bg-gray-900 flex items-center justify-center shrink-0 shadow-inner">
                                            <img src="${thumbSrc}" alt="thumb" class="h-full w-full object-cover">
                                        </div>
                                        <div class="min-w-0">
                                            <p class="text-[10px] font-bold text-gray-700 dark:text-gray-300 truncate">${escapeHtml(item.fileName)}</p>
                                            <p class="text-[8px] text-gray-400 mt-0.5">${(item.fileSize / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <div class="shrink-0 flex items-center gap-2">
                                        <span class="rounded-lg border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${colorClass}">${item.status}</span>
                                    </div>
                                </div>
                                ${item.status === 'Failed' 
                                    ? `<p class="text-[9px] font-semibold text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-950/10 p-1.5 rounded-lg border border-red-100 dark:border-red-900/30 cursor-help" title="${escapeHtml(item.error)}">⚠️ ${escapeHtml(item.error)}</p>` 
                                    : ''
                                }
                                ${item.status === 'Uploading' || item.status === 'System Checking'
                                    ? `<div class="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                         <div class="h-full bg-indigo-500 rounded-full transition-all duration-300" style="width: ${item.progress || 0}%"></div>
                                       </div>`
                                    : ''
                                }
                            </div>
                        `;
                    }).join('');
                }
            };

            if (isBulk) {
                window.TaskUploadQueueManager.registerCallback(task.id, renderQueueUi);

                const initialQueue = window.TaskUploadQueueManager.getQueue(task.id);
                if (initialQueue.length > 0) {
                    renderQueueUi(initialQueue);
                }
            }

            const fileInput = document.getElementById('task-proof-input');
            if (fileInput) {
                fileInput.onchange = (event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length === 0) return;
                    
                    if (isBulk) {
                        window.TaskUploadQueueManager.addFiles(
                            task.id,
                            files,
                            isBulk,
                            task,
                            reward,
                            appName,
                            taskLink,
                            image,
                            taskTitle,
                            commentPool,
                            submittedComments
                        );
                        fileInput.value = '';
                    } else {
                        const file = files[0];
                        fileInput.value = '';
                        window.submitSingleUserTask(task, file, reward, appName, taskLink, image, taskTitle);
                    }
                };
            }

            const clearBtn = document.getElementById('queue-clear-btn');
            if (clearBtn) {
                clearBtn.onclick = () => {
                    if (confirm('Are you sure you want to clear the upload queue?')) {
                        window.TaskUploadQueueManager.clearQueue(task.id);
                    }
                };
            }

            const retryBtn = document.getElementById('queue-retry-btn');
            if (retryBtn) {
                retryBtn.onclick = () => {
                    window.TaskUploadQueueManager.retryFailed(task.id);
                };
            }
            } catch (err) {
                console.error('[TaskDetails] Error loading task details page:', err);
                if (typeof hideLoading === 'function') hideLoading();
                showNotification(err?.message || 'Could not open task details. Please try again.', true);
            }
        };

window.submitSingleUserTask = async (task, file, reward, appName, taskLink, image, taskTitle) => {
    window.singleSubmitTaskLocks = window.singleSubmitTaskLocks || {};
    if (task?.id && window.singleSubmitTaskLocks[task.id]) {
        console.warn('[SingleSubmit] Task upload already in progress for task:', task.id);
        return;
    }
    if (task?.id) window.singleSubmitTaskLocks[task.id] = true;
    const releaseLock = () => {
        if (task?.id && window.singleSubmitTaskLocks) {
            delete window.singleSubmitTaskLocks[task.id];
        }
    };

    // Show premium 5-step verification modal
    renderModal('Review Verification', 
        `<div class="p-5 space-y-4 select-none text-center">
            <!-- Dynamic Status Icon -->
            <div class="flex justify-center items-center py-1" id="single-upload-status-icon">
                <div class="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent shadow-sm"></div>
            </div>
            
            <h4 class="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider" id="single-upload-status-title">Uploading...</h4>
            
            <!-- Step-by-Step Flow List -->
            <div class="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700/60 text-left space-y-2 text-xs">
                <div id="step-ui-1" class="flex items-center gap-2.5 font-bold text-indigo-600 dark:text-indigo-400">
                    <span id="step-icon-1" class="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center shrink-0">1</span>
                    <span id="step-text-1">Uploading...</span>
                </div>
                <div class="text-gray-300 dark:text-gray-600 pl-2 text-[10px] leading-none">↓</div>
                
                <div id="step-ui-2" class="flex items-center gap-2.5 font-semibold text-gray-400 dark:text-gray-500">
                    <span id="step-icon-2" class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] flex items-center justify-center shrink-0">2</span>
                    <span id="step-text-2">Verifying Screenshot...</span>
                </div>
                <div class="text-gray-300 dark:text-gray-600 pl-2 text-[10px] leading-none">↓</div>
                
                <div id="step-ui-3" class="flex items-center gap-2.5 font-semibold text-gray-400 dark:text-gray-500">
                    <span id="step-icon-3" class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] flex items-center justify-center shrink-0">3</span>
                    <span id="step-text-3">Extracting Review...</span>
                </div>
                <div class="text-gray-300 dark:text-gray-600 pl-2 text-[10px] leading-none">↓</div>
                
                <div id="step-ui-4" class="flex items-center gap-2.5 font-semibold text-gray-400 dark:text-gray-500">
                    <span id="step-icon-4" class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] flex items-center justify-center shrink-0">4</span>
                    <span id="step-text-4">Matching Comment...</span>
                </div>
                <div class="text-gray-300 dark:text-gray-600 pl-2 text-[10px] leading-none">↓</div>
                
                <div id="step-ui-5" class="flex items-center gap-2.5 font-semibold text-gray-400 dark:text-gray-500">
                    <span id="step-icon-5" class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] flex items-center justify-center shrink-0">5</span>
                    <span id="step-text-5">✅ Verified</span>
                </div>
            </div>

            <!-- Progress Bar -->
            <div class="h-2 w-full bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden shadow-inner">
                <div id="single-upload-progress" class="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full transition-all duration-300" style="width: 20%"></div>
            </div>
            <p class="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest" id="single-upload-progress-percent">20%</p>
        </div>`,
        `<button id="single-upload-close-btn" class="w-full py-2.5 text-xs font-black bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 rounded-xl uppercase tracking-wider cursor-not-allowed" style="outline: none;" disabled>Please Wait</button>`,
        'max-w-sm'
    );

    const progressEl = document.getElementById('single-upload-progress');
    const percentEl = document.getElementById('single-upload-progress-percent');
    const statusTitleEl = document.getElementById('single-upload-status-title');
    const statusIconEl = document.getElementById('single-upload-status-icon');
    const closeBtn = document.getElementById('single-upload-close-btn');

    const setStepActive = (stepNum, pct, titleText) => {
        if (progressEl) progressEl.style.width = `${pct}%`;
        if (percentEl) percentEl.textContent = `${pct}%`;
        if (titleText && statusTitleEl) statusTitleEl.textContent = titleText;

        for (let i = 1; i <= 5; i++) {
            const stepUi = document.getElementById(`step-ui-${i}`);
            const stepIcon = document.getElementById(`step-icon-${i}`);
            if (!stepUi || !stepIcon) continue;

            if (i < stepNum) {
                // Completed steps
                stepUi.className = 'flex items-center gap-2.5 font-bold text-emerald-600 dark:text-emerald-400';
                stepIcon.className = 'w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center shrink-0 font-bold';
                stepIcon.textContent = '✓';
            } else if (i === stepNum) {
                // Active step
                stepUi.className = 'flex items-center gap-2.5 font-bold text-indigo-600 dark:text-indigo-400 animate-pulse';
                stepIcon.className = 'w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center shrink-0 font-bold';
                stepIcon.textContent = `${i}`;
            } else {
                // Upcoming steps
                stepUi.className = 'flex items-center gap-2.5 font-semibold text-gray-400 dark:text-gray-500';
                stepIcon.className = 'w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] flex items-center justify-center shrink-0 font-bold';
                stepIcon.textContent = `${i}`;
            }
        }

        if (stepNum === 5 && statusIconEl) {
            statusIconEl.innerHTML = `<div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-2xl font-black shadow-lg">✓</div>`;
        }
    };

    try {
        // Step 1: Uploading...
        setStepActive(1, 20, 'Uploading...');
        const compressed = await compressImage(file);
        
        let activeReservation = window.activeTaskReservation;
        if (!activeReservation || !activeReservation.comment) {
            try {
                activeReservation = await findReusableTaskReservation(task.id, currentUser.uid);
            } catch(e) {}
        }
        if (!activeReservation || !activeReservation.comment) {
            const pool = getTaskCommentPool(task);
            if (pool.length > 0) {
                const selectDeterministicComment = (p, uId, tId) => {
                    let hash = 0;
                    const str = uId + tId;
                    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
                    const index = Math.abs(hash) % (p.length || 1);
                    return { comment: p[index] || '', index };
                };
                const sel = selectDeterministicComment(pool, currentUser.uid, task.id);
                activeReservation = { comment: sel.comment, commentIndex: sel.index, expiresAt: Date.now() + 10 * 60 * 1000 };
            }
        }
        
        const matchedComment = activeReservation?.comment || '';

        // Step 2: Verifying Screenshot...
        setStepActive(2, 40, 'Verifying Screenshot...');

        // Step 3: Extracting Review...
        setStepActive(3, 60, 'Extracting Review...');

        const token = await getBackendAuthToken();
        const params = new URLSearchParams({
            taskId: task.id,
            fileName: compressed.name,
            appName: appName || 'Unknown App',
            isBulk: 'false',
            skipOcr: 'false',
            assignedComment: matchedComment || '',
            matchedComment: matchedComment || ''
        });

        // Step 4: Matching Comment...
        setStepActive(4, 80, 'Matching Comment...');

        const uploadUrl = `${BACKEND_BASE_URL}/api/uploads/task-screenshot?${params.toString()}`;
        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': compressed.type || 'image/jpeg'
        };

        const uploadResult = await uploadFileWithProgress(uploadUrl, compressed, headers, (percent) => {
            const pct = Math.round(60 + (percent * 0.25));
            if (progressEl) progressEl.style.width = `${pct}%`;
            if (percentEl) percentEl.textContent = `${pct}%`;
        });

        const uploadData = uploadResult.data || {};
        const verification = uploadData.verification || {};

        const finalComment = verification.matchedComment || matchedComment || activeReservation?.comment || '';
        const screenshotUrl = uploadData?.screenshot?.url 
            || uploadData?.screenshot?.viewUrl 
            || uploadData?.screenshot?.view_url 
            || uploadData?.screenshotUrl 
            || uploadData?.url 
            || uploadData?.screenshot?.drivePath 
            || uploadData?.key 
            || '';
        const screenshotKey = uploadData?.screenshot?.key || uploadData?.key || '';
        const screenshotViewUrl = uploadData?.screenshot?.viewUrl || uploadData?.viewUrl || screenshotUrl;
        const screenshotDrivePath = uploadData?.screenshot?.drivePath || uploadData?.drivePath || '';

        if (!screenshotUrl) {
            throw new Error('Screenshot upload failed to generate image URL. Please re-upload your screenshot.');
        }

        // 5. Submit to Backend
        updateProgress(90, 'Uploading Screenshot', 'Submitting verification details...');
        
        const commentsPool = getTaskCommentPool(task);
        const commentIdx = commentsPool.indexOf(finalComment);
        const finalCommentIndex = activeReservation 
            ? (activeReservation.commentIndex ?? activeReservation.comment_index ?? 0) 
            : (commentIdx >= 0 ? commentIdx : 0);
        const taskIndexVal = task.taskIndex || task.task_index || 1;
        const reservationId = activeReservation?.id || getTaskReservationDocId(task.id, currentUser.uid);
        const submissionId = `sub_${task.id.slice(0, 12)}_${currentUser.uid.slice(0, 12)}_${Date.now()}_0`;

        const submitResponse = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/task-submissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: submissionId,
                taskId: task.id,
                reservationId,
                assignedComment: finalComment,
                screenshotUrl,
                screenshotKey,
                screenshotViewUrl,
                screenshotDrivePath,
                reward: Number(reward || 0),
                taskLink: taskLink,
                appName: appName,
                userName: currentUserData?.name || currentUser.email || 'User',
                userEmail: currentUser.email || currentUserData?.email || '',
                payoutDelayDays: Number(task.paymentDelayDays || task.paymentDays || 7),
                ocrStatus: 'completed',
                ocrExtractedName: verification.gmailName,
                ocrExtractedText: verification.ocrText || ocrText,
                ocrConfidence: verification.ocrConfidence || 1.0,
                details: { 
                    gmailLogoUrl: verification.gmailLogoUrl, 
                    avatarHash: verification.avatarHash || '', 
                    avatarCrop: verification.avatarCrop || null,
                    taskIndex: taskIndexVal,
                    task_index: taskIndexVal,
                    commentIndex: finalCommentIndex,
                    comment_index: finalCommentIndex
                }
            })
        }, 15000);

        const resData = await submitResponse.json().catch(() => ({}));
        if (!submitResponse.ok || !resData.ok) {
            throw new Error(resData.detail || resData.error || 'Submission failed');
        }

        // Clean reservation timer
        if (activeTaskReservationTimer) {
            clearInterval(activeTaskReservationTimer);
            activeTaskReservationTimer = null;
        }
        activeTaskReservation = null;
        window.activeTaskReservation = null;

        userTaskSubmissionIds.add(task.id);
        userTaskTodaySubmissionIds.add(task.id);
        localStorage.removeItem('last_active_task_id');
        localStorage.removeItem('last_active_task_data');

        if (typeof preloadUserTaskParticipation === 'function' && currentUser?.uid) {
            preloadUserTaskParticipation(currentUser.uid, { force: true });
        }

        // Success Popup state: Step 5 Verified!
        setStepActive(5, 100, '✅ Verified');
        if (statusTitleEl) {
            statusTitleEl.className = "text-sm font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mt-1";
            statusTitleEl.textContent = "✅ Verification Successful";
        }

        const progressWrapper = document.getElementById('single-upload-progress-bar-wrapper');
        if (progressWrapper) progressWrapper.classList.add('hidden');
        if (percentEl) percentEl.classList.add('hidden');

        if (closeBtn) {
            closeBtn.disabled = false;
            closeBtn.className = "w-full py-3 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition uppercase tracking-wider shadow-sm";
            closeBtn.textContent = "Okay";
            closeBtn.onclick = () => {
                releaseLock();
                window.closeModal();
                if (typeof showUserTaskPage === 'function') {
                    showUserTaskPage();
                }
                if (typeof renderHomeTaskCategories === 'function') {
                    renderHomeTaskCategories();
                }
            };
        }
    } catch (err) {
        releaseLock();
        console.error('Single user auto-submission failed:', err);
        // Error state
        if (statusIconEl) {
            statusIconEl.innerHTML = `
                <div class="h-16 w-16 bg-rose-100 dark:bg-rose-955/20 rounded-full flex items-center justify-center border-2 border-rose-500 scale-in-animation shadow-sm">
                    <svg class="h-9 w-9 text-rose-600 dark:text-rose-455" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </div>
            `;
        }
        if (statusTitleEl) statusTitleEl.className = "text-sm font-black text-rose-600 dark:text-rose-455 uppercase tracking-wider";
        if (statusTitleEl) statusTitleEl.textContent = "Upload Failed";
        if (statusTextEl) statusTextEl.className = "text-xs text-rose-600 dark:text-rose-400 font-bold leading-normal px-3 mt-1";
        if (statusTextEl) statusTextEl.textContent = err.message || "Something went wrong. Please try again.";

        const progressWrapper = document.getElementById('single-upload-progress-bar-wrapper');
        if (progressWrapper) progressWrapper.classList.add('hidden');
        if (percentEl) percentEl.classList.add('hidden');

        if (closeBtn) {
            closeBtn.disabled = false;
            closeBtn.className = "w-full py-3 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition uppercase tracking-wider shadow-sm";
            closeBtn.textContent = "Try Again";
            closeBtn.onclick = () => {
                window.closeModal();
                // Click file input again
                const fileInput = document.getElementById('task-proof-input');
                if (fileInput) fileInput.click();
            };
        }
    }
};

const getIncomeTransactions = () => unifiedHistoryCache.filter(item => {
            if (item.status && item.status !== 'completed') return false;
            const type = normalizeTransactionType(item);
            return type === 'credit' || type === 'gift_card' || (type === 'wallet_transfer' && Number(item.amount || 0) > 0);
        });

const showTrackIncomePage = () => {
            const createdYear = getUserCreatedYear();
            const currentYear = new Date().getFullYear();
            const years = [];
            for (let year = createdYear; year <= currentYear; year++) years.push(year);
            const content = `
                ${getPageHeader('Track Income')}
                <div class="max-w-lg mx-auto space-y-4">
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700">
                        <label class="text-sm font-semibold text-gray-500 dark:text-gray-400">Choose Year</label>
                        <select id="income-year-select" class="mt-2 w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            ${years.map(year => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`).join('')}
                        </select>
                    </div>
                    <div id="income-month-list" class="space-y-3"></div>
                </div>
                ${getPageFooter()}`;
            showPage(content, { onBack: showSettingsPage });
            const renderIncomeYear = (year) => {
                const created = getSafeDate(currentUserData?.createdAt);
                const current = new Date();
                const totals = Array(12).fill(0);
                getIncomeTransactions().forEach(item => {
                    const date = getSafeDate(item.timestamp || item.createdAt);
                    if (!date || date.getFullYear() !== Number(year)) return;
                    totals[date.getMonth()] += absoluteAmount(item.amount || item.chargeAmount || 0);
                });
                const rows = totals.map((amount, monthIndex) => {
                    if (created && Number(year) === created.getFullYear() && monthIndex < created.getMonth()) return '';
                    if (Number(year) === current.getFullYear() && monthIndex > current.getMonth()) return '';
                    return `
                        <div class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                            <span class="font-semibold text-gray-900 dark:text-white">${monthNames[monthIndex]}</span>
                            <span class="font-bold text-emerald-600 dark:text-emerald-300">${formatCurrency(amount)}</span>
                        </div>`;
                }).join('');
                document.getElementById('income-month-list').innerHTML = rows || '<p class="text-center text-gray-500 dark:text-gray-400 py-8">No income records for this year.</p>';
            };
            document.getElementById('income-year-select').onchange = (e) => renderIncomeYear(e.target.value);
            renderIncomeYear(currentYear);
        };

const getLatestTransactionsForBot = async (limit = 5) => {
            if (!currentUser?.uid) return [];
            const cachedHistory = mergeTransactionsByKey(
                unifiedHistoryCache || [],
                readHistoryItemsFromCache(currentUser.uid)
            );

            try {
                const mergedHistory = await prefetchTransactionHistory(currentUser.uid, { force: !cachedHistory.length });
                const pendingCached = cachedHistory.filter(item => String(item.status || '').toLowerCase() === 'pending');
                const combinedHistory = mergeTransactionsByKey(mergedHistory || [], pendingCached);
                return combinedHistory.slice(0, limit);
            } catch (error) {
                console.warn('Bot merged transaction lookup failed:', error);
                return cachedHistory.slice(0, limit);
            }
        };

const getFilteredTransactions = (filter) => {
    if ((!unifiedHistoryCache || unifiedHistoryCache.length === 0) && currentUser?.uid) {
        unifiedHistoryCache = readHistoryItemsFromCache(currentUser.uid);
    }

    if (filter === 'all') {
        return unifiedHistoryCache;
    }

    if (filter === 'deposit') {
        return unifiedHistoryCache.filter(item => item.type === 'deposit' || !!item.orderId);
    }

    if (filter === 'withdrawal') {
        return unifiedHistoryCache.filter(item =>
            normalizeTransactionType(item) === 'withdrawal' ||
            (item.status === 'pending' && normalizeTransactionType(item) !== 'loan')
        );
    }

    if (filter === 'received') {
        return unifiedHistoryCache.filter(item => {
            const type = normalizeTransactionType(item);
            return ['credit', 'gift_card'].includes(type) || (type === 'wallet_transfer' && Number(item.amount || 0) > 0);
        });
    }

    if (filter === 'sent') {
        return unifiedHistoryCache.filter(item => {
            const type = normalizeTransactionType(item);
            return type === 'debit' || type === 'mobile_recharge' || type === 'withdrawal' || (type === 'wallet_transfer' && Number(item.amount || 0) < 0);
        });
    }

    if (filter === 'debit') {
        return unifiedHistoryCache.filter(item => normalizeTransactionType(item) === 'debit');
    }

    return unifiedHistoryCache;
};

const renderFilteredTransactions = (filter, options = {}) => {
    const { reset = true } = options;
    let filteredList = getFilteredTransactions(filter);

    // Apply real-time search filter if text is entered
    const searchQuery = (document.getElementById('transaction-search-input')?.value || '').toLowerCase().trim();
    if (searchQuery) {
        filteredList = filteredList.filter(item => {
            const name = (item.senderName || item.recipientName || item.userName || item.comment || item.type || '').toLowerCase();
            const orderId = (item.orderId || item.id || item.transactionId || '').toLowerCase();
            const mobile = (item.mobileNumber || item.senderMobile || item.recipientMobile || '').toLowerCase();
            const amount = String(item.amount || '');
            const utr = (item.utr || '').toLowerCase();
            return name.includes(searchQuery) || orderId.includes(searchQuery) || mobile.includes(searchQuery) || amount.includes(searchQuery) || utr.includes(searchQuery);
        });
    }

    transactionListState.filter = filter;
    transactionListState.items = filteredList;
    if (reset) {
        transactionListState.visibleCount = TRANSACTION_PAGE_SIZE;
    }

    const listElement = document.getElementById('all-transactions-list');
    if (!listElement) return;

    if (filteredList.length === 0) {
        listElement.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-8 text-xs font-semibold">No transactions found.</p>';
        return;
    }

    const visibleItems = filteredList.slice(0, transactionListState.visibleCount);
    const hasMore = transactionListState.visibleCount < filteredList.length;

    // Paytm Style: Group visible items by Month Year
    const monthGroups = {};
    visibleItems.forEach(item => {
        const timestamp = item.timestamp || item.createdAt || item.requestedAt;
        let date;
        if (timestamp?.toDate) date = timestamp.toDate();
        else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
        else if (typeof timestamp === 'number') date = new Date(timestamp);
        else date = new Date(timestamp);
        if (isNaN(date.getTime())) date = new Date();

        const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (!monthGroups[monthKey]) monthGroups[monthKey] = [];
        monthGroups[monthKey].push(item);
    });

    let html = '';
    Object.keys(monthGroups).forEach(monthKey => {
        let monthReceived = 0;
        monthGroups[monthKey].forEach(t => {
            const amt = Math.abs(Number(t.amount || 0));
            const isDeposit = t.type === 'deposit' || !!t.orderId;
            const isCredit = t.type === 'deposit' || t.type === 'credit' || t.type === 'gift_card' || (!['debit', 'withdrawal', 'mobile_recharge'].includes(t.type) && Number(t.amount || 0) > 0);
            if (isCredit && !isDeposit) monthReceived += amt;
        });

        html += `
            <div class="mt-5 mb-2 pt-2 border-t border-gray-200 dark:border-gray-700/80">
                <div onclick="showMonthlyAISpendSummaryPage('${monthKey}')" class="flex items-center justify-between bg-slate-100 dark:bg-gray-750 px-3.5 py-2.5 rounded-xl shadow-2xs cursor-pointer hover:bg-slate-200 dark:hover:bg-gray-700 transition">
                    <span class="text-xs font-black text-gray-900 dark:text-white">${monthKey}</span>
                    <div class="flex items-center gap-2.5">
                        <div class="text-right">
                            <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400 block leading-tight">Total Received</span>
                            <span class="text-sm font-black text-gray-900 dark:text-white block leading-tight">₹${monthReceived.toLocaleString('en-IN')}</span>
                        </div>
                        <div class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0 shadow-2xs">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
                        </div>
                    </div>
                </div>
            </div>
            <div class="space-y-0 divide-y divide-gray-100 dark:divide-gray-800">
                ${monthGroups[monthKey].map(item => renderTransactionItem(item, true)).join('')}
            </div>`;
    });

    if (hasMore) {
        html += `<p id="transactions-load-hint" class="text-center text-xs font-semibold text-gray-500 dark:text-gray-400 py-3">Scroll to load more</p>`;
    }

    listElement.innerHTML = html;
};

const openDownloadStatementModal = () => {
    if (!unifiedHistoryCache || unifiedHistoryCache.length === 0) {
        return showNotification('No transaction history available to download.', true);
    }

    renderModal('Download Statement (PDF)',
        `<div class="space-y-4 text-left">
            <p class="text-xs text-gray-600 dark:text-gray-300 font-medium">Select the time period for your account statement PDF:</p>
            
            <div class="space-y-2.5">
                <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 cursor-pointer hover:border-emerald-500 transition">
                    <input type="radio" name="pdf-range" value="all" checked class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                    <div>
                        <span class="text-sm font-bold text-gray-900 dark:text-white block">All Time</span>
                        <span class="text-[11px] text-gray-500">Complete statement of all transactions</span>
                    </div>
                </label>

                <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 cursor-pointer hover:border-emerald-500 transition">
                    <input type="radio" name="pdf-range" value="1month" class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                    <div>
                        <span class="text-sm font-bold text-gray-900 dark:text-white block">Last 1 Month</span>
                        <span class="text-[11px] text-gray-500">Transactions from the past 30 days</span>
                    </div>
                </label>

                <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 cursor-pointer hover:border-emerald-500 transition">
                    <input type="radio" name="pdf-range" value="3months" class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                    <div>
                        <span class="text-sm font-bold text-gray-900 dark:text-white block">Last 3 Months</span>
                        <span class="text-[11px] text-gray-500">Transactions from the past 90 days</span>
                    </div>
                </label>

                <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 cursor-pointer hover:border-emerald-500 transition">
                    <input type="radio" name="pdf-range" value="6months" class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                    <div>
                        <span class="text-sm font-bold text-gray-900 dark:text-white block">Last 6 Months</span>
                        <span class="text-[11px] text-gray-500">Transactions from the past 180 days</span>
                    </div>
                </label>

                <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 cursor-pointer hover:border-emerald-500 transition">
                    <input type="radio" name="pdf-range" value="custom_month" class="w-4 h-4 text-emerald-600 focus:ring-emerald-500">
                    <div class="flex-1">
                        <span class="text-sm font-bold text-gray-900 dark:text-white block mb-1">Select Specific Month</span>
                        <div class="flex gap-2">
                            <select id="pdf-month-select" class="px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-semibold">
                                <option value="0">January</option>
                                <option value="1">February</option>
                                <option value="2">March</option>
                                <option value="3">April</option>
                                <option value="4">May</option>
                                <option value="5">June</option>
                                <option value="6">July</option>
                                <option value="7" selected>August</option>
                                <option value="8">September</option>
                                <option value="9">October</option>
                                <option value="10">November</option>
                                <option value="11">December</option>
                            </select>
                            <select id="pdf-year-select" class="px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-semibold">
                                <option value="2024">2024</option>
                                <option value="2025">2025</option>
                                <option value="2026" selected>2026</option>
                            </select>
                        </div>
                    </div>
                </label>
            </div>
        </div>`,
        `<button onclick="window.closeModal()" class="px-4 py-2 text-xs bg-gray-200 dark:bg-gray-600 rounded-xl font-bold">Cancel</button>
         <button id="generate-pdf-btn" class="px-4 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md flex items-center gap-1.5">
            <span>📄 Generate PDF Statement</span>
         </button>`,
        'max-w-md'
    );

    document.getElementById('generate-pdf-btn').onclick = () => {
        const selectedRange = document.querySelector('input[name="pdf-range"]:checked')?.value || 'all';
        const selectedMonth = parseInt(document.getElementById('pdf-month-select')?.value || '7', 10);
        const selectedYear = parseInt(document.getElementById('pdf-year-select')?.value || '2026', 10);

        generatePDFStatement({ range: selectedRange, month: selectedMonth, year: selectedYear });
    };
};

const generatePDFStatement = ({ range, month, year }) => {
    let items = [...(unifiedHistoryCache || [])];
    const now = new Date();
    let filename = 'RW_WALLET_Statement.pdf';
    let rangeTitle = 'All Time Statement';

    if (range === '1month') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 30);
        items = items.filter(t => {
            const d = new Date(t.timestamp || t.createdAt || t.requestedAt || 0);
            return d >= cutoff;
        });
        filename = 'RW_WALLET_Statement_Last_1_Month.pdf';
        rangeTitle = 'Last 1 Month Statement';
    } else if (range === '3months') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 90);
        items = items.filter(t => {
            const d = new Date(t.timestamp || t.createdAt || t.requestedAt || 0);
            return d >= cutoff;
        });
        filename = 'RW_WALLET_Statement_Last_3_Months.pdf';
        rangeTitle = 'Last 3 Months Statement';
    } else if (range === '6months') {
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - 180);
        items = items.filter(t => {
            const d = new Date(t.timestamp || t.createdAt || t.requestedAt || 0);
            return d >= cutoff;
        });
        filename = 'RW_WALLET_Statement_Last_6_Months.pdf';
        rangeTitle = 'Last 6 Months Statement';
    } else if (range === 'custom_month') {
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = monthNames[month] || 'Month';
        items = items.filter(t => {
            const d = new Date(t.timestamp || t.createdAt || t.requestedAt || 0);
            return d.getMonth() === month && d.getFullYear() === year;
        });
        filename = `RW_WALLET_Statement_${monthName}_${year}.pdf`;
        rangeTitle = `Statement for ${monthName} ${year}`;
    }

    if (items.length === 0) {
        return showNotification(`No transactions found for ${rangeTitle}.`, true);
    }

    window.closeModal();

    let totalCredits = 0;
    let totalDebits = 0;
    items.forEach(t => {
        const amt = Math.abs(Number(t.amount || 0));
        const isCredit = t.type === 'deposit' || t.type === 'credit' || t.type === 'gift_card' || (!['debit', 'withdrawal', 'mobile_recharge'].includes(t.type) && amt > 0);
        if (isCredit) totalCredits += amt;
        else totalDebits += amt;
    });

    const userName = currentUserData?.name || 'User';
    const userMobile = currentUserData?.mobile || 'N/A';
    const userEmail = currentUserData?.email || 'N/A';
    const generatedDate = formatDate(new Date());

    const printWin = window.open('', '_blank');
    if (!printWin) {
        return showNotification('Please allow popups to download your PDF statement.', true);
    }

    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${filename.replace('.pdf', '')}</title>
            <style>
                @page { size: A4; margin: 15mm; }
                body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 20px; background: #fff; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #10b981; padding-bottom: 15px; margin-bottom: 20px; }
                .logo-box { display: flex; align-items: center; gap: 10px; }
                .logo-img { width: 45px; height: 45px; border-radius: 50%; }
                .brand-title { font-size: 22px; font-weight: 900; color: #047857; margin: 0; }
                .brand-sub { font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; }
                .summary-card { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 25px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; }
                .stat-box { text-align: center; }
                .stat-label { font-size: 10px; text-transform: uppercase; font-weight: 700; color: #64748b; }
                .stat-val { font-size: 16px; font-weight: 900; margin-top: 4px; }
                .text-green { color: #059669; }
                .text-red { color: #dc2626; }
                .user-info { margin-bottom: 20px; font-size: 12px; color: #475569; display: flex; justify-content: space-between; background: #f1f5f9; padding: 10px 15px; border-radius: 8px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
                th { background: #047857; color: white; padding: 10px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 10px; }
                td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; }
                tr:nth-child(even) { background: #f8fafc; }
                .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px dashed #cbd5e1; padding-top: 15px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo-box">
                    <img src="https://cdn-icons-png.flaticon.com/512/12449/12449036.png" class="logo-img">
                    <div>
                        <h1 class="brand-title">RW WALLET</h1>
                        <div class="brand-sub">Official Account Statement</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 14px; font-weight: 800; color: #0f172a;">${rangeTitle}</div>
                    <div style="font-size: 10px; color: #64748b;">Generated on: ${generatedDate}</div>
                </div>
            </div>

            <div class="user-info">
                <div><strong>Account Holder:</strong> ${userName} (${userMobile})</div>
                <div><strong>Email:</strong> ${userEmail}</div>
            </div>

            <div class="summary-card">
                <div class="stat-box">
                    <div class="stat-label">Total Credits (+)</div>
                    <div class="stat-val text-green">₹${totalCredits.toLocaleString('en-IN')}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Total Debits (-)</div>
                    <div class="stat-val text-red">₹${totalDebits.toLocaleString('en-IN')}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Net Balance Change</div>
                    <div class="stat-val">₹${(totalCredits - totalDebits).toLocaleString('en-IN')}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Date & Time</th>
                        <th>Type / Category</th>
                        <th>Description / Party</th>
                        <th>Amount</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(t => {
                        const dateStr = formatDate(t.timestamp || t.createdAt || t.requestedAt);
                        const isCredit = t.type === 'deposit' || t.type === 'credit' || t.type === 'gift_card' || (!['debit', 'withdrawal', 'mobile_recharge'].includes(t.type) && Number(t.amount || 0) > 0);
                        const party = t.senderName || t.recipientName || t.comment || t.type || 'N/A';
                        const status = t.status || 'completed';
                        const sign = isCredit ? '+' : '-';
                        const colorClass = isCredit ? 'text-green' : 'text-red';
                        return `
                            <tr>
                                <td>${dateStr}</td>
                                <td><strong style="text-transform: capitalize;">${(t.type || 'Transaction').replace(/_/g, ' ')}</strong></td>
                                <td>${party}</td>
                                <td class="${colorClass}" style="font-weight: 800;">${sign} ₹${Math.abs(Number(t.amount || 0)).toLocaleString('en-IN')}</td>
                                <td style="text-transform: uppercase; font-size: 9px; font-weight: 700;">${status}</td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>

            <div class="footer">
                This is a computer-generated account statement from RW WALLET. No signature required.
            </div>
            <script>
                window.onload = function() {
                    document.title = "${filename}";
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    printWin.document.close();
};

const downloadTransactionStatement = openDownloadStatementModal;
window.openDownloadStatementModal = openDownloadStatementModal;
window.downloadTransactionStatement = openDownloadStatementModal;

const loadMoreTransactionsIfNeeded = () => {
    if (!document.getElementById('all-transactions-list')) return;
    if (transactionListState.visibleCount >= transactionListState.items.length) return;

    transactionListState.visibleCount += TRANSACTION_PAGE_SIZE;
    renderFilteredTransactions(transactionListState.filter, { reset: false });
};

const refreshTransactionHistoryFromFirebase = async (userId = currentUser?.uid) => {
    if (!userId) return [];
    return prefetchTransactionHistory(userId, { force: true });
};

const showAllTransactionsPage = () => {
    if ((!unifiedHistoryCache || unifiedHistoryCache.length === 0) && currentUser?.uid) {
        unifiedHistoryCache = readHistoryItemsFromCache(currentUser.uid);
    }

    const content = `
        ${getPageHeader('Payment History')}
        <div class="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-lg space-y-3">
            
            <!-- Compact Single Row Header: Search Input + Filter Icon + Download Icon -->
            <div class="relative flex items-center gap-2">
                <!-- Search Input Box -->
                <div class="relative flex-1">
                    <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 pointer-events-none">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    </span>
                    <input type="text" id="transaction-search-input" placeholder="Search by name, mobile, order ID or amount..." class="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-gray-700/60 border border-transparent rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white transition">
                </div>

                <!-- Filter Toggle Icon Button -->
                <button id="filter-toggle-btn" title="Filter Transactions" class="p-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-gray-700 dark:text-gray-200 border border-gray-200/80 dark:border-gray-600 transition shrink-0 shadow-2xs">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
                </button>

                <!-- Download PDF Statement Icon Button -->
                <button onclick="downloadTransactionStatement()" title="Download PDF Statement" class="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 rounded-xl border border-emerald-200 dark:border-emerald-800 transition shrink-0 shadow-2xs">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </button>

                <!-- Floating Filter Dropdown Popup Menu -->
                <div id="filter-dropdown-menu" class="hidden absolute right-10 top-11 z-50 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-1.5 w-44 space-y-1">
                    <button data-filter="all" class="filter-dropdown-btn w-full text-left px-3 py-2 text-xs font-bold rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-gray-800 dark:text-gray-200 flex items-center justify-between">
                        <span>All Transactions</span>
                        <span class="active-dot text-emerald-500 font-bold">✓</span>
                    </button>
                    <button data-filter="deposit" class="filter-dropdown-btn w-full text-left px-3 py-2 text-xs font-bold rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-gray-800 dark:text-gray-200 flex items-center justify-between">
                        <span>Add Money</span>
                    </button>
                    <button data-filter="withdrawal" class="filter-dropdown-btn w-full text-left px-3 py-2 text-xs font-bold rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-gray-800 dark:text-gray-200 flex items-center justify-between">
                        <span>Withdrawal</span>
                    </button>
                    <button data-filter="received" class="filter-dropdown-btn w-full text-left px-3 py-2 text-xs font-bold rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-gray-800 dark:text-gray-200 flex items-center justify-between">
                        <span>Received</span>
                    </button>
                    <button data-filter="sent" class="filter-dropdown-btn w-full text-left px-3 py-2 text-xs font-bold rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-gray-800 dark:text-gray-200 flex items-center justify-between">
                        <span>Sent</span>
                    </button>
                </div>
            </div>
            
            <!-- Paytm Style Transactions List -->
            <div id="all-transactions-list" class="space-y-1">
            </div>
        </div>
        ${getPageFooter()}`;
    showPage(content, { keepBottomNav: true });
    currentMainSection = 'transactions';
    setBottomNavActive('bottom-home-btn');
    const pageContainer = document.getElementById('page-container');
    let activeFilterName = 'all';

    // Initial render of all transactions
    renderFilteredTransactions('all');
    prefetchTransactionHistory(currentUser?.uid)
        .then(() => {
            renderFilteredTransactions(activeFilterName, { reset: false });
        })
        .catch((error) => {
            console.error('Background transaction refresh failed:', error);
        });

    // Add search input listener for real-time search
    document.getElementById('transaction-search-input')?.addEventListener('input', () => {
        renderFilteredTransactions(activeFilterName);
    });

    const dropdownMenu = document.getElementById('filter-dropdown-menu');
    const filterToggleBtn = document.getElementById('filter-toggle-btn');

    filterToggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu?.classList.toggle('hidden');
    });

    document.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            activeFilterName = btn.dataset.filter;
            document.querySelectorAll('.filter-dropdown-btn .active-dot').forEach(dot => dot.remove());
            btn.insertAdjacentHTML('beforeend', '<span class="active-dot text-emerald-500 font-bold">✓</span>');
            dropdownMenu?.classList.add('hidden');
            renderFilteredTransactions(activeFilterName);
            pageContainer.scrollTop = 0;
        });
    });

    // Auto-hide dropdown on page scroll or outside click
    pageContainer.onscroll = () => {
        dropdownMenu?.classList.add('hidden');
        if (currentMainSection !== 'transactions') return;
        const distanceFromBottom = pageContainer.scrollHeight - pageContainer.scrollTop - pageContainer.clientHeight;
        if (distanceFromBottom < 180) {
            loadMoreTransactionsIfNeeded();
        }
    };

    const handleOutsideClick = (e) => {
        if (dropdownMenu && !dropdownMenu.contains(e.target) && !filterToggleBtn?.contains(e.target)) {
            dropdownMenu.classList.add('hidden');
        }
    };
    document.addEventListener('click', handleOutsideClick);

            // Keep the click listener for transaction details
            document.getElementById('all-transactions-list')?.addEventListener('click', (e) => {
                const itemEl = e.target.closest('.tx-item-clickable');
                if (itemEl) {
                    showTransactionDetails(itemEl.dataset.key);
                }
            });
        };

const showMonthlyAISpendSummaryPage = (targetMonthKey = '') => {
    if ((!unifiedHistoryCache || unifiedHistoryCache.length === 0) && currentUser?.uid) {
        unifiedHistoryCache = readHistoryItemsFromCache(currentUser.uid);
    }

    const items = unifiedHistoryCache || [];
    const now = new Date();
    const currentYear = now.getFullYear();

    if (!targetMonthKey) {
        targetMonthKey = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    const monthItems = items.filter(t => {
        const timestamp = t.timestamp || t.createdAt || t.requestedAt;
        let date;
        if (timestamp?.toDate) date = timestamp.toDate();
        else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
        else if (typeof timestamp === 'number') date = new Date(timestamp);
        else date = new Date(timestamp);
        if (isNaN(date.getTime())) return false;

        const mKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return mKey.toLowerCase() === targetMonthKey.toLowerCase();
    });

    let totalSpent = 0;
    let spentCount = 0;
    let totalReceived = 0;
    let receivedCount = 0;

    let addMoneyAmount = 0;
    let addMoneyCount = 0;

    let moneySentAmount = 0;
    let moneySentCount = 0;

    let moneyReceivedAmount = 0;
    let moneyReceivedCount = 0;

    let withdrawalAmount = 0;
    let withdrawalCount = 0;

    monthItems.forEach(t => {
        const amt = Math.abs(Number(t.amount || 0));
        const rawType = normalizeTransactionType(t);

        const isDeposit = t.type === 'deposit' || !!t.orderId;
        const isWithdrawal = t.type === 'withdrawal' || rawType === 'withdrawal';
        const isCredit = rawType === 'credit' || t.type === 'gift_card' || (!['debit', 'withdrawal', 'mobile_recharge'].includes(rawType) && amt > 0);

        if (isDeposit) {
            addMoneyAmount += amt;
            addMoneyCount++;
            totalReceived += amt;
            receivedCount++;
        } else if (isWithdrawal) {
            withdrawalAmount += amt;
            withdrawalCount++;
            totalSpent += amt;
            spentCount++;
        } else if (isCredit) {
            moneyReceivedAmount += amt;
            moneyReceivedCount++;
            totalReceived += amt;
            receivedCount++;
        } else {
            moneySentAmount += amt;
            moneySentCount++;
            totalSpent += amt;
            spentCount++;
        }
    });

    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonthIdx = now.getMonth();
    const availableMonths = monthShortNames.slice(0, currentMonthIdx + 1);

    const monthTabsHtml = availableMonths.map((m, idx) => {
        const mFull = new Date(currentYear, idx, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const isActive = mFull.toLowerCase() === targetMonthKey.toLowerCase();
        const activeClass = isActive
            ? 'border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-black'
            : 'text-gray-500 dark:text-gray-400 font-semibold hover:text-gray-900';

        return `
            <button onclick="showMonthlyAISpendSummaryPage('${mFull}')" class="px-3.5 py-2 text-xs transition-colors shrink-0 ${activeClass}">
                ${m}
            </button>`;
    }).reverse().join('');

    const content = `
        ${getPageHeader('Monthly AI Spend Summary')}
        <div class="max-w-2xl mx-auto space-y-4">
            
            <!-- Horizontal Month Selector -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-1.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
                <span class="text-xs font-black text-gray-400 dark:text-gray-500 px-2 shrink-0 border-r border-gray-200 dark:border-gray-700">${currentYear}</span>
                <div class="flex items-center gap-1 overflow-x-auto">
                    ${monthTabsHtml}
                </div>
            </div>

            <!-- Overview Spent vs Received Card -->
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
                <div class="grid grid-cols-2 gap-4 divide-x divide-gray-100 dark:divide-gray-700">
                    <div>
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-bold block">Total Spent</span>
                        <span class="text-2xl font-black text-gray-900 dark:text-white block mt-0.5">₹${totalSpent.toLocaleString('en-IN')}</span>
                        <span class="text-[11px] text-gray-400 font-medium">${spentCount} Payments</span>
                    </div>
                    <div class="pl-4">
                        <span class="text-xs text-gray-500 dark:text-gray-400 font-bold block">Total Received</span>
                        <span class="text-2xl font-black text-emerald-600 dark:text-emerald-400 block mt-0.5">₹${totalReceived.toLocaleString('en-IN')}</span>
                        <span class="text-[11px] text-gray-400 font-medium">${receivedCount} Payments</span>
                    </div>
                </div>
            </div>

            <!-- Categories Breakdown Table Header -->
            <div class="flex justify-between items-center px-1">
                <h3 class="text-sm font-black text-gray-900 dark:text-white">Categories (Tags)</h3>
                <span class="text-xs font-bold text-gray-500">Amount</span>
            </div>

            <!-- Category Rows -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                
                <!-- Money Received -->
                <div onclick="showMonthlyCategoryDetail('${targetMonthKey}', 'received')" class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition group">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 flex items-center justify-center font-bold text-sm shrink-0">💵</div>
                        <div>
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white">Money Received</h4>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${moneyReceivedCount} Payments</p>
                        </div>
                    </div>
                    <div class="text-right flex items-center gap-2">
                        <div>
                            <span class="text-base font-bold text-emerald-600 dark:text-emerald-400 block">₹${moneyReceivedAmount.toLocaleString('en-IN')}</span>
                            <span class="text-[10px] text-gray-400 block">Received</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>

                <!-- Add Money -->
                <div onclick="showMonthlyCategoryDetail('${targetMonthKey}', 'deposit')" class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition group">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 flex items-center justify-center font-bold text-sm shrink-0">⚡</div>
                        <div>
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white">Add Money (Self-Transfer)</h4>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${addMoneyCount} Payments</p>
                        </div>
                    </div>
                    <div class="text-right flex items-center gap-2">
                        <div>
                            <span class="text-base font-bold text-emerald-600 dark:text-emerald-400 block">₹${addMoneyAmount.toLocaleString('en-IN')}</span>
                            <span class="text-[10px] text-gray-400 block">Received</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>

                <!-- Money Sent -->
                <div onclick="showMonthlyCategoryDetail('${targetMonthKey}', 'sent')" class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition group">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 flex items-center justify-center font-bold text-sm shrink-0">📤</div>
                        <div>
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white">Money Sent</h4>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${moneySentCount} Payments</p>
                        </div>
                    </div>
                    <div class="text-right flex items-center gap-2">
                        <div>
                            <span class="text-base font-bold text-gray-900 dark:text-white block">₹${moneySentAmount.toLocaleString('en-IN')}</span>
                            <span class="text-[10px] text-gray-400 block">Spent</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>

                <!-- Withdrawal -->
                <div onclick="showMonthlyCategoryDetail('${targetMonthKey}', 'withdrawal')" class="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer transition group">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 flex items-center justify-center font-bold text-sm shrink-0">💸</div>
                        <div>
                            <h4 class="text-sm font-bold text-gray-900 dark:text-white">Withdrawal</h4>
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${withdrawalCount} Payments</p>
                        </div>
                    </div>
                    <div class="text-right flex items-center gap-2">
                        <div>
                            <span class="text-base font-bold text-gray-900 dark:text-white block">₹${withdrawalAmount.toLocaleString('en-IN')}</span>
                            <span class="text-[10px] text-gray-400 block">Spent</span>
                        </div>
                        <svg class="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </div>
            </div>

            <!-- Footer Branding -->
            <div class="text-center py-4 text-xs font-bold text-gray-400 flex items-center justify-center gap-2 select-none opacity-50">
                <img src="https://cdn-icons-png.flaticon.com/512/12449/12449036.png" class="w-4 h-4 object-contain">
                <span>RW WALLET | AI Spend Intelligence</span>
            </div>
        </div>
        ${getPageFooter()}`;

    showPage(content);
};

const showMonthlyCategoryDetail = (monthKey, category) => {
    const items = (unifiedHistoryCache || []).filter(t => {
        const timestamp = t.timestamp || t.createdAt || t.requestedAt;
        let date;
        if (timestamp?.toDate) date = timestamp.toDate();
        else if (timestamp?.seconds) date = new Date(timestamp.seconds * 1000);
        else if (typeof timestamp === 'number') date = new Date(timestamp);
        else date = new Date(timestamp);
        if (isNaN(date.getTime())) return false;

        const mKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        if (mKey.toLowerCase() !== monthKey.toLowerCase()) return false;

        const amt = Math.abs(Number(t.amount || 0));
        const rawType = normalizeTransactionType(t);
        const remarks = (t.comment || '').toLowerCase();
        const sender = (t.senderName || '').toLowerCase();

        if (category === 'deposit') return t.type === 'deposit' || !!t.orderId;
        if (category === 'withdrawal') return t.type === 'withdrawal' || rawType === 'withdrawal';
        if (category === 'task') return t.type === 'income' || remarks.includes('task') || remarks.includes('reward');
        if (category === 'admin') return t.isAdminTransaction || remarks.includes('admin') || sender.includes('reviews world');
        if (category === 'received') return rawType === 'credit' || t.type === 'gift_card' || (!['debit', 'withdrawal', 'mobile_recharge'].includes(rawType) && amt > 0);
        if (category === 'sent') return rawType === 'debit' || t.type === 'wallet_transfer';
        return true;
    });

    renderModal(`${monthKey} - Category Transactions`,
        `<div class="space-y-2 max-h-[60vh] overflow-y-auto">
            ${items.length ? items.map(t => renderTransactionItem(t, true)).join('') : '<p class="text-center text-gray-400 py-6 text-xs font-bold">No transactions found for this category.</p>'}
        </div>`,
        `<button onclick="window.closeModal()" class="w-full py-2.5 bg-gray-200 dark:bg-gray-600 text-xs font-bold rounded-xl">Close</button>`,
        'max-w-md'
    );

    document.querySelectorAll('#modal-container .tx-item-clickable').forEach(el => {
        el.addEventListener('click', () => {
            window.closeModal();
            showTransactionDetails(el.dataset.key);
        });
    });
};

window.showMonthlyAISpendSummaryPage = showMonthlyAISpendSummaryPage;
window.showMonthlyCategoryDetail = showMonthlyCategoryDetail;

const showPayToWalletPage = () => {
            const content = `
                ${getPageHeader('Pay to Wallet')}
                <div class="max-w-md mx-auto bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md space-y-6">
                    <div class="text-center">
                        <h3 class="text-lg font-semibold">Send Money to Another User</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">Enter the recipient's mobile number to send money</p>
                    </div>
                    
                    <div class="space-y-4">
                        <div>
                            <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Recipient Mobile Number</label>
                            <input type="tel" id="recipient-mobile-input" placeholder="Enter mobile number" class="w-full mt-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        
                        <div>
                            <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Amount</label>
                            <input type="number" id="pay-amount-input" placeholder="Enter amount (₹)" min="1" class="w-full mt-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum amount: ₹1</p>
                        </div>
                        
                        <div>
                            <label class="text-sm font-medium text-gray-500 dark:text-gray-400">Remarks (Optional)</label>
                            <input type="text" id="pay-comment-input" placeholder="Add a note" class="w-full mt-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    
                    <button id="find-recipient-btn" class="w-full bg-purple-500 text-white font-semibold py-3 rounded-lg hover:bg-purple-600 transition">Find Recipient</button>
                </div>
                ${getPageFooter()}`;
            showPage(content);
            document.getElementById('find-recipient-btn').onclick = handleFindRecipient;
        };

const showTransactionDetails = (key, source = 'user') => {
            const item = source === 'admin-user'
                ? (adminViewedUserTransactions.find(i => i.key === key) || unifiedHistoryCache.find(i => i.key === key))
                : (unifiedHistoryCache.find(i => i.key === key) || adminViewedUserTransactions.find(i => i.key === key));
            if (!item) {
                console.error("Could not find transaction with key:", key);
                return;
            }
            const viewedUser = source === 'admin-user' ? (adminViewedUserProfile || {}) : (currentUserData || {});

            const rwLogoUrl = 'https://i.ibb.co/x8YBYwGG/6233389803554672153.jpg';
            const isReviewsWorldName = (name = '') => name.toLowerCase().includes('reviews world');
            const getInitials = (name = 'User') => {
                const parts = name.trim().split(/\s+/).filter(Boolean);
                if (!parts.length) return 'US';
                if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
                return (parts[0][0] + parts[1][0]).toUpperCase();
            };
            const verifiedBadge = getVerifiedBadge();
            const isVerifiedTransactionParty = (party = {}) => {
                if (!!party.appLogo) return true;
                const pName = String(party.name || '');
                if (isReviewsWorldName(pName)) return true;
                if (/admin wallet|rw wallet|digital wallet/i.test(`${party.detail || ''} ${pName}`)) return true;
                const profile = findUserProfile({ name: pName, mobile: party.detail });
                if (profile) {
                    const role = String(profile.role || '').toLowerCase();
                    return role === 'admin' || role === 'subadmin' || role === 'owner' || !!profile.isVerified || !!profile.verified;
                }
                return false;
            };
            const renderTransactionAvatar = (name, forceAppLogo = false, logoUrl = '', userProfile = null) => logoUrl ? `
                <div class="w-10 h-10 bg-white dark:bg-gray-700 rounded-full flex items-center justify-center shadow-inner shrink-0 border border-gray-100 dark:border-gray-600 p-1.5">
                    <img src="${logoUrl}" class="w-full h-full object-contain rounded-full" alt="${name}" loading="eager">
                </div>` : (forceAppLogo || isReviewsWorldName(name)) ? `
                <div class="shrink-0">
                    <img src="${rwLogoUrl}" class="w-10 h-10 rounded-full border-2 border-gray-100 dark:border-gray-700 shadow-sm object-cover" alt="Reviews World Logo" loading="eager" fetchpriority="high" decoding="sync">
                </div>` : `
                <div class="shrink-0">
                    <img src="${getProfileAvatarUrl(userProfile || findUserProfile({ name }))}" class="w-10 h-10 rounded-full border border-gray-250 dark:border-gray-700 shadow-sm object-cover bg-white dark:bg-gray-800" alt="${name}" loading="eager">
                </div>`;
            const findUserProfile = ({ name = '', mobile = '' } = {}) => {
                const candidates = [
                    ...(viewedUser ? [viewedUser] : []),
                    ...(currentUserData ? [currentUserData] : []),
                    ...allUsersCache
                ];
                const normalizedName = name.toLowerCase();
                return candidates.find(u =>
                    (mobile && u.mobile === mobile) ||
                    (normalizedName && (u.name || '').toLowerCase() === normalizedName)
                );
            };

            const isRecharge = item.type === 'mobile_recharge';
            const isCredit = item.type !== 'debit' && item.type !== 'withdrawal' && !isRecharge && item.amount > 0;
            const dateStr = formatDate(item.timestamp);
            const displayAmount = isRecharge ? (item.chargeAmount || item.amount || 0) : Math.abs(item.amount);
            const amountStr = formatCurrency(displayAmount);

            // Format amount in words
            const amountInWords = numberToWords(displayAmount) + " Only";

            const senderName = item.senderName || (isCredit ? (item.isAdminTransaction ? 'Reviews World' : 'User') : viewedUser.name);
            const recipientName = item.recipientName || (isCredit ? viewedUser.name : 'User');
            const senderMobile = item.senderMobile || '';
            const recipientMobile = item.recipientMobile || '';
            const senderProfile = findUserProfile({ name: senderName, mobile: senderMobile });
            const recipientProfile = findUserProfile({ name: recipientName, mobile: recipientMobile });
            const senderIsPro = !!item.senderIsProProfile || !!senderProfile?.isProProfile;
            const recipientIsPro = !!item.recipientIsProProfile || !!recipientProfile?.isProProfile;
            let remarks = item.comment || (item.isAdminTransaction ? 'Payment By reviews World' : 'Money Transfer');
            const rawStatus = item.status || 'completed';
            const isWithdrawal = item.type === 'withdrawal';
            const isGiftCard = item.type === 'gift_card';
            const isRejected = rawStatus === 'rejected' || rawStatus === 'failed';
            const isPending = rawStatus === 'pending';
            const normalizedDetailType = normalizeTransactionType(item);
            if (normalizedDetailType === 'credit' && /admin\s+debit/i.test(remarks)) {
                remarks = 'Admin Balance Credit';
            }
            const isAdminCredit = (item.isAdminTransaction && isCredit) || normalizedDetailType === 'credit' && (isReviewsWorldName(remarks) || isReviewsWorldName(senderName));
            const isAdminDebit = item.isAdminTransaction && !isCredit && normalizedDetailType === 'debit';
            const giftCodeFromComment = (remarks.match(/redeemed code\s+([A-Z0-9-]+)/i) || [])[1] || '';
            const txnDisplayId = isGiftCard ? (item.giftCode || giftCodeFromComment || item.transactionId) : (item.adminTransactionId || item.transactionId);
            const methodId = item.methodId || (item.upiId ? 'upi' : item.accountNumber ? 'bank' : remarks.toLowerCase().includes('amazon') ? 'amazon_gift' : remarks.toLowerCase().includes('flipkart') ? 'flipkart_gift' : remarks.toLowerCase().includes('play') ? 'play_store' : remarks.toLowerCase().includes('paypal') ? 'paypal' : '');
            const methodName = getWithdrawalDisplayMethodName({ ...item, methodId });
            const methodDetail = getWithdrawalDetailText({ ...item, methodId });
            const detailBalanceAfter = getExplicitBalanceAfter(item) ?? item.balanceAfter;

            let statusTitle = isCredit ? 'Money Received' : 'Money Sent';
            let statusLabel = isCredit ? 'Money Received' : 'Money Sent';
            let statusPillClass = isCredit
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900/30';
            let statusIconClass = isCredit ? 'text-green-500' : 'text-blue-500';
            let fromParty = { label: 'From', name: isCredit ? senderName : viewedUser.name, detail: isCredit ? senderMobile : (viewedUser.mobile || ''), appLogo: isCredit ? senderIsPro : !!viewedUser?.isProProfile };
            let toParty = { label: 'To', name: isCredit ? recipientName : recipientName, detail: isCredit ? 'RW Wallet Balance' : recipientMobile, appLogo: isCredit ? recipientIsPro : recipientIsPro };
            let modeLabel = item.type === 'wallet_transfer' || item.type === 'debit' ? 'Wallet Transfer' : isAdminCredit ? 'Wallet Credit' : 'Wallet Transaction';
            let extraDetail = '';

            if (item.type === 'deposit' || item.orderId) {
                const isDepositSuccess = rawStatus === 'completed';
                const isDepositPending = rawStatus === 'pending' || rawStatus === 'pending_admin_approval';
                statusTitle = isDepositSuccess ? 'Money Added' : isDepositPending ? 'Deposit Pending' : 'Deposit Failed';
                statusLabel = isDepositSuccess ? 'Added to Wallet' : isDepositPending ? 'Pending Verification' : 'Failed';
                statusPillClass = isDepositSuccess
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30'
                    : isDepositPending
                        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/30'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/30';
                statusIconClass = isDepositSuccess ? 'text-green-500' : isDepositPending ? 'text-amber-500' : 'text-red-500';

                fromParty = { label: 'From', name: 'UPI / Bank', detail: 'Instant Deposit', logoUrl: 'https://cdn-icons-png.flaticon.com/512/12449/12449036.png' };
                toParty = { label: 'To', name: 'RW WALLET', detail: 'Wallet Balance', logoUrl: 'https://cdn-icons-png.flaticon.com/512/12449/12449036.png' };
                modeLabel = 'UPI Deposit';
            }

            if (isAdminCredit) {
                fromParty = { label: 'From', name: 'REVIEWS WORLD', detail: 'Admin Wallet', appLogo: true };
                toParty = { label: 'To', name: recipientName || viewedUser.name || 'User', detail: 'RW Wallet Balance', appLogo: recipientIsPro || !!viewedUser?.isProProfile };
                modeLabel = 'Admin Credit';
            }

            if (isAdminDebit) {
                statusTitle = 'Money Debited';
                statusLabel = 'Admin Debit';
                fromParty = { label: 'From', name: viewedUser.name || senderName || 'User', detail: viewedUser.mobile || senderMobile || '', appLogo: !!viewedUser?.isProProfile || senderIsPro };
                toParty = { label: 'To', name: 'REVIEWS WORLD', detail: 'Admin Wallet', appLogo: true };
                modeLabel = 'Admin Debit';
            }

            if (isGiftCard) {
                statusTitle = 'Money Received';
                statusLabel = 'Money Received';
                fromParty = { label: 'From', name: 'REVIEWS WORLD', detail: 'Gift Card', appLogo: true };
                toParty = { label: 'To', name: recipientName || viewedUser.name || 'User', detail: 'RW Wallet Balance', appLogo: recipientIsPro || !!viewedUser?.isProProfile };
                modeLabel = 'Gift Card';
            }

            if (isWithdrawal) {
                statusTitle = isRejected ? 'Withdrawal Failed' : isPending ? 'Withdrawal Pending' : 'Money Withdrawn';
                statusLabel = isRejected ? 'Failed' : isPending ? 'Pending' : 'Withdrawal Completed';
                statusPillClass = isRejected
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/30'
                    : isPending
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-900/30'
                        : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30';
                statusIconClass = isRejected ? 'text-red-500' : isPending ? 'text-yellow-500' : 'text-green-500';
                fromParty = { label: 'From', name: 'Digital Wallet', detail: 'RW Wallet Balance', appLogo: true };
                toParty = { label: 'To', name: methodName, detail: methodDetail, appLogo: false, logoUrl: getWithdrawMethodLogo(methodId) };
                modeLabel = methodName;
                extraDetail = isRejected && item.rejectionReason ? `
                    <div class="bg-red-50 dark:bg-red-900/20 px-3 py-2">
                        <p class="text-[10px] font-semibold uppercase text-red-500 dark:text-red-400">Failed Reason</p>
                        <p class="text-xs text-red-700 dark:text-red-300 mt-0.5">${item.rejectionReason}</p>
                    </div>` : '';
            }
            if (isRecharge) {
                statusTitle = isRejected ? 'Recharge Failed' : isPending ? 'Recharge Pending' : 'Mobile Recharge Done';
                statusLabel = isRejected ? 'Failed' : isPending ? 'Pending' : 'Recharge Completed';
                statusPillClass = isRejected
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/30'
                    : isPending
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-100 dark:border-yellow-900/30'
                        : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900/30';
                statusIconClass = isRejected ? 'text-red-500' : isPending ? 'text-yellow-500' : 'text-green-500';
                fromParty = { label: 'From', name: 'Digital Wallet', detail: 'RW Wallet Balance', appLogo: true };
                toParty = { label: 'Recharge For', name: item.mobileNumber || 'Mobile Number', detail: `${item.operator || ''} ${item.state ? `| ${item.state}` : ''}`.trim(), appLogo: false };
                modeLabel = 'Mobile Recharge';
                extraDetail = `
                    <div class="bg-sky-50 dark:bg-sky-900/20 px-3 py-2">
                        <p class="text-[10px] font-semibold uppercase text-sky-600 dark:text-sky-300">Plan Details</p>
                        <p class="text-xs text-sky-800 dark:text-sky-200 mt-0.5">${item.planDetails || 'N/A'}</p>
                    </div>
                    <div class="bg-green-50 dark:bg-green-900/20 px-3 py-2">
                        <p class="text-[10px] font-semibold uppercase text-green-600 dark:text-green-300">Discount</p>
                        <p class="text-xs text-green-800 dark:text-green-200 mt-0.5">Recharge ${formatCurrency(item.amount || 0)} - 1% discount ${formatCurrency(item.discount || 0)} = wallet deduction ${formatCurrency(item.chargeAmount || item.amount || 0)}</p>
                    </div>
                    ${isRejected && item.rejectionReason ? `
                        <div class="bg-red-50 dark:bg-red-900/20 px-3 py-2">
                            <p class="text-[10px] font-semibold uppercase text-red-500 dark:text-red-400">Failed Reason</p>
                            <p class="text-xs text-red-700 dark:text-red-300 mt-0.5">${item.rejectionReason}</p>
                        </div>` : ''}`;
            }
            const dateVerb = isRecharge ? (isRejected ? 'Failed' : isPending ? 'Requested' : 'Recharged') : isWithdrawal ? (isRejected ? 'Failed' : isPending ? 'Requested' : 'Withdrawn') : (isCredit ? 'Received' : 'Paid');

            const content = `
                <div class="bg-gray-50 dark:bg-gray-900 min-h-screen pb-6 overflow-x-hidden">
                    <div class="bg-white dark:bg-gray-800 px-4 py-3 flex items-center border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
                        <button onclick="window.closeModal()" class="p-2 -ml-2 mr-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                        </button>
                        <h2 class="text-lg font-semibold">${statusTitle}</h2>
                    </div>

                    <div class="p-3 max-w-md mx-auto">
                        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-4 ring-1 ring-gray-50 dark:ring-gray-700/40">
                            <!-- Amount Section -->
                            <div class="space-y-0.5">
                                <p class="text-xs text-gray-500 dark:text-gray-400 font-medium">Amount</p>
                                <div class="flex items-center gap-2">
                                    <span class="text-2xl font-bold">${amountStr}</span>
                                    <svg class="w-5 h-5 ${statusIconClass} fill-current" viewBox="0 0 24 24">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                    </svg>
                                </div>
                                <p class="text-[10px] text-gray-400 dark:text-gray-500 italic">${amountInWords}</p>
                            </div>

                            <!-- Remarks Section -->
                            <div class="flex items-start gap-2">
                                <div class="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-2xl flex items-center gap-2 max-w-full border border-gray-200 dark:border-gray-600">
                                    <span class="text-xs font-medium truncate">${remarks}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                </div>
                            </div>

                            <div class="flex items-center gap-2">
                                <div class="flex items-center gap-1.5 ${statusPillClass} px-3 py-1 rounded-full text-xs font-medium border">
                                    <span class="text-sm">💵</span>
                                    <span>${statusLabel}</span>
                                </div>
                            </div>

                            <hr class="border-gray-200 dark:border-gray-700">

                            <!-- Transfer Flow -->
                            <div class="rounded-2xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
                                <!-- Recipient/Sender -->
                                <div class="flex justify-between items-center gap-3 p-3 bg-gray-50/40 dark:bg-gray-900/20">
                                    <div class="space-y-0.5 min-w-0">
                                        <p class="text-xs text-gray-500 dark:text-gray-400">${fromParty.label}</p>
                                        <div class="flex items-center gap-1.5 min-w-0">
                                            <span class="text-base font-bold truncate">${fromParty.name}</span>
                                            ${isVerifiedTransactionParty(fromParty) ? verifiedBadge : ''}
                                        </div>
                                        ${fromParty.detail ? `<p class="text-xs text-gray-400 font-mono truncate">${fromParty.detail}</p>` : ''}
                                    </div>
                                    ${renderTransactionAvatar(fromParty.name, fromParty.appLogo, fromParty.logoUrl, isCredit ? senderProfile : viewedUser)}
                                </div>

                                <!-- My Account -->
                                <div class="flex justify-between items-center gap-3 p-3">
                                    <div class="space-y-0.5 min-w-0">
                                        <p class="text-xs text-gray-500 dark:text-gray-400">${toParty.label}</p>
                                        <div class="flex items-center gap-1.5 min-w-0">
                                            <span class="text-base font-bold truncate">${toParty.name}</span>
                                            ${isVerifiedTransactionParty(toParty) ? verifiedBadge : ''}
                                        </div>
                                        ${toParty.detail ? `<p class="text-xs text-gray-400 font-mono truncate">${toParty.detail}</p>` : ''}
                                    </div>
                                    ${renderTransactionAvatar(toParty.name, toParty.appLogo, toParty.logoUrl, isCredit ? viewedUser : recipientProfile)}
                                </div>
                            </div>

                            <div class="rounded-2xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden text-xs">
                                <div class="flex justify-between gap-3 px-3 py-2">
                                    <span class="text-gray-500 dark:text-gray-400">Mode</span>
                                    <span class="font-semibold text-right">${modeLabel}</span>
                                </div>
                                <div class="flex justify-between gap-3 px-3 py-2">
                                    <span class="text-gray-500 dark:text-gray-400">Status</span>
                                    <span class="font-semibold text-right">${statusLabel}</span>
                                </div>
                                ${Number.isFinite(Number(detailBalanceAfter)) ? `
                                    <div class="flex justify-between gap-3 px-3 py-2">
                                        <span class="text-gray-500 dark:text-gray-400">Remaining Balance</span>
                                        <span class="font-semibold text-right">${formatCurrency(detailBalanceAfter)}</span>
                                    </div>
                                ` : ''}
                                ${item.adminTransactionId ? `
                                    <div class="flex justify-between gap-3 px-3 py-2">
                                        <span class="text-gray-500 dark:text-gray-400">Processed By</span>
                                        <span class="font-semibold text-right inline-flex items-center justify-end gap-1.5">REVIEWS WORLD ${verifiedBadge}</span>
                                    </div>
                                ` : ''}
                                ${extraDetail}
                            </div>

                            <div class="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <p class="text-[10px] text-gray-400 dark:text-gray-500">${dateVerb} on ${dateStr}</p>
                                ${txnDisplayId ? `
                                    <div class="flex items-center gap-2 min-w-0">
                                        <p class="text-[10px] text-gray-400 dark:text-gray-500 truncate">Txn ID: ${txnDisplayId}</p>
                                        <button data-action="copy-text" data-text="${txnDisplayId}" class="text-blue-500 text-[10px] font-bold hover:underline shrink-0">Copy</button>
                                    </div>
                                ` : ''}
                            </div>

                            ${(item.type === 'deposit' || item.orderId || (item.comment || '').toLowerCase().includes('deposit')) && rawStatus !== 'completed' ? `
                                <div class="mt-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center space-y-2">
                                    <p class="text-xs font-bold text-emerald-800 dark:text-emerald-300">Payment Unverified or Pending?</p>
                                    <button onclick="handleReverifyDeposit('${item.orderId || item.id || item.transactionId}', ${item.amount || 10}, ${item.taxAmount || 0})" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                        <span>🔄 Verify Payment Status</span>
                                    </button>
                                </div>
                            ` : ''}
                        </div>

                        <!-- RW Wallet Watermark Footer -->
                        <div class="mt-3 mb-3 flex flex-col items-center justify-center space-y-1.5 opacity-35 select-none">
                             <div class="flex items-center gap-2 grayscale">
                                <img src="https://i.ibb.co/x8YBYwGG/6233389803554672153.jpg" class="w-6 h-6 rounded-full" alt="RW">
                                <span class="text-[10px] font-black tracking-widest uppercase">RW WALLET SECURE</span>
                             </div>
                             <div class="flex items-center gap-4 grayscale opacity-70">
                                <span class="text-[8px] font-bold">REVIEWS WORLD</span>
                                <span class="text-[8px]">|</span>
                                <span class="text-[8px] font-bold">VERIFIED PAYMENT</span>
                             </div>
                         </div>
                    </div>
                </div>`;

            // Render as a full-screen overlay instead of a standard modal.
            const overlay = document.createElement('div');
            overlay.id = 'transaction-overlay';
            overlay.className = 'fixed inset-0 z-[100] bg-gray-50 dark:bg-gray-900';
            overlay.innerHTML = content;
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';

            // Override window.closeModal for this overlay
            const originalCloseModal = window.closeModal;
            window.closeModal = () => {
                overlay.remove();
                document.body.style.overflow = '';
                window.closeModal = originalCloseModal;
            };
        };

const handleUserVerifyDepositUTR = async (orderId) => {
    if (!orderId) return showNotification('Invalid order ID.', true);
    const utrInput = document.getElementById('user-utr-verify-input');
    const utrVal = (utrInput?.value || '').trim();

    if (!utrVal || utrVal.length < 6) {
        return showNotification('Please enter a valid 12-digit UTR / Reference number.', true);
    }

    showLoading();
    try {
        const apiKey = appConfigCache?.fampay_api_key || 'FAM_fbc1b443110a37b5f2f1de5bef365c90defb23c1a38d19c0';
        const verifyUrl = `https://fampay.anujbots.xyz/verify.php?order_id=${encodeURIComponent(orderId)}&utr=${encodeURIComponent(utrVal)}&api_key=${encodeURIComponent(apiKey)}`;
        const vRes = await fetch(verifyUrl).then(r => r.json()).catch(() => null);

        // Update Firestore deposit record with UTR
        const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
        await setDoc(depositRef, {
            utr: utrVal,
            status: (vRes && (vRes.status === 'success' || vRes.success === true)) ? 'completed' : 'pending_admin_approval',
            updatedAt: serverTimestamp()
        }, { merge: true }).catch(() => {});

        if (vRes && (vRes.status === 'success' || vRes.success === true)) {
            const amount = vRes.data?.amount || 10;
            const taxAmount = Math.ceil(amount / 100) * 5;
            const txnId = vRes.data?.transaction_id || `TXN_${orderId}`;
            const senderName = vRes.data?.sender_name || 'UPI User';

            await processSuccessfulDeposit({
                orderId,
                amount,
                taxAmount,
                txnId,
                utr: utrVal,
                senderName
            });
        } else {
            hideLoading();
            showNotification('UTR registered! Admin will verify and credit your wallet shortly.', false, true);
            window.closeModal();
        }
    } catch (err) {
        hideLoading();
        console.warn('Manual UTR verify error:', err);
        showNotification('UTR saved! Admin will verify and credit your wallet.', false, true);
        window.closeModal();
    }
};

window.handleUserVerifyDepositUTR = handleUserVerifyDepositUTR;

// Expose functions to window for global access
window.getHistoryCacheKey = getHistoryCacheKey;
window.getHistoryDataCacheKey = getHistoryDataCacheKey;
window.normalizeHistoryItemForCache = normalizeHistoryItemForCache;
window.reviveHistoryItemFromCache = reviveHistoryItemFromCache;
window.readHistoryItemsFromCache = readHistoryItemsFromCache;
window.writeHistoryItemsToCache = writeHistoryItemsToCache;
window.normalizeTransactionType = normalizeTransactionType;
window.normalizeTransactionForHistory = normalizeTransactionForHistory;
window.getTransactionBalanceEffect = getTransactionBalanceEffect;
window.annotateTransactionsWithRemainingBalance = annotateTransactionsWithRemainingBalance;
window.normalizeCloudTransaction = normalizeCloudTransaction;
window.getTransactionKey = getTransactionKey;
window.mergeTransactionsByKey = mergeTransactionsByKey;
window.normalizePendingRequestForHistory = normalizePendingRequestForHistory;
window.loadFirebaseTransactions = loadFirebaseTransactions;
window.serializeCloudTransaction = serializeCloudTransaction;
window.fetchCloudTransactionHistory = fetchCloudTransactionHistory;
window.importFirestoreTransactionsToCloud = importFirestoreTransactionsToCloud;
window.recordCloudTransaction = recordCloudTransaction;
window.getSafeTransactionDocId = getSafeTransactionDocId;
window.recordUserFirestoreTransaction = recordUserFirestoreTransaction;
window.syncRecentTransactionsToCloud = syncRecentTransactionsToCloud;
window.prefetchTransactionHistory = prefetchTransactionHistory;
window.addInstantTransactionToHistory = addInstantTransactionToHistory;
window.generateTransactionId = generateTransactionId;
window.renderTransactionItem = renderTransactionItem;
window.setBottomNavActive = setBottomNavActive;
window.showPage = showPage;
window.hidePage = hidePage;
window.openSlideMenu = openSlideMenu;
window.closeSlideMenu = closeSlideMenu;
window.showBlockedAccountPage = showBlockedAccountPage;
window.showVerificationPendingPage = showVerificationPendingPage;
window.getPageHeader = getPageHeader;
window.getPageFooter = getPageFooter;
window.showUserTaskHistoryPage = showUserTaskHistoryPage;
window.loadUserTaskHistory = loadUserTaskHistory;
window.renderUserTaskHistory = renderUserTaskHistory;
window.showUserLiveListsPage = showUserLiveListsPage;
window.openFullscreenScreenshotHistory = openFullscreenScreenshotHistory;
window.showHomeMainPage = showHomeMainPage;
window.showReferEarnPage = showReferEarnPage;
window.showTrackReferralsPage = showTrackReferralsPage;
window.showUserTaskPageLegacy = showUserTaskPageLegacy;
window.showUserTaskPage = showUserTaskPage;
window.showTaskFeatureComingSoonPage = showTaskFeatureComingSoonPage;
window.showUserReadNewsTaskPage = showUserReadNewsTaskPage;
window.showUserTaskDetailsPage = showUserTaskDetailsPage;
window.getIncomeTransactions = getIncomeTransactions;
window.showTrackIncomePage = showTrackIncomePage;
window.getLatestTransactionsForBot = getLatestTransactionsForBot;
window.getFilteredTransactions = getFilteredTransactions;
window.renderFilteredTransactions = renderFilteredTransactions;
window.loadMoreTransactionsIfNeeded = loadMoreTransactionsIfNeeded;
window.refreshTransactionHistoryFromFirebase = refreshTransactionHistoryFromFirebase;
window.showAllTransactionsPage = showAllTransactionsPage;
window.showPayToWalletPage = showPayToWalletPage;
let famPayDepositPollTimer = null;
let famPayDepositCountdownTimer = null;
const processedDepositOrders = new Set();

const updateDepositSummary = () => {
    const amountInput = document.getElementById('deposit-amount-input');
    const summaryBox = document.getElementById('deposit-summary-box');
    if (!summaryBox) return;

    const amount = parseFloat(amountInput?.value || 0);
    if (isNaN(amount) || amount <= 0) {
        summaryBox.innerHTML = `
            <div class="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Enter an amount of ₹10 or more to see payment breakdown.</span>
            </div>`;
        return;
    }

    const taxAmount = Math.ceil(amount / 100) * 5;
    const totalPayable = (amount + taxAmount).toFixed(2);

    summaryBox.innerHTML = `
        <div class="space-y-1.5 text-xs">
            <div class="flex justify-between items-center text-gray-600 dark:text-gray-300">
                <span>Deposit Amount</span>
                <span class="font-bold text-gray-900 dark:text-white">₹${amount.toFixed(2)}</span>
            </div>
            <div class="flex justify-between items-center text-gray-500 dark:text-gray-400">
                <span>Processing Fee / Gateway Charge (5%)</span>
                <span class="font-semibold text-gray-700 dark:text-gray-300">+₹${taxAmount.toFixed(2)}</span>
            </div>
            <div class="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center text-sm font-black">
                <span class="text-gray-800 dark:text-gray-100">Total Payable</span>
                <span class="text-emerald-600 dark:text-emerald-400 text-base">₹${totalPayable}</span>
            </div>
            <div class="flex justify-between items-center text-[11px] text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/40 p-2 rounded-lg mt-1 border border-emerald-200 dark:border-emerald-800/50">
                <span>Wallet Credit Amount</span>
                <span>₹${amount.toFixed(2)} (100% credited)</span>
            </div>
        </div>`;
};

const showDepositMoneyPage = () => {
    if (!currentUserData) return showNotification('User data not loaded. Please wait.', true);
    if (currentUserData.isFlagged) {
        return showNotification('Your account is flagged. Please contact support.', true);
    }

    const content = `
        ${getPageHeader('Add Money')}
        <div class="max-w-md mx-auto space-y-4">
            <!-- Top Right Action Bar -->
            <div class="flex justify-between items-center px-1">
                <h3 class="text-lg font-black text-gray-900 dark:text-white">Add Money</h3>
                <button onclick="showAllTransactionsPage()" class="px-3.5 py-1.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-xl font-bold text-xs hover:bg-emerald-200 transition flex items-center gap-1 shadow-xs">
                    <span>Payment History 📜</span>
                </button>
            </div>

            <div class="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/60 space-y-5">
                <!-- Preset Chips -->
                <div>
                    <label class="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 block">Select Amount</label>
                    <div class="grid grid-cols-3 gap-2">
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="10">₹10</button>
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="20">₹20</button>
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="50">₹50</button>
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="100">₹100</button>
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="200">₹200</button>
                        <button type="button" class="deposit-preset-chip px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:bg-emerald-50 hover:border-emerald-500 dark:hover:bg-emerald-900/30 text-center font-bold text-sm transition text-gray-800 dark:text-gray-200 shadow-xs" data-amount="500">₹500</button>
                    </div>
                </div>

                <!-- Custom Amount Input -->
                <div>
                    <label class="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1 block">Deposit Amount (₹)</label>
                    <div class="relative">
                        <span class="absolute inset-y-0 left-0 pl-4 flex items-center text-lg font-bold text-gray-500">₹</span>
                        <input type="number" id="deposit-amount-input" min="10" placeholder="Enter amount (Min ₹10)" value="50" class="w-full pl-9 pr-4 py-3.5 bg-gray-100 dark:bg-gray-700/70 border border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-lg text-gray-900 dark:text-white">
                    </div>
                    <p class="text-[11px] text-gray-400 mt-1">Minimum deposit amount is ₹10.</p>
                </div>

                <!-- Real-time Tax Summary Box -->
                <div id="deposit-summary-box" class="space-y-2 bg-slate-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-xs">
                </div>

                <!-- Action CTA -->
                <button id="proceed-deposit-btn" class="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-emerald-500/25 transition-all flex items-center justify-center gap-2">
                    <span>Make Payment</span>
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
            </div>

            <!-- Recent Deposits / Verification Status List -->
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700/60 space-y-3">
                <div class="flex items-center justify-between">
                    <h4 class="text-xs font-black uppercase text-gray-400 dark:text-gray-500 tracking-wider">Recent UPI Deposits</h4>
                    <button onclick="loadUserRecentDepositsList()" class="text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">🔄 Refresh</button>
                </div>
                <div id="user-recent-deposits-list" class="space-y-2 max-h-72 overflow-y-auto">
                    <p class="text-center text-gray-400 py-3 text-xs">Loading deposits...</p>
                </div>
            </div>
        </div>
        ${getPageFooter()}`;
    showPage(content);

    const amountInput = document.getElementById('deposit-amount-input');
    document.querySelectorAll('.deposit-preset-chip').forEach(btn => {
        btn.onclick = () => {
            if (amountInput) {
                amountInput.value = btn.dataset.amount;
                updateDepositSummary();
            }
        };
    });
    if (amountInput) {
        amountInput.oninput = updateDepositSummary;
    }
    updateDepositSummary();

    const proceedBtn = document.getElementById('proceed-deposit-btn');
    if (proceedBtn) {
        proceedBtn.onclick = handleGenerateDepositQR;
    }

    loadUserRecentDepositsList();
};

const loadUserRecentDepositsList = async () => {
    const listEl = document.getElementById('user-recent-deposits-list');
    if (!listEl || !currentUser?.uid) return;

    try {
        const depositsRef = collection(db, `artifacts/${appId}/public/data/deposits`);
        const snap = await getDocs(query(depositsRef, where("userId", "==", currentUser.uid), firestoreLimit(50))).catch(() => null);
        let items = snap && !snap.empty ? snap.docs.map(d => ({ id: d.id, ...d.data() })) : [];

        if (items.length === 0 && currentUser.email) {
            const snapEmail = await getDocs(query(depositsRef, where("userEmail", "==", currentUser.email), firestoreLimit(50))).catch(() => null);
            if (snapEmail && !snapEmail.empty) {
                items = snapEmail.docs.map(d => ({ id: d.id, ...d.data() }));
            }
        }

        items.sort((a, b) => {
            const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (new Date(a.createdAt || a.timestamp || 0).getTime() || 0);
            const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (new Date(b.createdAt || b.timestamp || 0).getTime() || 0);
            return timeB - timeA;
        });

        if (items.length === 0) {
            listEl.innerHTML = `<p class="text-center text-gray-400 py-3 font-medium">No recent UPI deposits found.</p>`;
            return;
        }

        listEl.innerHTML = items.slice(0, 15).map(item => {
            const isSuccess = item.status === 'completed';
            const isPendingAdmin = item.status === 'pending_admin_approval';
            const statusBg = isSuccess
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                : isPendingAdmin
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200';

            const statusText = isSuccess
                ? '✅ Completed'
                : isPendingAdmin
                    ? '⏳ Admin Verification'
                    : '❌ Failed / Pending';

            const dateStr = formatDate(item.createdAt || item.timestamp);

            return `
                <div class="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 space-y-2">
                    <div class="flex justify-between items-start">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-gray-900 dark:text-white text-sm">₹${(item.amount || 0).toFixed(2)}</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${statusBg}">${statusText}</span>
                            </div>
                            <p class="text-[10px] text-gray-500 font-mono mt-0.5">Order ID: ${item.orderId || item.id}</p>
                            ${item.utr ? `<p class="text-[10px] text-gray-500 font-mono">UTR: ${escapeHtml(item.utr)}</p>` : ''}
                            <p class="text-[10px] text-gray-400 mt-0.5">${dateStr}</p>
                        </div>
                        <div class="text-right">
                            <span class="text-xs font-bold text-emerald-600 dark:text-emerald-400">+₹${(item.amount || 0).toFixed(2)}</span>
                            <p class="text-[10px] text-gray-400">+Tax ₹${(item.taxAmount || 0).toFixed(2)}</p>
                        </div>
                    </div>

                    ${!isSuccess ? `
                        <div class="pt-2 border-t border-gray-200 dark:border-gray-600 flex gap-2 justify-end">
                            <button onclick="handleReverifyDeposit('${item.orderId || item.id}', ${item.amount || 10}, ${item.taxAmount || 0})" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm flex items-center gap-1 transition">
                                <span>🔄 Verify Payment</span>
                            </button>
                        </div>
                    ` : ''}
                </div>`;
        }).join('');
    } catch (e) {
        console.warn('Load user recent deposits error:', e);
        listEl.innerHTML = `<p class="text-center text-gray-400 py-3 font-medium">Failed to load recent deposits.</p>`;
    }
};

const markDepositFailed = async ({ orderId, reason }) => {
    if (!orderId) return;
    try {
        const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
        await updateDoc(depositRef, {
            status: 'failed',
            failureReason: reason || 'Expired',
            updatedAt: serverTimestamp()
        }).catch(() => null);
    } catch (e) {
        console.warn('Mark deposit failed error:', e);
    }
};

const handleReverifyDeposit = async (orderId, amount, taxAmount) => {
    if (!orderId) return;

    showLoading();
    try {
        const apiKey = appConfigCache?.fampay_api_key || 'FAM_fbc1b443110a37b5f2f1de5bef365c90defb23c1a38d19c0';
        const verifyUrl = `https://fampay.anujbots.xyz/verify.php?order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
        const vRes = await fetch(verifyUrl).then(r => r.json()).catch(() => null);

        if (vRes && (vRes.status === 'success' || vRes.success === true)) {
            const txnId = vRes.data?.transaction_id || `TXN_${orderId}`;
            const utr = vRes.data?.utr || 'N/A';
            const senderName = vRes.data?.sender_name || 'UPI User';

            await processSuccessfulDeposit({
                orderId,
                amount: Number(amount),
                taxAmount: Number(taxAmount),
                txnId,
                utr,
                senderName
            });
            loadUserRecentDepositsList();
        } else {
            hideLoading();
            const manualUtr = prompt('Automatic detection did not find the payment yet. If you have already paid, enter your 12-digit UPI UTR / Reference number to submit for verification:');
            if (manualUtr && manualUtr.trim().length >= 6) {
                showLoading(true);
                const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
                await updateDoc(depositRef, {
                    utr: manualUtr.trim(),
                    status: 'pending_admin_approval',
                    submittedAt: serverTimestamp()
                }).catch(() => null);
                hideLoading();
                showNotification('✅ UTR submitted! Admin will verify and credit your wallet shortly.');
                loadUserRecentDepositsList();
            } else {
                showNotification('Payment not detected automatically yet. Please ensure payment completed in your UPI app.', true);
            }
        }
    } catch (e) {
        hideLoading();
        console.warn('Reverify error:', e);
        showNotification('Verification check failed.', true);
    }
};

window.handleReverifyDeposit = handleReverifyDeposit;

const handleGenerateDepositQR = async () => {
    const amountInput = document.getElementById('deposit-amount-input');
    const depositAmount = parseFloat(amountInput?.value || 0);

    if (isNaN(depositAmount) || depositAmount < 10) {
        return showNotification('Minimum deposit amount is ₹10.', true);
    }

    const taxAmount = Math.ceil(depositAmount / 100) * 5;
    const totalPayable = (depositAmount + taxAmount).toFixed(2);

    const upiId = appConfigCache?.fampay_upi || '9525182488@fam';
    const apiKey = appConfigCache?.fampay_api_key || 'FAM_fbc1b443110a37b5f2f1de5bef365c90defb23c1a38d19c0';

    showLoading();
    let orderId = '';
    let qrUrl = '';

    try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
        const response = await fetch(`https://anujbots.xyz/api/qr.php?upi=${encodeURIComponent(upiId)}`, {
            signal: controller?.signal
        }).catch(() => null);
        if (timer) clearTimeout(timer);

        if (response && response.ok) {
            const res = await response.json().catch(() => null);
            if (res && (res.status === 'success' || res.data?.order_id)) {
                orderId = res.data.order_id;
                qrUrl = res.data.qr_url;
            }
        }
    } catch (e) {
        console.warn('External QR generation failed, falling back to standard UPI QR:', e);
    }

    if (!orderId) {
        orderId = `DEP_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    }
    if (!qrUrl) {
        const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=RWWallet&am=${totalPayable}&tr=${encodeURIComponent(orderId)}&cu=INR`;
        qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUri)}`;
    }

    try {
        const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
        await setDoc(depositRef, {
            id: orderId,
            orderId,
            userId: currentUser?.uid || 'N/A',
            userName: currentUserData?.name || 'N/A',
            userEmail: currentUserData?.email || 'N/A',
            userMobile: currentUserData?.mobile || 'N/A',
            amount: Number(depositAmount),
            taxAmount: Number(taxAmount),
            totalPayable: parseFloat(totalPayable),
            status: 'pending',
            createdAt: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.warn('Initiated deposit record error:', e);
    }

    hideLoading();

    showFamPayPaymentModal({
        orderId,
        qrUrl,
        depositAmount,
        taxAmount,
        totalPayable,
        upiId,
        apiKey
    });
};

const showFamPayPaymentModal = ({ orderId, qrUrl, depositAmount, taxAmount, totalPayable, upiId, apiKey }) => {
    if (famPayDepositPollTimer) {
        clearInterval(famPayDepositPollTimer);
        famPayDepositPollTimer = null;
    }
    if (famPayDepositCountdownTimer) {
        clearInterval(famPayDepositCountdownTimer);
        famPayDepositCountdownTimer = null;
    }

    const upiDeepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=RWWallet&am=${totalPayable}&tr=${encodeURIComponent(orderId)}&cu=INR`;

    renderModal('UPI Payment',
        `<div class="space-y-3.5 text-center py-1">
            <!-- QR Code Card -->
            <div class="flex flex-col items-center justify-center p-3 bg-white dark:bg-white rounded-2xl shadow-sm border border-gray-200 max-w-[210px] mx-auto">
                <img src="${escapeHtml(qrUrl)}" alt="Scan & Pay QR" class="w-44 h-44 object-contain rounded-lg">
                <p class="text-[11px] text-gray-600 font-bold mt-1.5">Scan QR with any UPI App</p>
            </div>

            <!-- Countdown Timer right under QR -->
            <div class="inline-flex items-center gap-1.5 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800/60 rounded-full px-4 py-1 text-xs text-rose-700 dark:text-rose-300 font-bold">
                <svg class="w-3.5 h-3.5 text-rose-500 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span>Pay Within:</span>
                <span id="fampay-timer-display" class="font-mono text-sm font-black">10:00</span>
            </div>

            <!-- Big Payable Amount -->
            <div class="bg-gray-50 dark:bg-gray-750 border border-gray-200 dark:border-gray-700 rounded-2xl p-2.5">
                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Payable Amount</span>
                <span class="text-2xl font-black text-emerald-600 dark:text-emerald-400">₹${totalPayable}</span>
            </div>

            <!-- Direct Pay via UPI App Deep-link Button -->
            <a href="${upiDeepLink}" class="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                <span>Open UPI App / Pay Now</span>
            </a>

            <!-- Auto-Verifier Status Badge -->
            <div id="fampay-verify-status" class="text-xs text-center font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-2 pt-0.5">
                <div class="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                <span>Auto Verifying Payment...</span>
            </div>

            <!-- Manual UTR Fallback Input Section -->
            <div class="mt-2 pt-2.5 border-t border-gray-200 dark:border-gray-700 text-left space-y-1.5">
                <div class="flex items-center justify-between">
                    <label for="manual-deposit-utr-input" class="text-[11px] font-bold text-gray-700 dark:text-gray-300">
                        Paid? Enter 12-Digit UPI UTR:
                    </label>
                    <span class="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">Instant Verification</span>
                </div>
                <div class="flex gap-1.5">
                    <input type="text" id="manual-deposit-utr-input" placeholder="e.g. 428190283741" maxlength="24" class="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white">
                    <button type="button" id="submit-manual-utr-btn" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shrink-0 transition shadow-sm">
                        Submit UTR
                    </button>
                </div>
                <p class="text-[9px] text-gray-400 dark:text-gray-500">If your UPI payment isn't detected automatically within seconds, enter your 12-digit UTR above.</p>
            </div>
        </div>`,
        `<button id="cancel-deposit-modal-btn" onclick="window.closeModal()" class="w-full py-2.5 text-xs font-bold bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-xl">Close</button>`,
        'max-w-sm'
    );

    let remainingSeconds = 600;

    const updateCountdownDisplay = () => {
        const mins = Math.floor(remainingSeconds / 60);
        const secs = remainingSeconds % 60;
        const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        const timerEl = document.getElementById('fampay-timer-display');
        if (timerEl) {
            timerEl.textContent = timeStr;
        }

        if (remainingSeconds <= 0) {
            if (famPayDepositPollTimer) {
                clearInterval(famPayDepositPollTimer);
                famPayDepositPollTimer = null;
            }
            if (famPayDepositCountdownTimer) {
                clearInterval(famPayDepositCountdownTimer);
                famPayDepositCountdownTimer = null;
            }
            markDepositFailed({ orderId, depositAmount, taxAmount, reason: '10 Minute Payment Window Expired' });
            const statusEl = document.getElementById('fampay-verify-status');
            if (statusEl) {
                statusEl.innerHTML = `<span class="text-rose-500 font-bold">❌ Timer Expired! Order saved in Payment History.</span>`;
            }
        } else {
            remainingSeconds--;
        }
    };

    updateCountdownDisplay();
    famPayDepositCountdownTimer = setInterval(updateCountdownDisplay, 1000);

    const checkVerification = async () => {
        try {
            const verifyUrl = `https://fampay.anujbots.xyz/verify.php?order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
            const vRes = await fetch(verifyUrl).then(r => r.json()).catch(() => null);

            if (vRes && (vRes.status === 'success' || vRes.success === true)) {
                if (famPayDepositPollTimer) {
                    clearInterval(famPayDepositPollTimer);
                    famPayDepositPollTimer = null;
                }
                if (famPayDepositCountdownTimer) {
                    clearInterval(famPayDepositCountdownTimer);
                    famPayDepositCountdownTimer = null;
                }
                const txnId = vRes.data?.transaction_id || `TXN_${orderId}`;
                const utr = vRes.data?.utr || 'N/A';
                const senderName = vRes.data?.sender_name || 'UPI User';

                await processSuccessfulDeposit({
                    orderId,
                    amount: depositAmount,
                    taxAmount,
                    txnId,
                    utr,
                    senderName
                });
            }
        } catch (e) {
            console.warn('Auto verifier check skipped:', e);
        }
    };

    famPayDepositPollTimer = setInterval(checkVerification, 2500);
    checkVerification();

    document.getElementById('submit-manual-utr-btn')?.addEventListener('click', async () => {
        const utrInput = document.getElementById('manual-deposit-utr-input');
        const utrVal = utrInput?.value?.trim();
        if (!utrVal || utrVal.length < 6) {
            return showNotification('Please enter a valid 12-digit UPI UTR number.', true);
        }

        showLoading(true);
        try {
            const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
            await updateDoc(depositRef, {
                utr: utrVal,
                status: 'pending_admin_approval',
                submittedAt: serverTimestamp()
            }).catch(() => null);

            if (famPayDepositPollTimer) {
                clearInterval(famPayDepositPollTimer);
                famPayDepositPollTimer = null;
            }
            if (famPayDepositCountdownTimer) {
                clearInterval(famPayDepositCountdownTimer);
                famPayDepositCountdownTimer = null;
            }

            hideLoading();
            window.closeModal();
            showNotification('✅ UTR submitted! Admin will verify and credit your wallet shortly.');
            loadUserRecentDepositsList();
        } catch (err) {
            hideLoading();
            console.error('Submit manual UTR error:', err);
            showNotification('Failed to submit UTR. Please try again.', true);
        }
    });

    document.getElementById('cancel-deposit-modal-btn')?.addEventListener('click', () => {
        if (famPayDepositPollTimer) clearInterval(famPayDepositPollTimer);
        if (famPayDepositCountdownTimer) clearInterval(famPayDepositCountdownTimer);
        window.closeModal();
    });
};

const processSuccessfulDeposit = async ({ orderId, amount, taxAmount, txnId, utr, senderName }) => {
    if (processedDepositOrders.has(orderId) || processedDepositOrders.has(txnId)) {
        showNotification('Payment already credited to your wallet.', true);
        window.closeModal();
        return;
    }
    processedDepositOrders.add(orderId);
    processedDepositOrders.add(txnId);

    try {
        showLoading(true);
        const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);

        await runTransaction(db, async (tx) => {
            const userDoc = await tx.get(userRef);
            if (!userDoc.exists()) throw new Error('User record not found.');

            const currentBal = Number(userDoc.data().balance || 0);
            const newBal = currentBal + Number(amount);

            tx.update(userRef, { balance: newBal });

            const txRef = doc(userRef, 'transactions', `dep_${orderId}`);
            tx.set(txRef, {
                type: 'deposit',
                amount: Number(amount),
                taxAmount: Number(taxAmount || 0),
                totalPayable: Number(amount) + Number(taxAmount || 0),
                balanceBefore: currentBal,
                balanceAfter: newBal,
                comment: `Deposit via UPI (UTR: ${utr})`,
                orderId,
                transactionId: txnId,
                utr,
                senderName,
                status: 'completed',
                timestamp: serverTimestamp()
            });
        });

        // Also update global deposit record for Admin view
        try {
            const depositRef = doc(db, `artifacts/${appId}/public/data/deposits`, orderId);
            await setDoc(depositRef, {
                id: orderId,
                orderId,
                userId: currentUser?.uid || 'N/A',
                userName: currentUserData?.name || 'N/A',
                userEmail: currentUserData?.email || 'N/A',
                userMobile: currentUserData?.mobile || 'N/A',
                amount: Number(amount),
                taxAmount: Number(taxAmount || 0),
                totalPayable: Number(amount) + Number(taxAmount || 0),
                transactionId: txnId,
                utr,
                senderName,
                status: 'completed',
                completedAt: serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.warn('Global deposit record update error:', e);
        }

        hideLoading();
        window.closeModal();
        showNotification(`✅ Payment Successful! ₹${amount} credited to your wallet.`, false, true);

        if (typeof window.notifyWalletBalanceChange === 'function') {
            window.notifyWalletBalanceChange(currentUser.uid, 'credit', amount, `UPI Deposit (UTR: ${utr})`);
        }
        if (typeof currentUserData === 'object' && currentUserData) {
            currentUserData.balance = (currentUserData.balance || 0) + Number(amount);
            const userBalEl = document.getElementById('user-balance');
            if (userBalEl) userBalEl.textContent = formatCurrency(currentUserData.balance);
        }
        hidePage();
    } catch (e) {
        hideLoading();
        console.error('Process Deposit Error:', e);
        showNotification(e.message || 'Failed to update wallet balance.', true);
    }
};

window.showDepositMoneyPage = showDepositMoneyPage;
window.showTransactionDetails = showTransactionDetails;


