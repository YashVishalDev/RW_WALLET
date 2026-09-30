// File: src/pages/admin/admin-chats.js

const updateAdminChatUnreadBadges = () => {
            const badge = document.getElementById('admin-chat-unread-badge');
            if (!badge) return;
            badge.textContent = adminChatUnreadCount > 99 ? '99+' : String(adminChatUnreadCount || '');
            badge.classList.toggle('hidden', adminChatUnreadCount <= 0);
        };

const calculateAdminChatUnreadCount = (chats = allSupportChatsCache) => chats.filter(chat => {
            const roomId = chat.roomId || chat.room_id || getSupportRoomId(chat.userId || chat.id);
            const lastSenderId = chat.lastSenderId || chat.last_sender_id || '';
            const updatedAt = timestampToMillis(chat.updatedAt || chat.updated_at);
            const seenAt = Number(localStorage.getItem(getAdminSupportChatSeenKey(roomId)) || 0);
            return lastSenderId && lastSenderId !== currentUser?.uid && updatedAt > seenAt;
        }).length;

const refreshAdminChatUnreadCount = () => {
            adminChatUnreadCount = calculateAdminChatUnreadCount();
            updateAdminChatUnreadBadges();
        };

const preloadAdminChatRooms = (chats = allSupportChatsCache) => {
            if (!hasAdminSessionReadyOrCached()) return;
            chats.slice(0, 25).forEach(chat => {
                const roomId = chat.roomId || getSupportRoomId(chat.userId || chat.id);
                if (!roomId) return;
                const cached = readSupportChatCache(roomId);
                fetchSupportChatHistory(roomId, 120)
                    .then(history => {
                        const merged = mergeSupportMessages(cached, history);
                        writeSupportChatCache(roomId, merged);
                        refreshAdminChatUnreadCount();
                    })
                    .catch(error => console.warn('Admin chat room preload skipped:', error));
            });
        };

const subscribeAdminChatRooms = async (chats = allSupportChatsCache) => {
            if (!hasAdminSessionReadyOrCached()) return;
            const socket = await getSupportSocket();

            const handleAdminBackgroundRead = (data) => {
                if (!data || !data.roomId) return;
                localStorage.setItem(getAdminSupportChatSeenKey(data.roomId), String(Date.now()));
                refreshAdminChatUnreadCount();
                renderAdminChatsList();
            };

            if (adminChatBackgroundHandlers) {
                socket.off('new_message', adminChatBackgroundHandlers.message);
                socket.off('chat_read', adminChatBackgroundHandlers.read);
            }

            const updateRoomFromMessage = (message) => {
                const normalized = normalizeBackendMessage(message);
                if (!normalized.roomId) return;
                const userId = normalized.roomId.replace(/^support_/, '');
                const isActiveRoomOpen = activeSupportRoomId === normalized.roomId && document.getElementById('support-chat-messages');
                const cachedMessages = mergeSupportMessages(readSupportChatCache(normalized.roomId), [normalized]);
                writeSupportChatCache(normalized.roomId, cachedMessages);

                if (isActiveRoomOpen) {
                    activeSupportMessages = mergeSupportMessages(activeSupportMessages, [normalized]);
                    renderSupportMessages(activeSupportMessages, 'admin');
                    const msgListContainer = document.getElementById('support-chat-messages');
                    if (msgListContainer) {
                        msgListContainer.scrollTop = msgListContainer.scrollHeight;
                    }
                }

                const isOwner = checkIsOwner(currentUser, currentUserData);
                if (isOwner) {
                    const parts = normalized.roomId.replace(/^support_/, '').split('_');
                    if (parts.length > 1 && parts[1] !== ADMIN_UID) {
                        return;
                    }
                    const cleanUid = parts[0];
                    const u = allUsersCache.find(user => String(user.id || user.uid) === String(cleanUid));
                    if (u && (u.role !== 'admin' && u.role !== 'subadmin' && u.role !== 'owner')) {
                        const pAdmin = String(u.parentAdmin || u.parent_admin || '').trim();
                        if (pAdmin && pAdmin !== ADMIN_UID && pAdmin !== 'null' && pAdmin !== 'undefined') {
                            return;
                        }
                    }
                }

                const existingIndex = allSupportChatsCache.findIndex(chat => (chat.roomId || getSupportRoomId(chat.userId || chat.id)) === normalized.roomId);
                const existing = existingIndex >= 0 ? allSupportChatsCache[existingIndex] : {};
                const userProfile = allUsersCache.find(user => (user.id || user.uid) === userId) || {};
                const chatName = existing.userName || userProfile.name || 'User';
                const chatEmail = existing.userEmail || userProfile.email || '';
                const updatedChat = {
                    ...existing,
                    id: existing.id || userId,
                    userId: existing.userId || userId,
                    roomId: normalized.roomId,
                    userName: chatName,
                    userEmail: chatEmail,
                    userMobile: existing.userMobile || getUserMobileValue(userProfile) || '',
                    userAvatar: resolveChatUserAvatar({ userId, userName: chatName, userEmail: chatEmail, userAvatar: existing.userAvatar || userProfile.profilePhoto || userProfile.avatarUrl }),
                    lastMessage: normalized.text,
                    lastSenderId: normalized.senderId,
                    updatedAt: timestampToMillis(normalized.createdAt) || Date.now()
                };

                if (existingIndex >= 0) {
                    allSupportChatsCache[existingIndex] = updatedChat;
                } else {
                    allSupportChatsCache.unshift(updatedChat);
                }
                allSupportChatsCache.sort((a, b) => timestampToMillis(b.updatedAt || b.updated_at) - timestampToMillis(a.updatedAt || a.updated_at));
                if (!isActiveRoomOpen) refreshAdminChatUnreadCount();
                renderAdminChatsList();
            };

            adminChatBackgroundHandlers = { message: updateRoomFromMessage, read: handleAdminBackgroundRead };
            socket.on('new_message', updateRoomFromMessage);
            socket.on('chat_read', handleAdminBackgroundRead);

            chats.slice(0, 200).forEach(chat => {
                const roomId = chat.roomId || getSupportRoomId(chat.userId || chat.id);
                if (!roomId || adminChatSubscribedRooms.has(roomId)) return;
                adminChatSubscribedRooms.add(roomId);
                socket.emit('join_room', { roomId, limit: 1, markRead: false });
            });
        };

