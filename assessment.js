
"use strict";

// ============================================
// CARDIOSHIELD-AGELESS ASSESSMENT
// ============================================

const API_URL = (function() {
    if (typeof window !== "undefined" && window.CardioConfig && typeof window.CardioConfig.getApiUrl === "function") {
        return window.CardioConfig.getApiUrl("/predict");
    }
    const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost" || window.location.protocol === "file:";
    const isDifferentPort = isLocal && window.location.port !== "8080";
    if (isDifferentPort || window.location.protocol === "file:") {
        return "http://127.0.0.1:8080/predict";
    }
    return "/predict";
})();
const RESULT_KEY = "cardioResult";
const ASSESSMENT_KEY = "cardioAssessment";
const LEGACY_ASSESSMENT_KEY = "cardioShieldData";

// ============================================
// HELPER FUNCTIONS
// ============================================

function getElement(id) {
    return document.getElementById(id);
}

function getValue(id) {
    const element = getElement(id);
    return element ? String(element.value ?? "").trim() : "";
}

function numberOrNull(value) {
    if (value == null || String(value).trim() === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function yesNoToNumber(value) {
    if (value === "yes") return 1;
    if (value === "no") return 0;
    return null;
}

// ============================================
// SHOW / HIDE CONDITIONAL SECTIONS
// ============================================

function toggleGroup(groupId, value) {
    const group = getElement(groupId);

    if (!group) return;

    const shouldShow = value === "yes";
    group.classList.toggle("show", shouldShow);

    if (!shouldShow) {
        group.querySelectorAll("input, select, textarea")
            .forEach(function (field) {
                field.value = "";
            });
    }

    updateProgress();
}

// ============================================
// PROGRESS BAR
// ============================================

function updateProgress() {
    const progressText = getElement("progressText");
    const progressFill = getElement("progressFill");

    if (!progressText || !progressFill) return;

    const ids = [
        "age",
        "sex",
        "hasBP",
        "hasSmokingInfo",
        "hasPhysicalActivityInfo",
        "sleep",
        "hasStressInfo",
        "hasAlcoholInfo",
        "hasDietInfo",
        "hasJunkFoodInfo",
        "familyHistory",
        "screenTime"
    ];

    const completed = ids.filter(function (id) {
        return getValue(id) !== "";
    }).length;

    const percentage = Math.round(
        (completed / ids.length) * 100
    );

    progressText.textContent = percentage + "%";
    progressFill.style.width = percentage + "%";
}

// ============================================
// VALIDATE ASSESSMENT
// ============================================

function validateAssessment() {
    const age = numberOrNull(getValue("age"));

    if (age === null || age < 1 || age > 120) {
        alert("Enter a valid age between 1 and 120.");
        getElement("age")?.focus();
        return false;
    }

    if (!getValue("sex")) {
        alert("Please select your sex.");
        getElement("sex")?.focus();
        return false;
    }

    const requiredQuestions = [
        "hasBP",
        "hasSmokingInfo",
        "hasPhysicalActivityInfo",
        "hasStressInfo",
        "hasAlcoholInfo",
        "hasDietInfo",
        "hasJunkFoodInfo",
        "familyHistory"
    ];

    for (const id of requiredQuestions) {
        if (!getValue(id)) {
            alert("Please answer all required lifestyle questions (including Family History).");
            getElement(id)?.focus();
            return false;
        }
    }

    // Validate blood pressure when provided.
    if (getValue("hasBP") === "yes") {
        const systolic = numberOrNull(getValue("systolicBP"));
        const diastolic = numberOrNull(getValue("diastolicBP"));

        if (
            systolic === null ||
            systolic < 50 ||
            systolic > 300
        ) {
            alert("Enter a valid systolic blood pressure.");
            getElement("systolicBP")?.focus();
            return false;
        }

        if (
            diastolic === null ||
            diastolic < 30 ||
            diastolic > 200 ||
            diastolic >= systolic
        ) {
            alert(
                "Enter a valid diastolic pressure lower than " +
                "the systolic pressure."
            );
            getElement("diastolicBP")?.focus();
            return false;
        }
    }

    // Validate cigarettes per day when applicable.
    if (getValue("hasSmokingInfo") === "yes") {
        const cigarettes = numberOrNull(getValue("cigsPerDay"));

        if (
            cigarettes === null ||
            cigarettes < 0 ||
            cigarettes > 200
        ) {
            alert("Enter a valid number of cigarettes per day.");
            getElement("cigsPerDay")?.focus();
            return false;
        }
    }

    // Validate conditional lifestyle fields.
    const conditionalChecks = [
        ["hasPhysicalActivityInfo", "exercise", "Select physical activity."],
        ["hasStressInfo", "stress", "Select stress level."],
        ["hasAlcoholInfo", "alcohol", "Select alcohol consumption."],
        ["hasDietInfo", "diet", "Select diet quality."],
        ["hasJunkFoodInfo", "junkFood", "Select junk-food frequency."]
    ];

    for (const [availabilityId, fieldId, message] of conditionalChecks) {
        if (
            getValue(availabilityId) === "yes" &&
            !getValue(fieldId)
        ) {
            alert(message);
            getElement(fieldId)?.focus();
            return false;
        }
    }

    // Validate optional clinical measurements when entered.
    const numericChecks = [
        ["resting_bp", 50, 300, "Resting blood pressure must be between 50 and 300."],
        ["cholesterol", 0, 1000, "Cholesterol must be between 0 and 1000."],
        ["max_heart_rate", 30, 250, "Maximum heart rate must be between 30 and 250."],
        ["oldpeak", -5, 10, "Oldpeak must be between -5 and 10."]
    ];

    for (const [id, min, max, message] of numericChecks) {
        const raw = getValue(id);

        if (raw === "") continue;

        const value = numberOrNull(raw);

        if (value === null || value < min || value > max) {
            alert(message);
            getElement(id)?.focus();
            return false;
        }
    }

    return true;
}

// ============================================
// COLLECT MODEL INPUTS
// Must match the trained model's 13 features.
// ============================================

function collectModelInput() {
    const sex = getValue("sex");

    return {
        age: numberOrNull(getValue("age")),

        sex:
            sex === "male" ? 1 :
            sex === "female" ? 0 :
            null,

        chest_pain_type:
            numberOrNull(getValue("chest_pain_type")),

        resting_bp:
            numberOrNull(getValue("resting_bp")),

        cholesterol:
            numberOrNull(getValue("cholesterol")),

        fasting_blood_sugar:
            numberOrNull(getValue("fasting_blood_sugar")),

        resting_ecg:
            numberOrNull(getValue("resting_ecg")),

        max_heart_rate:
            numberOrNull(getValue("max_heart_rate")),

        exercise_induced_angina:
            numberOrNull(getValue("exercise_induced_angina")),

        oldpeak:
            numberOrNull(getValue("oldpeak")),

        st_slope:
            numberOrNull(getValue("st_slope")),

        ca:
            numberOrNull(getValue("ca")),

        thal:
            numberOrNull(getValue("thal"))
    };
}

// ============================================
// COLLECT LIFESTYLE INFORMATION
// These values are saved for dashboard display.
// They are not inputs to the current 13-feature model.
// ============================================

function collectLifestyleData() {
    return {
        sex_label: getValue("sex"),

        hasBP: getValue("hasBP"),
        systolicBP: numberOrNull(getValue("systolicBP")),
        diastolicBP: numberOrNull(getValue("diastolicBP")),

        hasSmokingInfo: getValue("hasSmokingInfo"),
        currentSmoker: yesNoToNumber(getValue("hasSmokingInfo")),
        cigsPerDay: numberOrNull(getValue("cigsPerDay")),

        hasPhysicalActivityInfo:
            getValue("hasPhysicalActivityInfo"),
        exercise: getValue("exercise") || null,

        sleep: getValue("sleep") || null,

        hasStressInfo: getValue("hasStressInfo"),
        stress: getValue("stress") || null,

        hasAlcoholInfo: getValue("hasAlcoholInfo"),
        alcohol: getValue("alcohol") || null,

        hasDietInfo: getValue("hasDietInfo"),
        diet: getValue("diet") || null,

        hasJunkFoodInfo: getValue("hasJunkFoodInfo"),
        junkFood: getValue("junkFood") || null,

        hasFamilyHistoryInfo: getValue("familyHistory") || getValue("hasFamilyHistoryInfo") || "no",
        familyHistory: getValue("familyHistory") || null,

        screenTime: getValue("screenTime") || null,

        assessmentDate: new Date().toISOString()
    };
}

// ============================================
// SAVE ASSESSMENT
// ============================================

function saveAssessment(modelInput, lifestyleData) {
    const assessment = {
        ...modelInput,
        ...lifestyleData,
        lifestyle: lifestyleData
    };

    localStorage.setItem(
        ASSESSMENT_KEY,
        JSON.stringify(assessment)
    );

    localStorage.setItem(
        LEGACY_ASSESSMENT_KEY,
        JSON.stringify(assessment)
    );

    localStorage.setItem(
        "cardioShieldAssessmentCompleted",
        "true"
    );
}

// ============================================
// NORMALIZE FLASK PREDICTION
// ============================================

function normalizePrediction(result) {
    let score = null;

    if (result.model_score != null) {
        score = Number(result.model_score);
    } else if (result.risk_percentage != null) {
        score = Number(result.risk_percentage);
    } else if (result.probability_percentage != null) {
        score = Number(result.probability_percentage);
    } else if (result.risk_probability != null) {
        score = Number(result.risk_probability) * 100;
    } else if (result.probability != null) {
        score = Number(result.probability) * 100;
    }

    if (
        score === null ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100
    ) {
        throw new Error(
            "The API did not return a valid model score from 0 to 100."
        );
    }

    return {
        ...result,
        model_score: score,
        risk_percentage: score,
        probability_percentage: score,
        risk_probability: score / 100,
        category: "Experimental model output"
    };
}

// ============================================
// SUBMIT ASSESSMENT TO FLASK
// ============================================

async function submitAssessment() {
    const form = getElement("assessmentForm");

    const button = form?.querySelector(
        'button[type="submit"], .submit-btn'
    ) || document.querySelector(".submit-btn");

    if (!form || !button) {
        alert(
            "Assessment form or Analyze button was not found. " +
            "Check assessment.html."
        );
        return;
    }

    if (!validateAssessment()) return;

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = "Analyzing your assessment...";

    try {
        const modelInput = collectModelInput();
        const lifestyleData = collectLifestyleData();

        // Attempt to connect to live Flask backend first
        let response = null;
        let result = null;

        try {
            response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(modelInput)
            });

            if (response && response.ok) {
                const contentType = response.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                    result = await response.json();
                }
            }
        } catch (fetchErr) {
            console.warn("Flask backend not reachable at " + API_URL + ". Falling back to onboard ML model.", fetchErr);
        }

        // If Flask was offline or returned an error, seamlessly compute with onboard Calibrated Logistic Regression model
        if (!result || result.success === false) {
            if (window.CardioShieldModel && typeof window.CardioShieldModel.predict === "function") {
                console.log("Analyzing assessment using onboard Calibrated Logistic Regression model...");
                result = window.CardioShieldModel.predict(modelInput);
            } else {
                throw new Error("Could not connect to Flask at " + API_URL + ". Make sure Flask is running on port 8080.");
            }
        }

        const savedResult = normalizePrediction(result);

        // Save everything before redirecting.
        saveAssessment(modelInput, lifestyleData);

        localStorage.setItem(
            RESULT_KEY,
            JSON.stringify(savedResult)
        );

        try {
            const reportId = savedResult.prediction_id || ("report-" + Date.now());
            const reportEntry = {
                id: reportId,
                assessment_id: reportId,
                created_at: new Date().toISOString(),
                risk_score: savedResult.model_score ?? savedResult.risk_percentage,
                predicted_class: savedResult.prediction,
                model_name: savedResult.model || "Calibrated Logistic Regression",
                assessment: { ...modelInput, ...lifestyleData, assessmentDate: new Date().toISOString() },
                prediction: savedResult
            };
            const reportsRaw = localStorage.getItem("cardioshield_saved_reports");
            const reportsList = reportsRaw ? JSON.parse(reportsRaw) : [];
            const updatedReports = [
                reportEntry,
                ...reportsList.filter(r => (r.id || r.assessment_id) !== reportId)
            ];
            localStorage.setItem("cardioshield_saved_reports", JSON.stringify(updatedReports));
        } catch (e) {
            console.warn("Could not save to cardioshield_saved_reports:", e);
        }

        // Verify that Local Storage contains the prediction.
        const storedResult = localStorage.getItem(RESULT_KEY);

        if (!storedResult) {
            throw new Error(
                "The prediction could not be saved in browser storage."
            );
        }

        console.log(
            "CardioShield prediction saved:",
            JSON.parse(storedResult)
        );

        // For Live Server, keep assessment.html and dashboard.html
        // in the same folder. For Flask routes, adjust this URL.
        window.location.href = "dashboard.html";

    } catch (error) {
        console.error(
            "CardioShield prediction error:",
            error
        );

        alert(
            "Assessment failed:\n\n" +
            error.message +
            "\n\nCheck that Flask is running at:\n" +
            API_URL +
            "\n\nThen check F12 > Console for details."
        );

        button.disabled = false;
        button.textContent = originalText;
    }
}

// ============================================
// INITIALIZE FORM
// Register exactly one submit listener.
// ============================================

document.addEventListener("DOMContentLoaded", function () {
    const form = getElement("assessmentForm");

    if (!form) {
        console.error(
            "Assessment form was not found. " +
            "Expected id='assessmentForm'."
        );
        return;
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitAssessment();
    });

    form.querySelectorAll("input, select, textarea")
        .forEach(function (field) {
            field.addEventListener("input", updateProgress);
            field.addEventListener("change", updateProgress);
        });

    updateProgress();
});
