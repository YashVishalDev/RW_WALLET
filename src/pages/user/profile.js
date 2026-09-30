// File: src/pages/profile.js

const applyTheme = (theme) => {
            // Force light theme
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');

            const lightIcon = document.getElementById('settings-theme-icon-light');
            const darkIcon = document.getElementById('settings-theme-icon-dark');

            if (lightIcon && darkIcon) {
                lightIcon.classList.remove('hidden');
                darkIcon.classList.add('hidden');
            }
        };

const toggleTheme = () => {
            applyTheme('light');
        };

const getProfileAvatarUrl = (user) => {
            const defaultAvatars = [
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
            const pool = (typeof window !== 'undefined' && Array.isArray(window.PREMIUM_AVATARS) && window.PREMIUM_AVATARS.length >= 10)
                ? window.PREMIUM_AVATARS
                : defaultAvatars;

            if (!user) return pool[0];
            const localAvatar = localStorage.getItem(`rw_profile_avatar_${user.uid || user.id || ''}`);
            if (localAvatar && !localAvatar.includes('3135715.png')) return localAvatar;
            
            // 1. Admin always uses the app logo
            const uId = user.uid || user.id || '';
            if (uId === ADMIN_UID || uId === 'admin' || user.email === 'admin@gmail.com') {
                return 'https://i.ibb.co/x8YBYwGG/6233389803554672153.jpg';
            }
            
            // 2. If user has chosen a profile photo, return it (filtering out generic placeholder)
            const customPhoto = user.profilePhoto || user.profile_photo || user.avatarUrl || user.avatar_url || user.photoURL;
            if (customPhoto && typeof customPhoto === 'string' && customPhoto.startsWith('http') && !customPhoto.includes('3135715.png')) {
                return customPhoto;
            }
            
            // 3. Fallback: Determine default based on name (male or female)
            const name = String(user.name || user.userName || user.email || user.displayName || '').toLowerCase().trim();
            
            // Common female name keywords, endings, or prefixes
            const femaleKeywords = [
                'devi', 'kumari', 'lata', 'seema', 'anita', 'sunita', 'kiran', 'pooja', 'priya', 'neha', 'divya',
                'kajal', 'jyoti', 'kavita', 'preeti', 'ritu', 'swati', 'sneha', 'alka', 'usha', 'shanti', 'meena',
                'sushma', 'rekha', 'pinky', 'monika', 'payal', 'asha', 'babita', 'radha', 'sharda', 'mamta', 'sapna',
                'isha', 'tanya', 'riya', 'ananya', 'rashmi', 'shruti', 'komal', 'arti', 'renu', 'savita', 'geeta',
                'sita', 'gita', 'anamika', 'archana', 'disha', 'megha', 'nisha', 'prerna', 'richa', 'shweta', 'sheetal',
                'sakshi', 'simran', 'tanvi', 'vaishali', 'varsha', 'yashaswi', 'girl', 'female', 'woman', 'lady', 'aasiya', 'afroj'
            ];
            
            const isFemale = femaleKeywords.some(kw => name.includes(kw)) ||
                             name.endsWith('a') || name.endsWith('i') || name.endsWith('ee') || name.endsWith('ya') || name.endsWith('y');
            
            const charSum = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
            if (isFemale) {
                const femaleAvatars = pool.slice(5, 10);
                return femaleAvatars[charSum % femaleAvatars.length];
            } else {
                const maleAvatars = pool.slice(0, 5);
                return maleAvatars[charSum % maleAvatars.length];
            }
        };

const getBackendProfilePayload = () => ({
            name: currentUserData?.name || currentUser?.displayName || '',
            mobile: currentUserData?.mobile || '',
            phoneNumber: currentUserData?.mobile || ''
        });

const getProfilePaymentDetails = (method, data = currentUserData || {}) => {
            const saved = data.savedWithdrawalDetails && typeof data.savedWithdrawalDetails === 'object' && data.savedWithdrawalDetails[method] ? data.savedWithdrawalDetails[method] : {};
            const details = data.paymentDetails && typeof data.paymentDetails === 'object' ? { ...data.paymentDetails } : {};
            if (method === 'upi') {
                return {
                    ...details,
                    ...saved,
                    upiId: saved.upiId || details.upiId || data.upiId || (typeof data.paymentDetails === 'string' ? data.paymentDetails : '')
                };
            }
            if (method === 'bank') {
                return {
                    ...details,
                    ...saved,
                    accountNumber: saved.accountNumber || details.accountNumber || data.accountNumber || '',
                    ifsc: saved.ifsc || details.ifsc || data.ifsc || '',
                    bankName: saved.bankName || details.bankName || data.bankName || '',
                    accountName: saved.accountName || details.accountName || data.accountName || ''
                };
            }
            if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
                const stringDetails = typeof data.paymentDetails === 'string' ? data.paymentDetails : '';
                return {
                    ...details,
                    ...saved,
                    email: saved.email || details.email || data.paymentEmail || (stringDetails.includes('@') ? stringDetails : '')
                };
            }
            if (method === 'crypto') {
                return {
                    ...details,
                    ...saved,
                    walletAddress: saved.walletAddress || details.walletAddress || data.cryptoAddress || ''
                };
            }
            return { ...details, ...saved };
        };

const normalizeProfilePaymentMethod = (data = currentUserData || {}) => {
            const rawMethod = String(
                data.paymentMethod ||
                data.payment_method ||
                data.selectedPaymentMethod ||
                data.withdrawalMethod ||
                data.withdrawMethod ||
                data.withdraw_method ||
                data.methodId ||
                data.method ||
                ''
            )
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_');
            const methodAliases = {
                upi: 'upi',
                upi_id: 'upi',
                bank: 'bank',
                bank_account: 'bank',
                account: 'bank',
                play_store: 'play_store',
                playstore: 'play_store',
                redeem_code: 'play_store',
                amazon: 'amazon_gift',
                amazon_gift: 'amazon_gift',
                amazon_gift_card: 'amazon_gift',
                flipkart: 'flipkart_gift',
                flipkart_gift: 'flipkart_gift',
                flipkart_gift_card: 'flipkart_gift',
                paypal: 'paypal'
            };
            if (methodAliases[rawMethod]) return methodAliases[rawMethod];
            if (rawMethod.includes('upi')) return 'upi';
            if (rawMethod.includes('bank') || rawMethod.includes('account')) return 'bank';
            if (rawMethod.includes('play')) return 'play_store';
            if (rawMethod.includes('amazon')) return 'amazon_gift';
            if (rawMethod.includes('flipkart')) return 'flipkart_gift';
            if (rawMethod.includes('paypal')) return 'paypal';

            const details = data.paymentDetails && typeof data.paymentDetails === 'object' ? data.paymentDetails : {};
            const stringDetails = typeof data.paymentDetails === 'string' ? data.paymentDetails : '';
            if (details.upiId || data.upiId) return 'upi';
            if (details.accountNumber || details.ifsc || data.accountNumber || data.ifsc) return 'bank';
            if (details.email || data.paymentEmail || stringDetails.includes('@')) return 'paypal';
            return '';
        };

const getRawProfilePaymentMethod = (data = currentUserData || {}) =>
            data.paymentMethod || data.payment_method || data.selectedPaymentMethod || data.withdrawalMethod ||
            data.withdrawMethod || data.withdraw_method || data.methodId || data.method || '';

const getProfilePaymentMethodLabel = (method, data = currentUserData || {}) => ({
            upi: 'UPI ID',
            bank: 'Bank Account',
            play_store: 'Play Store Redeem Code',
            amazon_gift: 'Amazon Gift Card',
            flipkart_gift: 'Flipkart Gift Card',
            paypal: 'PayPal',
            crypto: 'Crypto Currency'
        }[method] || toTitleText(getRawProfilePaymentMethod(data)) || 'Payment Method');

const syncProfilePhotoToDatabase = async (chosenUrl) => {
    showNotification('Updating profile photo...', false);
    try {
        localStorage.setItem(`rw_profile_avatar_${currentUser.uid}`, chosenUrl);
        currentUserData = { ...(currentUserData || {}), profilePhoto: chosenUrl };
        writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));

        const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
        await setDoc(userRef, { profilePhoto: chosenUrl }, { merge: true });

        // Update settings preview if open
        const settingsPreview = document.getElementById('settings-avatar-preview');
        if (settingsPreview) settingsPreview.src = chosenUrl;

        // Update profile preview if open
        const profilePreview = document.getElementById('profile-avatar-preview');
        if (profilePreview) {
            profilePreview.src = chosenUrl;
            const urlInput = document.getElementById('profile-avatar-url');
            if (urlInput) urlInput.value = chosenUrl;
        }

        showNotification('Profile photo updated successfully!');
    } catch (e) {
        console.error('Update photo failed:', e);
        const errMsg = String(e?.message || '');
        if (/resource-exhausted|quota exceeded/i.test(errMsg)) {
            showNotification('Database daily quota exceeded. Please try again later.', true);
        } else {
            showNotification('Failed to update profile photo.', true);
        }
    }
};