const getOwnerProfile = () => {
    const ownerUser = (typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache))
        ? allUsersCache.find(u => 
            u.id === ADMIN_UID || u.uid === ADMIN_UID || 
            u.email === 'reviewsworld51@gmail.com' || u.email === 'reviewsworld01@gmail.com' || 
            u.role === 'owner'
        )
        : null;
    return {
        id: ADMIN_UID,
        userId: ADMIN_UID,
        userName: ownerUser?.name || ownerUser?.displayName || 'REVIEWS WORLD',
        userEmail: ownerUser?.email || 'reviewsworld01@gmail.com',
        userMobile: ownerUser?.mobile || ownerUser?.phoneNumber || '',
        userAvatar: ownerUser?.profilePhoto || ownerUser?.profile_photo || ownerUser?.avatarUrl || ownerUser?.avatar_url || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    };
};

const populateFallbackAdminChatsFromUsers = () => {
    if (!allUsersCache || !allUsersCache.length) return;
    const isOwner = checkIsOwner(currentUser, currentUserData);
    const subAdminUid = currentUser?.uid || (typeof getCurrentUserId === 'function' ? getCurrentUserId() : '');
    
    let userList = allUsersCache;
    if (!isOwner) {
        userList = allUsersCache.filter(u => {
            const uid = String(u.id || u.uid || '');
            if (!uid || uid === subAdminUid || uid === ADMIN_UID) return false;
            return String(u.parentAdmin || u.parent_admin || '') === String(subAdminUid);
        });
    } else {
        userList = allUsersCache.filter(u => {
            const uid = String(u.id || u.uid || '');
            if (!uid || uid === ADMIN_UID) return false;
            if (u.role === 'admin' || u.role === 'subadmin' || u.role === 'owner') return true;
            const pAdmin = String(u.parentAdmin || u.parent_admin || '').trim();
            return !pAdmin || pAdmin === ADMIN_UID || pAdmin === 'null' || pAdmin === 'undefined';
        });
    }

    const fallbackChats = [];
    userList.forEach(u => {
        const uId = String(u.id || u.uid || '');
        const roomId = !isOwner ? `support_${uId}_${subAdminUid}` : `support_${uId}`;
        const cachedMsgs = readSupportChatCache(roomId);
        if (cachedMsgs && cachedMsgs.length > 0) {
            const lastMsgObj = cachedMsgs[cachedMsgs.length - 1];
            if (lastMsgObj && lastMsgObj.text && String(lastMsgObj.text).trim()) {
                fallbackChats.push({
                    id: uId,
                    userId: uId,
                    roomId,
                    userName: isOwner && (u.role === 'admin' || u.role === 'subadmin') ? (u.name || u.email || 'Sub-Admin') : (u.name || u.email || 'User'),
                    userEmail: u.email || '',
                    userMobile: u.mobile || u.phoneNumber || '',
                    userAvatar: resolveChatUserAvatar(u),
                    lastMessage: lastMsgObj.text,
                    lastSenderId: lastMsgObj.senderId || uId,
                    updatedAt: timestampToMillis(lastMsgObj.createdAt) || Date.now()
                });
            }
        }
    });

    if (fallbackChats.length > 0) {
        const mergedMap = new Map();
        [...allSupportChatsCache, ...fallbackChats].forEach(c => {
            const key = String(c.userId || c.id || '').trim();
            if (!key) return;
            if (c.lastMessage && String(c.lastMessage).trim()) {
                if (!mergedMap.has(key)) mergedMap.set(key, c);
            }
        });
        allSupportChatsCache = Array.from(mergedMap.values()).sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
        refreshAdminChatUnreadCount();
        renderAdminChatsList();
    }
};

