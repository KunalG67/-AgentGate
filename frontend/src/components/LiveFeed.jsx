import useWebSocket from "../hooks/useWebSocket";
import StepUpModal from "./StepUpModal";
import { useState, useEffect } from "react";

const s = {
  panel: { background: "#0d1117", border: "1px solid #1e3a5f", borderRadius: "4px", padding: "16px", height: "100%", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden" },
  label: { fontSize: "10px", color: "#00ffff", letterSpacing: "3px", textTransform: "uppercase", borderLeft: "2px solid #ff00ff", paddingLeft: "10px" },
  badge: { display: "inline-block", border: "1px solid #ffaa00", color: "#ffaa00", padding: "2px 6px", fontSize: "9px", letterSpacing: "2px" },
  row: (allowed, stepUpResolved) => ({
    background: allowed ? "#0a1a0f" : "#1a0a0a",
    border: `1px solid ${allowed ? (stepUpResolved ? "#2a5a2a" : "#1a4a2a") : "#4a1a1a"}`,
    borderRadius: "2px",
    padding: "10px",
    fontSize: "11px",
    animation: "fadeIn 0.3s ease"
  }),
  stepRow: {
    background: "#1a1400",
    border: "1px solid #4a3a00",
    borderRadius: "2px",
    padding: "10px",
    fontSize: "11px",
  },
};

const formatTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch { return iso; }
};

const getParamSummary = (action, params) => {
  if (!params) return "";
  if (action === "send_email")
    return `to: ${params.to || "?"}`;
  if (action === "read_email")
    return `folder: ${params.folder || "?"}, max: ${params.maxResults || "?"}`;
  if (action === "github_push")
    return `repo: ${params.repo || "?"} → ${params.branch || "?"}`;
  if (action === "github_delete")
    return `repo: ${params.repo || "?"}, branch: ${params.branch || "?"}`;
  if (action === "calendar_write")
    return `title: ${params.title || params.summary || "?"}`;
  return "";
};

const getStatusColor = (msg) => {
  if (msg.stepUpResolved && msg.allowed) return "#00FF00";
  if (msg.stepUpResolved && !msg.allowed) return "#FF4444";
  if (msg.allowed) return "#00ff88";
  return "#ff4444";
};

const getStatusText = (msg) => {
  if (msg.stepUpResolved)
    return msg.allowed ? "STEP-UP APPROVED" : "STEP-UP DENIED";
  if (msg.step_up_required) return "STEP-UP REQUIRED";
  return msg.allowed ? "ALLOWED" : "BLOCKED";
};