const showCropperModal = (imageSrc, onSelect) => {
    const cropperHtml = `
        <div class="space-y-4 text-left">
            <p class="text-xs font-semibold text-gray-500">Drag image to position, use slider to zoom.</p>
            <div class="relative w-full aspect-square bg-slate-950 overflow-hidden rounded-2xl flex items-center justify-center select-none" id="cropper-container" style="height: 280px;">
                <img id="cropper-img" src="${imageSrc}" class="absolute max-w-none origin-center cursor-move" style="transform: translate(0px, 0px) scale(1);" draggable="false">
                <div class="absolute pointer-events-none inset-0 border-[40px] border-black/60 flex items-center justify-center">
                    <div class="w-[200px] h-[200px] rounded-full border border-dashed border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]" id="cropper-circle"></div>
                </div>
            </div>
            <div class="space-y-1">
                <div class="flex justify-between text-[11px] font-black text-gray-400 uppercase">
                    <span>Zoom</span>
                    <span id="zoom-value">100%</span>
                </div>
                <input type="range" id="cropper-zoom" min="0.1" max="4" step="0.02" value="1" class="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600">
            </div>
        </div>
    `;

    renderModal('Crop Profile Photo', cropperHtml, `
        <div class="flex gap-2 w-full">
            <button id="cropper-cancel-btn" class="flex-1 rounded-xl bg-gray-100 dark:bg-gray-700 py-3 text-sm font-extrabold text-gray-700 dark:text-gray-200">Cancel</button>
            <button id="cropper-save-btn" class="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-sm font-black shadow-md">Crop & Save</button>
        </div>
    `, 'max-w-md');

    const img = document.getElementById('cropper-img');
    const container = document.getElementById('cropper-container');
    const zoomInput = document.getElementById('cropper-zoom');
    const zoomValText = document.getElementById('zoom-value');
    const circle = document.getElementById('cropper-circle');

    let currentX = 0;
    let currentY = 0;
    let scale = 1;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    img.onload = () => {
        const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
        if (maxDim > 0) {
            const fitScale = 200 / maxDim;
            scale = Math.max(0.1, Math.min(3, fitScale));
            zoomInput.value = scale;
            zoomValText.textContent = Math.round(scale * 100) + '%';
            img.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
        }
    };

    zoomInput.oninput = function() {
        scale = Number(this.value);
        zoomValText.textContent = Math.round(scale * 100) + '%';
        img.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
    };

    const startDrag = (clientX, clientY) => {
        isDragging = true;
        startX = clientX - currentX;
        startY = clientY - currentY;
    };

    const doDrag = (clientX, clientY) => {
        if (!isDragging) return;
        currentX = clientX - startX;
        currentY = clientY - startY;
        img.style.transform = `translate(${currentX}px, ${currentY}px) scale(${scale})`;
    };

    const stopDrag = () => {
        isDragging = false;
    };

    container.onmousedown = (e) => startDrag(e.clientX, e.clientY);
    window.onmousemove = (e) => doDrag(e.clientX, e.clientY);
    window.onmouseup = () => stopDrag();

    container.ontouchstart = (e) => {
        if (e.touches.length === 1) {
            startDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    };
    window.ontouchmove = (e) => {
        if (isDragging && e.touches.length === 1) {
            doDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
    };
    window.ontouchend = () => stopDrag();

    document.getElementById('cropper-cancel-btn').onclick = () => {
        window.closeModal();
    };

    document.getElementById('cropper-save-btn').onclick = () => {
        showNotification('Cropping image...', false);
        try {
            const cropRect = circle.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();

            const scaleX = img.naturalWidth / imgRect.width;
            const scaleY = img.naturalHeight / imgRect.height;

            const sx = (cropRect.left - imgRect.left) * scaleX;
            const sy = (cropRect.top - imgRect.top) * scaleY;
            const sWidth = cropRect.width * scaleX;
            const sHeight = cropRect.height * scaleY;

            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            ctx.beginPath();
            ctx.arc(128, 128, 128, 0, Math.PI * 2);
            ctx.clip();

            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, 256, 256);

            const croppedUrl = canvas.toDataURL('image/jpeg', 0.88);
            window.closeModal();
            onSelect(croppedUrl);
        } catch (e) {
            console.error('Crop failed:', e);
            showNotification('Could not crop image. Make sure it is fully loaded.', true);
        }
    };
};

window.showProfilePhotoSelectionModal = (currentAvatar, onSelect) => {
    const modalGridHtml = `
        <div class="space-y-4 text-left p-1">
            <p class="text-xs font-semibold text-gray-500">Choose a new profile photo from your device gallery.</p>
            <div class="flex flex-col gap-3">
                <button type="button" id="upload-custom-avatar-btn" class="w-full flex items-center justify-center gap-2 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white py-3.5 text-sm font-black transition shadow-md active:scale-98">
                    📁 Choose Photo from Gallery
                </button>
                <input type="file" id="custom-avatar-file-input" accept="image/*" class="hidden">
            </div>
        </div>
    `;

    renderModal('Choose Profile Photo', modalGridHtml, '', 'max-w-md');

    const uploadBtn = document.getElementById('upload-custom-avatar-btn');
    const fileInput = document.getElementById('custom-avatar-file-input');
    if (uploadBtn && fileInput) {
        uploadBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showNotification('Please select an image file.', true);
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                window.closeModal();
                showCropperModal(event.target.result, onSelect);
            };
            reader.readAsDataURL(file);
        };
    }
};

const getJoinedSinceText = (user = currentUserData) => {
    const raw = user?.createdAt || user?.created_at || user?.createdAtMs || Date.now();
    let date;
    if (typeof raw === 'number') {
        date = new Date(raw);
    } else if (raw && typeof raw === 'object' && raw.seconds) {
        date = new Date(raw.seconds * 1000);
    } else if (typeof raw === 'string') {
        date = new Date(raw);
    } else {
        date = new Date();
    }
    if (isNaN(date.getTime())) return 'Joined : N/A';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `Joined : ${day}/${month}/${year}`;
};

const isUserVerifiedProfile = (user = currentUserData) => {
    if (!user) return false;
    return !!(user.isVerified || user.kycVerified || user.status === 'active' || user.verified || user.role === 'admin' || user.role === 'owner' || user.uid === ADMIN_UID);
};

const showSavedPaymentMethodsPage = (focusMethod = '') => {
    if (!currentUserData) return showNotification('User data not loaded.', true);

    const methodsConfig = [
        {
            id: 'upi',
            name: 'UPI',
            iconUrl: '/assets/images/withdraw_upi.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('upi');
                return details.upiId ? details.upiId : 'Not Added Yet';
            }
        },
        {
            id: 'bank',
            name: 'Bank Account',
            iconUrl: '/assets/images/withdraw_bank.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('bank');
                if (!details.accountNumber) return 'Not Added Yet';
                const bank = details.bankName || 'Bank Account';
                const masked = String(details.accountNumber).slice(-4);
                return `${bank}\n**** **** **** ${masked}`;
            }
        },
        {
            id: 'play_store',
            name: 'Google Play',
            iconUrl: '/assets/images/withdraw_playstore.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('play_store');
                return details.email ? details.email : 'Not Added Yet';
            }
        },
        {
            id: 'amazon_gift',
            name: 'Amazon Pay',
            iconUrl: '/assets/images/withdraw_amazon.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('amazon_gift');
                return details.email ? details.email : 'Not Added Yet';
            }
        },
        {
            id: 'flipkart_gift',
            name: 'Flipkart Voucher',
            iconUrl: '/assets/images/withdraw_flipkart.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('flipkart_gift');
                return details.email ? details.email : 'Not Added Yet';
            }
        },
        {
            id: 'paypal',
            name: 'PayPal',
            iconUrl: '/assets/images/withdraw_paypal.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('paypal');
                return details.email ? details.email : 'Not Added Yet';
            }
        },
        {
            id: 'crypto',
            name: 'Crypto Wallet',
            iconUrl: '/assets/images/withdraw_crypto.png',
            getSummary: () => {
                const details = getProfilePaymentDetails('crypto');
                return (details.address || details.email) ? (details.address || details.email) : 'Not Added Yet';
            }
        }
    ];

    const activeMethod = normalizeProfilePaymentMethod(currentUserData);

    const methodsListHtml = methodsConfig.map(method => {
        const summary = method.getSummary();
        const isAdded = summary !== 'Not Added Yet';
        const isPrimary = activeMethod === method.id;

        return `
            <div class="flex items-center justify-between gap-3 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700/80 shadow-sm transition hover:shadow-md">
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="relative flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white p-1 shadow-sm overflow-hidden">
                        <img src="${method.iconUrl}" alt="${escapeHtml(method.name)}" class="h-full w-full object-contain rounded-xl">
                    </div>
                    <div class="min-w-0 text-left space-y-0.5">
                        <div class="flex items-center gap-2">
                            <h4 class="text-base font-black text-slate-900 dark:text-white truncate">${escapeHtml(method.name)}</h4>
                            ${isPrimary ? `<span class="rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 px-2 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">Primary</span>` : ''}
                        </div>
                        <p class="text-xs font-semibold ${isAdded ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'} whitespace-pre-line truncate">${escapeHtml(summary)}</p>
                    </div>
                </div>
                <button type="button" onclick="window.showEditPaymentMethodModal('${method.id}')" class="shrink-0 flex items-center gap-1.5 rounded-xl bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 border border-purple-200/60 px-3.5 py-2 text-xs font-extrabold text-purple-700 dark:text-purple-300 transition active:scale-95">
                    <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    <span>${isAdded ? 'Edit' : 'Add'}</span>
                </button>
            </div>
        `;
    }).join('');

    const content = `
        <div class="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 px-4 py-3 backdrop-blur-md">
            <button type="button" onclick="window.showProfilePage()" class="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 transition active:scale-90" aria-label="Back">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <h2 class="text-base font-black text-gray-900 dark:text-white">Saved Payment Method</h2>
            <div class="w-9"></div>
        </div>
        <div class="max-w-lg mx-auto p-4 space-y-3 text-left">
            <div class="space-y-3">
                ${methodsListHtml}
            </div>
        </div>
        ${getPageFooter()}`;

    showPage(content);

    if (focusMethod) {
        setTimeout(() => window.showEditPaymentMethodModal(focusMethod), 100);
    }
};