const missingChatAvatarsQueue = new Set();
let isFetchingMissingChatAvatars = false;

const resolveChatUserAvatar = (chat = {}) => {
    const userId = chat.userId || chat.id || chat.uid || '';
    const isOwnerChat = userId === ADMIN_UID || chat.id === ADMIN_UID || (chat.roomId && chat.roomId.includes(ADMIN_UID));
    if (isOwnerChat) {
        return getOwnerProfile()?.userAvatar || RW_LOGO_URL;
    }

    const userName = chat.userName || chat.name || '';
    const userEmail = chat.userEmail || chat.email || '';

    const callAvatarFn = (userObj) => {
        try {
            if (typeof window !== 'undefined' && typeof window.getProfileAvatarUrl === 'function') {
                const res = window.getProfileAvatarUrl(userObj);
                if (res && typeof res === 'string' && !res.includes('3135715.png')) return res;
            }
        } catch (_) {}
        return null;
    };

    // 1. Direct explicit avatar if valid (and NOT 3135715.png)
    const explicit = chat.userAvatar || chat.avatarUrl || chat.avatar_url || chat.profilePhoto || chat.profile_photo;
    if (explicit && typeof explicit === 'string' && explicit.startsWith('http') && !explicit.includes('3135715.png')) {
        return explicit;
    }

    // 2. Look in allUsersCache
    const userDoc = (typeof allUsersCache !== 'undefined' && Array.isArray(allUsersCache))
        ? allUsersCache.find(u => String(u.id || u.uid) === String(userId) || (userEmail && u.email === userEmail))
        : null;

    if (userDoc) {
        const docPic = userDoc.profilePhoto || userDoc.profile_photo || userDoc.avatarUrl || userDoc.avatar_url || userDoc.photoURL;
        if (docPic && typeof docPic === 'string' && docPic.startsWith('http') && !docPic.includes('3135715.png')) {
            return docPic;
        }
        const url = callAvatarFn(userDoc);
        if (url) return url;
    }

    // 3. Look in localStorage cached user doc
    if (typeof readJsonCache === 'function') {
        const cachedUser = readJsonCache(`rw_wallet_user_cache_${userId}`);
        if (cachedUser) {
            const cachedPic = cachedUser.profilePhoto || cachedUser.profile_photo || cachedUser.avatarUrl || cachedUser.avatar_url || cachedUser.photoURL;
            if (cachedPic && typeof cachedPic === 'string' && cachedPic.startsWith('http') && !cachedPic.includes('3135715.png')) {
                return cachedPic;
            }
            const url = callAvatarFn(cachedUser);
            if (url) return url;
        }
    }

    // 4. Look in local avatar key
    try {
        const localAvatar = localStorage.getItem(`rw_profile_avatar_${userId}`);
        if (localAvatar && !localAvatar.includes('3135715.png')) return localAvatar;
    } catch (_) {}

    // 5. Use getProfileAvatarUrl fallback based on name/gender
    const nameUrl = callAvatarFn({
        uid: userId,
        id: userId,
        name: userName,
        email: userEmail
    });
    if (nameUrl) return nameUrl;

    // 6. Direct fallback from window.PREMIUM_AVATARS or UI Avatars (NEVER return 3135715.png)
    const avatars = (typeof window !== 'undefined' && Array.isArray(window.PREMIUM_AVATARS) && window.PREMIUM_AVATARS.length >= 10)
        ? window.PREMIUM_AVATARS
        : [
            'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80',
            'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150&h=150&q=80'
        ];

    const cleanName = String(userName || userEmail || userId || 'User').toLowerCase().trim();
    const femaleKeywords = [
        'devi', 'kumari', 'lata', 'seema', 'anita', 'sunita', 'kiran', 'pooja', 'priya', 'neha', 'divya',
        'kajal', 'jyoti', 'kavita', 'preeti', 'ritu', 'swati', 'sneha', 'alka', 'usha', 'shanti', 'meena',
        'sushma', 'rekha', 'pinky', 'monika', 'payal', 'asha', 'babita', 'radha', 'sharda', 'mamta', 'sapna',
        'isha', 'tanya', 'riya', 'ananya', 'rashmi', 'shruti', 'komal', 'arti', 'renu', 'savita', 'geeta',
        'sita', 'gita', 'anamika', 'archana', 'disha', 'megha', 'nisha', 'prerna', 'richa', 'shweta', 'sheetal',
        'sakshi', 'simran', 'tanvi', 'vaishali', 'varsha', 'yashaswi', 'girl', 'female', 'woman', 'lady', 'aasiya', 'afroj'
    ];
    const isFemale = femaleKeywords.some(kw => cleanName.includes(kw)) ||
                     cleanName.endsWith('a') || cleanName.endsWith('i') || cleanName.endsWith('ee') || cleanName.endsWith('ya') || cleanName.endsWith('y');

    const charSum = [...cleanName].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    if (isFemale) {
        const pool = avatars.slice(5, 10);
        return pool[charSum % pool.length];
    } else {
        const pool = avatars.slice(0, 5);
        return pool[charSum % pool.length];
    }
};

