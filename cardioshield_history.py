import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app, request, jsonify


def get_database_path():
    """Keep the SQLite database beside the Flask project."""
    return Path(current_app.root_path) / "cardioshield_history.db"


def get_connection():
    """Create a connection with dictionary-like row access."""
    connection = sqlite3.connect(
        str(get_database_path()),
        timeout=10
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def init_assessment_history(app):
    """Initialize the database and register assessment history and auth routes."""

    with app.app_context():
        connection = get_connection()
        try:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS assessments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    assessment_id TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    assessment_json TEXT NOT NULL,
                    prediction_json TEXT NOT NULL,
                    risk_score REAL,
                    predicted_class INTEGER,
                    model_name TEXT
                )
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS
                idx_assessments_created_at
                ON assessments(created_at)
            """)

            connection.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    profile_json TEXT
                )
            """)

            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
            """)

            connection.commit()
        finally:
            connection.close()

    def hash_password(password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    def json_response_value(value):
        """Convert a database JSON string into a Python value."""
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return None

    def serialize_row(row):
        return {
            "assessment_id": row["assessment_id"],
            "created_at": row["created_at"],
            "assessment": json_response_value(
                row["assessment_json"]
            ),
            "prediction": json_response_value(
                row["prediction_json"]
            ),
            "risk_score": row["risk_score"],
            "predicted_class": row["predicted_class"],
            "model_name": row["model_name"],
        }

    @app.route("/history", methods=["POST"])
    def save_assessment_history():
        """Save one successful model assessment to SQLite."""
        data = request.get_json(silent=True)

        if not isinstance(data, dict):
            return jsonify({
                "success": False,
                "error": "A JSON object is required."
            }), 400

        assessment = data.get("assessment")
        prediction = data.get("prediction")

        if not isinstance(assessment, dict) or not isinstance(prediction, dict):
            return jsonify({
                "success": False,
                "error": "Both 'assessment' and 'prediction' objects are required."
            }), 400

        assessment_id = data.get("assessment_id") or prediction.get("prediction_id")

        if not assessment_id:
            assessment_id = "assessment-" + uuid.uuid4().hex[:12]

        assessment_id = str(assessment_id)
        created_at = datetime.now(timezone.utc).isoformat()

        score = None
        for key in (
            "model_score",
            "risk_percentage",
            "probability_percentage",
            "risk_score",
            "score",
        ):
            if key in prediction and prediction[key] is not None:
                try:
                    score = float(prediction[key])
                    break
                except (TypeError, ValueError):
                    pass

        predicted_class = None
        for key in ("prediction", "predicted_class", "class"):
            if key in prediction and prediction[key] is not None:
                try:
                    predicted_class = int(prediction[key])
                    break
                except (TypeError, ValueError):
                    pass

        model_name = (
            prediction.get("model")
            or prediction.get("model_name")
            or "Calibrated Logistic Regression"
        )

        try:
            assessment_json = json.dumps(assessment, ensure_ascii=False)
            prediction_json = json.dumps(prediction, ensure_ascii=False)
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "error": "Data could not be serialized to JSON."
            }), 400

        connection = get_connection()
        try:
            connection.execute("""
                INSERT INTO assessments (
                    assessment_id,
                    created_at,
                    assessment_json,
                    prediction_json,
                    risk_score,
                    predicted_class,
                    model_name
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(assessment_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    assessment_json = excluded.assessment_json,
                    prediction_json = excluded.prediction_json,
                    risk_score = excluded.risk_score,
                    predicted_class = excluded.predicted_class,
                    model_name = excluded.model_name
            """, (
                assessment_id,
                created_at,
                assessment_json,
                prediction_json,
                score,
                predicted_class,
                model_name
            ))

            connection.commit()

            return jsonify({
                "success": True,
                "message": "Assessment history saved.",
                "assessment_id": assessment_id
            }), 201

        except sqlite3.Error:
            current_app.logger.exception(
                "Could not save assessment history"
            )
            return jsonify({
                "success": False,
                "error": "Database error while saving assessment history."
            }), 500

        finally:
            connection.close()

    @app.route("/history", methods=["GET"])
    def list_assessment_history():
        """Return recent assessments, newest first."""
        try:
            limit = int(request.args.get("limit", 50))
        except (TypeError, ValueError):
            limit = 50

        limit = max(1, min(limit, 200))

        connection = get_connection()
        try:
            rows = connection.execute("""
                SELECT *
                FROM assessments
                ORDER BY created_at DESC, id DESC
                LIMIT ?
            """, (limit,)).fetchall()

            return jsonify({
                "success": True,
                "count": len(rows),
                "assessments": [
                    serialize_row(row) for row in rows
                ]
            })

        except sqlite3.Error:
            current_app.logger.exception(
                "Could not retrieve assessment history"
            )
            return jsonify({
                "success": False,
                "error": "Database error while retrieving history."
            }), 500

        finally:
            connection.close()

    @app.route("/history/<assessment_id>", methods=["GET"])
    def get_assessment_history(assessment_id):
        """Return a single saved assessment."""
        connection = get_connection()
        try:
            row = connection.execute("""
                SELECT *
                FROM assessments
                WHERE assessment_id = ?
            """, (assessment_id,)).fetchone()

            if row is None:
                return jsonify({
                    "success": False,
                    "error": "Assessment not found."
                }), 404

            return jsonify({
                "success": True,
                "assessment": serialize_row(row)
            })

        except sqlite3.Error:
            current_app.logger.exception(
                "Could not retrieve individual assessment"
            )
            return jsonify({
                "success": False,
                "error": "Database error while retrieving assessment."
            }), 500

        finally:
            connection.close()

    @app.route("/history/<assessment_id>", methods=["DELETE", "OPTIONS"])
    def delete_assessment_history(assessment_id):
        """Delete a saved assessment record by ID."""
        if request.method == "OPTIONS":
            return "", 204

        connection = get_connection()
        try:
            cursor = connection.execute("""
                DELETE FROM assessments
                WHERE assessment_id = ?
            """, (assessment_id,))
            connection.commit()

            if cursor.rowcount == 0:
                return jsonify({
                    "success": False,
                    "error": "Assessment record not found."
                }), 404

            return jsonify({
                "success": True,
                "message": "Assessment report deleted successfully.",
                "assessment_id": assessment_id
            }), 200

        except sqlite3.Error:
            current_app.logger.exception("Could not delete assessment record")
            return jsonify({
                "success": False,
                "error": "Database error while deleting report."
            }), 500

        finally:
            connection.close()

    @app.route("/history", methods=["DELETE", "OPTIONS"])
    def clear_all_assessment_history():
        """Delete all saved assessment records."""
        if request.method == "OPTIONS":
            return "", 204

        connection = get_connection()
        try:
            connection.execute("DELETE FROM assessments")
            connection.commit()
            return jsonify({
                "success": True,
                "message": "All assessment reports cleared successfully."
            }), 200

        except sqlite3.Error:
            current_app.logger.exception("Could not clear assessment history")
            return jsonify({
                "success": False,
                "error": "Database error while clearing reports."
            }), 500

        finally:
            connection.close()

    @app.route("/auth/register", methods=["POST", "OPTIONS"])
    def register_user():
        """Register a new user account."""
        if request.method == "OPTIONS":
            return "", 204
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"success": False, "error": "Invalid JSON payload."}), 400

        full_name = str(data.get("full_name") or data.get("name") or "").strip()
        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "")

        if not full_name:
            return jsonify({"success": False, "error": "Full name is required."}), 400
        if not email or "@" not in email:
            return jsonify({"success": False, "error": "A valid email address is required."}), 400
        if len(password) < 4:
            return jsonify({"success": False, "error": "Password must be at least 4 characters long."}), 400

        user_id = "user-" + uuid.uuid4().hex[:12]
        created_at = datetime.now(timezone.utc).isoformat()
        pwd_hash = hash_password(password)

        connection = get_connection()
        try:
            existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                return jsonify({"success": False, "error": "An account with this email already exists."}), 409

            connection.execute("""
                INSERT INTO users (user_id, created_at, full_name, email, password_hash, profile_json)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, created_at, full_name, email, pwd_hash, json.dumps({"fullName": full_name, "email": email})))
            connection.commit()

            return jsonify({
                "success": True,
                "message": "User registered successfully.",
                "user": {
                    "user_id": user_id,
                    "full_name": full_name,
                    "email": email,
                    "created_at": created_at
                }
            }), 201

        except sqlite3.Error:
            current_app.logger.exception("Registration error")
            return jsonify({"success": False, "error": "Database error during registration."}), 500
        finally:
            connection.close()

    @app.route("/auth/login", methods=["POST", "OPTIONS"])
    def login_user():
        """Authenticate user with email and password."""
        if request.method == "OPTIONS":
            return "", 204
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"success": False, "error": "Invalid JSON payload."}), 400

        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "")

        if not email or not password:
            return jsonify({"success": False, "error": "Email and password are required."}), 400

        connection = get_connection()
        try:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not row or row["password_hash"] != hash_password(password):
                return jsonify({"success": False, "error": "Invalid email or password."}), 401

            return jsonify({
                "success": True,
                "message": "Login successful.",
                "user": {
                    "user_id": row["user_id"],
                    "full_name": row["full_name"],
                    "email": row["email"],
                    "created_at": row["created_at"]
                }
            }), 200

        except sqlite3.Error:
            current_app.logger.exception("Login error")
            return jsonify({"success": False, "error": "Database error during login."}), 500
        finally:
            connection.close()