const showEditPaymentMethodModal = (methodId = 'upi') => {
    const activeMethod = methodId || 'upi';
    const details = getProfilePaymentDetails(activeMethod);

    let formFieldsHtml = '';
    let modalTitle = 'Update Payment Method';

    if (activeMethod === 'upi') {
        modalTitle = 'UPI Details';
        formFieldsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold uppercase text-gray-400">UPI ID</label>
                <input type="text" id="modal-upi-id" value="${escapeHtml(details.upiId || '')}" placeholder="example@upi" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
            </div>
        `;
    } else if (activeMethod === 'bank') {
        modalTitle = 'Bank Account Details';
        formFieldsHtml = `
            <div class="space-y-3">
                <div class="space-y-1">
                    <label class="text-xs font-bold uppercase text-gray-400">Bank Name</label>
                    <input type="text" id="modal-bank-name" value="${escapeHtml(details.bankName || '')}" placeholder="State Bank of India" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold uppercase text-gray-400">Account Holder Name</label>
                    <input type="text" id="modal-account-name" value="${escapeHtml(details.accountName || '')}" placeholder="Full Name as in Bank" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold uppercase text-gray-400">Account Number</label>
                    <input type="text" id="modal-account-number" value="${escapeHtml(details.accountNumber || '')}" placeholder="Account Number" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-bold uppercase text-gray-400">IFSC Code</label>
                    <input type="text" id="modal-ifsc" value="${escapeHtml(details.ifsc || '')}" placeholder="SBIN0001234" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium uppercase">
                </div>
            </div>
        `;
    } else if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(activeMethod)) {
        const names = { play_store: 'Google Play', amazon_gift: 'Amazon Pay', flipkart_gift: 'Flipkart Voucher', paypal: 'PayPal' };
        modalTitle = `${names[activeMethod] || 'Payment'} Email`;
        formFieldsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold uppercase text-gray-400">Email Address</label>
                <input type="email" id="modal-payment-email" value="${escapeHtml(details.email || '')}" placeholder="your-email@example.com" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
            </div>
        `;
    } else if (activeMethod === 'crypto') {
        modalTitle = 'Crypto Wallet Details';
        formFieldsHtml = `
            <div class="space-y-1">
                <label class="text-xs font-bold uppercase text-gray-400">Wallet Address or Email</label>
                <input type="text" id="modal-crypto-address" value="${escapeHtml(details.address || details.email || '')}" placeholder="Binance Pay ID / USDT Wallet Address" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
            </div>
        `;
    } else {
        const paymentMethods = [
            { value: 'upi', label: 'UPI ID' },
            { value: 'bank', label: 'Bank Account' },
            { value: 'play_store', label: 'Google Play Redeem Code' },
            { value: 'amazon_gift', label: 'Amazon Gift Card' },
            { value: 'flipkart_gift', label: 'Flipkart Gift Card' },
            { value: 'paypal', label: 'PayPal' },
            { value: 'crypto', label: 'Crypto Currency' }
        ];
        modalTitle = 'Choose Payment Method';
        formFieldsHtml = `
            <div class="space-y-3">
                <label class="text-xs font-bold uppercase text-gray-400">Select Method</label>
                <select id="modal-select-method" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
                    ${paymentMethods.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
                </select>
            </div>
        `;
    }

    renderModal(modalTitle, `
        <div class="space-y-4 text-left">
            ${formFieldsHtml}
        </div>
    `, `
        <div class="flex gap-2 w-full">
            <button onclick="window.closeModal()" class="flex-1 rounded-xl bg-gray-100 dark:bg-gray-700 py-3 text-sm font-extrabold text-gray-700 dark:text-gray-200">Cancel</button>
            <button id="modal-save-payment-btn" class="flex-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white py-3 text-sm font-black shadow-md">Save Details</button>
        </div>
    `, 'max-w-md');

    document.getElementById('modal-save-payment-btn').onclick = async () => {
        let method = activeMethod;
        let paymentDetails = {};

        if (!method) {
            method = document.getElementById('modal-select-method')?.value || 'upi';
        }

        if (method === 'upi') {
            const upiId = document.getElementById('modal-upi-id')?.value.trim();
            if (!upiId) return showNotification('Please enter a valid UPI ID.', true);
            paymentDetails = { upiId };
        } else if (method === 'bank') {
            const bankName = document.getElementById('modal-bank-name')?.value.trim();
            const accountName = document.getElementById('modal-account-name')?.value.trim();
            const accountNumber = document.getElementById('modal-account-number')?.value.trim();
            const ifsc = document.getElementById('modal-ifsc')?.value.trim();
            if (!bankName || !accountName || !accountNumber || !ifsc) {
                return showNotification('All bank account details are required.', true);
            }
            paymentDetails = { bankName, accountName, accountNumber, ifsc };
        } else if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
            const email = document.getElementById('modal-payment-email')?.value.trim();
            if (!email) return showNotification('Please enter a valid email address.', true);
            paymentDetails = { email };
        } else if (method === 'crypto') {
            const address = document.getElementById('modal-crypto-address')?.value.trim();
            if (!address) return showNotification('Please enter a crypto address or ID.', true);
            paymentDetails = { address };
        }

        showNotification('Saving payment details...', false);
        try {
            const updatePayload = {
                paymentMethod: method,
                paymentDetails: paymentDetails
            };
            if (method === 'upi') updatePayload.upiId = paymentDetails.upiId;
            if (method === 'bank') {
                updatePayload.accountNumber = paymentDetails.accountNumber;
                updatePayload.ifsc = paymentDetails.ifsc;
                updatePayload.bankName = paymentDetails.bankName;
                updatePayload.accountName = paymentDetails.accountName;
            }
            if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(method)) {
                updatePayload.paymentEmail = paymentDetails.email;
            }

            const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
            await setDoc(userRef, updatePayload, { merge: true });

            currentUserData = { ...(currentUserData || {}), ...updatePayload };
            writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));

            window.closeModal();
            showNotification('Payment method saved successfully!');
            showSavedPaymentMethodsPage();
        } catch (e) {
            console.error('Save payment method failed:', e);
            showNotification('Could not save payment details. Please try again.', true);
        }
    };
};

const showEditFullNameModal = () => {
    renderModal('Edit Full Name', `
        <div class="space-y-3 text-left">
            <div class="space-y-1">
                <label class="text-xs font-bold uppercase text-gray-400">Full Name</label>
                <input type="text" id="modal-full-name-input" value="${escapeHtml(currentUserData?.name || '')}" placeholder="Enter your full name" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
            </div>
        </div>
    `, `
        <div class="flex gap-2 w-full">
            <button onclick="window.closeModal()" class="flex-1 rounded-xl bg-gray-100 dark:bg-gray-700 py-3 text-sm font-extrabold text-gray-700 dark:text-gray-200">Cancel</button>
            <button id="modal-save-name-btn" class="flex-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white py-3 text-sm font-black shadow-md">Save Name</button>
        </div>
    `, 'max-w-md');

    document.getElementById('modal-save-name-btn').onclick = async () => {
        const newName = document.getElementById('modal-full-name-input')?.value.trim();
        if (!newName) return showNotification('Full Name cannot be empty.', true);

        showNotification('Saving name...', false);
        try {
            const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
            await setDoc(userRef, { name: newName }, { merge: true });

            currentUserData = { ...(currentUserData || {}), name: newName };
            writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));

            window.closeModal();
            showNotification('Name updated successfully!');
            showProfilePage();
        } catch (e) {
            console.error('Save name failed:', e);
            showNotification('Could not save name. Please try again.', true);
        }
    };
};