const fetchMissingChatAvatars = async (chats = []) => {
    if (isFetchingMissingChatAvatars || !Array.isArray(chats)) return;
    const missingIds = [];
    chats.forEach(chat => {
        const uid = chat.userId || chat.id || chat.uid;
        if (!uid || uid === ADMIN_UID || missingChatAvatarsQueue.has(uid)) return;
        const inCache = Array.isArray(allUsersCache) && allUsersCache.some(u => String(u.id || u.uid) === String(uid));
        if (!inCache) {
            missingIds.push(uid);
            missingChatAvatarsQueue.add(uid);
        }
    });

    if (missingIds.length === 0) return;
    isFetchingMissingChatAvatars = true;

    try {
        let addedAny = false;
        const chunks = [];
        for (let i = 0; i < missingIds.length; i += 10) {
            chunks.push(missingIds.slice(i, i + 10));
        }

        for (const chunk of chunks) {
            const promises = chunk.map(id => getDoc(doc(db, `artifacts/${appId}/public/data/users`, id)).catch(() => null));
            const results = await Promise.all(promises);
            results.forEach((snap) => {
                if (snap && snap.exists()) {
                    const data = { id: snap.id, uid: snap.id, ...snap.data() };
                    if (Array.isArray(allUsersCache)) {
                        allUsersCache.push(data);
                    }
                    if (typeof writeJsonCache === 'function') {
                        writeJsonCache(`rw_wallet_user_cache_${snap.id}`, data);
                    }
                    addedAny = true;
                }
            });
        }

        if (addedAny) {
            if (Array.isArray(allSupportChatsCache)) {
                allSupportChatsCache.forEach(c => {
                    c.userAvatar = resolveChatUserAvatar(c);
                });
            }
            if (document.getElementById('admin-chats-list')) {
                renderAdminChatsList();
            }
        }
    } catch (e) {
        console.warn('Fetch missing chat avatars failed:', e);
    } finally {
        isFetchingMissingChatAvatars = false;
    }
};

