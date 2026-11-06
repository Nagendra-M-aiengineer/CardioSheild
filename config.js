/**
 * CardioShield-AgeLess API Configuration
 * Supports Vercel production deployment and local development (Port 8080).
 */
(function(window) {
    'use strict';

    function getApiBaseUrl() {
        // 1. Check if configured via window.API_URL or window.__ENV__.API_URL (injected in deployment)
        if (typeof window !== "undefined") {
            if (window.API_URL && typeof window.API_URL === "string" && window.API_URL.trim() && !window.API_URL.includes("5000")) {
                return window.API_URL.trim().replace(/\/+$/, "");
            }
            if (window.__ENV__ && window.__ENV__.API_URL && !window.__ENV__.API_URL.includes("5000")) {
                return window.__ENV__.API_URL.trim().replace(/\/+$/, "");
            }
            try {
                const stored = localStorage.getItem("API_URL") || localStorage.getItem("cardioshield_api_url");
                if (stored && stored.trim() && !stored.includes("5000")) return stored.trim().replace(/\/+$/, "");
            } catch (e) {}
        }

        // 2. Check process.env (for Vercel build/serverless environments)
        if (typeof process !== "undefined" && process.env) {
            const envUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
            if (envUrl && envUrl.trim() && !envUrl.includes("5000")) return envUrl.trim().replace(/\/+$/, "");
        }

        // 3. Browser runtime environment detection
        if (typeof window !== "undefined" && window.location) {
            const host = window.location.hostname;
            const port = window.location.port;
            const protocol = window.location.protocol;
            const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

            // For local development on a different port (e.g. VS Code Live Server on 5500/5501) or file://
            if (protocol === "file:" || (isLocal && port !== "8080")) {
                return "http://127.0.0.1:8080";
            }

            // On Vercel or any deployed domain: NEVER use 127.0.0.1 because that points to the user's PC!
            // Return empty string so endpoints use relative paths (e.g. /predict), which Vercel proxies to Flask
            return "";
        }

        return "http://127.0.0.1:8080";
    }

    function getApiUrl(endpoint) {
        const base = getApiBaseUrl();
        const route = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
        return base ? (base + route) : route;
    }

    const config = {
        getBaseUrl: getApiBaseUrl,
        getApiUrl: getApiUrl,
        PREDICT_URL: getApiUrl("/predict"),
        HISTORY_URL: getApiUrl("/history"),
        AUTH_URL: getApiUrl("/auth"),
        MODEL_INFO_URL: getApiUrl("/model-info")
    };

    window.CardioConfig = config;
    window.API_URL = config.PREDICT_URL;
})(typeof window !== 'undefined' ? window : globalThis);