const showAdminSupportProfileModal = () => {
    const websiteLinks = Array.isArray(currentUserData.websiteLinks) ? currentUserData.websiteLinks.slice(0, 3) : [];
    renderModal('Admin Support Profile', `
        <div class="space-y-4 text-left">
            <p class="text-xs text-gray-500">Shown in support chat profile details.</p>
            <div class="space-y-1">
                <label class="text-xs font-bold uppercase text-gray-400">WhatsApp Number</label>
                <input type="tel" id="modal-whatsapp-input" value="${escapeHtml(currentUserData.whatsappNumber || currentUserData.mobile || '')}" maxlength="15" placeholder="WhatsApp number" class="w-full px-4 py-3 bg-gray-100 dark:bg-gray-700 border-transparent rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium">
            </div>
            <div class="space-y-2">
                <label class="text-xs font-bold uppercase text-gray-400">Website Links (optional, max 3)</label>
                <div id="website-links-container" class="space-y-2">${renderWebsiteLinkInputs(websiteLinks)}</div>
            </div>
        </div>
    `, `
        <button id="modal-save-support-btn" class="w-full rounded-xl bg-purple-600 hover:bg-purple-700 text-white py-3 text-sm font-black shadow-md">Save Support Profile</button>
    `, 'max-w-md');

    bindWebsiteLinkControls();

    document.getElementById('modal-save-support-btn').onclick = async () => {
        const whatsappNumber = document.getElementById('modal-whatsapp-input')?.value.trim() || '';
        if (whatsappNumber && !/^\d{10,15}$/.test(whatsappNumber)) {
            return showNotification('WhatsApp number must be 10 to 15 digits.', true);
        }
        const websiteLinks = Array.from(document.querySelectorAll('.profile-website-input'))
            .map(input => input.value.trim())
            .filter(Boolean)
            .slice(0, 3);
        const invalidLink = websiteLinks.find(link => !/^https?:\/\/.+\..+/.test(link));
        if (invalidLink) {
            return showNotification('Website links must start with http:// or https://', true);
        }

        showNotification('Saving support profile...', false);
        try {
            const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
            await setDoc(userRef, {
                whatsappNumber,
                websiteLinks
            }, { merge: true });

            currentUserData = { ...(currentUserData || {}), whatsappNumber, websiteLinks };
            writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));

            window.closeModal();
            showNotification('Support profile saved!');
            showProfilePage();
        } catch (e) {
            console.error('Save support profile failed:', e);
            showNotification('Could not save support profile.', true);
        }
    };
};

const showProfilePage = (focusMethod = '') => {
    if (!currentUserData) return showNotification('User data not loaded. Please wait.', true);

    const isAdminProfile = currentUser?.uid === ADMIN_UID || currentUserData?.role === 'admin' || currentUserData?.role === 'owner';
    const currentAvatar = getProfileAvatarUrl(currentUserData);
    const isVerified = isAdminProfile || isUserVerifiedProfile(currentUserData);
    const joinedSinceText = getJoinedSinceText(currentUserData);

    const userDisplayName = currentUserData.name || (isAdminProfile ? 'REVIEWS WORLD ADMIN' : 'User');
    const userMobile = currentUserData.mobile || currentUserData.phoneNumber || 'Not Set';
    const userEmail = currentUserData.email || 'Not Set';
    const emailLength = String(userEmail).length;
    let emailClass = 'truncate';
    if (emailLength > 32) {
        emailClass = 'text-[10px] leading-tight break-all font-semibold email-auto-shrink';
    } else if (emailLength > 26) {
        emailClass = 'text-[11px] leading-snug break-all font-semibold email-auto-shrink';
    } else if (emailLength > 21) {
        emailClass = 'text-xs leading-snug break-all font-semibold email-auto-shrink';
    } else if (emailLength > 17) {
        emailClass = 'text-sm font-semibold truncate email-auto-shrink';
    } else {
        emailClass = 'truncate email-auto-shrink';
    }

    const content = `
        ${getPageHeader('My Profile')}
        <div class="max-w-lg mx-auto space-y-4 text-left px-1">
            <!-- Header Card (Exact User HTML & Guaranteed Icons) -->
            <div class="profile-card">
                <div class="profile-left">
                    <div class="avatar-wrap cursor-pointer" id="profile-avatar-trigger-btn" title="Change Profile Photo">
                        <img id="profile-avatar-preview" src="${escapeHtml(currentAvatar)}" class="avatar" alt="Avatar">
                        <button type="button" class="camera-btn" id="camera-btn-trigger" aria-label="Camera" title="Upload Photo">
                            <svg class="camera-icon text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </button>
                        <input type="hidden" id="profile-avatar-url" value="${escapeHtml(currentAvatar)}">
                    </div>
                </div>

                <div class="profile-right text-left">
                    <div class="name-row">
                        <h2 class="uppercase truncate">${escapeHtml(userDisplayName)}</h2>
                        ${isVerified ? `
                        <span class="verified inline-flex items-center shrink-0" title="Verified Profile">
                            <svg class="w-5 h-5 text-[#35b8ff] fill-current shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.67-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91c-1.31.67-2.19 1.91-2.19 3.34s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.7 4.8l-3.5-3.5 1.4-1.4 2.1 2.1 4.6-4.6 1.4 1.4-6 6z"/>
                            </svg>
                        </span>` : ''}
                    </div>

                    <div class="info">
                        <svg class="w-4.5 h-4.5 text-[#d7c3ff] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <span class="truncate">${escapeHtml(userMobile)}</span>
                    </div>

                    <div class="info">
                        <svg class="w-4.5 h-4.5 text-[#d7c3ff] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span class="${emailClass}">${escapeHtml(userEmail)}</span>
                    </div>

                    <div class="joined">
                        <svg class="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>${escapeHtml(joinedSinceText)}</span>
                    </div>
                </div>
            </div>

            <!-- Body Cards -->
            <div class="space-y-3 pt-1">
                <!-- Full Name Card -->
                <div class="flex items-center justify-between gap-3 rounded-2xl bg-white dark:bg-slate-800 p-4 border border-slate-150 dark:border-slate-700/80 shadow-sm">
                    <div class="flex items-center gap-3.5 min-w-0">
                        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-300 border border-purple-200/50">
                            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                        </div>
                        <div class="min-w-0 text-left">
                            <p class="text-[11px] font-black uppercase text-slate-400 dark:text-slate-400 tracking-wide">Full Name</p>
                            <p class="text-base font-black text-slate-900 dark:text-white truncate mt-0.5">${escapeHtml(userDisplayName)}</p>
                        </div>
                    </div>
                    <button type="button" id="edit-full-name-btn" class="shrink-0 flex items-center gap-1.5 rounded-xl bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 border border-purple-200/60 px-4 py-2 text-xs font-extrabold text-purple-700 dark:text-purple-300 transition active:scale-95">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <span>Edit</span>
                    </button>
                </div>

                <!-- Wallet Number Card -->
                <div class="flex items-center justify-between gap-3 rounded-2xl bg-white dark:bg-slate-800 p-4 border border-slate-150 dark:border-slate-700/80 shadow-sm">
                    <div class="flex items-center gap-3.5 min-w-0">
                        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 border border-blue-200/50">
                            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="min-w-0 text-left">
                            <p class="text-[11px] font-black uppercase text-slate-400 dark:text-slate-400 tracking-wide">Your Wallet Number</p>
                            <p class="text-base font-black text-slate-900 dark:text-white truncate mt-0.5">${escapeHtml(userMobile)}</p>
                        </div>
                    </div>
                    <span class="shrink-0 rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-[10px] font-black uppercase text-blue-700 dark:text-blue-300">Active</span>
                </div>

                <!-- Saved Payment Method Card -->
                <div id="open-saved-payment-methods-btn" class="cursor-pointer flex items-center justify-between gap-3 rounded-2xl bg-white dark:bg-slate-800 p-4 border border-slate-150 dark:border-slate-700/80 shadow-sm hover:border-purple-300 transition active:scale-98">
                    <div class="flex items-center gap-3.5 min-w-0">
                        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-300 border border-purple-200/50">
                            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div class="min-w-0 text-left space-y-0.5">
                            <p class="text-sm font-black text-slate-900 dark:text-white">Saved Payment Method</p>
                            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">UPI • Bank Account • Google Play • Amazon Pay • Flipkart • PayPal • Crypto</p>
                        </div>
                    </div>
                    <div class="shrink-0 text-purple-600 dark:text-purple-400">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>

                ${isAdminProfile ? `
                <!-- Support Profile Box (Admin Only) -->
                <div id="open-admin-support-profile-btn" class="cursor-pointer flex items-center justify-between gap-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 p-4 border border-blue-200/60 dark:border-blue-800/60 shadow-sm hover:border-blue-400 transition active:scale-98">
                    <div class="flex items-center gap-3.5 min-w-0">
                        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300">
                            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <div class="min-w-0 text-left space-y-0.5">
                            <p class="text-sm font-black text-blue-950 dark:text-blue-100">Support Profile Settings</p>
                            <p class="text-xs font-semibold text-blue-700/80 dark:text-blue-300/80 truncate">WhatsApp Number & Support Links for chat</p>
                        </div>
                    </div>
                    <div class="shrink-0 text-blue-600 dark:text-blue-400">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>` : ''}
            </div>
        </div>
        ${getPageFooter()}`;

    showPage(content);

    // Event Listeners
    const avatarTrigger = document.getElementById('profile-avatar-trigger-btn');
    const cameraTrigger = document.getElementById('camera-btn-trigger');
    const openAvatarModal = () => {
        const activeAvatar = document.getElementById('profile-avatar-url')?.value || '';
        window.showProfilePhotoSelectionModal(activeAvatar, async (chosenUrl) => {
            await syncProfilePhotoToDatabase(chosenUrl);
        });
    };
    if (avatarTrigger) avatarTrigger.onclick = openAvatarModal;
    if (cameraTrigger) {
        cameraTrigger.onclick = (e) => {
            e.stopPropagation();
            openAvatarModal();
        };
    }

    const editNameBtn = document.getElementById('edit-full-name-btn');
    if (editNameBtn) editNameBtn.onclick = showEditFullNameModal;

    const paymentMethodsBtn = document.getElementById('open-saved-payment-methods-btn');
    if (paymentMethodsBtn) paymentMethodsBtn.onclick = () => showSavedPaymentMethodsPage();

    const supportProfileBtn = document.getElementById('open-admin-support-profile-btn');
    if (supportProfileBtn) supportProfileBtn.onclick = showAdminSupportProfileModal;
};