const loadAdminChatsFromBackend = async (options = {}) => {
            const { silent = false, retry = true, subscribeRealtime = true } = options || {};
            if (!hasAdminSessionReadyOrCached()) return;
            await ensureAdminChatUsersLoaded();
            populateFallbackAdminChatsFromUsers();
            try {
                const token = await getBackendAuthToken();
                const response = await fetchWithTimeout(`${BACKEND_BASE_URL}/api/admin/chats?limit=200`, {
                    headers: { Authorization: `Bearer ${token}` }
                }, 15000);
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.ok) {
                    throw new Error(data.error || 'Admin chat load failed');
                }
                let chatList = (data.chats || []).map(chat => {
                    const rawCleanId = (chat.room_id || '').replace(/^support_/, '');
                    const cleanUserId = chat.user_id && !chat.user_id.includes('_') ? chat.user_id : (rawCleanId.split('_')[0] || rawCleanId);
                    const userProfile = allUsersCache.find(u => String(u.id || u.uid) === String(cleanUserId)) || {};
                    const chatName = chat.user_name || userProfile.name || 'User';
                    const chatEmail = chat.user_email || userProfile.email || '';
                    const chatMobile = chat.user_mobile || getUserMobileValue(userProfile) || '';
                    return {
                        id: cleanUserId,
                        userId: cleanUserId,
                        roomId: chat.room_id || getSupportRoomId(cleanUserId),
                        userName: chatName,
                        userEmail: chatEmail,
                        userMobile: chatMobile,
                        userAvatar: resolveChatUserAvatar({ userId: cleanUserId, userName: chatName, userEmail: chatEmail, userAvatar: chat.user_avatar || userProfile.profilePhoto || userProfile.avatarUrl }),
                        lastMessage: chat.last_message || 'Tap to view chat history',
                        lastSenderId: chat.last_sender_id || '',
                        updatedAt: chat.updated_at || Date.now()
                    };
                });
                const isOwner = checkIsOwner(currentUser, currentUserData);
                const subAdminUid = currentUser?.uid || (typeof getCurrentUserId === 'function' ? getCurrentUserId() : '');
                if (!isOwner) {
                    chatList = chatList.filter(chat => {
                        const cUserId = chat.userId || chat.id;
                        if (!cUserId || cUserId === subAdminUid || cUserId === ADMIN_UID) return false;
                        const u = allUsersCache.find(user => String(user.id || user.uid) === String(cUserId));
                        if (u) {
                            return String(u.parentAdmin || u.parent_admin || '') === String(subAdminUid);
                        }
                        return chat.roomId === `support_${cUserId}_${subAdminUid}`;
                    });
                } else {
                    // Owner ONLY sees direct Owner chats (support_USERID) and Sub-Admins themselves.
                    // EXCLUDE any user assigned to a Sub-Admin (parentAdmin != ADMIN_UID) and EXCLUDE sub-admin private rooms (support_USERID_SUBADMINID).
                    chatList = chatList.filter(chat => {
                        const cUserId = chat.userId || chat.id;
                        if (!cUserId || cUserId === ADMIN_UID) return false;

                        const parts = String(chat.roomId || '').replace(/^support_/, '').split('_');
                        if (parts.length > 1 && parts[1] !== ADMIN_UID) {
                            return false;
                        }

                        const u = allUsersCache.find(user => String(user.id || user.uid) === String(cUserId));
                        if (u) {
                            if (u.role === 'admin' || u.role === 'subadmin' || u.role === 'owner') return true;
                            const pAdmin = String(u.parentAdmin || u.parent_admin || '').trim();
                            if (pAdmin && pAdmin !== ADMIN_UID && pAdmin !== 'null' && pAdmin !== 'undefined') {
                                return false;
                            }
                        }

                        return true;
                    });
                }

                // Strictly deduplicate by userId so exactly ONE card is shown per user
                const uniqueChatsMap = new Map();
                chatList.forEach(chat => {
                    const key = String(chat.userId || chat.id || '').trim();
                    if (!key) return;
                    const existing = uniqueChatsMap.get(key);
                    const chatTime = timestampToMillis(chat.updatedAt);
                    const existingTime = existing ? timestampToMillis(existing.updatedAt) : 0;
                    if (!existing || chatTime > existingTime) {
                        uniqueChatsMap.set(key, chat);
                    }
                });
                chatList = Array.from(uniqueChatsMap.values()).sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));

                if (chatList.length > 0) {
                    allSupportChatsCache = chatList;
                    fetchMissingChatAvatars(chatList);
                } else {
                    populateFallbackAdminChatsFromUsers();
                }
                refreshAdminChatUnreadCount();
                renderAdminChatsList();
                preloadAdminChatRooms(allSupportChatsCache);
                if (subscribeRealtime) {
                    subscribeAdminChatRooms(allSupportChatsCache).catch(error => logBackgroundSkip('Admin chat socket subscribe skipped', error));
                }
            } catch (error) {
                logBackgroundSkip('Admin chat list background fetch skipped', error);
                populateFallbackAdminChatsFromUsers();
                if (retry) {
                    setTimeout(() => loadAdminChatsFromBackend({ silent: true, retry: false, subscribeRealtime }).catch(() => {}), 3000);
                }
            }
        };

