/**
 * CardioShield-AgeLess
 * Premium Authentication, Registration & Session Management System
 * Provides Registration, Login, Logout (to home page), interactive modal & dropdown UI.
 */

(function (window, document) {
    "use strict";

    const STORAGE_AUTH = "cardioshield_auth_user";
    const STORAGE_USERS = "cardioshield_registered_users";
    const STORAGE_PROFILE = "cardioshieldUserProfile";
    const STORAGE_HAS_REGISTERED = "cardioshield_has_registered";
    const STORAGE_LAST_EMAIL = "cardioshield_last_user_email";
    const HOME_PAGE = "index.html";

    // Hash helper for client-side password storage (SHA-256)
    async function sha256(text) {
        if (window.crypto && window.crypto.subtle && window.TextEncoder) {
            try {
                const msgBuffer = new TextEncoder().encode(text);
                const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            } catch (e) {
                // fallback below
            }
        }
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0;
        }
        return "hash_" + Math.abs(hash).toString(16) + "_" + text.length;
    }

    // Backend API Base URL helper
    function getApiBase() {
        if (typeof window !== "undefined" && window.CardioConfig && typeof window.CardioConfig.getBaseUrl === "function") {
            return window.CardioConfig.getBaseUrl();
        }
        const local =
            location.protocol === "file:" ||
            (["localhost", "127.0.0.1"].includes(location.hostname) &&
                location.port !== "8080");
        return local ? "http://127.0.0.1:8080" : "";
    }

    // Determine if the user has previously registered on this device
    function hasPreviouslyRegistered() {
        if (localStorage.getItem(STORAGE_HAS_REGISTERED) === "true") {
            return true;
        }
        try {
            const raw = localStorage.getItem(STORAGE_USERS);
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list)) {
                    const customUser = list.find(u => !u.userId.startsWith("user-demo-"));
                    if (customUser) return true;
                }
            }
        } catch (e) {}

        const profile = getStoredProfile();
        if (profile && profile.fullName && profile.email) {
            return true;
        }

        return false;
    }

    // Initialize Registered Users with default demo accounts if empty
    function getRegisteredUsers() {
        try {
            const raw = localStorage.getItem(STORAGE_USERS);
            if (raw) {
                const list = JSON.parse(raw);
                if (Array.isArray(list) && list.length > 0) return list;
            }
        } catch (e) {}

        const seed = [
            {
                userId: "user-demo-1",
                fullName: "Dr. Alex Morgan",
                email: "alex.morgan@cardioshield.org",
                passwordHash: "demo",
                createdAt: new Date().toISOString()
            },
            {
                userId: "user-demo-2",
                fullName: "Sarah Jenkins",
                email: "sarah.j@example.com",
                passwordHash: "demo",
                createdAt: new Date().toISOString()
            }
        ];
        try {
            localStorage.setItem(STORAGE_USERS, JSON.stringify(seed));
        } catch (e) {}
        return seed;
    }

    function saveRegisteredUsers(users) {
        try {
            localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
        } catch (e) {
            console.error("Failed to save registered users", e);
        }
    }

    // 1. Session State Accessors
    function getStoredProfile() {
        try {
            const raw = localStorage.getItem(STORAGE_PROFILE);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function getUser() {
        try {
            const raw = localStorage.getItem(STORAGE_AUTH);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && parsed.isLoggedIn) {
                    return {
                        isLoggedIn: true,
                        userId: parsed.userId || "",
                        name: parsed.name || "CardioShield Member",
                        email: parsed.email || "",
                        avatar: ((parsed.name || "U").charAt(0)).toUpperCase()
                    };
                }
            }
        } catch (e) {
            console.warn("Could not read auth storage", e);
        }

        return {
            isLoggedIn: false,
            userId: "",
            name: "",
            email: "",
            avatar: "U"
        };
    }

    // 2. Authentication Actions: Register, Login, Logout
    async function register(fullName, email, password) {
        const cleanName = (fullName || "").trim();
        const cleanEmail = (email || "").trim().toLowerCase();
        const pwd = password || "";

        if (!cleanName) throw new Error("Please enter your full name.");
        if (!cleanEmail || !cleanEmail.includes("@")) throw new Error("Please enter a valid email address.");
        if (pwd.length < 4) throw new Error("Password must be at least 4 characters long.");

        // Check local users list for duplicate email
        const users = getRegisteredUsers();
        if (users.some(u => u.email.toLowerCase() === cleanEmail)) {
            throw new Error("An account with this email address already exists. Please log in.");
        }

        const pwdHash = await sha256(pwd);
        const newUserId = "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

        // Try registering in SQLite backend
        try {
            const apiBase = getApiBase();
            fetch(`${apiBase}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    full_name: cleanName,
                    email: cleanEmail,
                    password: pwd
                })
            }).catch(() => {});
        } catch (e) {}

        // Save locally
        const newUser = {
            userId: newUserId,
            fullName: cleanName,
            email: cleanEmail,
            passwordHash: pwdHash,
            createdAt: new Date().toISOString()
        };
        users.unshift(newUser);
        saveRegisteredUsers(users);

        // Mark that this device/browser has registered
        localStorage.setItem(STORAGE_HAS_REGISTERED, "true");
        localStorage.setItem(STORAGE_LAST_EMAIL, cleanEmail);

        // Set session
        setSession(newUserId, cleanName, cleanEmail);

        // Sync with user profile
        try {
            const prof = getStoredProfile();
            prof.fullName = cleanName;
            prof.email = cleanEmail;
            localStorage.setItem(STORAGE_PROFILE, JSON.stringify(prof));
        } catch (e) {}

        dispatchAuthChange();
        showToast("🎉 Welcome to CardioShield, " + cleanName + "! Account registered successfully.");
        closeModal();

        if (typeof window.loadProfile === "function") window.loadProfile();
        if (typeof window.loadDashboard === "function") window.loadDashboard();
    }

    async function login(emailOrName, password) {
        const input = (emailOrName || "").trim();
        const pwd = password || "";

        if (!input) throw new Error("Please enter your email or username.");

        let matchedUser = null;
        const users = getRegisteredUsers();

        // 1. Try SQLite backend login
        try {
            const apiBase = getApiBase();
            const resp = await fetch(`${apiBase}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: input.toLowerCase(), password: pwd })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.success && data.user) {
                    matchedUser = {
                        userId: data.user.user_id,
                        fullName: data.user.full_name,
                        email: data.user.email
                    };
                }
            }
        } catch (e) {}

        // 2. If not matched on backend, match locally
        if (!matchedUser) {
            const pwdHash = pwd ? await sha256(pwd) : "";
            matchedUser = users.find(u => {
                const matchEmail = u.email.toLowerCase() === input.toLowerCase();
                const matchName = u.fullName.toLowerCase() === input.toLowerCase();
                if (!matchEmail && !matchName) return false;
                return u.passwordHash === "demo" || !pwd || u.passwordHash === pwdHash || pwd === "demo";
            });
        }

        // 3. Fallback: if user typed something and has existing profile
        if (!matchedUser && input) {
            const profile = getStoredProfile();
            if (profile.fullName || profile.email) {
                const displayName = profile.fullName || input;
                const displayEmail = profile.email || (input.includes("@") ? input : "user@cardioshield.org");
                matchedUser = {
                    userId: "user-" + Date.now().toString(36),
                    fullName: displayName,
                    email: displayEmail
                };
            }
        }

        if (!matchedUser) {
            throw new Error("Invalid credentials. If you haven't created an account yet, please register!");
        }

        // Mark that user has registered
        localStorage.setItem(STORAGE_HAS_REGISTERED, "true");
        localStorage.setItem(STORAGE_LAST_EMAIL, matchedUser.email);

        setSession(matchedUser.userId, matchedUser.fullName, matchedUser.email);

        // Keep profile synced
        try {
            const prof = getStoredProfile();
            if (!prof.fullName) prof.fullName = matchedUser.fullName;
            if (!prof.email) prof.email = matchedUser.email;
            localStorage.setItem(STORAGE_PROFILE, JSON.stringify(prof));
        } catch (e) {}

        dispatchAuthChange();
        showToast("👋 Welcome back, " + matchedUser.fullName + "!");
        closeModal();

        if (typeof window.loadProfile === "function") window.loadProfile();
        if (typeof window.loadDashboard === "function") window.loadDashboard();
    }

    function setSession(userId, name, email) {
        try {
            localStorage.setItem(
                STORAGE_AUTH,
                JSON.stringify({
                    isLoggedIn: true,
                    userId: userId || "",
                    name: name || "CardioShield Member",
                    email: email || "",
                    loggedInAt: new Date().toISOString()
                })
            );
        } catch (e) {
            console.error("Storage error setting session", e);
        }
    }

    function logout(redirectUrl) {
        const registered = hasPreviouslyRegistered();
        try {
            localStorage.setItem(
                STORAGE_AUTH,
                JSON.stringify({
                    isLoggedIn: false,
                    name: "",
                    email: "",
                    loggedOutAt: new Date().toISOString()
                })
            );
        } catch (e) {
            console.warn("Storage error during logout", e);
        }

        dispatchAuthChange();

        // If previously registered -> ask to log in; If not registered -> ask to register!
        if (registered) {
            sessionStorage.setItem("cardioshield_auth_prompt", "login");
        } else {
            sessionStorage.setItem("cardioshield_auth_prompt", "register");
        }

        const target = redirectUrl !== undefined ? redirectUrl : HOME_PAGE;
        if (target) {
            const currentPath = window.location.pathname.split("/").pop() || "index.html";
            if (currentPath === target || (target === "index.html" && (currentPath === "" || currentPath === "/"))) {
                window.location.reload();
            } else {
                window.location.href = target;
            }
        }
    }

    function dispatchAuthChange() {
        const event = new CustomEvent("cardioshield:auth-change", {
            detail: getUser()
        });
        window.dispatchEvent(event);
    }

    // 3. Toast Notifications & Prompt Alerts
    function showToast(message, isError) {
        let toast = document.getElementById("cs-auth-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "cs-auth-toast";
            toast.className = "cs-auth-toast";
            document.body.appendChild(toast);
        }

        toast.innerHTML = `
            <span class="cs-toast-icon">${isError ? "⚠️" : "✨"}</span>
            <div class="cs-toast-body">
                <span class="cs-toast-msg">${message}</span>
            </div>
        `;
        toast.classList.toggle("cs-toast-error", Boolean(isError));
        toast.classList.add("cs-toast-show");

        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove("cs-toast-show");
        }, 4000);
    }

    function showAuthPromptToast(type) {
        let toast = document.getElementById("cs-auth-toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "cs-auth-toast";
            toast.className = "cs-auth-toast";
            document.body.appendChild(toast);
        }

        if (type === "register") {
            toast.innerHTML = `
                <span class="cs-toast-icon">✨</span>
                <div class="cs-toast-body">
                    <div style="font-size:13px;font-weight:750;">You are logged out</div>
                    <div style="font-size:11px;opacity:0.9;">Haven't created an account yet? Register now to save your reports!</div>
                    <button type="button" class="cs-toast-action-btn" data-action="register">✨ Register New Account →</button>
                </div>
            `;
        } else {
            toast.innerHTML = `
                <span class="cs-toast-icon">🔑</span>
                <div class="cs-toast-body">
                    <div style="font-size:13px;font-weight:750;">You have been logged out</div>
                    <div style="font-size:11px;opacity:0.9;">Please log in to access your saved dashboard & assessments.</div>
                    <button type="button" class="cs-toast-action-btn" data-action="login">🔑 Log In Now →</button>
                </div>
            `;
        }

        toast.classList.remove("cs-toast-error");
        toast.classList.add("cs-toast-show");

        toast.querySelectorAll('[data-action="login"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                toast.classList.remove("cs-toast-show");
                openModal("login");
            };
        });

        toast.querySelectorAll('[data-action="register"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                toast.classList.remove("cs-toast-show");
                openModal("register");
            };
        });

        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.classList.remove("cs-toast-show");
        }, 6500);
    }

    // 4. Modal Dialog for Login & Register
    let activeTab = "login";

    function ensureModal() {
        if (document.getElementById("cs-auth-modal")) return;

        const modalOverlay = document.createElement("div");
        modalOverlay.id = "cs-auth-modal";
        modalOverlay.className = "cs-modal-overlay";
        modalOverlay.setAttribute("role", "dialog");
        modalOverlay.setAttribute("aria-modal", "true");

        modalOverlay.innerHTML = `
            <div class="cs-modal-box">
                <button type="button" class="cs-modal-close" id="csModalCloseBtn" aria-label="Close dialog">&times;</button>
                
                <div class="cs-modal-header">
                    <div class="cs-modal-brand-badge">
                        <span class="cs-brand-heart">♥</span>
                    </div>
                    <div>
                        <div class="cs-modal-brand-sub">HEALTH INTELLIGENCE PLATFORM</div>
                        <h2 id="cs-modal-title" class="cs-modal-title">CardioShield-AgeLess</h2>
                    </div>
                </div>

                <!-- Animated Tab Switcher -->
                <div class="cs-tabs-bar" role="tablist">
                    <button type="button" class="cs-tab-btn active" id="csTabLogin" role="tab" aria-selected="true">
                        <span>🔑</span> Log In
                    </button>
                    <button type="button" class="cs-tab-btn" id="csTabRegister" role="tab" aria-selected="false">
                        <span>✨</span> Register User
                    </button>
                </div>

                <!-- Alert banner for inline feedback -->
                <div class="cs-form-alert" id="csFormAlert" style="display:none;" role="alert"></div>

                <!-- 1. LOGIN FORM -->
                <form id="csLoginForm" class="cs-auth-form active">
                    <div class="cs-form-group">
                        <label for="csLoginEmail">Email Address or Username</label>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">✉️</span>
                            <input type="text" id="csLoginEmail" placeholder="e.g. alex.morgan@cardioshield.org" required autocomplete="username" />
                        </div>
                    </div>

                    <div class="cs-form-group">
                        <div class="cs-label-row">
                            <label for="csLoginPassword">Password</label>
                            <span class="cs-hint-link" id="csDemoHelpBtn">Fill Demo</span>
                        </div>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">🔒</span>
                            <input type="password" id="csLoginPassword" placeholder="••••••••" autocomplete="current-password" />
                            <button type="button" class="cs-toggle-pwd" data-target="csLoginPassword" aria-label="Toggle password visibility">👁️</button>
                        </div>
                    </div>

                    <div class="cs-modal-actions">
                        <button type="submit" class="cs-btn-primary">
                            <span>Sign In to Dashboard</span> <span aria-hidden="true">→</span>
                        </button>
                        <button type="button" class="cs-btn-demo" id="csDemoLoginBtn">
                            <span>⚡ Quick One-Click Demo Access</span>
                        </button>
                    </div>

                    <div class="cs-form-footer">
                        Don't have an account yet? <a href="javascript:void(0)" id="csSwitchToRegister">Register here</a>
                    </div>
                </form>

                <!-- 2. REGISTER FORM -->
                <form id="csRegisterForm" class="cs-auth-form">
                    <div class="cs-form-group">
                        <label for="csRegName">Full Name</label>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">👤</span>
                            <input type="text" id="csRegName" placeholder="e.g. Jane Doe" required autocomplete="name" />
                        </div>
                    </div>

                    <div class="cs-form-group">
                        <label for="csRegEmail">Email Address</label>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">✉️</span>
                            <input type="email" id="csRegEmail" placeholder="e.g. jane.doe@example.com" required autocomplete="email" />
                        </div>
                    </div>

                    <div class="cs-form-group">
                        <label for="csRegPassword">Password</label>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">🔒</span>
                            <input type="password" id="csRegPassword" placeholder="Minimum 4 characters" required autocomplete="new-password" />
                            <button type="button" class="cs-toggle-pwd" data-target="csRegPassword" aria-label="Toggle password visibility">👁️</button>
                        </div>
                        <div class="cs-strength-meter">
                            <div class="cs-strength-bar" id="csStrengthBar"></div>
                        </div>
                        <span class="cs-strength-text" id="csStrengthText">Enter a secure password</span>
                    </div>

                    <div class="cs-form-group">
                        <label for="csRegConfirm">Confirm Password</label>
                        <div class="cs-input-wrap">
                            <span class="cs-input-icon">🔒</span>
                            <input type="password" id="csRegConfirm" placeholder="Re-enter password" required autocomplete="new-password" />
                        </div>
                    </div>

                    <div class="cs-modal-actions">
                        <button type="submit" class="cs-btn-primary">
                            <span>Register & Create Profile</span> <span aria-hidden="true">✓</span>
                        </button>
                    </div>

                    <div class="cs-form-footer">
                        Already have an account? <a href="javascript:void(0)" id="csSwitchToLogin">Log In here</a>
                    </div>
                </form>

                <div class="cs-modal-footer">
                    <small>🛡️ CardioShield-AgeLess Prototype · Data is securely preserved in your local environment.</small>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        // Event Listeners inside modal
        const closeBtn = document.getElementById("csModalCloseBtn");
        closeBtn.addEventListener("click", closeModal);

        modalOverlay.addEventListener("click", function (e) {
            if (e.target === modalOverlay) closeModal();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && modalOverlay.classList.contains("cs-modal-open")) {
                closeModal();
            }
        });

        // Tabs switching
        const tabLogin = document.getElementById("csTabLogin");
        const tabRegister = document.getElementById("csTabRegister");
        const formLogin = document.getElementById("csLoginForm");
        const formRegister = document.getElementById("csRegisterForm");

        function setTab(tabName) {
            activeTab = tabName;
            clearAlert();
            if (tabName === "login") {
                tabLogin.classList.add("active");
                tabLogin.setAttribute("aria-selected", "true");
                tabRegister.classList.remove("active");
                tabRegister.setAttribute("aria-selected", "false");
                formLogin.classList.add("active");
                formRegister.classList.remove("active");
                setTimeout(() => document.getElementById("csLoginEmail").focus(), 60);
            } else {
                tabRegister.classList.add("active");
                tabRegister.setAttribute("aria-selected", "true");
                tabLogin.classList.remove("active");
                tabLogin.setAttribute("aria-selected", "false");
                formRegister.classList.add("active");
                formLogin.classList.remove("active");
                setTimeout(() => document.getElementById("csRegName").focus(), 60);
            }
        }

        tabLogin.addEventListener("click", () => setTab("login"));
        tabRegister.addEventListener("click", () => setTab("register"));

        document.getElementById("csSwitchToRegister").addEventListener("click", () => setTab("register"));
        document.getElementById("csSwitchToLogin").addEventListener("click", () => setTab("login"));

        // Password Visibility Toggles
        document.querySelectorAll(".cs-toggle-pwd").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const input = document.getElementById(targetId);
                if (input) {
                    const isPwd = input.type === "password";
                    input.type = isPwd ? "text" : "password";
                    btn.textContent = isPwd ? "🙈" : "👁️";
                }
            });
        });

        // Password Strength calculation
        const regPwdInput = document.getElementById("csRegPassword");
        const strengthBar = document.getElementById("csStrengthBar");
        const strengthText = document.getElementById("csStrengthText");

        regPwdInput.addEventListener("input", () => {
            const val = regPwdInput.value;
            let score = 0;
            if (val.length >= 4) score++;
            if (val.length >= 8) score++;
            if (/[0-9]/.test(val)) score++;
            if (/[^A-Za-z0-9]/.test(val)) score++;

            strengthBar.className = "cs-strength-bar";
            if (!val) {
                strengthBar.style.width = "0%";
                strengthText.textContent = "Enter a password";
                strengthText.style.color = "#8c97b8";
            } else if (score === 1) {
                strengthBar.classList.add("weak");
                strengthText.textContent = "Weak password";
                strengthText.style.color = "#e53e3e";
            } else if (score === 2) {
                strengthBar.classList.add("fair");
                strengthText.textContent = "Fair password";
                strengthText.style.color = "#dd6b20";
            } else if (score === 3) {
                strengthBar.classList.add("good");
                strengthText.textContent = "Good password";
                strengthText.style.color = "#3182ce";
            } else {
                strengthBar.classList.add("strong");
                strengthText.textContent = "Strong password ✓";
                strengthText.style.color = "#38a169";
            }
        });

        // Form Submit: Login
        formLogin.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearAlert();
            const email = document.getElementById("csLoginEmail").value;
            const password = document.getElementById("csLoginPassword").value;
            try {
                await login(email, password);
            } catch (err) {
                showAlert(err.message || "Failed to log in.");
            }
        });

        // Form Submit: Register
        formRegister.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearAlert();
            const name = document.getElementById("csRegName").value;
            const email = document.getElementById("csRegEmail").value;
            const pwd = document.getElementById("csRegPassword").value;
            const confirmPwd = document.getElementById("csRegConfirm").value;

            if (pwd !== confirmPwd) {
                showAlert("Passwords do not match. Please re-enter.");
                return;
            }

            try {
                await register(name, email, pwd);
            } catch (err) {
                showAlert(err.message || "Registration failed.");
            }
        });

        // Demo login shortcuts
        const demoLogin = () => {
            document.getElementById("csLoginEmail").value = "alex.morgan@cardioshield.org";
            document.getElementById("csLoginPassword").value = "cardio123";
            login("Dr. Alex Morgan", "alex.morgan@cardioshield.org");
        };

        document.getElementById("csDemoLoginBtn").addEventListener("click", demoLogin);
        document.getElementById("csDemoHelpBtn").addEventListener("click", () => {
            document.getElementById("csLoginEmail").value = "alex.morgan@cardioshield.org";
            document.getElementById("csLoginPassword").value = "cardio123";
        });
    }

    function showAlert(msg) {
        const alertBox = document.getElementById("csFormAlert");
        if (alertBox) {
            alertBox.textContent = msg;
            alertBox.style.display = "block";
        }
    }

    function clearAlert() {
        const alertBox = document.getElementById("csFormAlert");
        if (alertBox) {
            alertBox.textContent = "";
            alertBox.style.display = "none";
        }
    }

    function openModal(defaultTab) {
        ensureModal();
        const modal = document.getElementById("cs-auth-modal");
        if (modal) {
            clearAlert();
            let tabToOpen = defaultTab;
            if (!tabToOpen) {
                // If user didn't specify tab: if registered before -> open login; if not -> open register!
                tabToOpen = hasPreviouslyRegistered() ? "login" : "register";
            }

            if (tabToOpen === "register") {
                document.getElementById("csTabRegister").click();
            } else {
                document.getElementById("csTabLogin").click();
                const lastEmail = localStorage.getItem(STORAGE_LAST_EMAIL);
                const emailInput = document.getElementById("csLoginEmail");
                if (lastEmail && emailInput && !emailInput.value) {
                    emailInput.value = lastEmail;
                }
            }
            modal.classList.add("cs-modal-open");
        }
    }

    function closeModal() {
        const modal = document.getElementById("cs-auth-modal");
        if (modal) modal.classList.remove("cs-modal-open");
    }

    // 5. CSS Styles Injection for Modern, Beautiful UI
    function injectStyles() {
        if (document.getElementById("cs-auth-styles")) return;

        const style = document.createElement("style");
        style.id = "cs-auth-styles";
        style.textContent = `
            /* Modal Overlay & Blur */
            .cs-modal-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 18px;
                background: radial-gradient(circle at 50% 30%, rgba(16, 34, 122, 0.45), rgba(8, 14, 48, 0.72));
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.24s ease;
            }
            .cs-modal-overlay.cs-modal-open {
                opacity: 1;
                visibility: visible;
            }
            .cs-modal-box {
                position: relative;
                width: 100%;
                max-width: 460px;
                background: #ffffff;
                border-radius: 26px;
                padding: 32px 30px 24px;
                box-shadow: 0 25px 60px rgba(10, 22, 74, 0.28), 0 0 0 1px rgba(220, 230, 255, 0.85);
                transform: translateY(22px) scale(0.96);
                transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
                color: #121c4b;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .cs-modal-overlay.cs-modal-open .cs-modal-box {
                transform: translateY(0) scale(1);
            }
            .cs-modal-close {
                position: absolute;
                top: 16px;
                right: 16px;
                width: 34px;
                height: 34px;
                border: none;
                background: #f1f4fe;
                border-radius: 50%;
                color: #53628c;
                font-size: 20px;
                line-height: 1;
                cursor: pointer;
                display: grid;
                place-items: center;
                transition: all 0.16s ease;
            }
            .cs-modal-close:hover {
                background: #e2e8fd;
                color: #0c1854;
                transform: scale(1.06);
            }
            .cs-modal-header {
                display: flex;
                align-items: center;
                gap: 14px;
                margin-bottom: 22px;
            }
            .cs-modal-brand-badge {
                width: 48px;
                height: 48px;
                border-radius: 16px;
                background: linear-gradient(135deg, #ff4057, #d9002c);
                display: grid;
                place-items: center;
                box-shadow: 0 8px 20px rgba(217, 0, 44, 0.32);
                color: #ffffff;
                font-size: 24px;
                flex-shrink: 0;
            }
            .cs-modal-brand-sub {
                font-size: 9px;
                font-weight: 850;
                letter-spacing: 1.6px;
                color: #176cf3;
                text-transform: uppercase;
            }
            .cs-modal-title {
                margin: 2px 0 0;
                font-size: 21px;
                font-weight: 900;
                letter-spacing: -0.5px;
                color: #0f1e68;
            }

            /* Tabs Bar */
            .cs-tabs-bar {
                display: flex;
                background: #f2f5fd;
                border-radius: 14px;
                padding: 4px;
                margin-bottom: 20px;
                border: 1px solid #e1e7fa;
            }
            .cs-tab-btn {
                flex: 1;
                border: none;
                background: transparent;
                padding: 10px 14px;
                border-radius: 11px;
                font-size: 13px;
                font-weight: 750;
                color: #5c6c94;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                transition: all 0.2s ease;
                font-family: inherit;
            }
            .cs-tab-btn.active {
                background: #ffffff;
                color: #10227a;
                box-shadow: 0 4px 14px rgba(16, 34, 122, 0.1);
            }

            /* Alert Message Box */
            .cs-form-alert {
                background: #fff0f3;
                border: 1px solid #fecdd6;
                color: #b91c32;
                border-radius: 12px;
                padding: 10px 14px;
                font-size: 12px;
                font-weight: 600;
                margin-bottom: 16px;
                line-height: 1.5;
            }

            /* Forms Layout */
            .cs-auth-form {
                display: none;
                flex-direction: column;
                gap: 14px;
            }
            .cs-auth-form.active {
                display: flex;
                animation: csFadeIn 0.2s ease;
            }
            @keyframes csFadeIn {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .cs-form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .cs-form-group label {
                font-size: 12px;
                font-weight: 750;
                color: #273663;
            }
            .cs-label-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .cs-hint-link {
                font-size: 11px;
                color: #176cf3;
                font-weight: 700;
                cursor: pointer;
            }
            .cs-hint-link:hover { text-decoration: underline; }

            .cs-input-wrap {
                position: relative;
                display: flex;
                align-items: center;
            }
            .cs-input-icon {
                position: absolute;
                left: 13px;
                font-size: 15px;
                color: #8c9bbd;
                pointer-events: none;
            }
            .cs-input-wrap input {
                width: 100%;
                padding: 11px 40px 11px 38px;
                border: 1.5px solid #dbe2fb;
                border-radius: 12px;
                font-size: 13px;
                color: #101c4a;
                outline: none;
                background: #fbfdff;
                font-family: inherit;
                transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
            }
            .cs-input-wrap input:focus {
                border-color: #176cf3;
                background: #ffffff;
                box-shadow: 0 0 0 3px rgba(23, 108, 243, 0.14);
            }
            .cs-toggle-pwd {
                position: absolute;
                right: 12px;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 16px;
                color: #7b8bad;
                padding: 0;
            }

            /* Password Strength Meter */
            .cs-strength-meter {
                height: 4px;
                background: #eef2fb;
                border-radius: 4px;
                overflow: hidden;
                margin-top: 4px;
            }
            .cs-strength-bar {
                height: 100%;
                width: 0%;
                transition: width 0.25s ease, background-color 0.25s ease;
            }
            .cs-strength-bar.weak { width: 25%; background: #e53e3e; }
            .cs-strength-bar.fair { width: 50%; background: #dd6b20; }
            .cs-strength-bar.good { width: 75%; background: #3182ce; }
            .cs-strength-bar.strong { width: 100%; background: #38a169; }
            .cs-strength-text {
                font-size: 11px;
                color: #8c97b8;
                font-weight: 600;
            }

            /* Buttons */
            .cs-modal-actions {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 10px;
            }
            .cs-btn-primary {
                padding: 13px;
                border: none;
                border-radius: 999px;
                background: linear-gradient(110deg, #ff4558, #d9002c);
                color: #ffffff;
                font-size: 13px;
                font-weight: 850;
                cursor: pointer;
                box-shadow: 0 7px 20px rgba(242, 27, 66, 0.32);
                transition: transform 0.18s ease, box-shadow 0.18s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                font-family: inherit;
            }
            .cs-btn-primary:hover {
                transform: translateY(-1.5px);
                box-shadow: 0 10px 24px rgba(242, 27, 66, 0.4);
            }
            .cs-btn-demo {
                padding: 10px;
                border: 1px solid #d4defa;
                border-radius: 999px;
                background: #f7f9ff;
                color: #176cf3;
                font-size: 12px;
                font-weight: 750;
                cursor: pointer;
                transition: all 0.18s ease;
                font-family: inherit;
            }
            .cs-btn-demo:hover {
                background: #edf3ff;
                border-color: #bcd0fc;
            }

            .cs-form-footer {
                text-align: center;
                font-size: 12px;
                color: #6d7c9f;
                margin-top: 4px;
            }
            .cs-form-footer a {
                color: #176cf3;
                font-weight: 750;
                text-decoration: none;
            }
            .cs-form-footer a:hover {
                text-decoration: underline;
            }
            .cs-modal-footer {
                margin-top: 20px;
                text-align: center;
                color: #8fa0c4;
                font-size: 11px;
                line-height: 1.45;
                border-top: 1px solid #eef3fc;
                padding-top: 14px;
            }

            /* Logged-Out Prompt Alert Banner (Dashboard & Profile) */
            .cs-auth-alert-banner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 16px 20px;
                border-radius: 16px;
                margin-bottom: 22px;
                box-shadow: 0 4px 18px rgba(16, 44, 61, 0.05);
                animation: csFadeIn 0.25s ease;
            }
            .cs-banner-login {
                background: linear-gradient(110deg, #f0f4ff, #e7efff);
                border: 1.5px solid #c7d8fe;
                color: #10227a;
            }
            .cs-banner-register {
                background: linear-gradient(110deg, #ecfdf5, #d1fae5);
                border: 1.5px solid #a7f3d0;
                color: #064e3b;
            }
            .cs-alert-icon {
                font-size: 26px;
                flex-shrink: 0;
            }
            .cs-alert-content {
                flex: 1;
            }
            .cs-alert-content strong {
                display: block;
                font-size: 14px;
                margin-bottom: 3px;
                color: inherit;
            }
            .cs-alert-content p {
                margin: 0;
                font-size: 12px;
                line-height: 1.5;
                opacity: 0.9;
                color: inherit;
            }
            .cs-alert-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }
            .cs-btn-alert-primary {
                padding: 9px 16px;
                border: none;
                border-radius: 999px;
                font-weight: 800;
                font-size: 12px;
                cursor: pointer;
                box-shadow: 0 3px 10px rgba(0,0,0,0.1);
                transition: transform 0.18s ease, box-shadow 0.18s ease;
                font-family: inherit;
            }
            .cs-banner-login .cs-btn-alert-primary {
                background: linear-gradient(110deg, #176cf3, #10227a);
                color: #ffffff;
            }
            .cs-banner-register .cs-btn-alert-primary {
                background: linear-gradient(110deg, #10b981, #047857);
                color: #ffffff;
            }
            .cs-btn-alert-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 5px 14px rgba(0,0,0,0.18);
            }
            .cs-btn-alert-secondary {
                padding: 8px 14px;
                border: 1px solid currentColor;
                background: transparent;
                border-radius: 999px;
                font-weight: 750;
                font-size: 12px;
                cursor: pointer;
                color: inherit;
                transition: background 0.18s ease;
                font-family: inherit;
            }
            .cs-btn-alert-secondary:hover {
                background: rgba(255,255,255,0.6);
            }
            @media (max-width: 680px) {
                .cs-auth-alert-banner {
                    flex-direction: column;
                    align-items: flex-start;
                }
                .cs-alert-actions {
                    width: 100%;
                    justify-content: flex-start;
                    margin-top: 6px;
                }
            }

            /* Toast Notification */
            .cs-auth-toast {
                position: fixed;
                bottom: 26px;
                right: 26px;
                z-index: 100000;
                background: #0f1e68;
                color: #ffffff;
                padding: 14px 20px;
                border-radius: 16px;
                font-size: 13px;
                font-weight: 750;
                box-shadow: 0 14px 38px rgba(10, 22, 74, 0.32);
                transform: translateY(70px) scale(0.95);
                opacity: 0;
                pointer-events: none;
                transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.24s ease;
                display: flex;
                align-items: center;
                gap: 12px;
                font-family: inherit;
                max-width: 360px;
            }
            .cs-auth-toast.cs-toast-show {
                transform: translateY(0) scale(1);
                opacity: 1;
                pointer-events: auto;
            }
            .cs-auth-toast.cs-toast-error {
                background: #d9002c;
            }
            .cs-toast-icon { font-size: 22px; flex-shrink: 0; }
            .cs-toast-body {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .cs-toast-action-btn {
                align-self: flex-start;
                background: #ffffff;
                color: #10227a;
                border: none;
                padding: 4px 11px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 850;
                cursor: pointer;
                margin-top: 4px;
                transition: transform 0.16s ease, background 0.16s ease;
            }
            .cs-toast-action-btn:hover {
                background: #e7efff;
                transform: scale(1.05);
            }

            /* Navbar User Auth Element & Dropdown */
            .cs-nav-auth-wrapper {
                position: relative;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .cs-nav-login-btn {
                background: #ffffff;
                border: 1px solid #d4deff;
                border-radius: 999px;
                padding: 7px 15px;
                color: #10227a;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                transition: all 0.2s ease;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .cs-nav-login-btn:hover {
                background: #edf2ff;
                border-color: #176cf3;
                color: #176cf3;
                transform: translateY(-1px);
            }
            .cs-nav-reg-btn {
                background: linear-gradient(110deg, #176cf3, #087f8c);
                border: none;
                border-radius: 999px;
                padding: 8px 16px;
                color: #ffffff;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                box-shadow: 0 4px 14px rgba(23, 108, 243, 0.25);
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                text-decoration: none;
            }
            .cs-nav-reg-btn:hover {
                box-shadow: 0 6px 18px rgba(23, 108, 243, 0.35);
                transform: translateY(-1px);
            }

            /* Logged in User Pill */
            .cs-user-pill {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: #ffffff;
                border: 1.5px solid #d8e3fb;
                padding: 4px 12px 4px 5px;
                border-radius: 999px;
                cursor: pointer;
                transition: all 0.2s ease;
                box-shadow: 0 3px 10px rgba(16, 34, 122, 0.04);
            }
            .cs-user-pill:hover, .cs-user-pill.open {
                border-color: #176cf3;
                box-shadow: 0 6px 18px rgba(23, 108, 243, 0.12);
            }
            .cs-user-avatar {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                background: linear-gradient(135deg, #176cf3, #087f8c);
                color: #ffffff;
                font-size: 12px;
                font-weight: 850;
                display: grid;
                place-items: center;
            }
            .cs-user-name {
                font-size: 12px;
                font-weight: 800;
                color: #10227a;
            }
            .cs-user-caret {
                font-size: 10px;
                color: #7b8bad;
                transition: transform 0.2s ease;
            }
            .cs-user-pill.open .cs-user-caret {
                transform: rotate(180deg);
            }

            /* Dropdown Menu */
            .cs-dropdown-menu {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                width: 250px;
                background: #ffffff;
                border: 1px solid #dbe4fa;
                border-radius: 18px;
                box-shadow: 0 16px 40px rgba(10, 22, 74, 0.16);
                padding: 12px;
                display: none;
                flex-direction: column;
                gap: 4px;
                z-index: 10000;
                animation: csDropIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .cs-dropdown-menu.show {
                display: flex;
            }
            @keyframes csDropIn {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .cs-dropdown-head {
                padding: 8px 10px 10px;
                border-bottom: 1px solid #eef2fb;
                margin-bottom: 4px;
            }
            .cs-dropdown-head-name {
                font-size: 13px;
                font-weight: 850;
                color: #10227a;
            }
            .cs-dropdown-head-email {
                font-size: 11px;
                color: #67789c;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .cs-dropdown-link {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 9px 12px;
                border-radius: 10px;
                font-size: 12px;
                font-weight: 700;
                color: #38486e;
                text-decoration: none;
                transition: all 0.16s ease;
            }
            .cs-dropdown-link:hover {
                background: #f0f4fe;
                color: #176cf3;
            }
            .cs-dropdown-divider {
                height: 1px;
                background: #eef2fb;
                margin: 4px 0;
            }
            .cs-dropdown-logout {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                border: none;
                background: transparent;
                padding: 9px 12px;
                border-radius: 10px;
                font-size: 12px;
                font-weight: 750;
                color: #b82236;
                cursor: pointer;
                transition: all 0.16s ease;
                font-family: inherit;
            }
            .cs-dropdown-logout:hover {
                background: #fff0f3;
                color: #d9002c;
            }
        `;
        document.head.appendChild(style);
    }

    // 6. Update UI Across the Page
    function updatePageAuthUI() {
        const user = getUser();
        const registeredBefore = hasPreviouslyRegistered();
        const containers = document.querySelectorAll("#navProfileGroup, [data-auth-nav]");

        containers.forEach(container => {
            if (user.isLoggedIn) {
                container.innerHTML = `
                    <div class="cs-nav-auth-wrapper">
                        <div class="cs-user-pill" id="csUserPill" title="Account Menu">
                            <span class="cs-user-avatar">${user.avatar}</span>
                            <span class="cs-user-name">${user.name.split(" ")[0]}</span>
                            <span class="cs-user-caret">▾</span>
                        </div>

                        <div class="cs-dropdown-menu" id="csDropdownMenu">
                            <div class="cs-dropdown-head">
                                <div class="cs-dropdown-head-name">${user.name}</div>
                                <div class="cs-dropdown-head-email">${user.email}</div>
                            </div>
                            <a class="cs-dropdown-link" href="profile.html"><span>👤</span> My Profile</a>
                            <a class="cs-dropdown-link" href="dashboard.html"><span>📊</span> Health Dashboard</a>
                            <a class="cs-dropdown-link" href="dashboard.html#saved-reports"><span>📑</span> Saved Reports</a>
                            <a class="cs-dropdown-link" href="routine.html"><span>🎯</span> Daily Routine</a>
                            <div class="cs-dropdown-divider"></div>
                            <button type="button" class="cs-dropdown-logout" data-action="logout">
                                <span>↪</span> Log Out to Home
                            </button>
                        </div>
                    </div>
                `;

                // Handle Pill & Dropdown Toggle
                const pill = container.querySelector("#csUserPill");
                const dropdown = container.querySelector("#csDropdownMenu");
                if (pill && dropdown) {
                    pill.onclick = (e) => {
                        e.stopPropagation();
                        const isOpen = dropdown.classList.toggle("show");
                        pill.classList.toggle("open", isOpen);
                    };
                }
            } else {
                // When logged out:
                // If registered before: emphasize Log In
                // If never registered: emphasize Register
                if (registeredBefore) {
                    container.innerHTML = `
                        <div class="cs-nav-auth-wrapper">
                            <button type="button" class="cs-nav-reg-btn" data-action="login" title="Sign in to your account">
                                <span>🔑</span> Log In
                            </button>
                            <button type="button" class="cs-nav-login-btn" data-action="register" title="Create a new account">
                                <span>✨</span> Register
                            </button>
                        </div>
                    `;
                } else {
                    container.innerHTML = `
                        <div class="cs-nav-auth-wrapper">
                            <button type="button" class="cs-nav-login-btn" data-action="login" title="Already registered? Sign in">
                                <span>🔑</span> Log In
                            </button>
                            <button type="button" class="cs-nav-reg-btn" data-action="register" title="New user? Register now">
                                <span>✨</span> Register
                            </button>
                        </div>
                    `;
                }
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", function (e) {
            document.querySelectorAll(".cs-dropdown-menu.show").forEach(menu => {
                menu.classList.remove("show");
            });
            document.querySelectorAll(".cs-user-pill.open").forEach(p => {
                p.classList.remove("open");
            });
        });

        // Update Auth Status Banner (#authStatusBanner) on Dashboard and Profile pages
        const authBanner = document.getElementById("authStatusBanner");
        if (authBanner) {
            if (user.isLoggedIn) {
                authBanner.style.display = "none";
                authBanner.innerHTML = "";
            } else {
                authBanner.style.display = "block";
                if (registeredBefore) {
                    authBanner.innerHTML = `
                        <div class="cs-auth-alert-banner cs-banner-login">
                            <div class="cs-alert-icon">🔒</div>
                            <div class="cs-alert-content">
                                <strong>You are currently logged out</strong>
                                <p>Welcome back! Please <strong>log in</strong> to view your saved heart health assessment reports and personalized records.</p>
                            </div>
                            <div class="cs-alert-actions">
                                <button type="button" class="cs-btn-alert-primary" data-action="login">🔑 Log In</button>
                                <button type="button" class="cs-btn-alert-secondary" data-action="register">✨ Register</button>
                            </div>
                        </div>
                    `;
                } else {
                    authBanner.innerHTML = `
                        <div class="cs-auth-alert-banner cs-banner-register">
                            <div class="cs-alert-icon">✨</div>
                            <div class="cs-alert-content">
                                <strong>New to CardioShield? Please Register</strong>
                                <p>You haven't registered an account yet. <strong>Register now</strong> to save your assessments, track your heart health over time, and build daily routines.</p>
                            </div>
                            <div class="cs-alert-actions">
                                <button type="button" class="cs-btn-alert-primary" data-action="register">✨ Register Now</button>
                                <button type="button" class="cs-btn-alert-secondary" data-action="login">🔑 Log In</button>
                            </div>
                        </div>
                    `;
                }
            }
        }

        // Update profile banner actions in profile.html if present
        const profileBannerActions = document.getElementById("profileBannerActions");
        if (profileBannerActions) {
            if (user.isLoggedIn) {
                profileBannerActions.innerHTML = `
                    <button type="button" class="banner-logout-btn" id="bannerLogoutBtn" data-action="logout" title="Log out and return to Home Page">
                        <span>↪</span> Log Out to Home
                    </button>
                `;
            } else {
                if (registeredBefore) {
                    profileBannerActions.innerHTML = `
                        <button type="button" class="banner-logout-btn" data-action="login" title="Log in to your account" style="background:#176cf3;border-color:#176cf3;">
                            <span>🔑</span> Log In
                        </button>
                        <button type="button" class="banner-logout-btn" data-action="register" title="Create a new account">
                            <span>✨</span> Register
                        </button>
                    `;
                } else {
                    profileBannerActions.innerHTML = `
                        <button type="button" class="banner-logout-btn" data-action="register" title="Register user account" style="background:#087f8c;border-color:#087f8c;">
                            <span>✨</span> Register Now
                        </button>
                        <button type="button" class="banner-logout-btn" data-action="login" title="Already registered? Sign in">
                            <span>🔑</span> Log In
                        </button>
                    `;
                }
            }
        }

        // Update avatar in dashboard topbar if present
        const dashAvatar = document.querySelector(".top-actions .avatar");
        if (dashAvatar) {
            dashAvatar.textContent = user.isLoggedIn ? user.avatar : "♡";
        }

        // Wire up buttons with data-action
        document.querySelectorAll('[data-action="login"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                openModal("login");
            };
        });

        document.querySelectorAll('[data-action="register"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                openModal("register");
            };
        });

        document.querySelectorAll('[data-action="logout"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                logout(HOME_PAGE);
            };
        });

        // Wire up dedicated logout buttons
        const bannerLogout = document.getElementById("bannerLogoutBtn");
        if (bannerLogout) {
            bannerLogout.onclick = (e) => {
                e.preventDefault();
                logout(HOME_PAGE);
            };
        }

        const formLogout = document.getElementById("formLogoutBtn");
        if (formLogout) {
            formLogout.onclick = (e) => {
                e.preventDefault();
                logout(HOME_PAGE);
            };
        }

        const dashLogout = document.getElementById("dashLogoutBtn");
        if (dashLogout) {
            dashLogout.onclick = (e) => {
                e.preventDefault();
                logout(HOME_PAGE);
            };
        }

        // Check if we just logged out and have a contextual prompt waiting
        try {
            const promptType = sessionStorage.getItem("cardioshield_auth_prompt");
            if (promptType) {
                sessionStorage.removeItem("cardioshield_auth_prompt");
                showAuthPromptToast(promptType);
            }
        } catch (e) {}
    }

    // 7. Initialization
    function init() {
        injectStyles();
        ensureModal();
        updatePageAuthUI();

        // Global delegated click handler for all auth actions
        document.addEventListener("click", function (e) {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            const action = btn.getAttribute("data-action");
            if (action === "login") {
                e.preventDefault();
                openModal("login");
            } else if (action === "register") {
                e.preventDefault();
                openModal("register");
            } else if (action === "logout") {
                e.preventDefault();
                logout(HOME_PAGE);
            }
        });

        window.addEventListener("cardioshield:auth-change", updatePageAuthUI);

        window.addEventListener("storage", function (e) {
            if (e.key === STORAGE_AUTH || e.key === STORAGE_PROFILE || e.key === STORAGE_USERS || e.key === STORAGE_HAS_REGISTERED) {
                updatePageAuthUI();
                if (typeof window.loadProfile === "function") window.loadProfile();
                if (typeof window.loadDashboard === "function") window.loadDashboard();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // Expose Global API
    window.CardioShieldAuth = {
        getUser: getUser,
        getRegisteredUsers: getRegisteredUsers,
        hasPreviouslyRegistered: hasPreviouslyRegistered,
        register: register,
        login: login,
        logout: logout,
        openLoginModal: () => openModal("login"),
        openRegisterModal: () => openModal("register"),
        openModal: openModal,
        closeModal: closeModal,
        showToast: showToast,
        showAuthPromptToast: showAuthPromptToast,
        updateUI: updatePageAuthUI
    };

})(window, document);