const showSettingsPage = () => {
            if (!ensureUserSessionReady()) return;
            const currentTheme = localStorage.getItem('theme') || 'light';
            const isAdmin = currentUser && currentUser.uid === ADMIN_UID;
            
            const content = `
                ${getPageHeader('Setting', { showBack: false })}
                <div class="max-w-lg mx-auto space-y-4">
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-3">
                        ${renderSettingAction('settings-profile-btn', 'My Profile', 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png', 'blue')}
                        ${renderSettingAction('settings-track-income-btn', 'Track Income', 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png', 'emerald')}
                        ${renderSettingAction('settings-invoice-btn', 'Invoice', 'https://cdn-icons-png.flaticon.com/512/337/337946.png', 'yellow')}
                        ${renderSettingAction('settings-task-history-btn', 'Task History', TASK_ICON_URL, 'purple')}
                        ${renderSettingAction('settings-live-lists-btn', 'Live Lists Verification', 'https://cdn-icons-png.flaticon.com/512/2620/2620743.png', 'indigo')}
                    </div>
                    ${isAdmin ? `
                    <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 space-y-3">
                        <p class="text-xs font-bold uppercase text-gray-400 px-1">Admin Tools</p>
                        ${renderSettingAction('settings-admin-withdrawals', 'Pending Requests', 'https://cdn-icons-png.flaticon.com/512/7939/7939990.png', 'blue')}
                        ${renderSettingAction('settings-admin-users', 'User Management', 'https://cdn-icons-png.flaticon.com/512/681/681494.png', 'green')}
                        ${renderSettingAction('settings-admin-gift-codes', 'Gift Codes', 'https://cdn-icons-png.flaticon.com/512/2611/2611152.png', 'purple')}
                        ${renderSettingAction('settings-admin-history', 'Withdrawal History', 'https://cdn-icons-png.flaticon.com/512/3652/3652191.png', 'yellow')}
                        ${renderSettingAction('settings-admin-chat', 'Manage Chat', 'https://cdn-icons-png.flaticon.com/512/5962/5962463.png', 'rose')}
                        ${renderSettingAction('settings-admin-rates', 'Rate Settings', 'https://cdn-icons-png.flaticon.com/512/3524/3524659.png', 'emerald')}
                        ${(currentUser?.uid === ADMIN_UID || currentUser?.email === 'reviewsworld51@gmail.com' || currentUser?.email === 'reviewsworld01@gmail.com' || String(currentUserData?.role).toLowerCase() === 'owner') ? `
                        ${renderSettingAction('settings-admin-maintenance', 'Maintenance Mode', 'https://cdn-icons-png.flaticon.com/512/2099/2099058.png', 'red')}
                        ${renderSettingAction('settings-admin-whats-new', "What's New Popup", 'https://cdn-icons-png.flaticon.com/512/1828/1828884.png', 'blue')}
                        ` : ''}
                    </div>` : ''}
                    <button id="settings-logout-btn" class="flex items-center justify-center w-full p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-300 font-bold">Logout</button>
                </div>
                ${getPageFooter()}`;
            showPage(content, { keepBottomNav: true });
            currentMainSection = 'settings';
            setBottomNavActive('bottom-settings-btn');
            document.getElementById('settings-profile-btn').onclick = showProfilePage;
            document.getElementById('settings-track-income-btn').onclick = showTrackIncomePage;
            document.getElementById('settings-invoice-btn').onclick = showWithdrawalInvoicesPage;
            document.getElementById('settings-task-history-btn').onclick = showUserTaskHistoryPage;
            document.getElementById('settings-live-lists-btn').onclick = showUserLiveListsPage;
            document.getElementById('settings-logout-btn').onclick = () => window.handleLogout();
            if (isAdmin) {
                document.getElementById('settings-admin-withdrawals').onclick = showAdminWithdrawalsPage;
                document.getElementById('settings-admin-users').onclick = showAdminUsersPage;
                document.getElementById('settings-admin-gift-codes').onclick = showAdminGiftCodesPage;
                document.getElementById('settings-admin-history').onclick = showWithdrawalHistoryPage;
                document.getElementById('settings-admin-chat').onclick = showAdminChatsPage;
                document.getElementById('settings-admin-rates').onclick = showAdminWithdrawSettingsModal;
                const maintBtn = document.getElementById('settings-admin-maintenance');
                if (maintBtn) maintBtn.onclick = showMaintenanceSettingsPage;
                const whatsNewBtn = document.getElementById('settings-admin-whats-new');
                if (whatsNewBtn) whatsNewBtn.onclick = showWhatsNewSettingsPage;
            }

        };