const getAdminChatUserMeta = (user = {}) => {
            const isMainOwner = user.id === ADMIN_UID || user.uid === ADMIN_UID || user.email === 'reviewsworld51@gmail.com' || user.email === 'reviewsworld01@gmail.com' || user.role === 'owner';
            const ownerProfile = isMainOwner ? getOwnerProfile() : null;
            return {
                id: user.id || user.uid || '',
                userId: user.id || user.uid || '',
                userName: isMainOwner ? ownerProfile.userName : (user.name || user.fullName || user.displayName || user.email || 'User'),
                userEmail: isMainOwner ? ownerProfile.userEmail : (user.email || ''),
                userMobile: isMainOwner ? ownerProfile.userMobile : (user.mobile || user.phoneNumber || user.phone || ''),
                userAvatar: isMainOwner ? ownerProfile.userAvatar : resolveChatUserAvatar(user)
            };
        };

const ensureAdminChatUsersLoaded = async (forceRefresh = false) => {
            if (!hasAdminSessionReadyOrCached()) return;

            if (!forceRefresh && allUsersCache.length > 0) {
                return;
            }

            try {
                const usersSnap = await getDocs(query(collection(db, `artifacts/${appId}/public/data/users`)));
                allUsersCache = usersSnap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
            } catch (error) {
                console.warn('Admin chat user search load failed:', error);
            }
        };