export default function LiveFeed() {
  const wsUrl = `${process.env.REACT_APP_WS_URL || "ws://localhost:8000"}/ws?token=${process.env.REACT_APP_WS_TOKEN || "agentgate-demo-token"}`;
  const { messages, setMessages, connected, manualReconnect } = useWebSocket(wsUrl);
  const [stepUp, setStepUp] = useState(null);
  const [resolvedMap, setResolvedMap] = useState({});

  useEffect(() => {
    messages.forEach(m => {
      if (m.type === "step_up_resolved") {
        setResolvedMap(prev => ({
          ...prev,
          [m.challenge_id]: m.approved ? "approved" : "denied"
        }));
      }
    });
  }, [messages]);

  const filtered = messages.filter(m => {
    if (m.type === "step_up_resolved") {
      return false;
    }
    return m.type === "action" || m.type === "step_up";
  });

  return (
    <div style={s.panel}>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={s.label}>Live Action Feed</div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ 
              width: "6px", 
              height: "6px", 
              borderRadius: "50%", 
              background: connected ? "#ff00ff" : "#ff4444", 
              boxShadow: connected ? "0 0 8px #ff00ff" : "none" 
            }}></div>
            <span style={{ 
              fontSize: "9px", 
              color: connected ? "#ff00ff" : "#ff4444", 
              letterSpacing: "2px",
              textShadow: connected ? "0 0 8px #ff00ff" : "none"
            }}>{connected ? "LIVE" : "OFFLINE"}</span>
          </div>
          <button
            onClick={() => setMessages([])}
            style={{
              background: "rgba(255, 0, 255, 0.08)",
              border: "1px solid #ff00ff",
              color: "#ff00ff",
              padding: "4px 12px",
              fontSize: "11px",
              letterSpacing: "2px",
              cursor: "pointer",
              fontFamily: "'Courier New', monospace",
              borderRadius: "4px",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => {
              e.target.style.background = "rgba(255, 0, 255, 0.15)";
              e.target.style.boxShadow = "0 0 10px rgba(255, 0, 255, 0.3)";
            }}
            onMouseLeave={(e) => {
              e.target.style.background = "rgba(255, 0, 255, 0.08)";
              e.target.style.boxShadow = "none";
            }}
          >
            CLEAR
          </button>
        </div>
      </div>

      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        {!connected ? (
          <div style={{ color: "#ff4444", fontSize: "11px", letterSpacing: "1px", marginTop: "20px", textAlign: "center" }}>
            OFFLINE
            <button onClick={manualReconnect}
              style={{marginLeft: "8px", border: "1px solid #FF00FF",
                      color: "#FF00FF", background: "transparent",
                      padding: "2px 8px", cursor: "pointer",
                      fontFamily: "monospace", fontSize: "11px"}}>
              RECONNECT
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#2a4a5a", fontSize: "11px", letterSpacing: "1px", marginTop: "20px", textAlign: "center" }}>awaiting agent activity...</div>
        ) : null}
        {[...filtered].reverse().map((m, i) => {
          let stableKey;
          if (m.type === "step_up") {
            stableKey = `stepup-${m.challenge_id}`;
          } else if (m.data?.id) {
            stableKey = `action-${m.data.id}`;
          } else {
            stableKey = `${m.type}-${m.data?.timestamp || i}`;
          }

          if (m.type === "step_up") {
            const resolved = m.challenge_id ? resolvedMap[m.challenge_id] : null;
            const resolution = resolved === "approved" ? "approved" : resolved === "denied" ? "denied" : null;
            const statusText = resolution === "approved"
              ? "STEP-UP APPROVED"
              : resolution === "denied"
              ? "STEP-UP DENIED"
              : "STEP-UP REQUIRED";
            const statusColor = resolution === "approved"
              ? "#00FF00"
              : resolution === "denied"
              ? "#FF4444"
              : "#FFA500";
            const action = m.action;
            const params = m.params;
            const reason = m.reason;
            return (
              <div key={stableKey} style={s.stepRow}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: statusColor, letterSpacing: "1px" }}>{statusText}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                      <span style={{ color: "#a0b4c8", letterSpacing: "1px" }}>{action}</span>
                    </div>
                    <div style={{
                      fontSize: "10px",
                      color: "#8892a4",
                      fontFamily: "monospace",
                      marginTop: "2px",
                      letterSpacing: "0.5px"
                    }}>
                      {getParamSummary(action, params)}
                    </div>
                    {reason && <div style={{ color: "#4a6080", fontSize: "10px", marginTop: "3px" }}>{reason}</div>}
                  </div>
                  {!resolution && (
                    <button
                      onClick={() => setStepUp(m)}
                      style={{ background: "transparent", border: "1px solid #ffaa00", color: "#ffaa00", padding: "3px 8px", fontSize: "9px", letterSpacing: "1px", cursor: "pointer", fontFamily: "'Courier New', monospace" }}
                    >
                      REVIEW
                    </button>
                  )}
                </div>
              </div>
            );
          }

          const d = m.data;
          const isExecutionLab = !!(
            d?.params?._tag === "EX-LAB" ||
            d?.result?.tag === "EX-LAB" ||
            d?.params?._ex_lab === true ||
            d?.result?.execution_lab === true
          );
          return (
            <div key={stableKey} style={s.row(d.allowed, d.stepUpResolved)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ color: "#a0b4c8", letterSpacing: "1px" }}>{d.action}</span>
                    {isExecutionLab && <span style={s.badge}>EX-LAB</span>}
                  </div>
                  <div style={{
                    fontSize: "10px",
                    color: "#8892a4",
                    fontFamily: "monospace",
                    marginTop: "2px",
                    letterSpacing: "0.5px"
                  }}>
                    {getParamSummary(d.action, d.params)}
                  </div>
                </div>
                <span style={{ color: getStatusColor({ ...d, stepUpResolved: d.stepUpResolved, allowed: d.allowed }), fontSize: "10px", letterSpacing: "2px" }}>{getStatusText({ ...d, stepUpResolved: d.stepUpResolved, allowed: d.allowed })}</span>
              </div>
              {d.reason && <div style={{ color: "#4a6080", fontSize: "10px", marginTop: "3px" }}>{d.reason}</div>}
              <div style={{ color: "#2a4a5a", fontSize: "9px", marginTop: "3px" }}>{formatTime(d.timestamp)}</div>
            </div>
          );
        })}
      </div>

      {stepUp && <StepUpModal challenge={stepUp} onClose={() => setStepUp(null)} />}
    </div>
  );
}