const showMaintenanceSettingsPage = () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const parentSection = currentMainSection === 'admin' ? 'admin' : 'settings';
            const handleBack = parentSection === 'admin' ? showAdminMainPage : showSettingsPage;
            const active = isMaintenanceConfigActive(appConfigCache);
            const endMillis = getMaintenanceEndMillis(appConfigCache);
            const remainingSeconds = active && endMillis ? Math.max(60, Math.ceil((endMillis - Date.now()) / 1000)) : 30 * 60;
            const durationValue = formatMaintenanceDurationInput(remainingSeconds);
            const endText = active && endMillis ? new Date(endMillis).toLocaleString('en-IN') : 'Not scheduled';
            const message = appConfigCache.maintenanceMessage || 'We are improving your wallet experience. Please wait until the maintenance window is complete.';

            showPage(`
                ${getPageHeader('Maintenance Mode')}
                <div class="max-w-lg mx-auto space-y-4">
                    <div class="rounded-3xl bg-gradient-to-br from-slate-950 via-blue-900 to-emerald-700 p-5 text-white shadow-xl">
                        <p class="text-xs font-extrabold uppercase text-white/70">Admin Control</p>
                        <div class="mt-4 flex items-center justify-between gap-3">
                            <div>
                                <h3 class="text-2xl font-extrabold">${active ? 'Maintenance is ON' : 'Maintenance is OFF'}</h3>
                                <p class="mt-1 text-sm text-white/70">${active ? `Ends: ${escapeHtml(endText)}` : 'Users can open the app normally.'}</p>
                            </div>
                            <span class="rounded-2xl px-4 py-2 text-xs font-extrabold ${active ? 'bg-red-500 text-white animate-pulse' : 'bg-white/20 text-white'}">${active ? 'ON' : 'OFF'}</span>
                        </div>
                        ${active ? `
                        <div class="mt-5 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                            <p class="text-xs font-extrabold uppercase text-cyan-100/75" id="admin-maintenance-timer-label">Remaining Time</p>
                            <p class="mt-1 text-3xl font-extrabold tabular-nums" id="admin-maintenance-timer-val">${durationValue}</p>
                        </div>
                        ` : ''}
                    </div>
                    <button id="maintenance-configure-btn" class="w-full rounded-2xl bg-white dark:bg-gray-800 border border-gray-150 dark:border-gray-700 py-3.5 px-4 font-extrabold text-sm text-gray-800 dark:text-white flex items-center justify-between gap-2 shadow-sm hover:scale-[1.01] active:scale-[0.99] transition select-none">
                        <span class="flex items-center gap-2">⚙️ Configure Maintenance Settings</span>
                        <span id="maintenance-configure-chevron" class="text-xs font-bold text-gray-400">➕ Show</span>
                    </button>

                    <div id="maintenance-form-container" class="hidden space-y-4 transition-all duration-300">
                        <div class="rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-md border border-gray-100 dark:border-gray-700 space-y-4">
                            <div>
                                <label class="text-sm font-extrabold text-gray-700 dark:text-gray-200">Maintenance time (HH:MM:SS)</label>
                                <input id="maintenance-duration-input" type="text" inputmode="numeric" maxlength="8" value="${durationValue}" placeholder="00:30:00" class="mt-2 w-full rounded-2xl bg-gray-100 dark:bg-gray-700 px-4 py-3 text-2xl font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <p class="mt-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Example: 01:30:00 for 1 hour 30 minutes. Maximum 72:00:00.</p>
                            </div>
                            <div class="grid grid-cols-4 gap-2">
                                <button type="button" data-maintenance-duration="00:15:00" class="maintenance-quick-btn rounded-xl bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold">15m</button>
                                <button type="button" data-maintenance-duration="00:30:00" class="maintenance-quick-btn rounded-xl bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold">30m</button>
                                <button type="button" data-maintenance-duration="01:00:00" class="maintenance-quick-btn rounded-xl bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold">1h</button>
                                <button type="button" data-maintenance-duration="02:00:00" class="maintenance-quick-btn rounded-xl bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-extrabold">2h</button>
                            </div>
                            <div>
                                <label class="text-sm font-extrabold text-gray-700 dark:text-gray-200">Message for users</label>
                                <textarea id="maintenance-message-input" rows="3" maxlength="180" class="mt-2 w-full rounded-2xl bg-gray-100 dark:bg-gray-700 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500">${escapeHtml(message)}</textarea>
                            </div>
                            <div class="rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 text-sm text-blue-800 dark:text-blue-100">
                                Users will see a full-screen maintenance page with countdown. Admin account will keep working normally.
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <button id="maintenance-off-btn" class="rounded-2xl bg-gray-100 dark:bg-gray-700 px-4 py-4 font-extrabold text-gray-700 dark:text-gray-100">Turn Off</button>
                            <button id="maintenance-save-btn" class="rounded-2xl bg-blue-600 px-4 py-4 font-extrabold text-white shadow-lg shadow-blue-200 dark:shadow-none">${active ? 'Update Timer' : 'Start Maintenance'}</button>
                        </div>
                    </div>
                </div>
                ${getPageFooter()}`, {
                returnTo: parentSection,
                keepBottomNav: false,
                onBack: () => {
                    if (adminMaintenanceInterval) {
                        clearInterval(adminMaintenanceInterval);
                        adminMaintenanceInterval = null;
                    }
                    handleBack();
                }
            });

            if (adminMaintenanceInterval) {
                clearInterval(adminMaintenanceInterval);
                adminMaintenanceInterval = null;
            }

            if (active && endMillis) {
                adminMaintenanceInterval = setInterval(() => {
                    const diff = endMillis - Date.now();
                    if (diff <= 0) {
                        clearInterval(adminMaintenanceInterval);
                        adminMaintenanceInterval = null;
                        appConfigCache = { ...appConfigCache, maintenanceEnabled: false, maintenanceEndsAt: null, maintenanceEndsAtMillis: 0 };
                        rememberAppConfig(appConfigCache);
                        applyMaintenanceMode();
                        showMaintenanceSettingsPage();
                        return;
                    }
                    const valEl = document.getElementById('admin-maintenance-timer-val');
                    if (valEl) {
                        valEl.textContent = formatMaintenanceCountdown(diff);
                    }
                }, 1000);
            }

            document.getElementById('maintenance-configure-btn')?.addEventListener('click', () => {
                const container = document.getElementById('maintenance-form-container');
                const label = document.getElementById('maintenance-configure-chevron');
                if (container && label) {
                    const isHidden = container.classList.toggle('hidden');
                    label.textContent = isHidden ? '➕ Show' : '➖ Hide';
                }
            });

            const durationInput = document.getElementById('maintenance-duration-input');
            durationInput?.addEventListener('blur', () => {
                const seconds = parseMaintenanceDurationInput(durationInput.value);
                if (seconds) durationInput.value = formatMaintenanceDurationInput(seconds);
            });
            document.querySelectorAll('.maintenance-quick-btn').forEach(button => {
                button.addEventListener('click', () => {
                    const input = document.getElementById('maintenance-duration-input');
                    if (input) input.value = button.dataset.maintenanceDuration || '00:30:00';
                });
            });
            document.getElementById('maintenance-off-btn')?.addEventListener('click', handleTurnOffMaintenance);
            document.getElementById('maintenance-save-btn')?.addEventListener('click', handleSaveMaintenanceSettings);
        };

const handleSaveMaintenanceSettings = async () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const saveBtn = document.getElementById('maintenance-save-btn');
            const durationSeconds = parseMaintenanceDurationInput(document.getElementById('maintenance-duration-input')?.value || '');
            const message = String(document.getElementById('maintenance-message-input')?.value || '').trim()
                || 'We are improving your wallet experience. Please wait until the maintenance window is complete.';
            if (!durationSeconds) {
                return showNotification('Please enter time as HH:MM:SS between 00:01:00 and 72:00:00.', true);
            }
            try {
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';
                }
                const endDate = new Date(Date.now() + durationSeconds * 1000);
                const writePromise = setDoc(doc(db, `artifacts/${appId}/settings`, 'app_config'), {
                    maintenanceEnabled: true,
                    maintenanceEndsAt: Timestamp.fromDate(endDate),
                    maintenanceDurationSeconds: durationSeconds,
                    maintenanceMessage: message,
                    maintenanceUpdatedAt: serverTimestamp(),
                    maintenanceUpdatedBy: currentUser.uid
                }, { merge: true });

                await Promise.race([
                    writePromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);

                showNotification('Maintenance mode started.');
                appConfigCache = {
                    ...appConfigCache,
                    maintenanceEnabled: true,
                    maintenanceEndsAt: Timestamp.fromDate(endDate),
                    maintenanceEndsAtMillis: endDate.getTime(),
                    maintenanceDurationSeconds: durationSeconds,
                    maintenanceMessage: message
                };
                rememberAppConfig(appConfigCache);
                applyMaintenanceMode();
                showMaintenanceSettingsPage();
            } catch (error) {
                console.error('Maintenance settings save failed:', error);
                const message = String(error?.message || '');
                if (message === 'timeout') {
                    showNotification('Database write timed out. Daily quota may be exceeded.', true);
                } else if (/resource-exhausted|quota exceeded/i.test(message)) {
                    showNotification('Database daily quota exceeded. Please try again later.', true);
                } else {
                    showNotification('Could not save maintenance settings. Please try again.', true);
                }
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = isMaintenanceConfigActive(appConfigCache) ? 'Update Timer' : 'Start Maintenance';
                }
            }
        };