const renderAdminChatsList = () => {
            const list = document.getElementById('admin-chats-list');
            if (!list) return;
            const searchTerm = (document.getElementById('admin-chat-search')?.value || '').trim().toLowerCase();
            const isOwner = checkIsOwner(currentUser, currentUserData);
            const subAdminUid = currentUser?.uid || (typeof getCurrentUserId === 'function' ? getCurrentUserId() : '');
            
            let chatsToRender = [...allSupportChatsCache];
            if (searchTerm) {
                chatsToRender = chatsToRender.filter(chat => [
                    chat.userName,
                    chat.userEmail,
                    chat.userMobile,
                    chat.lastMessage
                ].some(value => String(value || '').toLowerCase().includes(searchTerm)));
            }

            if (!isOwner) {
                chatsToRender = chatsToRender.filter(chat => {
                    const cUserId = chat.userId || chat.id;
                    if (!cUserId || cUserId === subAdminUid || cUserId === ADMIN_UID) return false;
                    const u = allUsersCache.find(user => String(user.id || user.uid) === String(cUserId));
                    if (u) {
                        return String(u.parentAdmin || u.parent_admin || '') === String(subAdminUid);
                    }
                    return chat.roomId === `support_${cUserId}_${subAdminUid}`;
                });
            } else {
                // Owner ONLY sees direct Owner chats (support_USERID) and Sub-Admins themselves.
                // EXCLUDE any user assigned to a Sub-Admin (parentAdmin != ADMIN_UID) and EXCLUDE sub-admin private rooms (support_USERID_SUBADMINID).
                chatsToRender = chatsToRender.filter(chat => {
                    const cUserId = chat.userId || chat.id;
                    if (!cUserId || cUserId === ADMIN_UID) return false;

                    const parts = String(chat.roomId || '').replace(/^support_/, '').split('_');
                    if (parts.length > 1 && parts[1] !== ADMIN_UID) {
                        return false;
                    }

                    const u = allUsersCache.find(user => String(user.id || user.uid) === String(cUserId));
                    if (u) {
                        if (u.role === 'admin' || u.role === 'subadmin' || u.role === 'owner') return true;
                        const pAdmin = String(u.parentAdmin || u.parent_admin || '').trim();
                        if (pAdmin && pAdmin !== ADMIN_UID && pAdmin !== 'null' && pAdmin !== 'undefined') {
                            return false;
                        }
                    }

                    return true;
                });
            }

            // Deduplicate chatsToRender by userId
            const uniqueRenderMap = new Map();
            chatsToRender.forEach(chat => {
                const key = String(chat.userId || chat.id || '').trim();
                if (!key) return;
                const existing = uniqueRenderMap.get(key);
                const chatTime = timestampToMillis(chat.updatedAt);
                const existingTime = existing ? timestampToMillis(existing.updatedAt) : 0;
                if (!existing || chatTime > existingTime) {
                    uniqueRenderMap.set(key, chat);
                }
            });
            chatsToRender = Array.from(uniqueRenderMap.values()).sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));

            let baseUsersForSearch = [...allUsersCache];
            if (!isOwner) {
                baseUsersForSearch = baseUsersForSearch.filter(u => 
                    String(u.parentAdmin || u.parent_admin || '') === String(subAdminUid) &&
                    u.id !== subAdminUid && u.uid !== subAdminUid && u.id !== ADMIN_UID && u.uid !== ADMIN_UID && u.role !== 'admin' && u.role !== 'subadmin' && u.role !== 'owner'
                );
            } else {
                baseUsersForSearch = baseUsersForSearch.filter(u => {
                    if (u.id === ADMIN_UID || u.uid === ADMIN_UID) return false;
                    if (u.role === 'admin' || u.role === 'subadmin' || u.role === 'owner') return true;
                    const pAdmin = String(u.parentAdmin || u.parent_admin || '').trim();
                    return !pAdmin || pAdmin === ADMIN_UID || pAdmin === 'null' || pAdmin === 'undefined';
                });
            }

            const existingChatUserIds = new Set(allSupportChatsCache.map(chat => String(chat.userId || chat.id || '')));

            const usersToStartChat = searchTerm
                ? baseUsersForSearch
                    .filter(u => !existingChatUserIds.has(String(u.id || u.uid || '')))
                    .map(getAdminChatUserMeta)
                    .filter(user => [
                        user.userName,
                        user.userEmail,
                        user.userMobile
                    ].some(value => String(value || '').toLowerCase().includes(searchTerm)))
                : [];

            const chatRows = chatsToRender.map(chat => {
                    const isOwnerChat = chat.userId === ADMIN_UID || chat.id === ADMIN_UID || chat.roomId?.includes(ADMIN_UID);
                    const ownerProfile = isOwnerChat ? getOwnerProfile() : null;
                    const displayName = isOwnerChat && !isOwner ? ownerProfile.userName : (chat.userName || 'User');
                    const avatarUrl = isOwnerChat && !isOwner ? ownerProfile.userAvatar : resolveChatUserAvatar(chat);

                    const roomId = chat.roomId || chat.room_id || getSupportRoomId(chat.userId || chat.id);
                    const lastSenderId = chat.lastSenderId || chat.last_sender_id || '';
                    const updatedAt = timestampToMillis(chat.updatedAt || chat.updated_at);
                    const seenAt = Number(localStorage.getItem(getAdminSupportChatSeenKey(roomId)) || 0);
                    const isUnread = lastSenderId && lastSenderId !== currentUser?.uid && updatedAt > seenAt;

                    const prefix = (lastSenderId && lastSenderId === currentUser?.uid) ? 'You: ' : '';
                    const lastMsgText = chat.lastMessage || 'No messages yet';
                    const displayLastMessage = prefix ? `${prefix}${lastMsgText}` : lastMsgText;

                    return `
                    <button data-chat-userid="${chat.userId || chat.id}" data-chat-source="cache" class="admin-chat-row w-full flex items-center gap-3 p-3.5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
                        <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" class="h-11 w-11 rounded-full object-cover shrink-0">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <h3 class="font-bold text-sm truncate">${escapeHtml(displayName)}</h3>
                                <div class="flex flex-col items-end gap-1.5 shrink-0">
                                    <span class="text-[10px] text-gray-400 shrink-0">${formatChatTime(chat.updatedAt)}</span>
                                    ${isUnread ? `<span class="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"></span>` : ''}
                                </div>
                            </div>
                            <p class="text-xs ${isUnread ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-600 dark:text-gray-300'} truncate mt-1">${escapeHtml(displayLastMessage)}</p>
                        </div>
                    </button>`;
                }).join('');

            const userRows = usersToStartChat.map(user => {
                    const avatarUrl = resolveChatUserAvatar(user);
                    return `
                    <button data-chat-userid="${user.userId}" data-chat-source="user-search" class="admin-chat-row w-full flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl shadow-sm text-left hover:bg-blue-100 dark:hover:bg-blue-900/40 transition">
                        <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(user.userName || 'User')}" class="h-12 w-12 rounded-full object-cover shrink-0">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <h3 class="font-bold truncate">${escapeHtml(user.userName || 'User')}</h3>
                                <span class="rounded-full bg-blue-600 px-2 py-1 text-[10px] font-black uppercase text-white">Start chat</span>
                            </div>
                            <p class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(user.userMobile || user.userEmail || '')}</p>
                            <p class="text-sm text-blue-700 dark:text-blue-300 truncate">Send a new message</p>
                        </div>
                    </button>`;
                }).join('');

            if (!chatRows && !userRows) {
                list.innerHTML = searchTerm
                    ? '<p class="text-center text-gray-500 dark:text-gray-400 py-8">No user or chat found.</p>'
                    : '<p class="text-center text-gray-500 dark:text-gray-400 py-8">No chats received yet.</p>';
            } else {
                list.innerHTML = `
                    ${chatRows ? `<div class="space-y-3">${chatRows}</div>` : ''}
                    ${userRows ? `
                    <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <p class="px-1 pb-2 text-xs font-black uppercase tracking-wide text-gray-400 dark:text-gray-500">Users</p>
                        <div class="space-y-3">${userRows}</div>
                    </div>` : ''}`;
            }
            document.querySelectorAll('.admin-chat-row').forEach(row => {
                row.onclick = () => {
                    const targetUserId = row.dataset.chatUserid;
                    const chat = allSupportChatsCache.find(item => (item.userId || item.id) === targetUserId);
                    const searchedUser = baseUsersForSearch.map(getAdminChatUserMeta).find(item => item.userId === targetUserId);
                    const chatMeta = chat || searchedUser || {};
                    const isTargetingOwner = !isOwner && (targetUserId === ADMIN_UID || chatMeta.userId === ADMIN_UID);
                    const ownerProfile = getOwnerProfile();

                    const adminId = isOwner ? ADMIN_UID : subAdminUid;
                    const roomId = chatMeta.roomId || getSupportRoomId(targetUserId, adminId);
                    markAdminSupportChatSeen(roomId, readSupportChatCache(roomId));

                    openSupportChatPage(targetUserId, 'admin', {
                        ...chatMeta,
                        roomId,
                        adminId: isTargetingOwner ? ADMIN_UID : adminId,
                        adminName: isTargetingOwner ? ownerProfile.userName : 'REVIEWS WORLD',
                        adminEmail: isTargetingOwner ? ownerProfile.userEmail : 'reviewsworld01@gmail.com',
                        adminLogo: isTargetingOwner ? ownerProfile.userAvatar : undefined
                    });
                };
            });
        };

