import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

const s = {
  panel: { background: "#0d1117", border: "1px solid #1e3a5f", borderRadius: "4px", padding: "16px", height: "100%", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden" },
  label: { fontSize: "10px", color: "#00ffff", letterSpacing: "3px", textTransform: "uppercase", borderLeft: "2px solid #ff00ff", paddingLeft: "10px" },
  row: (allowed) => ({
    background: allowed ? "#0a1a0f" : "#1a0a0a",
    border: `1px solid ${allowed ? "#1a4a2a" : "#4a1a1a"}`,
    borderRadius: "2px",
    padding: "10px",
    fontSize: "11px",
  }),
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

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authed, setAuthed] = useState(true);

  const fetchLogs = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`${API}/audit`, { withCredentials: true });
      const data = res.data;
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.response?.status === 401) {
        setAuthed(false);
        setError("Not authenticated. Please log in.");
      } else {
        const detail = e?.response?.data?.detail;
        setError(
          (typeof detail === "string" && detail) ||
          e?.message ||
          "Failed to load audit log."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void fetchLogs();
    const interval = setInterval(() => {
      void fetchLogs();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div style={s.panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={s.label}>Audit Log</div>
        <button
          type="button"
          onClick={() => { setAuthed(true); void fetchLogs(); }}
          style={{ 
            background: "rgba(255, 0, 255, 0.06)", 
            border: "1px solid #ff00ff", 
            color: "#ff00ff", 
            padding: "3px 10px", 
            fontSize: "9px", 
            letterSpacing: "2px", 
            cursor: "pointer", 
            fontFamily: "'Courier New', monospace",
            borderRadius: "4px",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => {
            e.target.style.background = "rgba(255, 0, 255, 0.12)";
            e.target.style.boxShadow = "0 0 10px rgba(255, 0, 255, 0.3)";
          }}
          onMouseLeave={(e) => {
            e.target.style.background = "rgba(255, 0, 255, 0.06)";
            e.target.style.boxShadow = "none";
          }}
        >
          REFRESH
        </button>
      </div>

      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        {loading && (
          <div style={{ color: "#4a6080", fontSize: "11px", letterSpacing: "1px", marginTop: "20px", textAlign: "center" }}>
            loading...
          </div>
        )}
        {!!error && (
          <div style={{ color: "#ff4444", fontSize: "10px", letterSpacing: "1px", marginTop: "20px", textAlign: "center" }}>
            {error}
          </div>
        )}
        {!loading && !error && logs.length === 0 && (
          <div style={{ color: "#2a4a5a", fontSize: "11px", letterSpacing: "1px", marginTop: "20px", textAlign: "center" }}>
            no actions logged yet
          </div>
        )}
        {logs.map((log) => (
          <div key={log.id ?? `${log.timestamp}-${log.action}`} style={s.row(log.allowed)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ color: "#a0b4c8", letterSpacing: "1px" }}>{log.action}</span>
                <div style={{
                  fontSize: "10px",
                  color: "#8892a4",
                  fontFamily: "monospace",
                  marginTop: "2px",
                  letterSpacing: "0.5px"
                }}>
                  {getParamSummary(log.action, log.params)}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {log.step_up_approved && (
                  <span style={{ color: "#ffaa00", fontSize: "9px", letterSpacing: "1px" }}>STEP-UP APPROVED</span>
                )}
                <span style={{ color: log.allowed ? "#00ff88" : "#ff4444", fontSize: "10px", letterSpacing: "2px" }}>
                  {log.allowed ? "ALLOWED" : "BLOCKED"}
                </span>
              </div>
            </div>
            {log.reason && <div style={{ color: "#4a6080", fontSize: "10px", marginBottom: "3px" }}>{log.reason}</div>}
            {log.rule_id && <div style={{ color: "#2a4a5a", fontSize: "9px", marginBottom: "3px" }}>rule #{log.rule_id}</div>}
            <div style={{ color: "#1a3a4a", fontSize: "9px" }}>{formatTime(log.timestamp)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}