const showWhatsNewSettingsPage = () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const parentSection = currentMainSection === 'admin' ? 'admin' : 'settings';
            const handleBack = parentSection === 'admin' ? showAdminMainPage : showSettingsPage;
            const enabled = appConfigCache.whatsNewEnabled !== false && appConfigCache.whats_new_enabled !== false;
            const title = appConfigCache.whatsNewTitle || appConfigCache.whats_new_title || "What's New";
            const message = appConfigCache.whatsNewMessage || appConfigCache.whats_new_message || '';
            const updatedMillis = timestampToMillis(appConfigCache.whatsNewUpdatedAt || appConfigCache.whats_new_updated_at || 0);
            const updatedText = updatedMillis ? new Date(updatedMillis).toLocaleString('en-IN') : 'Not sent yet';

            showPage(`
                ${getPageHeader("What's New")}
                <div class="mx-auto max-w-lg space-y-4">
                    <div class="rounded-3xl bg-gradient-to-br from-indigo-600 via-blue-600 to-emerald-500 p-5 text-white shadow-xl">
                        <p class="text-xs font-black uppercase tracking-[0.25em] text-white/70">User Popup</p>
                        <h3 class="mt-2 text-2xl font-black">What's New Message</h3>
                        <p class="mt-2 text-sm text-white/75">Last update: ${escapeHtml(updatedText)}</p>
                    </div>
                    <button id="whats-new-configure-btn" class="w-full rounded-2xl bg-white dark:bg-gray-800 border border-gray-150 dark:border-gray-700 py-3.5 px-4 font-extrabold text-sm text-gray-800 dark:text-white flex items-center justify-between gap-2 shadow-sm hover:scale-[1.01] active:scale-[0.99] transition select-none">
                        <span class="flex items-center gap-2">✍️ Edit / Create Update Message</span>
                        <span id="whats-new-configure-chevron" class="text-xs font-bold text-gray-400">➕ Show</span>
                    </button>

                    <div id="whats-new-form-container" class="hidden space-y-4 transition-all duration-300">
                        <div class="rounded-2xl border border-gray-100 bg-white p-5 shadow-md dark:border-gray-700 dark:bg-gray-800">
                            <label class="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-sm font-black dark:bg-gray-700">
                                <span>Show popup to users</span>
                                <input id="whats-new-enabled-input" type="checkbox" ${enabled ? 'checked' : ''} class="h-5 w-5 accent-indigo-600">
                            </label>
                            <div class="mt-4">
                                <label class="text-sm font-black text-gray-700 dark:text-gray-200">Popup title</label>
                                <input id="whats-new-title-input" maxlength="80" value="${escapeHtml(title)}" class="mt-2 w-full rounded-2xl bg-gray-100 px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700">
                            </div>
                            <div class="mt-4">
                                <label class="text-sm font-black text-gray-700 dark:text-gray-200">Message</label>
                                <textarea id="whats-new-message-input" rows="7" maxlength="1200" placeholder="Type new update for users..." class="mt-2 w-full rounded-2xl bg-gray-100 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700">${escapeHtml(message)}</textarea>
                                <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">Saving creates a new update ID, so every user will see it once. After they close it, it will not repeat until you save another update.</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <button id="whats-new-disable-btn" class="rounded-2xl bg-gray-100 dark:bg-gray-700 px-4 py-4 font-black text-gray-700 dark:bg-gray-700 dark:text-gray-100">Turn Off</button>
                            <button id="whats-new-save-btn" class="rounded-2xl bg-indigo-600 px-4 py-4 font-black text-white shadow-lg shadow-indigo-200 dark:shadow-none">Save & Show</button>
                        </div>
                    </div>
                    
                    <!-- User Seen Status Section -->
                    <div class="rounded-2xl border border-gray-100 bg-white p-5 shadow-md dark:border-gray-700 dark:bg-gray-800">
                        <div class="flex items-center justify-between">
                            <div>
                                <h4 class="text-sm font-black text-gray-850 dark:text-white">Seen Status</h4>
                                <p class="text-[11px] text-gray-450 mt-0.5">Users who opened the app and saw this update.</p>
                            </div>
                            <button id="whats-new-seen-btn" class="rounded-xl bg-orange-100 dark:bg-orange-950/40 px-3.5 py-2 text-xs font-black text-orange-600 dark:text-orange-300 hover:bg-orange-200 transition">
                                👥 View Users (Loading...)
                            </button>
                        </div>
                        <div id="whats-new-seen-list-container" class="mt-4 hidden border-t border-gray-100 dark:border-gray-750 pt-4 max-h-60 overflow-y-auto space-y-2">
                            <p class="text-center text-xs text-gray-400 py-4">Loading users...</p>
                        </div>
                    </div>
                </div>
                ${getPageFooter()}`, { returnTo: parentSection, keepBottomNav: false, onBack: handleBack });

            // Load Seen Users Async
            const loadWhatsNewSeenUsers = async () => {
                const id = getWhatsNewId(appConfigCache);
                const btn = document.getElementById('whats-new-seen-btn');
                const container = document.getElementById('whats-new-seen-list-container');
                if (!id) {
                    if (btn) btn.textContent = '👥 View Users (0)';
                    if (container) container.innerHTML = '<p class="text-center text-xs text-gray-400 py-4">No update configured.</p>';
                    return;
                }
                try {
                    const snap = await getDocs(query(
                        collection(db, `artifacts/${appId}/public/data/whats_new_seen/${id}/users`),
                        orderBy('seenAt', 'desc')
                    ));
                    
                    // Resolve user details using allUsersCache
                    const users = snap.docs.map(doc => {
                        const d = doc.data();
                        const uid = d.userId || doc.id;
                        const profile = allUsersCache.find(x => x.id === uid || x.uid === uid) || {};
                        return {
                            ...d,
                            userId: uid,
                            name: profile.name || d.name || 'Unknown User',
                            mobile: profile.mobile || d.mobile || 'No mobile',
                            email: profile.email || 'No email'
                        };
                    });
                    
                    const count = users.length;
                    if (btn) {
                        btn.textContent = `👥 View Users (${count})`;
                    }
                    if (container) {
                        if (count === 0) {
                            container.innerHTML = `<p class="text-center text-xs text-gray-400 py-4">No users have seen this update yet.</p>`;
                        } else {
                            container.innerHTML = users.map(u => {
                                const time = u.seenAt ? new Date(timestampToMillis(u.seenAt)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Unknown';
                                const initial = (u.name && u.name !== 'Unknown User') ? u.name.charAt(0).toUpperCase() : '?';
                                return `
                                    <div class="flex items-center gap-3 justify-between text-xs bg-gray-50/70 dark:bg-gray-900/30 p-2.5 rounded-xl border border-gray-150 dark:border-gray-800 shadow-sm">
                                        <div class="flex items-center gap-3.5 min-w-0">
                                            <div class="h-8 w-8 rounded-full bg-orange-100 dark:bg-orange-950 flex items-center justify-center font-bold text-orange-600 shrink-0 text-sm">
                                                ${initial}
                                            </div>
                                            <div class="min-w-0 flex-1">
                                                <p class="font-extrabold text-gray-800 dark:text-white truncate">${escapeHtml(u.name)}</p>
                                                <div class="flex flex-col gap-0.5 mt-0.5 text-[10px] text-gray-400 font-semibold">
                                                    <span class="text-orange-500 font-bold">📱 ${escapeHtml(u.mobile)}</span>
                                                    ${u.email && u.email !== 'No email' ? `<span class="truncate">✉ ${escapeHtml(u.email)}</span>` : ''}
                                                </div>
                                            </div>
                                        </div>
                                        <span class="text-[9px] text-gray-400 font-semibold shrink-0 text-right">${time}</span>
                                    </div>
                                `;
                            }).join('');
                        }
                    }
                } catch (err) {
                    console.error("Failed to load seen users:", err);
                    if (btn) btn.textContent = '👥 View Users (Error)';
                    if (container) container.innerHTML = '<p class="text-center text-xs text-red-500 py-4">Error loading users.</p>';
                }
            };

            loadWhatsNewSeenUsers();

            document.getElementById('whats-new-seen-btn')?.addEventListener('click', () => {
                const container = document.getElementById('whats-new-seen-list-container');
                if (container) {
                    container.classList.toggle('hidden');
                }
            });

            document.getElementById('whats-new-configure-btn')?.addEventListener('click', () => {
                const container = document.getElementById('whats-new-form-container');
                const label = document.getElementById('whats-new-configure-chevron');
                if (container && label) {
                    const isHidden = container.classList.toggle('hidden');
                    label.textContent = isHidden ? '➕ Show' : '➖ Hide';
                }
            });

            document.getElementById('whats-new-save-btn')?.addEventListener('click', handleSaveWhatsNewSettings);
            document.getElementById('whats-new-disable-btn')?.addEventListener('click', handleDisableWhatsNew);
        };

const handleSaveWhatsNewSettings = async () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const saveBtn = document.getElementById('whats-new-save-btn');
            const title = String(document.getElementById('whats-new-title-input')?.value || '').trim() || "What's New";
            const message = String(document.getElementById('whats-new-message-input')?.value || '').trim();
            const enabled = !!document.getElementById('whats-new-enabled-input')?.checked;
            if (!message) return showNotification('Please type What\'s New message.', true);
            const whatsNewId = `wn-${Date.now()}`;
            try {
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';
                }
                await setDoc(doc(db, `artifacts/${appId}/settings`, 'app_config'), {
                    whatsNewEnabled: enabled,
                    whatsNewTitle: title,
                    whatsNewMessage: message,
                    whatsNewId,
                    whatsNewUpdatedAt: serverTimestamp(),
                    whatsNewUpdatedBy: currentUser.uid
                }, { merge: true });
                appConfigCache = {
                    ...appConfigCache,
                    whatsNewEnabled: enabled,
                    whatsNewTitle: title,
                    whatsNewMessage: message,
                    whatsNewId,
                    whatsNewUpdatedAt: Date.now()
                };
                showNotification(enabled ? "What's New popup saved." : "What's New saved but turned off.");
                showWhatsNewSettingsPage();
            } catch (error) {
                console.error("What's New save failed:", error);
                showNotification("Could not save What's New message. Please try again.", true);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save & Show';
                }
            }
        };