const showAdminChatsPage = () => {
            const content = `
                ${getPageHeader('Manage Chat')}
                <div class="max-w-2xl mx-auto space-y-3">
                    <div class="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-sm p-3">
                        <input id="admin-chat-search" type="search" placeholder="Search chat or any user by name, email, phone" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div id="admin-chats-list" class="space-y-3"></div>
                </div>
                ${getPageFooter()}`;
            showPage(content);
            document.getElementById('admin-chat-search')?.addEventListener('input', renderAdminChatsList);

            // Hydrate users cache instantly so avatars and user names exist immediately
            if ((!allUsersCache || allUsersCache.length === 0) && typeof hydrateAdminUsersFromCache === 'function') {
                hydrateAdminUsersFromCache();
            }

            // Render instantly from local cache
            renderAdminChatsList();

            // Non-blocking background sync
            ensureAdminChatUsersLoaded(false).then(() => {
                loadAdminChatsFromBackend({ silent: true, subscribeRealtime: true }).then(() => {
                    renderAdminChatsList();
                }).catch(e => console.warn('Background admin chat sync skipped:', e));
            }).catch(e => console.warn('Background admin chat users skipped:', e));
        };

// Expose functions to window for global access
window.resolveChatUserAvatar = resolveChatUserAvatar;
window.fetchMissingChatAvatars = fetchMissingChatAvatars;
window.updateAdminChatUnreadBadges = updateAdminChatUnreadBadges;
window.calculateAdminChatUnreadCount = calculateAdminChatUnreadCount;
window.refreshAdminChatUnreadCount = refreshAdminChatUnreadCount;
window.preloadAdminChatRooms = preloadAdminChatRooms;
window.subscribeAdminChatRooms = subscribeAdminChatRooms;
window.loadAdminChatsFromBackend = loadAdminChatsFromBackend;
window.getAdminChatUserMeta = getAdminChatUserMeta;
window.ensureAdminChatUsersLoaded = ensureAdminChatUsersLoaded;
window.renderAdminChatsList = renderAdminChatsList;
window.showAdminChatsPage = showAdminChatsPage;
