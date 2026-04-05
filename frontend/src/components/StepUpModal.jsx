import axios from "axios";
import { useState, useEffect } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default function StepUpModal({ challenge, onClose }) {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState("");
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!challenge?.expires_at) return;
    const tick = () => {
      const diff = new Date(challenge.expires_at) - new Date();
      if (diff <= 0) { setTimeLeft("Expired"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}m ${s.toString().padStart(2,"0")}s remaining`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [challenge?.expires_at]);

  const challengeId = challenge?.challenge_id;

  const resolve = async (approved) => {
    if (isResolving || !challengeId) return;
    setIsResolving(true);
    setError("");
    try {
      await axios.post(
        `${API}/stepup/${challengeId}/resolve`,
        { approved },
        { headers: { "Content-Type": "application/json" }, withCredentials: true }
      );
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setError(
        (typeof detail === "string" && detail) ||
        e?.message ||
        "Failed to resolve. Please try again."
      );
    } finally {
      setIsResolving(false);
    }
  };

  const dismiss = () => {
    if (isResolving) return;
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          position: "relative",
          background: "#0d1117",
          border: "1px solid #4a3a00",
          borderRadius: "4px",
          padding: "24px",
          width: "380px",
          fontFamily: "'Courier New', monospace",
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          disabled={isResolving}
          aria-label="Close"
          style={{
            position: "absolute",
            top: "10px",
            right: "12px",
            background: "transparent",
            border: "none",
            color: "#6a8a9a",
            fontSize: "18px",
            lineHeight: 1,
            cursor: isResolving ? "not-allowed" : "pointer",
            fontFamily: "'Courier New', monospace",
          }}
        >
          ×
        </button>

        <div style={{ fontSize: "9px", color: "#4a90a4", letterSpacing: "3px", marginBottom: "16px" }}>
          AUTHORIZATION REQUIRED
        </div>
        <div style={{ fontSize: "14px", color: "#ffaa00", letterSpacing: "2px", marginBottom: "16px" }}>
          STEP-UP CHALLENGE
        </div>

        <div style={{ background: "#0a0a0f", border: "1px solid #1e3a5f", padding: "12px", marginBottom: "16px" }}>
          <div style={{ fontSize: "10px", color: "#4a6080", marginBottom: "4px", letterSpacing: "1px" }}>ACTION</div>
          <div style={{ fontSize: "12px", color: "#a0b4c8", marginBottom: "8px" }}>{challenge?.action}</div>
          <div style={{ fontSize: "10px", color: "#4a6080", marginBottom: "4px", letterSpacing: "1px" }}>PARAMETERS</div>
          <div style={{ fontSize: "10px", color: "#6a8a9a", wordBreak: "break-all" }}>
            {JSON.stringify(challenge?.params ?? {})}
          </div>
          {challenge?.expires_at && (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "10px", color: "#4a6080", marginBottom: "4px", letterSpacing: "1px" }}>EXPIRES AT</div>
              <div style={{ fontSize: "10px", color: "#ffaa00" }}>
                {new Date(challenge.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {" "}(15-min window)
              </div>
              {timeLeft && (
                <div style={{ fontSize: "10px", color: "#ff6600", marginTop: "4px" }}>
                  ⏱ {timeLeft}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: "10px", color: "#4a6080", marginBottom: "16px", lineHeight: "1.6" }}>
          This action requires manual authorization. Review the parameters above and approve or deny.
        </div>

        {error && (
          <div style={{ fontSize: "10px", color: "#ff4444", marginBottom: "8px", lineHeight: "1.5" }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => resolve(true)}
            disabled={isResolving}
            style={{
              flex: 1,
              minWidth: "100px",
              background: "transparent",
              border: "1px solid #00ff88",
              color: "#00ff88",
              padding: "10px",
              fontSize: "10px",
              letterSpacing: "2px",
              cursor: "pointer",
              fontFamily: "'Courier New', monospace",
            }}
          >
            {isResolving ? "PROCESSING..." : "APPROVE"}
          </button>
          <button
            type="button"
            onClick={() => resolve(false)}
            disabled={isResolving}
            style={{
              flex: 1,
              minWidth: "100px",
              background: "transparent",
              border: "1px solid #ff4444",
              color: "#ff4444",
              padding: "10px",
              fontSize: "10px",
              letterSpacing: "2px",
              cursor: "pointer",
              fontFamily: "'Courier New', monospace",
            }}
          >
            DENY
          </button>
        </div>

        <button
          type="button"
          onClick={dismiss}
          disabled={isResolving}
          style={{
            width: "100%",
            marginTop: "12px",
            background: "transparent",
            border: "1px solid #4a6080",
            color: "#4a6080",
            padding: "10px",
            fontSize: "10px",
            letterSpacing: "2px",
            cursor: isResolving ? "not-allowed" : "pointer",
            fontFamily: "'Courier New', monospace",
          }}
        >
          DECIDE LATER
        </button>
      </div>
    </div>
  );
}