const showReferralSettingsPage = () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const parentSection = currentMainSection === 'admin' ? 'admin' : 'settings';
            const handleBack = parentSection === 'admin' ? showAdminMainPage : showSettingsPage;
            const reward = getReferralRewardAmount();
            showPage(`
                ${getPageHeader('Referral Price')}
                <div class="mx-auto max-w-lg space-y-4">
                    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-600 to-blue-700 p-5 text-white shadow-xl">
                        <div class="absolute -right-10 -top-10 h-32 w-32 rounded-full border border-white/20"></div>
                        <div class="absolute right-5 bottom-5 h-14 w-14 rounded-2xl bg-white/10"></div>
                        <p class="relative text-xs font-black uppercase tracking-[0.25em] text-white/70">Refer & Earn</p>
                        <h3 class="relative mt-2 text-3xl font-black">${formatCurrency(reward).replace('.00', '')}</h3>
                        <p class="relative mt-1 text-sm font-semibold text-white/75">This amount will show on the user referral page.</p>
                    </section>
                    <section class="rounded-2xl border border-gray-100 bg-white p-5 shadow-md dark:border-gray-700 dark:bg-gray-800">
                        <label class="text-sm font-black text-gray-700 dark:text-gray-200">Referral reward amount</label>
                        <div class="mt-2 flex items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-500 dark:bg-gray-700">
                            <span class="text-xl font-black text-gray-500 dark:text-gray-300">&#8377;</span>
                            <input id="referral-price-input" type="number" min="0" step="1" value="${reward}" class="min-w-0 flex-1 bg-transparent text-2xl font-black text-gray-950 outline-none dark:text-white">
                        </div>
                        <p class="mt-3 text-xs font-semibold text-gray-500 dark:text-gray-400">The referral link itself is still marked Coming Soon for users.</p>
                    </section>
                    <button id="referral-price-save-btn" class="w-full rounded-2xl bg-emerald-600 px-4 py-4 font-black text-white shadow-lg shadow-emerald-200 transition active:scale-[0.99] dark:shadow-none">Save Referral Price</button>
                </div>
                ${getPageFooter()}`, { returnTo: parentSection, keepBottomNav: false, onBack: handleBack });

            document.getElementById('referral-price-save-btn')?.addEventListener('click', handleSaveReferralSettings);
        };

const handleSaveReferralSettings = async () => {
            if (!currentUser || currentUser.uid !== ADMIN_UID) return showNotification('Admin access only.', true);
            const saveBtn = document.getElementById('referral-price-save-btn');
            const reward = Number(document.getElementById('referral-price-input')?.value || 0);
            if (!Number.isFinite(reward) || reward < 0) {
                return showNotification('Please enter a valid referral amount.', true);
            }
            try {
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';
                }
                await setDoc(doc(db, `artifacts/${appId}/settings`, 'app_config'), {
                    referralRewardAmount: reward,
                    referralRewardUpdatedAt: serverTimestamp(),
                    referralRewardUpdatedBy: currentUser.uid
                }, { merge: true });
                appConfigCache = {
                    ...appConfigCache,
                    referralRewardAmount: reward,
                    referralRewardUpdatedAt: Date.now()
                };
                rememberAppConfig(appConfigCache);
                showNotification('Referral price updated.');
                showReferralSettingsPage();
            } catch (error) {
                console.error('Referral settings save failed:', error);
                showNotification('Could not save referral price. Please try again.', true);
            } finally {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save Referral Price';
                }
            }
        };

const handleUpdateProfile = async () => {
            const newName = document.getElementById('profile-name-input').value.trim();
            const newMobile = normalizePhoneDigits(document.getElementById('profile-mobile-input').value);
            const selectedPaymentMethod = document.getElementById('profile-payment-method').value;
            const paymentMethod = selectedPaymentMethod || normalizeProfilePaymentMethod(currentUserData);
            const isAdminProfile = currentUser?.uid === ADMIN_UID;

            if (!newName || !newMobile) {
                return showNotification('Name and Mobile are required.', true);
            }

            // Phone number validation: must be exactly 10 digits
            const phoneRegex = /^\d{10}$/;
            if (!phoneRegex.test(newMobile)) {
                return showNotification('Mobile number must be exactly 10 digits.', true);
            }
            let existingMobileUser = null;
            try {
                existingMobileUser = await findExistingUserByMobile(newMobile, currentUser?.uid);
            } catch (error) {
                console.warn('Mobile duplicate check failed:', error);
                return showNotification('Could not verify mobile number. Please try again.', true);
            }
            if (existingMobileUser) return showNotification('This mobile number is already used by another account.', true);

            let paymentDetails = getProfilePaymentDetails(paymentMethod);

            // Collect payment details based on selected method
            switch (paymentMethod) {
                case 'upi':
                    const upiId = document.getElementById('payment-upi-id')?.value.trim();
                    if (!upiId) {
                        return showNotification('UPI ID is required for UPI payments.', true);
                    }
                    paymentDetails = { upiId };
                    break;

                case 'bank':
                    const accountNumber = document.getElementById('payment-bank-account')?.value.trim();
                    const ifsc = document.getElementById('payment-ifsc')?.value.trim();
                    const bankName = document.getElementById('payment-bank-name')?.value.trim();
                    const accountName = document.getElementById('payment-account-name')?.value.trim();

                    if (!accountNumber || !ifsc || !bankName || !accountName) {
                        return showNotification('All bank details are required.', true);
                    }
                    paymentDetails = { accountNumber, ifsc, bankName, accountName };
                    break;

                case 'play_store':
                case 'amazon_gift':
                case 'flipkart_gift':
                case 'paypal':
                    const email = document.getElementById('payment-email')?.value.trim();
                    if (!email) {
                        return showNotification('Email is required for this payment method.', true);
                    }
                    paymentDetails = { email };
                    break;
            }
            const profilePhoto = document.getElementById('profile-avatar-url')?.value || '';
            const profileUpdate = {
                name: newName,
                mobile: newMobile,
                phoneNumber: newMobile,
                profilePhoto: profilePhoto || currentUserData?.profilePhoto || '',
                paymentMethod: paymentMethod,
                paymentDetails: paymentMethod ? paymentDetails : getProfilePaymentDetails(currentUserData?.paymentMethod || '')
            };
            if (paymentMethod === 'upi') {
                profileUpdate.upiId = paymentDetails.upiId || '';
            } else if (paymentMethod === 'bank') {
                profileUpdate.accountNumber = paymentDetails.accountNumber || '';
                profileUpdate.ifsc = paymentDetails.ifsc || '';
                profileUpdate.bankName = paymentDetails.bankName || '';
                profileUpdate.accountName = paymentDetails.accountName || '';
            } else if (['play_store', 'amazon_gift', 'flipkart_gift', 'paypal'].includes(paymentMethod)) {
                profileUpdate.paymentEmail = paymentDetails.email || '';
            }

            if (isAdminProfile) {
                const whatsappNumber = document.getElementById('profile-whatsapp-input')?.value.trim() || newMobile;
                if (!/^\d{10,15}$/.test(whatsappNumber)) {
                    return showNotification('WhatsApp number must be 10 to 15 digits.', true);
                }

                const websiteLinks = Array.from(document.querySelectorAll('.profile-website-input'))
                    .map(input => input.value.trim())
                    .filter(Boolean)
                    .slice(0, 3);
                const invalidLink = websiteLinks.find(link => !/^https?:\/\/.+\..+/.test(link));
                if (invalidLink) {
                    return showNotification('Website links must start with http:// or https://', true);
                }
                profileUpdate.whatsappNumber = whatsappNumber;
                profileUpdate.websiteLinks = websiteLinks.slice(0, 3);
            }

            try {
                const userRef = doc(db, `artifacts/${appId}/public/data/users`, currentUser.uid);
                await setDoc(userRef, profileUpdate, { merge: true });
                currentUserData = { ...(currentUserData || {}), ...profileUpdate };
                writeJsonCache(getUserCacheKey(currentUser.uid), sanitizeUserForCache(currentUserData, currentUser.uid));
                showNotification('Profile updated successfully!');
                hidePage();
            } catch (e) {
                console.error('Failed to update profile:', e);
                showNotification('Error: Could not update profile.', true);
            }
        };

// Expose functions to window for global access
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.getProfileAvatarUrl = getProfileAvatarUrl;
window.getBackendProfilePayload = getBackendProfilePayload;
window.getProfilePaymentDetails = getProfilePaymentDetails;
window.normalizeProfilePaymentMethod = normalizeProfilePaymentMethod;
window.getRawProfilePaymentMethod = getRawProfilePaymentMethod;
window.getProfilePaymentMethodLabel = getProfilePaymentMethodLabel;
window.showProfilePage = showProfilePage;
window.showSettingsPage = showSettingsPage;
window.showMaintenanceSettingsPage = showMaintenanceSettingsPage;
window.handleSaveMaintenanceSettings = handleSaveMaintenanceSettings;
window.showWhatsNewSettingsPage = showWhatsNewSettingsPage;
window.handleSaveWhatsNewSettings = handleSaveWhatsNewSettings;
window.showReferralSettingsPage = showReferralSettingsPage;
window.handleSaveReferralSettings = handleSaveReferralSettings;
window.handleUpdateProfile = handleUpdateProfile;
window.showSavedPaymentMethodsPage = showSavedPaymentMethodsPage;
window.showEditPaymentMethodModal = showEditPaymentMethodModal;
window.showEditFullNameModal = showEditFullNameModal;
window.showAdminSupportProfileModal = showAdminSupportProfileModal;
